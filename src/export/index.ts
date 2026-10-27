import { toCSV } from '../core/csv';
import { withExtension } from '../core/filename';
import type { ChartModel, TableData } from '../core/types';
import { dataUrlToBlob, downloadBlob, MIME } from './download';
import { buildWorkbook, type SheetSpec } from './excel';
import { renderToImage, renderToSVG } from './image';
import { buildPdf, type PdfBlock, type PdfFont, type PdfStat } from './pdf';

export { dataUrlToBlob, downloadBlob, downloadText, isBrowser, MIME } from './download';
export { renderToImage, renderToSVG } from './image';
export type { ImageRenderOptions } from './image';
export { buildWorkbook, excelNumberFormat, sanitizeSheetName, toExcelDate } from './excel';
export type { ExcelOptions, SheetSpec, WorkbookResult } from './excel';
export { buildPdf, toPdfSafeText } from './pdf';
export type { PdfBlock, PdfFont, PdfImage, PdfOptions, PdfStat } from './pdf';

export type ImageFormat = 'png' | 'jpeg' | 'svg';
export type DataFormat = 'csv' | 'xlsx';
export type ChartExportFormat = ImageFormat | DataFormat | 'pdf';
export type ReportExportFormat = 'pdf' | 'xlsx';

export interface ExportContext {
  locale?: string;
  currency?: string;
  fontFamily?: string;
  /** Unicode TTF for PDFs (needed for ₹, non-Latin scripts, emoji-free CJK, …). */
  pdfFont?: PdfFont;
}

export interface ChartExportOptions extends ExportContext {
  fileName?: string;
  title?: string;
  subtitle?: string;
  /** Image size in CSS px. Default 960 × 480. */
  width?: number;
  height?: number;
  pixelRatio?: number;
  /** Embed the chart image next to the data in Excel. Default true. */
  excelImage?: boolean;
}

export interface ExportedFile {
  blob: Blob;
  fileName: string;
}

const fallbackName = (title?: string) => title || 'chart';

/** Produces a chart file without downloading it — e.g. to upload or attach to an email. */
export async function renderChartFile(
  model: ChartModel,
  format: ChartExportFormat,
  options: ChartExportOptions = {},
): Promise<ExportedFile> {
  const name = options.fileName ?? fallbackName(options.title);
  const image = {
    width: options.width ?? 960,
    height: options.height ?? 480,
    pixelRatio: options.pixelRatio,
    title: options.title,
    subtitle: options.subtitle,
    fontFamily: options.fontFamily,
  };
  switch (format) {
    case 'png':
    case 'jpeg': {
      const url = await renderToImage(model.option, format, image);
      return { blob: dataUrlToBlob(url), fileName: withExtension(name, format === 'jpeg' ? 'jpg' : 'png') };
    }
    case 'svg':
      return { blob: new Blob([renderToSVG(model.option, image)], { type: MIME.svg }), fileName: withExtension(name, 'svg') };
    case 'csv':
      return renderTableFile(model.table, 'csv', { ...options, fileName: name });
    case 'xlsx': {
      const sheet: SheetSpec = {
        name: options.title || 'Data',
        title: options.title,
        subtitle: options.subtitle,
        ...model.table,
      };
      if ((options.excelImage ?? true) && !model.isEmpty) {
        sheet.image = {
          dataUrl: await renderToImage(model.option, 'png', {
            ...image,
            title: undefined,
            width: 720,
            height: (720 * image.height) / image.width,
            pixelRatio: 1.5,
            background: '#ffffff',
          }),
          width: 720,
          height: (720 * image.height) / image.width,
        };
      }
      const { buffer } = await buildWorkbook([sheet], options);
      return { blob: new Blob([buffer], { type: MIME.xlsx }), fileName: withExtension(name, 'xlsx') };
    }
    case 'pdf': {
      const blocks: PdfBlock[] = [];
      if (!model.isEmpty) {
        blocks.push({
          kind: 'chart',
          image: {
            dataUrl: await renderToImage(model.option, 'jpeg', { ...image, title: undefined, subtitle: undefined, background: '#ffffff' }),
            width: image.width,
            height: image.height,
          },
        });
      }
      blocks.push({ kind: 'table', title: 'Data', ...model.table });
      const buffer = await buildPdf(blocks, {
        title: options.title,
        subtitle: options.subtitle,
        locale: options.locale,
        currency: options.currency,
        font: options.pdfFont,
      });
      return { blob: new Blob([buffer], { type: MIME.pdf }), fileName: withExtension(name, 'pdf') };
    }
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }
}

export async function exportChart(model: ChartModel, format: ChartExportFormat, options: ChartExportOptions = {}): Promise<void> {
  const file = await renderChartFile(model, format, options);
  downloadBlob(file.blob, file.fileName);
}

export interface TableExportOptions extends ExportContext {
  fileName?: string;
  title?: string;
  subtitle?: string;
  /** CSV: formatted display values instead of raw numbers. */
  formatted?: boolean;
  delimiter?: string;
}

