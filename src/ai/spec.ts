import { toNumber, toRows } from '../core/data';
import type { Datum, FormatKind, FormatOptions } from '../core/types';
import { findColumn, type ColumnProfile, type DataProfile, type TimeGrain } from './profile';
import { applyTransform, type AggregateOp, type TimeUnit, type TransformSpec } from './transform';

export const CHART_KINDS = [
  'line',
  'area',
  'stacked-area',
  'bar',
  'horizontal-bar',
  'stacked-bar',
  'percent-bar',
  'donut',
  'pie',
  'scatter',
  'bubble',
  'heatmap',
  'radar',
  'funnel',
  'treemap',
  'sankey',
  'waterfall',
  'stat',
  'table',
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

const AGGREGATES = ['none', 'sum', 'avg', 'count', 'min', 'max'] as const;
const TIME_UNITS = ['none', 'day', 'week', 'month', 'quarter', 'year'] as const;
const SORTS = ['none', 'asc', 'desc'] as const;
const FORMATS = ['auto', 'number', 'integer', 'compact', 'currency', 'currency-compact', 'percent'] as const;

/**
 * One way to view a dataset: a chart type plus which columns it uses and how
 * rows are aggregated. Flat and fully declarative, so the same shape works as
 * the AI's answer format and as rule-based output.
 */
export interface ChartSpec {
  chart: ChartKind;
  title: string;
  /** One sentence telling the user why this view fits. */
  reason: string;
  /** Main dimension: the time/category axis, pie labels, scatter x, sankey source… */
  x: string;
  /** Measures (numeric columns). Empty with `aggregate: 'count'` to count rows. */
  y: string[];
  /** Second dimension: series split, heatmap rows, treemap children, sankey target, scatter color. */
  splitBy: string;
  /** Bubble size measure. */
  size: string;
  aggregate: (typeof AGGREGATES)[number];
  timeUnit: (typeof TIME_UNITS)[number];
  sort: (typeof SORTS)[number];
  /** Top-N categories (0 = all). */
  limit: number;
  /** Keep only the last N time units (0 = all data). */
  lastPeriods: number;
  format: (typeof FORMATS)[number];
  /** Where the suggestion came from. */
  source?: 'ai' | 'rules';
}

/**
 * JSON Schema for the AI's answer. Every property is required and nothing is
 * nullable ("" / [] / 0 / "none" mean "not used"), which keeps it inside the
 * strictest structured-output limits shared by Gemini, OpenAI and Claude.
 */
export function advisorResponseSchema(): Record<string, unknown> {
  const str = (description: string) => ({ type: 'string', description });
  const suggestion = {
    type: 'object',
    additionalProperties: false,
    required: ['chart', 'title', 'reason', 'x', 'y', 'splitBy', 'size', 'aggregate', 'timeUnit', 'sort', 'limit', 'lastPeriods', 'format'],
    properties: {
      chart: { type: 'string', enum: [...CHART_KINDS] },
      title: str('Short chart title in sentence case, under 60 characters.'),
      reason: str('One short sentence telling the user why this view fits the data.'),
      x: str('Main dimension column name, exactly as in the profile. "" if unused.'),
      y: { type: 'array', items: { type: 'string' }, description: 'Numeric measure column names. [] when aggregate is "count".' },
      splitBy: str('Second dimension column name, or "".'),
      size: str('Bubble size column name (bubble charts only), or "".'),
      aggregate: { type: 'string', enum: [...AGGREGATES] },
      timeUnit: { type: 'string', enum: [...TIME_UNITS] },
      sort: { type: 'string', enum: [...SORTS] },
      limit: { type: 'integer', description: 'Keep the top N categories; 0 for all.' },
      lastPeriods: { type: 'integer', description: 'Keep only the last N time units; 0 for all data.' },
      format: { type: 'string', enum: [...FORMATS] },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: { suggestions: { type: 'array', items: suggestion } },
  };
}

export interface ValidationResult {
  spec: ChartSpec | null;
  issues: string[];
}

const DIMENSION_KINDS = new Set(['category', 'boolean', 'date']);
const isDimension = (c?: ColumnProfile) => !!c && (DIMENSION_KINDS.has(c.kind) || (c.kind === 'number' && c.integer === true && c.distinct <= 40));
const isMeasure = (c?: ColumnProfile) => !!c && c.kind === 'number';
const nonNegative = (c?: ColumnProfile) => !c || c.hasNegative !== true;

function pickEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

function clampInt(value: unknown, max: number): number {
  const n = toNumber(value);
  return n === null ? 0 : Math.min(max, Math.max(0, Math.floor(n)));
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Natural time unit for a date column: aim for roughly 12–60 points. */
export function pickTimeUnit(col: ColumnProfile | undefined): TimeUnit {
  if (!col || col.kind !== 'date') return 'month';
  const grainUnit: Record<TimeGrain, TimeUnit> = { year: 'year', month: 'month', day: 'day', hour: 'day', minute: 'day' };
  const finest = grainUnit[col.grain ?? 'day'];
  if (!col.start || !col.end) return finest;
  const days = (new Date(col.end).getTime() - new Date(col.start).getTime()) / 86_400_000;
  const order: TimeUnit[] = ['day', 'week', 'month', 'quarter', 'year'];
  const size: Record<TimeUnit, number> = { day: 1, week: 7, month: 30.4, quarter: 91, year: 365 };
  for (const unit of order.slice(order.indexOf(finest))) {
    if (days / size[unit] <= 90) return unit;
  }
  return 'year';
}

/**
 * Normalizes any object (e.g. an AI answer) into a valid {@link ChartSpec}
 * for this data — or rejects it. Unknown columns are dropped, enum casing is
 * fixed, impossible combinations are repaired (pie with negatives → bar) or
 * refused (scatter without two numeric columns).
 */
export function validateSpec(raw: unknown, profile: DataProfile): ValidationResult {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { spec: null, issues: ['Not an object.'] };
  const r = raw as Record<string, unknown>;
  let chart = pickEnum(r.chart, CHART_KINDS, 'table');
  if (typeof r.chart !== 'string' || !(CHART_KINDS as readonly string[]).includes(r.chart.trim().toLowerCase())) {
    issues.push(`Unknown chart type "${String(r.chart)}".`);
    return { spec: null, issues };
  }

  const column = (value: unknown, label: string): ColumnProfile | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const c = findColumn(profile, value.trim());
    if (!c) issues.push(`Unknown ${label} column "${value}".`);
    return c;
  };

  const xCol = column(r.x, 'x');
  let splitCol = column(r.splitBy, 'splitBy');
  const sizeCol = column(r.size, 'size');
  const yCols = (Array.isArray(r.y) ? r.y : typeof r.y === 'string' ? [r.y] : [])
    .map((v) => column(v, 'y'))
    .filter((c): c is ColumnProfile => {
      if (!c) return false;
      if (!isMeasure(c)) issues.push(`"${c.name}" is not numeric, so it can't be a measure.`);
      return isMeasure(c);
    })
    .filter((c, i, all) => all.findIndex((o) => o.name === c.name) === i);
  if (splitCol && xCol && splitCol.name === xCol.name) splitCol = undefined;

  let aggregate = pickEnum(r.aggregate, AGGREGATES, 'none');
  let timeUnit = pickEnum(r.timeUnit, TIME_UNITS, 'none');
  if (yCols.length === 0 && chart !== 'table' && chart !== 'scatter' && chart !== 'bubble') {
    aggregate = 'count';
  }
  const measure = yCols[0];
  const reject = (why: string): ValidationResult => ({ spec: null, issues: [...issues, why] });

  switch (chart) {
    case 'line':
    case 'area':
    case 'stacked-area':
      if (!xCol) return reject('A trend chart needs an x column.');
      if (xCol.kind !== 'date' && xCol.kind !== 'number') {
        issues.push('Trend charts need dates or numbers on x; using a bar chart.');
        chart = 'bar';
      }
      break;
    case 'bar':
    case 'horizontal-bar':
    case 'stacked-bar':
    case 'percent-bar':
    case 'waterfall':
      if (!xCol) return reject('A bar chart needs an x column.');
      if ((chart === 'stacked-bar' || chart === 'percent-bar') && !splitCol && yCols.length < 2) chart = 'bar';
      break;
    case 'pie':
    case 'donut':
    case 'funnel':
    case 'treemap':
      if (!xCol || xCol.kind === 'number') return reject(`A ${chart} chart needs a category column.`);
      if (aggregate !== 'count' && !nonNegative(measure)) {
        issues.push(`"${measure?.name}" has negative values; using a bar chart.`);
        chart = 'bar';
      }
      break;
    case 'heatmap':
    case 'sankey':
      if (!xCol || !splitCol) return reject(`A ${chart} needs two dimension columns.`);
      if (chart === 'sankey' && aggregate !== 'count' && !nonNegative(measure)) return reject('Sankey flows must be non-negative.');
      break;
    case 'scatter':
    case 'bubble':
      if (!isMeasure(xCol) || !measure) return reject('A scatter plot needs two numeric columns.');
      if (chart === 'bubble' && !isMeasure(sizeCol)) chart = 'scatter';
      if (splitCol && !isDimension(splitCol)) splitCol = undefined;
      aggregate = 'none';
      timeUnit = 'none';
      break;
    case 'radar':
      if (!xCol || yCols.length < 3) return reject('A radar chart needs a name column and at least 3 measures.');
      break;
    case 'stat':
      if (!measure && aggregate !== 'count') return reject('A KPI needs a measure.');
      break;
    case 'table':
      break;
  }

  // Time handling only applies to date x axes.
  if (xCol?.kind !== 'date') timeUnit = 'none';
  else if (timeUnit === 'none' && xCol.distinct < (profile.rowCount || 0) && chart !== 'table') {
    timeUnit = pickTimeUnit(xCol);
  }

  // Raw rows with repeated x values must be aggregated for one point per x.
  const needsGroups = !['scatter', 'bubble', 'table', 'stat'].includes(chart);
  const repeated = !!xCol && xCol.distinct < profile.rowCount;
  if (needsGroups && aggregate === 'none' && (repeated || timeUnit !== 'none' || splitCol)) {
    aggregate = measure ? 'sum' : 'count';
  }
  if (chart === 'stat' && aggregate === 'none') aggregate = measure ? 'sum' : 'count';

  const spec: ChartSpec = {
    chart,
    title: cleanText(r.title, 80) || defaultTitle(chart, xCol, measure, aggregate),
    reason: cleanText(r.reason, 160),
    x: xCol?.name ?? '',
    y: aggregate === 'count' ? [] : yCols.slice(0, chart === 'radar' ? 8 : 4).map((c) => c.name),
    splitBy: splitCol && (isDimension(splitCol) || chart === 'heatmap' || chart === 'sankey') ? splitCol.name : '',
    size: chart === 'bubble' && sizeCol ? sizeCol.name : '',
    aggregate,
    timeUnit,
    sort: pickEnum(r.sort, SORTS, 'none'),
    limit: clampInt(r.limit, 100),
    lastPeriods: xCol?.kind === 'date' ? clampInt(r.lastPeriods, 1000) : 0,
    format: pickEnum(r.format, FORMATS, 'auto'),
    ...(r.source === 'ai' || r.source === 'rules' ? { source: r.source } : {}),
  };
  return { spec, issues };
}

const AGG_LABEL: Record<string, string> = { sum: 'Total', avg: 'Average', min: 'Minimum', max: 'Maximum', count: 'Number of rows' };

function defaultTitle(chart: ChartKind, x?: ColumnProfile, measure?: ColumnProfile, aggregate?: string): string {
  const what = aggregate === 'count' ? 'Rows' : measure ? measure.name : 'Values';
  if (chart === 'stat') return `${AGG_LABEL[aggregate ?? 'sum'] ?? 'Total'} ${measure?.name ?? 'rows'}`;
  return x ? `${what} by ${x.name}` : what;
}

/** Identity of a view, for de-duplicating suggestions and remembering choices. */
export function specKey(spec: ChartSpec): string {
  return [spec.chart, spec.x, spec.y.join('+'), spec.splitBy, spec.size, spec.aggregate, spec.timeUnit, spec.lastPeriods, spec.limit].join('|');
}

const PIVOT_CHARTS = new Set<ChartKind>(['line', 'area', 'stacked-area', 'bar', 'horizontal-bar', 'stacked-bar', 'percent-bar']);

/** Turns a spec into the reshaping steps it needs. */
export function specToTransform(spec: ChartSpec): TransformSpec | null {
  const t: TransformSpec = {};
  const op = spec.aggregate === 'none' ? null : (spec.aggregate as AggregateOp);
  const unit = spec.timeUnit === 'none' ? null : spec.timeUnit;
  if (spec.lastPeriods > 0 && spec.x && unit) t.last = { field: spec.x, n: spec.lastPeriods, unit };
  if (unit && spec.x) t.timeBucket = { field: spec.x, unit };

  if (op) {
    t.measures = op === 'count' ? [{ field: '*', op: 'count', as: 'count' }] : spec.y.map((field) => ({ field, op }));
    if (spec.chart !== 'stat') t.groupBy = [spec.x, spec.splitBy].filter(Boolean);
  }
  const value = op === 'count' ? 'count' : spec.y[0];
  const timeAxis = !!unit;

  if (spec.limit > 0 && spec.x && value && !timeAxis && spec.chart !== 'scatter' && spec.chart !== 'bubble') {
    t.topN = { field: spec.x, n: spec.limit, by: value, other: spec.chart === 'pie' || spec.chart === 'donut' || spec.chart === 'treemap' };
  }
  if (spec.splitBy && value && PIVOT_CHARTS.has(spec.chart) && op) {
    t.pivot = { field: spec.splitBy, value, maxSeries: 8 };
  }
  if (timeAxis && spec.x) t.sort = { field: spec.x, direction: 'asc' };
  else if (spec.sort !== 'none' && value && !t.pivot) t.sort = { field: value, direction: spec.sort };
  return Object.keys(t).length > 0 ? t : null;
}

function resolveFormat(spec: ChartSpec, profile: DataProfile): FormatKind | FormatOptions {
  if (spec.format !== 'auto') return spec.format;
  if (spec.aggregate === 'count') return 'integer';
  const col = findColumn(profile, spec.y[0]);
  if (col?.unit === 'currency') return 'currency';
  if (col?.unit === 'fraction' && spec.aggregate !== 'sum') return 'percent';
  if (col?.unit === 'percent' && spec.aggregate !== 'sum') return { type: 'percent', percentInput: 'whole' };
  if (col?.integer && spec.aggregate !== 'avg') return 'integer';
  return 'number';
}

export type ComponentName =
  | 'LineChart'
  | 'AreaChart'
  | 'BarChart'
  | 'PieChart'
  | 'DonutChart'
  | 'ScatterChart'
  | 'HeatmapChart'
  | 'RadarChart'
  | 'FunnelChart'
  | 'TreemapChart'
  | 'SankeyChart'
  | 'WaterfallChart'
  | 'StatCard'
  | 'DataTable';

export interface CompiledView {
  component: ComponentName;
  /** Props for the component, excluding data. */
  props: Record<string, unknown>;
  data: Datum[];
  notes: string[];
}

/**
 * Turns a validated spec plus the full rows into a ready-to-render view:
 * which component to use, its props, and the reshaped data.
 */
export function compileSpec(spec: ChartSpec, input: unknown, profile: DataProfile): CompiledView {
  const transform = specToTransform(spec);
  const result = transform ? applyTransform(input, transform) : { rows: toRows(input), notes: [] as string[] };
  const rows = result.rows;
  const format = resolveFormat(spec, profile);
  const value = spec.aggregate === 'count' ? 'count' : (spec.y[0] ?? '');
  const series = result.series ?? (spec.aggregate === 'count' ? ['count'] : spec.y);
  const seriesSpecs = series.map((key) => ({ key, name: key === 'count' ? 'Rows' : undefined }));
  const out = (component: ComponentName, props: Record<string, unknown>): CompiledView => ({ component, props, data: rows, notes: result.notes });

  switch (spec.chart) {
    case 'line':
      return out('LineChart', { x: spec.x, series: seriesSpecs, format });
    case 'area':
      return out('AreaChart', { x: spec.x, series: seriesSpecs, format });
    case 'stacked-area':
      return out('AreaChart', { x: spec.x, series: seriesSpecs, format, stacked: true });
    case 'bar':
      return out('BarChart', { x: spec.x, series: seriesSpecs, format });
    case 'horizontal-bar':
      return out('BarChart', { x: spec.x, series: seriesSpecs, format, horizontal: true });
    case 'stacked-bar':
      return out('BarChart', { x: spec.x, series: seriesSpecs, format, stacked: true });
    case 'percent-bar':
      return out('BarChart', { x: spec.x, series: seriesSpecs, format, stacked: 'percent' });
    case 'pie':
      return out('PieChart', { label: spec.x, value, format });
    case 'donut':
      return out('DonutChart', { label: spec.x, value, format });
    case 'scatter':
    case 'bubble':
      return out('ScatterChart', {
        x: spec.x,
        y: spec.y[0],
        ...(spec.size ? { size: spec.size } : {}),
        ...(spec.splitBy ? { group: spec.splitBy } : {}),
        yFormat: format,
      });
    case 'heatmap':
      return out('HeatmapChart', { x: spec.x, y: spec.splitBy, value, format });
    case 'radar':
      return out('RadarChart', { name: spec.x, indicators: spec.y, format });
    case 'funnel':
      return out('FunnelChart', { stage: spec.x, value, format });
    case 'treemap':
      return out('TreemapChart', { path: [spec.x, spec.splitBy].filter(Boolean), value, format });
    case 'sankey':
      return out('SankeyChart', { source: spec.x, target: spec.splitBy, value, format });
    case 'waterfall':
      return out('WaterfallChart', { x: spec.x, value, format });
    case 'stat': {
      const total = rows.length > 0 ? toNumber(rows[0]![value]) : null;
      return out('StatCard', { label: spec.title, value: total, format });
    }
    case 'table':
    default:
      return out('DataTable', {});
  }
}
