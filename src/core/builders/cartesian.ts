import { categoricalColor, inkOn, withAlpha } from '../colors';
import {
  createDateLabeler,
  parseDate,
  resolveSeries,
  resolveXType,
  toLabel,
  toNumber,
  toRows,
} from '../data';
import { createAxisFormatter, createFormatter, createLabelFormatter, humanize } from '../format';
import { MAX_CATEGORICAL } from '../tokens';
import type {
  BuildContext,
  ChartModel,
  Datum,
  LabelMode,
  SeriesInput,
  SeriesSpec,
  TableColumn,
  ValueFormat,
  XType,
} from '../types';
import {
  baseOption,
  categoryAxis,
  dataZoom,
  gridBase,
  legendBase,
  timeAxis,
  tooltipBase,
  tooltipHeader,
  tooltipRow,
  valueAxis,
  warnOnce,
} from './common';

export interface ReferenceLine {
  value: number;
  label?: string;
}

export interface CartesianConfig {
  /** Rows from your API (or an envelope like `{ data: [...] }`). */
  data: unknown;
  /** Field holding the x value (category, date or number). */
  x: string;
  /** Series to plot. Omit to plot every numeric field. */
  series?: SeriesInput[];
  /** How to treat x. `auto` detects dates. */
  xType?: XType;
  /** Default value format for every series. */
  format?: ValueFormat;
  /** Custom category label for x values. */
  xLabel?: (value: unknown) => string;
  /** Stack series; `'percent'` stacks to 100%. */
  stacked?: boolean | 'percent';
  /** Bars only: draw horizontally. */
  horizontal?: boolean;
  /** Lines/areas only: smooth the curve. */
  smooth?: boolean;
  /** Lines/areas only: bridge missing values instead of showing a gap. Default false (honest gaps). */
  connectNulls?: boolean;
  /** Direct value labels. `auto` labels sparingly (bar tips, line ends) when it won't clutter. */
  labels?: LabelMode;
  /** Emphasize one series by key; the rest turn gray. */
  highlight?: string;
  /** Zoom & pan controls. `auto` enables them for long series. */
  zoom?: boolean | 'auto';
  /** Legend. `auto` shows it for two or more series. */
  legend?: boolean | 'auto';
  yMin?: number;
  yMax?: number;
  /** Lines/areas: force the value axis to include zero. Default true. Bars always include zero. */
  includeZero?: boolean;
  /** Dashed target / threshold lines. */
  referenceLines?: ReferenceLine[];
  /** Bars on a category axis: sort by total value. */
  sort?: 'none' | 'asc' | 'desc';
  /** Lines/areas: draw point markers. `auto` shows them for short series. */
  showPoints?: boolean | 'auto';
}

export type CartesianKind = 'line' | 'area' | 'bar' | 'combo';

interface Point {
  /** Value placed on the x axis (timestamp, number or category label). */
  x: number | string;
  label: string;
  /** Value written to tables/exports. */
  tableX: unknown;
  row: Datum;
}

const BAR_RADIUS = 4;

function radiusFor(value: number, horizontal: boolean): number[] {
  if (value >= 0) return horizontal ? [0, BAR_RADIUS, BAR_RADIUS, 0] : [BAR_RADIUS, BAR_RADIUS, 0, 0];
  return horizontal ? [BAR_RADIUS, 0, 0, BAR_RADIUS] : [0, 0, BAR_RADIUS, BAR_RADIUS];
}

