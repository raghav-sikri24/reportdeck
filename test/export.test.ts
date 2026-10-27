import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, sanitizeSheetName, toExcelDate } from '../src/export/excel';
import { buildPdf, toPdfSafeText } from '../src/export/pdf';
import { renderToSVG } from '../src/export/image';
import { buildCartesian } from '../src/core/builders/cartesian';
import { createBuildContext } from '../src/core/builders/common';
import { registerAll } from '../src/core/modules';
import type { TableColumn } from '../src/core/types';

const columns: TableColumn[] = [
  { key: 'day', header: 'Day', type: 'date' },
  { key: 'region', header: 'Region', type: 'string' },
  { key: 'revenue', header: 'Revenue', type: 'number', format: 'currency' },
  { key: 'share', header: 'Share', type: 'number', format: { type: 'percent', percentInput: 'whole' } },
];
const rows = [
  { day: '2024-01-05', region: '=cmd()', revenue: '1,234.5', share: 25 },
  { day: null, region: 'x'.repeat(40_000), revenue: null, share: 'n/a' },
];

describe('Excel export', () => {
  it('writes typed cells, native number formats and safe sheet names', async () => {
    const { buffer, warnings } = await buildWorkbook(
      [
        { name: 'Sales: Q1/Q2 [final]', title: 'Sales', subtitle: 'By day', columns, rows },
        { name: 'Sales: Q1/Q2 [final]', columns, rows: [] },
        { name: 'History', columns, rows: [] },
      ],
      { locale: 'en-IN', currency: 'INR' },
    );
    expect(warnings).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sales Q1 Q2 final', 'Sales Q1 Q2 final (2)', 'History data']);

    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('Sales');
    expect(ws.getRow(4).values).toEqual([undefined, 'Day', 'Region', 'Revenue', 'Share']);
    const day = ws.getCell('A5').value as Date;
    expect(day.toISOString()).toBe('2024-01-05T00:00:00.000Z'); // wall-clock date, no timezone shift
    expect(ws.getCell('A5').numFmt).toBe('yyyy-mm-dd');
    expect(ws.getCell('B5').value).toBe('=cmd()'); // stored as text, never as a formula
    expect(ws.getCell('C5').value).toBe(1234.5);
    expect(ws.getCell('C5').numFmt).toContain('₹');
    expect(ws.getCell('D5').value).toBeCloseTo(0.25);
    expect(ws.getCell('D5').numFmt).toBe('0.0%');
    expect((ws.getCell('B6').value as string).length).toBe(32_767); // Excel cell limit
    expect(ws.getCell('D6').value).toBe('n/a');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
  });

  it('sanitizeSheetName', () => {
    const used = new Set<string>();
    expect(sanitizeSheetName("'quoted'", used)).toBe('quoted');
    expect(sanitizeSheetName('', used)).toBe('Sheet');
    expect(sanitizeSheetName('a'.repeat(40), used)).toHaveLength(31);
    expect(sanitizeSheetName('a'.repeat(40), used)).toBe(`${'a'.repeat(27)} (2)`);
  });

  it('toExcelDate keeps the local wall-clock time', () => {
    expect(toExcelDate(new Date(2024, 0, 5, 9, 30)).toISOString()).toBe('2024-01-05T09:30:00.000Z');
  });
});

describe('PDF export', () => {
  it('produces a multi-page PDF with stats, text and long tables', async () => {
    const big = Array.from({ length: 1200 }, (_, i) => ({ day: '2024-01-05', region: `R${i}`, revenue: i * 10, share: i % 100 }));
    const buffer = await buildPdf(
      [
        { kind: 'stats', items: [{ label: 'Revenue', value: '₹12.3L', delta: '+4.2% vs last month', tone: 'up' }] },
        { kind: 'text', title: 'Notes', text: 'All figures are provisional.' },
        { kind: 'table', title: 'Daily revenue', columns, rows: big },
      ],
      { title: 'Monthly report — ₹ summary', locale: 'en-IN', currency: 'INR', maxTableRows: 500 },
    );
    const text = Buffer.from(buffer).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    const pages = (text.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(5);
  });

  it('transliterates characters Helvetica cannot draw', () => {
    expect(toPdfSafeText('₹1,23,456')).toBe('Rs 1,23,456');
    expect(toPdfSafeText('\u22125\u202f%')).toBe('-5 %');
    expect(toPdfSafeText('café – “ok” €')).toBe('café – “ok” €');
    expect(toPdfSafeText('日本')).toBe('??');
    expect(toPdfSafeText('Ctrl/\u2318 \u2192 zoom \u2264 5')).toBe('Ctrl/Cmd -> zoom <= 5');
  });
});

describe('SVG export', () => {
  it('adds an escaped title header around the chart', () => {
    registerAll();
    const model = buildCartesian('bar', { data: [{ x: 'a', v: 1 }], x: 'x', series: ['v'] }, createBuildContext());
    const svg = renderToSVG(model.option, { title: 'Sales <2024>', subtitle: 'A & B', width: 400, height: 200 });
    expect(svg).toContain('Sales &lt;2024&gt;');
    expect(svg).toContain('A &amp; B');
    expect(svg).toMatch(/^<svg[^>]+width="432" height="280"/);
  });
});
