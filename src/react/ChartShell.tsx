import type { EChartsType } from 'echarts/core';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { EChartsModule } from '../core/modules';
import type { BuildContext, ChartModel } from '../core/types';
import type { Query } from '../data/fetcher';
import { exportChart, type ChartExportFormat } from '../export';
import { Card, cx, EmptyState, ErrorState, Skeleton, StaleNotice } from './Card';
import { useReportDeck } from './context';
import { DataTable } from './DataTable';
import { DownloadMenu } from './DownloadMenu';
import { EChart, type EChartEventHandler } from './EChart';
import { warnDev } from './env';
import { ChartIcon, TableIcon } from './icons';
import { useReportItem } from './report';
import { useStableConfig, useStableData } from './stable';
import { useReportData, type ReportDataOptions } from './useReportData';

/** Props every chart component accepts. */
export interface ChartBaseProps {
  /** Rows from your API (or an envelope like `{ data: [...] }`). Use `query` to let the chart fetch them. */
  data?: unknown;
  /** Fetch data from your backend: a URL or `{ url, params, method, body }`. */
  query?: Query | null;
  queryOptions?: ReportDataOptions;
  /** Loading/error states when you fetch data yourself. */
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  title?: string;
  subtitle?: string;
  /** Plot height in px (the header sits above it). */
  height?: number;
  /** Card chrome (border, header, actions). Default true. */
  frame?: boolean;
  /** Extra header buttons. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Download formats; `true` = all, `false` = none. Default all. */
  downloads?: boolean | ChartExportFormat[];
  /** Offer a table view of the same data (accessible alternative). Default true. */
  tableView?: boolean;
  fileName?: string;
  emptyMessage?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Grid span inside <Report>. */
  span?: 1 | 2 | 'full';
  renderer?: 'canvas' | 'svg';
  /** Screen-reader description. Defaults to title + subtitle. */
  ariaLabel?: string;
  onEvents?: Record<string, EChartEventHandler>;
  onChartReady?: (chart: EChartsType) => void;
  /** Include in <Report> exports. Default true. */
  includeInReport?: boolean;
  headingLevel?: 2 | 3 | 4;
}

const BASE_KEYS = [
  'data',
  'query',
  'queryOptions',
  'loading',
  'error',
  'onRetry',
  'title',
  'subtitle',
  'height',
  'frame',
  'actions',
  'footer',
  'downloads',
  'tableView',
  'fileName',
  'emptyMessage',
  'className',
  'style',
  'span',
  'renderer',
  'ariaLabel',
  'onEvents',
  'onChartReady',
  'includeInReport',
  'headingLevel',
] as const satisfies readonly (keyof ChartBaseProps)[];

export function splitChartProps<P extends ChartBaseProps>(props: P): [ChartBaseProps, Omit<P, keyof ChartBaseProps>] {
  const base: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if ((BASE_KEYS as readonly string[]).includes(k)) base[k] = v;
    else rest[k] = v;
  }
  return [base as ChartBaseProps, rest as Omit<P, keyof ChartBaseProps>];
}

const ALL_FORMATS: ChartExportFormat[] = ['png', 'svg', 'csv', 'xlsx', 'pdf'];

export interface ChartShellProps<C> {
  base: ChartBaseProps;
  config: C;
  build: (config: C & { data: unknown }, ctx: BuildContext) => ChartModel;
  modules: () => EChartsModule[];
  defaultHeight?: number;
  /** Height from the model when the caller didn't set one (e.g. one row per category). */
  autoHeight?: (model: ChartModel) => number | undefined;
}

