import { categoricalColor } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createAxisFormatter, createFormatter, humanize } from '../format';
import { MAX_CATEGORICAL } from '../tokens';
import type { BuildContext, ChartModel, Datum, TableColumn, ValueFormat } from '../types';
import { baseOption, gridBase, legendBase, tooltipBase, tooltipHeader, tooltipRow, valueAxis, warnOnce } from './common';

export interface ScatterConfig {
  data: unknown;
  x: string;
  y: string;
  /** Bubble chart: field that sets each point's area. */
  size?: string;
  /** Field that splits points into colored groups. */
  group?: string;
  /** Field shown as the point's name in tooltips. */
  name?: string;
  xFormat?: ValueFormat;
  yFormat?: ValueFormat;
  sizeFormat?: ValueFormat;
  /** Bubble diameter range in px. */
  sizeRange?: [number, number];
  legend?: boolean | 'auto';
  /** Include zero on both axes. Default false (scatter shows the data's own range). */
  includeZero?: boolean;
}

interface ScatterPoint {
  x: number;
  y: number;
  size: number | null;
  name: string | null;
  group: string;
  row: Datum;
}

export function buildScatter(config: ScatterConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const rows = toRows(config.data);
  const loc = { locale: ctx.locale, currency: ctx.currency };
  const fx = createFormatter(config.xFormat, loc);
  const fy = createFormatter(config.yFormat, loc);
  const fs = createFormatter(config.sizeFormat, loc);

  const points: ScatterPoint[] = [];
  let dropped = 0;
  for (const row of rows) {
    const x = toNumber(row[config.x]);
    const y = toNumber(row[config.y]);
    if (x === null || y === null) {
      dropped++;
      continue;
    }
    points.push({
      x,
      y,
      size: config.size ? toNumber(row[config.size]) : null,
      name: config.name ? toLabel(row[config.name], ctx.locale) : null,
      group: config.group ? toLabel(row[config.group], ctx.locale) : humanize(config.y),
      row,
    });
  }
  if (dropped > 0) warnOnce(warnings, `${dropped} row(s) without numeric x/y were skipped.`);

  const groups: string[] = [];
  for (const p of points) if (!groups.includes(p.group)) groups.push(p.group);
  if (groups.length > 3) {
    warnOnce(
      warnings,
      `${groups.length} groups in one scatter plot are hard to tell apart; consider small multiples or folding into "Other".`,
    );
  }
  if (groups.length > MAX_CATEGORICAL) {
    const keep = new Set(groups.slice(0, MAX_CATEGORICAL - 1));
    for (const p of points) if (!keep.has(p.group)) p.group = 'Other';
    groups.splice(MAX_CATEGORICAL - 1, Infinity, 'Other');
  }
  const colorOf = (g: string, i: number) => (g === 'Other' && i >= MAX_CATEGORICAL - 1 ? t.neutral : categoricalColor(t, i));

  // Bubble area ∝ value (sqrt scale on diameter).
  const [minD, maxD] = config.sizeRange ?? [8, 40];
  const sizes = points.map((p) => p.size).filter((s): s is number => s !== null && s >= 0);
  const maxSize = Math.max(0, ...sizes);
  const diameter = (s: number | null) => {
    if (!config.size || s === null || s < 0 || maxSize === 0) return config.size ? minD : 10;
    return minD + (maxD - minD) * Math.sqrt(s / maxSize);
  };

  const large = points.length > 2000;
  const legend = (config.legend ?? 'auto') === 'auto' ? groups.length >= 2 : !!config.legend;

  const series = groups.map((g, gi) => {
    const color = colorOf(g, gi);
    const data = points
      .filter((p) => p.group === g)
      .map((p) => ({
        value: [p.x, p.y, p.size],
        name: p.name ?? undefined,
        symbolSize: diameter(p.size),
      }));
    return {
      type: 'scatter',
      id: `group:${g}`,
      name: g,
      color,
      data,
      large,
      largeThreshold: 2000,
      symbol: 'circle',
      itemStyle: {
        color,
        opacity: config.size ? 0.75 : 0.9,
        borderColor: t.surface,
        borderWidth: large ? 0 : 1.5,
      },
      emphasis: { focus: 'series', scale: 1.3 },
      blur: { itemStyle: { opacity: 0.2 } },
    };
  });

  const option = {
    ...baseOption(ctx),
    color: groups.map((g, i) => colorOf(g, i)),
    grid: gridBase({ legend, zoom: false, bottom: 22 }),
    legend: legend ? legendBase(ctx, groups.map((g) => ({ name: g, icon: 'rect' }))) : { show: false },
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { value: [number, number, number | null]; name?: string; seriesName: string; color: string }) => {
        const [x, y, s] = p.value;
        let html = tooltipHeader(ctx, p.name ? `${p.name}` : p.seriesName);
        html += tooltipRow(ctx, p.color, humanize(config.x), fx(x), 'rect');
        html += tooltipRow(ctx, p.color, humanize(config.y), fy(y), 'rect');
        if (config.size) html += tooltipRow(ctx, p.color, humanize(config.size), fs(s), 'rect');
        return html;
      },
    },
    xAxis: {
      ...valueAxis(ctx, createAxisFormatter(config.xFormat, loc), { scale: !config.includeZero, showLine: true }),
      splitLine: { show: false },
      name: humanize(config.x),
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: t.inkMuted, fontSize: 11 },
    },
    yAxis: {
      ...valueAxis(ctx, createAxisFormatter(config.yFormat, loc), { scale: !config.includeZero }),
      name: humanize(config.y),
      nameTextStyle: { color: t.inkMuted, fontSize: 11, align: 'left' },
    },
    series,
  };

  const columns: TableColumn[] = [
    ...(config.name ? [{ key: config.name, header: humanize(config.name), type: 'string' as const }] : []),
    ...(config.group ? [{ key: config.group, header: humanize(config.group), type: 'string' as const }] : []),
    { key: config.x, header: humanize(config.x), type: 'number', format: config.xFormat, align: 'right' },
    { key: config.y, header: humanize(config.y), type: 'number', format: config.yFormat, align: 'right' },
    ...(config.size
      ? [{ key: config.size, header: humanize(config.size), type: 'number' as const, format: config.sizeFormat, align: 'right' as const }]
      : []),
  ];
  const tableRows = points.map((p) => {
    const row: Datum = { [config.x]: p.x, [config.y]: p.y };
    if (config.name) row[config.name] = p.name;
    if (config.group) row[config.group] = p.group;
    if (config.size) row[config.size] = p.size;
    return row;
  });

  return { option, isEmpty: points.length === 0, warnings, table: { columns, rows: tableRows } };
}
