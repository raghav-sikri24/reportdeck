import type { jsPDF as JsPDF } from 'jspdf';
import { parseDate, toNumber } from '../core/data';
import { createFormatter, EMPTY_VALUE, formatDate } from '../core/format';
import type { Datum, TableColumn } from '../core/types';

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfStat {
  label: string;
  value: string;
  delta?: string;
  tone?: 'up' | 'down' | 'neutral';
}

export type PdfBlock =
  | { kind: 'chart'; title?: string; subtitle?: string; image: PdfImage }
  | { kind: 'table'; title?: string; subtitle?: string; columns: TableColumn[]; rows: Datum[] }
  | { kind: 'stats'; items: PdfStat[] }
  | { kind: 'text'; title?: string; text: string };

export interface PdfFont {
  /** Font family name used inside the PDF. */
  family: string;
  /** TTF as base64 (optionally a data: URL) or a URL to fetch. */
  regular: string;
  bold?: string;
}

export interface PdfOptions {
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  pageSize?: 'a4' | 'letter';
  locale?: string;
  currency?: string;
  /**
   * A Unicode TTF font. Without it, PDFs use built-in Helvetica, which only
   * covers Western European text — other characters are transliterated
   * (₹ → "Rs") or replaced with "?".
   */
  font?: PdfFont;
  /** Tables longer than this are truncated with a note. Default 1000. */
  maxTableRows?: number;
  /** Shown under the title. Default: now. Pass `false` to hide. */
  generatedAt?: Date | false;
}

const MARGIN = 40;
const INK: [number, number, number] = [11, 11, 11];
const INK_2: [number, number, number] = [82, 81, 78];
const INK_3: [number, number, number] = [107, 106, 102];
const RULE: [number, number, number] = [225, 224, 217];
const UP: [number, number, number] = [0, 99, 0];
const DOWN: [number, number, number] = [208, 59, 59];

// Characters Windows-1252 (Helvetica's encoding) can represent beyond Latin-1.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•\u2013—˜™š›œžŸ');

// Common symbols outside WinAnsi, transliterated instead of becoming "?".
const TRANSLITERATE: Record<string, string> = {
  '\u2192': '->',
  '\u2190': '<-',
  '\u2191': '^',
  '\u2193': 'v',
  '\u21d2': '=>',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2260': '!=',
  '\u2248': '~',
  '\u2318': 'Cmd',
  '\u2325': 'Alt',
  '\u21e7': 'Shift',
  '\u2713': 'v',
  '\u2714': 'v',
  '\u2717': 'x',
  '\u25b2': '^',
  '\u25bc': 'v',
  '\u2010': '-',
  '\u2011': '-',
};

/** Makes text safe for jsPDF's built-in fonts (WinAnsi). */
export function toPdfSafeText(input: string): string {
  const mapped = input
    .replace(/[\u2010\u2011\u2190-\u21ff\u2248\u2260\u2264\u2265\u2318\u2325\u2713\u2714\u2717\u25b2\u25bc]/g, (c) => TRANSLITERATE[c] ?? c)
    .replace(/\u2212/g, '-')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/₹\s?/g, 'Rs ')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
  let out = '';
  for (const ch of mapped) {
    const code = ch.codePointAt(0)!;
    const ok = code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch);
    out += ok ? ch : '?';
  }
  return out;
}

