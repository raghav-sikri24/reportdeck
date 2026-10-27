import { parseDate, toNumber } from './data';
import { createFormatter, formatDate } from './format';
import type { Datum, TableColumn } from './types';

export interface CsvOptions {
  /** Field delimiter. Default `,`. Use `;` for some European Excel locales. */
  delimiter?: string;
  /** Prepend a UTF-8 byte-order mark so Excel opens non-ASCII text correctly. Default true. */
  bom?: boolean;
  /** Write formatted values (e.g. "$1.2K") instead of raw numbers. Default false. */
  formatted?: boolean;
  /** Neutralize cells that spreadsheet apps would execute as formulas. Default true. */
  protectFormulas?: boolean;
  locale?: string;
  currency?: string;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Prefixes values that start with =, +, -, @, tab or CR with an apostrophe so
 * a spreadsheet treats them as text (CSV/formula injection, OWASP). Plain
 * numbers like "-42" are left alone.
 */
export function neutralizeFormula(value: string): string {
  if (FORMULA_TRIGGER.test(value) && !PLAIN_NUMBER.test(value)) return `'${value}`;
  return value;
}

function escapeField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || /[\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cellText(value: unknown, column: TableColumn, opts: Required<Pick<CsvOptions, 'formatted' | 'locale' | 'currency'>>): string {
  if (value === null || value === undefined) return '';
  if (column.type === 'date' || value instanceof Date) {
    const date = parseDate(value);
    if (!date) return String(value);
    if (opts.formatted) return formatDate(date, opts.locale);
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const hasTime = date.getHours() || date.getMinutes() || date.getSeconds();
    return hasTime ? `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : ymd;
  }
  if (column.type === 'number') {
    const n = toNumber(value);
    if (n === null) return typeof value === 'string' ? value : '';
    if (opts.formatted) return createFormatter(column.format, opts)(n);
    return String(n);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** RFC 4180 CSV with CRLF line endings. */
export function toCSV(columns: TableColumn[], rows: Datum[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const protect = options.protectFormulas ?? true;
  const opts = {
    formatted: options.formatted ?? false,
    locale: options.locale ?? 'en-US',
    currency: options.currency ?? 'USD',
  };
  const line = (cells: string[]) =>
    cells.map((c) => escapeField(protect ? neutralizeFormula(c) : c, delimiter)).join(delimiter);
  const out = [line(columns.map((c) => c.header))];
  for (const row of rows) {
    out.push(line(columns.map((c) => cellText(row[c.key], c, opts))));
  }
  const body = out.join('\r\n');
  return (options.bom ?? true) ? `\uFEFF${body}` : body;
}

/**
 * Parses RFC 4180 CSV (quoted fields, escaped quotes, embedded newlines,
 * CRLF/LF, BOM) into row objects keyed by the header row. Values stay strings;
 * charts coerce them with `toNumber`/`parseDate`.
 */
export function parseCSV(text: string, delimiter = ','): Datum[] {
  const src = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ''));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  const seen = new Map<string, number>();
  const keys = header.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
}
