# reportdeck

Backend-driven React charts, KPI cards, data tables and reports — with one-click **PNG, SVG, CSV, Excel and PDF** export.

Point a chart at an API endpoint and get loading, error, empty and refresh states, a colorblind-safe palette, light/dark themes, an accessible table view and downloads, without writing any of that yourself.

```tsx
<BarChart title="Revenue by month" query="/api/revenue" x="month" series={['revenue', 'cost']} format="currency" />
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/raghav-sikri24/reportdeck/main/docs/images/gallery-dark.png" />
  <img alt="All reportdeck chart types: line, area, bar, horizontal bar, 100% stacked bar, combo, donut, waterfall, funnel, heatmap, bubble, radar, treemap, sankey and gauge" src="https://raw.githubusercontent.com/raghav-sikri24/reportdeck/main/docs/images/gallery-light.png" />
</picture>

- **14 chart types** — line, area, bar (grouped / stacked / 100% / horizontal), combo, pie, donut, scatter/bubble, heatmap, radar, funnel, gauge, treemap, sankey, waterfall — plus KPI stat cards with sparklines and a sortable, searchable, paginated data table.
- **Data from your backend** — built-in fetching with caching, request de-duplication, retries with backoff, timeouts, polling, race-free param changes and "keep previous data while refreshing". Works with any API shape via `select`, or bring your own fetcher (axios, GraphQL…).
- **Messy data handled** — `"1,234.50"`, `"₹ 1,23,456"`, `"12%"`, `"(42)"`, nulls, unsorted or invalid dates, the date-only timezone bug, a single data point, 100k points, long labels, negative stacks, too many slices, sankey cycles.
- **Exports** — per chart (PNG/SVG/CSV/Excel/PDF), per table (CSV/Excel/PDF), or a whole `<Report>` as one multi-page PDF or Excel workbook with native number formats. PDF and Excel libraries load only when someone clicks download.
- **Design that holds up** — validated colorblind-safe palette in light and dark, thin marks, recessive grids, compact axis labels, locale-aware numbers and dates (incl. Indian lakh/crore).
- **Accessible** — every chart has a table view, keyboard-operable menus, screen-reader labels, status never shown by color alone, reduced-motion and forced-colors support.
- **TypeScript-first**, ESM + CJS, tree-shakable ECharts modules, SSR-safe, React 18 & 19, works in Next.js App Router.

---

## Install

```bash
npm install reportdeck
```

Import the stylesheet once (e.g. in your root layout or `main.tsx`):

```ts
import 'reportdeck/styles.css';
```

`react` and `react-dom` (18+) are peer dependencies. ECharts, ExcelJS and jsPDF come with the package; ExcelJS and jsPDF are loaded lazily on first export.

## Quick start

```tsx
import { LineChart } from 'reportdeck';

const data = [
  { month: '2026-01-01', revenue: 82000, cost: 41000 },
  { month: '2026-02-01', revenue: 91000, cost: 45000 },
  { month: '2026-03-01', revenue: null, cost: 47000 }, // shows as a gap, not a zero
];

export function Revenue() {
  return <LineChart title="Revenue" data={data} x="month" series={['revenue', 'cost']} format="currency" />;
}
```

Omit `series` to plot every numeric field automatically.

## Loading data from your backend

Wrap your app (or a page) in the provider once:

```tsx
import { ReportDeckProvider } from 'reportdeck';

<ReportDeckProvider
  baseUrl="https://api.example.com"
  headers={async () => ({ Authorization: `Bearer ${await getToken()}` })} // refreshed per request
  locale="en-IN"
  currency="INR"
>
  <App />
</ReportDeckProvider>;
```

Then give any chart, table or hook a `query` — a URL or a request object:

```tsx
<AreaChart
  title="Daily active users"
  query={{ url: '/v1/metrics/dau', params: { from, to, region } }}
  x="date"
  series={['active_users']}
