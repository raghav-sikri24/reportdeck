// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../src/data/fetcher';
import { BarChart, DataTable, LineChart, Report, ReportDeckProvider, StatCard, useReport, useReportData } from '../src';
import { computeDelta } from '../src/react/StatCard';
import * as exportModule from '../src/export';
import type { ReactNode } from 'react';

vi.mock('../src/export', async (importOriginal) => {
  const actual = await importOriginal<typeof exportModule>();
  return { ...actual, exportChart: vi.fn(async () => {}), exportReport: vi.fn(async () => {}), exportTable: vi.fn(async () => {}) };
});

afterEach(cleanup);

function withProvider(fetcher: Fetcher) {
  return ({ children }: { children: ReactNode }) => (
    <ReportDeckProvider fetcher={fetcher} retry={0} theme="light">
      {children}
    </ReportDeckProvider>
  );
}

describe('useReportData', () => {
  it('loads, selects and refetches', async () => {
    let n = 0;
    const fetcher: Fetcher = async () => ({ items: [{ v: ++n }] });
    const { result } = renderHook(() => useReportData('/api/x', { select: (r) => (r as { items: unknown[] }).items }), {
      wrapper: withProvider(fetcher),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual([{ v: 1 }]);
    await act(() => result.current.refetch());
    expect(result.current.data).toEqual([{ v: 2 }]);
  });

  it('keeps previous data while new params load, and ignores stale responses', async () => {
    const resolvers = new Map<string, (v: unknown) => void>();
    const fetcher: Fetcher = (req) => new Promise((resolve) => resolvers.set(String(req.params?.page), resolve));
    const { result, rerender } = renderHook(({ page }) => useReportData({ url: '/list', params: { page } }), {
      wrapper: withProvider(fetcher),
      initialProps: { page: 1 },
    });
    await waitFor(() => expect(resolvers.has('1')).toBe(true));
    act(() => resolvers.get('1')!(['p1']));
    await waitFor(() => expect(result.current.data).toEqual(['p1']));

    rerender({ page: 2 });
    expect(result.current.data).toEqual(['p1']);
    expect(result.current.isPreviousData).toBe(true);
    expect(result.current.isRefreshing).toBe(true);
    await waitFor(() => expect(resolvers.has('2')).toBe(true));
    act(() => resolvers.get('2')!(['p2']));
    await waitFor(() => expect(result.current.data).toEqual(['p2']));
    expect(result.current.isPreviousData).toBe(false);
  });

  it('surfaces errors and select() failures as typed errors', async () => {
    const onError = vi.fn();
    const fetcher: Fetcher = async () => ({ weird: true });
    const { result } = renderHook(
      () =>
        useReportData('/x', {
          select: () => {
            throw new Error('shape changed');
          },
          onError,
        }),
      { wrapper: withProvider(fetcher) },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.kind).toBe('parse');
    expect(result.current.error?.message).toMatch(/shape changed/);
    expect(onError).toHaveBeenCalled();
  });

  it('stays idle when disabled', () => {
    const fetcher = vi.fn<Fetcher>(async () => []);
    const { result } = renderHook(() => useReportData('/x', { enabled: false }), { wrapper: withProvider(fetcher) });
    expect(result.current.status).toBe('idle');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('chart states', () => {
  it('shows a skeleton, then an error with a working retry', async () => {
    let fail = true;
    const fetcher: Fetcher = async () => {
      if (fail) throw Object.assign(new Error('down'), { status: 500 });
      return [{ m: 'Jan', v: 1 }];
    };
    render(<BarChart title="Revenue" query="/api/rev" x="m" series={['v']} />, { wrapper: withProvider(fetcher) });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/server had a problem/i);
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: 'Download chart' })).toBeTruthy();
  });

  it('shows an empty state and hides downloads when there is no data', () => {
    render(<LineChart title="Empty" data={[]} x="d" emptyMessage="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download chart' })).toBeNull();
  });

  it('toggles an accessible table view of the same data', () => {
    render(<BarChart title="Sales" data={[{ m: 'Jan', v: 1200 }, { m: 'Feb', v: null }]} x="m" series={[{ key: 'v', name: 'Revenue', format: 'currency' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show data table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('$1,200.00')).toBeTruthy();
    expect(within(table).getByText('—')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show chart' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the download menu with keyboard-accessible items', async () => {
    render(<BarChart title="Sales" data={[{ m: 'Jan', v: 1 }]} x="m" series={['v']} downloads={['csv', 'png']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['CSV data.csv', 'PNG image.png']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('DataTable', () => {
  const rows = [
    { name: 'beta', amount: 20, joined: '2024-03-01' },
    { name: 'Alpha', amount: null, joined: '2024-01-15' },
    { name: 'gamma', amount: 100, joined: null },
    { name: 'item 10', amount: 5, joined: '2024-02-01' },
    { name: 'item 9', amount: 7, joined: '2024-02-02' },
  ];
  const names = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent);

  it('infers columns, sorts naturally with blanks last, and cycles sort state', () => {
    render(<DataTable title="People" data={rows} pageSize={0} />);
    const amountHeader = screen.getByRole('columnheader', { name: /amount/i });
    fireEvent.click(within(amountHeader).getByRole('button'));
    expect(amountHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['item 10', 'item 9', 'beta', 'gamma', 'Alpha']);
    fireEvent.click(within(amountHeader).getByRole('button'));
    expect(names()).toEqual(['gamma', 'beta', 'item 9', 'item 10', 'Alpha']); // blanks still last
    fireEvent.click(within(screen.getByRole('columnheader', { name: /name/i })).getByRole('button'));
    expect(names()).toEqual(['Alpha', 'beta', 'gamma', 'item 9', 'item 10']); // case-insensitive, numeric-aware
  });

  it('paginates and searches', async () => {
    render(<DataTable title="People" data={rows} pageSize={2} searchable />);
    expect(screen.getByText(/1–2 of 5/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText(/3–4 of 5/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'GAM' } });
    await waitFor(() => expect(names()).toEqual(['gamma']));
  });
});

describe('StatCard', () => {
  it('shows a compact value, signed delta and screen-reader text', () => {
    render(<StatCard label="Revenue" value={1_250_000} previous={1_000_000} format="currency-compact" comparisonLabel="vs last month" />);
    expect(screen.getByText('$1.3M')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('Up 25%')).toBeTruthy();
  });

  it('computeDelta handles zero baselines and "down is good" metrics', () => {
    const fmt = (v: number | null) => String(v);
    const pct = (v: number | null) => `${(v ?? 0) * 100}%`;
    expect(computeDelta(5, 0, { deltaFormat: 'percent', goodDirection: 'up', format: fmt, percent: pct })).toMatchObject({ text: '5', direction: 'up', tone: 'good' });
    expect(computeDelta(80, 100, { deltaFormat: 'percent', goodDirection: 'down', format: fmt, percent: pct })).toMatchObject({ text: '20%', tone: 'good' });
    expect(computeDelta(3, 3, { deltaFormat: 'percent', goodDirection: 'up', format: fmt, percent: pct })).toMatchObject({ direction: 'flat', tone: 'neutral' });
    expect(computeDelta(null, 3, { deltaFormat: 'percent', goodDirection: 'up', format: fmt, percent: pct })).toBeNull();
  });
});

describe('Report', () => {
  it('exports every item in on-screen order', async () => {
    const spy = vi.mocked(exportModule.exportReport);
    function ExportButton() {
      const { exportReport } = useReport();
      return <button onClick={() => void exportReport('pdf')}>Export</button>;
    }
    render(
      <Report title="Monthly review" downloads={false}>
        <StatCard label="Users" value={10} />
        <BarChart title="Second" data={[{ m: 'a', v: 1 }]} x="m" series={['v']} />
        <DataTable title="Third" data={[{ a: 1 }]} />
        <ExportButton />
      </Report>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [entries, format, options] = spy.mock.calls[0]!;
    expect(format).toBe('pdf');
    expect(entries.map((e) => e.kind)).toEqual(['stat', 'chart', 'table']);
    expect(options).toMatchObject({ title: 'Monthly review', fileName: 'Monthly review' });
  });
});
