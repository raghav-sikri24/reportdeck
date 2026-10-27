import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUrl, createFetcher, ReportDataError, runQuery, type Fetcher } from '../src/data/fetcher';
import { QueryStore } from '../src/data/store';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('buildUrl', () => {
  it('joins base URLs and appends params safely', () => {
    expect(buildUrl('https://api.x.com/v1/', '/sales', { from: new Date(Date.UTC(2024, 0, 1)), tag: ['a', 'b'], skip: null, q: 'a&b' })).toBe(
      'https://api.x.com/v1/sales?from=2024-01-01T00%3A00%3A00.000Z&tag=a&tag=b&q=a%26b',
    );
  });

  it('keeps existing query strings and hashes, ignores base for absolute URLs', () => {
    expect(buildUrl('https://ignored', 'https://other.com/a?x=1#top', { y: 2 })).toBe('https://other.com/a?x=1&y=2#top');
    expect(buildUrl(undefined, '/rel', undefined)).toBe('/rel');
  });
});

describe('createFetcher', () => {
  it('sends JSON bodies and async auth headers, parses JSON', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const fetcher = createFetcher({ baseUrl: '/api', headers: async () => ({ authorization: 'Bearer t' }) });
    const result = await fetcher({ url: 'report', body: { range: '30d' } }, { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/report');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"range":"30d"}');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer t');
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('parses CSV responses into rows and returns null for 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } }))
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    const fetcher = createFetcher();
    const signal = new AbortController().signal;
    expect(await fetcher({ url: '/x.csv' }, { signal })).toEqual([{ a: '1', b: '2' }]);
    expect(await fetcher({ url: '/empty' }, { signal })).toBeNull();
  });

  it('throws typed errors for HTTP failures, bad JSON and network errors', async () => {
    const fetcher = createFetcher();
    const signal = new AbortController().signal;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503, headers: { 'retry-after': '2' } })));
    await expect(fetcher({ url: '/a' }, { signal })).rejects.toMatchObject({ kind: 'http', status: 503, retryAfter: 2, body: 'nope' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{bad', { headers: { 'content-type': 'application/json' } })));
    await expect(fetcher({ url: '/a' }, { signal })).rejects.toMatchObject({ kind: 'parse' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetcher({ url: '/a' }, { signal })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('runQuery', () => {
  it('retries transient failures with backoff, then succeeds', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      if (calls < 3) throw new ReportDataError('down', { kind: 'http', status: 502 });
      return 'ok';
    };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await expect(runQuery(fetcher, { url: '/a' }, new AbortController().signal, { retry: 2 })).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry client errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new ReportDataError('bad', { kind: 'http', status: 400 });
    });
    await expect(runQuery(fetcher, { url: '/a' }, new AbortController().signal, { retry: 3 })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('times out slow requests', async () => {
    const fetcher: Fetcher = (_req, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    await expect(runQuery(fetcher, { url: '/slow' }, new AbortController().signal, { retry: 0, timeout: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('stops immediately when aborted', async () => {
    const controller = new AbortController();
    const fetcher: Fetcher = (_req, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const p = runQuery(fetcher, { url: '/a' }, controller.signal, { retry: 5 });
    controller.abort();
    await expect(p).rejects.toMatchObject({ kind: 'abort' });
  });
});

describe('QueryStore', () => {
  it('dedupes concurrent requests for the same key', async () => {
    const store = new QueryStore();
    const run = vi.fn(async () => [1]);
    await Promise.all([store.fetch('k', run), store.fetch('k', run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot('k')).toMatchObject({ status: 'success', data: [1] });
  });

  it('serves fresh cache without refetching inside staleTime', async () => {
    const store = new QueryStore();
    const run = vi.fn(async () => 1);
    await store.fetch('k', run);
    await store.fetch('k', run, { staleTime: 60_000 });
    expect(run).toHaveBeenCalledTimes(1);
    await store.fetch('k', run, { staleTime: 60_000, force: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data when a refresh fails', async () => {
    const store = new QueryStore();
    await store.fetch('k', async () => 'good');
    await store.fetch('k', async () => {
      throw new ReportDataError('boom', { kind: 'http', status: 500 });
    }, { force: true });
    expect(store.getSnapshot('k')).toMatchObject({ status: 'error', data: 'good' });
  });

  it('aborts a request once nobody is subscribed', async () => {
    vi.useFakeTimers();
    const store = new QueryStore();
    let aborted = false;
    const unsubscribe = store.subscribe('k', () => {});
    void store.fetch('k', (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => ((aborted = true), reject(new DOMException('x', 'AbortError'))))));
    unsubscribe();
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(store.getSnapshot('k').status).toBe('idle');
  });
});
