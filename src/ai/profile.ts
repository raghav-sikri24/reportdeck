import { isDateLike, parseDate, toNumber, toRows } from '../core/data';
import type { Datum } from '../core/types';

/**
 * How much of the data a profile reveals.
 * - `schema`: column names, types and counts only — no values at all.
 * - `summary`: plus ranges, date spans and the most common category labels (default).
 * - `sample`: plus a few example rows.
 */
export type PrivacyLevel = 'schema' | 'summary' | 'sample';

export type ColumnKind = 'number' | 'date' | 'category' | 'text' | 'boolean' | 'id' | 'empty';
export type TimeGrain = 'year' | 'month' | 'day' | 'hour' | 'minute';

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  /** Non-empty values. */
  count: number;
  missing: number;
  distinct: number;
  /** True when `distinct` stopped counting at the cap. */
  distinctCapped?: boolean;
  /** Numbers: all values are whole numbers. */
  integer?: boolean;
  /** Numbers: at least one value is below zero. */
  hasNegative?: boolean;
  /** Hint from the column name and range. */
  unit?: 'currency' | 'percent' | 'fraction';
  /** Dates: finest unit present in the values. */
  grain?: TimeGrain;
  /** Categories/text: average label length (decides horizontal bars). */
  avgLength?: number;
  // ---- values (summary level and above) ----
  min?: number;
  max?: number;
  sum?: number;
  /** Dates: first and last value, ISO. */
  start?: string;
  end?: string;
  /** Categories: the most frequent labels. */
  top?: { value: string; count: number }[];
}

export interface DataProfile {
  rowCount: number;
  columns: ColumnProfile[];
  privacy: PrivacyLevel;
  /** Example rows (sample level only). */
  sample?: Datum[];
}

const DISTINCT_CAP = 10_000;
const TYPE_SAMPLE = 2_000;
const MAX_COLUMNS = 60;
const MAX_NAME = 80;
const MAX_LABEL = 60;

const ID_NAME_CI = /^(id|uuid|guid)$|(_|\s)(id|uuid|guid)$|^(txn|order|invoice|ref)(_?(no|number|num))?$/i;
/** `userId`, `orderID` — case-sensitive so "paid" and "valid" don't count. */
const ID_NAME_CAMEL = /[a-z](Id|ID)$/;
const isIdName = (name: string) => ID_NAME_CI.test(name) || ID_NAME_CAMEL.test(name);
const YEAR_NAME = /(^|_)(year|yr|fy)$|^year/i;
const CURRENCY_NAME =
  /amount|revenue|sales|price|cost|profit|income|spend|fee|gmv|balance|salary|budget|payment|payout|value_inr|value_usd|mrr|arr|ltv|cac|refund|tax|earnings|expense/i;
const PERCENT_NAME = /rate|pct|percent|ratio|share|conversion|margin_pct|churn|growth|utili[sz]ation/i;
const BOOL_STRINGS = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
}

function isBooleanLike(v: unknown): boolean {
  return typeof v === 'boolean' || (typeof v === 'string' && BOOL_STRINGS.has(v.trim().toLowerCase()));
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function isoLocal(d: Date, withTime: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date}T${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

function grainOf(dates: Date[]): TimeGrain {
  let grain: TimeGrain = 'year';
  const rank: Record<TimeGrain, number> = { year: 0, month: 1, day: 2, hour: 3, minute: 4 };
  const raise = (g: TimeGrain) => {
    if (rank[g] > rank[grain]) grain = g;
  };
  for (const d of dates) {
    if (d.getMinutes() !== 0 || d.getSeconds() !== 0) return 'minute';
    if (d.getHours() !== 0) raise('hour');
    else if (d.getDate() !== 1) raise('day');
    else if (d.getMonth() !== 0) raise('month');
  }
  return grain;
}

function profileColumn(name: string, values: unknown[]): ColumnProfile {
  const present = values.filter((v) => !isEmpty(v));
  const base = { name: clip(name, MAX_NAME), count: present.length, missing: values.length - present.length };

  const seen = new Map<string, number>();
  let capped = false;
  for (const v of present) {
    const key = v instanceof Date ? String(v.getTime()) : String(v);
    if (seen.has(key)) seen.set(key, seen.get(key)! + 1);
    else if (seen.size < DISTINCT_CAP) seen.set(key, 1);
    else capped = true;
  }
  const distinct = seen.size;
  const counts = { ...base, distinct, ...(capped ? { distinctCapped: true } : {}) };

  if (present.length === 0) return { ...counts, kind: 'empty' };

  const typeSample = present.slice(0, TYPE_SAMPLE);
  if (typeSample.every(isBooleanLike) && distinct <= 2 && !typeSample.every((v) => typeof v === 'number')) {
    return { ...counts, kind: 'boolean', top: topValues(seen) };
  }

  if (typeSample.every((v) => isDateLike(v))) {
    const dates = present.map(parseDate).filter((d): d is Date => d !== null);
    return dateProfile(counts, dates);
  }

  const numeric = typeSample.every((v) => toNumber(v) !== null);
  if (numeric) {
    const nums = present.map(toNumber).filter((n): n is number => n !== null);
    const integer = nums.every(Number.isInteger);
    const min = Math.min(...nums.slice(0, 200_000));
    const max = Math.max(...nums.slice(0, 200_000));
    if (integer && YEAR_NAME.test(name) && min >= 1900 && max <= 2100) {
      return dateProfile(counts, nums.map((y) => new Date(y, 0, 1)));
    }
    if (isIdName(name) && (distinct === present.length || integer)) {
      return { ...counts, kind: 'id' };
    }
    const sum = nums.reduce((s, n) => s + n, 0);
    let unit: ColumnProfile['unit'];
    if (PERCENT_NAME.test(name) && min >= 0 && max <= 1) unit = 'fraction';
    else if (PERCENT_NAME.test(name) && min >= 0 && max <= 100) unit = 'percent';
    else if (CURRENCY_NAME.test(name)) unit = 'currency';
    return { ...counts, kind: 'number', integer, hasNegative: min < 0, min, max, sum, ...(unit ? { unit } : {}) };
  }

  const strings = present.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  const avgLength = Math.round(strings.slice(0, TYPE_SAMPLE).reduce((s, v) => s + v.length, 0) / Math.min(strings.length, TYPE_SAMPLE));
  if (distinct === present.length && present.length > 20 && (isIdName(name) || avgLength > 6)) {
    return { ...counts, kind: isIdName(name) ? 'id' : 'text', avgLength };
  }
  if (distinct > 50 && distinct / present.length > 0.5) {
    return { ...counts, kind: 'text', avgLength };
  }
  return { ...counts, kind: 'category', avgLength, top: topValues(seen) };
}

function dateProfile(counts: Omit<ColumnProfile, 'kind'>, dates: Date[]): ColumnProfile {
  if (dates.length === 0) return { ...counts, kind: 'empty' };
  let min = dates[0]!;
  let max = dates[0]!;
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const grain = grainOf(dates.slice(0, TYPE_SAMPLE));
  const withTime = grain === 'hour' || grain === 'minute';
  return { ...counts, kind: 'date', grain, start: isoLocal(min, withTime), end: isoLocal(max, withTime) };
}

function topValues(seen: Map<string, number>): { value: string; count: number }[] {
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value: clip(value, MAX_LABEL), count }));
}

