import type { ThemeTokens } from './types';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses `#rgb`, `#rrggbb` (and the alpha-less part of `#rrggbbaa`). Returns null for anything else. */
export function parseHex(color: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

const toHex = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** `color` at the given alpha. Non-hex colors are returned unchanged (callers fall back to `opacity`). */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** Linear mix in sRGB: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return `#${toHex(ca.r + (cb.r - ca.r) * t)}${toHex(ca.g + (cb.g - ca.g) * t)}${toHex(
    ca.b + (cb.b - ca.b) * t,
  )}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `fill`. Used for labels set inside marks. */
export function inkOn(fill: string): string {
  const light = '#ffffff';
  const dark = '#0b0b0b';
  const cl = contrastRatio(fill, light) ?? 0;
  const cd = contrastRatio(fill, dark) ?? 21;
  return cl >= cd ? light : dark;
}

/** Sample a ramp at t ∈ [0, 1] with linear interpolation between steps. */
export function sampleRamp(ramp: readonly string[], t: number): string {
  if (ramp.length === 0) return '#888888';
  if (ramp.length === 1 || !Number.isFinite(t)) return ramp[0]!;
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (ramp.length - 1);
  const i = Math.floor(pos);
  if (i >= ramp.length - 1) return ramp[ramp.length - 1]!;
  return mix(ramp[i]!, ramp[i + 1]!, pos - i);
}

/** Pick `count` evenly spaced steps from a ramp, in order. */
export function pickSteps(ramp: readonly string[], count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [ramp[Math.floor((ramp.length - 1) / 2)]!];
  return Array.from({ length: count }, (_, i) => sampleRamp(ramp, i / (count - 1)));
}

/**
 * Color for the n-th categorical entity. Colors follow declaration order, never
 * value rank, so filtering never repaints survivors. Past the palette size,
 * entities fall back to a neutral gray instead of inventing a hue.
 */
export function categoricalColor(tokens: ThemeTokens, index: number, override?: string): string {
  if (override) return override;
  return tokens.series[index] ?? tokens.neutral;
}
