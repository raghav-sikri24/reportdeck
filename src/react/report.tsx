import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { exportReport, type ReportEntry, type ReportExportFormat, type ReportExportOptions } from '../export';
import { cx } from './Card';
import { useReportDeck } from './context';
import { DownloadMenu } from './DownloadMenu';

interface Registered {
  getEntry: () => ReportEntry | null;
  element: () => Element | null;
}

interface ReportContextValue {
  register: (id: string, item: Registered) => () => void;
  exportAs: (format: ReportExportFormat, overrides?: Partial<ReportExportOptions>) => Promise<void>;
  exporting: ReportExportFormat | null;
}

const ReportContext = /* @__PURE__ */ createContext<ReportContextValue | null>(null);

/** Registers a chart/table/stat with the nearest <Report> so it's included in report exports. */
export function useReportItem(getEntry: () => ReportEntry | null, elementRef: RefObject<Element | null>, enabled = true): void {
  const ctx = useContext(ReportContext);
  const getter = useRef(getEntry);
  getter.current = getEntry;
  const id = useId();
  useEffect(() => {
    if (!ctx || !enabled) return;
    return ctx.register(id, { getEntry: () => getter.current(), element: () => elementRef.current });
  }, [ctx, id, enabled, elementRef]);
}

function byDocumentOrder(a: Element | null, b: Element | null): number {
  if (!a || !b || a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export interface ReportProps {
  title?: string;
  subtitle?: string;
  /** Download file name (without extension). Defaults to the title. */
  fileName?: string;
  /** Report-level download formats. `false` hides the button. Default `['pdf', 'xlsx']`. */
  downloads?: ReportExportFormat[] | false;
  /** Extra header content (filters, date pickers…). */
  actions?: ReactNode;
  /** Show the title/subtitle header. Default true. */
  header?: boolean;
  /** Grid columns: a number, or `auto` to fit cards ≥ 420px wide. Default `auto`. */
  columns?: number | 'auto';
  /** Options passed to every report export (orientation, page size, font…). */
  exportOptions?: Partial<ReportExportOptions>;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Lays out charts, tables and KPI cards, and exports all of them — in on-screen
 * order — as one PDF or Excel file.
 */
export function Report({
  title,
  subtitle,
  fileName,
  downloads = ['pdf', 'xlsx'],
  actions,
  header = true,
  columns = 'auto',
  exportOptions,
  className,
  style,
  children,
}: ReportProps) {
  const deck = useReportDeck();
  const registry = useRef(new Map<string, Registered>());
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const latest = useRef({ title, subtitle, fileName, exportOptions, deck });
  latest.current = { title, subtitle, fileName, exportOptions, deck };

  const register = useCallback((id: string, item: Registered) => {
    registry.current.set(id, item);
    return () => {
      registry.current.delete(id);
    };
  }, []);

  const exportAs = useCallback(async (format: ReportExportFormat, overrides: Partial<ReportExportOptions> = {}) => {
    const { title: t, subtitle: s, fileName: f, exportOptions: opts, deck: d } = latest.current;
    const entries = [...registry.current.values()]
      .map((item) => ({ item, el: item.element() }))
      .sort((a, b) => byDocumentOrder(a.el, b.el))
      .map(({ item }) => item.getEntry())
      .filter((e): e is ReportEntry => e !== null);
    setExporting(format);
    try {
      await exportReport(entries, format, {
        title: t,
        subtitle: s,
        fileName: f ?? t,
        locale: d.ctx.locale,
        currency: d.ctx.currency,
        fontFamily: d.ctx.fontFamily,
        pdfFont: d.config.pdfFont,
        ...opts,
        ...overrides,
      });
    } catch (error) {
      if (d.config.onExportError) d.config.onExportError(error);
      else console.error('[reportdeck] Report export failed', error);
      throw error;
    } finally {
      setExporting(null);
    }
  }, []);

  const value = useMemo(() => ({ register, exportAs, exporting }), [register, exportAs, exporting]);
  const showHeader = header && (title || subtitle || actions || downloads !== false);
  const gridStyle =
    columns === 'auto' ? undefined : ({ ['--rd-columns' as string]: String(Math.max(1, Math.floor(columns))) } as CSSProperties);

  return (
    <ReportContext.Provider value={value}>
      <div
        className={cx('rd-root', `rd-${deck.mode}`, 'rd-report', className)}
        style={{ ['--rd-font' as string]: deck.ctx.fontFamily, ...style }}
        aria-busy={exporting ? true : undefined}
      >
        {showHeader ? (
          <header className="rd-report__header">
            <div className="rd-card__heading">
              {title ? <h2 className="rd-report__title">{title}</h2> : null}
              {subtitle ? <p className="rd-card__subtitle">{subtitle}</p> : null}
            </div>
            <div className="rd-report__actions">
              {actions}
              {downloads !== false && downloads.length > 0 ? (
                <DownloadMenu
                  formats={downloads}
                  label="Download report"
                  showLabel
                  onSelect={(format) => exportAs(format).catch(() => undefined)}
                />
              ) : null}
            </div>
          </header>
        ) : null}
        <div className={cx('rd-report__grid', columns !== 'auto' && 'rd-report__grid--fixed')} style={gridStyle}>
          {children}
        </div>
      </div>
    </ReportContext.Provider>
  );
}

export interface UseReportResult {
  /** Exports every registered item. Throws if called outside <Report>. */
  exportReport: (format: ReportExportFormat, overrides?: Partial<ReportExportOptions>) => Promise<void>;
  exporting: ReportExportFormat | null;
  insideReport: boolean;
}

/** Trigger report exports from your own buttons. */
export function useReport(): UseReportResult {
  const ctx = useContext(ReportContext);
  return {
    exportReport: ctx?.exportAs ?? (() => Promise.reject(new Error('useReport() must be used inside <Report>'))),
    exporting: ctx?.exporting ?? null,
    insideReport: !!ctx,
  };
}
