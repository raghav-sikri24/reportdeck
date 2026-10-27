import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { inferColumnType, parseDate, toLabel, toNumber, toRows } from '../core/data';
import { createFormatter, EMPTY_VALUE, formatDate, humanize } from '../core/format';
import type { Datum, TableColumn, TableData } from '../core/types';
import type { Query } from '../data/fetcher';
import { exportTable } from '../export';
import { Card, cx, EmptyState, ErrorState, Skeleton, StaleNotice } from './Card';
import { useReportDeck } from './context';
import { DownloadMenu } from './DownloadMenu';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, SortIcon } from './icons';
import { useReportItem } from './report';
import { useStableData } from './stable';
import { useReportData, type ReportDataOptions } from './useReportData';

export interface DataTableColumn<T extends Datum = Datum> extends TableColumn {
  /** Custom cell content. Exports still use the raw value. */
  render?: (value: unknown, row: T) => ReactNode;
  sortable?: boolean;
  width?: number | string;
}

export type SortDirection = 'asc' | 'desc';

export interface DataTableProps<T extends Datum = Datum> {
  data?: unknown;
  query?: Query | null;
  queryOptions?: ReportDataOptions;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Columns to show. Omit to infer from the data. */
  columns?: DataTableColumn<T>[];
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Download formats. Default `['csv', 'xlsx', 'pdf']`; `false` hides the menu. */
  downloads?: boolean | ('csv' | 'xlsx' | 'pdf')[];
  fileName?: string;
  /** Rows per page; `0` disables pagination. Default 10. */
  pageSize?: number;
  defaultSort?: { key: string; direction: SortDirection };
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Card chrome. Default true. */
  frame?: boolean;
  /** Scroll inside the table past this height (sticky header). */
  maxHeight?: number | string;
  emptyMessage?: ReactNode;
  rowKey?: keyof T | ((row: T, index: number) => string | number);
  onRowClick?: (row: T) => void;
  /** Accessible caption; defaults to the title. */
  caption?: string;
  density?: 'comfortable' | 'compact';
  className?: string;
  style?: CSSProperties;
  span?: 1 | 2 | 'full';
  includeInReport?: boolean;
  headingLevel?: 2 | 3 | 4;
}

const collatorCache = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collatorCache.get(locale);
  if (!c) {
    try {
      c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    } catch {
      c = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
    }
    collatorCache.set(locale, c);
  }
  return c;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

function compare(a: unknown, b: unknown, column: TableColumn, locale: string): number {
  if (column.type === 'number') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (x !== null && y !== null) return x - y;
  }
  if (column.type === 'date') {
    const x = parseDate(a);
    const y = parseDate(b);
    if (x && y) return x.getTime() - y.getTime();
  }
  return collator(locale).compare(toLabel(a, locale), toLabel(b, locale));
}

export function inferColumns(rows: Datum[]): TableColumn[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 50)) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => {
    const type = inferColumnType(rows, key);
    return { key, header: humanize(key), type, align: type === 'number' ? 'right' : 'left' };
  });
}

export function sortRows<T extends Datum>(rows: T[], column: TableColumn | undefined, direction: SortDirection, locale: string): T[] {
  if (!column) return rows;
  const dir = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = a.row[column.key];
      const vb = b.row[column.key];
      const ba = isBlank(va);
      const bb = isBlank(vb);
      if (ba || bb) return ba && bb ? a.index - b.index : ba ? 1 : -1; // blanks always last
      return dir * compare(va, vb, column, locale) || a.index - b.index;
    })
    .map((x) => x.row);
}

