// Framework-agnostic core: option builders, formatting, data coercion, CSV.
// Safe to import on the server and in non-React code.

export type * from './types';
export { createBuildContext, escapeHtml } from './builders/common';
export { buildCartesian } from './builders/cartesian';
export type { CartesianConfig, CartesianKind, ReferenceLine } from './builders/cartesian';
export { buildPie } from './builders/pie';
export type { PieConfig } from './builders/pie';
export { buildScatter } from './builders/scatter';
export type { ScatterConfig } from './builders/scatter';
export { buildHeatmap } from './builders/heatmap';
export type { HeatmapConfig } from './builders/heatmap';
export { buildRadar } from './builders/radar';
export type { RadarConfig, RadarIndicator } from './builders/radar';
export { buildFunnel } from './builders/funnel';
export type { FunnelConfig } from './builders/funnel';
export { buildGauge } from './builders/gauge';
export type { GaugeBand, GaugeConfig } from './builders/gauge';
export { buildTreemap } from './builders/treemap';
export type { TreemapConfig } from './builders/treemap';
export { buildSankey, cleanSankeyLinks } from './builders/sankey';
export type { SankeyConfig } from './builders/sankey';
export { buildWaterfall } from './builders/waterfall';
export type { WaterfallConfig } from './builders/waterfall';

export {
  createAxisFormatter,
  createFormatter,
  EMPTY_VALUE,
  formatDate,
  humanize,
} from './format';
export {
  createDateLabeler,
  inferColumnType,
  isDateLike,
  parseDate,
  resolveSeries,
  stableStringify,
  toLabel,
  toNumber,
  toRows,
} from './data';
export { contrastRatio, inkOn, mix, withAlpha } from './colors';
export { DARK_TOKENS, getTokens, LIGHT_TOKENS, MAX_CATEGORICAL, SYSTEM_FONT_STACK } from './tokens';
export { neutralizeFormula, parseCSV, toCSV } from './csv';
export type { CsvOptions } from './csv';
export { sanitizeFilename, withExtension } from './filename';
export {
  barModules,
  comboModules,
  funnelModules,
  gaugeModules,
  heatmapModules,
  lineModules,
  pieModules,
  radarModules,
  registerAll,
  registerModules,
  sankeyModules,
  scatterModules,
  treemapModules,
} from './modules';
export type { EChartsModule } from './modules';