async function toBase64Font(source: string): Promise<string> {
  if (/^data:/.test(source)) return source.slice(source.indexOf(',') + 1);
  if (/^(https?:)?\/\/|^\.{0,2}\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not load PDF font (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
  return source;
}

function cellText(value: unknown, column: TableColumn, fmt: (v: number | null) => string, locale: string): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  if (column.type === 'date' || value instanceof Date) {
    const d = parseDate(value);
    return d ? formatDate(d, locale) : String(value);
  }
  if (column.type === 'number') {
    const n = toNumber(value);
    return n === null ? String(value) : fmt(n);
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Builds a multi-page PDF report. Works in the browser and in Node. */
export async function buildPdf(blocks: PdfBlock[], options: PdfOptions = {}): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const locale = options.locale ?? 'en-US';
  const currency = options.currency ?? 'USD';
  const maxRows = Math.max(1, options.maxTableRows ?? 1000);

  const doc: JsPDF = new jsPDF({
    orientation: options.orientation ?? 'portrait',
    unit: 'pt',
    format: options.pageSize ?? 'a4',
    compress: true,
  });

  let family = 'helvetica';
  if (options.font) {
    const regular = await toBase64Font(options.font.regular);
    doc.addFileToVFS(`${options.font.family}-Regular.ttf`, regular);
    doc.addFont(`${options.font.family}-Regular.ttf`, options.font.family, 'normal');
    const bold = options.font.bold ? await toBase64Font(options.font.bold) : regular;
    doc.addFileToVFS(`${options.font.family}-Bold.ttf`, bold);
    doc.addFont(`${options.font.family}-Bold.ttf`, options.font.family, 'bold');
    family = options.font.family;
  }
  const safe = options.font ? (s: string) => s : toPdfSafeText;

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const bottomLimit = pageH - MARGIN - 18; // keep clear of the footer
  let y = MARGIN;

  const text = (s: string, x: number, yy: number, size: number, color: [number, number, number], style: 'normal' | 'bold' = 'normal', maxWidth = contentW) => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(safe(s), maxWidth) as string[];
    doc.text(lines, x, yy, { baseline: 'top' });
    return lines.length * size * 1.25;
  };
  const ensure = (h: number) => {
    if (y + h > bottomLimit && y > MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const heading = (title?: string, subtitle?: string) => {
    if (!title && !subtitle) return;
    if (title) y += text(title, MARGIN, y, 12, INK, 'bold') + 2;
    if (subtitle) y += text(subtitle, MARGIN, y, 9, INK_2) + 2;
    y += 6;
  };

  // ---- document header ----
  if (options.title) {
    y += text(options.title, MARGIN, y, 18, INK, 'bold') + 4;
  }
  if (options.subtitle) y += text(options.subtitle, MARGIN, y, 11, INK_2) + 2;
  if (options.generatedAt !== false && (options.title || options.subtitle)) {
    const when = options.generatedAt ?? new Date();
    y += text(`Generated ${formatDate(when, locale, true)}`, MARGIN, y, 8.5, INK_3) + 4;
  }
  if (options.title || options.subtitle) {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, pageW - MARGIN, y);
    y += 18;
  }

  for (const block of blocks) {
    if (block.kind === 'stats') {
      if (block.items.length === 0) continue;
      const cols = Math.min(4, block.items.length);
      const gap = 10;
      const boxW = (contentW - gap * (cols - 1)) / cols;
      const boxH = 58;
      for (let i = 0; i < block.items.length; i += cols) {
        ensure(boxH + 12);
        block.items.slice(i, i + cols).forEach((stat, k) => {
          const x = MARGIN + k * (boxW + gap);
          doc.setDrawColor(...RULE);
          doc.setLineWidth(0.75);
          doc.roundedRect(x, y, boxW, boxH, 6, 6, 'S');
          doc.setFont(family, 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...INK_3);
          doc.text(doc.splitTextToSize(safe(stat.label), boxW - 20)[0] ?? '', x + 10, y + 10, { baseline: 'top' });
          doc.setFont(family, 'bold');
          doc.setFontSize(15);
          doc.setTextColor(...INK);
          doc.text(doc.splitTextToSize(safe(stat.value), boxW - 20)[0] ?? '', x + 10, y + 23, { baseline: 'top' });
          if (stat.delta) {
            doc.setFont(family, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(...(stat.tone === 'up' ? UP : stat.tone === 'down' ? DOWN : INK_3));
            doc.text(doc.splitTextToSize(safe(stat.delta), boxW - 20)[0] ?? '', x + 10, y + 43, { baseline: 'top' });
          }
        });
        y += boxH + 12;
      }
      y += 8;
      continue;
    }

    if (block.kind === 'text') {
      ensure(40);
      heading(block.title);
      y += text(block.text, MARGIN, y, 10, INK_2) + 14;
      continue;
    }

    if (block.kind === 'chart') {
      const ratio = block.image.height / Math.max(1, block.image.width);
      const maxH = bottomLimit - MARGIN - 40;
      let w = contentW;
      let h = w * ratio;
      if (h > maxH) {
        h = maxH;
        w = h / ratio;
      }
      ensure(h + (block.title ? 30 : 0) + (block.subtitle ? 14 : 0));
      heading(block.title, block.subtitle);
      // JPEG embeds as-is (fast, small); PNG must be re-encoded by jsPDF.
      const imageType = block.image.dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(block.image.dataUrl, imageType, MARGIN + (contentW - w) / 2, y, w, h, undefined, 'FAST');
      y += h + 22;
      continue;
    }

    // table
    const columns = block.columns;
    const rows = block.rows.length > maxRows ? block.rows.slice(0, maxRows) : block.rows;
    ensure(80);
    heading(block.title, block.subtitle);
    if (columns.length === 0 || rows.length === 0) {
      y += text('No data', MARGIN, y, 9, INK_3) + 14;
      continue;
    }
    const fmts = columns.map((c) => createFormatter(c.format, { locale, currency }));
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 18 },
      head: [columns.map((c) => safe(c.header))],
      body: rows.map((row) => columns.map((c, i) => safe(cellText(row[c.key], c, fmts[i]!, locale)))),
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: {
        font: family,
        fontSize: 8.5,
        cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
        textColor: INK,
        lineColor: RULE,
        lineWidth: 0,
        overflow: 'linebreak',
      },
      headStyles: { fillColor: [240, 239, 236], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 248] },
      columnStyles: Object.fromEntries(
        columns.map((c, i) => [i, { halign: c.align ?? (c.type === 'number' ? 'right' : 'left') }]),
      ),
      // Header cells align with their column (numbers right-aligned).
      didParseCell: (data) => {
        if (data.section !== 'head') return;
        const c = columns[data.column.index];
        if (c) data.cell.styles.halign = c.align ?? (c.type === 'number' ? 'right' : 'left');
      },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
    if (block.rows.length > rows.length) {
      ensure(20);
      y += text(
        `Showing the first ${rows.length.toLocaleString(locale)} of ${block.rows.length.toLocaleString(locale)} rows. Download Excel for the full data.`,
        MARGIN,
        y,
        8,
        INK_3,
      );
    }
    y += 16;
  }

  // ---- footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(family, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK_3);
    if (options.title) {
      doc.text(doc.splitTextToSize(safe(options.title), contentW * 0.7)[0] ?? '', MARGIN, pageH - MARGIN + 10, { baseline: 'top' });
    }
    doc.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - MARGIN + 10, { baseline: 'top', align: 'right' });
  }

  doc.setProperties({ title: safe(options.title ?? 'Report'), creator: 'reportdeck' });
  return doc.output('arraybuffer');
}
