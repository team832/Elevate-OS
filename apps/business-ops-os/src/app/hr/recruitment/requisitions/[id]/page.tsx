import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  APPLICATION_STAGE_LABELS,
  REQUISITION_EMPLOYMENT_TYPES,
  REQUISITION_STATUS_LABELS,
  type ApplicationStage,
  type RequisitionStatus,
} from '../../../../../domain/hr/recruitment';
import { formOptions } from '../../../../../server/options';
import { getRequisition, listCandidates } from '../../../../../server/hr/recruitment';
import { ActionForm } from '../../../../../ui/action-form';
import { fmtDateTime, humanise, statusTone } from '../../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../../ui/frame';
import { HistoryPanel } from '../../_components/lifecycle-ui';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<RequisitionStatus, string> = {
  draft: '',
  open: 'Approve and open',
  on_hold: 'Put on hold',
  filled: 'Mark as filled',
  cancelled: 'Cancel requisition',
};
const NEEDS_REASON: RequisitionStatus[] = ['on_hold', 'cancelled'];

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:recruitment:read', `/ops/hr/recruitment/requisitions/${id}`);
  return (
    <Frame access={access} active="recruitment">
      <p>
        <a href="/ops/hr/recruitment">Back to recruitment</a>
      </p>
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getRequisition(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const req = d.requisition;
  const status = req.status as RequisitionStatus;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${req.code} — ${req.title}`}
        description={req.roleDescription ?? undefined}
      />
      <p>
        <StatusBadge tone={statusTone(status)}>{REQUISITION_STATUS_LABELS[status]}</StatusBadge>{' '}
        {req.statusReason ? `Reason: ${req.statusReason}` : null}
      </p>
      <Card title="Details">
        <dl className="el-stack">
          <div>
            <dt>Department</dt>
            <dd>{d.departmentName ?? 'Not set'}</dd>
          </div>
          <div>
            <dt>Employment type · openings · location</dt>
            <dd>
              {humanise(req.employmentType)} · {req.openings} · {req.location ?? 'Location not set'}
            </dd>
          </div>
          <div>
            <dt>Recruiter · hiring manager</dt>
            <dd>
              {d.recruiterName ?? 'No recruiter'} · {d.hiringManagerName ?? 'No hiring manager'}
            </dd>
          </div>
          <div>
            <dt>Requested by · approved by</dt>
            <dd>
              {d.requestedByName ?? 'Unknown'} ·{' '}
              {d.approvedByName
                ? `${d.approvedByName}, ${fmtDateTime(req.approvedAt)}`
                : 'Not approved yet'}
            </dd>
          </div>
        </dl>
      </Card>
      {status === 'draft' && d.isRequester && d.canDecide ? (
        <Alert tone="info" title="Waiting for another approver">
          You requested this requisition, so a different recruitment decider must approve it.
        </Alert>
      ) : null}
      {d.allowedTargets.length ? (
        <Card title="Change status">
          <div className="el-grid">
            {d.allowedTargets.map((to) => (
              <ActionForm
                key={to}
                action={`/ops/api/v1/hr/requisitions/${req.id}/transitions`}
                submitLabel={
                  status === 'on_hold' && to === 'open' ? 'Resume hiring' : ACTION_LABELS[to]
                }
                extra={{ to }}
                variant={to === 'cancelled' ? 'danger' : to === 'open' ? 'primary' : 'secondary'}
                fields={
                  NEEDS_REASON.includes(to) || (status === 'on_hold' && to === 'open')
                    ? [{ name: 'reason', label: 'Reason', required: true }]
                    : []
                }
              />
            ))}
          </div>
        </Card>
      ) : null}
      <Card title="Applications">
        <DataTable
          rows={d.applications}
          rowKey={(a) => a.id}
          empty={
            <EmptyState
              title="No applications yet"
              description={
                status === 'open'
                  ? 'Add one below.'
                  : 'Applications can be added while the requisition is open.'
              }
            />
          }
          columns={[
            {
              key: 'candidateCode',
              header: 'Candidate',
              render: (a) => (
                <a href={`/ops/hr/recruitment/applications/${a.id}`}>
                  {a.candidateCode} {a.candidateName}
                </a>
              ),
            },
            {
              key: 'stage',
              header: 'Stage',
              render: (a) => (
                <StatusBadge tone={statusTone(a.stage)}>
                  {APPLICATION_STAGE_LABELS[a.stage as ApplicationStage]}
                </StatusBadge>
              ),
            },
            {
              key: 'stageChangedAt',
              header: 'Since',
              render: (a) => fmtDateTime(a.stageChangedAt),
            },
          ]}
        />
      </Card>
      {d.canManage && status === 'open' ? (
        <Section label="Loading candidates…">
          <AddApplication user={user} requisitionId={req.id} />
        </Section>
      ) : null}
      {d.canManage && status !== 'filled' && status !== 'cancelled' ? (
        <Section label="Loading form…">
          <EditRequisition requisition={req} />
        </Section>
      ) : null}
      <HistoryPanel rows={d.history} />
    </div>
  );
}

async function AddApplication({
  user,
  requisitionId,
}: {
  user: AuthenticatedUser;
  requisitionId: string;
}) {
  const r = await load((db) =>
    listCandidates(db, user, {
      page: 1,
      pageSize: 100,
      dir: 'asc',
      sort: 'name',
      status: 'active',
    }),
  );
  if (!r.ok) return r.view;
  if (r.data.rows.length === 0)
    return (
      <Card title="Add an application">
        <EmptyState
          title="No active candidates to add"
          description="Add the candidate on the Candidates tab first."
          action={<a href="/ops/hr/recruitment?tab=candidates">Go to candidates</a>}
        />
      </Card>
    );
  return (
    <Card
      title="Add an application"
      description="Shows the first 100 active candidates you can work with, by name."
    >
      <ActionForm
        action="/ops/api/v1/hr/applications"
        submitLabel="Add application"
        redirectTo="/ops/hr/recruitment/applications/{id}"
        extra={{ requisitionId }}
        fields={[
          {
            name: 'candidateId',
            label: 'Candidate',
            type: 'select',
            required: true,
            options: r.data.rows.map((c) => ({ value: c.id, label: `${c.fullName} (${c.code})` })),
          },
        ]}
      />
    </Card>
  );
}

async function EditRequisition({
  requisition,
}: {
  requisition: {
    id: string;
    title: string;
    openings: number;
    location: string | null;
    roleDescription: string | null;
    employmentType: string;
  };
}) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card title="Edit requisition">
      <ActionForm
        action={`/ops/api/v1/hr/requisitions/${requisition.id}`}
        method="PATCH"
        submitLabel="Save requisition"
        variant="secondary"
        fields={[
          { name: 'title', label: 'Job title', defaultValue: requisition.title },
          {
            name: 'employmentType',
            label: 'Employment type',
            type: 'select',
            defaultValue: requisition.employmentType,
            options: REQUISITION_EMPLOYMENT_TYPES.map((v) => ({ value: v, label: humanise(v) })),
          },
          {
            name: 'openings',
            label: 'Openings',
            type: 'number',
            defaultValue: String(requisition.openings),
          },
          { name: 'location', label: 'Location', defaultValue: requisition.location ?? '' },
          {
            name: 'hiringManagerStaffId',
            label: 'Hiring manager',
            type: 'select',
            options: r.data.staff,
          },
          {
            name: 'roleDescription',
            label: 'Role description',
            type: 'textarea',
            defaultValue: requisition.roleDescription ?? '',
          },
        ]}
      />
    </Card>
  );
}
