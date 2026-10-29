# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- `createChartAdvisor` now logs server-side failures (missing provider SDK, invalid key, provider outage) to the server console when no `onError` is given, instead of failing silently. The browser still only receives a generic message.

## 0.2.0 — 2026-10-29

- **`<AutoChart>`**: give it raw rows and it profiles the data, aggregates it, and picks the best chart — or shows the options first (`mode="suggest"`). Users can switch views or ask for one in plain words.
- **Built-in recommender** (`recommendCharts`): free, instant, offline rules for trends, rankings, shares, relationships, flows, funnels, heatmaps, hierarchies and KPIs; understands requests like "share of revenue by channel, last 3 months".
- **AI advisor** (`createChartAdvisor` / `suggestCharts` in `reportdeck/server`): Gemini, OpenAI, Claude, any OpenAI-compatible server, or a custom model. API keys stay on your server; only a data profile is sent (`privacy`: `schema` / `summary` / `sample`, enforced server-side). Answers are validated, repaired or rejected; failures fall back to the built-in rules. The provider SDKs are optional peer dependencies.
- **Data reshaping** (`applyTransform`): time buckets, group & aggregate, last-N-periods, top N + "Other", long → wide pivots; partial final periods are flagged.

## 0.1.1 — 2026-10-29

No changes to the library itself.

- Releases are now published from GitHub Actions with npm trusted publishing, so every version carries a signed provenance statement.
- `npm publish --dry-run` works again: `prepublishOnly` no longer runs the packing check (CI still does).

## 0.1.0 — 2026-10-28

Initial release.

- 14 chart types: line, area, bar (grouped / stacked / 100% / horizontal), combo, pie, donut, scatter/bubble, heatmap, radar, funnel, gauge, treemap, sankey, waterfall.
- `StatCard` / `StatGroup` KPI tiles with deltas and sparklines; `DataTable` with sorting, search and pagination.
- Built-in data layer: `query` prop and `useReportData` with caching, de-duplication, retries, timeouts, polling and keep-previous-data.
- Exports: PNG, JPEG, SVG, CSV, Excel and PDF per chart and table; whole-report PDF and Excel via `<Report>`.
- Light/dark/auto themes, locale-aware formatting (incl. lakh/crore), colorblind-safe palette, table views and keyboard support.
- `reportdeck/core` (framework-agnostic builders) and `reportdeck/server` (SVG/Excel/PDF without a browser).
