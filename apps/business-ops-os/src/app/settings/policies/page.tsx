import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { POLICY_AREAS, POLICY_STATUS_LABELS, POLICY_STATUSES, SETTING_KEYS } from '../../../domain';
import { formOptions } from '../../../server/options';
import { listPolicies } from '../../../server/policies-register';
import { policyListQuery } from '../../../server/work-schemas';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtDate, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

const EMPTY =
  'No company policies recorded yet. Add the policies Elevate has approved; nothing here is legal advice.';

type Query = {
  area?: (typeof POLICY_AREAS)[number];
  status?: (typeof POLICY_STATUSES)[number];
  review?: 'overdue' | 'due_soon';
};

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:settings:read', '/ops/settings/policies');
  const sp = await searchParams;
  const parsed = policyListQuery.safeParse({
    area: sp.area || undefined,
    status: sp.status || undefined,
    review: sp.review || undefined,
  });
  const query: Query = parsed.success ? parsed.data : {};
  return (
    <Frame access={access} active="policies">
      <PageHeader
        title="Policies & compliance register"
        description="The policies and compliance obligations Elevate records for itself, as written by its staff, with their source, accountable person, dates and approval. Elevate OS does not research or supply policy text."
      />
      <nav className="el-subnav" aria-label="Settings sections">
        <a href="/ops/settings">Configurable settings</a>
        <a href="/ops/settings/policies" aria-current="page">
          Policies &amp; compliance register
        </a>
      </nav>
      {!parsed.success ? (
        <p className="el-field-error" role="alert">
          Some filters were not valid and were ignored.
        </p>
      ) : null}
      <Section>
        <Register user={access.user} query={query} />
      </Section>
      {can(access.user, 'ops:settings:manage') ? (
        <Section label="Loading form…">
          <NewPolicy />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Register({ user, query }: { user: AuthenticatedUser; query: Query }) {
  const r = await load((db) => listPolicies(db, user, query));
  if (!r.ok) return r.view;
  const filtered = Boolean(query.area || query.status || query.review);
  return (
    <div className="el-stack">
      <form
        method="get"
        action="/ops/settings/policies"
        className="el-inline-form"
        aria-label="Filter policies"
      >
        <div className="el-field">
          <label htmlFor="pf-area">Area</label>
          <select id="pf-area" name="area" className="el-select" defaultValue={query.area ?? ''}>
            <option value="">All areas</option>
            {POLICY_AREAS.map((a) => (
              <option key={a} value={a}>
                {humanise(a)}
              </option>
            ))}
          </select>
        </div>
        <div className="el-field">
          <label htmlFor="pf-status">Status</label>
          <select
            id="pf-status"
            name="status"
            className="el-select"
            defaultValue={query.status ?? ''}
          >
            <option value="">Any status</option>
            {POLICY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {POLICY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="el-field">
          <label htmlFor="pf-review">Review</label>
          <select
            id="pf-review"
            name="review"
            className="el-select"
            defaultValue={query.review ?? ''}
          >
            <option value="">Any</option>
            <option value="overdue">Review overdue</option>
            <option value="due_soon">Review due soon</option>
          </select>
        </div>
        <button type="submit" className="el-button el-button-secondary">
          Apply filters
        </button>
        {filtered ? <a href="/ops/settings/policies">Clear filters</a> : null}
      </form>
      <DataTable
        caption={`${r.data.length} entr${r.data.length === 1 ? 'y' : 'ies'}`}
        rows={r.data}
        rowKey={(p) => p.id}
        empty={<EmptyState title={filtered ? 'No entries match these filters' : EMPTY} />}
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (p) => <a href={`/ops/settings/policies/${p.id}`}>{p.code}</a>,
          },
          { key: 'title', header: 'Title' },
          { key: 'area', header: 'Area', render: (p) => humanise(p.area) },
          {
            key: 'status',
            header: 'Status',
            render: (p) => (
              <StatusBadge tone={decisionTone(p.status)}>
                {POLICY_STATUS_LABELS[p.status as (typeof POLICY_STATUSES)[number]]}
              </StatusBadge>
            ),
          },
          {
            key: 'accountableName',
            header: 'Accountable',
            render: (p) => p.accountableName ?? '—',
          },
          { key: 'effectiveDate', header: 'Effective', render: (p) => fmtDate(p.effectiveDate) },
          {
            key: 'nextReviewDate',
            header: 'Next review',
            render: (p) => (
              <>
                {fmtDate(p.nextReviewDate)}{' '}
                {p.reviewFlag === 'overdue' ? (
                  <StatusBadge tone="danger">Review overdue</StatusBadge>
                ) : p.reviewFlag === 'due_soon' ? (
                  <StatusBadge tone="warning">Review due soon</StatusBadge>
                ) : null}
              </>
            ),
          },
          {
            key: 'version',
            header: 'Latest version',
            render: (p) =>
              p.currentVersion ? `v${p.currentVersion.number} (${p.currentVersion.status})` : '—',
          },
        ]}
      />
    </div>
  );
}

async function NewPolicy() {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Record a policy or obligation"
      description="Write the requirement as Elevate states it and say where it comes from. It starts as a draft; another person approves it."
    >
      <ActionForm
        action="/ops/api/v1/settings/policies"
        submitLabel="Save as draft"
        redirectTo="/ops/settings/policies/{id}"
        fields={[
          { name: 'title', label: 'Title', required: true },
          {
            name: 'area',
            label: 'Area',
            type: 'select',
            required: true,
            options: POLICY_AREAS.map((a) => ({ value: a, label: humanise(a) })),
          },
          { name: 'summary', label: 'Summary', type: 'textarea' },
          {
            name: 'requirementText',
            label: 'Requirement (as written by Elevate)',
            type: 'textarea',
          },
          {
            name: 'sourceReference',
            label: 'Source reference',
            hint: 'e.g. "Company handbook v2, section 4" or "Advice from our CA, 12 Nov 2026"',
          },
          {
            name: 'accountableStaffId',
            label: 'Accountable staff member',
            type: 'select',
            options: r.data.staff,
          },
          { name: 'ownerDecisionRef', label: 'Owner decision (optional)', hint: 'e.g. OD-026' },
          {
            name: 'linkedSettingKeys',
            label: 'Linked setting keys (comma separated)',
            type: 'list',
            hint: `Known keys: ${SETTING_KEYS.join(', ')}`,
          },
          { name: 'effectiveDate', label: 'Effective date', type: 'date' },
          { name: 'nextReviewDate', label: 'Next review date', type: 'date' },
        ]}
      />
    </Card>
  );
}
