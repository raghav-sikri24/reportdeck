// Server-side AI chart advisor. API keys stay on your server; browsers only
// ever talk to your endpoint and only ever send a data *profile*.
import type * as AnthropicModule from '@anthropic-ai/sdk';
import type * as GenAIModule from '@google/genai';
import type * as OpenAIModule from 'openai';
import { stableStringify } from '../core/data';
import { minPrivacy, redactProfile, type ColumnKind, type ColumnProfile, type DataProfile, type PrivacyLevel } from '../ai/profile';
import { buildAdvisorPrompt } from '../ai/prompt';
import { advisorResponseSchema, specKey, validateSpec, type ChartSpec } from '../ai/spec';

export type BuiltInProvider = 'gemini' | 'openai' | 'anthropic' | 'openai-compatible';

export interface ProviderRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must match. */
  schema: Record<string, unknown>;
  signal: AbortSignal;
}

/** Bring any model: return the JSON text (or an already-parsed object). */
export interface CustomProvider {
  name?: string;
  model?: string;
  generate(request: ProviderRequest): Promise<string | unknown>;
}

export interface ChartAdvisorOptions {
  provider: BuiltInProvider | CustomProvider;
  /** Provider API key. Read it from an environment variable — never ship it to the browser. */
  apiKey?: string;
  /** Model ID. Defaults: Gemini `gemini-3.8-flash`, OpenAI `gpt-6-astra`, Claude `claude-opus-5-5`. */
  model?: string;
  /** For `openai-compatible`: the server's base URL (Ollama, OpenRouter, Groq, Azure OpenAI…). */
  baseURL?: string;
  /** The most detail this server forwards to the AI, whatever the browser sends. Default `summary`. */
  privacy?: PrivacyLevel;
  /** Suggestions per request (1–6). Default 4. */
  maxSuggestions?: number;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Cache identical requests for this long. Default 10 minutes; 0 disables. */
  cacheTtlMs?: number;
  /**
   * Gate the endpoint (session check, rate limiting). Strongly recommended:
   * without it, anyone who finds the URL can spend your AI credits.
   */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Largest accepted request body. Default 200 KB. */
  maxBodyBytes?: number;
  /** Called with provider and validation errors (logging, metrics). */
  onError?: (error: unknown) => void;
}

export interface AdvisorResult {
  suggestions: ChartSpec[];
  provider: string;
  model: string;
  cached: boolean;
  /** Problems found (and repaired or dropped) in the AI's answer. */
  issues: string[];
}

export const DEFAULT_MODELS = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-6-astra',
  anthropic: 'claude-opus-5-5',
} as const;

/** Claude models that accept the server-side refusal fallback. */
const CLAUDE_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export class AdvisorError extends Error {
  readonly status: number;
  constructor(message: string, status: number, cause?: unknown) {
    super(message);
    this.name = 'AdvisorError';
    this.status = status;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

// Non-literal specifiers keep bundlers from requiring every SDK at build time;
// only the provider you use needs to be installed.
async function importOptional<T>(specifier: string, label: string): Promise<T> {
  try {
    return (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as T;
  } catch (cause) {
    throw new AdvisorError(`The ${label} provider needs the "${specifier}" package: npm install ${specifier}`, 500, cause);
  }
}

function defaultExport<T>(mod: T): T extends { default: infer D } ? D : never {
  return ((mod as { default?: unknown }).default ?? mod) as T extends { default: infer D } ? D : never;
}

async function callProvider(options: ChartAdvisorOptions, request: ProviderRequest): Promise<{ text: unknown; name: string; model: string }> {
  const { provider } = options;
  if (typeof provider === 'object') {
    return { text: await provider.generate(request), name: provider.name ?? 'custom', model: provider.model ?? options.model ?? 'custom' };
  }
  const timeout = options.timeoutMs ?? 30_000;

  if (provider === 'gemini') {
    const model = options.model ?? DEFAULT_MODELS.gemini;
    const { GoogleGenAI } = await importOptional<typeof GenAIModule>('@google/genai', 'Gemini');
    const client = new GoogleGenAI({ apiKey: options.apiKey });
    const interaction = await client.interactions.create(
      {
        model,
        input: request.prompt,
        system_instruction: request.system,
        response_format: { type: 'text', mime_type: 'application/json', schema: request.schema },
      },
      { signal: request.signal, timeout },
    );
    return { text: interaction.output_text, name: 'gemini', model };
  }

  if (provider === 'openai' || provider === 'openai-compatible') {
    if (provider === 'openai-compatible' && (!options.model || !options.baseURL)) {
      throw new AdvisorError('The openai-compatible provider needs both "baseURL" and "model".', 500);
    }
    const model = options.model ?? DEFAULT_MODELS.openai;
    const OpenAI = defaultExport(await importOptional<typeof OpenAIModule>('openai', 'OpenAI'));
    const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, timeout, maxRetries: 1 });
    if (provider === 'openai') {
      const response = await client.responses.create(
        {
          model,
          instructions: request.system,
          input: request.prompt,
          text: { format: { type: 'json_schema', name: 'chart_suggestions', strict: true, schema: request.schema } },
        },
        { signal: request.signal },
      );
      return { text: response.output_text, name: 'openai', model };
    }
    // Compatible servers broadly implement Chat Completions rather than the Responses API.
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'chart_suggestions', strict: true, schema: request.schema } },
      },
      { signal: request.signal },
    );
    return { text: completion.choices[0]?.message?.content ?? '', name: 'openai-compatible', model };
  }

  if (provider === 'anthropic') {
    const model = options.model ?? DEFAULT_MODELS.anthropic;
    const Anthropic = defaultExport(await importOptional<typeof AnthropicModule>('@anthropic-ai/sdk', 'Claude'));
    const client = new Anthropic({ apiKey: options.apiKey, timeout, maxRetries: 1 });
    const body = {
      model,
      max_tokens: 16_000,
      system: request.system,
      messages: [{ role: 'user' as const, content: request.prompt }],
      // A structured, well-specified task: low effort keeps it fast and cheap.
      output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: request.schema } },
    };
    // On a safety decline, the API retries on a suitable model inside the same call.
    const response = CLAUDE_FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: request.signal })
      : await client.messages.create(body, { signal: request.signal });
    if (response.stop_reason === 'refusal') throw new AdvisorError('The model declined this request.', 502);
    if (response.stop_reason === 'max_tokens') throw new AdvisorError('The model ran out of output tokens.', 502);
    const text = response.content.find((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')?.text ?? '';
    return { text, name: 'anthropic', model };
  }

  throw new AdvisorError(`Unknown provider "${String(provider)}".`, 500);
}

