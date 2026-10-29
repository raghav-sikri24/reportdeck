import type { Fetcher } from 'reportdeck';

/** A fake backend so the playground runs without a server. */

export const settings = { fail: false, slow: false };

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function monthly(months: number) {
  const rand = seeded(7);
  const now = new Date(2026, 9, 1);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const revenue = Math.round(820_000 + i * 38_000 + rand() * 140_000);
    const cost = Math.round(revenue * (0.52 + rand() * 0.08));
    return {
      month: iso(d),
      revenue,
      cost,
      // A gap: the backend has no target for one month.
      target: i === 4 ? null : Math.round(900_000 + i * 35_000),
    };
  });
}

function daily(days: number) {
  const rand = seeded(11);
  const end = new Date(2026, 9, 26);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1 - i));
    const weekly = d.getDay() === 0 || d.getDay() === 6 ? 0.78 : 1;
    return {
      date: iso(d),
      active_users: Math.round((18_000 + i * 22 + rand() * 2_400) * weekly),
      new_users: Math.round((1_600 + rand() * 500) * weekly),
    };
  });
}

const channels = [
  { channel: 'Organic search', revenue: 4_120_000 },
  { channel: 'Paid search', revenue: 2_860_000 },
  { channel: 'Direct', revenue: 1_940_000 },
  { channel: 'Referral', revenue: 1_120_000 },
  { channel: 'Email', revenue: 640_000 },
  { channel: 'Social', revenue: 410_000 },
  { channel: 'Affiliates', revenue: 210_000 },
  { channel: 'Display', revenue: 95_000 },
];

const regions = [
  { region: 'North America', revenue: 5_400_000, last_year: 4_900_000 },
  { region: 'Europe, Middle East & Africa', revenue: 3_900_000, last_year: 3_600_000 },
  { region: 'India', revenue: 2_750_000, last_year: 1_900_000 },
  { region: 'Southeast Asia', revenue: 1_300_000, last_year: 1_250_000 },
  { region: 'Latin America', revenue: 860_000, last_year: 910_000 },
  { region: 'Japan & Korea', revenue: 720_000, last_year: 640_000 },
];

const funnel = [
  { stage: 'Visited pricing', users: 48_200 },
  { stage: 'Started trial', users: 12_900 },
  { stage: 'Activated', users: 7_350 },
  { stage: 'Converted to paid', users: 2_410 },
  { stage: 'Renewed', users: 1_980 },
];

function heatmap() {
  const rand = seeded(3);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = ['6am', '9am', '12pm', '3pm', '6pm', '9pm'];
  return days.flatMap((day, di) =>
    hours.map((hour, hi) => ({
      day,
      hour,
      orders: Math.round((di < 5 ? 220 : 140) * (hi === 2 || hi === 4 ? 1.6 : 1) + rand() * 120),
    })),
  );
}

function deals() {
  const rand = seeded(19);
  const segments = ['SMB', 'Mid-market', 'Enterprise'];
  return Array.from({ length: 90 }, (_, i) => {
    const seg = segments[i % 3]!;
    const scale = seg === 'Enterprise' ? 6 : seg === 'Mid-market' ? 2.4 : 1;
    return {
      account: `Account ${i + 1}`,
      segment: seg,
      days_to_close: Math.round(10 + rand() * 40 * scale ** 0.6),
      win_rate: Math.round((0.18 + rand() * 0.5) * 100) / 100,
      amount: Math.round(8_000 * scale * (0.5 + rand())),
    };
  });
}

const products = [
  { product: 'Payments', reliability: 92, speed: 81, coverage: 74, support: 88, pricing: 63 },
  { product: 'Payroll', reliability: 85, speed: 70, coverage: 90, support: 72, pricing: 80 },
  { product: 'Lending', reliability: 78, speed: 88, coverage: 61, support: 69, pricing: 74 },
];

const markets = [
  { region: 'APAC', country: 'India', revenue: 2_750_000 },
  { region: 'APAC', country: 'Singapore', revenue: 640_000 },
  { region: 'APAC', country: 'Japan', revenue: 720_000 },
  { region: 'APAC', country: 'Australia', revenue: 520_000 },
  { region: 'Americas', country: 'United States', revenue: 4_600_000 },
  { region: 'Americas', country: 'Canada', revenue: 800_000 },
  { region: 'Americas', country: 'Brazil', revenue: 540_000 },
  { region: 'EMEA', country: 'Germany', revenue: 1_300_000 },
  { region: 'EMEA', country: 'United Kingdom', revenue: 1_450_000 },
  { region: 'EMEA', country: 'France', revenue: 690_000 },
  { region: 'EMEA', country: 'UAE', revenue: 460_000 },
];

