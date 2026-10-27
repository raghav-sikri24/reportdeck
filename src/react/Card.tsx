import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import type { ColorMode } from '../core/types';
import { AlertIcon, EmptyIcon, RefreshIcon } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface CardProps {
  mode: ColorMode;
  fontFamily: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  busy?: boolean;
  /** Render without card chrome (border, padding, header). */
  bare?: boolean;
  children: ReactNode;
  headingLevel?: 2 | 3 | 4;
}

/** Card chrome shared by charts, tables and stats. */
export const Card = /* @__PURE__ */ forwardRef<HTMLElement, CardProps>(function Card(
  { mode, fontFamily, title, subtitle, actions, footer, className, style, busy, bare, children, headingLevel = 3 },
  ref,
) {
  const Heading = `h${headingLevel}` as 'h3';
  const hasHeader = !bare && (title || subtitle || actions);
  return (
    <section
      ref={ref}
      className={cx('rd-root', `rd-${mode}`, bare ? 'rd-bare' : 'rd-card', className)}
      style={{ ['--rd-font' as string]: fontFamily, ...style }}
      aria-busy={busy || undefined}
    >
      {hasHeader ? (
        <header className="rd-card__header">
          <div className="rd-card__heading">
            {title ? <Heading className="rd-card__title">{title}</Heading> : null}
            {subtitle ? <p className="rd-card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="rd-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
      {footer ? <footer className="rd-card__footer">{footer}</footer> : null}
    </section>
  );
});

export function Skeleton({ height, variant = 'chart' }: { height: number | string; variant?: 'chart' | 'table' }) {
  return (
    <div className={cx('rd-skeleton', `rd-skeleton--${variant}`)} style={{ height }} role="status" aria-label="Loading">
      {variant === 'chart' ? (
        <div className="rd-skeleton__bars" aria-hidden="true">
          {[42, 68, 54, 82, 61, 74, 48].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      ) : (
        <div className="rd-skeleton__rows" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ height, message }: { height: number | string; message?: ReactNode }) {
  return (
    <div className="rd-state" style={{ height }} role="status">
      <EmptyIcon size={22} />
      <p className="rd-state__title">{message ?? 'No data to display'}</p>
    </div>
  );
}

export function describeError(error: unknown): { title: string; detail?: string } {
  const e = error as { kind?: string; status?: number; message?: string } | undefined;
  if (e?.kind === 'timeout') return { title: 'The request timed out', detail: 'The server took too long to respond.' };
  if (e?.kind === 'network') return { title: "Couldn't reach the server", detail: 'Check your connection and try again.' };
  if (e?.kind === 'parse') return { title: "Couldn't read the response", detail: e.message };
  if (e?.status === 401 || e?.status === 403) return { title: "You don't have access to this data", detail: `HTTP ${e.status}` };
  if (e?.status === 404) return { title: 'Data not found', detail: 'HTTP 404' };
  if (e?.status && e.status >= 500) return { title: 'The server had a problem', detail: `HTTP ${e.status}` };
  if (typeof error === 'string') return { title: error };
  return { title: "Couldn't load data", detail: e?.message };
}

export function ErrorState({ height, error, onRetry }: { height: number | string; error: unknown; onRetry?: () => void }) {
  const { title, detail } = describeError(error);
  return (
    <div className="rd-state rd-state--error" style={{ height }} role="alert">
      <AlertIcon size={22} />
      <p className="rd-state__title">{title}</p>
      {detail ? <p className="rd-state__detail">{detail}</p> : null}
      {onRetry ? (
        <button type="button" className="rd-button" onClick={onRetry}>
          <RefreshIcon size={14} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Compact notice when a refresh failed but older data is still on screen. */
export function StaleNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title } = describeError(error);
  return (
    <div className="rd-stale" role="status">
      <AlertIcon size={14} />
      <span>{title} — showing the last loaded data.</span>
      {onRetry ? (
        <button type="button" className="rd-link" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