/**
 * Summarizes a dataset column by column: inferred kind (number, date,
 * category, …), counts, ranges and common labels. Rule-based suggestions
 * use the full profile; only a redacted copy is ever sent to an AI provider.
 */
export function profileData(input: unknown): DataProfile {
  const rows = toRows(input);
  const names: string[] = [];
  for (const row of rows.slice(0, 200)) {
    for (const key of Object.keys(row)) if (!names.includes(key)) names.push(key);
  }
  const columns = names.slice(0, MAX_COLUMNS).map((name) =>
    profileColumn(
      name,
      rows.map((r) => r[name]),
    ),
  );
  return {
    rowCount: rows.length,
    columns,
    privacy: 'sample',
    sample: rows.slice(0, 5).map((row) => {
      const out: Datum = {};
      for (const c of columns) {
        const v = row[c.name];
        out[c.name] = typeof v === 'string' ? clip(v, MAX_LABEL) : v instanceof Date ? isoLocal(v, true) : v;
      }
      return out;
    }),
  };
}

const LEVEL_RANK: Record<PrivacyLevel, number> = { schema: 0, summary: 1, sample: 2 };

/** The stricter of two privacy levels. */
export function minPrivacy(a: PrivacyLevel, b: PrivacyLevel): PrivacyLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/** A copy of the profile that reveals no more than `level` allows. */
export function redactProfile(profile: DataProfile, level: PrivacyLevel): DataProfile {
  const effective = minPrivacy(profile.privacy, level);
  const columns = profile.columns.map((c): ColumnProfile => {
    const out: ColumnProfile = {
      name: clip(String(c.name), MAX_NAME),
      kind: c.kind,
      count: c.count,
      missing: c.missing,
      distinct: c.distinct,
    };
    if (c.distinctCapped) out.distinctCapped = true;
    if (c.integer !== undefined) out.integer = c.integer;
    if (c.hasNegative !== undefined) out.hasNegative = c.hasNegative;
    if (c.unit) out.unit = c.unit;
    if (c.grain) out.grain = c.grain;
    if (c.avgLength !== undefined) out.avgLength = c.avgLength;
    if (effective !== 'schema') {
      if (c.min !== undefined) out.min = c.min;
      if (c.max !== undefined) out.max = c.max;
      if (c.sum !== undefined) out.sum = c.sum;
      if (c.start) out.start = c.start;
      if (c.end) out.end = c.end;
      if (c.top) out.top = c.top.slice(0, 5).map((t) => ({ value: clip(String(t.value), MAX_LABEL), count: t.count }));
    }
    return out;
  });
  return {
    rowCount: profile.rowCount,
    columns,
    privacy: effective,
    ...(effective === 'sample' && profile.sample ? { sample: profile.sample.slice(0, 5) } : {}),
  };
}

export function findColumn(profile: DataProfile, name: string | undefined | null): ColumnProfile | undefined {
  if (!name) return undefined;
  return profile.columns.find((c) => c.name === name) ?? profile.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
