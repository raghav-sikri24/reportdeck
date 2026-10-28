# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-28

Initial release.

- 14 chart types: line, area, bar (grouped / stacked / 100% / horizontal), combo, pie, donut, scatter/bubble, heatmap, radar, funnel, gauge, treemap, sankey, waterfall.
- `StatCard` / `StatGroup` KPI tiles with deltas and sparklines; `DataTable` with sorting, search and pagination.
- Built-in data layer: `query` prop and `useReportData` with caching, de-duplication, retries, timeouts, polling and keep-previous-data.
- Exports: PNG, JPEG, SVG, CSV, Excel and PDF per chart and table; whole-report PDF and Excel via `<Report>`.
- Light/dark/auto themes, locale-aware formatting (incl. lakh/crore), colorblind-safe palette, table views and keyboard support.
- `reportdeck/core` (framework-agnostic builders) and `reportdeck/server` (SVG/Excel/PDF without a browser).
