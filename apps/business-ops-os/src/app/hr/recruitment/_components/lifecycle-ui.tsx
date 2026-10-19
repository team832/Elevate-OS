/**
 * Screen helpers shared by the recruitment, onboarding and offboarding pages:
 * list controls (search / filter / sort as a plain GET form), a pager that
 * only renders links that lead somewhere, and the history panel. Built only
 * from shared-ui components and the existing `el-*` classes.
 */
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { fmtDateTime, humanise } from '../../../../ui/format';

export type SearchParams = Record<string, string | undefined>;

export function hrefWith(base: string, params: SearchParams, patch: SearchParams): string {
  const merged = { ...params, ...patch };
  const qs = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

export function ListControls({
  action,
  params,
  searchLabel,
  filter,
  sorts,
  keep = [],
}: {
  action: string;
  params: SearchParams;
  searchLabel: string;
  filter?: { name: string; label: string; options: readonly { value: string; label: string }[] };
  sorts: readonly { value: string; label: string }[];
  /** Params carried over unchanged (e.g. the active tab). */
  keep?: readonly string[];
}) {
  const id = action.replace(/\W+/g, '-');
  return (
    <form method="get" action={action} className="el-inline-form" aria-label="Search and filter">
      {keep.map((k) =>
        params[k] ? <input key={k} type="hidden" name={k} defaultValue={params[k]} /> : null,
      )}
      <div className="el-field">
        <label htmlFor={`${id}-q`}>{searchLabel}</label>
        <input id={`${id}-q`} name="q" className="el-input" defaultValue={params.q ?? ''} />
      </div>
      {filter ? (
        <div className="el-field">
          <label htmlFor={`${id}-${filter.name}`}>{filter.label}</label>
          <select
            id={`${id}-${filter.name}`}
            name={filter.name}
            className="el-select"
            defaultValue={params[filter.name] ?? ''}
          >
            <option value="">All</option>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="el-field">
        <label htmlFor={`${id}-sort`}>Sort by</label>
        <select
          id={`${id}-sort`}
          name="sort"
          className="el-select"
          defaultValue={params.sort ?? ''}
        >
          {sorts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="el-field">
        <label htmlFor={`${id}-dir`}>Order</label>
        <select
          id={`${id}-dir`}
          name="dir"
          className="el-select"
          defaultValue={params.dir ?? 'desc'}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
      <button type="submit" className="el-button el-button-secondary">
        Apply
      </button>
    </form>
  );
}

export function Pager({
  base,
  params,
  page,
  pageSize,
  total,
  noun,
}: {
  base: string;
  params: SearchParams;
  page: number;
  pageSize: number;
  total: number;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <nav className="el-inline-form" aria-label={`${noun} pages`}>
      <span>
        {total} {noun} · page {page} of {pages}
      </span>
      {page > 1 ? (
        <a href={hrefWith(base, params, { page: String(page - 1) })}>Previous page</a>
      ) : null}
      {page < pages ? (
        <a href={hrefWith(base, params, { page: String(page + 1) })}>Next page</a>
      ) : null}
    </nav>
  );
}

/** Parse ?page= safely for the services (they validate again). */
export function listParams(sp: SearchParams) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  return { page, pageSize: 25, dir: sp.dir === 'asc' ? ('asc' as const) : ('desc' as const) };
}

export function HistoryPanel({
  rows,
}: {
  rows: readonly { at: Date | string; action: string; actorName: string }[];
}) {
  return (
    <Card
      title="History"
      description="Who changed what, from the audit log. Details stay in the log."
    >
      <DataTable
        rows={rows}
        rowKey={(r) => `${String(r.at)}-${r.action}`}
        empty={<EmptyState title="No changes recorded yet" />}
        columns={[
          { key: 'at', header: 'When', render: (r) => fmtDateTime(r.at) },
          {
            key: 'action',
            header: 'Change',
            render: (r) => humanise(r.action.replace(/[._]/g, ' ')),
          },
          { key: 'actorName', header: 'By' },
        ]}
      />
    </Card>
  );
}
