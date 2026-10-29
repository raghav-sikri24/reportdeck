import { useEffect, useState } from 'react';
import {
  AreaChart,
  AutoChart,
  BarChart,
  ComboChart,
  DataTable,
  DonutChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  RadarChart,
  Report,
  ReportDeckProvider,
  SankeyChart,
  ScatterChart,
  StatCard,
  StatGroup,
  TreemapChart,
  useInvalidateReportData,
  useReportData,
  WaterfallChart,
  type ThemeSetting,
} from 'reportdeck';
import { mockFetcher, settings } from './mockApi';

const LOCALES = {
  'en-US': { locale: 'en-US', currency: 'USD' },
  'en-IN': { locale: 'en-IN', currency: 'INR' },
  'de-DE': { locale: 'de-DE', currency: 'EUR' },
} as const;

type Kpis = {
  revenue: { value: number; previous: number; trend: number[] };
  active_users: { value: number; previous: number; trend: number[] };
  churn: { value: number; previous: number; trend: number[] };
  budget_used: number;
};

function Dashboard({ range }: { range: number }) {
  const params = { range };
  const kpis = useReportData<Kpis>({ url: '/api/kpis', params });
  const k = kpis.data;

  return (
    <Report
      title="Business review"
      subtitle={`Last ${range} days · mock data`}
      fileName={`business-review-${range}d`}
    >
      <StatGroup>
        <StatCard label="Revenue" value={k?.revenue.value} previous={k?.revenue.previous} format="currency-compact" trend={k?.revenue.trend} comparisonLabel="vs previous period" loading={kpis.isLoading} error={kpis.error} />
        <StatCard label="Active users" value={k?.active_users.value} previous={k?.active_users.previous} trend={k?.active_users.trend} comparisonLabel="vs previous period" loading={kpis.isLoading} error={kpis.error} />
        <StatCard label="Churn rate" value={k?.churn.value} previous={k?.churn.previous} format="percent" goodDirection="down" trend={k?.churn.trend} comparisonLabel="vs previous period" loading={kpis.isLoading} error={kpis.error} />
        <StatCard label="Avg. order value" value="12,480.50" previous={11950} format="currency" comparisonLabel="vs previous period" />
      </StatGroup>

      <AutoChart query="/api/payments" advisor="/api/chart-advisor" span="full" rememberAs="playground-payments" />

      <AutoChart query="/api/payments" advisor="/api/chart-advisor" mode="suggest" span="full" />

      <ComboChart
        title="Revenue vs target"
        subtitle="Monthly · target missing for one month"
        query={{ url: '/api/revenue/monthly', params }}
        x="month"
        series={[{ key: 'revenue', type: 'bar' }, { key: 'target', type: 'line' }]}
        format="currency"
        span={2}
      />

      <AreaChart
        title="Daily active users"
        subtitle="Ctrl/⌘ + scroll or drag the slider to zoom"
        query={{ url: '/api/users/daily', params }}
        x="date"
        series={['active_users']}
        format="compact"
      />

      <LineChart
        title="Revenue and cost"
        query={{ url: '/api/revenue/monthly', params }}
        x="month"
        series={['revenue', 'cost']}
        format="currency"
        referenceLines={[{ value: 1_000_000, label: 'Break-even' }]}
      />

      <DonutChart
        title="Revenue by channel"
        subtitle="8 channels → top 5 + Other"
        query="/api/revenue/channels"
        label="channel"
        value="revenue"
        format="currency-compact"
      />

      <BarChart
        title="Revenue by region"
        subtitle="This year vs last year"
        query="/api/revenue/regions"
        x="region"
        series={[{ key: 'revenue', name: 'This year' }, { key: 'last_year', name: 'Last year' }]}
        format="currency-compact"
        horizontal
      />

      <BarChart
        title="Cost share of revenue"
        subtitle="100% stacked"
        query={{ url: '/api/revenue/monthly', params }}
        x="month"
        series={['cost', { key: 'margin', name: 'Margin' }]}
        queryOptions={{
          select: (res) =>
            (res as { data: { month: string; revenue: number; cost: number }[] }).data.map((r) => ({ ...r, margin: r.revenue - r.cost })),
        }}
        stacked="percent"
      />

      <WaterfallChart title="Profit bridge" subtitle="October" query="/api/pnl" x="line" value="amount" totalKey="subtotal" totalLabel="Net profit" format="currency-compact" />

      <FunnelChart title="Trial conversion" query="/api/funnel" stage="stage" value="users" format="compact" />

      <HeatmapChart title="Orders by time of day" query="/api/orders/heatmap" x="hour" y="day" value="orders" />

      <ScatterChart
        title="Deal velocity"
        subtitle="Bubble size = deal amount"
        query="/api/deals"
        x="days_to_close"
        y="win_rate"
        size="amount"
        group="segment"
        name="account"
        yFormat="percent"
        sizeFormat="currency-compact"
      />

      <RadarChart title="Product scorecard" query="/api/products/scores" name="product" indicators={['reliability', 'speed', 'coverage', 'support', 'pricing']} />

      <TreemapChart title="Revenue by market" query="/api/markets" path={['region', 'country']} value="revenue" format="currency-compact" />

      <SankeyChart title="Traffic flow" query="/api/traffic/flows" source="from" target="to" value="visits" format="compact" />

      <GaugeChart
        title="Budget used"
        value={k?.budget_used}
        loading={kpis.isLoading}
        format="percent"
        max={1}
        label="of quarterly budget"
        bands={[
          { upTo: 0.7, status: 'good', label: 'On track' },
          { upTo: 0.9, status: 'warning', label: 'Watch' },
          { upTo: 1, status: 'critical', label: 'Over' },
        ]}
      />

      <LineChart title="An empty endpoint" query="/api/empty" x="date" emptyMessage="No events in this period" />

      <DataTable
        title="Recent transactions"
        query="/api/transactions"
        searchable
        span="full"
        defaultSort={{ key: 'date', direction: 'desc' }}
        columns={[
          { key: 'id', header: 'ID' },
          { key: 'date', header: 'Date', type: 'date' },
          { key: 'customer', header: 'Customer' },
          { key: 'status', header: 'Status' },
          { key: 'fee_rate', header: 'Fee', type: 'number', format: { type: 'percent', decimals: 2 } },
          { key: 'amount', header: 'Amount', type: 'number', format: 'currency' },
        ]}
      />
    </Report>
  );
}