/** Sortable, searchable, paginated table with formatted values and CSV/Excel/PDF export. */
export function DataTable<T extends Datum = Datum>(props: DataTableProps<T>) {
  const {
    query,
    queryOptions,
    columns: columnsProp,
    title,
    subtitle,
    actions,
    footer,
    downloads = true,
    fileName,
    pageSize = 10,
    defaultSort,
    searchable = false,
    searchPlaceholder = 'Search…',
    frame = true,
    maxHeight,
    emptyMessage,
    rowKey,
    onRowClick,
    caption,
    density = 'comfortable',
    className,
    style,
    span,
    includeInReport = true,
    headingLevel,
  } = props;
  const deck = useReportDeck();
  const { locale, currency, fontFamily } = deck.ctx;
  const q = useReportData(query ?? null, queryOptions);
  const usingQuery = !!query;
  const raw = useStableData(usingQuery ? q.data : props.data);
  const rows = useMemo(() => toRows(raw) as T[], [raw]);
  const columns = useMemo<DataTableColumn<T>[]>(() => columnsProp ?? (inferColumns(rows) as DataTableColumn<T>[]), [columnsProp, rows]);

  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(defaultSort ?? null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);

  const formatters = useMemo(() => columns.map((c) => createFormatter(c.format, { locale, currency })), [columns, locale, currency]);
  const display = (value: unknown, column: TableColumn, i: number): string => {
    if (isBlank(value)) return EMPTY_VALUE;
    if (column.type === 'number') {
      const n = toNumber(value);
      return n === null ? String(value) : formatters[i]!(n);
    }
    if (column.type === 'date') {
      const d = parseDate(value);
      return d ? formatDate(d, locale) : String(value);
    }
    return toLabel(value, locale);
  };

  const filtered = useMemo(() => {
    const needle = deferredSearch.trim().toLocaleLowerCase(locale);
    if (!needle) return rows;
    return rows.filter((row) => columns.some((c, i) => display(row[c.key], c, i).toLocaleLowerCase(locale).includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, deferredSearch, locale, formatters]);

  const sorted = useMemo(
    () => (sort ? sortRows(filtered, columns.find((c) => c.key === sort.key), sort.direction, locale) : filtered),
    [filtered, sort, columns, locale],
  );

  const paginated = pageSize > 0;
  const pageCount = paginated ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => setPage(0), [rows, deferredSearch, sort]);
  const visible = paginated ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  const exportColumns = useMemo<TableColumn[]>(() => columns.map(({ key, header, type, format, align }) => ({ key, header, type, format, align })), [columns]);
  const tableData: TableData = { columns: exportColumns, rows: sorted };
  const cardRef = useRef<HTMLElement>(null);
  useReportItem(() => ({ kind: 'table', title, subtitle, table: tableData }), cardRef, includeInReport && frame);

  const loading = props.loading ?? (usingQuery && q.isLoading);
  const error = props.error ?? (usingQuery ? q.error : undefined);
  const retry = props.onRetry ?? (usingQuery ? () => void q.refetch() : undefined);
  const refreshing = usingQuery && q.isRefreshing;
  const formats = downloads === false ? [] : downloads === true ? (['csv', 'xlsx', 'pdf'] as const) : downloads;
  const captionId = useId();
  const placeholderHeight = typeof maxHeight === 'number' ? Math.min(maxHeight, 280) : 280;

  const onDownload = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      await exportTable(tableData, format, {
        fileName: fileName ?? title ?? 'data',
        title,
        subtitle,
        locale,
        currency,
        pdfFont: deck.config.pdfFont,
      });
    } catch (e) {
      if (deck.config.onExportError) deck.config.onExportError(e);
      else console.error('[reportdeck] Table export failed', e);
    }
  };

  let body: ReactNode;
  if (loading && rows.length === 0) body = <Skeleton height={placeholderHeight} variant="table" />;
  else if (error && rows.length === 0) body = <ErrorState height={placeholderHeight} error={error} onRetry={retry} />;
  else if (rows.length === 0) body = <EmptyState height={placeholderHeight} message={emptyMessage} />;
  else {
    const keyFor = (row: T, i: number): string | number => {
      if (typeof rowKey === 'function') return rowKey(row, i);
      if (rowKey !== undefined) {
        const k = row[rowKey];
        if (typeof k === 'string' || typeof k === 'number') return k;
      }
      return (paginated ? safePage * pageSize : 0) + i;
    };
    body = (
      <>
        {error ? <StaleNotice error={error} onRetry={retry} /> : null}
        <div className={cx('rd-table__scroll', refreshing && 'is-refreshing')} style={{ maxHeight }} tabIndex={maxHeight ? 0 : undefined} aria-labelledby={captionId}>
          <table className={cx('rd-table', density === 'compact' && 'rd-table--compact')}>
            <caption id={captionId} className="rd-sr-only">
              {caption ?? title ?? 'Data table'}
              {sort ? `, sorted by ${columns.find((c) => c.key === sort.key)?.header ?? sort.key} ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}
            </caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const sortable = c.sortable ?? true;
                  const active = sort?.key === c.key ? sort.direction : null;
                  const align = c.align ?? (c.type === 'number' ? 'right' : 'left');
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      style={{ width: c.width, textAlign: align }}
                      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : sortable ? 'none' : undefined}
                    >
                      {sortable ? (
                        <button type="button" className={cx('rd-table__sort', align === 'right' && 'is-right')} onClick={() => toggleSort(c.key)}>
                          <span>{c.header}</span>
                          <SortIcon size={14} sortDirection={active} />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="rd-table__nomatch">
                    No rows match “{deferredSearch}”.
                  </td>
                </tr>
              ) : (
                visible.map((row, i) => (
                  <tr
                    key={keyFor(row, i)}
                    className={onRowClick ? 'is-clickable' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((c, ci) => {
                      const value = row[c.key];
                      const align = c.align ?? (c.type === 'number' ? 'right' : 'left');
                      return (
                        <td key={c.key} style={{ textAlign: align }} className={c.type === 'number' ? 'is-numeric' : undefined}>
                          {c.render ? c.render(value, row) : display(value, c, ci)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {paginated && sorted.length > pageSize ? (
          <nav className="rd-pagination" aria-label="Pagination">
            <span className="rd-pagination__info">
              {(safePage * pageSize + 1).toLocaleString(locale)}–{Math.min(sorted.length, (safePage + 1) * pageSize).toLocaleString(locale)} of{' '}
              {sorted.length.toLocaleString(locale)}
            </span>
            <button type="button" className="rd-icon-button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="rd-icon-button"
              aria-label="Next page"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRightIcon />
            </button>
          </nav>
        ) : null}
      </>
    );
  }

  const headerActions =
    actions || searchable || formats.length > 0 ? (
      <>
        {actions}
        {searchable && rows.length > 0 ? (
          <label className="rd-search">
            <SearchIcon size={14} />
            <input type="search" value={search} placeholder={searchPlaceholder} aria-label={searchPlaceholder} onChange={(e) => setSearch(e.target.value)} />
          </label>
        ) : null}
        {formats.length > 0 && rows.length > 0 ? <DownloadMenu formats={[...formats]} onSelect={onDownload} /> : null}
      </>
    ) : undefined;

  return (
    <Card
      ref={cardRef}
      mode={deck.mode}
      fontFamily={fontFamily}
      title={title}
      subtitle={subtitle}
      actions={headerActions}
      footer={footer}
      bare={!frame}
      busy={loading || refreshing}
      className={cx('rd-datatable', span === 2 && 'rd-span-2', span === 'full' && 'rd-span-full', className)}
      style={style}
      headingLevel={headingLevel}
    >
      {body}
    </Card>
  );
}
