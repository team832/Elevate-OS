/**
 * Small server-rendered list helpers: the search panel and the older inline GET
 * filter form (both work without JavaScript), a pager and select options.
 */
import type { ReactNode } from 'react';
import { Icon } from '@elevate/shared-ui';
import { fmtDate, humanise } from './format';

export interface FilterField {
  name: string;
  label: string;
  type?: 'text' | 'select' | 'date';
  options?: readonly { value: string; label: string }[];
  value?: string;
  /** Label of the empty option for selects (default "Any"). */
  anyLabel?: string;
}

/** One filter control (label + input/select) for a GET form. */
function FilterInput({ field: f }: { field: FilterField }) {
  const id = `filter-${f.name}`;
  return (
    <div className="el-field">
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
}

const Hidden = ({ values }: { values: Record<string, string> }) =>
  Object.entries(values).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

/** GET form: submitting reloads the page with the filters in the query string. */
export function FilterForm({
  action,
  fields,
  submitLabel,
  resetHref,
  hidden = {},
}: {
  action: string;
  fields: readonly FilterField[];
  submitLabel: string;
  resetHref?: string;
  /** Values kept on submit (e.g. the selected tab). */
  hidden?: Record<string, string>;
}) {
  return (
    <form method="get" action={action} className="el-inline-form" role="search">
      <Hidden values={hidden} />
      {fields.map((f) => (
        <FilterInput key={f.name} field={f} />
      ))}
      <button type="submit" className="el-button el-button-secondary">
        {submitLabel}
      </button>
      {resetHref ? <a href={resetHref}>Clear filters</a> : null}
    </form>
  );
}

/** What an active filter chip says: the option label for selects, the date for dates. */
function chipValue(f: FilterField): string {
  const value = f.value ?? '';
  if (f.type === 'select') return f.options?.find((o) => o.value === value)?.label ?? value;
  return f.type === 'date' ? fmtDate(value) : value;
}

/**
 * The list search section: one search box always visible, the other filters in a
 * "Filters" disclosure (a tidy grid with Apply / Clear), and the active filters as
 * chips with remove links while it is closed. A plain GET form: works without
 * JavaScript, and every state lives in the URL. Submitting drops `page`.
 */
export function SearchPanel({
  action,
  search,
  filters = [],
  hidden = {},
  submitLabel = 'Search',
  clearHref = listHref(action, hidden),
}: {
  action: string;
  /** The always-visible box (name, admission number, reference). */
  search: FilterField;
  filters?: readonly FilterField[];
  /** Values kept on submit and in chip links (e.g. the selected tab). */
  hidden?: Record<string, string>;
  submitLabel?: string;
  clearHref?: string;
}) {
  const active = filters.filter((f) => f.value);
  const current: Params = { ...hidden, [search.name]: search.value };
  for (const f of active) current[f.name] = f.value;
  const searchId = `filter-${search.name}`;
  return (
    <form method="get" action={action} className="el-card ops-search" role="search">
      <Hidden values={hidden} />
      <div className="ops-search-bar">
        <div className="el-field">
          <label htmlFor={searchId}>{search.label}</label>
          <input
            id={searchId}
            name={search.name}
            className="el-input"
            type="search"
            defaultValue={search.value ?? ''}
          />
        </div>
        <button type="submit" className="el-button el-button-primary">
          {submitLabel}
        </button>
      </div>
      {filters.length ? (
        <details className="ops-search-filters">
          <summary>Filters{active.length ? ` (${active.length} active)` : ''}</summary>
          <div className="ops-filter-grid">
            {filters.map((f) => (
              <FilterInput key={f.name} field={f} />
            ))}
          </div>
          <div className="el-form-actions">
            <a href={clearHref}>Clear all</a>
            <button type="submit" className="el-button el-button-secondary">
              Apply filters
            </button>
          </div>
        </details>
      ) : null}
      {active.length ? (
        <ul className="ops-chips" aria-label="Active filters">
          {active.map((f) => (
            <li key={f.name}>
              {f.label}: {chipValue(f)}
              <a href={listHref(action, current, { [f.name]: undefined })}>
                <Icon name="close" size={14} />
                <span className="el-visually-hidden">Remove filter {f.label}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

type Params = Record<string, string | undefined>;

/** A list URL keeping the current params; `patch` values of undefined remove a key. */
export function listHref(basePath: string, params: Params, patch: Params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) q.set(k, v);
  return q.size ? `${basePath}?${q}` : basePath;
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
  params: Params;
  page: number;
  pageSize: number;
  total: number;
}): ReactNode {
  if (total === 0) return null;
  const last = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => listHref(basePath, params, { page: String(p) });
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