/** Parses model output, tolerating Markdown code fences from compatible models. */
export function parseModelJson(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  let text = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AdvisorError('The model returned invalid JSON.', 502, cause);
  }
}

const KINDS = new Set<ColumnKind>(['number', 'date', 'category', 'text', 'boolean', 'id', 'empty']);
const PRIVACY = new Set<PrivacyLevel>(['schema', 'summary', 'sample']);
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const short = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/** Rebuilds an untrusted profile from known fields only, with size limits. */
export function sanitizeProfile(input: unknown): DataProfile {
  if (typeof input !== 'object' || input === null) throw new AdvisorError('Missing "profile".', 400);
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.columns)) throw new AdvisorError('"profile.columns" must be an array.', 400);
  const columns: ColumnProfile[] = [];
  for (const c of raw.columns.slice(0, 60)) {
    if (typeof c !== 'object' || c === null) continue;
    const col = c as Record<string, unknown>;
    const name = short(col.name, 80);
    const kind = col.kind as ColumnKind;
    if (!name || !KINDS.has(kind)) continue;
    const out: ColumnProfile = {
      name,
      kind,
      count: finite(col.count) ?? 0,
      missing: finite(col.missing) ?? 0,
      distinct: finite(col.distinct) ?? 0,
    };
    for (const k of ['min', 'max', 'sum', 'avgLength'] as const) {
      const v = finite(col[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of ['integer', 'hasNegative', 'distinctCapped'] as const) if (typeof col[k] === 'boolean') out[k] = col[k] as boolean;
    if (col.unit === 'currency' || col.unit === 'percent' || col.unit === 'fraction') out.unit = col.unit;
    if (typeof col.grain === 'string' && ['year', 'month', 'day', 'hour', 'minute'].includes(col.grain)) out.grain = col.grain as ColumnProfile['grain'];
    const start = short(col.start, 25);
    const end = short(col.end, 25);
    if (start) out.start = start;
    if (end) out.end = end;
    if (Array.isArray(col.top)) {
      out.top = col.top
        .slice(0, 5)
        .map((t) => (typeof t === 'object' && t ? { value: short((t as Record<string, unknown>).value, 60) ?? '', count: finite((t as Record<string, unknown>).count) ?? 0 } : null))
        .filter((t): t is { value: string; count: number } => t !== null);
    }
    columns.push(out);
  }
  if (columns.length === 0) throw new AdvisorError('The profile has no usable columns.', 400);
  const privacy = PRIVACY.has(raw.privacy as PrivacyLevel) ? (raw.privacy as PrivacyLevel) : 'schema';
  const sample = Array.isArray(raw.sample)
    ? raw.sample.slice(0, 5).map((row) => {
        const clean: Record<string, unknown> = {};
        if (typeof row === 'object' && row) {
          for (const col of columns) {
            const v = (row as Record<string, unknown>)[col.name];
            clean[col.name] = typeof v === 'string' ? v.slice(0, 60) : typeof v === 'number' || typeof v === 'boolean' || v === null ? v : undefined;
          }
        }
        return clean;
      })
    : undefined;
  return { rowCount: finite(raw.rowCount) ?? 0, columns, privacy, ...(sample ? { sample } : {}) };
}

interface CacheEntry {
  expires: number;
  value: Omit<AdvisorResult, 'cached'>;
}

function createCache(ttl: number, size = 200) {
  const map = new Map<string, CacheEntry>();
  return {
    get(key: string) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expires < Date.now()) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, e); // LRU touch
      return e.value;
    },
    set(key: string, value: CacheEntry['value']) {
      if (ttl <= 0) return;
      map.set(key, { expires: Date.now() + ttl, value });
      while (map.size > size) map.delete(map.keys().next().value as string);
    },
  };
}

