import { formatDate, humanize } from './format';
import type { Datum, SeriesInput, SeriesSpec, XType } from './types';

export const BLANK_LABEL = '(blank)';

const CURRENCY_SYMBOLS = /[$€£¥₹₩₽₺₫₦₱฿¢]/g;
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Coerces backend values to finite numbers.
 *
 * Handles numbers, numeric strings ("1,234.5", "₹ 1,23,456", "12.5%", "(42)",
 * "1.234,56", unicode minus), and bigint. Everything else — null, booleans,
 * dates, NaN, ±Infinity, unparseable text — becomes `null` so it renders as a
 * gap rather than a misleading zero.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value !== 'string') return null;

  let s = value.trim();
  if (!s) return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1]!.trim();
  }
  s = s
    .replace(/[\u2212\u2012\u2013]/g, '-')
    .replace(CURRENCY_SYMBOLS, '')
    .replace(/%$/, '')
    .replace(/[\s\u00a0\u202f'_]/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present: whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = s.split(',').length - 1;
    const afterLast = s.length - lastComma - 1;
    if (afterLast === 3 || commas > 1) {
      s = s.replace(/,/g, ''); // thousands (incl. Indian 1,23,456 grouping)
    } else {
      s = s.replace(',', '.'); // single decimal comma: "12,5"
    }
  }

  if (!NUMERIC.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Is this value unambiguously a date (Date instance or ISO-8601 string)? */
export function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return DATE_ONLY.test(s) || YEAR_MONTH.test(s) || ISO_DATETIME.test(s);
}

/**
 * Parses dates without the classic timezone bug: `"2024-01-05"` is a LOCAL
 * calendar date (JS would otherwise parse it as UTC midnight and show Jan 4 in
 * the Americas). Numbers are epoch milliseconds; values below 1e11 are treated
 * as epoch seconds, and 4-digit integers as years.
 */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && value >= 1000 && value <= 9999) return new Date(value, 0, 1);
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    return new Date(ms);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  let m = DATE_ONLY.exec(s);
  if (m) return validLocalDate(+m[1]!, +m[2]! - 1, +m[3]!);
  m = YEAR_MONTH.exec(s);
  if (m) return validLocalDate(+m[1]!, +m[2]! - 1, 1);
  if (/^\d{4}$/.test(s)) return new Date(+s, 0, 1);
  if (/^\d+$/.test(s)) return parseDate(Number(s));
  const t = Date.parse(s.replace(' ', 'T'));
  if (!Number.isNaN(t)) return new Date(t);
  const t2 = Date.parse(s);
  return Number.isNaN(t2) ? null : new Date(t2);
}

function validLocalDate(y: number, monthIndex: number, d: number): Date | null {
  const date = new Date(y, monthIndex, d);
  // Reject roll-overs like 2024-02-31 → Mar 2.
  if (date.getFullYear() !== y || date.getMonth() !== monthIndex || date.getDate() !== d) return null;
  return date;
}

/**
 * Picks one date granularity for a whole series so labels stay consistent:
 * all Jan 1 → "2024", all 1st-of-month → "Jan 2024", all midnight → "Jan 5, 2024",
 * otherwise date + time.
 */
export function createDateLabeler(dates: Date[], locale: string): (date: Date) => string {
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()));
  const midnight = valid.every((d) => !hasTime(d));
  const firstOfMonth = midnight && valid.every((d) => d.getDate() === 1);
  const firstOfYear = firstOfMonth && valid.every((d) => d.getMonth() === 0);
  let options: Intl.DateTimeFormatOptions;
  if (valid.length > 1 && firstOfYear) options = { year: 'numeric' };
  else if (valid.length > 0 && firstOfMonth) options = { month: 'short', year: 'numeric' };
  else if (midnight) options = { dateStyle: 'medium' };
  else options = { dateStyle: 'medium', timeStyle: 'short' };
  let df: Intl.DateTimeFormat;
  try {
    df = new Intl.DateTimeFormat(locale, options);
  } catch {
    df = new Intl.DateTimeFormat('en-US', options);
  }
  return (date) => (Number.isNaN(date.getTime()) ? BLANK_LABEL : df.format(date));
}

