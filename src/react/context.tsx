import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { getTokens, SYSTEM_FONT_STACK } from '../core/tokens';
import type { BuildContext, ColorMode, ThemeSetting } from '../core/types';
import { createFetcher, type Fetcher, type HeadersInput, type ReportDataError } from '../data/fetcher';
import { QueryStore } from '../data/store';
import type { PdfFont } from '../export/pdf';
import { useColorMode, useForcedColors, usePrefersReducedMotion } from './env';

export interface ReportDeckConfig {
  /** `auto` follows `data-theme`/`.dark` on <html>, then the OS setting. Default `auto`. */
  theme?: ThemeSetting;
  /** BCP 47 locale for numbers and dates, e.g. `en-IN`. Default `en-US`. */
  locale?: string;
  /** ISO 4217 code for `currency` formats. Default `USD`. */
  currency?: string;
  /** Font for chart text. Defaults to the system UI stack. */
  fontFamily?: string;
  /** `auto` disables animation when the user prefers reduced motion. */
  animation?: boolean | 'auto';
  /** Texture fills so series don't rely on color alone. `auto` turns on in forced-colors mode. */
  texture?: boolean | 'auto';
  /** Theme used for downloaded images and PDFs. Default `light` (prints well). */
  exportTheme?: 'light' | 'current';
  /** Prefix for relative query URLs. */
  baseUrl?: string;
  /** Static headers, or a (possibly async) function — ideal for short-lived auth tokens. */
  headers?: HeadersInput;
  credentials?: RequestCredentials;
  /** Replace the built-in fetch-based fetcher (axios, GraphQL, mocks…). */
  fetcher?: Fetcher;
  /** Retries for transient failures (network, timeouts, 429, 5xx). Default 2. */
  retry?: number;
  /** Per-attempt timeout in ms. Default 30000. */
  timeout?: number;
  /** How long fetched data counts as fresh, in ms. Default 0 (always revalidate, show cache instantly). */
  staleTime?: number;
  /** Unicode TTF used in PDFs (needed for ₹ and non-Latin scripts). */
  pdfFont?: PdfFont;
  /** Called for every data-loading error (logging, toasts). */
  onError?: (error: ReportDataError) => void;
  /** Called when an export fails. */
  onExportError?: (error: unknown) => void;
}

export interface ReportDeckContextValue {
  mode: ColorMode;
  /** Builder context for what's on screen. */
  ctx: BuildContext;
  /** Builder context for downloads. */
  exportCtx: BuildContext;
  config: ReportDeckConfig;
  fetcher: Fetcher;
  store: QueryStore;
}

const DEFAULT_STORE = /* @__PURE__ */ new QueryStore();

const ReportDeckContext = /* @__PURE__ */ createContext<ReportDeckContextValue | null>(null);

function useResolvedValue(config: ReportDeckConfig, store: QueryStore): ReportDeckContextValue {
  const mode = useColorMode(config.theme ?? 'auto');
  const reducedMotion = usePrefersReducedMotion();
  const forcedColors = useForcedColors();
  const animation = config.animation === undefined || config.animation === 'auto' ? !reducedMotion : config.animation;
  const texture = config.texture === 'auto' ? forcedColors : !!config.texture;
  const locale = config.locale ?? 'en-US';
  const currency = config.currency ?? 'USD';
  const fontFamily = config.fontFamily ?? SYSTEM_FONT_STACK;
  const exportMode: ColorMode = config.exportTheme === 'current' ? mode : 'light';

  const ctx = useMemo<BuildContext>(
    () => ({ tokens: getTokens(mode), locale, currency, fontFamily, animation, texture }),
    [mode, locale, currency, fontFamily, animation, texture],
  );
  const exportCtx = useMemo<BuildContext>(
    () => ({ tokens: getTokens(exportMode), locale, currency, fontFamily, animation: false, texture }),
    [exportMode, locale, currency, fontFamily, texture],
  );
  const fetcher = useMemo(
    () => config.fetcher ?? createFetcher({ baseUrl: config.baseUrl, headers: config.headers, credentials: config.credentials }),
    [config.fetcher, config.baseUrl, config.headers, config.credentials],
  );
  return useMemo(
    () => ({ mode, ctx, exportCtx, config, fetcher, store }),
    [mode, ctx, exportCtx, config, fetcher, store],
  );
}

export interface ReportDeckProviderProps extends ReportDeckConfig {
  children?: ReactNode;
}

/** Optional. Sets theme, locale, currency and how data is fetched for everything inside it. */
export function ReportDeckProvider({ children, ...config }: ReportDeckProviderProps) {
  const [store] = useState(() => new QueryStore());
  const stableConfig = useStableShallow(config);
  const value = useResolvedValue(stableConfig, store);
  return <ReportDeckContext.Provider value={value}>{children}</ReportDeckContext.Provider>;
}

const EMPTY_CONFIG: ReportDeckConfig = {};

/** Provider settings, or defaults when there is no provider. */
export function useReportDeck(): ReportDeckContextValue {
  const fromContext = useContext(ReportDeckContext);
  // Hooks must run unconditionally; the fallback is cheap and memoized.
  const fallback = useResolvedValue(EMPTY_CONFIG, DEFAULT_STORE);
  return fromContext ?? fallback;
}

/** Keeps the config object identity stable while its (shallow) values are unchanged. */
function useStableShallow<T extends object>(value: T): T {
  const [state] = useState<{ current: T }>(() => ({ current: value }));
  const prev = state.current as Record<string, unknown>;
  const next = value as Record<string, unknown>;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  const same = prevKeys.length === nextKeys.length && nextKeys.every((k) => Object.is(prev[k], next[k]));
  if (!same) state.current = value;
  return state.current;
}