export function buildCartesian(kind: CartesianKind, config: CartesianConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const rows = toRows(config.data);
  const x = config.x;
  const specs = resolveSeries(config.series, rows, [x]);
  const horizontal = kind === 'bar' && !!config.horizontal;
  const percent = config.stacked === 'percent';
  const stacked = !!config.stacked;
  const loc = { locale: ctx.locale, currency: ctx.currency };

  if (specs.length > MAX_CATEGORICAL) {
    warnOnce(
      warnings,
      `${specs.length} series exceed the ${MAX_CATEGORICAL}-color palette; extra series are drawn in neutral gray. Consider small multiples or an "Other" series.`,
    );
  }

  // ---- x values -----------------------------------------------------------
  let xType = resolveXType(rows, x, config.xType);
  const barLike = kind === 'bar' || kind === 'combo';
  // Bars need discrete bands: dates become chronologically sorted categories.
  const timeAsCategory = barLike && xType === 'time';
  if (barLike && xType === 'value') xType = 'category';

  let points: Point[] = [];
  let dropped = 0;
  if (xType === 'time') {
    const parsed: { date: Date; row: Datum }[] = [];
    for (const row of rows) {
      const date = parseDate(row[x]);
      if (date) parsed.push({ date, row });
      else dropped++;
    }
    parsed.sort((a, b) => a.date.getTime() - b.date.getTime());
    const label = createDateLabeler(
      parsed.map((p) => p.date),
      ctx.locale,
    );
    points = parsed.map(({ date, row }) => ({
      x: timeAsCategory ? label(date) : date.getTime(),
      label: config.xLabel ? config.xLabel(row[x]) : label(date),
      tableX: date,
      row,
    }));
    if (timeAsCategory && config.xLabel) points.forEach((p) => (p.x = p.label));
  } else if (xType === 'value') {
    const parsed: { n: number; row: Datum }[] = [];
    for (const row of rows) {
      const n = toNumber(row[x]);
      if (n === null) dropped++;
      else parsed.push({ n, row });
    }
    parsed.sort((a, b) => a.n - b.n);
    points = parsed.map(({ n, row }) => ({
      x: n,
      label: config.xLabel ? config.xLabel(row[x]) : String(n),
      tableX: n,
      row,
    }));
  } else {
    points = rows.map((row) => {
      const label = config.xLabel ? config.xLabel(row[x]) : toLabel(row[x], ctx.locale);
      return { x: label, label, tableX: label, row };
    });
  }
  if (dropped > 0) {
    warnOnce(warnings, `${dropped} row(s) had an invalid "${x}" value and were skipped.`);
  }

  // ---- values -------------------------------------------------------------
  let values = specs.map((s) => points.map((p) => toNumber(p.row[s.key])));

  if (barLike && xType === 'category' && !timeAsCategory && config.sort && config.sort !== 'none') {
    const totals = points.map((_, j) => values.reduce((sum, col) => sum + (col[j] ?? 0), 0));
    const order = points.map((_, j) => j).sort((a, b) => (config.sort === 'asc' ? totals[a]! - totals[b]! : totals[b]! - totals[a]!));
    points = order.map((j) => points[j]!);
    values = values.map((col) => order.map((j) => col[j]!));
  }

  const n = points.length;
  const isEmpty = n === 0 || specs.length === 0 || values.every((col) => col.every((v) => v === null));

  const shareTotals = percent
    ? points.map((_, j) => values.reduce((sum, col) => sum + Math.abs(col[j] ?? 0), 0))
    : [];
  const plotted = percent
    ? values.map((col) =>
        col.map((v, j) => (v === null || shareTotals[j] === 0 ? null : (v / shareTotals[j]!) * 100)),
      )
    : values;

  // ---- colors & formatters -----------------------------------------------
  const colors = specs.map((s, i) => {
    const own = categoricalColor(t, i, s.color);
    if (config.highlight && s.key !== config.highlight) return t.deemphasis;
    return own;
  });
  const formatters = specs.map((s) => createFormatter(s.format ?? config.format, loc));
  // Direct labels are compact ("$1.3M"); tooltips and tables keep full precision.
  const labelFormatters = specs.map((s) => createLabelFormatter(s.format ?? config.format, loc));
  const axisFormatter = percent
    ? (v: number) => `${Math.round(v)}%`
    : createAxisFormatter(config.format ?? specs[0]?.format, loc);

  const seriesTypes = specs.map((s, i): 'bar' | 'line' =>
    kind === 'combo' ? (s.type ?? (i === 0 ? 'bar' : 'line')) : kind === 'bar' ? 'bar' : 'line',
  );
  const barCount = seriesTypes.filter((st) => st === 'bar').length;
  const stackIdFor = (s: SeriesSpec) => (stacked ? (s.stack ?? 'total') : s.stack);

  // Which series sits at the outer end of each stack, per category (for rounded data-ends).
  const outerPositive: Map<string, number>[] = [];
  const outerNegative: Map<string, number>[] = [];
  for (let j = 0; j < n; j++) {
    const pos = new Map<string, number>();
    const neg = new Map<string, number>();
    specs.forEach((s, i) => {
      const stack = stackIdFor(s);
      if (!stack || seriesTypes[i] !== 'bar') return;
      const v = values[i]![j];
      if (v === null || v === undefined || v === 0) return;
      (v > 0 ? pos : neg).set(stack, i);
    });
    outerPositive.push(pos);
    outerNegative.push(neg);
  }

  // Max absolute stack height — used to decide if an inside label fits.
  const maxStack = Math.max(
    1e-9,
    ...points.map((_, j) =>
      stacked
        ? plotted.reduce((sum, col) => sum + Math.abs(col[j] ?? 0), 0)
        : Math.max(0, ...plotted.map((col) => Math.abs(col[j] ?? 0))),
    ),
  );

  const labels = config.labels ?? 'auto';
  const showPoints =
    config.showPoints === undefined || config.showPoints === 'auto' ? n <= 24 : config.showPoints;

  // ---- line end labels: only when they won't collide ------------------------
  const lineIdx = seriesTypes.map((st, i) => (st === 'line' ? i : -1)).filter((i) => i >= 0);
  let endLabels = false;
  if (labels === 'auto' && kind !== 'combo' && !percent && lineIdx.length > 0 && lineIdx.length <= 4 && n >= 2 && !horizontal) {
    const positions: number[] = [];
    let running = 0;
    for (const i of lineIdx) {
      const col = plotted[i]!;
      let last: number | null = null;
      for (let j = n - 1; j >= 0; j--) {
        if (col[j] !== null && col[j] !== undefined) {
          last = j === n - 1 ? col[j]! : null;
          break;
        }
      }
      if (last === null) {
        positions.length = 0;
        break;
      }
      running = stacked ? running + last : last;
      positions.push(running);
    }
    const all = plotted.flat().filter((v): v is number => v !== null);
    const range = Math.max(...all, 0) - Math.min(...all, 0) || 1;
    const sorted = [...positions].sort((a, b) => a - b);
    const minGap = sorted.reduce((gap, v, i) => (i === 0 ? gap : Math.min(gap, v - sorted[i - 1]!)), Infinity);
    endLabels = positions.length === lineIdx.length && minGap / range > 0.07;
  }

  const barLabelsAuto = labels === 'auto' && kind === 'bar' && specs.length === 1 && n <= 20;
  const barLabelsAll = labels === 'all';

  // ---- series -------------------------------------------------------------
  const timeOrValueX = xType === 'time' && !timeAsCategory ? true : xType === 'value';
  const referenceLines = (config.referenceLines ?? []).filter((r) => Number.isFinite(r.value));

  const series = specs.map((s, i) => {
    const color = colors[i]!;
    const type = seriesTypes[i]!;
    const stack = stackIdFor(s);
    const fmt = formatters[i]!;
    const short = labelFormatters[i]!;
    const emphasized = !config.highlight || s.key === config.highlight;

    const datum = (j: number): unknown => {
      const v = plotted[i]![j];
      return timeOrValueX ? [points[j]!.x, v ?? null] : (v ?? null);
    };

    const common = {
      id: s.key,
      name: s.name,
      color,
      stack,
      stackStrategy: 'samesign' as const,
      z: emphasized ? 3 : 2,
      markLine:
        i === 0 && referenceLines.length > 0
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: t.inkMuted, type: 'dashed', width: 1 },
              label: {
                color: t.inkSecondary,
                fontSize: 11,
                position: 'insideEndTop',
                formatter: (p: { value: number; name?: string }) => p.name || fmt(p.value),
              },
              emphasis: { disabled: true },
              data: referenceLines.map((r) =>
                horizontal ? { xAxis: r.value, name: r.label ?? '' } : { yAxis: r.value, name: r.label ?? '' },
              ),
            }
          : undefined,
    };

    if (type === 'line') {
      const area = kind === 'area';
      return {
        ...common,
        type: 'line',
        data: points.map((_, j) => datum(j)),
        smooth: config.smooth ? 0.25 : false,
        connectNulls: config.connectNulls ?? false,
        showSymbol: showPoints || n === 1 || kind === 'combo',
        symbol: 'circle',
        symbolSize: 8,
        sampling: n > 1000 ? 'lttb' : undefined,
        lineStyle: { width: 2, cap: 'round', join: 'round', color },
        itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: specs.length > 1 ? 'series' : 'none', lineStyle: { width: 2 } },
        areaStyle: area
          ? stacked
            ? { color: withAlpha(color, 0.22), opacity: color.startsWith('#') ? 1 : 0.22 }
            : {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: withAlpha(color, emphasized ? 0.2 : 0.06) },
                    { offset: 1, color: withAlpha(color, 0.01) },
                  ],
                },
              }
          : undefined,
        endLabel: endLabels
          ? {
              show: true,
              color: t.inkSecondary,
              fontSize: 11,
              distance: 6,
              formatter: (p: { value: unknown }) => short(Array.isArray(p.value) ? toNumber(p.value[1]) : toNumber(p.value)),
            }
          : undefined,
        label:
          labels === 'all'
            ? {
                show: true,
                position: 'top',
                color: t.inkSecondary,
                fontSize: 11,
                formatter: (p: { value: unknown; dataIndex: number }) => short(values[i]![p.dataIndex]),
              }
            : undefined,
        labelLayout: labels === 'all' ? { hideOverlap: true } : undefined,
      };
    }

    // ---- bar ----
    const touching = stacked || (barCount > 1 && !stack);
    const data = points.map((_, j) => {
      const raw = values[i]![j];
      const v = plotted[i]![j];
      if (v === null || v === undefined || raw === null || raw === undefined) return { value: null };
      const isOuter = !stack
        ? true
        : raw > 0
          ? outerPositive[j]!.get(stack) === i
          : outerNegative[j]!.get(stack) === i;
      const item: Record<string, unknown> = {
        value: datum(j),
        itemStyle: { borderRadius: isOuter ? radiusFor(raw, horizontal) : 0 },
      };
      const insideStack = stacked && barLabelsAll;
      const showOutside = (barLabelsAuto || (barLabelsAll && !stacked)) && isOuter;
      if (insideStack) {
        const fits = Math.abs(v) / maxStack >= 0.1;
        item.label = {
          show: fits,
          position: 'inside',
          color: inkOn(color),
          formatter: () => (percent ? `${Math.round(v)}%` : short(raw)),
        };
      } else if (showOutside) {
        item.label = {
          show: true,
          position: horizontal ? (raw >= 0 ? 'right' : 'left') : raw >= 0 ? 'top' : 'bottom',
          color: t.inkSecondary,
          formatter: () => (percent ? `${Math.round(v)}%` : short(raw)),
        };
      }
      return item;
    });

    return {
      ...common,
      type: 'bar',
      data,
      barMaxWidth: 24,
      barGap: barCount > 1 && !stacked ? '0%' : undefined,
      barCategoryGap: '28%',
      large: n > 3000,
      itemStyle: {
        color,
        borderColor: t.surface,
        borderWidth: touching ? 2 : 0,
      },
      label: { fontSize: 11, fontFamily: ctx.fontFamily },
      emphasis: { focus: specs.length > 1 ? 'series' : 'none' },
      blur: { itemStyle: { opacity: 0.35 } },
    };
  });

  // ---- axes ---------------------------------------------------------------
  const refValues = referenceLines.map((r) => r.value);
  const valueBounds = {
    min: percent ? 0 : config.yMin,
    max: percent ? 100 : config.yMax,
  };
  const valueAxisOption = {
    ...valueAxis(ctx, axisFormatter, {
      min: valueBounds.min,
      max: valueBounds.max,
      scale: !barLike && config.includeZero === false,
    }),
    ...(refValues.length > 0 && valueBounds.max === undefined
      ? { max: (extent: { max: number }) => Math.max(extent.max, ...refValues) }
      : {}),
    ...(refValues.length > 0 && valueBounds.min === undefined && Math.min(...refValues) < 0
      ? { min: (extent: { min: number }) => Math.min(extent.min, ...refValues) }
      : {}),
  };

  const labelsList = points.map((p) => p.label);
  const zoomThreshold = barLike ? 50 : 500;
  const zoom = config.zoom === true || ((config.zoom ?? 'auto') === 'auto' && n > zoomThreshold);
  const timeSpan =
    xType === 'time' && !timeAsCategory && n > 1 ? (points[n - 1]!.x as number) - (points[0]!.x as number) : 0;
  const xAxisOption =
    xType === 'time' && !timeAsCategory
      ? timeAxis(ctx, { span: timeSpan, zoom })
      : xType === 'value'
        ? { ...valueAxis(ctx, createAxisFormatter(undefined, loc), { scale: true, showLine: true }), splitLine: { show: false } }
        : categoryAxis(ctx, points.map((p) => String(p.x)), {
            boundaryGap: barLike,
            inverse: horizontal,
            vertical: horizontal,
          });

  const legend = (config.legend ?? 'auto') === 'auto' ? specs.length >= 2 : !!config.legend;
  const labelHeadroom = barLabelsAuto || (barLabelsAll && !stacked);

  // ---- tooltip --------------------------------------------------------------
  type AxisParam = { seriesId?: string; dataIndex: number; axisValueLabel?: string };
  const specIndex = new Map(specs.map((s, i) => [s.key, i]));
  const tooltip = {
    ...tooltipBase(ctx, 'axis', barLike ? 'shadow' : 'line'),
    formatter: (raw: unknown) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as AxisParam[];
      if (list.length === 0) return '';
      const first = list[0]!;
      const header = labelsList[first.dataIndex] ?? first.axisValueLabel ?? '';
      let html = tooltipHeader(ctx, header);
      let total = 0;
      let counted = 0;
      for (const p of list) {
        const i = specIndex.get(p.seriesId ?? '');
        if (i === undefined) continue;
        const rawValue = values[i]![p.dataIndex] ?? null;
        const share = plotted[i]![p.dataIndex];
        const text = percent
          ? `${share === null || share === undefined ? '—' : `${share.toFixed(1)}%`} · ${formatters[i]!(rawValue)}`
          : formatters[i]!(rawValue);
        html += tooltipRow(ctx, colors[i]!, specs[i]!.name ?? specs[i]!.key, text, seriesTypes[i] === 'bar' || kind === 'area' ? 'rect' : 'line');
        if (rawValue !== null) {
          total += rawValue;
          counted++;
        }
      }
      if (stacked && specs.length > 1 && counted > 0) {
        html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${t.grid}">${tooltipRow(
          ctx,
          'transparent',
          'Total',
          formatters[0]!(total),
        )}</div>`;
      }
      return html;
    },
  };

  const option = {
    ...baseOption(ctx),
    color: colors,
    grid: gridBase({
      legend,
      zoom: zoom && !horizontal,
      right: (endLabels ? 52 : 0) + (horizontal && labelHeadroom ? 44 : 0) + (zoom && horizontal ? 28 : 0),
    }),
    legend: legend
      ? legendBase(
          ctx,
          specs.map((s, i) => ({ name: s.name ?? s.key, icon: seriesTypes[i] === 'bar' || kind === 'area' ? 'rect' : 'line' })),
        )
      : { show: false },
    tooltip,
    xAxis: horizontal ? valueAxisOption : xAxisOption,
    yAxis: horizontal
      ? xAxisOption
      : {
          ...valueAxisOption,
          ...(labelHeadroom
            ? { boundaryGap: [values.some((col) => col.some((v) => v !== null && v < 0)) ? '8%' : 0, '8%'] }
            : {}),
        },
    dataZoom: zoom ? dataZoom(ctx, horizontal ? 'vertical' : 'horizontal') : [],
    series,
  };

  // ---- table twin -----------------------------------------------------------
  const columns: TableColumn[] = [
    {
      key: x,
      header: humanize(x),
      type: xType === 'time' ? 'date' : xType === 'value' ? 'number' : 'string',
    },
    ...specs.map<TableColumn>((s) => ({
      key: s.key,
      header: s.name ?? s.key,
      type: 'number',
      format: s.format ?? config.format,
      align: 'right',
    })),
  ];
  const tableRows: Datum[] = points.map((p, j) => {
    const row: Datum = { [x]: p.tableX };
    specs.forEach((s, i) => {
      row[s.key] = values[i]![j];
    });
    return row;
  });

  return { option, table: { columns, rows: tableRows }, isEmpty, warnings };
}
