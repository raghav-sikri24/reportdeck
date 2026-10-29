// React components + hooks. Framework-agnostic helpers live in `reportdeck/core`,
// export helpers in `reportdeck/export`, Node rendering in `reportdeck/server`.

export { ReportDeckProvider, useReportDeck } from './react/context';
export type { ReportDeckConfig, ReportDeckContextValue, ReportDeckProviderProps } from './react/context';

export { useReportData, useInvalidateReportData } from './react/useReportData';
export type { ReportDataOptions, ReportDataResult } from './react/useReportData';
export { createFetcher, ReportDataError } from './data/fetcher';
export type { Fetcher, FetcherConfig, HeadersInput, ParamValue, Query, QueryRequest, ReportDataErrorKind } from './data/fetcher';
export type { QueryStatus } from './data/store';

export {
  AreaChart,
  BarChart,
  ComboChart,
  DonutChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
  WaterfallChart,
} from './react/charts';
export type {
  AreaChartProps,
  BarChartProps,
  ComboChartProps,
  DonutChartProps,
  FunnelChartProps,
  GaugeChartProps,
  HeatmapChartProps,
  LineChartProps,
  PieChartProps,
  RadarChartProps,
  SankeyChartProps,
  ScatterChartProps,
  TreemapChartProps,
  WaterfallChartProps,
} from './react/charts';
export type { ChartBaseProps } from './react/ChartShell';

export { EChart } from './react/EChart';
export type { EChartEventHandler, EChartProps } from './react/EChart';
export { DataTable, sortRows } from './react/DataTable';
export type { DataTableColumn, DataTableProps, SortDirection } from './react/DataTable';
export { computeDelta, Sparkline, StatCard, StatGroup } from './react/StatCard';
export type { DeltaInfo, SparklineProps, StatCardProps } from './react/StatCard';
export { Report, useReport, useReportItem } from './react/report';
export { AutoChart } from './react/AutoChart';
export type { AutoChartProps } from './react/AutoChart';
export { profileData, recommendCharts, validateSpec } from './core';
export type { ChartKind, ChartSpec, DataProfile, PrivacyLevel } from './core';
export type { ReportProps, UseReportResult } from './react/report';
export { DownloadMenu } from './react/DownloadMenu';
export type { DownloadFormat, DownloadMenuProps } from './react/DownloadMenu';

export type {
  BuildContext,
  ChartModel,
  ColorMode,
  ColumnType,
  Datum,
  FormatKind,
  FormatOptions,
  LabelMode,
  SeriesInput,
  SeriesSpec,
  StatusLevel,
  TableColumn,
  TableData,
  ThemeSetting,
  ThemeTokens,
  ValueFormat,
  XType,
} from './core/types';
export type { ReferenceLine } from './core/builders/cartesian';
export type { GaugeBand } from './core/builders/gauge';
export type { RadarIndicator } from './core/builders/radar';
export type { ChartExportFormat, ReportExportFormat, ReportExportOptions } from './export';
export type { PdfFont } from './export/pdf';
export { createFormatter, formatDate } from './core/format';
export { parseDate, toNumber } from './core/data';
export { DARK_TOKENS, LIGHT_TOKENS } from './core/tokens';
