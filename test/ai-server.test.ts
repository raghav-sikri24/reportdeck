import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileData } from '../src/ai/profile';
import { createChartAdvisor, parseModelJson, suggestCharts, type ProviderRequest } from '../src/server/advisor';

// Fake SDKs: the advisor imports them lazily, only for the provider in use.
const geminiCreate = vi.fn();
const openaiResponses = vi.fn();
const openaiChat = vi.fn();
const anthropicCreate = vi.fn();
const anthropicBetaCreate = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI(this: Record<string, unknown>) {
    this.interactions = { create: geminiCreate };
  }),
}));
vi.mock('openai', () => ({
  default: vi.fn(function OpenAI(this: Record<string, unknown>) {
    this.responses = { create: openaiResponses };
    this.chat = { completions: { create: openaiChat } };
  }),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function Anthropic(this: Record<string, unknown>) {
    this.messages = { create: anthropicCreate };
    this.beta = { messages: { create: anthropicBetaCreate } };
  }),
}));

const rows = Array.from({ length: 60 }, (_, i) => ({
  day: `2026-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, '0')}`,
  channel: ['Card', 'UPI', 'Wallet'][i % 3],
  amount: 100 + i,
  customer_email: `person${i}@example.com`,
}));
const fullProfile = profileData(rows);
const aiAnswer = {
  suggestions: [
    { chart: 'line', title: 'Amount per month', reason: 'Shows the trend.', x: 'day', y: ['amount'], splitBy: '', size: '', aggregate: 'sum', timeUnit: 'month', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' },
    { chart: 'DONUT', title: 'Share by channel', reason: 'Three parts.', x: 'channel', y: ['amount'], splitBy: '', size: '', aggregate: 'sum', timeUnit: 'none', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' },
    { chart: 'bar', title: 'Invented', reason: '', x: 'region', y: ['profit'], splitBy: '', size: '', aggregate: 'sum', timeUnit: 'none', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' },
    { chart: 'line', title: 'Duplicate', reason: '', x: 'day', y: ['amount'], splitBy: '', size: '', aggregate: 'sum', timeUnit: 'month', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' },
  ],
};

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('http://localhost/api/chart-advisor', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('suggestCharts with a custom provider', () => {
  it('validates, repairs and de-duplicates the AI answer', async () => {
    const generate = vi.fn(async () => JSON.stringify(aiAnswer));
    const result = await suggestCharts({ profile: fullProfile }, { provider: { name: 'fake', generate } });
    expect(result.suggestions.map((s) => [s.chart, s.title, s.source])).toEqual([
      ['line', 'Amount per month', 'ai'],
      ['donut', 'Share by channel', 'ai'], // "DONUT" casing fixed
      // "Invented" (made-up columns) is rejected; "Duplicate" repeats the first view.
    ]);
    expect(result.issues.join(' ')).toMatch(/Unknown x column "region"/);
  });

  it('never forwards more detail than the server allows', async () => {
    let seen: ProviderRequest | undefined;
    const provider = { generate: vi.fn(async (req: ProviderRequest) => ((seen = req), '{"suggestions":[]}')) };
    // The browser (or an attacker) claims "sample" and sends rows…
    await suggestCharts({ profile: fullProfile }, { provider, privacy: 'summary' });
    expect(seen!.prompt).not.toContain('person0@example.com');
    expect(seen!.prompt).toContain('"top"'); // summary still includes common labels…
    await suggestCharts({ profile: { ...fullProfile, rowCount: 61 } }, { provider, privacy: 'schema', cacheTtlMs: 0 });
    expect(seen!.prompt).not.toMatch(/Card|"min"|"top"|2026-/); // …schema level has no values at all
  });

  it('caches identical requests', async () => {
    const generate = vi.fn(async () => JSON.stringify(aiAnswer));
    const options = { provider: { generate } };
    const a = await suggestCharts({ profile: fullProfile, question: 'trend' }, options);
    const b = await suggestCharts({ profile: fullProfile, question: 'trend' }, options);
    expect(generate).toHaveBeenCalledTimes(1);
    expect([a.cached, b.cached]).toEqual([false, true]);
  });

  it('times out slow providers', async () => {
    const provider = { generate: (req: ProviderRequest) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
    await expect(suggestCharts({ profile: fullProfile }, { provider, timeoutMs: 20 })).rejects.toMatchObject({ status: 504 });
  });

  it('parses fenced or chatty JSON', () => {
    expect(parseModelJson('```json\n{"suggestions":[]}\n```')).toEqual({ suggestions: [] });
    expect(parseModelJson('Sure! {"suggestions":[]} Hope it helps')).toEqual({ suggestions: [] });
    expect(() => parseModelJson('no json here')).toThrow(/invalid JSON/);
  });
});

describe('createChartAdvisor HTTP handler', () => {
  const generate = vi.fn(async () => JSON.stringify(aiAnswer));
  const handler = createChartAdvisor({ provider: { generate }, authorize: (req) => req.headers.get('x-user') === 'ok' });
  const authed = { headers: { 'content-type': 'application/json', 'x-user': 'ok' } };

  it('answers authorized POSTs', async () => {
    const res = await handler(post({ profile: fullProfile, count: 2 }, authed));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(2);
  });

  it('rejects bad requests without calling the provider', async () => {
    generate.mockClear();
    expect((await handler(new Request('http://x/api', { method: 'GET' }))).status).toBe(405);
    expect((await handler(post({ profile: fullProfile }))).status).toBe(401);
    expect((await handler(post('not json', authed))).status).toBe(400);
    expect((await handler(post({ profile: { columns: 'nope' } }, authed))).status).toBe(400);
    expect((await handler(post({ profile: fullProfile, pad: 'x'.repeat(300_000) }, authed))).status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });

  it('logs server-side failures by default and when onError is not set', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createChartAdvisor({ provider: 'openai-compatible' })(post({ profile: fullProfile }));
    expect(res.status).toBe(500);
    expect(String(spy.mock.calls[0]![1])).toMatch(/baseURL/);
    spy.mockRestore();
  });

  it('hides provider error details from the browser', async () => {
    const failing = createChartAdvisor({ provider: { generate: async () => { throw new Error('secret upstream detail: key sk-123'); } } });
    const res = await failing(post({ profile: fullProfile }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('sk-123');
  });
});

describe('built-in providers', () => {
  const profile = fullProfile;

  it('Gemini: Interactions API with a JSON schema response format', async () => {
    geminiCreate.mockResolvedValue({ output_text: JSON.stringify(aiAnswer) });
    const result = await suggestCharts({ profile }, { provider: 'gemini', apiKey: 'k', cacheTtlMs: 0 });
    const [params] = geminiCreate.mock.calls[0]!;
    expect(params).toMatchObject({ model: 'gemini-3.8-flash', response_format: { type: 'text', mime_type: 'application/json' } });
    expect(params.response_format.schema.properties.suggestions).toBeDefined();
    expect(params.system_instruction).toMatch(/choose charts/);
    expect(result).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash' });
  });

  it('OpenAI: Responses API with strict json_schema', async () => {
    openaiResponses.mockResolvedValue({ output_text: JSON.stringify(aiAnswer) });
    await suggestCharts({ profile }, { provider: 'openai', apiKey: 'k', model: 'gpt-6-astra', cacheTtlMs: 0 });
    const [params] = openaiResponses.mock.calls[0]!;
    expect(params.text.format).toMatchObject({ type: 'json_schema', name: 'chart_suggestions', strict: true });
  });

  it('OpenAI-compatible: Chat Completions, and requires baseURL + model', async () => {
    await expect(suggestCharts({ profile }, { provider: 'openai-compatible', cacheTtlMs: 0 })).rejects.toThrow(/baseURL/);
    openaiChat.mockResolvedValue({ choices: [{ message: { content: '```json\n' + JSON.stringify(aiAnswer) + '\n```' } }] });
    const r = await suggestCharts({ profile }, { provider: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3', cacheTtlMs: 0 });
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('Claude: structured output, low effort, refusal fallback on supported models', async () => {
    const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(aiAnswer) }] };
    anthropicBetaCreate.mockResolvedValue(ok);
    await suggestCharts({ profile }, { provider: 'anthropic', apiKey: 'k', cacheTtlMs: 0 });
    const [params] = anthropicBetaCreate.mock.calls[0]!;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    anthropicCreate.mockResolvedValue(ok);
    await suggestCharts({ profile }, { provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5', cacheTtlMs: 0 });
    expect(anthropicCreate.mock.calls[0]![0].fallbacks).toBeUndefined();
  });

  it('Claude: refusals and truncation become clean errors', async () => {
    anthropicBetaCreate.mockResolvedValue({ stop_reason: 'refusal', content: [] });
    await expect(suggestCharts({ profile }, { provider: 'anthropic', apiKey: 'k', cacheTtlMs: 0 })).rejects.toMatchObject({ status: 502, message: /declined/ });
    anthropicBetaCreate.mockResolvedValue({ stop_reason: 'max_tokens', content: [] });
    await expect(suggestCharts({ profile }, { provider: 'anthropic', apiKey: 'k', cacheTtlMs: 0 })).rejects.toMatchObject({ status: 502 });
  });
});
