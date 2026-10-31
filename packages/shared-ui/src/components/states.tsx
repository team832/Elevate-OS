import type { ReactNode } from 'react';
import type { Tone } from './data';

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Exclude<Tone, 'neutral'>;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`el-alert el-tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title ? <p className="el-alert-title">{title}</p> : null}
      {children ? <div className="el-alert-body">{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  level = 2,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** 1 when the state is the whole page (e.g. "Page not found"), so the page keeps one h1. */
  level?: 1 | 2;
}) {
  return (
    <div className="el-state" data-state="empty">
      {level === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description ? <p>{description}</p> : null}
      {action ?? null}
    </div>
  );
}

/** URL values that pick a record or a page, not a filter. */
const NOT_FILTERS = new Set(['page', 'open', 'act', 'new', 'newEvent', 'section', 'notice', 'error', 'view', 'tab']);

/** True when a list's URL holds a filter (a search box or select left blank is not one). */
export const hasFilter = (params: Record<string, unknown>) =>
  Object.entries(params).some(([k, v]) => !NOT_FILTERS.has(k) && v !== undefined && v !== '');

/** A list with no rows: with a filter set, it says so; with none, it says what to do first. */
export function ListEmpty({
  noun,
  params,
  first,
  action,
}: {
  /** Plural, as in "No leads yet". */
  noun: string;
  /** The list's URL parameters. */
  params: Record<string, unknown>;
  first: ReactNode;
  action?: ReactNode;
}) {
  return hasFilter(params) ? (
    <EmptyState title={`No ${noun} match these filters`} description="Change or clear the filters." />
  ) : (
    <EmptyState title={`No ${noun} yet`} description={first} action={action} />
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'This could not be loaded. Try again in a moment; if it keeps happening, tell a platform administrator.',
  requestId,
  action,
  level = 2,
}: {
  title?: string;
  description?: ReactNode;
  /** 1 when the error replaces the whole page (e.g. "No access"), so the page keeps one h1. */
  level?: 1 | 2;
  /** Shown as a reference to quote to an administrator; omitted when unknown. */
  requestId?: string;
  /** Next step, e.g. a "Try again" link to the current URL. */
  action?: ReactNode;
}) {
  return (
    <div className="el-state el-state-error" role="alert" data-state="error">
      {level === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      <p>{description}</p>
      {action ?? null}
      {requestId ? (
        <p>
          Reference for the administrator: <code className="el-request-id">{requestId}</code>
        </p>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="el-state" role="status" aria-live="polite" data-state="loading">
      <span className="el-spinner" aria-hidden="true" /> <span>{label}</span>
    </div>
  );
}
