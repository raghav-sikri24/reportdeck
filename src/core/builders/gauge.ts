import { mix } from '../colors';
import { toNumber } from '../data';
import { createFormatter } from '../format';
import type { BuildContext, ChartModel, StatusLevel, ValueFormat } from '../types';
import { baseOption, warnOnce } from './common';

export interface GaugeBand {
  /** Upper bound (inclusive) of this band, in data units. */
  upTo: number;
  status: StatusLevel;
  /** Text shown with the value so status never relies on color alone. */
  label?: string;
}

export interface GaugeConfig {
  value: unknown;
  min?: number;
  max?: number;
  format?: ValueFormat;
  /** Caption under the value. */
  label?: string;
  /** Severity bands, e.g. `[{ upTo: 60, status: 'good' }, { upTo: 85, status: 'warning' }, { upTo: 100, status: 'critical' }]`. */
  bands?: GaugeBand[];
}

export function buildGauge(config: GaugeConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const value = toNumber(config.value);
  const min = Number.isFinite(config.min) ? config.min! : 0;
  let max = Number.isFinite(config.max) ? config.max! : 100;
  if (max <= min) {
    warnOnce(warnings, 'Gauge max must be greater than min; using min + 1.');
    max = min + 1;
  }
  const clamped = value === null ? min : Math.min(max, Math.max(min, value));
  if (value !== null && value !== clamped) warnOnce(warnings, 'Gauge value is outside min/max; the arc is clamped.');

  const bands = [...(config.bands ?? [])].sort((a, b) => a.upTo - b.upTo);
  const band = value === null ? undefined : (bands.find((b) => value <= b.upTo) ?? bands[bands.length - 1]);
  const fill = band ? t.status[band.status] : t.series[0]!;
  // Track is a lighter step of the fill's own ramp so the state reads across the whole arc.
  const track = mix(fill, t.surface, t.mode === 'dark' ? 0.78 : 0.82);
  const caption = [config.label, band?.label].filter(Boolean).join(' · ');

  const option = {
    ...baseOption(ctx),
    series: [
      {
        type: 'gauge',
        id: 'gauge',
        min,
        max,
        startAngle: 210,
        endAngle: -30,
        radius: '92%',
        center: ['50%', '58%'],
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: fill } },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, track]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: !!caption,
          offsetCenter: [0, '34%'],
          color: t.inkMuted,
          fontSize: 12,
          fontFamily: ctx.fontFamily,
        },
        detail: {
          valueAnimation: ctx.animation,
          offsetCenter: [0, '2%'],
          color: t.ink,
          fontSize: 28,
          fontWeight: 600,
          fontFamily: ctx.fontFamily,
          formatter: () => fmt(value),
        },
        data: [{ value: clamped, name: caption }],
      },
    ],
  };

  return {
    option,
    isEmpty: value === null,
    warnings,
    table: {
      columns: [
        { key: 'label', header: 'Metric', type: 'string' },
        { key: 'value', header: 'Value', type: 'number', format: config.format, align: 'right' },
        { key: 'min', header: 'Min', type: 'number', format: config.format, align: 'right' },
        { key: 'max', header: 'Max', type: 'number', format: config.format, align: 'right' },
        { key: 'status', header: 'Status', type: 'string' },
      ],
      rows: [{ label: config.label ?? 'Value', value, min, max, status: band?.label ?? band?.status ?? null }],
    },
  };
}
