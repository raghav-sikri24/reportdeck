import { beforeAll, describe, expect, it } from 'vitest';
import { buildCartesian } from '../src/core/builders/cartesian';
import { createBuildContext } from '../src/core/builders/common';
import { buildFunnel } from '../src/core/builders/funnel';
import { buildGauge } from '../src/core/builders/gauge';
import { buildHeatmap } from '../src/core/builders/heatmap';
import { buildPie } from '../src/core/builders/pie';
import { buildRadar } from '../src/core/builders/radar';
import { buildSankey, cleanSankeyLinks } from '../src/core/builders/sankey';
import { buildScatter } from '../src/core/builders/scatter';
import { buildTreemap } from '../src/core/builders/treemap';
import { buildWaterfall } from '../src/core/builders/waterfall';
import { registerAll } from '../src/core/modules';
import { DARK_TOKENS, LIGHT_TOKENS } from '../src/core/tokens';
import type { ChartModel } from '../src/core/types';
import { renderToSVG } from '../src/export/image';

const ctx = createBuildContext();
const dark = createBuildContext({ mode: 'dark' });

type AnyOption = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const opt = (m: ChartModel) => m.option as AnyOption;

/** Every model must render through real ECharts without throwing. */
function renders(model: ChartModel): string {
  const svg = renderToSVG(model.option, { width: 640, height: 360 });
  expect(svg.startsWith('<svg')).toBe(true);
  return svg;
}

beforeAll(() => registerAll());

const monthly = [
  { month: '2024-03-01', revenue: 300, cost: 120 },
  { month: '2024-01-01', revenue: '1,000', cost: 400 },
  { month: '2024-02-01', revenue: null, cost: 380 },
  { month: 'garbage', revenue: 5, cost: 5 },
];

