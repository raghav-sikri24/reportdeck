import { humanize } from '../core/format';
import type { ColumnProfile, DataProfile } from './profile';
import { pickTimeUnit, specKey, validateSpec, type ChartKind, type ChartSpec } from './spec';
import type { TimeUnit } from './transform';

export interface RecommendOptions {
  /** Free-text request, e.g. "monthly revenue by channel last quarter". */
  question?: string;
  /** Maximum suggestions. Default 6. */
  max?: number;
}

interface Candidate {
  score: number;
  raw: Partial<ChartSpec> & { chart: ChartKind };
}

const PREFERRED_MEASURE = /revenue|sales|amount|gmv|total|value|profit|income|spend|price|count|quantity|qty|users|orders/i;
const FLOW_SOURCE = /^(source|from|origin|src)$|_source$|_from$/i;
const FLOW_TARGET = /^(target|to|destination|dest|dst)$|_target$|_to$/i;
const STAGE = /stage|step|funnel|phase/i;

const label = (c?: ColumnProfile) => (c ? humanize(c.name).toLowerCase() : '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function rankMeasures(cols: ColumnProfile[]): ColumnProfile[] {
  return [...cols].sort((a, b) => {
    const pa = PREFERRED_MEASURE.test(a.name) ? 0 : 1;
    const pb = PREFERRED_MEASURE.test(b.name) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return Math.abs(b.sum ?? 0) - Math.abs(a.sum ?? 0);
  });
}

function rankCategories(cols: ColumnProfile[]): ColumnProfile[] {
  // Prefer 2–12 distinct values; very high-cardinality dimensions read poorly.
  // Yes/no columns are the least interesting way to split data.
  const fit = (c: ColumnProfile) => (c.kind === 'boolean' ? 3 : c.distinct >= 3 && c.distinct <= 12 ? 0 : c.distinct <= 30 ? 1 : 2);
  return [...cols].filter((c) => c.distinct >= 2).sort((a, b) => fit(a) - fit(b) || a.distinct - b.distinct);
}

const KEYWORDS: [RegExp, ChartKind[], number][] = [
  [/trend|over time|monthly|weekly|daily|yearly|growth|timeline|history|per (day|week|month)/i, ['line', 'area', 'stacked-area'], 30],
  [/share|breakdown|mix|composition|proportion|split|percentage of|part of/i, ['donut', 'stacked-bar', 'percent-bar', 'stacked-area', 'treemap'], 30],
  [/compare|comparison|top|rank|largest|highest|lowest|best|worst|most|least/i, ['bar', 'horizontal-bar'], 25],
  [/correlat|relationship|versus| vs\.? |against|scatter/i, ['scatter', 'bubble'], 35],
  [/flow|journey|path|from .+ to /i, ['sankey'], 35],
  [/funnel|conversion|drop.?off|stages?/i, ['funnel'], 35],
  [/heat ?map|by hour|by weekday|day of week|hour of day|matrix/i, ['heatmap'], 30],
  [/total|overall|how much|how many|sum of|kpi/i, ['stat'], 25],
  [/hierarch|nested|treemap/i, ['treemap'], 30],
  [/bridge|waterfall|walk from/i, ['waterfall'], 35],
  [/table|list|raw|rows|details/i, ['table'], 30],
];

const UNIT_WORDS: Record<string, TimeUnit> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

/** Reads "last 3 months", "past 30 days", "last quarter" into a window. */
export function parseTimeWindow(question: string): { n: number; unit: TimeUnit } | null {
  const m = /\b(last|past|previous|recent)\s+(\d+\s+)?(day|week|month|quarter|year)s?\b/i.exec(question);
  if (!m) return null;
  return { n: m[2] ? Math.max(1, parseInt(m[2], 10)) : 1, unit: UNIT_WORDS[m[3]!.toLowerCase()]! };
}

function bucketFromQuestion(question: string): TimeUnit | null {
  const m = /\b(daily|weekly|monthly|quarterly|yearly|annual|by (day|week|month|quarter|year)|per (day|week|month|quarter|year))\b/i.exec(question);
  if (!m) return null;
  const word = (m[2] ?? m[3] ?? m[1]!).toLowerCase();
  if (word.startsWith('dai') || word === 'day') return 'day';
  if (word.startsWith('week')) return 'week';
  if (word.startsWith('month')) return 'month';
  if (word.startsWith('quarter')) return 'quarter';
  return 'year';
}

/**
 * Suggests ways to view a dataset using fixed, explainable rules — instant,
 * free and offline. The AI advisor (when configured) refines these.
 */
