import { parseCSV } from '../core/csv';

export type ParamValue = string | number | boolean | Date | null | undefined;

export interface QueryRequest {
  /** Absolute URL, or a path resolved against the provider's `baseUrl`. */
  url: string;
  method?: string;
  /** Query-string parameters. Arrays repeat the key; null/undefined are skipped. */
  params?: Record<string, ParamValue | ParamValue[]>;
  /** JSON-serializable body (or a string/FormData/Blob, sent as-is). */
  body?: unknown;
  headers?: Record<string, string>;
}

/** A URL string or a full request description. */
export type Query = string | QueryRequest;

export type Fetcher = (request: QueryRequest, init: { signal: AbortSignal }) => Promise<unknown>;

export type HeadersInput = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

export type ReportDataErrorKind = 'http' | 'network' | 'timeout' | 'parse' | 'abort';

export class ReportDataError extends Error {
  readonly kind: ReportDataErrorKind;
  readonly status?: number;
  readonly url?: string;
  /** First 500 characters of the error response body, if any. */
  readonly body?: string;
  /** Seconds from a `Retry-After` header. */
  readonly retryAfter?: number;

  constructor(
    message: string,
    init: { kind: ReportDataErrorKind; status?: number; url?: string; body?: string; retryAfter?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'ReportDataError';
    this.kind = init.kind;
    this.status = init.status;
    this.url = init.url;
    this.body = init.body;
    this.retryAfter = init.retryAfter;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

export function normalizeQuery(query: Query | null | undefined): QueryRequest | null {
  if (!query) return null;
  if (typeof query === 'string') return query.trim() ? { url: query.trim() } : null;
  return query.url ? query : null;
}

function serializeParam(v: ParamValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

export function buildUrl(baseUrl: string | undefined, url: string, params?: QueryRequest['params']): string {
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(url) || url.startsWith('//');
  let full = url;
  if (!absolute && baseUrl) full = `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  if (!params) return full;
  const hashIndex = full.indexOf('#');
  const hash = hashIndex >= 0 ? full.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? full.slice(0, hashIndex) : full;
  const [path, existing = ''] = withoutHash.split(/\?(.*)/s);
  const search = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const s = serializeParam(item);
      if (s !== null) search.append(key, s);
    }
  }
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function isBodyInit(v: unknown): v is BodyInit {
  return (
    typeof v === 'string' ||
    (typeof FormData !== 'undefined' && v instanceof FormData) ||
    (typeof Blob !== 'undefined' && v instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && v instanceof URLSearchParams) ||
    v instanceof ArrayBuffer ||
    ArrayBuffer.isView(v)
  );
}

export interface FetcherConfig {
  baseUrl?: string;
  headers?: HeadersInput;
  credentials?: RequestCredentials;
}

/**
 * The default `fetch`-based fetcher: JSON (or CSV) in, typed errors out.
 * Replace it via the provider's `fetcher` prop to use axios, GraphQL, etc.
 */
export function createFetcher(config: FetcherConfig = {}): Fetcher {
  return async (request, { signal }) => {
    const url = buildUrl(config.baseUrl, request.url, request.params);
    const base = typeof config.headers === 'function' ? await config.headers() : config.headers;
    const headers = new Headers(base ?? {});
    for (const [k, v] of Object.entries(request.headers ?? {})) headers.set(k, v);
    if (!headers.has('accept')) headers.set('accept', 'application/json, text/csv;q=0.9, */*;q=0.5');

    let body: BodyInit | undefined;
    if (request.body !== undefined && request.body !== null) {
      if (isBodyInit(request.body)) body = request.body;
      else {
        body = JSON.stringify(request.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: request.method ?? (body !== undefined ? 'POST' : 'GET'),
        headers,
        body,
        signal,
        credentials: config.credentials,
      });
    } catch (cause) {
      if (signal.aborted) throw signal.reason ?? new ReportDataError('Request aborted', { kind: 'abort', url, cause });
      throw new ReportDataError('Network error — check your connection or CORS settings.', { kind: 'network', url, cause });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ReportDataError(`Request failed with status ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, {
        kind: 'http',
        status: res.status,
        url,
        body: text.slice(0, 500),
        retryAfter: parseRetryAfter(res.headers.get('retry-after')),
      });
    }
    if (res.status === 204 || res.status === 205) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('json') || /^\s*[[{]/.test(text)) {
      try {
        return JSON.parse(text) as unknown;
      } catch (cause) {
        throw new ReportDataError('The server returned invalid JSON.', { kind: 'parse', url, cause, body: text.slice(0, 500) });
      }
    }
    if (type.includes('csv')) return parseCSV(text);
    return text;
  };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function toReportDataError(err: unknown, url?: string): ReportDataError {
  if (err instanceof ReportDataError) return err;
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new ReportDataError(err.name === 'TimeoutError' ? 'Request timed out' : 'Request aborted', {
      kind: err.name === 'TimeoutError' ? 'timeout' : 'abort',
      url,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Request failed';
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
  return new ReportDataError(message, { kind: status ? 'http' : 'network', status, url, cause: err });
}

export function isRetryable(err: ReportDataError): boolean {
  if (err.kind === 'network' || err.kind === 'timeout') return true;
  return err.kind === 'http' && err.status !== undefined && RETRYABLE_STATUS.has(err.status);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunOptions {
  retry?: number;
  timeout?: number;
}

/** Runs a request with a per-attempt timeout and exponential backoff on transient failures. */
export async function runQuery(fetcher: Fetcher, request: QueryRequest, signal: AbortSignal, options: RunOptions = {}): Promise<unknown> {
  const retries = Math.max(0, options.retry ?? 2);
  const timeout = options.timeout ?? 30_000;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer =
      timeout > 0 && Number.isFinite(timeout)
        ? setTimeout(() => {
            timedOut = true;
            controller.abort(new ReportDataError(`Request timed out after ${Math.round(timeout / 1000)}s`, { kind: 'timeout', url: request.url }));
          }, timeout)
        : undefined;
    try {
      return await fetcher(request, { signal: controller.signal });
    } catch (raw) {
      const err = timedOut
        ? new ReportDataError(`Request timed out after ${Math.round(timeout / 1000)}s`, { kind: 'timeout', url: request.url, cause: raw })
        : signal.aborted
          ? new ReportDataError('Request aborted', { kind: 'abort', url: request.url, cause: raw })
          : toReportDataError(raw, request.url);
      if (signal.aborted || err.kind === 'abort' || !isRetryable(err) || attempt >= retries) throw err;
      const backoff = Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      await sleep(err.retryAfter !== undefined ? Math.min(30_000, err.retryAfter * 1000) : backoff, signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
