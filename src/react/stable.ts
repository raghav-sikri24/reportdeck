import { useRef } from 'react';

type AnyFn = (...args: never[]) => unknown;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Stabilizes a chart's config props so inline literals (`series={['a','b']}`,
 * `format={(v) => …}`) don't rebuild the chart — and restart its animation —
 * on every parent render.
 *
 * - Plain objects/arrays compare structurally.
 * - Functions are swapped for stable trampolines that always call the latest
 *   version; a function whose source text changes still triggers a rebuild.
 */
export function useStableConfig<T>(config: T): T {
  const fns = useRef(new Map<string, AnyFn>());
  const trampolines = useRef(new Map<string, AnyFn>());
  const prev = useRef<{ signature: string; value: T } | null>(null);

  const parts: string[] = [];
  const walk = (v: unknown, path: string, depth: number): unknown => {
    if (typeof v === 'function') {
      fns.current.set(path, v as AnyFn);
      let t = trampolines.current.get(path);
      if (!t) {
        t = ((...args: never[]) => (fns.current.get(path) as AnyFn)(...args)) as AnyFn;
        trampolines.current.set(path, t);
      }
      parts.push(`${path}=fn:${String(v)}`);
      return t;
    }
    if (depth < 5 && Array.isArray(v)) {
      parts.push(`${path}=[${v.length}]`);
      return v.map((item, i) => walk(item, `${path}.${i}`, depth + 1));
    }
    if (depth < 5 && isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k], `${path}.${k}`, depth + 1);
      parts.push(`${path}={${Object.keys(v).join(',')}}`);
      return out;
    }
    if (v instanceof Date) {
      parts.push(`${path}=d:${v.getTime()}`);
      return v;
    }
    let text: string;
    try {
      text = JSON.stringify(v) ?? String(v);
    } catch {
      text = String(v);
    }
    parts.push(`${path}=${typeof v}:${text}`);
    return v;
  };

  const walked = walk(config, '$', 0) as T;
  const signature = parts.join('|');
  if (!prev.current || prev.current.signature !== signature) {
    prev.current = { signature, value: walked };
  }
  return prev.current.value;
}

const MAX_STRUCTURAL_ROWS = 20_000;

function shallowEqualRow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]) || (a[k] instanceof Date && b[k] instanceof Date && (a[k] as Date).getTime() === (b[k] as Date).getTime()));
}

/** Keeps `data` identity stable when an inline array has the same rows as last render. */
export function useStableData<T>(data: T): T {
  const prev = useRef(data);
  const a = prev.current as unknown;
  const b = data as unknown;
  if (Object.is(a, b)) return prev.current;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.length <= MAX_STRUCTURAL_ROWS && a.every((row, i) => shallowEqualRow(row, b[i]))) {
    return prev.current;
  }
  prev.current = data;
  return data;
}