function hasTime(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0;
}

/** Category label for any x value. Never returns an empty string. */
export function toLabel(value: unknown, locale: string): string {
  if (value === null || value === undefined) return BLANK_LABEL;
  if (value instanceof Date) return formatDate(value, locale);
  if (typeof value === 'string') return value.trim() === '' ? BLANK_LABEL : value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? BLANK_LABEL;
  } catch {
    return String(value);
  }
}

/** Accepts arrays, and unwraps common API envelopes (`data`, `items`, `results`, `rows`, `records`). */
export function toRows(input: unknown): Datum[] {
  if (Array.isArray(input)) return input.filter(isRecord);
  if (isRecord(input)) {
    for (const key of ['data', 'items', 'results', 'rows', 'records']) {
      const inner = input[key];
      if (Array.isArray(inner)) return inner.filter(isRecord);
      if (isRecord(inner) && key === 'data') {
        const nested = toRows(inner);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

export function isRecord(value: unknown): value is Datum {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** `auto` → `time` when every non-empty x is a Date or ISO date string; otherwise `category`. */
export function resolveXType(rows: Datum[], x: string, xType: XType = 'auto'): Exclude<XType, 'auto'> {
  if (xType !== 'auto') return xType;
  let seen = 0;
  for (const row of rows) {
    const v = row[x];
    if (v === null || v === undefined || v === '') continue;
    if (!isDateLike(v)) return 'category';
    seen++;
  }
  return seen > 0 ? 'time' : 'category';
}

/**
 * Normalizes series input. Without explicit series, every field (other than
 * the excluded ones) whose sampled values are numeric becomes a series.
 * Duplicate keys are dropped.
 */
export function resolveSeries(
  series: SeriesInput[] | undefined,
  rows: Datum[],
  exclude: string[],
): SeriesSpec[] {
  const specs: SeriesSpec[] = [];
  const seen = new Set<string>();
  const list = series && series.length > 0 ? series : inferNumericKeys(rows, exclude);
  for (const input of list) {
    const spec: SeriesSpec = typeof input === 'string' ? { key: input } : { ...input };
    if (!spec.key || seen.has(spec.key)) continue;
    seen.add(spec.key);
    specs.push({ ...spec, name: spec.name ?? humanize(spec.key) });
  }
  return specs;
}

/** Numeric-looking fields that are identifiers, not measures. */
const ID_LIKE = /^(id|ID|Id|year|Year|YEAR)$|_id$|[a-z]Id$|_ID$/;

export function inferNumericKeys(rows: Datum[], exclude: string[]): string[] {
  const sample = rows.slice(0, 50);
  const keys: string[] = [];
  const seen = new Set<string>(exclude);
  for (const row of sample) {
    for (const key of Object.keys(row)) {
      if (seen.has(key) || ID_LIKE.test(key)) continue;
      seen.add(key);
      const values = sample.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== '');
      if (values.length > 0 && values.every((v) => toNumber(v) !== null && !isDateLike(v))) {
        keys.push(key);
      }
    }
  }
  return keys;
}

/** Infers table columns from data when the caller didn't declare them. */
export function inferColumnType(rows: Datum[], key: string): 'number' | 'date' | 'string' {
  const values = rows
    .slice(0, 100)
    .map((r) => r[key])
    .filter((v) => v !== null && v !== undefined && v !== '');
  if (values.length === 0) return 'string';
  if (values.every((v) => typeof v === 'number' || typeof v === 'bigint')) return 'number';
  if (values.every((v) => isDateLike(v))) return 'date';
  if (values.every((v) => typeof v === 'string' && toNumber(v) !== null)) return 'number';
  return 'string';
}

/** Round up to a "nice" number for axis maxima (1, 2, 2.5, 5, 10 × 10^n). */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}

/** Stable JSON for cache keys: sorted object keys, Dates as ISO strings. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return v.toString();
    if (typeof v !== 'object' || v === null) return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const inner = (v as Record<string, unknown>)[k];
      if (inner !== undefined && typeof inner !== 'function') out[k] = walk(inner);
    }
    return out;
  };
  return JSON.stringify(walk(value)) ?? '';
}
