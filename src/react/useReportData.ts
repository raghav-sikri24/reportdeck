import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { stableStringify } from '../core/data';
import { normalizeQuery, ReportDataError, runQuery, type Query, type QueryRequest } from '../data/fetcher';
import { IDLE_SNAPSHOT, type QueryStatus } from '../data/store';
import { useReportDeck } from './context';

export interface ReportDataOptions<T = unknown> {
  /** Set false to pause fetching (e.g. until a filter is chosen). Default true. */
  enabled?: boolean;
  /** Transform the response, e.g. `(res) => res.items`. Runs only when the response changes. */
  select?: (response: unknown) => T;
  /** Poll every N ms while the page is visible. */
  refreshInterval?: number;
  /** Refetch when the tab regains focus if data is older than `staleTime`. Default false. */
  revalidateOnFocus?: boolean;
  /** Overrides the provider defaults. */
  retry?: number;
  timeout?: number;
  staleTime?: number;
  /** While new params load, keep showing the previous result (dimmed). Default true. */
  keepPreviousData?: boolean;
  onError?: (error: ReportDataError) => void;
}

export interface ReportDataResult<T = unknown> {
  data: T | undefined;
  error: ReportDataError | undefined;
  status: QueryStatus;
  /** First load with nothing to show yet. */
  isLoading: boolean;
  /** Any request in flight. */
  isFetching: boolean;
  /** A request is in flight while older data is on screen. */
  isRefreshing: boolean;
  /** Showing the previous query's data while the new one loads. */
  isPreviousData: boolean;
  updatedAt: number;
  refetch: () => Promise<void>;
}

const noopSubscribe = () => () => {};

/**
 * Fetches report data with caching, request de-duplication, retries,
 * timeouts, polling and race-free param changes.
 *
 * ```ts
 * const { data, isLoading, error } = useReportData({ url: '/api/sales', params: { from, to } });
 * ```
 */
export function useReportData<T = unknown>(query: Query | null | undefined, options: ReportDataOptions<T> = {}): ReportDataResult<T> {
  const deck = useReportDeck();
  const { store, fetcher, config } = deck;
  const enabled = options.enabled ?? true;
  const request = normalizeQuery(query);
  const key = request && enabled ? stableStringify(request) : null;

  // Latest request/settings for the runner without making them effect dependencies.
  const latest = useRef({ request, options, fetcher, config });
  latest.current = { request, options, fetcher, config };

  const run = useCallback((signal: AbortSignal) => {
    const { request: req, options: opts, fetcher: f, config: cfg } = latest.current;
    return runQuery(f, req as QueryRequest, signal, {
      retry: opts.retry ?? cfg.retry,
      timeout: opts.timeout ?? cfg.timeout,
    });
  }, []);

  const staleTime = options.staleTime ?? config.staleTime ?? 0;
  const subscribe = useMemo(() => (key ? (cb: () => void) => store.subscribe(key, cb) : noopSubscribe), [store, key]);
  const getSnapshot = useCallback(() => (key ? store.getSnapshot(key) : IDLE_SNAPSHOT), [store, key]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key) return;
    void store.fetch(key, run, { staleTime });
  }, [key, store, run, staleTime]);

  // Polling, paused while the tab is hidden.
  const interval = options.refreshInterval;
  useEffect(() => {
    if (!key || !interval || interval <= 0 || typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void store.fetch(key, run, { force: true });
    }, Math.max(1000, interval));
    return () => window.clearInterval(id);
  }, [key, interval, store, run]);

  const revalidateOnFocus = options.revalidateOnFocus ?? false;
  useEffect(() => {
    if (!key || !revalidateOnFocus || typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void store.fetch(key, run, { staleTime });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [key, revalidateOnFocus, store, run, staleTime]);

  // `select` runs only when the raw response changes, so inline arrows are fine.
  const selectRef = useRef(options.select);
  selectRef.current = options.select;
  const selected = useMemo((): { value?: T; error?: ReportDataError } => {
    if (snap.data === undefined) return {};
    try {
      const fn = selectRef.current;
      return { value: (fn ? fn(snap.data) : snap.data) as T };
    } catch (cause) {
      return {
        error: new ReportDataError(cause instanceof Error ? `select() failed: ${cause.message}` : 'select() failed', {
          kind: 'parse',
          url: request?.url,
          cause,
        }),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.data]);

  const keepPrevious = options.keepPreviousData ?? true;
  const previous = useRef<T | undefined>(undefined);
  const hasOwnData = snap.data !== undefined && !selected.error;
  if (hasOwnData) previous.current = selected.value;
  const isPreviousData = !hasOwnData && keepPrevious && previous.current !== undefined && !!key;
  const data = hasOwnData ? selected.value : isPreviousData ? previous.current : undefined;

  const error = snap.error ?? selected.error;
  const status: QueryStatus = !key
    ? 'idle'
    : selected.error
      ? 'error'
      : snap.status === 'idle'
        ? 'loading' // the fetch effect hasn't started yet
        : snap.status;

  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  useEffect(() => {
    if (!error) return;
    onErrorRef.current?.(error);
    config.onError?.(error);
  }, [error, config]);

  const refetch = useCallback(() => (key ? store.fetch(key, run, { force: true }) : Promise.resolve()), [key, store, run]);

  return {
    data,
    error,
    status,
    isLoading: status === 'loading' && data === undefined,
    isFetching: snap.isFetching || (status === 'loading' && !!key),
    isRefreshing: (snap.isFetching || status === 'loading') && data !== undefined,
    isPreviousData,
    updatedAt: snap.updatedAt,
    refetch,
  };
}

/** Invalidate cached queries (all, or those whose URL contains `match`) and refetch the visible ones. */
export function useInvalidateReportData(): (match?: string | ((request: QueryRequest) => boolean)) => void {
  const { store } = useReportDeck();
  return useCallback(
    (match) => {
      store.invalidate((key) => {
        if (!match) return true;
        try {
          const req = JSON.parse(key) as QueryRequest;
          return typeof match === 'string' ? req.url.includes(match) : match(req);
        } catch {
          return false;
        }
      });
    },
    [store],
  );
}