/>
```

- Responses can be an array or an envelope: `{ data | items | results | rows | records: [...] }` is unwrapped automatically. For anything else use `queryOptions={{ select: (res) => res.payload.points }}`.
- `text/csv` responses are parsed into rows.
- When `params` change, the previous chart stays on screen (dimmed) until new data arrives — no skeleton flash, no race conditions.
- Identical requests from several components share one network call.

### `useReportData`

Use the same data layer directly — e.g. to feed several charts from one request:

```tsx
const { data, error, isLoading, isRefreshing, refetch } = useReportData(
  { url: '/v1/sales', params: { range } },
  { select: (res) => res.items, refreshInterval: 60_000 },
);
```

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Pause fetching (e.g. until a filter is chosen). |
| `select` | — | Transform the response. Re-runs only when the response changes. |
| `refreshInterval` | — | Poll every N ms (paused while the tab is hidden). |
| `revalidateOnFocus` | `false` | Refetch stale data when the tab regains focus. |
| `staleTime` | `0` | Treat cached data as fresh for N ms. |
| `retry` / `timeout` | `2` / `30000` | Retries apply to network errors, timeouts, 408/425/429/5xx (honoring `Retry-After`). 4xx errors fail fast. |
| `keepPreviousData` | `true` | Keep showing the last result while new params load. |

Errors are `ReportDataError` instances with `kind` (`http` · `network` · `timeout` · `parse` · `abort`), `status`, `url`, `body` and `retryAfter`. If a refresh fails, the last good data stays visible with a "Retry" notice.

`useInvalidateReportData()` returns a function to refetch everything (or URLs matching a string) — handy after a mutation.

### Custom fetcher

```tsx
<ReportDeckProvider fetcher={(req, { signal }) => axios({ url: req.url, params: req.params, data: req.body, method: req.method, signal }).then((r) => r.data)}>
```

## Charts

All charts accept the [common props](#common-props) plus their own:

| Component | Key props |
|---|---|
| `LineChart`, `AreaChart` | `x`, `series`, `format`, `stacked`, `smooth`, `connectNulls`, `highlight`, `referenceLines`, `zoom`, `includeZero`, `xType` |
| `BarChart` | same as line + `horizontal`, `stacked` (`true` \| `'percent'`), `sort` |
| `ComboChart` | `series={[{ key: 'actual', type: 'bar' }, { key: 'target', type: 'line' }]}` on one shared axis |
| `PieChart`, `DonutChart` | `label`, `value`, `maxSlices` (default 6, rest → "Other"), `colors`, `centerLabel` |
| `ScatterChart` | `x`, `y`, `size` (bubble), `group`, `name`, `xFormat`, `yFormat`, `sizeRange` |
| `HeatmapChart` | `x`, `y`, `value`, `scale` (`auto` → diverging when data crosses zero), `xOrder`, `yOrder` |
| `RadarChart` | `name`, `indicators` (`string` or `{ key, name, max, min }`) |
| `FunnelChart` | `stage`, `value`, `showConversion` |
| `GaugeChart` | `value` (or `data`/`query` resolving to a number), `min`, `max`, `bands` (`{ upTo, status, label }`) |
| `TreemapChart` | `path` (e.g. `['region', 'country']`), `value` |
| `SankeyChart` | `source`, `target`, `value` — cycles, self-loops and duplicate links are cleaned automatically |
| `WaterfallChart` | `x`, `value`, `totalKey` (subtotal rows), `showTotal`, `totalLabel` |

### Series

```ts
series={['revenue', { key: 'cost', name: 'Total cost', format: 'currency', color: '#…', stack: 'a' }]}
```

Series take palette colors in declaration order and keep them when others are filtered out. Past 8 series, extras are drawn in neutral gray (with a dev warning) rather than inventing indistinguishable colors — use small multiples or an "Other" series instead.

Line, area, bar, combo, pie and waterfall charts also take `labels` (`'auto'` labels sparingly — bar tips, line ends — `'all'` or `'none'`) and `legend` (`'auto'` shows it for 2+ series).

### Common props

| Prop | Default | |
|---|---|---|
| `data` / `query` / `queryOptions` | — | Pass rows, or let the chart fetch them. |
| `loading`, `error`, `onRetry` | — | States when you fetch data yourself. |
| `title`, `subtitle` | — | Card header (also used for exports and screen readers). |
| `height` | `320` | Plot height in px. Horizontal bars and heatmaps size themselves. |
| `downloads` | all | `false`, or a subset of `['png', 'svg', 'csv', 'xlsx', 'pdf']`. |
| `tableView` | `true` | Toggle between chart and an accessible data table. |
| `frame` | `true` | `false` renders only the chart, without card chrome. |
| `actions`, `footer` | — | Extra header buttons / footer content. |
| `emptyMessage` | — | Text for the empty state. |
| `span` | `1` | Grid span inside `<Report>`: `1`, `2` or `'full'`. |
| `onEvents`, `onChartReady` | — | ECharts events and instance access. |
| `renderer` | `'canvas'` | `'svg'` for crisp DOM-based output. |
| `fileName` | title | Download file name. |

## Formatting

`format` accepts a shorthand, an options object, or a function:

```ts
format="currency"            // $1,234.50   (₹12,34,567.50 with locale en-IN)
format="currency-compact"    // $4.2M       (₹38.5L / ₹1.1Cr with en-IN)
format="compact"             // 12.9K
format="percent"             // 0.256 → 25.6%
format={{ type: 'percent', percentInput: 'whole' }}  // 25.6 → 25.6%
format={{ type: 'number', decimals: 0, suffix: ' kg' }}
format={(v) => `${v} pts`}
```

Axis ticks and direct labels use a compact version automatically; tooltips, tables and exports keep full precision. Missing values render as "—", never as `NaN` or `0`.

## KPI cards & tables

```tsx
<StatGroup>
  <StatCard label="Revenue" value={1_284_000} previous={1_105_000} format="currency-compact" trend={last12Months} comparisonLabel="vs last month" />
  <StatCard label="Churn" value={0.021} previous={0.026} format="percent" goodDirection="down" />
