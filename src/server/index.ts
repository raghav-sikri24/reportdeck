// Node / edge helpers: render charts to SVG and build Excel/PDF files without a browser.
import { registerAll } from '../core/modules';
import type { ChartModel } from '../core/types';
import { renderToSVG, type ImageRenderOptions } from '../export/image';

export * from '../core';
export { renderToSVG } from '../export/image';
export type { ImageRenderOptions } from '../export/image';
export { buildWorkbook, sanitizeSheetName } from '../export/excel';
export type { ExcelOptions, SheetSpec, WorkbookResult } from '../export/excel';
export { buildPdf, toPdfSafeText } from '../export/pdf';
export { AdvisorError, createChartAdvisor, DEFAULT_MODELS, parseModelJson, sanitizeProfile, suggestCharts } from './advisor';
export type { AdvisorResult, BuiltInProvider, ChartAdvisorOptions, CustomProvider, ProviderRequest } from './advisor';
export type { PdfBlock, PdfFont, PdfOptions, PdfStat } from '../export/pdf';

let registered = false;

/** Renders a chart model (from any `build*` function) to a standalone SVG string. */
export function renderChartSVG(model: ChartModel, options: ImageRenderOptions = {}): string {
  if (!registered) {
    registerAll();
    registered = true;
  }
  return renderToSVG(model.option, options);
}
