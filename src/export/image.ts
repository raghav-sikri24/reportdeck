import { init } from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { escapeHtml } from '../core/builders/common';
import { LIGHT_TOKENS, SYSTEM_FONT_STACK } from '../core/tokens';
import type { ThemeTokens } from '../core/types';
import { isBrowser } from './download';

export interface ImageRenderOptions {
  /** CSS pixels. Default 960 × 480. */
  width?: number;
  height?: number;
  /** Raster scale for PNG/JPEG. Default 2 (crisp on retina and in print). */
  pixelRatio?: number;
  /** Heading drawn above the chart. */
  title?: string;
  subtitle?: string;
  /** Colors for background and heading. Default: light tokens. */
  tokens?: ThemeTokens;
  fontFamily?: string;
  /** Padding around the image in CSS px. Default 16 when there's a title, else 0. */
  padding?: number;
  /** Background color. Default: the theme's surface color. */
  background?: string;
}

interface Resolved {
  width: number;
  height: number;
  pixelRatio: number;
  tokens: ThemeTokens;
  fontFamily: string;
  title?: string;
  subtitle?: string;
  padding: number;
  headerHeight: number;
  background: string;
}

function resolve(opts: ImageRenderOptions): Resolved {
  const width = clampSize(opts.width ?? 960);
  const height = clampSize(opts.height ?? 480);
  const title = opts.title?.trim() || undefined;
  const subtitle = opts.subtitle?.trim() || undefined;
  const padding = opts.padding ?? (title ? 16 : 0);
  const tokens = opts.tokens ?? LIGHT_TOKENS;
  return {
    background: opts.background ?? tokens.surface,
    width,
    height,
    pixelRatio: Math.min(4, Math.max(1, opts.pixelRatio ?? 2)),
    tokens,
    fontFamily: opts.fontFamily ?? SYSTEM_FONT_STACK,
    title,
    subtitle,
    padding,
    headerHeight: title ? (subtitle ? 48 : 28) : 0,
  };
}

function clampSize(n: number): number {
  return Number.isFinite(n) ? Math.min(8000, Math.max(50, Math.round(n))) : 480;
}

function staticOption(option: EChartsCoreOption, background: string): EChartsCoreOption {
  return { ...option, animation: false, backgroundColor: background };
}

/** Renders an option to a PNG or JPEG data URL using an off-screen canvas. Browser only. */
export async function renderToImage(
  option: EChartsCoreOption,
  type: 'png' | 'jpeg' = 'png',
  options: ImageRenderOptions = {},
): Promise<string> {
  if (!isBrowser()) throw new Error('PNG/JPEG export needs a browser. Use renderToSVG() on the server.');
  const r = resolve(options);
  // Custom web fonts must be ready, or the canvas silently falls back.
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready?.catch(() => undefined);

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${r.width}px`,
    height: `${r.height}px`,
    pointerEvents: 'none',
  });
  document.body.appendChild(host);
  try {
    const chart = init(host, null, { renderer: 'canvas', width: r.width, height: r.height });
    try {
      chart.setOption(staticOption(option, r.background), { notMerge: true });
      if (!r.title && type === 'png' && r.padding === 0) {
        return chart.getDataURL({ type: 'png', pixelRatio: r.pixelRatio, backgroundColor: r.background });
      }
      // Compose straight from the chart's canvas — no data-URL round trip through
      // <img>, whose decode() can stall indefinitely in background tabs.
      const source = chart.renderToCanvas({ backgroundColor: r.background, pixelRatio: r.pixelRatio });
      return composeRaster(source, type, r);
    } finally {
      chart.dispose();
    }
  } finally {
    host.remove();
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function composeRaster(source: HTMLCanvasElement, type: 'png' | 'jpeg', r: Resolved): string {
  const totalW = r.width + r.padding * 2;
  const totalH = r.height + r.headerHeight + r.padding * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalW * r.pixelRatio);
  canvas.height = Math.round(totalH * r.pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  ctx.scale(r.pixelRatio, r.pixelRatio);
  ctx.fillStyle = r.background;
  ctx.fillRect(0, 0, totalW, totalH);
  if (r.title) {
    ctx.textBaseline = 'top';
    ctx.fillStyle = r.tokens.ink;
    ctx.font = `600 16px ${r.fontFamily}`;
    ctx.fillText(fitText(ctx, r.title, r.width), r.padding, r.padding);
    if (r.subtitle) {
      ctx.fillStyle = r.tokens.inkSecondary;
      ctx.font = `400 13px ${r.fontFamily}`;
      ctx.fillText(fitText(ctx, r.subtitle, r.width), r.padding, r.padding + 22);
    }
  }
  ctx.drawImage(source, r.padding, r.padding + r.headerHeight, r.width, r.height);
  return canvas.toDataURL(type === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95);
}

/**
 * Renders an option to a standalone SVG string. Works in the browser AND in
 * Node (ECharts server-side rendering) — no DOM required.
 */
export function renderToSVG(option: EChartsCoreOption, options: ImageRenderOptions = {}): string {
  const r = resolve(options);
  const chart = init(null as unknown as HTMLElement, null, {
    renderer: 'svg',
    ssr: true,
    width: r.width,
    height: r.height,
  });
  let inner: string;
  try {
    chart.setOption(staticOption(option, r.background), { notMerge: true });
    inner = chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
  if (!r.title && r.padding === 0) return inner;

  const totalW = r.width + r.padding * 2;
  const totalH = r.height + r.headerHeight + r.padding * 2;
  const font = escapeHtml(r.fontFamily);
  const heading = r.title
    ? `<text x="${r.padding}" y="${r.padding + 13}" font-family="${font}" font-size="16" font-weight="600" fill="${r.tokens.ink}">${escapeHtml(
        r.title,
      )}</text>${
        r.subtitle
          ? `<text x="${r.padding}" y="${r.padding + 35}" font-family="${font}" font-size="13" fill="${r.tokens.inkSecondary}">${escapeHtml(
              r.subtitle,
            )}</text>`
          : ''
      }`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect width="100%" height="100%" fill="${r.background}"/>` +
    heading +
    `<g transform="translate(${r.padding} ${r.padding + r.headerHeight})">${inner}</g>` +
    `</svg>`
  );
}
