import {
  BarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { use as installEChartsModules } from 'echarts/core';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

/** A single chart, component, feature or renderer accepted by `echarts/core`'s `use()`. */
export type EChartsModule = Exclude<Parameters<typeof installEChartsModules>[0], readonly unknown[]>;

// Separate functions (not one lookup object) so a bundler can drop the chart
// types you never render.
const shared = (): EChartsModule[] => [
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  AriaComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
  SVGRenderer,
];
const cartesian = (): EChartsModule[] => [GridComponent, DataZoomComponent, MarkLineComponent];

export const lineModules = () => [...shared(), ...cartesian(), LineChart];
export const barModules = () => [...shared(), ...cartesian(), BarChart];
export const comboModules = () => [...shared(), ...cartesian(), BarChart, LineChart];
export const pieModules = () => [...shared(), PieChart];
export const scatterModules = () => [...shared(), ...cartesian(), ScatterChart];
export const heatmapModules = () => [...shared(), GridComponent, VisualMapComponent, HeatmapChart];
export const radarModules = () => [...shared(), RadarComponent, RadarChart];
export const funnelModules = () => [...shared(), FunnelChart];
export const gaugeModules = () => [...shared(), GaugeChart];
export const treemapModules = () => [...shared(), TreemapChart];
export const sankeyModules = () => [...shared(), SankeyChart];

export function registerModules(modules: EChartsModule[]): void {
  installEChartsModules(modules);
}

/** Registers every chart type this library supports (server-side rendering, exports outside React). */
export function registerAll(): void {
  installEChartsModules([
    ...comboModules(),
    ...pieModules(),
    ...scatterModules(),
    ...heatmapModules(),
    ...radarModules(),
    ...funnelModules(),
    ...gaugeModules(),
    ...treemapModules(),
    ...sankeyModules(),
  ]);
}
