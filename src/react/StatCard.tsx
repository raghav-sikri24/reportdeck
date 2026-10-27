import { useId, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { toNumber } from '../core/data';
import { createFormatter, EMPTY_VALUE } from '../core/format';
import type { ValueFormat } from '../core/types';
import { cx, describeError } from './Card';
import { useReportDeck } from './context';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, MinusIcon } from './icons';
import { useReportItem } from './report';

export interface SparklineProps {
  data: unknown[];
  width?: number;
  height?: number;
  /** Mark the latest point in the accent color. Default true. */
  highlightLast?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * A dependency-free SVG sparkline. Missing values break the line instead of
 * dropping to zero; a flat series draws a flat line.
 */
export function Sparkline({ data, width = 120, height = 32, highlightLast = true, className, ariaLabel }: SparklineProps) {
  const values = data.map(toNumber);
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length === 0) return null;
  const pad = 3;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const yOf = (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2));

  let d = '';
  let penDown = false;
  values.forEach((v, i) => {
    if (v === null) {
      penDown = false;
      return;
    }
    const x = values.length > 1 ? pad + i * step : width / 2;
    d += `${penDown ? 'L' : 'M'}${x.toFixed(2)},${yOf(v).toFixed(2)}`;
    penDown = true;
  });

  let lastIndex = values.length - 1;
  while (lastIndex >= 0 && values[lastIndex] === null) lastIndex--;
  const last = lastIndex >= 0 ? values[lastIndex]! : null;
  const first = finite[0]!;

  return (
    <svg
      className={cx('rd-sparkline', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Trend from ${first} to ${last ?? first}`}
    >
      <path d={d} fill="none" className="rd-sparkline__line" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {highlightLast && last !== null ? (
        <circle
          cx={values.length > 1 ? pad + lastIndex * step : width / 2}
          cy={yOf(last)}
          r={3}
          className="rd-sparkline__dot"
        />
      ) : null}
    </svg>
  );
}

export interface StatCardProps {
  label: string;
  /** Current value (numbers or numeric strings). */
  value: unknown;
  /** Previous-period value; enables the delta. */
  previous?: unknown;
  /** Value format. Default `compact` (1,284 / 12.9K / 4.2M). */
  format?: ValueFormat;
  /** Show the change as a percentage (default) or in the value's own units. */
  deltaFormat?: 'percent' | 'absolute';
  /** Which direction is good news. `neutral` never colors the delta. Default `up`. */
  goodDirection?: 'up' | 'down' | 'neutral';
  /** e.g. "vs last month". */
  comparisonLabel?: string;
  /** Recent values for a sparkline. */
  trend?: unknown[];
  loading?: boolean;
  error?: unknown;
  /** Small helper text under the value. */
  hint?: ReactNode;
  /** `hero` renders one large headline figure. */
  size?: 'default' | 'hero';
  className?: string;
  style?: CSSProperties;
  includeInReport?: boolean;
}

export interface DeltaInfo {
  text: string;
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
  srText: string;
}

export function computeDelta(
  value: number | null,
  previous: number | null,
  opts: { deltaFormat: 'percent' | 'absolute'; goodDirection: 'up' | 'down' | 'neutral'; format: (v: number | null) => string; percent: (v: number | null) => string },
): DeltaInfo | null {
  if (value === null || previous === null) return null;
  const diff = value - previous;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  let text: string;
  if (opts.deltaFormat === 'percent' && previous !== 0) {
    text = opts.percent(Math.abs(diff / previous));
  } else {
    // Percent change from zero is undefined — show the absolute change instead.
    text = opts.format(Math.abs(diff));
  }
  const tone =
    direction === 'flat' || opts.goodDirection === 'neutral'
      ? 'neutral'
      : (direction === 'up') === (opts.goodDirection === 'up')
        ? 'good'
        : 'bad';
  const verb = direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change';
  return { text: direction === 'flat' ? '0%' : text, direction, tone, srText: direction === 'flat' ? verb : `${verb} ${text}` };
}

/** KPI tile: label, compact value, signed delta with icon (never color alone), optional sparkline. */
export function StatCard({
  label,
  value,
  previous,
  format = 'compact',
  deltaFormat = 'percent',
  goodDirection = 'up',
  comparisonLabel,
  trend,
  loading,
  error,
  hint,
  size = 'default',
  className,
  style,
  includeInReport = true,
}: StatCardProps) {
  const deck = useReportDeck();
  const { locale, currency, fontFamily } = deck.ctx;
  const fmt = useMemo(() => createFormatter(format, { locale, currency }), [format, locale, currency]);
  const fullFmt = useMemo(() => {
    const full = typeof format === 'string' && format === 'compact' ? 'number' : format === 'currency-compact' ? 'currency' : format;
    return createFormatter(full, { locale, currency });
  }, [format, locale, currency]);
  const pct = useMemo(() => createFormatter('percent', { locale, currency }), [locale, currency]);

  const v = toNumber(value);
  const p = toNumber(previous);
  const delta = computeDelta(v, p, { deltaFormat, goodDirection, format: fmt, percent: pct });
  const display = v === null ? (typeof value === 'string' && value.trim() ? value : EMPTY_VALUE) : fmt(v);
  const labelId = useId();

  const ref = useRef<HTMLDivElement>(null);
  useReportItem(
    () =>
      loading
        ? null
        : {
            kind: 'stat',
            stat: {
              label,
              value: display,
              delta: delta ? `${delta.direction === 'up' ? '+' : delta.direction === 'down' ? '-' : ''}${delta.text}${comparisonLabel ? ` ${comparisonLabel}` : ''}` : undefined,
              tone: delta ? (delta.tone === 'good' ? 'up' : delta.tone === 'bad' ? 'down' : 'neutral') : undefined,
            },
          },
    ref,
    includeInReport,
  );

  const DeltaIcon = delta?.direction === 'up' ? ArrowUpIcon : delta?.direction === 'down' ? ArrowDownIcon : MinusIcon;

  return (
    <div
      ref={ref}
      className={cx('rd-root', `rd-${deck.mode}`, 'rd-card', 'rd-stat', size === 'hero' && 'rd-stat--hero', className)}
      style={{ ['--rd-font' as string]: fontFamily, ...style }}
      role="group"
      aria-labelledby={labelId}
      aria-busy={loading || undefined}
    >
      <p id={labelId} className="rd-stat__label">
        {label}
      </p>
      {loading ? (
        <div className="rd-stat__skeleton" role="status" aria-label="Loading" />
      ) : error && v === null ? (
        <p className="rd-stat__error" role="alert">
          <AlertIcon size={14} /> {describeError(error).title}
        </p>
      ) : (
        <>
          <div className="rd-stat__row">
            <p className="rd-stat__value" title={v === null ? undefined : fullFmt(v)}>
              {display}
            </p>
            {trend && trend.length > 1 ? <Sparkline data={trend} width={size === 'hero' ? 160 : 96} height={size === 'hero' ? 44 : 28} ariaLabel={`${label} trend`} /> : null}
          </div>
          {delta ? (
            <p className={cx('rd-stat__delta', `is-${delta.tone}`)}>
              <DeltaIcon size={14} />
              <span aria-hidden="true">{delta.text}</span>
              <span className="rd-sr-only">{delta.srText}</span>
              {comparisonLabel ? <span className="rd-stat__compare">{comparisonLabel}</span> : null}
            </p>
          ) : null}
          {hint ? <p className="rd-stat__hint">{hint}</p> : null}
          {error ? (
            <p className="rd-stat__stale" role="status">
              <AlertIcon size={12} /> Couldn’t refresh
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Lays stat cards out in a responsive row that spans the full report width. */
export function StatGroup({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('rd-stat-group', 'rd-span-full', className)} style={style}>
      {children}
    </div>
  );
}
