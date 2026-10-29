import { describe, expect, it } from 'vitest';
import { profileData, redactProfile } from '../src/ai/profile';
import { mentionPattern, parseTimeWindow, recommendCharts } from '../src/ai/recommend';
import { advisorResponseSchema, compileSpec, specKey, validateSpec, type ChartSpec } from '../src/ai/spec';
import { applyTransform, startOfUnit } from '../src/ai/transform';

// Raw, transaction-level data: one row per payment.
const channels = ['Card', 'UPI', 'Netbanking', 'Wallet'];
const regions = ['North', 'South', 'East', 'West', 'Central'];
const payments = Array.from({ length: 400 }, (_, i) => ({
  txn_id: `TXN-${10000 + i}`,
  created_at: `2026-${String(1 + Math.floor(i / 40)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
  channel: channels[i % 4],
  region: regions[i % 5],
  amount: i === 7 ? null : 100 + (i % 17) * 25,
  quantity: 1 + (i % 3),
  paid: i % 9 !== 0,
}));

describe('profileData', () => {
  const p = profileData(payments);
  const col = (name: string) => p.columns.find((c) => c.name === name)!;

  it('infers column kinds, including ids, dates, booleans and currency hints', () => {
    expect(p.rowCount).toBe(400);
    expect(col('txn_id').kind).toBe('id');
    expect(col('created_at')).toMatchObject({ kind: 'date', grain: 'day', start: '2026-01-01', end: '2026-10-28' });
    expect(col('channel')).toMatchObject({ kind: 'category', distinct: 4 });
    expect(col('amount')).toMatchObject({ kind: 'number', missing: 1, unit: 'currency', hasNegative: false });
    expect(col('paid').kind).toBe('boolean'); // "paid" must not be mistaken for an id column
    expect(col('channel').top![0]).toMatchObject({ count: 100 });
  });

  it('treats 4-digit year columns as dates and string numbers as numbers', () => {
    const q = profileData([{ year: 2023, sales: '1,200' }, { year: 2024, sales: '₹ 900' }]);
    expect(q.columns[0]).toMatchObject({ kind: 'date', grain: 'year' });
    expect(q.columns[1]).toMatchObject({ kind: 'number', min: 900, max: 1200 });
  });

  it('redacts by privacy level', () => {
    const schema = redactProfile(p, 'schema');
    expect(schema.sample).toBeUndefined();
    expect(JSON.stringify(schema)).not.toMatch(/Card|2026-|"min"|"max"|"sum"/);
    const summary = redactProfile(p, 'summary');
    expect(summary.sample).toBeUndefined();
    expect(JSON.stringify(summary)).toContain('Card');
    expect(redactProfile(p, 'sample').sample).toHaveLength(5);
    // A redacted profile can never be "un-redacted".
    expect(redactProfile(schema, 'sample').privacy).toBe('schema');
  });

  it('handles empty and junk input', () => {
    expect(profileData([]).columns).toEqual([]);
    expect(profileData({ nope: 1 }).rowCount).toBe(0);
  });
});

describe('applyTransform', () => {
  it('buckets by month, groups, sums, and keeps gaps as null', () => {
    const rows = [
      { d: '2026-01-05', ch: 'A', v: 10 },
      { d: '2026-01-20', ch: 'A', v: 5 },
      { d: '2026-02-03', ch: 'A', v: null },
      { d: '2026-02-09', ch: 'B', v: 7 },
      { d: 'oops', ch: 'B', v: 1 },
    ];
    const res = applyTransform(rows, { timeBucket: { field: 'd', unit: 'month' }, groupBy: ['ch'], measures: [{ field: 'v', op: 'sum' }] });
    expect(res.rows).toEqual([
      { d: '2026-01-01', ch: 'A', v: 15 },
      { d: '2026-02-01', ch: 'A', v: null },
      { d: '2026-02-01', ch: 'B', v: 7 },
    ]);
    expect(res.notes[0]).toMatch(/1 row/);
  });

  it('pivots long → wide and folds extra series into Other', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ m: '2026-01', s: `S${i}`, v: 10 - i }));
    const res = applyTransform(rows, { groupBy: ['m', 's'], measures: [{ field: 'v', op: 'sum' }], pivot: { field: 's', value: 'v', maxSeries: 4 } });
    expect(res.series).toEqual(['S0', 'S1', 'S2', 'Other']);
    expect(res.rows).toEqual([{ m: '2026-01', S0: 10, S1: 9, S2: 8, Other: 7 + 6 + 5 + 4 + 3 + 2 + 1 }]);
  });

  it('never lets a series name overwrite a key column', () => {
    const res = applyTransform([{ month: 'Jan', kind: 'month', v: 1 }], { groupBy: ['month', 'kind'], measures: [{ field: 'v', op: 'sum' }], pivot: { field: 'kind', value: 'v' } });
    expect(res.rows[0]).toEqual({ month: 'Jan', 'month (kind)': 1 });
  });

  it('keeps the top N with Other, counts rows, and filters the last N periods', () => {
    const top = applyTransform(payments, { groupBy: ['region'], measures: [{ field: '*', op: 'count' }], topN: { field: 'region', n: 2, by: 'count', other: true } });
    expect(top.rows.map((r) => r.region)).toEqual(['North', 'South', 'Other']);
    expect(top.rows.reduce((s, r) => s + (r.count as number), 0)).toBe(400);
    const last = applyTransform(payments, { last: { field: 'created_at', n: 2, unit: 'month' } });
    expect(last.rows.every((r) => String(r.created_at) >= '2026-09-01')).toBe(true);
  });

  it('flags a partial last period instead of letting it look like a drop', () => {
    const rows = [{ d: '2026-09-10', v: 5 }, { d: '2026-10-02', v: 1 }];
    expect(applyTransform(rows, { timeBucket: { field: 'd', unit: 'month' }, measures: [{ field: 'v', op: 'sum' }] }).notes).toEqual([
      'The last month is still in progress (data ends Oct 2).',
    ]);
    const complete = [{ d: '2026-09-10', v: 5 }, { d: '2026-10-31', v: 1 }];
    expect(applyTransform(complete, { timeBucket: { field: 'd', unit: 'month' }, measures: [{ field: 'v', op: 'sum' }] }).notes).toEqual([]);
  });

  it('starts weeks on Monday and quarters on the right month', () => {
    expect(startOfUnit(new Date(2026, 9, 28), 'week').getDate()).toBe(26); // Wed 28 Oct → Mon 26 Oct
    expect(startOfUnit(new Date(2026, 7, 15), 'quarter').getMonth()).toBe(6);
  });
});

describe('validateSpec', () => {
  const p = profileData(payments);
  const base = { title: 'T', reason: 'R', x: '', y: [], splitBy: '', size: '', aggregate: 'none', timeUnit: 'none', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' };

  it('fixes enum casing, column casing and adds aggregation for raw rows', () => {
    const { spec } = validateSpec({ ...base, chart: 'LINE', x: 'Created_At', y: ['AMOUNT'] }, p);
    expect(spec).toMatchObject({ chart: 'line', x: 'created_at', y: ['amount'], aggregate: 'sum', timeUnit: 'week' });
  });

  it('drops invented columns and falls back to counting rows', () => {
    const { spec, issues } = validateSpec({ ...base, chart: 'bar', x: 'channel', y: ['profit_margin'] }, p);
    expect(spec).toMatchObject({ y: [], aggregate: 'count' });
    expect(issues.join()).toMatch(/Unknown y column "profit_margin"/);
  });

  it('repairs or rejects impossible charts', () => {
    const neg = profileData([{ c: 'a', v: -1 }, { c: 'b', v: 2 }]);
    expect(validateSpec({ ...base, chart: 'pie', x: 'c', y: ['v'] }, neg).spec?.chart).toBe('bar');
    expect(validateSpec({ ...base, chart: 'line', x: 'channel', y: ['amount'] }, p).spec?.chart).toBe('bar');
    expect(validateSpec({ ...base, chart: 'scatter', x: 'channel', y: ['amount'] }, p).spec).toBeNull();
    expect(validateSpec({ ...base, chart: 'rainbow' }, p).spec).toBeNull();
    expect(validateSpec('nope', p).spec).toBeNull();
  });

  it('strips control characters and caps text length', () => {
    const { spec } = validateSpec({ ...base, chart: 'table', title: `Hi\u0000${'x'.repeat(200)}`, reason: 'ok\nthere' }, p);
    expect(spec!.title.length).toBeLessThanOrEqual(80);
    expect(spec!.title).not.toContain('\u0000');
    expect(spec!.reason).toBe('ok there');
  });
});

describe('recommendCharts', () => {
  it('suggests a trend first for time-stamped transactions', () => {
    const recs = recommendCharts(profileData(payments));
    expect(recs[0]).toMatchObject({ chart: 'line', x: 'created_at', y: ['amount'], aggregate: 'sum', source: 'rules' });
    expect(recs.map((r) => r.chart)).toEqual(expect.arrayContaining(['bar', 'donut']));
    expect(new Set(recs.map(specKey)).size).toBe(recs.length); // no duplicates
  });

  it('follows the question', () => {
    const p = profileData(payments);
    expect(recommendCharts(p, { question: 'share of amount by channel' })[0]!.chart).toBe('donut');
    expect(recommendCharts(p, { question: 'compare regions' })[0]!.x).toBe('region');
    const merch = profileData(payments.map((r, i) => ({ ...r, merchant_category: ['Food', 'Travel', 'Bills'][i % 3], fee: i % 5 })));
    expect(recommendCharts(merch, { question: 'compare merchant categories by fee' })[0]).toMatchObject({ x: 'merchant_category', y: ['fee'] });
    const weekly = recommendCharts(p, { question: 'weekly amount trend for the last 2 months' })[0]!;
    expect(weekly).toMatchObject({ chart: 'line', timeUnit: 'week', lastPeriods: 9 });
  });

  it('recognizes flows, funnels, relationships and single values', () => {
    expect(recommendCharts(profileData([{ from: 'A', to: 'B', visits: 3 }, { from: 'B', to: 'C', visits: 2 }]))[0]!.chart).toBe('sankey');
    expect(recommendCharts(profileData([{ stage: 'Visit', users: 100 }, { stage: 'Signup', users: 20 }]))[0]!.chart).toBe('funnel');
    expect(recommendCharts(profileData([{ height: 1, weight: 2 }, { height: 2, weight: 5 }, { height: 3, weight: 4 }]))[0]!.chart).toBe('scatter');
    expect(recommendCharts(profileData([{ revenue: 1200 }]))[0]!.chart).toBe('stat');
  });

  it('matches column names the way people type them', () => {
    expect(mentionPattern('merchant_category').test('compare merchant categories by fee')).toBe(true);
    expect(mentionPattern('merchantCategory').test('top merchant category')).toBe(true);
    expect(mentionPattern('region').test('by regions')).toBe(true);
    expect(mentionPattern('day').test('per days')).toBe(true);
    expect(mentionPattern('fee').test('coffee sales')).toBe(false);
  });

  it('parses time windows', () => {
    expect(parseTimeWindow('revenue in the last 30 days')).toEqual({ n: 30, unit: 'day' });
    expect(parseTimeWindow('past quarter')).toEqual({ n: 1, unit: 'quarter' });
    expect(parseTimeWindow('all time')).toBeNull();
  });
});

describe('compileSpec', () => {
  const p = profileData(payments);

  it('builds a multi-series line chart from raw rows', () => {
    const spec = validateSpec(
      { chart: 'line', title: 'Amount by channel', reason: '', x: 'created_at', y: ['amount'], splitBy: 'channel', size: '', aggregate: 'sum', timeUnit: 'month', sort: 'none', limit: 0, lastPeriods: 0, format: 'auto' },
      p,
    ).spec as ChartSpec;
    const view = compileSpec(spec, payments, p);
    expect(view.component).toBe('LineChart');
    expect(view.props).toMatchObject({ x: 'created_at', format: 'currency' });
    expect((view.props.series as { key: string }[]).map((s) => s.key).sort()).toEqual([...channels].sort());
    expect(view.data).toHaveLength(10); // Jan..Oct
  });

  it('computes KPI totals and donut shares', () => {
    const stat = compileSpec(validateSpec({ chart: 'stat', title: 'Total', x: '', y: ['amount'] }, p).spec!, payments, p);
    expect(stat.component).toBe('StatCard');
    expect(stat.props.value).toBe(payments.reduce((s, r) => s + (r.amount ?? 0), 0));
    const donut = compileSpec(validateSpec({ chart: 'donut', x: 'channel', y: [], aggregate: 'count' }, p).spec!, payments, p);
    expect(donut).toMatchObject({ component: 'DonutChart', props: { label: 'channel', value: 'count', format: 'integer' } });
    expect(donut.data).toHaveLength(4);
  });
});

describe('advisorResponseSchema', () => {
  it('stays inside the strictest structured-output limits', () => {
    const schema = advisorResponseSchema() as { properties: { suggestions: { items: { required: string[]; properties: Record<string, { type: string | string[] }>; additionalProperties: boolean } } } };
    const item = schema.properties.suggestions.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort()); // nothing optional
    expect(Object.values(item.properties).every((p) => !Array.isArray(p.type))).toBe(true); // nothing nullable
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|minimum|maximum|maxItems/);
  });
});
