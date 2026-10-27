import { describe, expect, it } from 'vitest';
import {
  createDateLabeler,
  inferColumnType,
  niceCeil,
  parseDate,
  resolveSeries,
  resolveXType,
  stableStringify,
  toLabel,
  toNumber,
  toRows,
} from '../src/core/data';
import { humanize } from '../src/core/format';

describe('toNumber', () => {
  it.each([
    [42, 42],
    [-3.5, -3.5],
    ['1,234.56', 1234.56],
    ['  1 234 ', 1234],
    ['₹ 1,23,456', 123456],
    ['$-5', -5],
    ['-$5', -5],
    ['12.5%', 12.5],
    ['(1,234)', -1234],
    ['1.234,56', 1234.56],
    ['12,5', 12.5],
    ['\u22127', -7],
    ['1e3', 1000],
  ])('parses %j → %j', (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });

  it('parses bigint', () => {
    expect(toNumber(10n)).toBe(10);
  });

  it.each([null, undefined, '', '   ', 'abc', '12 apples', '0x10', 'Infinity', NaN, Infinity, -Infinity, true, {}, [], new Date()])(
    'returns null for %j',
    (input) => {
      expect(toNumber(input)).toBeNull();
    },
  );
});

describe('parseDate', () => {
  it('treats YYYY-MM-DD as a local calendar date (no UTC shift)', () => {
    const d = parseDate('2024-01-05')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2024, 0, 5, 0]);
  });

  it('parses year-month and full ISO timestamps', () => {
    expect(parseDate('2024-03')!.getMonth()).toBe(2);
    expect(parseDate('2024-03-01T10:30:00Z')!.getTime()).toBe(Date.UTC(2024, 2, 1, 10, 30));
  });

  it('rejects impossible dates instead of rolling over', () => {
    expect(parseDate('2024-02-31')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(new Date('invalid'))).toBeNull();
  });

  it('handles epoch seconds, milliseconds and years', () => {
    expect(parseDate(1_700_000_000)!.getTime()).toBe(1_700_000_000_000);
    expect(parseDate(1_700_000_000_000)!.getTime()).toBe(1_700_000_000_000);
    expect(parseDate(2023)!.getFullYear()).toBe(2023);
  });
});

describe('createDateLabeler', () => {
  it('picks one granularity for the whole series', () => {
    const months = [new Date(2024, 0, 1), new Date(2024, 1, 1)];
    expect(createDateLabeler(months, 'en-US')(months[0]!)).toBe('Jan 2024');
    const years = [new Date(2023, 0, 1), new Date(2024, 0, 1)];
    expect(createDateLabeler(years, 'en-US')(years[1]!)).toBe('2024');
    const days = [new Date(2024, 0, 5), new Date(2024, 0, 6)];
    expect(createDateLabeler(days, 'en-US')(days[0]!)).toBe('Jan 5, 2024');
  });
});

describe('toRows', () => {
  it('accepts arrays and unwraps common envelopes', () => {
    expect(toRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(toRows({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(toRows({ items: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(toRows({ data: { results: [{ a: 2 }] } })).toEqual([{ a: 2 }]);
  });

  it('drops non-object rows and tolerates junk', () => {
    expect(toRows([{ a: 1 }, null, 3, 'x', [1]])).toEqual([{ a: 1 }]);
    expect(toRows(null)).toEqual([]);
    expect(toRows('oops')).toEqual([]);
    expect(toRows({ total: 3 })).toEqual([]);
  });
});

describe('resolveXType / resolveSeries', () => {
  it('detects time axes only when every value is a date', () => {
    expect(resolveXType([{ d: '2024-01-01' }, { d: '2024-02-01' }], 'd')).toBe('time');
    expect(resolveXType([{ d: '2024-01-01' }, { d: 'Q2' }], 'd')).toBe('category');
    expect(resolveXType([{ d: null }, { d: '2024-01-01' }], 'd')).toBe('time');
    expect(resolveXType([], 'd')).toBe('category');
  });

  it('infers numeric series, skipping ids, dates and the x field', () => {
    const rows = [{ id: 1, month: 'Jan', revenue: '1,200', cost: 300, note: 'x', date: '2024-01-01', userId: 9 }];
    expect(resolveSeries(undefined, rows, ['month']).map((s) => s.key)).toEqual(['revenue', 'cost']);
  });

  it('humanizes names and drops duplicate keys', () => {
    const specs = resolveSeries(['total_revenue', { key: 'total_revenue' }, 'newUsers'], [], []);
    expect(specs.map((s) => s.name)).toEqual(['Total revenue', 'New users']);
  });
});

describe('helpers', () => {
  it('humanize keeps acronyms', () => {
    expect(humanize('apiURLCount')).toBe('Api URL count');
    expect(humanize('MRR_growth')).toBe('MRR growth');
  });

  it('niceCeil rounds to clean maxima', () => {
    expect(niceCeil(87)).toBe(100);
    expect(niceCeil(230)).toBe(250);
    expect(niceCeil(0)).toBe(1);
  });

  it('stableStringify ignores key order and handles cycles', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).not.toThrow();
  });

  it('toLabel never returns an empty string', () => {
    expect(toLabel(null, 'en-US')).toBe('(blank)');
    expect(toLabel('  ', 'en-US')).toBe('(blank)');
    expect(toLabel(2024, 'en-US')).toBe('2024');
  });

  it('inferColumnType', () => {
    expect(inferColumnType([{ v: 1 }, { v: 2 }], 'v')).toBe('number');
    expect(inferColumnType([{ v: '1,200' }], 'v')).toBe('number');
    expect(inferColumnType([{ v: '2024-01-01' }], 'v')).toBe('date');
    expect(inferColumnType([{ v: 'a' }, { v: 2 }], 'v')).toBe('string');
  });
});
