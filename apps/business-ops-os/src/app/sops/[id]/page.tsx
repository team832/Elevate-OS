import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { SOP_STATUS_LABELS, type SopStatus } from '../../../domain';
import { formOptions } from '../../../server/options';
import { getSop } from '../../../server/sops';
import { ActionForm } from '../../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function SopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:sops:read', `/ops/sops/${id}`);
  return (
    <Frame access={access} active="sops">
      <Section>
        <Detail user={access.user} id={id} />
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
  return (
    <div className="el-stack">
      <PageHeader
        title={`${s.code} — ${s.title}`}
        description={`${d.department?.name ?? 'No department'} · owner ${d.owner?.fullName ?? s.ownerRole ?? 'not named'} · reviewer ${d.reviewer?.fullName ?? 'not named'} · backup ${d.backup?.fullName ?? 'none'}`}
      />
      <p>
        <StatusBadge tone={decisionTone(d.decisionState)}>
          {d.decisionState === 'approved'
            ? 'Approved'
            : d.decisionState === 'retired'
              ? 'Retired'
              : 'Proposed — not policy'}
        </StatusBadge>{' '}
        {SOP_STATUS_LABELS[s.status as SopStatus]}
      </p>
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
              {
                name: 'ownerStaffId',
                label: 'Owner',
                type: 'select',
                options: options.staff,
                defaultValue: s.ownerStaffId ?? '',
              },
              {
                name: 'reviewerStaffId',
                label: 'Reviewer',
                type: 'select',
                options: options.staff,
                defaultValue: s.reviewerStaffId ?? '',
              },
              {
                name: 'backupStaffId',
                label: 'Backup',
                type: 'select',
                options: options.staff,
                defaultValue: s.backupStaffId ?? '',
              },
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
            <ActionForm
              action={`${api}/workflow`}
              submitLabel="Submit for approval"
              extra={{ action: 'submit' }}
            />
          ) : null}
          {d.youAreReviewer && v?.status === 'in_review' ? (
            <ActionForm
              action={`${api}/workflow`}
              submitLabel="Record review"
              extra={{ action: 'review' }}
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
                action={`${api}/workflow`}
                submitLabel="Approve"
                extra={{ action: 'approve' }}
                fields={[{ name: 'comment', label: 'Comment' }]}
              />
              <ActionForm
                action={`${api}/workflow`}
                submitLabel="Reject"
                extra={{ action: 'reject' }}
                fields={[{ name: 'comment', label: 'Reason', required: true }]}
                variant="danger"
              />
            </>
          ) : null}
          {write && v?.status === 'in_review' ? (
            <ActionForm
              action={`${api}/workflow`}
              submitLabel="Withdraw (requester)"
              extra={{ action: 'withdraw' }}
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
                render: (x) => (
                  <StatusBadge
                    tone={decisionTone(
                      x.status === 'approved'
                        ? 'approved'
                        : x.status === 'superseded'
                          ? 'superseded'
                          : 'proposed',
                    )}
                  >
                    {x.status}
                  </StatusBadge>
                ),
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
          action={`${api}/workflow`}
          submitLabel="Retire SOP"
          extra={{ action: 'retire' }}
          fields={[{ name: 'reason', label: 'Reason', required: true }]}
          variant="danger"
        />
      ) : null}
    </div>
  );
}