const caches = new WeakMap<ChartAdvisorOptions, ReturnType<typeof createCache>>();

/**
 * Asks the configured AI provider for chart suggestions. Use this directly in
 * any server framework; {@link createChartAdvisor} wraps it as an HTTP handler.
 */
export async function suggestCharts(
  input: { profile: unknown; question?: unknown; count?: unknown },
  options: ChartAdvisorOptions,
): Promise<AdvisorResult> {
  const allowed = options.privacy ?? 'summary';
  const clean = sanitizeProfile(input.profile);
  const profile = redactProfile(clean, minPrivacy(allowed, clean.privacy));
  const question = typeof input.question === 'string' ? input.question.trim().slice(0, 300) : '';
  const requested = typeof input.count === 'number' && Number.isFinite(input.count) ? input.count : (options.maxSuggestions ?? 4);
  const count = Math.min(options.maxSuggestions ?? 6, Math.max(1, Math.floor(requested)), 6);

  let cache = caches.get(options);
  if (!cache) {
    cache = createCache(options.cacheTtlMs ?? 10 * 60_000);
    caches.set(options, cache);
  }
  const providerName = typeof options.provider === 'object' ? (options.provider.name ?? 'custom') : options.provider;
  const key = stableStringify({ profile, question, count, provider: providerName, model: options.model ?? '' });
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const { system, prompt } = buildAdvisorPrompt(profile, { question, count });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AdvisorError('The AI provider timed out.', 504)), options.timeoutMs ?? 30_000);
  let raw: { text: unknown; name: string; model: string };
  try {
    raw = await callProvider(options, { system, prompt, schema: advisorResponseSchema(), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new AdvisorError('The AI provider timed out.', 504, error);
    if (error instanceof AdvisorError) throw error;
    throw new AdvisorError('The AI provider returned an error.', 502, error);
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseModelJson(raw.text) as { suggestions?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const issues: string[] = [];
  const seen = new Set<string>();
  const suggestions: ChartSpec[] = [];
  for (const item of list) {
    const { spec, issues: found } = validateSpec(item, profile);
    issues.push(...found);
    if (!spec) continue;
    const k = specKey(spec);
    if (seen.has(k)) continue;
    seen.add(k);
    suggestions.push({ ...spec, source: 'ai' });
    if (suggestions.length >= count) break;
  }
  if (issues.length > 0) options.onError?.(new AdvisorError(`AI answer needed repairs: ${issues.join(' ')}`, 200));
  const value = { suggestions, provider: raw.name, model: raw.model, issues };
  cache.set(key, value);
  return { ...value, cached: false };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/**
 * A standard `Request → Response` handler (Next.js route handlers, Remix,
 * Hono, Bun, Deno, Cloudflare Workers…).
 *
 * ```ts
 * // app/api/chart-advisor/route.ts
 * export const POST = createChartAdvisor({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY });
 * ```
 */
export function createChartAdvisor(options: ChartAdvisorOptions): (request: Request) => Promise<Response> {
  const maxBytes = options.maxBodyBytes ?? 200_000;
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, { allow: 'POST' });
    try {
      if (options.authorize && !(await options.authorize(request))) return json(401, { error: 'Unauthorized' });
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > maxBytes) return json(413, { error: 'Request too large' });
      const text = await request.text();
      if (text.length > maxBytes) return json(413, { error: 'Request too large' });
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: 'Body must be JSON' });
      }
      const result = await suggestCharts(body as { profile: unknown }, options);
      return json(200, result);
    } catch (error) {
      options.onError?.(error);
      if (error instanceof AdvisorError) {
        // Client mistakes are safe to describe; provider failures stay generic.
        return json(error.status, { error: error.status < 500 ? error.message : 'AI suggestions are unavailable right now.' });
      }
      return json(500, { error: 'AI suggestions are unavailable right now.' });
    }
  };
}
