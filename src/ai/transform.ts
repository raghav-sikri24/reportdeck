import { parseDate, toLabel, toNumber, toRows } from '../core/data';
import type { Datum } from '../core/types';

export type AggregateOp = 'sum' | 'avg' | 'count' | 'min' | 'max';
export type TimeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Measure {
  /** Column to aggregate, or `*` to count rows. */
  field: string;
  op: AggregateOp;
  /** Output column name. Defaults to `field` (or `count` for `*`). */
  as?: string;
}

/**
 * A declarative reshaping of rows. It is plain data — safe to accept from an
 * AI model, because nothing in it is ever executed as code.
 */
export interface TransformSpec {
  /** Keep only the last `n` units, counted back from the latest date in the data. */
  last?: { field: string; n: number; unit: TimeUnit };
  /** Replace dates with the start of their day/week/month/quarter/year. */
  timeBucket?: { field: string; unit: TimeUnit };
  /** Dimensions to group by (the bucketed date field is included automatically). */
  groupBy?: string[];
  /** Aggregations per group. Defaults to counting rows when grouping. */
  measures?: Measure[];
  /** Keep the `n` largest values of `field` (ranked by the sum of `by`). */
  topN?: { field: string; n: number; by: string; other?: boolean; otherLabel?: string };
  /** Long → wide: one column per value of `field`, holding `value`. */
  pivot?: { field: string; value: string; maxSeries?: number; otherLabel?: string };
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface TransformResult {
  rows: Datum[];
  /** Column names created by a pivot, in display order. */
  series?: string[];
  notes: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Start of the unit containing `d`, in local time. Weeks start on Monday (ISO). */
export function startOfUnit(d: Date, unit: TimeUnit): Date {
  switch (unit) {
    case 'year':
      return new Date(d.getFullYear(), 0, 1);
    case 'quarter':
      return new Date(d.getFullYear(), d.getMonth() - (d.getMonth() % 3), 1);
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case 'week': {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      return day;
    }
    case 'day':
    default:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

function addUnits(d: Date, unit: TimeUnit, n: number): Date {
  const out = new Date(d);
  if (unit === 'year') out.setFullYear(out.getFullYear() + n);
  else if (unit === 'quarter') out.setMonth(out.getMonth() + 3 * n);
  else if (unit === 'month') out.setMonth(out.getMonth() + n);
  else if (unit === 'week') out.setDate(out.getDate() + 7 * n);
  else out.setDate(out.getDate() + n);
  return out;
}

interface Acc {
  sum: number;
  n: number;
  rows: number;
  min: number;
  max: number;
}

const newAcc = (): Acc => ({ sum: 0, n: 0, rows: 0, min: Infinity, max: -Infinity });

function finish(acc: Acc, op: AggregateOp): number | null {
  if (op === 'count') return acc.rows;
  if (acc.n === 0) return null; // all values missing → a gap, not a zero
  if (op === 'sum') return acc.sum;
  if (op === 'avg') return acc.sum / acc.n;
  if (op === 'min') return acc.min;
  return acc.max;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareValues(a: unknown, b: unknown): number {
  const na = typeof a === 'number' ? a : toNumber(a);
  const nb = typeof b === 'number' ? b : toNumber(b);
  if (na !== null && nb !== null && typeof a !== 'string' && typeof b !== 'string') return na - nb;
  const da = typeof a === 'string' ? parseDate(a) : null;
  const db = typeof b === 'string' ? parseDate(b) : null;
  if (da && db && /^\d{4}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}/.test(String(b))) return da.getTime() - db.getTime();
  if (na !== null && nb !== null) return na - nb;
  return collator.compare(String(a), String(b));
}

function measureName(m: Measure): string {
  return m.as ?? (m.field === '*' ? 'count' : m.field);
}

function aggregate(rows: Datum[], keys: string[], measures: Measure[]): Datum[] {
  const groups = new Map<string, { key: Datum; accs: Acc[] }>();
  for (const row of rows) {
    const keyValues = keys.map((k) => row[k]);
    const id = JSON.stringify(keyValues);
    let g = groups.get(id);
    if (!g) {
      const key: Datum = {};
      keys.forEach((k, i) => (key[k] = keyValues[i]));
      g = { key, accs: measures.map(newAcc) };
      groups.set(id, g);
    }
    measures.forEach((m, i) => {
      const acc = g!.accs[i]!;
      if (m.field === '*') {
        acc.rows++;
        return;
      }
      const v = toNumber(row[m.field]);
      if (m.op === 'count') {
        if (row[m.field] !== null && row[m.field] !== undefined && row[m.field] !== '') acc.rows++;
        return;
      }
      if (v === null) return;
      acc.sum += v;
      acc.n++;
      if (v < acc.min) acc.min = v;
      if (v > acc.max) acc.max = v;
    });
  }
  return [...groups.values()].map(({ key, accs }) => {
    const out: Datum = { ...key };
    measures.forEach((m, i) => (out[measureName(m)] = finish(accs[i]!, m.op)));
    return out;
  });
}

/**
 * Applies a {@link TransformSpec}: date filter → time buckets → group &
 * aggregate → top-N → pivot → sort → limit. Missing values never become zeros.
 */
export function applyTransform(input: unknown, spec: TransformSpec): TransformResult {
  let rows = toRows(input);
  const notes: string[] = [];

  // 1. Relative date window, anchored to the data (not "now") so results are reproducible.
  if (spec.last && spec.last.n > 0) {
    const { field, n, unit } = spec.last;
    const dates = rows.map((r) => parseDate(r[field]));
    const latest = dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
    if (latest) {
      const cutoff = addUnits(startOfUnit(latest, unit), unit, -(Math.floor(n) - 1));
      rows = rows.filter((_, i) => {
        const d = dates[i];
        return d !== null && d !== undefined && d >= cutoff;
      });
    }
  }

  // 2. Time buckets.
  const bucket = spec.timeBucket;
  let latest: Date | null = null;
  if (bucket) {
    let invalid = 0;
    const next: Datum[] = [];
    for (const row of rows) {
      const d = parseDate(row[bucket.field]);
      if (!d) {
        invalid++;
        continue;
      }
      if (!latest || d > latest) latest = d;
      next.push({ ...row, [bucket.field]: isoDate(startOfUnit(d, bucket.unit)) });
    }
    if (invalid > 0) notes.push(`${invalid} row(s) without a valid "${bucket.field}" date were left out.`);
    rows = next;
  }

  // A last bucket covering only part of its period looks like a sudden drop. Say so.
  if (bucket && bucket.unit !== 'day' && latest) {
    const startOfLast = startOfUnit(latest, bucket.unit);
    const end = addUnits(startOfLast, bucket.unit, 1);
    const covered = (latest.getTime() - startOfLast.getTime() + 86_400_000) / (end.getTime() - startOfLast.getTime());
    if (covered < 0.9) {
      const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(latest);
      notes.push(`The last ${bucket.unit} is still in progress (data ends ${day}).`);
    }
  }

  // 3. Group & aggregate.
  const keys = [...(bucket ? [bucket.field] : []), ...(spec.groupBy ?? []).filter((k) => k !== bucket?.field)];
  const measures = spec.measures && spec.measures.length > 0 ? spec.measures : keys.length > 0 ? [{ field: '*', op: 'count' as const }] : [];
  if (keys.length > 0 || (spec.measures && spec.measures.length > 0)) {
    const labelled = rows.map((row) => {
      const out: Datum = { ...row };
      for (const k of keys) if (k !== bucket?.field) out[k] = toLabel(row[k], 'en-US');
      return out;
    });
    rows = aggregate(labelled, keys, measures);
    if (bucket) rows.sort((a, b) => String(a[bucket.field]).localeCompare(String(b[bucket.field])));
  }
  const additive = measures.every((m) => m.op === 'sum' || m.op === 'count');

  // 4. Top N (+ "Other").
  if (spec.topN && spec.topN.n > 0) {
    const { field, n, by } = spec.topN;
    const totals = new Map<string, number>();
    for (const row of rows) {
      const k = String(row[field]);
      totals.set(k, (totals.get(k) ?? 0) + (toNumber(row[by]) ?? 0));
    }
    if (totals.size > n) {
      const keep = new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.floor(n)).map(([k]) => k));
      const otherLabel = spec.topN.otherLabel ?? 'Other';
      if (spec.topN.other && additive) {
        const relabelled = rows.map((r) => (keep.has(String(r[field])) ? r : { ...r, [field]: otherLabel }));
        const groupKeys = keys.length > 0 ? keys : [field];
        const sums: Measure[] = measures.map((m) => ({ field: measureName(m), op: 'sum' }));
        rows = aggregate(relabelled, groupKeys, sums);
      } else {
        rows = rows.filter((r) => keep.has(String(r[field])));
      }
      notes.push(`Showing the top ${Math.floor(n)} of ${totals.size} "${field}" values.`);
    }
  }

  // 5. Pivot long → wide.
  let series: string[] | undefined;
  if (spec.pivot) {
    const { field, value } = spec.pivot;
    const maxSeries = Math.max(1, spec.pivot.maxSeries ?? 8);
    const otherLabel = spec.pivot.otherLabel ?? 'Other';
    const rowKeys = keys.filter((k) => k !== field);
    const totals = new Map<string, number>();
    for (const row of rows) {
      const s = String(row[field]);
      totals.set(s, (totals.get(s) ?? 0) + Math.abs(toNumber(row[value]) ?? 0));
    }
    let names = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    let fold = new Set<string>();
    if (names.length > maxSeries) {
      const kept = names.slice(0, maxSeries - 1);
      fold = new Set(names.slice(maxSeries - 1));
      names = additive ? [...kept, otherLabel] : kept;
      notes.push(
        additive
          ? `${fold.size} smaller "${field}" values were combined into "${otherLabel}".`
          : `Only the ${kept.length} largest "${field}" values are shown.`,
      );
    }
    // Series names come from data; never let one overwrite a key column.
    const safeName = (s: string) => (rowKeys.includes(s) ? `${s} (${field})` : s);
    const wide = new Map<string, Datum>();
    for (const row of rows) {
      const id = JSON.stringify(rowKeys.map((k) => row[k]));
      let out = wide.get(id);
      if (!out) {
        out = {};
        for (const k of rowKeys) out[k] = row[k];
        for (const s of names) out[safeName(s)] = null;
        wide.set(id, out);
      }
      const raw = String(row[field]);
      const target = fold.has(raw) ? (additive ? otherLabel : null) : raw;
      if (target === null) continue;
      const v = toNumber(row[value]);
      if (v === null) continue;
      const col = safeName(target);
      out[col] = ((out[col] as number | null) ?? 0) + v;
    }
    rows = [...wide.values()];
    series = names.map(safeName);
  }

  // 6. Sort & limit.
  if (spec.sort) {
    const { field, direction } = spec.sort;
    const dir = direction === 'asc' ? 1 : -1;
    rows = rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const va = a.r[field];
        const vb = b.r[field];
        const ea = va === null || va === undefined;
        const eb = vb === null || vb === undefined;
        if (ea || eb) return ea && eb ? a.i - b.i : ea ? 1 : -1;
        return dir * compareValues(va, vb) || a.i - b.i;
      })
      .map((x) => x.r);
  }
  if (spec.limit && spec.limit > 0 && rows.length > spec.limit) rows = rows.slice(0, Math.floor(spec.limit));

  return { rows, ...(series ? { series } : {}), notes };
}
