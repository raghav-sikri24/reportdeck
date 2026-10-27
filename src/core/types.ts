import type { EChartsCoreOption } from 'echarts/core';

/** One row of backend data. Values can be anything; the library coerces them safely. */
export type Datum = Record<string, unknown>;

export type ColorMode = 'light' | 'dark';
export type ThemeSetting = ColorMode | 'auto';

export type FormatKind =
  | 'number'
  | 'integer'
  | 'compact'
  | 'currency'
  | 'currency-compact'
  | 'percent';

export interface FormatOptions {
  type?: FormatKind;
  /** ISO 4217 code. Defaults to the provider currency. */
  currency?: string;
  /** Fixed number of fraction digits. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /**
   * For `percent`: whether inputs are fractions (`0.25` → 25%) or whole
   * numbers (`25` → 25%). Defaults to `'fraction'`, matching `Intl`.
   */
  percentInput?: 'fraction' | 'whole';
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

export type ValueFormat = FormatKind | FormatOptions | ((value: number) => string);

export interface SeriesSpec {
  /** Field in each row that holds this series' values. */
  key: string;
  /** Display name. Defaults to a humanized version of `key`. */
  name?: string;
  /** Override the palette color. Prefer the default palette for accessibility. */
  color?: string;
  /** Value format for this series (tooltips, labels, table, exports). */
  format?: ValueFormat;
  /** Combo charts only: draw this series as bars or a line. */
  type?: 'bar' | 'line';
  /** Series sharing a stack id are stacked together. */
  stack?: string;
}

export type SeriesInput = string | SeriesSpec;

export type XType = 'auto' | 'category' | 'time' | 'value';

export type LabelMode = 'auto' | 'none' | 'all';

export type StatusLevel = 'good' | 'warning' | 'serious' | 'critical';

export interface ThemeTokens {
  mode: ColorMode;
  surface: string;
  page: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  grid: string;
  axis: string;
  border: string;
  tooltipBackground: string;
  /** De-emphasis gray for context series in `highlight` mode and "Other" buckets. */
  deemphasis: string;
  /** Neutral mark color for totals (waterfall) and overflow series. */
  neutral: string;
  series: readonly string[];
  sequential: readonly string[];
  ordinal: readonly string[];
  diverging: { negative: string; neutral: string; positive: string };
  status: Record<StatusLevel, string>;
  deltaUp: string;
  deltaDown: string;
}

/** Everything a builder needs besides the data itself. */
export interface BuildContext {
  tokens: ThemeTokens;
  locale: string;
  currency: string;
  fontFamily: string;
  animation: boolean;
  /** Draw decal textures so series are distinguishable without color. */
  texture: boolean;
}

export type ColumnType = 'string' | 'number' | 'date';

export interface TableColumn {
  key: string;
  header: string;
  type?: ColumnType;
  format?: ValueFormat;
  align?: 'left' | 'right' | 'center';
}

export interface TableData {
  columns: TableColumn[];
  rows: Datum[];
}

/** The result of every chart builder: an ECharts option plus a table twin of the same data. */
export interface ChartModel {
  option: EChartsCoreOption;
  table: TableData;
  isEmpty: boolean;
  warnings: string[];
}