const flows = [
  { from: 'Search', to: 'Pricing page', visits: 21_000 },
  { from: 'Search', to: 'Blog', visits: 14_000 },
  { from: 'Social', to: 'Blog', visits: 8_000 },
  { from: 'Social', to: 'Pricing page', visits: 3_500 },
  { from: 'Email', to: 'Pricing page', visits: 6_200 },
  { from: 'Blog', to: 'Pricing page', visits: 9_400 },
  { from: 'Blog', to: 'Left', visits: 12_600 },
  { from: 'Pricing page', to: 'Signed up', visits: 12_900 },
  { from: 'Pricing page', to: 'Left', visits: 27_200 },
];

const pnl = [
  { line: 'Revenue', amount: 1_240_000 },
  { line: 'Cost of sales', amount: -540_000 },
  { line: 'Gross profit', subtotal: true },
  { line: 'Salaries', amount: -380_000 },
  { line: 'Marketing', amount: -160_000 },
  { line: 'Other income', amount: 45_000 },
  { line: 'Tax', amount: -52_000 },
];

function transactions() {
  const rand = seeded(23);
  const statuses = ['Settled', 'Pending', 'Refunded', 'Failed'];
  const customers = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Stark Industries', 'Wayne Enterprises', 'Hooli', 'Pied Piper'];
  return Array.from({ length: 137 }, (_, i) => ({
    id: `TXN-${String(10_000 + i)}`,
    date: iso(new Date(2026, 9, 26 - Math.floor(i / 5))),
    customer: customers[Math.floor(rand() * customers.length)],
    amount: i === 7 ? null : Math.round(rand() * 250_000) / 100,
    status: statuses[Math.floor(rand() * (i % 9 === 0 ? 4 : 2))],
    fee_rate: Math.round((0.012 + rand() * 0.018) * 10_000) / 10_000,
  }));
}

function kpis(range: number) {
  const f = range / 30;
  return {
    revenue: { value: 1_284_000 * f, previous: 1_105_000 * f, trend: monthly(12).map((m) => m.revenue) },
    active_users: { value: 21_840, previous: 22_310, trend: daily(14).map((d) => d.active_users) },
    churn: { value: 0.021, previous: 0.026, trend: [3.1, 2.9, 3.0, 2.8, 2.7, 2.6, 2.4, 2.5, 2.3, 2.1] },
    budget_used: 0.78,
  };
}

/** Raw, transaction-level rows — what a backend usually returns before any aggregation. */
function payments() {
  const rand = seeded(31);
  const channels = ['UPI', 'Card', 'Netbanking', 'Wallet', 'EMI'];
  const regions = ['North', 'South', 'East', 'West'];
  const merchants = ['Grocery', 'Travel', 'Electronics', 'Fashion', 'Bills', 'Food delivery'];
  const end = new Date(2026, 9, 26);
  return Array.from({ length: 2400 }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - Math.floor(rand() * 270), Math.floor(rand() * 24));
    const channel = channels[Math.min(4, Math.floor(rand() ** 1.6 * 5))]!;
    return {
      payment_id: `PAY-${100000 + i}`,
      created_at: d.toISOString(),
      channel,
      region: regions[Math.floor(rand() * 4)],
      merchant_category: merchants[Math.floor(rand() * merchants.length)],
      amount: Math.round((channel === 'EMI' ? 18000 : 900) * (0.3 + rand() * 1.7)),
      fee: Math.round(rand() * 40) / 2,
      status: rand() < 0.93 ? 'Success' : 'Failed',
    };
  });
}

const routes: Record<string, (params: Record<string, unknown>) => unknown> = {
  '/api/payments': () => ({ data: payments() }),
  '/api/revenue/monthly': (p) => ({ data: monthly(Number(p.range) >= 365 ? 24 : 12) }),
  '/api/users/daily': (p) => daily(Number(p.range) || 90),
  '/api/revenue/channels': () => ({ items: channels }),
  '/api/revenue/regions': () => regions,
  '/api/funnel': () => funnel,
  '/api/orders/heatmap': () => heatmap(),
  '/api/deals': () => deals(),
  '/api/products/scores': () => products,
  '/api/markets': () => markets,
  '/api/traffic/flows': () => flows,
  '/api/pnl': () => pnl,
  '/api/transactions': () => ({ results: transactions() }),
  '/api/kpis': (p) => kpis(Number(p.range) || 30),
  '/api/empty': () => [],
};

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

export const mockFetcher: Fetcher = async (request, { signal }) => {
  // The chart advisor is a real endpoint served by the Vite dev server (see vite.config.ts).
  if (request.url === '/api/chart-advisor') {
    const res = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
      signal,
    });
    if (!res.ok) throw Object.assign(new Error(`Advisor error ${res.status}`), { status: res.status });
    return res.json();
  }
  await wait((settings.slow ? 1800 : 350) + Math.random() * 400, signal);
  if (settings.fail) throw Object.assign(new Error('Service unavailable'), { status: 503 });
  const route = routes[request.url];
  if (!route) throw Object.assign(new Error('Not found'), { status: 404 });
  return route((request.params ?? {}) as Record<string, unknown>);
};
