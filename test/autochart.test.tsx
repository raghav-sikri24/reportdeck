// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoChart, ReportDeckProvider, type ChartSpec } from '../src';
import type { Fetcher } from '../src/data/fetcher';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rows = Array.from({ length: 120 }, (_, i) => ({
  created_at: `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
  channel: ['Card', 'UPI', 'Wallet', 'Netbanking'][i % 4],
  amount: 100 + (i % 13) * 10,
  customer_email: `c${i}@example.com`,
}));

const aiDonut = {
  chart: 'donut',
  title: 'Channel mix (AI)',
  reason: 'Four parts of one total.',
  x: 'channel',
  y: ['amount'],
  splitBy: '',
  size: '',
  aggregate: 'sum',
  timeUnit: 'none',
  sort: 'none',
  limit: 0,
  lastPeriods: 0,
  format: 'auto',
};

function withFetcher(fetcher: Fetcher) {
  return ({ children }: { children: ReactNode }) => (
    <ReportDeckProvider fetcher={fetcher} retry={0} theme="light">
      {children}
    </ReportDeckProvider>
  );
}

describe('AutoChart without AI', () => {
  it('picks a trend for time-stamped rows and lets the user switch views', () => {
    const onSpecChange = vi.fn();
    render(<AutoChart data={rows} onSpecChange={onSpecChange} />);
    expect(screen.getByRole('heading', { name: 'Amount over time' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Change view' }));
    const tiles = within(screen.getByRole('list', { name: 'Suggested views' })).getAllByRole('button');
    expect(tiles.length).toBe(4);
    expect(tiles[0]!.getAttribute('aria-pressed')).toBe('true');

    const donut = tiles.find((t) => /Share of amount by channel/.test(t.textContent ?? ''))!;
    fireEvent.click(donut);
    expect(screen.getByRole('heading', { name: 'Share of amount by channel' })).toBeTruthy();
    expect((onSpecChange.mock.calls.at(-1)![0] as ChartSpec).chart).toBe('donut');
  });

  it('answers a typed request with the built-in rules', async () => {
    render(<AutoChart data={rows} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change view' }));
    fireEvent.change(screen.getByLabelText('Describe the view you want'), { target: { value: 'compare channels' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Amount by channel' })).toBeTruthy());
  });

  it('suggest mode shows options first and remembers the choice', () => {
    const { unmount } = render(<AutoChart data={rows} mode="suggest" rememberAs="payments" />);
    expect(screen.getByRole('heading', { name: 'Choose a view' })).toBeTruthy();
    const tiles = within(screen.getByRole('list', { name: 'Suggested views' })).getAllByRole('button');
    fireEvent.click(tiles[1]!);
    const chosenTitle = screen.getAllByRole('heading')[0]!.textContent;
    expect(chosenTitle).not.toBe('Choose a view');
    unmount();
    render(<AutoChart data={rows} mode="suggest" rememberAs="payments" />);
    expect(screen.getAllByRole('heading')[0]!.textContent).toBe(chosenTitle);
  });

  it('shows empty and error states', () => {
    render(<AutoChart data={[]} />);
    expect(screen.getByText('No data to display')).toBeTruthy();
    cleanup();
    render(<AutoChart data={undefined} error={Object.assign(new Error('x'), { status: 500 })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/server had a problem/i);
  });
});

describe('AutoChart with an AI advisor', () => {
  it('sends only a redacted profile and shows the AI pick', async () => {
    const fetcher = vi.fn<Fetcher>(async () => ({ suggestions: [aiDonut] }));
    render(<AutoChart data={rows} advisor="/api/chart-advisor" />, { wrapper: withFetcher(fetcher) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Channel mix (AI)' })).toBeTruthy());

    const [request] = fetcher.mock.calls[0]!;
    expect(request).toMatchObject({ url: '/api/chart-advisor', method: 'POST' });
    const body = request.body as { profile: { privacy: string; sample?: unknown } };
    expect(body.profile.privacy).toBe('summary');
    expect(body.profile.sample).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('example.com');
    expect(screen.getByText(/AI pick/)).toBeTruthy();
  });

  it('ignores invalid AI suggestions and falls back to rules when the AI fails', async () => {
    const fetcher = vi.fn<Fetcher>(async () => {
      throw Object.assign(new Error('down'), { status: 503 });
    });
    render(<AutoChart data={rows} advisor="/api/chart-advisor" />, { wrapper: withFetcher(fetcher) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Amount over time' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Change view' }));
    expect(screen.getByRole('status').textContent).toMatch(/unavailable/);
  });

  it('asks the AI with the question and jumps to its answer', async () => {
    const fetcher = vi.fn<Fetcher>(async (req) => {
      const { question } = req.body as { question: string };
      return { suggestions: question ? [{ ...aiDonut, title: `Answer: ${question}` }, { ...aiDonut, chart: 'made-up' }] : [] };
    });
    render(<AutoChart data={rows} advisor="/api/chart-advisor" />, { wrapper: withFetcher(fetcher) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Amount over time' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Change view' }));
    fireEvent.change(screen.getByLabelText('Describe the view you want'), { target: { value: 'channel split' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Answer: channel split' })).toBeTruthy());
  });
});
