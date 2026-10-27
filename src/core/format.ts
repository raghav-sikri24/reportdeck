import type { FormatOptions, ValueFormat } from './types';

export const EMPTY_VALUE = '—';

export interface FormatLocale {
  locale: string;
  currency: string;
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function safeLocale(locale: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf(locale).length > 0 ? locale : 'en-US';
  } catch {
    return 'en-US';
  }
}

function getNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = numberFormatCache.get(key);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat(safeLocale(locale), options);
    } catch {
      // Invalid currency code or option combination: degrade to a plain number format.
      const { style: _style, currency: _currency, currencyDisplay: _cd, ...rest } = options;
      nf = new Intl.NumberFormat(safeLocale(locale), rest);
    }
    numberFormatCache.set(key, nf);
  }
  return nf;
}

function normalizeFormat(format: ValueFormat | undefined): FormatOptions {
  if (format === undefined) return { type: 'number' };
  if (typeof format === 'string') return { type: format };
  if (typeof format === 'function') return { type: 'number' };
  return { type: 'number', ...format };
}

function intlOptions(opts: FormatOptions, currency: string): Intl.NumberFormatOptions {
  const fixed =
    opts.decimals !== undefined
      ? {
          minimumFractionDigits: clampDigits(opts.decimals),
          maximumFractionDigits: clampDigits(opts.decimals),
        }
      : null;
  const signDisplay = opts.signDisplay;
  const base: Intl.NumberFormatOptions = signDisplay ? { signDisplay } : {};
  switch (opts.type) {
    case 'integer':
      return { ...base, maximumFractionDigits: 0 };
    case 'compact':
      return { ...base, notation: 'compact', maximumFractionDigits: 1, ...fixed };
    case 'currency':
      return { ...base, style: 'currency', currency: opts.currency ?? currency, ...fixed };
    case 'currency-compact':
      return {
        ...base,
        style: 'currency',
        currency: opts.currency ?? currency,
        notation: 'compact',
        maximumFractionDigits: 1,
        ...fixed,
      };
    case 'percent':
      return { ...base, style: 'percent', maximumFractionDigits: 1, ...fixed };
    case 'number':
    default:
      return { ...base, maximumFractionDigits: 2, ...fixed };
  }
}

function clampDigits(n: number): number {
  return Math.min(20, Math.max(0, Math.round(n)));
}

/**
 * Builds a formatter for a value format. The formatter accepts null/undefined/NaN
 * and renders them as an em dash instead of "NaN" or "0".
 */
export function createFormatter(
  format: ValueFormat | undefined,
  { locale, currency }: FormatLocale,
): (value: number | null | undefined) => string {
  if (typeof format === 'function') {
    return (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
      try {
        return String(format(value));
      } catch {
        return String(value);
      }
    };
  }
  const opts = normalizeFormat(format);
  const nf = getNumberFormat(locale, intlOptions(opts, currency));
  const scale = opts.type === 'percent' && opts.percentInput === 'whole' ? 0.01 : 1;
  const prefix = opts.prefix ?? '';
  const suffix = opts.suffix ?? '';
  return (value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
    return `${prefix}${nf.format(value * scale)}${suffix}`;
  };
}

/**
 * Axis tick formatter: compact from 1,000 up (0 / 1K / 2K), keeps the unit of
 * the value format (currency symbol, percent).
 */
export function createAxisFormatter(
  format: ValueFormat | undefined,
  loc: FormatLocale,
): (value: number | null | undefined) => string {
  if (typeof format === 'function') return createFormatter(format, loc);
  const opts = normalizeFormat(format);
  if (opts.type === 'percent') return createFormatter({ ...opts, decimals: undefined }, loc);
  const isCurrency = opts.type === 'currency' || opts.type === 'currency-compact';
  // Small values: no forced decimals ("$0", "$2.5"), never "$0.00".
  const plainNf = getNumberFormat(loc.locale, {
    ...intlOptions({ ...opts, decimals: undefined, type: isCurrency ? 'currency' : 'number' }, loc.currency),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const compact = createFormatter({ ...opts, type: isCurrency ? 'currency-compact' : 'compact', decimals: undefined }, loc);
  const prefix = opts.prefix ?? '';
  const suffix = opts.suffix ?? '';
  return (value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
    return Math.abs(value) >= 1000 ? compact(value) : `${prefix}${plainNf.format(value)}${suffix}`;
  };
}

/** Short formatter for direct labels on marks (bar tips, line ends): same as axis ticks. */
export const createLabelFormatter = createAxisFormatter;

/** Text that is safe inside ECharts labels (which parse `{style|text}` rich-text tags). */
export function richSafe(text: string): string {
  return text.includes('|') ? text.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')) : text;
}

/** Does this format produce currency output? Used by exports to choose number formats. */
export function formatKind(format: ValueFormat | undefined): FormatOptions['type'] | 'custom' {
  if (typeof format === 'function') return 'custom';
  return normalizeFormat(format).type;
}

export function formatOptions(format: ValueFormat | undefined): FormatOptions {
  return normalizeFormat(format);
}

function getDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let df = dateFormatCache.get(key);
  if (!df) {
    df = new Intl.DateTimeFormat(safeLocale(locale), options);
    dateFormatCache.set(key, df);
  }
  return df;
}

export function hasTimeComponent(date: Date): boolean {
  return (
    date.getHours() !== 0 ||
    date.getMinutes() !== 0 ||
    date.getSeconds() !== 0 ||
    date.getMilliseconds() !== 0
  );
}

/** Medium date, plus a short time when the value isn't midnight. */
export function formatDate(value: Date | number, locale: string, withTime?: boolean): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const showTime = withTime ?? hasTimeComponent(date);
  return getDateFormat(
    locale,
    showTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(date);
}

/** `total_revenue` / `totalRevenue` / `total-revenue` → "Total revenue". */
export function humanize(key: string): string {
  const spaced = key
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return key;
  const lower = spaced
    .split(' ')
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
