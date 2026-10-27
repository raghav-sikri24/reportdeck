import { toLabel, toNumber, toRows } from '../data';
import { createAxisFormatter, createFormatter, humanize } from '../format';
import type { BuildContext, ChartModel, Datum, LabelMode, ValueFormat } from '../types';
import {
  baseOption,
  categoryAxis,
  gridBase,
  legendBase,
  tooltipBase,
  tooltipHeader,
  tooltipRow,
  valueAxis,
} from './common';

export interface WaterfallConfig {
  data: unknown;
  /** Field naming each step. */
  x: string;
  /** Field holding each step's change (positive or negative). */
  value: string;
  /** Boolean field marking subtotal rows; their bar shows the running total and their value is ignored. */
  totalKey?: string;
  /** Append a final total bar. Default true. */
  showTotal?: boolean;
  totalLabel?: string;
  format?: ValueFormat;
  labels?: LabelMode;
  colors?: { increase?: string; decrease?: string; total?: string };
}

interface Step {
  label: string;
  kind: 'increase' | 'decrease' | 'total';
  start: number;
  end: number;
  delta: number;
}

export function buildWaterfall(config: WaterfallConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const signed = createFormatter(
    typeof config.format === 'function' ? config.format : { ...(typeof config.format === 'string' ? { type: config.format } : config.format), signDisplay: 'exceptZero' },
    { locale: ctx.locale, currency: ctx.currency },
  );
  const colors = {
    increase: config.colors?.increase ?? t.diverging.positive,
    decrease: config.colors?.decrease ?? t.diverging.negative,
    total: config.colors?.total ?? t.neutral,
  };

  const steps: Step[] = [];
  let running = 0;
  for (const row of toRows(config.data)) {
    const label = toLabel(row[config.x], ctx.locale);
    const isTotal = config.totalKey ? Boolean(row[config.totalKey]) : false;
    if (isTotal) {
      steps.push({ label, kind: 'total', start: 0, end: running, delta: running });
      continue;
    }
    const delta = toNumber(row[config.value]);
    if (delta === null) continue;
    steps.push({ label, kind: delta >= 0 ? 'increase' : 'decrease', start: running, end: running + delta, delta });
    running += delta;
  }
  if ((config.showTotal ?? true) && steps.length > 0) {
    steps.push({ label: config.totalLabel ?? 'Total', kind: 'total', start: 0, end: running, delta: running });
  }

  // Floating bars via stacking: an invisible base, then up to two visible parts
  // (two only when a bar crosses zero, since stacks split by sign).
  const base: (number | null)[] = [];
  const partA: (number | null)[] = [];
  const partB: (number | null)[] = [];
  for (const s of steps) {
    const lo = Math.min(s.start, s.end);
    const hi = Math.max(s.start, s.end);
    if (lo >= 0) {
      base.push(lo);
      partA.push(hi - lo);
      partB.push(null);
    } else if (hi <= 0) {
      base.push(hi);
      partA.push(lo - hi);
      partB.push(null);
    } else {
      base.push(null);
      partA.push(hi);
      partB.push(lo);
    }
  }

  const colorOf = (s: Step) => colors[s.kind];
  const labels = config.labels ?? 'auto';
  const showLabels = labels === 'all' || (labels === 'auto' && steps.length <= 16);
  const R = 3;

  const visible = (part: (number | null)[], which: 'A' | 'B') =>
    part.map((v, i) => {
      const s = steps[i]!;
      if (v === null) return { value: null };
      const crossing = partB[i] !== null;
      const radius = crossing ? (which === 'A' ? [R, R, 0, 0] : [0, 0, R, R]) : [R, R, R, R];
      const labelOnThis = which === 'A';
      const upward = s.kind === 'total' ? s.end >= 0 : s.delta >= 0;
      return {
        value: v,
        itemStyle: { color: colorOf(s), borderRadius: radius },
        label:
          showLabels && labelOnThis
            ? {
                show: true,
                position: crossing ? 'top' : upward ? 'top' : 'bottom',
                color: t.inkSecondary,
                fontSize: 11,
                formatter: () => (s.kind === 'total' ? fmt(s.end) : signed(s.delta)),
              }
            : undefined,
      };
    });

  const stack = 'waterfall';
  const option = {
    ...baseOption(ctx),
    grid: gridBase({ legend: true, zoom: false }),
    legend: {
      ...legendBase(ctx, [
        { name: 'Increase', icon: 'rect' },
        { name: 'Decrease', icon: 'rect' },
        { name: 'Total', icon: 'rect' },
      ]),
      selectedMode: false,
    },
    tooltip: {
      ...tooltipBase(ctx, 'axis', 'shadow'),
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as { dataIndex: number }[];
        const s = steps[list[0]?.dataIndex ?? -1];
        if (!s) return '';
        let html = tooltipHeader(ctx, s.label);
        if (s.kind === 'total') {
          html += tooltipRow(ctx, colorOf(s), 'Total', fmt(s.end), 'rect');
        } else {
          html += tooltipRow(ctx, colorOf(s), 'Change', signed(s.delta), 'rect');
          html += tooltipRow(ctx, 'transparent', 'Running total', fmt(s.end));
        }
        return html;
      },
    },
    xAxis: categoryAxis(
      ctx,
      steps.map((s) => s.label),
      { boundaryGap: true },
    ),
    yAxis: {
      ...valueAxis(ctx, createAxisFormatter(config.format, { locale: ctx.locale, currency: ctx.currency })),
      // Headroom for value labels; below zero only when something actually goes negative.
      boundaryGap: [steps.some((s) => Math.min(s.start, s.end) < 0) ? '8%' : 0, '8%'],
    },
    series: [
      {
        type: 'bar',
        id: 'wf-base',
        stack,
        stackStrategy: 'samesign',
        silent: true,
        itemStyle: { color: 'transparent' },
        emphasis: { disabled: true },
        data: base,
        barMaxWidth: 32,
        tooltip: { show: false },
      },
      {
        type: 'bar',
        id: 'wf-a',
        stack,
        stackStrategy: 'samesign',
        data: visible(partA, 'A'),
        barMaxWidth: 32,
      },
      {
        type: 'bar',
        id: 'wf-b',
        stack,
        stackStrategy: 'samesign',
        data: visible(partB, 'B'),
        barMaxWidth: 32,
      },
      // Legend-only series so the legend explains the three colors.
      { type: 'bar', name: 'Increase', color: colors.increase, data: [], stack: 'legend' },
      { type: 'bar', name: 'Decrease', color: colors.decrease, data: [], stack: 'legend' },
      { type: 'bar', name: 'Total', color: colors.total, data: [], stack: 'legend' },
    ],
  };

  const rows: Datum[] = steps.map((s) => ({
    [config.x]: s.label,
    change: s.kind === 'total' ? null : s.delta,
    running_total: s.end,
    type: s.kind,
  }));

  return {
    option,
    isEmpty: steps.length === 0,
    warnings: [],
    table: {
      columns: [
        { key: config.x, header: humanize(config.x), type: 'string' },
        { key: 'change', header: 'Change', type: 'number', format: config.format, align: 'right' },
        { key: 'running_total', header: 'Running total', type: 'number', format: config.format, align: 'right' },
        { key: 'type', header: 'Type', type: 'string' },
      ],
      rows,
    },
  };
}
