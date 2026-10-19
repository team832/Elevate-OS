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
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="el-state" data-state="empty">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ?? null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'The page could not be loaded. Try again; if it keeps happening, report the reference below.',
  requestId,
  action,
}: {
  title?: string;
  description?: ReactNode;
  requestId?: string;
  action?: ReactNode;
}) {
  return (
    <div className="el-state el-state-error" role="alert" data-state="error">
      <h2>{title}</h2>
      <p>{description}</p>
      {requestId ? <p className="el-request-id">Reference: {requestId}</p> : null}
      {action ?? null}
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
