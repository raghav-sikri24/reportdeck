import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { profileData, redactProfile, type PrivacyLevel } from '../ai/profile';
import { recommendCharts } from '../ai/recommend';
import { compileSpec, specKey, validateSpec, type ChartSpec, type ComponentName } from '../ai/spec';
import { toRows } from '../core/data';
import type { Query } from '../data/fetcher';
import { Card, cx, EmptyState, ErrorState, Skeleton } from './Card';
import {
  AreaChart,
  BarChart,
  DonutChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
  WaterfallChart,
} from './charts';
import { useReportDeck } from './context';
import { DataTable } from './DataTable';
import { ChartIcon, SearchIcon, SparkleIcon, TableIcon } from './icons';
import { useStableData } from './stable';
import { StatCard } from './StatCard';
import { useReportData, type ReportDataOptions } from './useReportData';

type AnyComponent = ComponentType<Record<string, unknown>>;
const COMPONENTS: Record<ComponentName, AnyComponent> = {
  LineChart: LineChart as unknown as AnyComponent,
  AreaChart: AreaChart as unknown as AnyComponent,
  BarChart: BarChart as unknown as AnyComponent,
  PieChart: PieChart as unknown as AnyComponent,
  DonutChart: DonutChart as unknown as AnyComponent,
  ScatterChart: ScatterChart as unknown as AnyComponent,
  HeatmapChart: HeatmapChart as unknown as AnyComponent,
  RadarChart: RadarChart as unknown as AnyComponent,
  FunnelChart: FunnelChart as unknown as AnyComponent,
  TreemapChart: TreemapChart as unknown as AnyComponent,
  SankeyChart: SankeyChart as unknown as AnyComponent,
  WaterfallChart: WaterfallChart as unknown as AnyComponent,
  StatCard: StatCard as unknown as AnyComponent,
  DataTable: DataTable as unknown as AnyComponent,
};

export interface AutoChartProps {
  /** Raw rows (any shape). Or use `query` to fetch them. */
  data?: unknown;
  query?: Query | null;
  queryOptions?: ReportDataOptions;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /**
   * `auto` renders the best view right away (with a "Change view" picker);
   * `suggest` shows the options first and lets the user pick. Default `auto`.
   */
  mode?: 'auto' | 'suggest';
  /**
   * Your backend endpoint created with `createChartAdvisor` (from `reportdeck/server`).
   * Omit or `false` to use only the built-in rules — free, instant, offline.
   */
  advisor?: string | false;
  /** How much the AI may see. Default `summary` (column info, ranges and common labels — no rows). */
  privacy?: PrivacyLevel;
  /** Show an "Ask" box for requests like "monthly revenue by channel". Default true. */
  ask?: boolean;
  /** Start with this request. */
  question?: string;
  /** Views to offer (1–6). Default 4. */
  maxSuggestions?: number;
  /** Controlled view. */
  spec?: ChartSpec;
  /** Called when the user picks a view or asks for one. */
  onSpecChange?: (spec: ChartSpec) => void;
  /** Remember the user's choice in this browser under this key. */
  rememberAs?: string;
  /** Overrides the suggested title. */
  title?: string;
  height?: number;
  downloads?: boolean;
  className?: string;
  style?: CSSProperties;
  span?: 1 | 2 | 'full';
  headingLevel?: 2 | 3 | 4;
}

const STORAGE_PREFIX = 'reportdeck:autochart:';

function readStored(key?: string): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeStored(key: string | undefined, value: string): void {
  if (!key) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Private mode / blocked storage: remembering is a convenience only.
  }
}

const PREVIEW_PROPS = {
  frame: false,
  height: 112,
  downloads: false,
  tableView: false,
  includeInReport: false,
  labels: 'none',
  legend: false,
  zoom: false,
  showPoints: false,
  centerLabel: false,
  renderer: 'svg',
};

function Preview({ spec, rows, profile }: { spec: ChartSpec; rows: unknown; profile: ReturnType<typeof profileData> }) {
  const view = useMemo(() => compileSpec(spec, rows, profile), [spec, rows, profile]);
  if (view.component === 'DataTable') {
    return (
      <div className="rd-auto__icon-preview">
        <TableIcon size={28} />
      </div>
    );
  }
  if (view.component === 'StatCard') {
    return <StatCard label="" value={view.props.value} format={view.props.format as never} includeInReport={false} className="rd-auto__stat-preview" />;
  }
  const Component = COMPONENTS[view.component];
  return <Component {...view.props} {...PREVIEW_PROPS} data={view.data} ariaLabel={`Preview: ${spec.title}`} />;
}

