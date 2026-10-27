import type { Workbook, Worksheet } from 'exceljs';
import { parseDate, toNumber } from '../core/data';
import { createFormatter, formatOptions, formatKind, hasTimeComponent } from '../core/format';
import type { Datum, TableColumn } from '../core/types';

export interface SheetSpec {
  name: string;
  title?: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: Datum[];
  /** Optional chart image placed to the right of the data. */
  image?: { dataUrl: string; width: number; height: number };
}

export interface ExcelOptions {
  locale?: string;
  currency?: string;
  creator?: string;
}

export interface WorkbookResult {
  buffer: ArrayBuffer;
  warnings: string[];
}

const MAX_ROWS = 1_048_576;
const MAX_CELL_CHARS = 32_767;
const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Excel sheet names: ≤ 31 chars, no []:*?/\, no leading/trailing apostrophe, unique, not "History". */
export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
  if (!base) base = 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History data';
  base = base.slice(0, 31).trim();
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function currencySymbol(code: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

function decimalsPattern(decimals: number): string {
  return decimals > 0 ? `.${'0'.repeat(Math.min(10, decimals))}` : '';
}

/** Maps a value format to a native Excel number format so cells stay numeric (sortable, summable). */
export function excelNumberFormat(column: TableColumn, rows: Datum[], locale: string, currency: string): string {
  const kind = formatKind(column.format);
  const opts = formatOptions(column.format);
  switch (kind) {
    case 'currency':
    case 'currency-compact': {
      const symbol = currencySymbol(opts.currency ?? currency, locale).replace(/"/g, '');
      const body = `#,##0${decimalsPattern(opts.decimals ?? 2)}`;
      return `"${symbol}"${body};-"${symbol}"${body}`;
    }
    case 'percent':
      return `0${decimalsPattern(opts.decimals ?? 1)}%`;
    case 'compact':
      return '[>=1000000]#,##0.0,,"M";[>=1000]#,##0.0,"K";#,##0';
    case 'integer':
      return '#,##0';
    default: {
      if (opts.decimals !== undefined) return `#,##0${decimalsPattern(opts.decimals)}`;
      const allIntegers = rows.slice(0, 1000).every((r) => {
        const n = toNumber(r[column.key]);
        return n === null || Number.isInteger(n);
      });
      return allIntegers ? '#,##0' : '#,##0.00';
    }
  }
}

/**
 * Excel stores dates without a timezone and exceljs converts via UTC, which
 * shifts local dates by the UTC offset (IST midnight → previous day 18:30).
 * Re-anchor the wall-clock time at UTC so the sheet shows what the user saw.
 */
export function toExcelDate(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  );
}

function cellValue(value: unknown, column: TableColumn): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (column.type === 'date' || value instanceof Date) {
    const d = parseDate(value);
    return d ? toExcelDate(d) : String(value);
  }
  if (column.type === 'number') {
    const n = toNumber(value);
    if (n === null) return typeof value === 'string' ? value.slice(0, MAX_CELL_CHARS) : null;
    if (formatKind(column.format) === 'custom') return n;
    const opts = formatOptions(column.format);
    return opts.type === 'percent' && opts.percentInput === 'whole' ? n / 100 : n;
  }
  let text: string;
  if (typeof value === 'object') {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
}

interface ExcelModule {
  Workbook: new () => Workbook;
}

async function loadExcelJS(): Promise<ExcelModule> {
  // exceljs is CommonJS: depending on the bundler the class sits on the namespace or on `default`.
  const mod = (await import('exceljs')) as unknown as ExcelModule & { default?: ExcelModule };
  return mod.default ?? mod;
}

function addSheet(wb: Workbook, spec: SheetSpec, used: Set<string>, opts: Required<ExcelOptions>, warnings: string[]): void {
  const ws: Worksheet = wb.addWorksheet(sanitizeSheetName(spec.name, used));
  const { locale, currency } = opts;
  let rowIndex = 1;
  if (spec.title) {
    ws.getCell(rowIndex, 1).value = spec.title;
    ws.getCell(rowIndex, 1).font = { bold: true, size: 14 };
    rowIndex++;
    if (spec.subtitle) {
      ws.getCell(rowIndex, 1).value = spec.subtitle;
      ws.getCell(rowIndex, 1).font = { color: { argb: 'FF52514E' } };
      rowIndex++;
    }
    rowIndex++;
  }

  const headerRow = rowIndex;
  const columns = spec.columns.length > 0 ? spec.columns : [{ key: 'value', header: 'Value' }];
  columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFEC' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC3C2B7' } } };
    cell.alignment = { vertical: 'middle', horizontal: c.type === 'number' ? 'right' : 'left' };
  });

  const capacity = MAX_ROWS - headerRow;
  const rows = spec.rows.length > capacity ? spec.rows.slice(0, capacity) : spec.rows;
  if (rows.length < spec.rows.length) {
    warnings.push(`"${spec.name}" was truncated to ${capacity.toLocaleString()} rows (Excel's limit).`);
  }

  const numFmts = columns.map((c) => (c.type === 'number' ? excelNumberFormat(c, rows, locale, currency) : undefined));
  const dateHasTime = columns.map((c) =>
    c.type === 'date'
      ? rows.slice(0, 1000).some((r) => {
          const d = parseDate(r[c.key]);
          return d ? hasTimeComponent(d) : false;
        })
      : false,
  );
  const formatters = columns.map((c) => createFormatter(c.format, { locale, currency }));

  rows.forEach((row, r) => {
    const excelRow = ws.getRow(headerRow + 1 + r);
    columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const v = cellValue(row[c.key], c);
      cell.value = v;
      if (typeof v === 'number' && numFmts[i]) cell.numFmt = numFmts[i]!;
      if (v instanceof Date) cell.numFmt = dateHasTime[i] ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
    });
  });

  // Column widths from header + sampled formatted values.
  columns.forEach((c, i) => {
    let width = c.header.length;
    for (const row of rows.slice(0, 500)) {
      const raw = row[c.key];
      const n = c.type === 'number' ? toNumber(raw) : null;
      const text = n !== null ? formatters[i]!(n) : raw instanceof Date ? '2024-01-01 00:00' : String(raw ?? '');
      width = Math.max(width, text.length);
    }
    ws.getColumn(i + 1).width = Math.min(60, Math.max(8, width + 2));
  });

  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0 }];
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: columns.length },
    };
  }

  if (spec.image) {
    const id = wb.addImage({ base64: spec.image.dataUrl, extension: 'png' });
    ws.addImage(id, {
      tl: { col: columns.length + 1, row: headerRow - 1 },
      ext: { width: spec.image.width, height: spec.image.height },
    });
  }
}

/** Builds an .xlsx workbook. Works in the browser and in Node. */
export async function buildWorkbook(sheets: SheetSpec[], options: ExcelOptions = {}): Promise<WorkbookResult> {
  const ExcelJS = await loadExcelJS();
  const opts: Required<ExcelOptions> = {
    locale: options.locale ?? 'en-US',
    currency: options.currency ?? 'USD',
    creator: options.creator ?? 'reportdeck',
  };
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.creator;
  wb.created = new Date();
  const used = new Set<string>();
  const warnings: string[] = [];
  const list = sheets.length > 0 ? sheets : [{ name: 'Data', columns: [], rows: [] }];
  for (const sheet of list) addSheet(wb, sheet, used, opts, warnings);
  const out = await wb.xlsx.writeBuffer();
  const buffer = out instanceof ArrayBuffer ? out : (new Uint8Array(out as ArrayLike<number>).buffer as ArrayBuffer);
  return { buffer, warnings };
}