</StatGroup>

<DataTable
  title="Transactions"
  query="/v1/transactions"
  searchable
  pageSize={20}
  defaultSort={{ key: 'date', direction: 'desc' }}
  columns={[
    { key: 'id', header: 'ID' },
    { key: 'date', header: 'Date', type: 'date' },
    { key: 'amount', header: 'Amount', type: 'number', format: 'currency' },
    { key: 'status', header: 'Status', render: (v) => <Badge>{String(v)}</Badge> },
  ]}
/>
```

`StatCard` handles a zero baseline (shows the absolute change), "down is good" metrics, and keeps the last value with a notice if a refresh fails. `DataTable` sorts numbers, dates and text naturally (`item 9` before `item 10`), always puts blanks last, and infers columns when you don't pass them.

## Reports & exports

Wrap charts, tables and stat cards in `<Report>` to lay them out in a responsive grid and export all of them — in on-screen order — as one file:

```tsx
<Report title="Monthly business review" subtitle="October 2026" fileName="mbr-oct-2026">
  <StatGroup>…</StatGroup>
  <ComboChart … span={2} />
  <DonutChart … />
  <DataTable … span="full" />
</Report>
```

The header gets a **Download report** menu (PDF / Excel). Trigger exports from your own UI with `useReport()`:

```tsx
const { exportReport, exporting } = useReport();
<button onClick={() => exportReport('pdf', { orientation: 'landscape' })} disabled={!!exporting}>Export</button>;
```

| Export | What you get |
|---|---|
| PNG / JPEG | 2× resolution, title and subtitle drawn in, white or themed background. |
| SVG | Vector output (also works on the server). |
| CSV | RFC 4180, UTF-8 BOM for Excel, formula-injection protection. |
| Excel | Typed cells (real numbers and dates), native currency/percent/compact number formats, frozen header, filters, auto column widths, embedded chart image. Respects Excel's limits (sheet names, 32,767-char cells, 1,048,576 rows). |
| PDF | A4/Letter, portrait/landscape, header, KPI boxes, charts, tables that repeat their header across pages, page numbers. Long tables are capped (`maxTableRows`, default 1000) with a note. |

Programmatic API (`reportdeck/export`): `exportChart`, `exportTable`, `exportReport`, and `renderChartFile` / `renderReportFile` which return `{ blob, fileName }` without downloading (for uploading or emailing).

### PDF fonts (₹ and non-Latin text)

jsPDF's built-in Helvetica only covers Western European characters, so by default `₹` becomes `Rs`, `→` becomes `->`, and unsupported characters become `?`. For full Unicode, pass a TTF:

```tsx
<ReportDeckProvider pdfFont={{ family: 'NotoSans', regular: '/fonts/NotoSans-Regular.ttf', bold: '/fonts/NotoSans-Bold.ttf' }}>
```

## Theming

- `theme="auto"` (default) follows `data-theme="dark"` or a `.dark` class on `<html>` (Tailwind/shadcn/next-themes), then the OS setting. Or force `"light"` / `"dark"`.
- Downloads use the light theme by default (`exportTheme="current"` to match the screen).
- Every UI color and radius is a CSS variable (`--rd-surface`, `--rd-ink`, `--rd-accent`, `--rd-radius`, …) on `.rd-light` / `.rd-dark` — override them to match your design system.
- `fontFamily` on the provider sets the font for both the cards and the chart canvas.
- Chart colors live in `LIGHT_TOKENS` / `DARK_TOKENS` (exported).

## Accessibility

- Each chart has a **table view** with the same data, and an accessible description (`ariaLabel`, defaulting to title + subtitle).
- Download menus and table sorting are fully keyboard-operable; sort state is announced via `aria-sort`.
- Deltas use an arrow icon and screen-reader text, never color alone.
- The palette passes colorblind-safety checks in both themes; `texture` adds pattern fills (`'auto'` enables them in Windows high-contrast / forced-colors mode).
- Animations are disabled for users who prefer reduced motion.

## Server-side rendering

The React entry is marked `"use client"`, so it works inside Next.js App Router server components. Charts render on the client; cards, stat values and tables render on the server.

To produce chart images or files without a browser (emails, scheduled reports), use `reportdeck/server`:

```ts
import { buildCartesian, createBuildContext, renderChartSVG, buildWorkbook } from 'reportdeck/server';

