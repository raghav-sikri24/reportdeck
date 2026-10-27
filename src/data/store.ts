import { toReportDataError, type ReportDataError } from './fetcher';

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QuerySnapshot {
  data: unknown;
  error: ReportDataError | undefined;
  status: QueryStatus;
  isFetching: boolean;
  /** Epoch ms of the last successful fetch (0 = never). */
  updatedAt: number;
}

export const IDLE_SNAPSHOT: QuerySnapshot = Object.freeze({
  data: undefined,
  error: undefined,
  status: 'idle',
  isFetching: false,
  updatedAt: 0,
}) as QuerySnapshot;

type Runner = (signal: AbortSignal) => Promise<unknown>;

interface Entry {
  snapshot: QuerySnapshot;
  listeners: Set<() => void>;
  controller?: AbortController;
  promise?: Promise<void>;
  run?: Runner;
  gcTimer?: ReturnType<typeof setTimeout>;
}

/**
 * A tiny query cache: dedupes identical in-flight requests across components,
 * serves cached data instantly while revalidating, cancels requests nobody is
 * waiting for, and garbage-collects unused entries.
 */
export class QueryStore {
  private entries = new Map<string, Entry>();

  constructor(private readonly gcTime = 5 * 60_000) {}

  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { snapshot: IDLE_SNAPSHOT, listeners: new Set() };
      this.entries.set(key, e);
    }
    return e;
  }

  private update(e: Entry, patch: Partial<QuerySnapshot>): void {
    e.snapshot = { ...e.snapshot, ...patch };
    for (const listener of [...e.listeners]) listener();
  }

  getSnapshot(key: string): QuerySnapshot {
    return this.entries.get(key)?.snapshot ?? IDLE_SNAPSHOT;
  }

  subscribe(key: string, listener: () => void): () => void {
    const e = this.entry(key);
    e.listeners.add(listener);
    if (e.gcTimer) {
      clearTimeout(e.gcTimer);
      e.gcTimer = undefined;
    }
    return () => {
      e.listeners.delete(listener);
      if (e.listeners.size > 0) return;
      // Defer so a quick re-subscribe (React StrictMode, key flip-flop) keeps the request.
      setTimeout(() => {
        if (e.listeners.size === 0 && e.controller) e.controller.abort();
      }, 0);
      e.gcTimer = setTimeout(() => {
        if (e.listeners.size === 0 && this.entries.get(key) === e) this.entries.delete(key);
      }, this.gcTime);
    };
  }

  /** Fetch unless fresh (`staleTime`) or already in flight. `force` ignores freshness. */
  fetch(key: string, run: Runner, opts: { force?: boolean; staleTime?: number } = {}): Promise<void> {
    const e = this.entry(key);
    e.run = run;
    if (e.promise) return e.promise;
    const fresh = e.snapshot.status === 'success' && Date.now() - e.snapshot.updatedAt < (opts.staleTime ?? 0);
    if (fresh && !opts.force) return Promise.resolve();

    const controller = new AbortController();
    e.controller = controller;
    const hadData = e.snapshot.status === 'success';
    this.update(e, { isFetching: true, status: hadData ? 'success' : 'loading', error: hadData ? e.snapshot.error : undefined });

    const promise = run(controller.signal)
      .then(
        (data) => {
          if (e.controller !== controller) return;
          this.update(e, { data, error: undefined, status: 'success', isFetching: false, updatedAt: Date.now() });
        },
        (raw: unknown) => {
          if (e.controller !== controller) return;
          const err = toReportDataError(raw);
          if (controller.signal.aborted || err.kind === 'abort') {
            this.update(e, { isFetching: false, status: hadData ? 'success' : 'idle' });
            return;
          }
          // A failed refresh keeps the last good data alongside the error.
          this.update(e, { error: err, status: 'error', isFetching: false });
        },
      )
      .finally(() => {
        if (e.controller === controller) {
          e.controller = undefined;
          e.promise = undefined;
        }
      });
    e.promise = promise;
    return promise;
  }

  /** Marks matching entries stale and refetches the ones on screen. */
  invalidate(predicate: (key: string) => boolean = () => true): void {
    for (const [key, e] of this.entries) {
      if (!predicate(key)) continue;
      e.snapshot = { ...e.snapshot, updatedAt: 0 };
      if (e.listeners.size > 0 && e.run) void this.fetch(key, e.run, { force: true });
    }
  }

  /** Writes data directly (optimistic updates, websockets, tests). */
  setData(key: string, data: unknown): void {
    const e = this.entry(key);
    this.update(e, { data, error: undefined, status: 'success', updatedAt: Date.now() });
  }

  clear(): void {
    for (const e of this.entries.values()) e.controller?.abort();
    this.entries.clear();
  }
}
