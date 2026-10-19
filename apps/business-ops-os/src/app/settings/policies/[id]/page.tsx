import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  DECISION_STATE_LABELS,
  POLICY_AREAS,
  POLICY_STATUS_LABELS,
  SETTING_KEYS,
  type DecisionState,
  type PolicyStatus,
} from '../../../../domain';
import { formOptions } from '../../../../server/options';
import { getPolicy, getPolicyHistory } from '../../../../server/policies-register';
import { ActionForm } from '../../../../ui/action-form';
import { decisionTone, fmtDate, fmtDateTime, humanise, statusTone } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:settings:read', `/ops/settings/policies/${id}`);
  return (
    <Frame access={access} active="policies">
      <p>
        <a href="/ops/settings/policies">Back to the policies &amp; compliance register</a>
      </p>
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
    d: await getPolicy(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const p = d.policy;
  const api = `/ops/api/v1/settings/policies/${p.id}`;
  const shown = d.approved ?? d.current;
  const editable = d.canManage && d.current?.status !== 'proposed';
  const draftSource = d.current?.status === 'draft' ? d.current : shown;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${p.code} — ${p.title}`}
        description={`${humanise(p.area)} · accountable ${d.accountableName ?? 'not named'}${p.ownerDecisionRef ? ` · owner decision ${p.ownerDecisionRef}` : ''}`}
      />
      <p>
        <StatusBadge
          tone={p.status === 'approved' ? 'success' : p.status === 'retired' ? 'neutral' : 'info'}
        >
          {POLICY_STATUS_LABELS[p.status as PolicyStatus]}
        </StatusBadge>{' '}
        {d.reviewFlag === 'overdue' ? (
          <StatusBadge tone="danger">Review overdue</StatusBadge>
        ) : null}
        {d.reviewFlag === 'due_soon' ? (
          <StatusBadge tone="warning">Review due soon</StatusBadge>
        ) : null}
      </p>
      <Alert tone="info">
        Text and sources are entered by Elevate staff. Elevate OS does not check them against any
        law; nothing here is legal advice.
      </Alert>
      {p.status === 'retired' ? (
        <Alert tone="info" title="Retired">
          {fmtDateTime(p.retiredAt)} — {p.retiredReason}. Retired entries stay readable and cannot
          be changed.
        </Alert>
      ) : null}
      {p.summary ? <p>{p.summary}</p> : null}
      <Card
        title={
          d.approved
            ? `Approved text (version ${d.approved.versionNumber})`
            : d.current
              ? `Version ${d.current.versionNumber} (${d.current.status}) — not approved`
              : 'No text yet'
        }
        description={
          shown
            ? `Source: ${shown.sourceReference ?? 'not given'} · effective ${fmtDate(shown.effectiveDate)} · next review ${fmtDate(shown.nextReviewDate)}`
            : undefined
        }
      >
        {shown?.requirementText ? (
          <pre className="el-pre">{shown.requirementText}</pre>
        ) : (
          <EmptyState title="No requirement text written yet" />
        )}
        <h3>Settings that implement it</h3>
        <DataTable
          rows={d.linkedSettings}
          rowKey={(s) => s.key}
          empty={<p>No settings linked.</p>}
          columns={[
            {
              key: 'label',
              header: 'Setting',
              render: (s) =>
                s.known ? <a href="/ops/settings">{s.label}</a> : `${s.key} (unknown key)`,
            },
            { key: 'key', header: 'Key' },
            {
              key: 'decisionState',
              header: 'Setting state',
              render: (s) =>
                s.decisionState ? (
                  <StatusBadge tone={decisionTone(s.decisionState)}>
                    {DECISION_STATE_LABELS[s.decisionState as DecisionState]}
                  </StatusBadge>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
      {d.approved && d.current && d.current.id !== d.approved.id ? (
        <Card
          title={`Newer version ${d.current.versionNumber} (${d.current.status})`}
          description="The approved version above stays in force until this one is approved."
        >
          <pre className="el-pre">{d.current.requirementText || '(empty)'}</pre>
          {d.current.changeNote ? (
            <p className="el-field-hint">Change: {d.current.changeNote}</p>
          ) : null}
        </Card>
      ) : null}
      {d.canManage || d.canApprove ? (
        <Card
          title="Decide or move this entry on"
          description="The person who proposes a version cannot approve it."
        >
          <div className="el-grid">
            {d.canManage && d.current?.status === 'draft' ? (
              <ActionForm
                action={`${api}/workflow`}
                submitLabel="Propose for approval"
                extra={{ action: 'propose' }}
                fields={[{ name: 'comment', label: 'Note for the approver' }]}
              />
            ) : null}
            {d.current?.status === 'proposed' ? (
              d.canApprove ? (
                <>
                  <ActionForm
                    action={`${api}/workflow`}
                    submitLabel="Approve this version"
                    extra={{ action: 'approve' }}
                    fields={[{ name: 'comment', label: 'Comment' }]}
                  />
                  <ActionForm
                    action={`${api}/workflow`}
                    submitLabel="Reject this version"
                    variant="danger"
                    extra={{ action: 'reject' }}
                    fields={[{ name: 'comment', label: 'Reason', required: true }]}
                  />
                </>
              ) : (
                <>
                  <p className="el-field-hint">{d.approveBlocker ?? 'Waiting for an approver.'}</p>
                  {d.canManage ? (
                    <ActionForm
                      action={`${api}/workflow`}
                      submitLabel="Withdraw my proposal"
                      variant="secondary"
                      extra={{ action: 'withdraw' }}
                    />
                  ) : null}
                </>
              )
            ) : null}
          </div>
        </Card>
      ) : null}
      {editable && draftSource !== undefined ? (
        <Card
          title={d.current?.status === 'draft' ? 'Edit the draft' : 'Start a new version'}
          description="Approved text is never overwritten: a change becomes a new version that needs approval again."
        >
          <ActionForm
            action={`${api}/draft`}
            method="PUT"
            submitLabel={d.current?.status === 'draft' ? 'Save draft' : 'Save as new draft version'}
            fields={[
              {
                name: 'requirementText',
                label: 'Requirement (as written by Elevate)',
                type: 'textarea',
                required: true,
                defaultValue: draftSource?.requirementText ?? '',
              },
              {
                name: 'sourceReference',
                label: 'Source reference',
                defaultValue: draftSource?.sourceReference ?? '',
              },
              {
                name: 'linkedSettingKeys',
                label: 'Linked setting keys (comma separated)',
                type: 'list',
                defaultValue: draftSource?.linkedSettingKeys.join(', ') ?? '',
                hint: `Known keys: ${SETTING_KEYS.join(', ')}`,
              },
              {
                name: 'effectiveDate',
                label: 'Effective date',
                type: 'date',
                defaultValue: draftSource?.effectiveDate ?? '',
              },
              {
                name: 'nextReviewDate',
                label: 'Next review date',
                type: 'date',
                defaultValue: draftSource?.nextReviewDate ?? '',
              },
              { name: 'changeNote', label: 'What changed' },
            ]}
          />
        </Card>
      ) : null}
      {d.canManage ? (
        <Card title="Register details">
          <ActionForm
            action={api}
            method="PATCH"
            submitLabel="Save details"
            variant="secondary"
            fields={[
              { name: 'title', label: 'Title', defaultValue: p.title },
              {
                name: 'area',
                label: 'Area',
                type: 'select',
                options: POLICY_AREAS.map((a) => ({ value: a, label: humanise(a) })),
                defaultValue: p.area,
              },
              {
                name: 'summary',
                label: 'Summary',
                type: 'textarea',
                defaultValue: p.summary ?? '',
              },
              {
                name: 'accountableStaffId',
                label: 'Accountable staff member',
                type: 'select',
                options: options.staff,
                defaultValue: p.accountableStaffId ?? '',
              },
              {
                name: 'ownerDecisionRef',
                label: 'Owner decision',
                defaultValue: p.ownerDecisionRef ?? '',
              },
            ]}
          />
          {d.current?.status !== 'proposed' ? (
            <ActionForm
              action={`${api}/workflow`}
              submitLabel="Retire this entry"
              variant="danger"
              extra={{ action: 'retire' }}
              fields={[{ name: 'reason', label: 'Reason', required: true }]}
            />
          ) : null}
        </Card>
      ) : null}
      <div className="el-grid">
        <Card title="Versions" description="Every version is kept.">
          <DataTable
            rows={d.versions}
            rowKey={(v) => v.id}
            columns={[
              { key: 'versionNumber', header: 'Version', numeric: true },
              {
                key: 'status',
                header: 'Status',
                render: (v) => <StatusBadge tone={statusTone(v.status)}>{v.status}</StatusBadge>,
              },
              { key: 'createdByName', header: 'Written by' },
              {
                key: 'proposedByName',
                header: 'Proposed by',
                render: (v) => v.proposedByName ?? '—',
              },
              { key: 'decidedByName', header: 'Decided by', render: (v) => v.decidedByName ?? '—' },
              { key: 'decidedAt', header: 'Decided', render: (v) => fmtDateTime(v.decidedAt) },
              { key: 'changeNote', header: 'Change', render: (v) => v.changeNote ?? '—' },
            ]}
          />
        </Card>
        <Card title="Approval history" description="Kept in the shared approval service.">
          <DataTable
            rows={d.approvals}
            rowKey={(a) => a.id}
            empty={<EmptyState title="Never proposed" />}
            columns={[
              { key: 'versionNumber', header: 'Version', numeric: true },
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
    </div>
  );
}

async function History({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getPolicyHistory(db, user, id));
  if (!r.ok) return null;
  return (
    <Card title="Change history" description="From the audit log, newest first.">
      <DataTable
        rows={r.data}
        rowKey={(h) => h.id}
        empty={<EmptyState title="No recorded changes" />}
        columns={[
          { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
          { key: 'actorName', header: 'Who', render: (h) => h.actorName ?? 'System' },
          {
            key: 'action',
            header: 'Change',
            render: (h) => humanise(h.action.replace('policy.', '')),
          },
        ]}
      />
    </Card>
  );
}
