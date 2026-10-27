import type { ColorMode, StatusLevel, ThemeTokens } from './types';

/**
 * Categorical palette, validated for color-vision deficiency (adjacent-pair
 * ΔE ≥ 8 in both modes). The ORDER is part of the accessibility guarantee —
 * series take slots in this order and never cycle.
 */
const SERIES_LIGHT = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#6250d6', // violet
  '#e34948', // red
] as const;

const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/** Single-hue blue ramp, light → dark (100 … 700). */
const BLUE_RAMP = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
] as const;

const STATUS: Record<StatusLevel, string> = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

export const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const LIGHT_TOKENS: ThemeTokens = {
  mode: 'light',
  surface: '#fcfcfb',
  page: '#f9f9f7',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  // Slightly darker than a pure "muted" gray so axis text clears WCAG AA 4.5:1.
  inkMuted: '#6b6a66',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11, 11, 11, 0.10)',
  tooltipBackground: '#ffffff',
  deemphasis: '#c9c7bf',
  neutral: '#6b6a66',
  series: SERIES_LIGHT,
  // Sequential: near-zero recedes toward the light surface.
  sequential: BLUE_RAMP,
  // Ordinal (funnels, tiers): lightest step still clears 2:1 on the surface.
  ordinal: BLUE_RAMP.slice(3, 12),
  diverging: { negative: '#e34948', neutral: '#f0efec', positive: '#2a78d6' },
  status: STATUS,
  deltaUp: '#006300',
  deltaDown: '#d03b3b',
};

export const DARK_TOKENS: ThemeTokens = {
  mode: 'dark',
  surface: '#1a1a19',
  page: '#0d0d0d',
  ink: '#f0efec',
  inkSecondary: '#c3c2b7',
  inkMuted: '#a3a199',
  grid: '#2c2c2a',
  axis: '#383835',
  border: 'rgba(255, 255, 255, 0.10)',
  tooltipBackground: '#262624',
  deemphasis: '#4a4a46',
  neutral: '#a3a199',
  series: SERIES_DARK,
  // Sequential on dark: near-zero recedes toward the dark surface, so the ramp flips.
  sequential: [...BLUE_RAMP.slice(1, 12)].reverse(),
  ordinal: [...BLUE_RAMP.slice(1, 11)].reverse(),
  diverging: { negative: '#e66767', neutral: '#383835', positive: '#3987e5' },
  status: STATUS,
  deltaUp: '#0ca30c',
  deltaDown: '#ef6b6b',
};

export function getTokens(mode: ColorMode): ThemeTokens {
  return mode === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
}

/** Hard ceiling on categorical hues. Past this, series fold into "Other" or go neutral. */
export const MAX_CATEGORICAL = SERIES_LIGHT.length;