const model = buildCartesian('bar', { data: rows, x: 'month', series: ['revenue'] }, createBuildContext({ locale: 'en-IN', currency: 'INR' }));
const svg = renderChartSVG(model, { width: 800, height: 400, title: 'Revenue' });
const { buffer } = await buildWorkbook([{ name: 'Revenue', ...model.table }]);
```

## Design decisions

- **No dual-axis charts.** Two y-scales on one plot make arbitrary scale choices look like correlations. `ComboChart` shares one axis; for different units use two charts.
- **Pies cap at 6 slices**, folding the rest into "Other". Past that, a bar chart reads better.
- **Missing data is a gap**, not a zero, unless you opt into `connectNulls`.
- **Bars always start at zero**; lines do too unless you pass `includeZero={false}`.

## Development

```bash
pnpm install
pnpm dev            # playground with a mock backend at http://localhost:5199
pnpm test           # unit + component tests
pnpm verify         # lint, typecheck, tests, build, package checks
```

## Publishing

Releases are automated with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions authenticates to npm with OIDC, so there is no npm token to store or rotate, and every release gets a signed provenance statement.

```bash
npm version patch          # or minor / major — updates package.json and creates a v* tag
git push --follow-tags     # the Release workflow verifies, publishes to npm and creates a GitHub release
```

Update `CHANGELOG.md` before bumping. The npm-side configuration (package → Settings → Trusted publishing) points at `raghav-sikri24/reportdeck` and `.github/workflows/release.yml`; if you rename the workflow file, update it there too.

## License

[MIT](./LICENSE) © Raghav Sikri