/**
 * Picks the right chart for raw data automatically — with built-in rules,
 * optionally refined by an AI model through your backend — and lets the user
 * switch views or ask for one in plain words.
 */
export function AutoChart(props: AutoChartProps) {
  const {
    mode = 'auto',
    advisor,
    privacy = 'summary',
    ask = true,
    maxSuggestions = 4,
    rememberAs,
    onSpecChange,
    headingLevel,
  } = props;
  const deck = useReportDeck();
  const usingQuery = !!props.query;
  const q = useReportData(props.query ?? null, props.queryOptions);
  const raw = useStableData(usingQuery ? q.data : props.data);
  const rows = useMemo(() => toRows(raw), [raw]);
  const profile = useMemo(() => profileData(rows), [rows]);
  const count = Math.min(6, Math.max(1, maxSuggestions));

  const [question, setQuestion] = useState(props.question?.trim() ?? '');
  const [draft, setDraft] = useState(props.question ?? '');
  const [selected, setSelected] = useState<string | null>(() => readStored(rememberAs));
  const [pickerOpen, setPickerOpen] = useState(mode === 'suggest');
  const pendingPick = useRef(!!props.question);

  const rules = useMemo(() => recommendCharts(profile, { question, max: count + 2 }), [profile, question, count]);

  // ---- AI (optional) ----
  const advisorOn = !!advisor && rows.length > 0;
  const sentProfile = useMemo(() => redactProfile(profile, privacy), [profile, privacy]);
  const ai = useReportData<ChartSpec[]>(
    advisorOn ? { url: advisor as string, method: 'POST', body: { profile: sentProfile, question, count } } : null,
    {
      retry: 0,
      timeout: 25_000,
      staleTime: 10 * 60_000,
      keepPreviousData: false,
      // Never trust the server's answer blindly: re-validate against the full profile.
      select: (res) => {
        const list = (res as { suggestions?: unknown[] } | null)?.suggestions ?? [];
        return list.map((s) => validateSpec(s, profile).spec).filter((s): s is ChartSpec => s !== null).map((s) => ({ ...s, source: 'ai' as const }));
      },
    },
  );
  const aiSpecs = useMemo(() => ai.data ?? [], [ai.data]);
  const aiPending = advisorOn && ai.isLoading;
  const aiFailed = advisorOn && !!ai.error && aiSpecs.length === 0;

  // AI suggestions first, then rules; one entry per distinct view.
  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: ChartSpec[] = [];
    for (const s of [...aiSpecs, ...rules]) {
      const k = specKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, [aiSpecs, rules]);

  // Give the AI a few seconds to make the first pick, then fall back to the rules.
  const [waitExpired, setWaitExpired] = useState(false);
  useEffect(() => {
    if (!aiPending) return;
    const t = setTimeout(() => setWaitExpired(true), 4000);
    return () => clearTimeout(t);
  }, [aiPending]);

  // After a question, jump to the best answer once it's ready (AI if configured).
  useEffect(() => {
    if (!pendingPick.current || aiPending) return;
    const best = all[0];
    if (!best) return;
    pendingPick.current = false;
    setSelected(specKey(best));
    onSpecChange?.(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, aiPending]);

  const controlled = props.spec ? validateSpec(props.spec, profile).spec : null;
  const waitingForAi = advisorOn && aiPending && !waitExpired;
  const chosen: ChartSpec | null =
    controlled ?? (selected ? all.find((s) => specKey(s) === selected) : undefined) ?? (waitingForAi ? null : (all[0] ?? null));

  // Lock in whatever is on screen, so a late AI answer never swaps the chart out from under the user.
  const chosenKey = chosen ? specKey(chosen) : null;
  useEffect(() => {
    if (!controlled && chosenKey && chosenKey !== selected && mode === 'auto') setSelected(chosenKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey]);

  const suggestions = useMemo(() => {
    const list = all.slice(0, count);
    if (chosen && !list.some((s) => specKey(s) === chosenKey)) list[list.length - 1] = chosen;
    return list;
  }, [all, count, chosen, chosenKey]);

  const choose = (spec: ChartSpec) => {
    const k = specKey(spec);
    setSelected(k);
    writeStored(rememberAs, k);
    onSpecChange?.(spec);
    if (mode === 'auto') setPickerOpen(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    pendingPick.current = true;
    setQuestion(text);
    setPickerOpen(true);
  };

  const inputId = useId();
  const loading = props.loading ?? (usingQuery && q.isLoading);
  const error = props.error ?? (usingQuery ? q.error : undefined);
  const retry = props.onRetry ?? (usingQuery ? () => void q.refetch() : undefined);
  const height = props.height ?? 320;

  const shell = (children: ReactNode, title?: string, subtitle?: string, actions?: ReactNode) => (
    <Card
      mode={deck.mode}
      fontFamily={deck.ctx.fontFamily}
      title={title}
      subtitle={subtitle}
      actions={actions}
      className={cx('rd-auto', props.span === 2 && 'rd-span-2', props.span === 'full' && 'rd-span-full', props.className)}
      style={props.style}
      headingLevel={headingLevel}
    >
      {children}
    </Card>
  );

  if (loading && rows.length === 0) return shell(<Skeleton height={height} />, props.title);
  if (error && rows.length === 0) return shell(<ErrorState height={height} error={error} onRetry={retry} />, props.title);
  if (rows.length === 0) return shell(<EmptyState height={height} />, props.title);

  const askBar = ask ? (
    <form className="rd-auto__ask" onSubmit={submit} role="search">
      <label htmlFor={inputId} className="rd-sr-only">
        Describe the view you want
      </label>
      <SearchIcon size={14} />
      <input
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={advisor ? 'Ask for a view, e.g. “monthly totals by region”' : 'Describe a view, e.g. “share by channel”'}
        maxLength={300}
      />
      <button type="submit" className="rd-button" disabled={!draft.trim() || (pendingPick.current && aiPending)}>
        {advisor ? <SparkleIcon size={14} /> : null}
        {pendingPick.current && aiPending ? 'Thinking…' : 'Show'}
      </button>
    </form>
  ) : null;

  const status = advisorOn ? (
    <p className="rd-auto__status" role="status">
      {aiPending ? 'Asking the AI for better views…' : aiFailed ? 'AI suggestions are unavailable — showing built-in suggestions.' : aiSpecs.length > 0 ? 'Suggestions marked AI come from your AI model.' : null}
    </p>
  ) : null;

  const picker = (
    <div className="rd-auto__panel">
      {askBar}
      {status}
      <ul className="rd-auto__grid" aria-label="Suggested views">
        {suggestions.map((s) => {
          const k = specKey(s);
          // In suggest mode nothing is "selected" until the user picks.
          const active = chosen && (selected || controlled || mode === 'auto') ? specKey(chosen) === k : false;
          return (
            <li key={k}>
              <button type="button" className={cx('rd-auto__tile', active && 'is-active')} aria-pressed={active} onClick={() => choose(s)}>
                <div className="rd-auto__preview" aria-hidden="true">
                  <Preview spec={s} rows={rows} profile={profile} />
                </div>
                <span className="rd-auto__tile-title">
                  {s.source === 'ai' ? (
                    <span className="rd-auto__badge">
                      <SparkleIcon size={11} /> AI
                    </span>
                  ) : null}
                  {s.title}
                </span>
                {s.reason ? <span className="rd-auto__tile-reason">{s.reason}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  // Auto mode while the AI makes its first pick.
  if (!chosen && mode === 'auto') {
    return shell(<Skeleton height={height} />, props.title, 'Choosing the best view for this data…');
  }
  // Suggest mode before the user has chosen.
  if (!chosen || (mode === 'suggest' && !selected && !controlled)) {
    return shell(
      picker,
      props.title ?? 'Choose a view',
      `${rows.length.toLocaleString(deck.ctx.locale)} rows · ${profile.columns.length} columns`,
    );
  }

  const view = compileSpec(chosen, rows, profile);
  const Component = COMPONENTS[view.component];
  const toggle = (
    <button
      type="button"
      className="rd-icon-button"
      aria-expanded={pickerOpen}
      aria-label={pickerOpen ? 'Hide other views' : 'Change view'}
      title={pickerOpen ? 'Hide other views' : 'Change view'}
      onClick={() => setPickerOpen((o) => !o)}
    >
      <ChartIcon />
    </button>
  );
  const subtitle = [chosen.source === 'ai' ? 'AI pick' : '', chosen.reason, ...view.notes]
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .join(' · ');

  if (view.component === 'StatCard') {
    return shell(
      <>
        <StatCard label={props.title ?? chosen.title} value={view.props.value} format={view.props.format as never} className="rd-auto__stat-value" />
        {pickerOpen ? picker : null}
      </>,
      props.title ?? chosen.title,
      subtitle,
      toggle,
    );
  }

  return (
    <Component
      {...view.props}
      key={specKey(chosen)}
      data={view.data}
      title={props.title ?? chosen.title}
      subtitle={subtitle}
      height={props.height}
      downloads={props.downloads}
      actions={toggle}
      footer={pickerOpen ? picker : undefined}
      className={cx('rd-auto', props.className)}
      style={props.style}
      span={props.span}
      headingLevel={headingLevel}
    />
  );
}
