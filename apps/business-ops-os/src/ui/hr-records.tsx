/**
 * Small server-rendered helpers for the HR records screens: status tones, a
 * GET filter form (works without JavaScript) and a pager. Uses the shared-ui
 * classes only (el-inline-form, el-field, el-input, el-select, el-button).
 */
import type { ReactNode } from 'react';
import type { Tone } from '@elevate/shared-ui';
import { humanise } from './format';

/** One tone table for every HR status (employment, document, compensation, asset). */
const TONES: Record<string, Tone> = {
  onboarding: 'info',
  active: 'success',
  on_notice: 'warning',
  separated: 'neutral',
  superseded: 'neutral',
  retention_hold: 'warning',
  deletion_requested: 'warning',
  deleted: 'neutral',
  draft: 'info',
  approved: 'success',
  cancelled: 'neutral',
  available: 'success',
  assigned: 'info',
  in_repair: 'warning',
  retired: 'neutral',
  lost: 'danger',
};
export const hrTone = (status: string): Tone => TONES[status] ?? 'neutral';

export interface FilterField {
  name: string;
  label: string;
  type?: 'text' | 'select' | 'date';
  options?: readonly { value: string; label: string }[];
  value?: string;
  /** Label of the empty option for selects (default "Any"). */
  anyLabel?: string;
}

/** GET form: submitting reloads the page with the filters in the query string. */
export function FilterForm({
  action,
  fields,
  submitLabel,
  resetHref,
}: {
  action: string;
  fields: readonly FilterField[];
  submitLabel: string;
  resetHref?: string;
}) {
  return (
    <form method="get" action={action} className="el-inline-form" role="search">
      {fields.map((f) => {
        const id = `filter-${f.name}`;
        return (
          <div key={f.name} className="el-field">
            <label htmlFor={id}>{f.label}</label>
            {f.type === 'select' ? (
              <select id={id} name={f.name} className="el-select" defaultValue={f.value ?? ''}>
                <option value="">{f.anyLabel ?? 'Any'}</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={f.name}
                className="el-input"
                type={f.type ?? 'text'}
                defaultValue={f.value ?? ''}
              />
            )}
          </div>
        );
      })}
      <button type="submit" className="el-button el-button-secondary">
        {submitLabel}
      </button>
      {resetHref ? <a href={resetHref}>Clear filters</a> : null}
    </form>
  );
}

/** "Showing 26–50 of 112" with previous/next links that keep the other query values. */
export function Pager({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}): ReactNode {
  if (total === 0) return null;
  const last = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v);
    q.set('page', String(p));
    return `${basePath}?${q.toString()}`;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="el-inline-form" aria-label="Pages">
      <span>
        Showing {from}–{to} of {total}
      </span>
      {page > 1 ? <a href={href(page - 1)}>Previous page</a> : null}
      {page < last ? <a href={href(page + 1)}>Next page</a> : null}
    </nav>
  );
}

export const options = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: humanise(v) }));