export async function renderTableFile(
  table: TableData,
  format: DataFormat | 'pdf',
  options: TableExportOptions = {},
): Promise<ExportedFile> {
  const name = options.fileName ?? (options.title || 'data');
  if (format === 'csv') {
    const csv = toCSV(table.columns, table.rows, {
      locale: options.locale,
      currency: options.currency,
      formatted: options.formatted,
      delimiter: options.delimiter,
    });
    return { blob: new Blob([csv], { type: MIME.csv }), fileName: withExtension(name, 'csv') };
  }
  if (format === 'xlsx') {
    const { buffer } = await buildWorkbook([{ name: options.title || 'Data', title: options.title, subtitle: options.subtitle, ...table }], options);
    return { blob: new Blob([buffer], { type: MIME.xlsx }), fileName: withExtension(name, 'xlsx') };
  }
  const buffer = await buildPdf([{ kind: 'table', ...table }], {
    title: options.title,
    subtitle: options.subtitle,
    locale: options.locale,
    currency: options.currency,
    font: options.pdfFont,
  });
  return { blob: new Blob([buffer], { type: MIME.pdf }), fileName: withExtension(name, 'pdf') };
}

export async function exportTable(table: TableData, format: DataFormat | 'pdf', options: TableExportOptions = {}): Promise<void> {
  const file = await renderTableFile(table, format, options);
  downloadBlob(file.blob, file.fileName);
}

export type ReportEntry =
  | { kind: 'chart'; title?: string; subtitle?: string; model: ChartModel; height?: number }
  | { kind: 'table'; title?: string; subtitle?: string; table: TableData }
  | { kind: 'stat'; stat: PdfStat };

export interface ReportExportOptions extends ExportContext {
  fileName?: string;
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  pageSize?: 'a4' | 'letter';
  maxTableRows?: number;
  /** Embed chart images in the Excel workbook. Default true. */
  excelImages?: boolean;
}

const REPORT_IMAGE_WIDTH = 1000;

/** Builds a multi-section PDF or Excel report from charts, tables and KPI stats. */
export async function renderReportFile(
  entries: ReportEntry[],
  format: ReportExportFormat,
  options: ReportExportOptions = {},
): Promise<ExportedFile> {
  const name = options.fileName ?? (options.title || 'report');
  const imageFor = async (model: ChartModel, height = 360, type: 'png' | 'jpeg' = 'png') => {
    const h = Math.round((REPORT_IMAGE_WIDTH * height) / 760);
    return {
      dataUrl: await renderToImage(model.option, type, {
        width: REPORT_IMAGE_WIDTH,
        height: h,
        fontFamily: options.fontFamily,
        background: '#ffffff',
        pixelRatio: type === 'png' ? 1.5 : 2,
      }),
      width: REPORT_IMAGE_WIDTH,
      height: h,
    };
  };

  if (format === 'pdf') {
    const blocks: PdfBlock[] = [];
    let stats: PdfStat[] = [];
    const flushStats = () => {
      if (stats.length) blocks.push({ kind: 'stats', items: stats });
      stats = [];
    };
    for (const entry of entries) {
      if (entry.kind === 'stat') {
        stats.push(entry.stat);
        continue;
      }
      flushStats();
      if (entry.kind === 'chart') {
        if (entry.model.isEmpty) {
          blocks.push({ kind: 'text', title: entry.title, text: 'No data to display.' });
        } else {
          blocks.push({ kind: 'chart', title: entry.title, subtitle: entry.subtitle, image: await imageFor(entry.model, entry.height, 'jpeg') });
        }
      } else {
        blocks.push({ kind: 'table', title: entry.title, subtitle: entry.subtitle, ...entry.table });
      }
    }
    flushStats();
    const buffer = await buildPdf(blocks, {
      title: options.title,
      subtitle: options.subtitle,
      orientation: options.orientation,
      pageSize: options.pageSize,
      locale: options.locale,
      currency: options.currency,
      font: options.pdfFont,
      maxTableRows: options.maxTableRows,
    });
    return { blob: new Blob([buffer], { type: MIME.pdf }), fileName: withExtension(name, 'pdf') };
  }

  const sheets: SheetSpec[] = [];
  const statEntries = entries.filter((e): e is Extract<ReportEntry, { kind: 'stat' }> => e.kind === 'stat');
  if (statEntries.length > 0) {
    sheets.push({
      name: 'Summary',
      title: options.title,
      subtitle: options.subtitle,
      columns: [
        { key: 'label', header: 'Metric', type: 'string' },
        { key: 'value', header: 'Value', type: 'string' },
        { key: 'delta', header: 'Change', type: 'string' },
      ],
      rows: statEntries.map((e) => ({ label: e.stat.label, value: e.stat.value, delta: e.stat.delta ?? '' })),
    });
  }
  let index = 1;
  for (const entry of entries) {
    if (entry.kind === 'stat') continue;
    const title = entry.title || `${entry.kind === 'chart' ? 'Chart' : 'Table'} ${index}`;
    index++;
    if (entry.kind === 'chart') {
      const sheet: SheetSpec = { name: title, title, subtitle: entry.subtitle, ...entry.model.table };
      if ((options.excelImages ?? true) && !entry.model.isEmpty) {
        const img = await imageFor(entry.model, entry.height);
        sheet.image = { dataUrl: img.dataUrl, width: 640, height: Math.round((640 * img.height) / img.width) };
      }
      sheets.push(sheet);
    } else {
      sheets.push({ name: title, title, subtitle: entry.subtitle, ...entry.table });
    }
  }
  const { buffer } = await buildWorkbook(sheets, options);
  return { blob: new Blob([buffer], { type: MIME.xlsx }), fileName: withExtension(name, 'xlsx') };
}

export async function exportReport(entries: ReportEntry[], format: ReportExportFormat, options: ReportExportOptions = {}): Promise<void> {
  const file = await renderReportFile(entries, format, options);
  downloadBlob(file.blob, file.fileName);
}
