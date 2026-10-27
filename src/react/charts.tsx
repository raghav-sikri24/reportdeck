import { buildCartesian, type CartesianConfig } from '../core/builders/cartesian';
import { buildFunnel, type FunnelConfig } from '../core/builders/funnel';
import { buildGauge, type GaugeConfig } from '../core/builders/gauge';
import { buildHeatmap, type HeatmapConfig } from '../core/builders/heatmap';
import { buildPie, type PieConfig } from '../core/builders/pie';
import { buildRadar, type RadarConfig } from '../core/builders/radar';
import { buildSankey, type SankeyConfig } from '../core/builders/sankey';
import { buildScatter, type ScatterConfig } from '../core/builders/scatter';
import { buildTreemap, type TreemapConfig } from '../core/builders/treemap';
import { buildWaterfall, type WaterfallConfig } from '../core/builders/waterfall';
import {
  barModules,
  comboModules,
  funnelModules,
  gaugeModules,
  heatmapModules,
  lineModules,
  pieModules,
  radarModules,
  sankeyModules,
  scatterModules,
  treemapModules,
} from '../core/modules';
import type { BuildContext, ChartModel, SeriesSpec } from '../core/types';
import { ChartShell, splitChartProps, type ChartBaseProps } from './ChartShell';

type WithoutData<T> = Omit<T, 'data'>;

// Builders are module-level so their identity is stable across renders.
const buildLine = (c: CartesianConfig, ctx: BuildContext) => buildCartesian('line', c, ctx);
const buildArea = (c: CartesianConfig, ctx: BuildContext) => buildCartesian('area', c, ctx);
const buildBar = (c: CartesianConfig, ctx: BuildContext) => buildCartesian('bar', c, ctx);
const buildCombo = (c: CartesianConfig, ctx: BuildContext) => buildCartesian('combo', c, ctx);
const buildDonut = (c: PieConfig, ctx: BuildContext) => buildPie({ donut: true, ...c }, ctx);
const buildGaugeFromData = (c: GaugeConfig & { data: unknown }, ctx: BuildContext) =>
  buildGauge({ ...c, value: c.value !== undefined ? c.value : c.data }, ctx);

/** One row per category for horizontal bars, so labels never collide. */
const horizontalBarHeight = (model: ChartModel) => {
  const option = model.option as { legend?: { show?: boolean } };
  const rows = model.table.rows.length;
  return Math.min(720, Math.max(180, rows * 32 + (option.legend?.show ? 64 : 32)));
};
const heatmapHeight = (model: ChartModel) => {
  const yKey = model.table.columns[0]?.key ?? '';
  const ys = new Set(model.table.rows.map((r) => r[yKey]));
  return Math.min(720, Math.max(200, ys.size * 34 + 80));
};

export interface LineChartProps extends ChartBaseProps, WithoutData<CartesianConfig> {}
/** Trends over time. Gaps for missing values, crosshair tooltip, auto zoom for long series. */
export function LineChart(props: LineChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildLine} modules={lineModules} />;
}

export interface AreaChartProps extends ChartBaseProps, WithoutData<CartesianConfig> {}
/** A line with a soft wash — best for one series, or stacked for part-to-whole over time. */
export function AreaChart(props: AreaChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildArea} modules={lineModules} />;
}

export interface BarChartProps extends ChartBaseProps, WithoutData<CartesianConfig> {}
/** Compare magnitudes. Grouped, stacked, 100% stacked or horizontal. */
export function BarChart(props: BarChartProps) {
  const [base, config] = splitChartProps(props);
  return (
    <ChartShell
      base={base}
      config={config}
      build={buildBar}
      modules={barModules}
      autoHeight={config.horizontal ? horizontalBarHeight : undefined}
    />
  );
}

export interface ComboChartProps extends ChartBaseProps, WithoutData<CartesianConfig> {
  /** Series with `type: 'bar' | 'line'`. Defaults: first series bars, the rest lines. One shared axis. */
  series?: (string | SeriesSpec)[];
}
/** Bars and lines on ONE shared axis (e.g. actuals vs target). Dual axes are deliberately not supported. */
export function ComboChart(props: ComboChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildCombo} modules={comboModules} />;
}

export interface PieChartProps extends ChartBaseProps, WithoutData<PieConfig> {}
/** Part-to-whole at a glance (≤ 6 slices; the rest fold into "Other"). */
export function PieChart(props: PieChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildPie} modules={pieModules} defaultHeight={300} />;
}

export type DonutChartProps = PieChartProps;
/** A pie with the total in the middle. */
export function DonutChart(props: DonutChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildDonut} modules={pieModules} defaultHeight={300} />;
}

export interface ScatterChartProps extends ChartBaseProps, WithoutData<ScatterConfig> {}
/** Relationship between two measures; pass `size` for a bubble chart and `group` for colors. */
export function ScatterChart(props: ScatterChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildScatter} modules={scatterModules} />;
}

export interface HeatmapChartProps extends ChartBaseProps, WithoutData<HeatmapConfig> {}
/** Magnitude across two categories (e.g. weekday × hour). Diverging scale when data crosses zero. */
export function HeatmapChart(props: HeatmapChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildHeatmap} modules={heatmapModules} autoHeight={heatmapHeight} />;
}

export interface RadarChartProps extends ChartBaseProps, WithoutData<RadarConfig> {}
/** Compare a few entities across several dimensions. */
export function RadarChart(props: RadarChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildRadar} modules={radarModules} defaultHeight={340} />;
}

export interface FunnelChartProps extends ChartBaseProps, WithoutData<FunnelConfig> {}
/** Conversion through ordered stages, with stage-to-stage rates. */
export function FunnelChart(props: FunnelChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildFunnel} modules={funnelModules} defaultHeight={300} />;
}

export interface GaugeChartProps extends ChartBaseProps, Partial<WithoutData<GaugeConfig>> {}
/** One value against a range, with optional severity bands. Takes `value`, or `data` / `query` resolving to a number. */
export function GaugeChart(props: GaugeChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config as GaugeConfig} build={buildGaugeFromData} modules={gaugeModules} defaultHeight={240} />;
}

export interface TreemapChartProps extends ChartBaseProps, WithoutData<TreemapConfig> {}
/** Hierarchical part-to-whole (e.g. region › country). */
export function TreemapChart(props: TreemapChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildTreemap} modules={treemapModules} defaultHeight={360} />;
}

export interface SankeyChartProps extends ChartBaseProps, WithoutData<SankeyConfig> {}
/** Flows between stages. Cycles, self-loops and duplicate links are cleaned automatically. */
export function SankeyChart(props: SankeyChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildSankey} modules={sankeyModules} defaultHeight={380} />;
}

export interface WaterfallChartProps extends ChartBaseProps, WithoutData<WaterfallConfig> {}
/** How a starting value becomes an ending value through increases and decreases. */
export function WaterfallChart(props: WaterfallChartProps) {
  const [base, config] = splitChartProps(props);
  return <ChartShell base={base} config={config} build={buildWaterfall} modules={barModules} />;
}
