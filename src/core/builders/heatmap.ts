import { inkOn, sampleRamp } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createAxisFormatter, createFormatter, humanize } from '../format';
import type { BuildContext, ChartModel, Datum, ValueFormat } from '../types';
import { baseOption, categoryAxis, tooltipBase, tooltipHeader, tooltipRow, warnOnce } from './common';

export interface HeatmapConfig {
  data: unknown;
  x: string;
  y: string;
  value: string;
  format?: ValueFormat;
  /** Explicit category order; defaults to first appearance. */
  xOrder?: string[];
  yOrder?: string[];
  /** `auto` → diverging (centered on zero) when data crosses zero, else sequential. */
  scale?: 'auto' | 'sequential' | 'diverging';
  /** Values inside cells. `auto` shows them for small grids. */
  labels?: 'auto' | 'none' | 'all';
}

export function buildHeatmap(config: HeatmapConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const rows = toRows(config.data);
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const axisFmt = createAxisFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });

  const xs: string[] = [...(config.xOrder ?? [])];
  const ys: string[] = [...(config.yOrder ?? [])];
  const cells = new Map<string, number>();
  let duplicates = 0;
  for (const row of rows) {
    const xl = toLabel(row[config.x], ctx.locale);
    const yl = toLabel(row[config.y], ctx.locale);
    const v = toNumber(row[config.value]);
    if (!xs.includes(xl)) xs.push(xl);
    if (!ys.includes(yl)) ys.push(yl);
    if (v === null) continue;
    const key = `${xl}\u0000${yl}`;
    if (cells.has(key)) duplicates++;
    cells.set(key, (cells.get(key) ?? 0) + v);
  }
  if (duplicates > 0) warnOnce(warnings, `${duplicates} duplicate cell(s) were summed.`);

  const data: [number, number, number][] = [];
  for (const [key, v] of cells) {
    const [xl, yl] = key.split('\u0000') as [string, string];
    data.push([xs.indexOf(xl), ys.indexOf(yl), v]);
  }
  const values = data.map((d) => d[2]);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  const diverging = config.scale === 'diverging' || ((config.scale ?? 'auto') === 'auto' && min < 0 && max > 0);
  if (diverging) {
    const m = Math.max(Math.abs(min), Math.abs(max)) || 1;
    min = -m;
    max = m;
  }
  if (min === max) max = min + 1;

  const ramp = diverging
    ? [t.diverging.negative, t.diverging.neutral, t.diverging.positive]
    : (t.sequential as string[]);
  const colorAt = (v: number) => sampleRamp(ramp, (v - min) / (max - min));
  const cellCount = xs.length * ys.length;
  const labelMode = config.labels ?? 'auto';
  const showLabels = labelMode === 'all' || (labelMode === 'auto' && cellCount <= 84);

  const option = {
    ...baseOption(ctx),
    grid: { left: 4, right: 12, top: 8, bottom: 52, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { value: [number, number, number] }) => {
        const [xi, yi, v] = p.value;
        return (
          tooltipHeader(ctx, `${ys[yi] ?? ''} · ${xs[xi] ?? ''}`) +
          tooltipRow(ctx, colorAt(v), humanize(config.value), fmt(v), 'rect')
        );
      },
    },
    xAxis: { ...categoryAxis(ctx, xs, { boundaryGap: true }), axisLine: { show: false } },
    yAxis: { ...categoryAxis(ctx, ys, { boundaryGap: true, vertical: true }), inverse: true },
    visualMap: {
      type: 'continuous',
      min,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 180,
      inRange: { color: ramp },
      text: [axisFmt(max), axisFmt(min)],
      textGap: 8,
      textStyle: { color: t.inkMuted, fontSize: 11 },
      formatter: (v: number) => axisFmt(v),
    },
    series: [
      {
        type: 'heatmap',
        id: 'heatmap',
        name: humanize(config.value),
        data: data.map(([xi, yi, v]) => ({
          value: [xi, yi, v],
          label: showLabels ? { show: true, color: inkOn(colorAt(v)), formatter: () => axisFmt(v) } : undefined,
        })),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { fontSize: 11, fontFamily: ctx.fontFamily },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
        progressive: 2000,
      },
    ],
  };

  const tableRows: Datum[] = data.map(([xi, yi, v]) => ({
    [config.y]: ys[yi],
    [config.x]: xs[xi],
    [config.value]: v,
  }));

  return {
    option,
    isEmpty: data.length === 0,
    warnings,
    table: {
      columns: [
        { key: config.y, header: humanize(config.y), type: 'string' },
        { key: config.x, header: humanize(config.x), type: 'string' },
        { key: config.value, header: humanize(config.value), type: 'number', format: config.format, align: 'right' },
      ],
      rows: tableRows,
    },
  };
}
