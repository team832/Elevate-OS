/**
 * Lifecycle case detail (onboarding and offboarding share it): employee,
 * separation record, checklist with per-item actions, gaps, approval,
 * cancellation and history.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  ITEM_STATUSES,
  LIFECYCLE_STATUS_LABELS,
  type ItemStatus,
} from '../../../../domain/hr/lifecycle';
import { formOptions } from '../../../../server/options';
import { getLifecycleCase } from '../../../../server/hr/offboarding';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../../ui/format';
import { load, Section } from '../../../../ui/frame';
import { HistoryPanel, REASON_FIELD } from '../../recruitment/_components/lifecycle-ui';

const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: 'To do',
  done: 'Done',
  not_applicable: 'Not applicable',
  blocked: 'Blocked',
};

const SYSTEM_NOTE: Record<string, string> = {
  asset_return: 'Completes when the return is recorded in the asset register.',
  access_revocation: 'Completes when the platform has disabled the login after separation.',
};

type Data = Awaited<ReturnType<typeof getLifecycleCase>>;

export async function CaseDetail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getLifecycleCase(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const c = d.case;
  const labels = LIFECYCLE_STATUS_LABELS[c.kind];
  return (
    <div className="el-stack">
      <PageHeader
        title={`${c.code} — ${c.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}: ${d.employee.fullName}`}
        description={`${d.employee.employeeCode} · employment status ${humanise(d.employee.employmentStatus)} · manager ${d.employee.managerName ?? 'not set'}`}
      />
      <p>
        <StatusBadge tone={statusTone(c.status === 'completed' ? 'completed' : c.status)}>
          {labels[c.status]}
        </StatusBadge>{' '}
        Opened by {c.openedByName ?? 'unknown'} on {fmtDateTime(c.createdAt)}
        {c.approvedByName
          ? ` · approved by ${c.approvedByName} on ${fmtDateTime(c.approvedAt)}`
          : ''}
        {c.statusReason ? ` · ${c.statusReason}` : ''}
      </p>
      {c.applicationId ? (
        <p>
          Opened from{' '}
          <a href={`/ops/hr/recruitment/applications/${c.applicationId}`}>
            the candidate’s application
          </a>
          .
        </p>
      ) : null}
      {c.kind === 'offboarding' ? <Separation d={d} /> : null}
      {d.gaps.length && (c.status === 'open' || c.status === 'approved') ? (
        <Alert tone="warning" title={`${d.gaps.length} required item(s) still open`}>
          {d.gaps.join('; ')}
        </Alert>
      ) : null}
      <Card
        title="Checklist"
        description="Evidence is a reference (document number, ticket, register entry). No files and no passwords are stored here."
      >
        <DataTable
          rows={d.items}
          rowKey={(i) => i.id}
          empty={<EmptyState title="No checklist items" />}
          columns={[
            {
              key: 'title',
              header: 'Item',
              render: (i) => (
                <>
                  {i.title}
                  {i.required ? '' : ' (optional)'}
                </>
              ),
            },
            { key: 'kindLabel', header: 'Type' },
            {
              key: 'assigneeName',
              header: 'Assigned to',
              render: (i) => i.assigneeName ?? (i.systemCompleted ? 'System' : 'Unassigned'),
            },
            {
              key: 'dueDate',
              header: 'Due',
              render: (i) => (
                <>
                  {i.dueDate ? fmtDate(i.dueDate) : 'No date'}
                  {i.overdue ? (
                    <>
                      {' '}
                      <StatusBadge tone="danger">Overdue</StatusBadge>
                    </>
                  ) : null}
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (i) => (
                <StatusBadge tone={statusTone(i.status === 'pending' ? 'open' : i.status)}>
                  {ITEM_STATUS_LABELS[i.status]}
                </StatusBadge>
              ),
            },
            {
              key: 'evidence',
              header: 'Evidence / notes',
              render: (i) => (
                <>
                  {i.evidence ?? ''}
                  {i.notes ? <p className="el-field-hint">{i.notes}</p> : null}
                  {i.completedByName ? (
                    <p className="el-field-hint">
                      {i.completedByName}, {fmtDateTime(i.completedAt)}
                    </p>
                  ) : null}
                  {i.transferTargetName ? (
                    <p className="el-field-hint">Handed to {i.transferTargetName}</p>
                  ) : null}
                </>
              ),
            },
          ]}
        />
      </Card>
      {d.canManage ? (
        <Section label="Loading checklist actions…">
          <ItemActions d={d} />
        </Section>
      ) : null}
      <Approval d={d} />
      {d.canManage && c.status === 'open' ? (
        <Card title={`Cancel this ${c.kind} case`}>
          <ActionForm
            action={`/ops/api/v1/hr/lifecycle-cases/${c.id}/cancel`}
            submitLabel={`Cancel ${c.kind}`}
            variant="danger"
            fields={[REASON_FIELD]}
          />
        </Card>
      ) : null}
      {d.canRetract ? (
        <Card
          title="Retract the approved separation"
          description="Only before the separation is applied. The employee goes back to active."
        >
          <ActionForm
            action={`/ops/api/v1/hr/lifecycle-cases/${c.id}/cancel`}
            submitLabel="Retract separation"
            variant="danger"
            fields={[REASON_FIELD]}
          />
        </Card>
      ) : null}
      <HistoryPanel rows={d.history} />
    </div>
  );
}

function Separation({ d }: { d: Data }) {
  const c = d.case;
  return (
    <Card title="Separation record">
      <dl className="el-stack">
        <div>
          <dt>Type</dt>
          <dd>{humanise(c.separationType)}</dd>
        </div>
        <div>
          <dt>Notice given · last working day</dt>
          <dd>
            {c.noticeDate ? fmtDate(c.noticeDate) : 'Not recorded'} · {fmtDate(c.lastWorkingDay)}
          </dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>
            {c.separationReason ??
              (c.reasonHidden ? 'Restricted to HR and lifecycle approvers.' : 'Not recorded')}
          </dd>
        </div>
        {c.settlementReference ? (
          <div>
            <dt>Final settlement reference</dt>
            <dd>{c.settlementReference}</dd>
          </div>
        ) : null}
        <div>
          <dt>Separated</dt>
          <dd>
            {c.separatedAt
              ? fmtDateTime(c.separatedAt)
              : 'Not yet: applied the day after the last working day once approved.'}
          </dd>
        </div>
        {d.accessRevocation ? (
          <div>
            <dt>Login revocation (platform)</dt>
            <dd>
              {d.employee.hasLogin
                ? d.accessRevocation.delivery
                  ? `${humanise(d.accessRevocation.delivery.status)} after ${d.accessRevocation.delivery.attempts} attempt(s)${d.accessRevocation.delivery.lastError ? `: ${d.accessRevocation.delivery.lastError}` : ''}`
                  : 'Waiting for the platform to process the separation.'
                : 'No login was linked.'}
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}

async function ItemActions({ d }: { d: Data }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  const caseId = d.case.id;
  const open = d.items.filter((i) => i.status !== 'done');
  return (
    <div className="el-stack">
      <Card
        title="Work the checklist"
        description="Not applicable and blocked need a note. The final settlement item needs its reference."
      >
        {open.length === 0 ? <EmptyState title="Every item is done" /> : null}
        {open.map((i) => (
          <div key={i.id} className="el-stack">
            <h3>{i.title}</h3>
            {i.systemCompleted ? <p className="el-field-hint">{SYSTEM_NOTE[i.kind]}</p> : null}
            {i.kind === 'ownership_transfer' ? (
              <ActionForm
                action={`/ops/api/v1/hr/lifecycle-cases/${caseId}/items/${i.id}/transfer`}
                submitLabel={`Hand over this ${i.transferEntityType ?? 'record'}`}
                compact
                fields={[
                  {
                    name: 'targetStaffId',
                    label: 'New owner',
                    type: 'select',
                    required: true,
                    options: r.data.staff.filter((s) => s.value !== d.employee.staffId),
                  },
                ]}
              />
            ) : null}
            <ActionForm
              action={`/ops/api/v1/hr/lifecycle-cases/${caseId}/items/${i.id}`}
              method="PATCH"
              submitLabel="Update item"
              variant="secondary"
              compact
              fields={[
                {
                  name: 'status',
                  label: 'Status',
                  type: 'select',
                  options: ITEM_STATUSES.filter(
                    (s) =>
                      s !== i.status &&
                      !(s === 'done' && (i.systemCompleted || i.kind === 'ownership_transfer')),
                  ).map((s) => ({ value: s, label: ITEM_STATUS_LABELS[s] })),
                },
                { name: 'evidence', label: 'Evidence reference', defaultValue: i.evidence ?? '' },
                { name: 'notes', label: 'Note' },
                {
                  name: 'assigneeStaffId',
                  label: 'Assign to',
                  type: 'select',
                  options: r.data.staff,
                },
                { name: 'dueDate', label: 'Due date', type: 'date', defaultValue: i.dueDate ?? '' },
              ]}
            />
          </div>
        ))}
      </Card>
      <div className="el-grid">
        <Card title="Add an item">
          <ActionForm
            action={`/ops/api/v1/hr/lifecycle-cases/${caseId}/items`}
            submitLabel="Add checklist item"
            variant="secondary"
            fields={[
              { name: 'title', label: 'What needs doing', required: true },
              { name: 'required', label: 'Required before approval', type: 'checkbox' },
              {
                name: 'assigneeStaffId',
                label: 'Assign to',
                type: 'select',
                options: r.data.staff,
              },
              { name: 'dueDate', label: 'Due date', type: 'date' },
            ]}
          />
        </Card>
        {d.case.kind === 'offboarding' ? (
          <Card
            title="Pick up new assets and work"
            description="Adds items for assets assigned or records taken on since the case was opened."
          >
            <ActionForm
              action={`/ops/api/v1/hr/lifecycle-cases/${caseId}/refresh`}
              submitLabel="Refresh offboarding checklist"
              variant="secondary"
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Approval({ d }: { d: Data }) {
  const c = d.case;
  if (c.status !== 'open') return null;
  const what = c.kind === 'onboarding' ? 'onboarding is complete' : 'separation';
  if (!d.canApprove)
    return (
      <Card title="Final approval">
        <p>
          {d.isSelf
            ? 'This is your own case: another lifecycle approver must give the final approval.'
            : 'The final approval is given by an HR manager, the director or the operations manager.'}
        </p>
      </Card>
    );
  return (
    <Card
      title="Final approval"
      description={
        c.kind === 'onboarding'
          ? 'Needs every required item done or not applicable. The employee becomes active.'
          : 'Needs every required item resolved except the login revocation. The employee is on notice until the last working day and separated the day after; the platform then disables their login.'
      }
    >
      {d.gaps.length ? (
        <p>Approval is available once the required items above are resolved.</p>
      ) : (
        <ActionForm
          action={`/ops/api/v1/hr/lifecycle-cases/${c.id}/approve`}
          submitLabel={c.kind === 'onboarding' ? 'Approve onboarding' : 'Approve separation'}
          fields={[
            { name: 'confirm', label: `I confirm the ${what} as recorded here`, type: 'checkbox' },
            { name: 'comment', label: 'Comment' },
          ]}
        />
      )}
    </Card>
  );
}
