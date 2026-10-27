import { categoricalColor, withAlpha } from '../colors';
import { niceCeil, toLabel, toNumber, toRows } from '../data';
import { createFormatter, humanize } from '../format';
import { MAX_CATEGORICAL } from '../tokens';
import type { BuildContext, ChartModel, Datum, TableColumn, ValueFormat } from '../types';
import { baseOption, legendBase, tooltipBase, tooltipHeader, tooltipRow, warnOnce } from './common';

export interface RadarIndicator {
  key: string;
  name?: string;
  max?: number;
  min?: number;
}

export interface RadarConfig {
  data: unknown;
  /** Field naming each entity (one polygon per row). */
  name: string;
  /** Axes of the radar. */
  indicators: (string | RadarIndicator)[];
  format?: ValueFormat;
  legend?: boolean | 'auto';
}

export function buildRadar(config: RadarConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const rows = toRows(config.data).slice(0, MAX_CATEGORICAL);
  if (toRows(config.data).length > MAX_CATEGORICAL) {
    warnOnce(warnings, `Radar charts show at most ${MAX_CATEGORICAL} entities; the rest were dropped.`);
  }
  if (rows.length > 3) warnOnce(warnings, 'More than 3 overlapping radar shapes are hard to read; consider small multiples.');
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });

  const indicators = config.indicators.map((i) => (typeof i === 'string' ? { key: i } : i));
  const names = rows.map((r) => toLabel(r[config.name], ctx.locale));
  const matrix = rows.map((r) => indicators.map((ind) => toNumber(r[ind.key])));

  const axis = indicators.map((ind, k) => {
    const col = matrix.map((m) => m[k]).filter((v): v is number => v !== null);
    const dataMin = Math.min(0, ...col);
    return {
      name: ind.name ?? humanize(ind.key),
      max: ind.max ?? niceCeil(Math.max(...col, 0)),
      min: ind.min ?? (dataMin < 0 ? -niceCeil(-dataMin) : 0),
    };
  });

  const colors = names.map((_, i) => categoricalColor(t, i));
  const legend = (config.legend ?? 'auto') === 'auto' ? names.length >= 2 : !!config.legend;
  const isEmpty = rows.length === 0 || indicators.length < 3 || matrix.every((m) => m.every((v) => v === null));
  if (indicators.length < 3) warnOnce(warnings, 'A radar chart needs at least 3 indicators.');

  const option = {
    ...baseOption(ctx),
    color: colors,
    legend: legend ? legendBase(ctx, names.map((name) => ({ name, icon: 'line' }))) : { show: false },
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { name: string; dataIndex: number; color: string }) => {
        const values = matrix[p.dataIndex] ?? [];
        return (
          tooltipHeader(ctx, p.name) +
          axis.map((a, k) => tooltipRow(ctx, colors[p.dataIndex] ?? p.color, a.name, fmt(values[k]), 'line')).join('')
        );
      },
    },
    radar: {
      indicator: axis,
      shape: 'polygon',
      radius: '66%',
      center: ['50%', legend ? '56%' : '52%'],
      splitNumber: 4,
      axisName: { color: t.inkSecondary, fontSize: 11, fontFamily: ctx.fontFamily },
      splitLine: { lineStyle: { color: t.grid, width: 1 } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: t.grid, width: 1 } },
    },
    series: [
      {
        type: 'radar',
        id: 'radar',
        symbol: 'circle',
        symbolSize: 8,
        emphasis: { focus: 'self' },
        data: names.map((name, i) => ({
          name,
          // Missing values sit on the minimum ring rather than breaking the polygon.
          value: matrix[i]!.map((v, k) => v ?? axis[k]!.min),
          lineStyle: { color: colors[i], width: 2 },
          itemStyle: { color: colors[i], borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: withAlpha(colors[i]!, 0.1) },
        })),
      },
    ],
  };

  const columns: TableColumn[] = [
    { key: config.name, header: humanize(config.name), type: 'string' },
    ...indicators.map<TableColumn>((ind, k) => ({
      key: ind.key,
      header: axis[k]!.name,
      type: 'number',
      format: config.format,
      align: 'right',
    })),
  ];
  const tableRows = names.map((name, i) => {
    const row: Datum = { [config.name]: name };
    indicators.forEach((ind, k) => (row[ind.key] = matrix[i]![k]));
    return row;
  });

  return { option, isEmpty, warnings, table: { columns, rows: tableRows } };
}
