/** Case list + "open a case" form + job buttons, for /ops/hr/onboarding and /ops/hr/offboarding. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { scopeFor } from '@elevate/authorization';
import { Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import {
  LIFECYCLE_STATUS_LABELS,
  LIFECYCLE_STATUSES,
  SEPARATION_TYPES,
  type LifecycleKind,
} from '../../../../domain/hr/lifecycle';
import { lifecycleCandidates, listCases } from '../../../../server/hr/onboarding';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../../ui/format';
import { load, Section } from '../../../../ui/frame';
import {
  ListControls,
  listParams,
  Pager,
  type SearchParams,
} from '../../recruitment/_components/lifecycle-ui';

export async function CaseList({
  user,
  kind,
  sp,
}: {
  user: AuthenticatedUser;
  kind: LifecycleKind;
  sp: SearchParams;
}) {
  const base = `/ops/hr/${kind}`;
  const status = LIFECYCLE_STATUSES.find((s) => s === sp.status);
  const sort = (['code', 'updated', 'employee'] as const).find((s) => s === sp.sort) ?? 'updated';
  const r = await load((db) =>
    listCases(db, user, { ...listParams(sp), q: sp.q, kind, status, sort }),
  );
  if (!r.ok) return r.view;
  const labels = LIFECYCLE_STATUS_LABELS[kind];
  const manager = scopeFor(user, 'ops:lifecycle:manage') === 'all';
  const approverAll = scopeFor(user, 'ops:lifecycle:approve') === 'all';
  return (
    <div className="el-stack">
      <ListControls
        action={base}
        params={sp}
        searchLabel="Employee, EMP or HRC code"
        filter={{
          name: 'status',
          label: 'Status',
          options: LIFECYCLE_STATUSES.filter((s) => kind === 'offboarding' || s !== 'approved').map(
            (s) => ({ value: s, label: labels[s] }),
          ),
        }}
        sorts={[
          { value: 'updated', label: 'Last change' },
          { value: 'code', label: 'Case code' },
          { value: 'employee', label: 'Employee name' },
        ]}
      />
      <DataTable
        caption={kind === 'onboarding' ? 'Onboarding cases' : 'Offboarding cases'}
        rows={r.data.rows}
        rowKey={(c) => c.id}
        empty={
          <EmptyState
            title={sp.q || status ? 'No cases match' : `No ${kind} cases yet`}
            description={
              kind === 'onboarding'
                ? 'Cases open when a candidate is converted to an employee, or by hand below.'
                : manager
                  ? 'Start one below when an employee resigns or a contract ends.'
                  : undefined
            }
          />
        }
        columns={[
          { key: 'code', header: 'Case', render: (c) => <a href={`${base}/${c.id}`}>{c.code}</a> },
          {
            key: 'fullName',
            header: 'Employee',
            render: (c) => `${c.fullName} (${c.employeeCode})`,
          },
          {
            key: 'status',
            header: 'Status',
            render: (c) => (
              <StatusBadge tone={statusTone(c.status)}>{labels[c.status]}</StatusBadge>
            ),
          },
          {
            key: 'progress',
            header: 'Required items done',
            render: (c) => `${c.requiredDone} of ${c.requiredTotal}`,
          },
          {
            key: 'overdue',
            header: 'Overdue',
            render: (c) =>
              c.overdue ? <StatusBadge tone="danger">{c.overdue} overdue</StatusBadge> : 'None',
          },
          ...(kind === 'offboarding'
            ? [
                {
                  key: 'lastWorkingDay',
                  header: 'Last working day',
                  render: (c: (typeof r.data.rows)[number]) => fmtDate(c.lastWorkingDay),
                },
              ]
            : []),
          { key: 'updatedAt', header: 'Last change', render: (c) => fmtDateTime(c.updatedAt) },
        ]}
      />
      <Pager
        base={base}
        params={sp}
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        noun="cases"
      />
      <div className="el-grid">
        {manager ? (
          <Section label="Loading employees…">
            <OpenCase user={user} kind={kind} />
          </Section>
        ) : null}
        {approverAll ? (
          <Card
            title="Run by hand"
            description="There is no scheduler yet. Both jobs are safe to run more than once."
          >
            {kind === 'onboarding' ? (
              <ActionForm
                action="/ops/api/v1/hr/lifecycle-cases/jobs"
                extra={{ job: 'lifecycle-reminders' }}
                submitLabel="Send overdue checklist reminders"
                variant="secondary"
              />
            ) : (
              <ActionForm
                action="/ops/api/v1/hr/lifecycle-cases/jobs"
                extra={{ job: 'separations' }}
                submitLabel="Apply due separations"
                variant="secondary"
              />
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

async function OpenCase({ user, kind }: { user: AuthenticatedUser; kind: LifecycleKind }) {
  const r = await load((db) => lifecycleCandidates(db, user, kind));
  if (!r.ok) return r.view;
  if (r.data.length === 0)
    return (
      <Card title={kind === 'onboarding' ? 'Start onboarding' : 'Start offboarding'}>
        <EmptyState
          title="No employees to choose from"
          description="Employee records are created in HR records or by converting a candidate."
        />
      </Card>
    );
  if (kind === 'onboarding')
    return (
      <Card
        title="Start onboarding for an existing employee"
        description="The checklist comes from the default onboarding template (a proposal until the owner approves it)."
      >
        <ActionForm
          action="/ops/api/v1/hr/lifecycle-cases"
          submitLabel="Open onboarding case"
          redirectTo="/ops/hr/onboarding/{id}"
          extra={{ kind: 'onboarding' }}
          fields={[
            { name: 'staffId', label: 'Employee', type: 'select', required: true, options: r.data },
          ]}
        />
      </Card>
    );
  return (
    <Card
      title="Start offboarding"
      description="Generates the checklist: a return item for each assigned asset, a hand-over item for each open task, lead, admission and responsibility, login revocation and the final settlement reference."
    >
      <ActionForm
        action="/ops/api/v1/hr/lifecycle-cases"
        submitLabel="Open offboarding case"
        redirectTo="/ops/hr/offboarding/{id}"
        extra={{ kind: 'offboarding' }}
        fields={[
          { name: 'staffId', label: 'Employee', type: 'select', required: true, options: r.data },
          {
            name: 'separationType',
            label: 'Separation type',
            type: 'select',
            required: true,
            options: SEPARATION_TYPES.map((s) => ({ value: s, label: humanise(s) })),
          },
          { name: 'noticeDate', label: 'Notice given on', type: 'date' },
          { name: 'lastWorkingDay', label: 'Last working day', type: 'date', required: true },
          { name: 'reason', label: 'Reason (seen only by HR and approvers)', type: 'textarea' },
        ]}
      />
    </Card>
  );
}
