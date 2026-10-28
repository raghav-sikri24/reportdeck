import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  XAXisComponentOption,
} from 'echarts';
import { withAlpha } from '../colors';
import { getTokens, SYSTEM_FONT_STACK } from '../tokens';
import type { BuildContext, ColorMode } from '../types';

/** Builder context with sensible defaults; useful outside React (server rendering, tests). */
export function createBuildContext(partial: Partial<BuildContext> & { mode?: ColorMode } = {}): BuildContext {
  const { mode = 'light', ...rest } = partial;
  return {
    tokens: getTokens(mode),
    locale: 'en-US',
    currency: 'USD',
    fontFamily: SYSTEM_FONT_STACK,
    animation: true,
    texture: false,
    ...rest,
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Labels come from API responses — never trust them inside tooltip HTML. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function baseOption(ctx: BuildContext) {
  return {
    backgroundColor: 'transparent',
    animation: ctx.animation,
    animationDuration: 450,
    animationDurationUpdate: 300,
    animationEasing: 'cubicOut' as const,
    textStyle: { fontFamily: ctx.fontFamily, color: ctx.tokens.inkSecondary },
    aria: {
      enabled: true,
      decal: { show: ctx.texture },
    },
  };
}

export function tooltipBase(
  ctx: BuildContext,
  trigger: 'axis' | 'item',
  pointer: 'line' | 'shadow' | 'none' = 'line',
): TooltipComponentOption {
  const t = ctx.tokens;
  return {
    trigger,
    confine: true,
    backgroundColor: t.tooltipBackground,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.ink, fontSize: 12, fontFamily: ctx.fontFamily },
    extraCssText: `border-radius:8px;box-shadow:0 6px 24px ${
      t.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(11,11,11,0.12)'
    };max-width:320px;white-space:normal;`,
    axisPointer:
      trigger === 'axis'
        ? pointer === 'shadow'
          ? { type: 'shadow', shadowStyle: { color: withAlpha(t.ink, t.mode === 'dark' ? 0.06 : 0.04) } }
          : pointer === 'line'
            ? { type: 'line', lineStyle: { color: t.axis, width: 1, type: 'solid' } }
            : { type: 'none' }
        : undefined,
  };
}

/** Tooltip header line. */
export function tooltipHeader(ctx: BuildContext, text: string): string {
  return `<div style="margin-bottom:6px;color:${ctx.tokens.inkSecondary};font-size:12px">${escapeHtml(
    text,
  )}</div>`;
}

/**
 * One tooltip row: a short key stroke in the series color, the value (strong),
 * then the series name (secondary). Values lead, labels follow.
 */
export function tooltipRow(
  ctx: BuildContext,
  color: string,
  name: string,
  value: string,
  key: 'line' | 'rect' = 'line',
): string {
  const t = ctx.tokens;
  const swatch =
    key === 'line'
      ? `<span style="display:inline-block;width:12px;height:2px;border-radius:1px;background:${escapeHtml(color)}"></span>`
      : `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${escapeHtml(color)}"></span>`;
  return `<div style="display:flex;align-items:center;gap:8px;line-height:20px">${swatch}<strong style="color:${t.ink};font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(
    value,
  )}</strong><span style="color:${t.inkSecondary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(
    name,
  )}</span></div>`;
}

const LINE_ICON = 'path://M0,1 L14,1 L14,3 L0,3 Z';

export function legendBase(
  ctx: BuildContext,
  items: { name: string; icon?: 'line' | 'rect' }[],
): LegendComponentOption {
  const t = ctx.tokens;
  return {
    show: true,
    type: 'scroll',
    top: 0,
    left: 0,
    right: 0,
    itemGap: 16,
    itemWidth: 14,
    itemHeight: 10,
    textStyle: { color: t.inkSecondary, fontSize: 12, fontFamily: ctx.fontFamily, width: 160, overflow: 'truncate' },
    pageIconColor: t.inkSecondary,
    pageIconInactiveColor: t.axis,
    pageTextStyle: { color: t.inkMuted },
    inactiveColor: t.axis,
    data: items.map((item) => ({
      name: item.name,
      icon: item.icon === 'line' ? LINE_ICON : 'roundRect',
      itemStyle: item.icon === 'line' ? { borderWidth: 0 } : undefined,
    })),
  };
}

export function gridBase(opts: { legend: boolean; zoom: boolean; right?: number; bottom?: number }): GridComponentOption {
  return {
    left: 4,
    right: 16 + (opts.right ?? 0),
    top: opts.legend ? 40 : 12,
    bottom: (opts.zoom ? 44 : 4) + (opts.bottom ?? 0),
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  };
}

export function categoryAxisLabel(ctx: BuildContext, maxWidth = 96) {
  return {
    color: ctx.tokens.inkMuted,
    fontSize: 11,
    // Try every label and hide only those that truly collide. ECharts' default
    // 'auto' interval measures untruncated text and skips labels that would fit.
    interval: 0,
    hideOverlap: true,
    width: maxWidth,
    overflow: 'truncate' as const,
    ellipsis: '…',
  };
}

export function categoryAxis(
  ctx: BuildContext,
  labels: string[],
  opts: { boundaryGap: boolean; inverse?: boolean; vertical?: boolean },
): XAXisComponentOption {
  const t = ctx.tokens;
  return {
    type: 'category',
    data: labels,
    boundaryGap: opts.boundaryGap,
    inverse: opts.inverse,
    axisLine: { show: !opts.vertical, lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: categoryAxisLabel(ctx, opts.vertical ? 120 : 96),
    splitLine: { show: false },
  } as XAXisComponentOption;
}

export function valueAxis(
  ctx: BuildContext,
  formatter: (v: number) => string,
  opts: { min?: number | 'dataMin'; max?: number | 'dataMax'; scale?: boolean; showLine?: boolean } = {},
) {
  const t = ctx.tokens;
  return {
    type: 'value' as const,
    min: opts.min,
    max: opts.max,
    scale: opts.scale ?? false,
    splitNumber: 5,
    axisLine: { show: opts.showLine ?? false, lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: {
      color: t.inkMuted,
      fontSize: 11,
      formatter: (v: number) => formatter(v),
      hideOverlap: true,
    },
    splitLine: { show: true, lineStyle: { color: t.grid, width: 1, type: 'solid' as const } },
  };
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat('en-US', options);
  }
}

const DAY_MS = 86_400_000;

/**
 * Locale-aware time axis whose labels adapt to the time span, so labels never
 * collide and every label carries its own context:
 * - ≤ 3 days: times, with day boundaries emphasized ("Oct 5", "06:00", …)
 * - long spans without zoom: month names, years emphasized ("Nov", "Dec", "2026", …)
 * - otherwise: "Oct 5"-style dates (stays readable when the user zooms in)
 */
export function timeAxis(ctx: BuildContext, opts: { span?: number; zoom?: boolean } = {}) {
  const t = ctx.tokens;
  const span = opts.span ?? 0;
  const mode = span > 0 && span <= 3 * DAY_MS ? 'intraday' : !opts.zoom && span > 45 * DAY_MS ? 'months' : 'days';
  const year = dateFormat(ctx.locale, { year: 'numeric' });
  const month = dateFormat(ctx.locale, { month: 'short' });
  const dayMonth = dateFormat(ctx.locale, { month: 'short', day: 'numeric' });
  const time = dateFormat(ctx.locale, { hour: 'numeric', minute: '2-digit' });
  const strong = (s: string) => `{strong|${s}}`;
  return {
    type: 'time' as const,
    boundaryGap: false as const,
    axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: {
      color: t.inkMuted,
      fontSize: 11,
      hideOverlap: true,
      formatter: (value: number) => {
        const d = new Date(value);
        const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
        const monthStart = midnight && d.getDate() === 1;
        const yearStart = monthStart && d.getMonth() === 0;
        if (mode === 'months') {
          if (yearStart) return strong(year.format(d));
          if (span > 3 * 365 * DAY_MS) return '';
          return monthStart ? month.format(d) : '';
        }
        if (mode === 'intraday') return midnight ? strong(dayMonth.format(d)) : time.format(d);
        if (yearStart) return strong(year.format(d));
        return midnight ? dayMonth.format(d) : time.format(d);
      },
      rich: { strong: { fontWeight: 600, color: t.inkSecondary, fontSize: 11 } },
    },
    splitLine: { show: false },
  };
}

export function dataZoom(ctx: BuildContext, orient: 'horizontal' | 'vertical'): DataZoomComponentOption[] {
  const t = ctx.tokens;
  const axis = orient === 'horizontal' ? { xAxisIndex: 0 } : { yAxisIndex: 0 };
  return [
    {
      type: 'inside',
      ...axis,
      // Plain wheel scrolls the page; ctrl/⌘ + wheel (and trackpad pinch) zooms.
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: false,
    },
    {
      type: 'slider',
      ...axis,
      height: orient === 'horizontal' ? 18 : undefined,
      width: orient === 'vertical' ? 18 : undefined,
      bottom: orient === 'horizontal' ? 8 : undefined,
      right: orient === 'vertical' ? 4 : undefined,
      borderColor: t.grid,
      backgroundColor: 'transparent',
      fillerColor: withAlpha(t.series[0]!, 0.12),
      dataBackground: {
        lineStyle: { color: t.axis, width: 1 },
        areaStyle: { color: withAlpha(t.axis, 0.3) },
      },
      selectedDataBackground: {
        lineStyle: { color: t.series[0], width: 1 },
        areaStyle: { color: withAlpha(t.series[0]!, 0.15) },
      },
      handleStyle: { color: t.surface, borderColor: t.axis },
      moveHandleStyle: { color: t.axis },
      textStyle: { color: t.inkMuted, fontSize: 10 },
      brushSelect: false,
    },
  ];
}

export function warnOnce(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message);
}