describe('cartesian', () => {
  it('sorts time data, drops invalid dates and keeps nulls as gaps', () => {
    const m = buildCartesian('line', { data: monthly, x: 'month', series: ['revenue', 'cost'] }, ctx);
    // "garbage" isn't a date, so the axis is categorical — but order is preserved and nothing is dropped.
    expect(opt(m).xAxis.type).toBe('category');
    const timeOnly = buildCartesian('line', { data: monthly.slice(0, 3), x: 'month', series: ['revenue'] }, ctx);
    expect(opt(timeOnly).xAxis.type).toBe('time');
    const values = opt(timeOnly).series[0].data.map((d: [number, number | null]) => d[1]);
    expect(values).toEqual([1000, null, 300]); // sorted Jan, Feb, Mar; Feb is a gap
    expect(timeOnly.table.rows).toHaveLength(3);
    renders(timeOnly);
  });

  it('warns about rows with invalid x when xType is forced', () => {
    const m = buildCartesian('line', { data: monthly, x: 'month', xType: 'time', series: ['revenue'] }, ctx);
    expect(m.warnings.join()).toMatch(/1 row\(s\) had an invalid "month"/);
    renders(m);
  });

  it('is empty for no data, all-null data or junk input', () => {
    expect(buildCartesian('bar', { data: [], x: 'x' }, ctx).isEmpty).toBe(true);
    expect(buildCartesian('bar', { data: [{ x: 'a', v: null }], x: 'x', series: ['v'] }, ctx).isEmpty).toBe(true);
    expect(buildCartesian('bar', { data: { error: 'nope' }, x: 'x' }, ctx).isEmpty).toBe(true);
    renders(buildCartesian('bar', { data: [], x: 'x' }, ctx));
  });

  it('renders a single point with a visible marker', () => {
    const m = buildCartesian('line', { data: [{ x: 'Only', v: 3 }], x: 'x', series: ['v'] }, ctx);
    expect(opt(m).series[0].showSymbol).toBe(true);
    renders(m);
  });

  it('rounds only the outer end of each stack, flipping for negatives', () => {
    const data = [{ q: 'Q1', a: 5, b: 3, c: -2 }];
    const m = buildCartesian('bar', { data, x: 'q', series: ['a', 'b', 'c'], stacked: true }, ctx);
    const radius = (i: number) => opt(m).series[i].data[0].itemStyle.borderRadius;
    expect(radius(0)).toBe(0); // inner positive segment
    expect(radius(1)).toEqual([4, 4, 0, 0]); // top of positive stack
    expect(radius(2)).toEqual([0, 0, 4, 4]); // bottom of negative stack
    expect(opt(m).series[0].itemStyle.borderWidth).toBe(2); // surface gap between segments
    renders(m);
  });

  it('stacks to 100% and reports shares and totals in the tooltip', () => {
    const data = [
      { k: 'A', x: 30, y: 10 },
      { k: 'B', x: 0, y: 0 },
    ];
    const m = buildCartesian('bar', { data, x: 'k', series: ['x', 'y'], stacked: 'percent' }, ctx);
    expect(opt(m).series[0].data[0].value).toBe(75);
    expect(opt(m).series[0].data[1].value).toBeNull(); // 0/0 is a gap, not NaN
    expect(opt(m).yAxis.max).toBe(100);
    const html = opt(m).tooltip.formatter([
      { seriesId: 'x', dataIndex: 0 },
      { seriesId: 'y', dataIndex: 0 },
    ]);
    expect(html).toContain('75.0%');
    expect(html).toContain('Total');
    renders(m);
  });

  it('escapes HTML from API-provided labels in tooltips', () => {
    const data = [{ name: '<img src=x onerror=alert(1)>', v: 1 }];
    const m = buildCartesian('bar', { data, x: 'name', series: [{ key: 'v', name: '<b>bold</b>' }] }, ctx);
    const html: string = opt(m).tooltip.formatter([{ seriesId: 'v', dataIndex: 0 }]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;b&gt;bold');
  });

  it('horizontal bars keep data order top-to-bottom and sort on request', () => {
    const data = [
      { team: 'B', v: 1 },
      { team: 'A', v: 9 },
      { team: 'C', v: 5 },
    ];
    const m = buildCartesian('bar', { data, x: 'team', series: ['v'], horizontal: true, sort: 'desc' }, ctx);
    expect(opt(m).yAxis.type).toBe('category');
    expect(opt(m).yAxis.inverse).toBe(true);
    expect(opt(m).yAxis.data).toEqual(['A', 'C', 'B']);
    expect(opt(m).series[0].data[0].itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
    renders(m);
  });

  it('turns dates into chronological categories for bars', () => {
    const m = buildCartesian('bar', { data: monthly.slice(0, 3), x: 'month', series: ['cost'] }, ctx);
    expect(opt(m).xAxis.data).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    renders(m);
  });

  it('greys out context series in highlight mode, keeping the focus color', () => {
    const m = buildCartesian('line', { data: monthly.slice(0, 3), x: 'month', series: ['revenue', 'cost'], highlight: 'cost' }, ctx);
    expect(opt(m).series[0].color).toBe(LIGHT_TOKENS.deemphasis);
    expect(opt(m).series[1].color).toBe(LIGHT_TOKENS.series[1]);
  });

  it('never invents a 9th hue', () => {
    const row: Record<string, number | string> = { x: 'a' };
    const series = Array.from({ length: 10 }, (_, i) => `s${i}`);
    for (const s of series) row[s] = 1;
    const m = buildCartesian('line', { data: [row], x: 'x', series }, ctx);
    expect(opt(m).color[8]).toBe(LIGHT_TOKENS.neutral);
    expect(m.warnings.join()).toMatch(/exceed the 8-color palette/);
  });

  it('uses the dark palette in dark mode', () => {
    const m = buildCartesian('bar', { data: [{ x: 'a', v: 1 }], x: 'x', series: ['v'] }, dark);
    expect(opt(m).color[0]).toBe(DARK_TOKENS.series[0]);
  });

  it('adds reference lines and stretches the axis to include them', () => {
    const m = buildCartesian('line', { data: [{ x: 'a', v: 1 }, { x: 'b', v: 2 }], x: 'x', series: ['v'], referenceLines: [{ value: 10, label: 'Target' }] }, ctx);
    expect(opt(m).series[0].markLine.data[0]).toEqual({ yAxis: 10, name: 'Target' });
    expect(opt(m).yAxis.max({ max: 2 })).toBe(10);
    renders(m);
  });

  it('enables zoom and LTTB sampling for long series', () => {
    const data = Array.from({ length: 1500 }, (_, i) => ({ t: new Date(2024, 0, 1, 0, i).toISOString(), v: Math.sin(i / 20) }));
    const m = buildCartesian('area', { data, x: 't', series: ['v'] }, ctx);
    expect(opt(m).dataZoom).toHaveLength(2);
    expect(opt(m).series[0].sampling).toBe('lttb');
    renders(m);
  });

  it('skips end labels when lines converge (no stacked, detached labels)', () => {
    const close = [
      { x: 'a', p: 10, q: 1 },
      { x: 'b', p: 50, q: 50.5 },
    ];
    expect(opt(buildCartesian('line', { data: close, x: 'x', series: ['p', 'q'] }, ctx)).series[0].endLabel).toBeUndefined();
    const apart = [
      { x: 'a', p: 10, q: 1 },
      { x: 'b', p: 90, q: 5 },
    ];
    expect(opt(buildCartesian('line', { data: apart, x: 'x', series: ['p', 'q'] }, ctx)).series[0].endLabel.show).toBe(true);
  });

  it('builds combo charts on a single shared axis', () => {
    const m = buildCartesian('combo', { data: [{ m: 'Jan', actual: 5, target: 6 }], x: 'm', series: ['actual', 'target'] }, ctx);
    expect(opt(m).series.map((s: AnyOption) => s.type)).toEqual(['bar', 'line']);
    expect(Array.isArray(opt(m).yAxis)).toBe(false);
    renders(m);
  });

  it('supports numeric x axes', () => {
    const m = buildCartesian('line', { data: [{ age: 30, v: 2 }, { age: 20, v: 1 }], x: 'age', xType: 'value', series: ['v'] }, ctx);
    expect(opt(m).xAxis.type).toBe('value');
    expect(opt(m).series[0].data[0]).toEqual([20, 1]);
    renders(m);
  });
});

describe('pie', () => {
  it('aggregates duplicates, drops negatives and folds the tail into Other', () => {
    const data = [
      { c: 'A', v: 50 },
      { c: 'B', v: 20 },
      { c: 'A', v: 10 },
      { c: 'C', v: 5 },
      { c: 'D', v: 4 },
      { c: 'E', v: 3 },
      { c: 'F', v: 2 },
      { c: 'G', v: 1 },
      { c: 'H', v: -5 },
      { c: 'I', v: 0 },
    ];
    const m = buildPie({ data, label: 'c', value: 'v', donut: true }, ctx);
    const slices = opt(m).series[0].data;
    expect(slices.map((s: AnyOption) => s.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'Other']);
    expect(slices[0].value).toBe(60);
    expect(slices[5].value).toBe(3);
    expect(slices[5].itemStyle.color).toBe(LIGHT_TOKENS.neutral);
    expect(m.warnings.join()).toMatch(/negative/);
    expect(opt(m).title.text).toBe('95');
    renders(m);
  });

  it('keeps colors pinned to names, not rank', () => {
    const a = buildPie({ data: [{ c: 'X', v: 1 }, { c: 'Y', v: 9 }], label: 'c', value: 'v' }, ctx);
    const colorOf = (m: ChartModel, name: string) => opt(m).series[0].data.find((s: AnyOption) => s.name === name).itemStyle.color;
    expect(colorOf(a, 'X')).toBe(LIGHT_TOKENS.series[0]);
    expect(colorOf(a, 'Y')).toBe(LIGHT_TOKENS.series[1]);
  });

  it('is empty when everything is zero', () => {
    expect(buildPie({ data: [{ c: 'A', v: 0 }], label: 'c', value: 'v' }, ctx).isEmpty).toBe(true);
  });
});

describe('other chart types render through ECharts', () => {
  it('scatter / bubble with groups', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ x: i, y: (i * 7) % 13, s: i, g: i % 2 ? 'Odd' : 'Even', n: `P${i}` }));
    const m = buildScatter({ data: [...data, { x: 'bad', y: 1 }], x: 'x', y: 'y', size: 's', group: 'g', name: 'n' }, ctx);
    expect(opt(m).series).toHaveLength(2);
    expect(m.warnings.join()).toMatch(/1 row/);
    renders(m);
  });

  it('heatmap switches to a diverging scale across zero', () => {
    const data = [
      { d: 'Mon', h: '9am', v: -4 },
      { d: 'Mon', h: '10am', v: 8 },
      { d: 'Tue', h: '9am', v: 2 },
    ];
    const m = buildHeatmap({ data, x: 'h', y: 'd', value: 'v' }, ctx);
    expect(opt(m).visualMap.min).toBe(-8);
    expect(opt(m).visualMap.max).toBe(8);
    renders(m);
  });

  it('radar, funnel, gauge, treemap', () => {
    renders(buildRadar({ data: [{ team: 'A', speed: 3, power: 5, skill: 4 }, { team: 'B', speed: 5, power: 2, skill: 3 }], name: 'team', indicators: ['speed', 'power', 'skill'] }, ctx));
    const funnel = buildFunnel({ data: [{ s: 'Visit', n: 1000 }, { s: 'Signup', n: 250 }, { s: 'Paid', n: 40 }], stage: 's', value: 'n' }, ctx);
    expect(opt(funnel).series[0].max).toBe(1000); // not ECharts' default of 100
    expect(funnel.table.rows[2]!.conversion).toBeCloseTo(0.04);
    renders(funnel);
    const gauge = buildGauge({ value: 140, max: 100, bands: [{ upTo: 60, status: 'good' }, { upTo: 100, status: 'critical', label: 'Over budget' }] }, ctx);
    expect(opt(gauge).series[0].data[0].value).toBe(100); // arc clamped
    expect(opt(gauge).series[0].progress.itemStyle.color).toBe(LIGHT_TOKENS.status.critical);
    renders(gauge);
    expect(buildGauge({ value: null }, ctx).isEmpty).toBe(true);
    renders(buildTreemap({ data: [{ r: 'APAC', c: 'India', v: 5 }, { r: 'APAC', c: 'Japan', v: 3 }, { r: 'EU', c: 'France', v: 4 }, { r: 'EU', c: 'France', v: 1 }], path: ['r', 'c'], value: 'v' }, ctx));
  });

  it('sankey drops cycles and self-loops instead of crashing ECharts', () => {
    const warnings: string[] = [];
    const links = cleanSankeyLinks(
      [
        { source: 'A', target: 'B', value: 10 },
        { source: 'B', target: 'C', value: 5 },
        { source: 'C', target: 'A', value: 1 },
        { source: 'C', target: 'C', value: 2 },
        { source: 'A', target: 'B', value: 5 },
      ],
      warnings,
    );
    expect(links).toEqual([
      { source: 'A', target: 'B', value: 15 },
      { source: 'B', target: 'C', value: 5 },
    ]);
    expect(warnings.length).toBe(2);
    renders(buildSankey({ data: [{ f: 'A', t: 'B', v: 3 }, { f: 'B', t: 'A', v: 1 }], source: 'f', target: 't', value: 'v' }, ctx));
  });

  it('waterfall handles bars that cross zero and subtotals', () => {
    const data = [
      { step: 'Start', v: 50 },
      { step: 'Refunds', v: -80 },
      { step: 'Subtotal', sub: true },
      { step: 'Sales', v: 100 },
    ];
    const m = buildWaterfall({ data, x: 'step', value: 'v', totalKey: 'sub' }, ctx);
    const [base, a, b] = opt(m).series;
    // "Refunds" goes 50 → -30: crosses zero, so it splits into +50 and -30 parts with no base.
    expect(base.data[1]).toBeNull();
    expect(a.data[1].value).toBe(50);
    expect(b.data[1].value).toBe(-30);
    expect(m.table.rows.at(-1)).toMatchObject({ step: 'Total', running_total: 70 });
    renders(m);
  });
});