export function recommendCharts(profile: DataProfile, options: RecommendOptions = {}): ChartSpec[] {
  const max = Math.max(1, options.max ?? 6);
  const question = (options.question ?? '').trim();
  const cols = profile.columns;
  const dates = cols.filter((c) => c.kind === 'date' && c.distinct > 1);
  const measures = rankMeasures(cols.filter((c) => c.kind === 'number'));
  const categories = rankCategories(cols.filter((c) => c.kind === 'category' || c.kind === 'boolean'));

  // Columns the question mentions get priority.
  const mentioned = (c: ColumnProfile) => question.length > 0 && mentionPattern(c.name).test(question);
  const byMention = <T extends ColumnProfile>(list: T[]) => [...list].sort((a, b) => Number(mentioned(b)) - Number(mentioned(a)));

  const m0 = byMention(measures)[0];
  const m1 = byMention(measures)[1];
  const m2 = byMention(measures)[2];
  const d0 = byMention(dates)[0];
  const [c0, c1] = byMention(categories);
  const measureName = m0 ? label(m0) : 'rows';
  const y = m0 ? [m0.name] : [];
  const agg = m0 ? 'sum' : 'count';
  const window = question ? parseTimeWindow(question) : null;
  const askedUnit = question ? bucketFromQuestion(question) : null;
  const out: Candidate[] = [];
  const add = (score: number, raw: Candidate['raw']) => out.push({ score, raw });

  // ---- time series ----
  if (d0) {
    const wanted = askedUnit ?? (window && window.unit !== 'year' ? (window.unit === 'quarter' || window.unit === 'month' ? 'week' : 'day') : pickTimeUnit(d0));
    // Never bucket finer than the data itself (monthly data can't be shown per week).
    const timeUnit = coarser(wanted, grainUnit(d0));
    const lastPeriods = window ? Math.max(1, Math.round((window.n * unitDays(window.unit)) / unitDays(timeUnit))) : 0;
    const span = formatSpan(d0.start, d0.end);
    const base = { x: d0.name, y, aggregate: agg, timeUnit, lastPeriods } as const;
    add(m0 ? 90 : 70, {
      chart: m0 ? 'line' : 'bar',
      ...base,
      title: `${cap(measureName)} over time`,
      reason: `${m0 ? 'Shows how the total changes' : 'Shows how many rows there are'} per ${timeUnit}${span ? ` (${span})` : ''}.`,
    });
    if (c0 && c0.distinct <= 8) {
      add(80, {
        chart: 'line',
        ...base,
        splitBy: c0.name,
        title: `${cap(measureName)} over time by ${label(c0)}`,
        reason: `Compares the trend of each ${label(c0)} (${c0.distinct} values).`,
      });
      if (!m0 || m0.hasNegative !== true) {
        add(66, {
          chart: 'stacked-area',
          ...base,
          splitBy: c0.name,
          title: `${cap(measureName)} mix by ${label(c0)} over time`,
          reason: `Shows how each ${label(c0)} contributes to the total over time.`,
        });
      }
    }
    if (m0 && m1 && similarScale(m0, m1)) {
      add(68, {
        chart: 'line',
        ...base,
        y: [m0.name, m1.name],
        title: `${cap(label(m0))} and ${label(m1)} over time`,
        reason: 'Both measures share a scale, so one axis compares them honestly.',
      });
    }
  }

  // ---- categories ----
  if (c0) {
    const horizontal = c0.distinct > 8 || (c0.avgLength ?? 0) > 12;
    const topN = c0.distinct > 15 ? 12 : 0;
    add(d0 ? 72 : 88, {
      chart: horizontal ? 'horizontal-bar' : 'bar',
      x: c0.name,
      y,
      aggregate: agg,
      sort: 'desc',
      limit: topN,
      title: `${cap(measureName)} by ${label(c0)}`,
      reason: topN ? `Ranks the top ${topN} of ${c0.distinct} ${label(c0)} values.` : `Ranks each ${label(c0)} from largest to smallest.`,
    });
    if (c0.distinct >= 2 && c0.distinct <= 6 && (!m0 || m0.hasNegative !== true)) {
      add(74, {
        chart: 'donut',
        x: c0.name,
        y,
        aggregate: agg,
        title: `Share of ${measureName} by ${label(c0)}`,
        reason: `${c0.distinct} parts of one total — easy to read as shares.`,
      });
    }
    if (STAGE.test(c0.name) && c0.distinct <= 10 && (!m0 || m0.hasNegative !== true)) {
      add(92, {
        chart: 'funnel',
        x: c0.name,
        y,
        aggregate: agg,
        title: `${cap(measureName)} by ${label(c0)}`,
        reason: 'Stages in order show where volume drops off.',
      });
    }
    if (c1) {
      if (c0.distinct <= 15 && c1.distinct <= 15) {
        add(62, {
          chart: 'heatmap',
          x: c0.name,
          splitBy: c1.name,
          y,
          aggregate: agg,
          title: `${cap(measureName)} by ${label(c0)} and ${label(c1)}`,
          reason: 'Highlights which combinations stand out.',
        });
      }
      if (c1.distinct <= 6) {
        add(64, {
          chart: 'stacked-bar',
          x: c0.name,
          splitBy: c1.name,
          y,
          aggregate: agg,
          sort: 'desc',
          limit: c0.distinct > 15 ? 12 : 0,
          title: `${cap(measureName)} by ${label(c0)} and ${label(c1)}`,
          reason: `Each bar splits into its ${label(c1)} parts.`,
        });
      }
      if (!m0 || m0.hasNegative !== true) {
        add(54, {
          chart: 'treemap',
          x: c0.name,
          splitBy: c1.name,
          y,
          aggregate: agg,
          title: `${cap(measureName)} by ${label(c0)} › ${label(c1)}`,
          reason: 'Nested rectangles show the biggest contributors at both levels.',
        });
      }
    }
  }

  // ---- flows ----
  const src = cols.find((c) => FLOW_SOURCE.test(c.name) && (c.kind === 'category' || c.kind === 'text'));
  const dst = cols.find((c) => FLOW_TARGET.test(c.name) && (c.kind === 'category' || c.kind === 'text'));
  if (src && dst) {
    add(95, {
      chart: 'sankey',
      x: src.name,
      splitBy: dst.name,
      y,
      aggregate: agg,
      title: `${cap(measureName)} from ${label(src)} to ${label(dst)}`,
      reason: 'Source → target pairs are best read as flows.',
    });
  }

  // ---- relationships ----
  if (m0 && m1) {
    const group = categories.find((c) => c.distinct <= 3);
    add(d0 || c0 ? 58 : 84, {
      chart: m2 ? 'bubble' : 'scatter',
      x: m0.name,
      y: [m1.name],
      size: m2?.name ?? '',
      splitBy: group?.name ?? '',
      title: `${cap(label(m1))} vs ${label(m0)}`,
      reason: 'Each point is one row, so patterns and outliers stand out.',
    });
  }

  // ---- profiles (few entities, many measures) ----
  if (c0 && c0.distinct <= 6 && measures.length >= 3) {
    add(56, {
      chart: 'radar',
      x: c0.name,
      y: measures.slice(0, 6).map((m) => m.name),
      aggregate: 'avg',
      title: `${cap(label(c0))} profile`,
      reason: `Compares ${c0.distinct} ${label(c0)} values across ${Math.min(6, measures.length)} measures.`,
    });
  }

  // ---- single numbers ----
  if (m0) {
    add(profile.rowCount <= 1 ? 96 : 40, {
      chart: 'stat',
      x: '',
      y,
      aggregate: profile.rowCount <= 1 ? 'max' : 'sum',
      title: `Total ${measureName}`,
      reason: 'One headline number.',
    });
  }
  add(12, { chart: 'table', x: '', title: 'All rows', reason: 'Every value, sortable and searchable.' });

  // ---- question boosts ----
  if (question) {
    for (const cand of out) {
      for (const [re, kinds, boost] of KEYWORDS) if (re.test(question) && kinds.includes(cand.raw.chart)) cand.score += boost;
      const used = [cand.raw.x, ...(cand.raw.y ?? []), cand.raw.splitBy].filter(Boolean);
      for (const c of cols) if (used.includes(c.name) && mentioned(c)) cand.score += 12;
      if (window && cand.raw.lastPeriods) cand.score += 5;
    }
  }

  const seen = new Set<string>();
  const result: ChartSpec[] = [];
  for (const cand of out.sort((a, b) => b.score - a.score)) {
    const { spec } = validateSpec({ ...cand.raw, source: 'rules' }, profile);
    if (!spec) continue;
    const key = specKey(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(spec);
    if (result.length >= max) break;
  }
  return result;
}

/**
 * Matches a column name the way people type it: any separator ("merchant
 * category", "merchant-category"), camelCase split, and simple plurals
 * ("categories", "regions", "boxes").
 */
export function mentionPattern(name: string): RegExp {
  const words = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return /$^/;
  const last = words.pop()!;
  const plural = /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}(?:y|ies)` : `${last}(?:e?s)?`;
  return new RegExp(`\\b${[...words, plural].join('[\\s_-]?')}\\b`, 'i');
}

/** "Jan 30 – Oct 26, 2026" (or across years: "Nov 3, 2025 – Feb 1, 2026"). */
function formatSpan(start?: string, end?: string): string {
  const a = start ? new Date(start.length <= 10 ? `${start}T00:00` : start) : null;
  const b = end ? new Date(end.length <= 10 ? `${end}T00:00` : end) : null;
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const sameYear = a.getFullYear() === b.getFullYear();
  const md = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const mdy = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${sameYear ? md.format(a) : mdy.format(a)} – ${mdy.format(b)}`;
}

const UNIT_ORDER: TimeUnit[] = ['day', 'week', 'month', 'quarter', 'year'];

function grainUnit(c: ColumnProfile): TimeUnit {
  return c.grain === 'year' ? 'year' : c.grain === 'month' ? 'month' : 'day';
}

function coarser(a: TimeUnit, b: TimeUnit): TimeUnit {
  return UNIT_ORDER.indexOf(a) >= UNIT_ORDER.indexOf(b) ? a : b;
}

function unitDays(unit: TimeUnit): number {
  return { day: 1, week: 7, month: 30.4, quarter: 91, year: 365 }[unit];
}

function similarScale(a: ColumnProfile, b: ColumnProfile): boolean {
  const ma = Math.max(Math.abs(a.max ?? 0), Math.abs(a.min ?? 0));
  const mb = Math.max(Math.abs(b.max ?? 0), Math.abs(b.min ?? 0));
  if (ma === 0 || mb === 0) return false;
  return Math.max(ma, mb) / Math.min(ma, mb) <= 5;
}
