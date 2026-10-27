import { categoricalColor } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createFormatter, humanize, richSafe } from '../format';
import type { BuildContext, ChartModel, Datum, ValueFormat } from '../types';
import { baseOption, legendBase, tooltipBase, tooltipRow, warnOnce } from './common';

export interface PieConfig {
  data: unknown;
  /** Field holding the slice name. */
  label: string;
  /** Field holding the slice value. */
  value: string;
  format?: ValueFormat;
  /** Donut with a total in the middle. */
  donut?: boolean;
  /** Text under the donut total. Set `false` to hide the center label. */
  centerLabel?: string | false;
  /** Slices beyond this fold into "Other". Default 6 — pies stop being readable past that. */
  maxSlices?: number;
  /** Name of the folded bucket. */
  otherLabel?: string;
  /** Pin colors to slice names so they survive filtering. */
  colors?: Record<string, string>;
  /** Slice labels around the pie. `auto` shows name + share. */
  labels?: 'auto' | 'none';
  legend?: boolean | 'auto';
}

export function buildPie(config: PieConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const rows = toRows(config.data);
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const otherLabel = config.otherLabel ?? 'Other';
  const maxSlices = Math.max(2, Math.floor(config.maxSlices ?? 6));

  // Aggregate duplicate names; remember first-appearance order for stable colors.
  const totals = new Map<string, number>();
  const order: string[] = [];
  let skippedNegative = 0;
  for (const row of rows) {
    const name = toLabel(row[config.label], ctx.locale);
    const v = toNumber(row[config.value]);
    if (v === null) continue;
    if (v < 0) {
      skippedNegative++;
      continue;
    }
    if (!totals.has(name)) order.push(name);
    totals.set(name, (totals.get(name) ?? 0) + v);
  }
  if (skippedNegative > 0) {
    warnOnce(warnings, `${skippedNegative} negative value(s) can't be shown as pie slices and were skipped.`);
  }

  const colorFor = new Map<string, string>();
  order.forEach((name, i) => colorFor.set(name, config.colors?.[name] ?? categoricalColor(t, i)));

  let slices = order
    .map((name) => ({ name, value: totals.get(name)! }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  if (slices.length > maxSlices) {
    const kept = slices.slice(0, maxSlices - 1);
    const rest = slices.slice(maxSlices - 1);
    const otherValue = rest.reduce((sum, s) => sum + s.value, 0);
    slices = [...kept, { name: otherLabel, value: otherValue }];
    colorFor.set(otherLabel, config.colors?.[otherLabel] ?? t.neutral);
  }

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const isEmpty = slices.length === 0 || total <= 0;
  const legend = (config.legend ?? 'auto') === 'auto' ? slices.length >= 2 : !!config.legend;
  const center = legend ? ['50%', '55%'] : ['50%', '50%'];
  const showLabels = (config.labels ?? 'auto') !== 'none';
  const sliceColors = slices.map((s) => colorFor.get(s.name) ?? t.neutral);

  const option = {
    ...baseOption(ctx),
    color: sliceColors,
    legend: legend ? legendBase(ctx, slices.map((s) => ({ name: s.name, icon: 'rect' }))) : { show: false },
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { name: string; value: number; percent: number; color: string }) =>
        tooltipRow(ctx, colorFor.get(p.name) ?? p.color, `${p.name} · ${p.percent.toFixed(1)}%`, fmt(p.value), 'rect'),
    },
    title:
      config.donut && config.centerLabel !== false && !isEmpty
        ? {
            text: fmt(total),
            subtext: config.centerLabel ?? 'Total',
            left: '50%',
            top: center[1],
            textAlign: 'center',
            textVerticalAlign: 'middle',
            itemGap: 2,
            textStyle: { color: t.ink, fontSize: 20, fontWeight: 600, fontFamily: ctx.fontFamily },
            subtextStyle: { color: t.inkMuted, fontSize: 12, fontFamily: ctx.fontFamily },
          }
        : undefined,
    series: [
      {
        type: 'pie',
        id: 'pie',
        name: humanize(config.value),
        radius: config.donut ? ['50%', '72%'] : [0, '72%'],
        center,
        avoidLabelOverlap: true,
        minShowLabelAngle: 4,
        startAngle: 90,
        padAngle: config.donut ? 1 : 0,
        itemStyle: {
          borderColor: t.surface,
          borderWidth: 2,
          borderRadius: config.donut ? 4 : 2,
        },
        label: showLabels
          ? {
              show: true,
              color: t.inkSecondary,
              fontSize: 11,
              fontFamily: ctx.fontFamily,
              formatter: (p: { name: string; percent: number }) => `${richSafe(p.name)}\n${p.percent.toFixed(p.percent < 10 ? 1 : 0)}%`,
              lineHeight: 15,
              width: 110,
              overflow: 'truncate',
            }
          : { show: false },
        labelLine: { show: showLabels, length: 8, length2: 8, lineStyle: { color: t.axis, width: 1 } },
        emphasis: { scale: true, scaleSize: 4 },
        data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: colorFor.get(s.name) } })),
      },
    ],
  };

  const rowsOut: Datum[] = slices.map((s) => ({
    [config.label]: s.name,
    [config.value]: s.value,
    share: total > 0 ? s.value / total : null,
  }));

  return {
    option,
    isEmpty,
    warnings,
    table: {
      columns: [
        { key: config.label, header: humanize(config.label), type: 'string' },
        { key: config.value, header: humanize(config.value), type: 'number', format: config.format, align: 'right' },
        { key: 'share', header: 'Share', type: 'number', format: { type: 'percent', decimals: 1 }, align: 'right' },
      ],
      rows: rowsOut,
    },
  };
}
