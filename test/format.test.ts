import { describe, expect, it } from 'vitest';
import { contrastRatio, inkOn, mix, sampleRamp, withAlpha } from '../src/core/colors';
import { neutralizeFormula, parseCSV, toCSV } from '../src/core/csv';
import { sanitizeFilename, withExtension } from '../src/core/filename';
import { createAxisFormatter, createFormatter } from '../src/core/format';

const us = { locale: 'en-US', currency: 'USD' };
// Some ICU versions use narrow/no-break spaces; normalize for assertions.
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('createFormatter', () => {
  it('renders missing values as an em dash, never NaN or 0', () => {
    const f = createFormatter('number', us);
    expect(f(null)).toBe('—');
    expect(f(undefined)).toBe('—');
    expect(f(NaN)).toBe('—');
  });

  it('formats the built-in kinds', () => {
    expect(createFormatter('number', us)(1234.567)).toBe('1,234.57');
    expect(createFormatter('integer', us)(1234.567)).toBe('1,235');
    expect(createFormatter('compact', us)(1_250_000)).toBe('1.3M');
    expect(createFormatter('currency', us)(1234.5)).toBe('$1,234.50');
    expect(createFormatter('currency-compact', us)(4_200_000)).toBe('$4.2M');
    expect(createFormatter('percent', us)(0.256)).toBe('25.6%');
    expect(createFormatter({ type: 'percent', percentInput: 'whole' }, us)(25.6)).toBe('25.6%');
    expect(createFormatter({ type: 'number', decimals: 0, prefix: '~', suffix: ' kg' }, us)(12.4)).toBe('~12 kg');
  });

  it('supports Indian grouping and lakh/crore compact notation', () => {
    const inr = { locale: 'en-IN', currency: 'INR' };
    expect(norm(createFormatter('currency', inr)(1234567.5))).toBe('₹12,34,567.50');
    expect(norm(createFormatter('compact', inr)(1_500_000))).toMatch(/15L|15 L|1\.5M/);
  });

  it('degrades gracefully on bad locales and currency codes', () => {
    expect(createFormatter('number', { locale: 'not_a_locale!!', currency: 'USD' })(1000)).toBe('1,000');
    expect(() => createFormatter('currency', { locale: 'en-US', currency: 'NOPE1' })(5)).not.toThrow();
  });

  it('guards custom formatter functions', () => {
    const f = createFormatter(() => {
      throw new Error('boom');
    }, us);
    expect(f(5)).toBe('5');
    expect(createFormatter((v) => `${v}u`, us)(null)).toBe('—');
  });

  it('axis formatter compacts from 1,000 up and keeps units', () => {
    const f = createAxisFormatter('currency', us);
    expect(f(500)).toBe('$500');
    expect(f(0)).toBe('$0');
    expect(f(2.5)).toBe('$2.5');
    expect(f(2500)).toBe('$2.5K');
    expect(createAxisFormatter(undefined, us)(1000)).toBe('1K');
    expect(createAxisFormatter('percent', us)(0.5)).toBe('50%');
  });
});

describe('colors', () => {
  it('computes contrast and picks legible label ink', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(inkOn('#0d366b')).toBe('#ffffff');
    expect(inkOn('#cde2fb')).toBe('#0b0b0b');
  });

  it('mixes, samples and applies alpha', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(sampleRamp(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});

describe('CSV', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'amount', header: 'Amount', type: 'number' as const, format: 'currency' as const },
    { key: 'when', header: 'When', type: 'date' as const },
  ];

  it('quotes, escapes and adds a BOM + CRLF', () => {
    const csv = toCSV(columns, [{ name: 'Acme, "Inc"\nLtd', amount: 1200.5, when: '2024-01-05' }]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toBe('\ufeffName,Amount,When\r\n"Acme, ""Inc""\nLtd",1200.5,2024-01-05');
  });

  it('neutralizes formula injection but keeps plain negative numbers', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizeFormula('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(neutralizeFormula('-42')).toBe('-42');
    const csv = toCSV([{ key: 'v', header: 'v' }], [{ v: '+cmd|calc' }], { bom: false });
    expect(csv).toBe(`v\r\n'+cmd|calc`);
  });

  it('writes formatted values on request and blanks for null', () => {
    const csv = toCSV(columns, [{ name: null, amount: 5, when: null }], { bom: false, formatted: true });
    expect(csv.split('\r\n')[1]).toBe(',$5.00,');
  });

  it('round-trips through parseCSV, including quotes, newlines and duplicate headers', () => {
    const text = '\ufeffa,b,a\r\n"x, y","he said ""hi""","line1\nline2"\r\n1,,3\r\n';
    expect(parseCSV(text)).toEqual([
      { a: 'x, y', b: 'he said "hi"', a_2: 'line1\nline2' },
      { a: '1', b: '', a_2: '3' },
    ]);
    expect(parseCSV('')).toEqual([]);
  });
});

describe('filenames', () => {
  it('strips reserved characters and Windows device names', () => {
    expect(sanitizeFilename('Q3 / Revenue: "final"?')).toBe('Q3 Revenue final');
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('   ')).toBe('report');
    expect(sanitizeFilename('a'.repeat(300)).length).toBe(120);
  });

  it('adds an extension once', () => {
    expect(withExtension('sales', 'csv')).toBe('sales.csv');
    expect(withExtension('sales.CSV', 'csv')).toBe('sales.CSV');
  });
});
