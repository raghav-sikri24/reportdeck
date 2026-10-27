import { pickSteps } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createFormatter, humanize, richSafe } from '../format';
import type { BuildContext, ChartModel, Datum, ValueFormat } from '../types';
import { baseOption, tooltipBase, tooltipHeader, tooltipRow, warnOnce } from './common';

export interface FunnelConfig {
  data: unknown;
  /** Field naming each stage. Stages keep the order given. */
  stage: string;
  value: string;
  format?: ValueFormat;
  /** Show conversion from the first stage next to each label. Default true. */
  showConversion?: boolean;
}

export function buildFunnel(config: FunnelConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const pct = createFormatter({ type: 'percent', decimals: 1 }, { locale: ctx.locale, currency: ctx.currency });

  const stages: { name: string; value: number }[] = [];
  for (const row of toRows(config.data)) {
    const v = toNumber(row[config.value]);
    if (v === null) continue;
    if (v < 0) {
      warnOnce(warnings, 'Negative funnel values were skipped.');
      continue;
    }
    stages.push({ name: toLabel(row[config.stage], ctx.locale), value: v });
  }

  const first = stages[0]?.value ?? 0;
  const max = Math.max(0, ...stages.map((s) => s.value));
  const conversion = (i: number) => (first > 0 ? stages[i]!.value / first : null);
  const stepConversion = (i: number) => (i > 0 && stages[i - 1]!.value > 0 ? stages[i]!.value / stages[i - 1]!.value : null);
  // Bigger stage → stronger step of the ordinal ramp.
  const ramp = pickSteps(t.ordinal, Math.max(stages.length, 1));
  const ranks = stages
    .map((s, i) => ({ i, v: s.value }))
    .sort((a, b) => a.v - b.v)
    .reduce<number[]>((acc, s, rank) => ((acc[s.i] = rank), acc), []);
  const showConversion = config.showConversion ?? true;

  const option = {
    ...baseOption(ctx),
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { dataIndex: number; color: string }) => {
        const i = p.dataIndex;
        const s = stages[i]!;
        let html = tooltipHeader(ctx, s.name) + tooltipRow(ctx, p.color, humanize(config.value), fmt(s.value), 'rect');
        if (i > 0) {
          html += tooltipRow(ctx, 'transparent', 'of first stage', pct(conversion(i)));
          html += tooltipRow(ctx, 'transparent', 'of previous stage', pct(stepConversion(i)));
        }
        return html;
      },
    },
    series: [
      {
        type: 'funnel',
        id: 'funnel',
        name: humanize(config.value),
        sort: 'none',
        min: 0,
        max: max || 1,
        minSize: '2%',
        maxSize: '100%',
        left: '4%',
        top: 8,
        bottom: 8,
        width: '52%',
        gap: 2,
        funnelAlign: 'center',
        itemStyle: { borderWidth: 0 },
        label: {
          show: true,
          position: 'right',
          color: t.inkSecondary,
          fontSize: 12,
          fontFamily: ctx.fontFamily,
          width: 180,
          overflow: 'truncate',
          formatter: (p: { dataIndex: number }) => {
            const i = p.dataIndex;
            const s = stages[i]!;
            const conv = showConversion && i > 0 ? `  ·  ${pct(conversion(i))}` : '';
            return `${richSafe(s.name)}\n{v|${fmt(s.value)}}${conv}`;
          },
          rich: { v: { color: t.ink, fontWeight: 600, fontSize: 13, lineHeight: 18 } },
        },
        labelLine: { show: true, length: 24, lineStyle: { color: t.axis, width: 1 } },
        emphasis: { label: { fontSize: 12 } },
        data: stages.map((s, i) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: ramp[ranks[i] ?? 0] },
        })),
      },
    ],
  };

  const rows: Datum[] = stages.map((s, i) => ({
    [config.stage]: s.name,
    [config.value]: s.value,
    conversion: conversion(i),
    step_conversion: stepConversion(i),
  }));

  return {
    option,
    isEmpty: stages.length === 0 || max === 0,
    warnings,
    table: {
      columns: [
        { key: config.stage, header: humanize(config.stage), type: 'string' },
        { key: config.value, header: humanize(config.value), type: 'number', format: config.format, align: 'right' },
        { key: 'conversion', header: 'Of first stage', type: 'number', format: { type: 'percent', decimals: 1 }, align: 'right' },
        { key: 'step_conversion', header: 'Of previous stage', type: 'number', format: { type: 'percent', decimals: 1 }, align: 'right' },
      ],
      rows,
    },
  };
}
