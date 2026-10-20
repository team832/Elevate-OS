import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ROLE_KEYS } from '@elevate/shared-types';
import {
  SOP_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type SopStatus,
  type TaskStatus,
} from '../../../domain';
import { formOptions } from '../../../server/options';
import { getSop, getSopHistory } from '../../../server/sops';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

const DECISION_TEXT: Record<string, string> = { approved: 'Approved', retired: 'Retired' };
const PEOPLE = [
  ['ownerStaffId', 'Owner'],
  ['reviewerStaffId', 'Reviewer'],
  ['backupStaffId', 'Backup'],
] as const;
const ROLES = ROLE_KEYS.filter((r) => r !== 'auditor').map((r) => ({
  value: r,
  label: humanise(r),
}));

export default async function SopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:sops:read', `/ops/sops/${id}`);
  return (
    <Frame access={access} active="sops">
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
      <Section label="Loading change history…">
        <History user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getSop(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const s = d.sop;
  const write = can(user, 'ops:sops:write');
  const api = `/ops/api/v1/sops/${s.id}`;
  const v = d.current;
  const flow = (action: string) => ({ action: `${api}/workflow`, extra: { action } });
  return (
    <div className="el-stack">
      <PageHeader
        title={`${s.code} — ${s.title}`}
        description={`${d.department?.name ?? 'No department'} · owner ${d.owner?.fullName ?? s.ownerRole ?? 'not named'} · reviewer ${d.reviewer?.fullName ?? 'not named'} · backup ${d.backup?.fullName ?? 'none'}`}
      />
      <p>
        <StatusBadge tone={decisionTone(d.decisionState)}>
          {DECISION_TEXT[d.decisionState] ?? 'Proposed — not policy'}
        </StatusBadge>{' '}
        {SOP_STATUS_LABELS[s.status as SopStatus]}{' '}
        <StatusBadge
          tone={
            d.publicationState === 'published'
              ? 'success'
              : d.publicationState === 'not_approved'
                ? 'info'
                : 'neutral'
          }
        >
          {d.publicationLabel}
        </StatusBadge>{' '}
        {d.reviewDue === 'overdue' ? <StatusBadge tone="danger">Review overdue</StatusBadge> : null}
        {d.reviewDue === 'due_soon' ? (
          <StatusBadge tone="warning">Review due soon</StatusBadge>
        ) : null}
      </p>
      {d.myAcknowledgement.required ? (
        d.myAcknowledgement.acknowledgedAt ? (
          <Alert tone="success" title="You have acknowledged this version">
            {fmtDateTime(d.myAcknowledgement.acknowledgedAt)}
          </Alert>
        ) : d.myAcknowledgement.canAcknowledge ? (
          <Card
            title="Your acknowledgement is required"
            description="Read the approved version, then confirm. It is recorded once per version and cannot be undone."
          >
            <ActionForm
              action={`${api}/acknowledge`}
              submitLabel="I have read this version"
              fields={[{ name: 'note', label: 'Note (optional)' }]}
            />
          </Card>
        ) : null
      ) : null}
      {s.legacySource ? (
        <Alert tone="info" title="Imported from the legacy register">
          {s.legacySource}: “{s.legacyStatus}”. {s.legacyRef}
        </Alert>
      ) : null}
      {write ? (
        <Card
          title="Owner, reviewer and backup"
          description="The reviewer must be a different person from the owner."
        >
          <ActionForm
            action={api}
            method="PATCH"
            submitLabel="Save"
            variant="secondary"
            fields={[
              ...PEOPLE.map(([name, label]) => ({
                name,
                label,
                type: 'select' as const,
                options: options.staff,
                defaultValue: s[name] ?? '',
              })),
              {
                name: 'nextReviewDate',
                label: 'Next review date',
                type: 'date',
                defaultValue: s.nextReviewDate ?? '',
              },
            ]}
          />
        </Card>
      ) : null}
      <Card
        title={v ? `Version ${v.versionLabel} (${v.status})` : 'No version yet'}
        description={v?.changeNote ?? undefined}
      >
        {v ? (
          <pre className="el-pre">{v.content || '(empty)'}</pre>
        ) : (
          <EmptyState title="Not drafted" description="Save a draft to start." />
        )}
        {v?.sourceDate ? (
          <p className="el-field-hint">
            Source document dated {fmtDate(v.sourceDate)}.{' '}
            {v.documentRef ? `Reference: ${v.documentRef}` : ''}
          </p>
        ) : null}
        {v?.reviewedAt ? (
          <p>
            Review: {v.reviewOutcome} at {fmtDateTime(v.reviewedAt)} — {v.reviewNote ?? ''}
          </p>
        ) : null}
        {d.approvalBlockersForYou.length && can(user, 'ops:sops:approve') ? (
          <Alert tone="warning" title="You cannot approve this version yet">
            {d.approvalBlockersForYou.join(' ')}
          </Alert>
        ) : null}
        <div className="el-grid">
          {write && v?.status === 'draft' ? (
            <ActionForm {...flow('submit')} submitLabel="Submit for approval" />
          ) : null}
          {d.youAreReviewer && v?.status === 'in_review' ? (
            <ActionForm
              {...flow('review')}
              submitLabel="Record review"
              fields={[
                {
                  name: 'outcome',
                  label: 'Outcome',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'recommend_approval', label: 'Recommend approval' },
                    { value: 'changes_requested', label: 'Changes requested' },
                  ],
                },
                { name: 'note', label: 'Note' },
              ]}
            />
          ) : null}
          {can(user, 'ops:sops:approve') && v?.status === 'in_review' ? (
            <>
              <ActionForm
                {...flow('approve')}
                submitLabel="Approve"
                fields={[{ name: 'comment', label: 'Comment' }]}
              />
              <ActionForm
                {...flow('reject')}
                submitLabel="Reject"
                fields={[{ name: 'comment', label: 'Reason', required: true }]}
                variant="danger"
              />
            </>
          ) : null}
          {write && v?.status === 'in_review' ? (
            <ActionForm
              {...flow('withdraw')}
              submitLabel="Withdraw (requester)"
              variant="secondary"
            />
          ) : null}
        </div>
      </Card>
      {write && s.status !== 'retired' && v?.status !== 'in_review' ? (
        <Card
          title="Edit draft"
          description="Edits the current draft, or starts a new version when the current one is approved or rejected. Old versions are never erased."
        >
          <ActionForm
            action={`${api}/draft`}
            method="PUT"
            submitLabel="Save draft"
            fields={[
              {
                name: 'content',
                label: 'Procedure',
                type: 'textarea',
                required: true,
                defaultValue: v?.status === 'draft' ? v.content : (v?.content ?? ''),
              },
              { name: 'changeNote', label: 'Change note' },
            ]}
          />
        </Card>
      ) : null}
      <Card
        title="Effective date and review"
        description="Published means approved and the effective date (IST) has been reached. Only the approved version in force gets dates."
      >
        {s.approvedVersionId ? (
          <p>
            Effective {d.schedule ? fmtDate(d.schedule.effectiveDate) : 'date not set'} · next
            review{' '}
            {d.schedule?.nextReviewDate
              ? fmtDate(d.schedule.nextReviewDate)
              : s.nextReviewDate
                ? `${fmtDate(s.nextReviewDate)} (register date)`
                : 'not set'}
          </p>
        ) : (
          <p>
            No approved version yet, so there is no effective date. Until approval this SOP is a
            proposal, not policy.
          </p>
        )}
        {write && s.approvedVersionId && s.status !== 'retired' ? (
          <ActionForm
            action={`${api}/schedule`}
            method="PUT"
            submitLabel="Save dates"
            variant="secondary"
            compact
            fields={[
              {
                name: 'effectiveDate',
                label: 'Effective date',
                type: 'date',
                required: true,
                defaultValue: d.schedule?.effectiveDate ?? '',
              },
              {
                name: 'nextReviewDate',
                label: 'Next review date',
                type: 'date',
                defaultValue: d.schedule?.nextReviewDate ?? '',
              },
            ]}
          />
        ) : null}
      </Card>
      <Card
        title="Required acknowledgements"
        description="Staff in a required department or role confirm they have read the approved version in force. A newly approved version needs new acknowledgements."
      >
        {d.acknowledgements.requirements.length ? (
          <>
            <p>
              {d.acknowledgements.totals.acknowledged} of {d.acknowledgements.totals.required}{' '}
              acknowledged
              {d.acknowledgements.totals.noLogin
                ? ` · ${d.acknowledgements.totals.noLogin} staff without a login cannot acknowledge`
                : ''}
            </p>
            <DataTable
              rows={d.acknowledgements.requirements}
              rowKey={(x) => x.id}
              columns={[
                {
                  key: 'audienceLabel',
                  header: 'Audience',
                  render: (x) =>
                    `${x.audienceType === 'role' ? 'Role' : 'Department'}: ${humanise(x.audienceLabel)}`,
                },
                { key: 'dueDate', header: 'Acknowledge by', render: (x) => fmtDate(x.dueDate) },
                {
                  key: 'counts',
                  header: 'Acknowledged',
                  render: (x) => `${x.counts.acknowledged} of ${x.counts.required}`,
                },
                {
                  key: 'outstanding',
                  header: 'Still to acknowledge',
                  render: (x) =>
                    x.outstanding === null
                      ? `${x.counts.outstanding} person(s)`
                      : x.outstanding.length
                        ? x.outstanding.join(', ')
                        : 'Nobody',
                },
                {
                  key: 'act',
                  header: '',
                  render: (x) =>
                    write ? (
                      <ActionForm
                        action={`${api}/acknowledgement-requirements/${x.id}/withdraw`}
                        submitLabel="Withdraw requirement"
                        variant="secondary"
                        compact
                        fields={[{ name: 'reason', label: 'Reason', required: true }]}
                      />
                    ) : null,
                },
              ]}
            />
          </>
        ) : (
          <EmptyState
            title="No acknowledgement required"
            description={
              s.approvedVersionId
                ? undefined
                : 'Acknowledgements can be required once a version is approved.'
            }
          />
        )}
        {write && s.approvedVersionId && s.status !== 'retired' ? (
          <div className="el-grid">
            {(
              [
                ['department', 'departmentId', 'Department', options.departments],
                ['role', 'role', 'Role', ROLES],
              ] as const
            ).map(([audienceType, name, label, choices]) => (
              <ActionForm
                key={audienceType}
                action={`${api}/acknowledgement-requirements`}
                submitLabel={`Require from a ${audienceType}`}
                variant="secondary"
                extra={{ audienceType }}
                fields={[
                  { name, label, type: 'select', required: true, options: choices },
                  { name: 'dueDate', label: 'Acknowledge by', type: 'date' },
                ]}
              />
            ))}
          </div>
        ) : null}
      </Card>
      {d.relatedTasks || d.relatedIncidents ? (
        <div className="el-grid">
          {d.relatedTasks ? (
            <Card title="Tasks linked to this SOP">
              <DataTable
                rows={d.relatedTasks}
                rowKey={(x) => x.id}
                empty={<EmptyState title="No linked tasks" />}
                columns={[
                  {
                    key: 'code',
                    header: 'Task',
                    render: (x) => <a href={`/ops/tasks/${x.id}`}>{x.code}</a>,
                  },
                  { key: 'title', header: 'Title' },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (x) => (
                      <StatusBadge tone={statusTone(x.status)}>
                        {TASK_STATUS_LABELS[x.status as TaskStatus]}
                      </StatusBadge>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
          {d.relatedIncidents ? (
            <Card title="Incidents linked to this SOP">
              <DataTable
                rows={d.relatedIncidents}
                rowKey={(x) => x.id}
                empty={<EmptyState title="No linked incidents" />}
                columns={[
                  { key: 'code', header: 'Incident' },
                  { key: 'title', header: 'Title' },
                  { key: 'status', header: 'Status', render: (x) => humanise(x.status) },
                ]}
              />
            </Card>
          ) : null}
        </div>
      ) : null}
      <Card title="Checklist of the current version">
        <DataTable
          rows={d.checklist}
          rowKey={(c) => c.id}
          empty={<EmptyState title="No checklist steps" />}
          columns={[
            { key: 'seq', header: '#', numeric: true },
            { key: 'section', header: 'Section' },
            { key: 'text', header: 'Step' },
          ]}
        />
      </Card>
      <div className="el-grid">
        <Card title="Versions">
          <DataTable
            rows={d.versions}
            rowKey={(x) => x.id}
            columns={[
              { key: 'versionLabel', header: 'Version' },
              {
                key: 'status',
                header: 'Status',
                // approved → success, superseded → neutral, every other version status → info.
                render: (x) => <StatusBadge tone={decisionTone(x.status)}>{x.status}</StatusBadge>,
              },
              { key: 'createdAt', header: 'Created', render: (x) => fmtDateTime(x.createdAt) },
              { key: 'approvedAt', header: 'Approved', render: (x) => fmtDateTime(x.approvedAt) },
            ]}
          />
        </Card>
        <Card
          title="Approval history"
          description="Kept in the shared approval service; nothing is deleted."
        >
          <DataTable
            rows={d.approvals}
            rowKey={(a) => a.id}
            empty={<EmptyState title="Never submitted" />}
            columns={[
              { key: 'versionLabel', header: 'Version' },
              { key: 'status', header: 'Decision' },
              {
                key: 'requestedAt',
                header: 'Requested',
                render: (a) => fmtDateTime(a.requestedAt),
              },
              { key: 'decidedAt', header: 'Decided', render: (a) => fmtDateTime(a.decidedAt) },
              { key: 'comment', header: 'Comment', render: (a) => a.comment ?? '' },
            ]}
          />
        </Card>
      </div>
      {write && s.status !== 'retired' ? (
        <ActionForm
          {...flow('retire')}
          submitLabel="Retire SOP"
          fields={[{ name: 'reason', label: 'Reason', required: true }]}
          variant="danger"
        />
      ) : null}
      {s.status === 'retired' ? (
        d.archive ? (
          <Alert tone="info" title="Archived">
            {fmtDateTime(d.archive.archivedAt)} — {d.archive.reason}. Archived SOPs stay readable
            here.
          </Alert>
        ) : write ? (
          <ActionForm
            action={`${api}/archive`}
            submitLabel="Archive SOP"
            fields={[{ name: 'reason', label: 'Reason for archiving', required: true }]}
            variant="secondary"
          />
        ) : null
      ) : null}
    </div>
  );
}

async function History({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getSopHistory(db, user, id));
  if (!r.ok) return null; // the detail section shows the access / not-found state
  return (
    <Card title="Change history" description="From the audit log, newest first.">
      <DataTable
        rows={r.data}
        rowKey={(h) => h.id}
        empty={<EmptyState title="No recorded changes" />}
        columns={[
          { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
          { key: 'actorName', header: 'Who', render: (h) => h.actorName ?? 'System' },
          { key: 'label', header: 'Change' },
        ]}
      />
    </Card>
  );
}