function Controls({ theme, setTheme, localeKey, setLocaleKey, range, setRange }: {
  theme: ThemeSetting;
  setTheme: (t: ThemeSetting) => void;
  localeKey: keyof typeof LOCALES;
  setLocaleKey: (k: keyof typeof LOCALES) => void;
  range: number;
  setRange: (n: number) => void;
}) {
  const invalidate = useInvalidateReportData();
  const [fail, setFail] = useState(settings.fail);
  const [slow, setSlow] = useState(settings.slow);
  return (
    <div className="pg-bar">
      <span className="pg-brand">reportdeck playground</span>
      <label>
        Range
        <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 365 days</option>
        </select>
      </label>
      <label>
        Theme
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeSetting)}>
          <option value="auto">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        Locale
        <select value={localeKey} onChange={(e) => setLocaleKey(e.target.value as keyof typeof LOCALES)}>
          {Object.keys(LOCALES).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={fail}
          onChange={(e) => {
            settings.fail = e.target.checked;
            setFail(e.target.checked);
            invalidate();
          }}
        />
        Simulate errors
      </label>
      <label>
        <input
          type="checkbox"
          checked={slow}
          onChange={(e) => {
            settings.slow = e.target.checked;
            setSlow(e.target.checked);
          }}
        />
        Slow network
      </label>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeSetting>('auto');
  const [localeKey, setLocaleKey] = useState<keyof typeof LOCALES>('en-US');
  const [range, setRange] = useState(90);

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ReportDeckProvider fetcher={mockFetcher} theme={theme} {...LOCALES[localeKey]} retry={1}>
      <div className="pg">
        <Controls theme={theme} setTheme={setTheme} localeKey={localeKey} setLocaleKey={setLocaleKey} range={range} setRange={setRange} />
        <Dashboard range={range} />
      </div>
    </ReportDeckProvider>
  );
}
