/**
 * Screen helpers shared by the recruitment, onboarding and offboarding pages:
 * list controls (search / filter / sort as a plain GET form), a pager that
 * only renders links that lead somewhere, the history panel and the detail
 * page frame. Built only from shared-ui components and the existing `el-*` classes.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import type { Permission } from '@elevate/authorization';
import { Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { APPLICATION_STAGE_LABELS, type ApplicationStage } from '../../../../domain/hr/recruitment';
import { fmtDateTime, humanise, statusTone } from '../../../../ui/format';
import { Frame, gate, Section } from '../../../../ui/frame';

export type SearchParams = Record<string, string | undefined>;

/** The required "Reason" field of a transition form. */
export const REASON_FIELD = { name: 'reason', label: 'Reason', required: true } as const;

/** A `[id]` page: gate on `permission`, a back link, then `Detail` for the id. */
export function detailPage(
  permission: Permission,
  active: string,
  base: string,
  back: { href: string; label: string },
  Detail: (props: { user: AuthenticatedUser; id: string }) => Promise<ReactNode>,
) {
  return async function DetailRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await gate(permission, `${base}/${id}`);
    return (
      <Frame access={access} active={active}>
        <p>
          <a href={back.href}>{back.label}</a>
        </p>
        <Section>
          <Detail user={access.user} id={id} />
        </Section>
      </Frame>
    );
  };
}

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

/** Applications of a requisition or a candidate: a link to each, its stage and since when. */
export function ApplicationsTable<
  T extends { id: string; stage: ApplicationStage; stageChangedAt: Date | string },
>({
  rows,
  link,
  empty,
}: {
  rows: readonly T[];
  /** First column: key, header and link text. */
  link: { key: string; header: string; text: (a: T) => string };
  empty: ReactNode;
}) {
  return (
    <DataTable
      rows={rows}
      rowKey={(a) => a.id}
      empty={empty}
      columns={[
        {
          key: link.key,
          header: link.header,
          render: (a) => <a href={`/ops/hr/recruitment/applications/${a.id}`}>{link.text(a)}</a>,
        },
        {
          key: 'stage',
          header: 'Stage',
          render: (a) => (
            <StatusBadge tone={statusTone(a.stage)}>
              {APPLICATION_STAGE_LABELS[a.stage]}
            </StatusBadge>
          ),
        },
        { key: 'stageChangedAt', header: 'Since', render: (a) => fmtDateTime(a.stageChangedAt) },
      ]}
    />
  );
}