export function ChartShell<C extends object>({ base, config, build, modules, defaultHeight = 320, autoHeight }: ChartShellProps<C>) {
  const deck = useReportDeck();
  const usingQuery = !!base.query;
  const q = useReportData(base.query ?? null, base.queryOptions);
  const data = useStableData(usingQuery ? q.data : base.data);
  const stableConfig = useStableConfig(config);

  const model = useMemo(() => build({ ...stableConfig, data }, deck.ctx), [build, stableConfig, data, deck.ctx]);
  useEffect(() => {
    for (const w of model.warnings) warnDev(`${base.title ? `"${base.title}": ` : ''}${w}`);
  }, [model.warnings, base.title]);

  const buildForExport = useCallback(() => build({ ...stableConfig, data }, deck.exportCtx), [build, stableConfig, data, deck.exportCtx]);

  const loading = base.loading ?? (usingQuery && q.isLoading);
  const error = base.error ?? (usingQuery ? q.error : undefined);
  const refreshing = (usingQuery && q.isRefreshing) || (!!base.loading && !model.isEmpty);
  const retry = base.onRetry ?? (usingQuery ? () => void q.refetch() : undefined);
  const height = base.height ?? autoHeight?.(model) ?? defaultHeight;
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = !model.isEmpty;
  const frame = base.frame ?? true;

  const cardRef = useRef<HTMLElement>(null);
  useReportItem(
    () => ({ kind: 'chart', title: base.title, subtitle: base.subtitle, model: buildForExport(), height }),
    cardRef,
    (base.includeInReport ?? true) && !loading,
  );

  const onDownload = async (format: ChartExportFormat) => {
    try {
      await exportChart(buildForExport(), format, {
        fileName: base.fileName ?? base.title ?? 'chart',
        title: base.title,
        subtitle: base.subtitle,
        locale: deck.ctx.locale,
        currency: deck.ctx.currency,
        fontFamily: deck.ctx.fontFamily,
        pdfFont: deck.config.pdfFont,
        width: 960,
        height: Math.round((960 * height) / 640),
      });
    } catch (e) {
      if (deck.config.onExportError) deck.config.onExportError(e);
      else console.error('[reportdeck] Chart export failed', e);
    }
  };

  const formats = base.downloads === false ? [] : base.downloads === true || base.downloads === undefined ? ALL_FORMATS : base.downloads;
  const showTableToggle = (base.tableView ?? true) && hasData;

  const actions =
    base.actions || (hasData && (formats.length > 0 || showTableToggle)) ? (
      <>
        {base.actions}
        {showTableToggle ? (
          <button
            type="button"
            className="rd-icon-button"
            aria-pressed={view === 'table'}
            aria-label={view === 'table' ? 'Show chart' : 'Show data table'}
            title={view === 'table' ? 'Show chart' : 'Show data table'}
            onClick={() => setView((v) => (v === 'table' ? 'chart' : 'table'))}
          >
            {view === 'table' ? <ChartIcon /> : <TableIcon />}
          </button>
        ) : null}
        {hasData && formats.length > 0 ? <DownloadMenu formats={formats} onSelect={onDownload} label="Download chart" /> : null}
      </>
    ) : undefined;

  const ariaLabel = base.ariaLabel ?? ([base.title, base.subtitle].filter(Boolean).join('. ') || undefined);

  let body: ReactNode;
  if (loading && !hasData) body = <Skeleton height={height} />;
  else if (error && !hasData) body = <ErrorState height={height} error={error} onRetry={retry} />;
  else if (!hasData) body = <EmptyState height={height} message={base.emptyMessage} />;
  else if (view === 'table')
    body = (
      <DataTable
        data={model.table.rows}
        columns={model.table.columns}
        frame={false}
        downloads={false}
        pageSize={0}
        maxHeight={height}
        density="compact"
        caption={`${base.title ?? 'Chart'} data`}
        includeInReport={false}
      />
    );
  else
    body = (
      <EChart
        option={model.option}
        modules={modules}
        height={height}
        renderer={base.renderer}
        ariaLabel={ariaLabel}
        onEvents={base.onEvents}
        onChartReady={base.onChartReady}
      />
    );

  return (
    <Card
      ref={cardRef}
      mode={deck.mode}
      fontFamily={deck.ctx.fontFamily}
      title={base.title}
      subtitle={base.subtitle}
      actions={actions}
      footer={base.footer}
      bare={!frame}
      busy={loading || refreshing}
      className={cx('rd-chart', base.span === 2 && 'rd-span-2', base.span === 'full' && 'rd-span-full', base.className)}
      style={base.style}
      headingLevel={base.headingLevel}
    >
      {error && hasData ? <StaleNotice error={error} onRetry={retry} /> : null}
      <div className={cx('rd-card__body', refreshing && 'is-refreshing')}>{body}</div>
    </Card>
  );
}
