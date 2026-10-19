import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  TASK_REVIEW_STATE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from '../../../domain';
import { formOptions } from '../../../server/options';
import { getTaskActivity, getTaskDetail } from '../../../server/tasks';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:tasks:read', `/ops/tasks/${id}`);
  return (
    <Frame access={access} active="tasks">
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
      <Section label="Loading activity…">
        <Activity user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

const isUrl = (v: string) => /^https?:\/\//i.test(v);

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => ({
    d: await getTaskDetail(db, user, id),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { d, options } = r.data;
  const t = d.task;
  const status = t.status as TaskStatus;
  const openBlockers = d.blockedBy.filter((b) => !['completed', 'cancelled'].includes(b.status));
  const review = d.review;
  return (
    <div className="el-stack">
      <PageHeader title={`${t.code} — ${t.title}`} description={t.description ?? undefined} />
      <p>
        <StatusBadge tone={statusTone(status)}>{TASK_STATUS_LABELS[status]}</StatusBadge> · priority{' '}
        {t.priority} · due {t.dueDate ? fmtDate(t.dueDate) : 'not set'} · escalation level L
        {t.escalationLevel}
        {d.flags.includes('overdue') ? (
          <StatusBadge tone="danger">Overdue {d.daysOverdue} day(s)</StatusBadge>
        ) : null}
        {review.state !== 'not_required' ? (
          <StatusBadge tone={review.state === 'awaiting_review' ? 'info' : 'neutral'}>
            {TASK_REVIEW_STATE_LABELS[review.state]}
          </StatusBadge>
        ) : null}
      </p>
      <Card title="People">
        <p>
          Owner: {d.ownerName ?? 'none'} · Accountable: {d.accountableName ?? 'none'} · Backup:{' '}
          {d.backupName ?? 'none'}
        </p>
      </Card>
      {openBlockers.length ? (
        <Alert tone="warning" title="Blocked by open tasks">
          {openBlockers.map((b) => b.code).join(', ')} — completing needs an override reason.
        </Alert>
      ) : null}
      {d.canWrite ? (
        <Card
          title="Change status"
          description="Completion needs a note or evidence link (BR-OPS-11). Cancel, block and reopen need a reason."
        >
          {review.state === 'awaiting_review' ? (
            <Alert tone="info">
              A supervisor review is pending. The reviewer accepts the completion or returns the
              task; it cannot be reopened until then.
            </Alert>
          ) : null}
          <ActionForm
            action={`/ops/api/v1/tasks/${t.id}/status`}
            submitLabel="Change status"
            fields={[
              {
                name: 'to',
                label: 'New status',
                type: 'select',
                required: true,
                options: TASK_STATUSES.filter((s) => s !== status).map((s) => ({
                  value: s,
                  label: TASK_STATUS_LABELS[s],
                })),
              },
              { name: 'reason', label: 'Reason' },
              { name: 'completionNote', label: 'Completion note' },
              { name: 'evidenceLink', label: 'Evidence link' },
              {
                name: 'blockerOverrideReason',
                label: 'Override reason (only to complete despite open blockers)',
              },
            ]}
          />
          <ActionForm
            action={`/ops/api/v1/tasks/${t.id}/dependencies`}
            submitLabel="Add blocker"
            fields={[{ name: 'blockedByTaskId', label: 'Blocked by (task id)', required: true }]}
            variant="secondary"
          />
        </Card>
      ) : null}
      <Card
        title="Supervisor review"
        description="When a review is required, completing the task sends it to the reviewer. The person who completed it and the owner never review it."
      >
        {review.required ? (
          <p>
            Required. Reviewer:{' '}
            {review.requirement?.reviewerStaffId
              ? (review.reviewerName ?? 'named reviewer')
              : `${d.accountableName ?? 'the accountable owner'} or an operations manager`}
            {review.requirement?.note ? ` — ${review.requirement.note}` : ''}
          </p>
        ) : (
          <p>No review is required for this task.</p>
        )}
        {review.latest?.status === 'pending' ? (
          review.canDecide ? (
            <div className="el-grid">
              <ActionForm
                action={`/ops/api/v1/tasks/${t.id}/review`}
                submitLabel="Accept completion"
                extra={{ decision: 'accept' }}
                fields={[{ name: 'note', label: 'Note (optional)' }]}
              />
              <ActionForm
                action={`/ops/api/v1/tasks/${t.id}/review`}
                submitLabel="Return to owner"
                variant="danger"
                extra={{ decision: 'return' }}
                fields={[{ name: 'note', label: 'What needs to change', required: true }]}
              />
            </div>
          ) : (
            <p className="el-field-hint">
              Waiting for the reviewer.{review.decideBlocker ? ` ${review.decideBlocker}` : ''}
            </p>
          )
        ) : null}
        {d.canManage ? (
          <div className="el-grid">
            <ActionForm
              action={`/ops/api/v1/tasks/${t.id}/review-requirement`}
              method="PUT"
              submitLabel={review.required ? 'Update review requirement' : 'Require a review'}
              variant="secondary"
              fields={[
                {
                  name: 'reviewerStaffId',
                  label: 'Named reviewer (blank = accountable owner or a manager)',
                  type: 'select',
                  options: options.staff.filter((s) => s.value !== t.ownerStaffId),
                },
                { name: 'note', label: 'Note for the reviewer' },
              ]}
            />
            {review.required && review.latest?.status !== 'pending' ? (
              <ActionForm
                action={`/ops/api/v1/tasks/${t.id}/review-requirement`}
                method="DELETE"
                submitLabel="Remove review requirement"
                variant="secondary"
              />
            ) : null}
          </div>
        ) : null}
        {review.history.length ? (
          <DataTable
            caption="Review history"
            rows={review.history}
            rowKey={(h) => h.id}
            columns={[
              { key: 'cycle', header: 'Cycle', numeric: true },
              {
                key: 'status',
                header: 'Outcome',
                render: (h) => (
                  <StatusBadge tone={statusTone(h.status)}>{humanise(h.status)}</StatusBadge>
                ),
              },
              {
                key: 'submittedAt',
                header: 'Submitted',
                render: (h) => fmtDateTime(h.submittedAt),
              },
              { key: 'decidedAt', header: 'Decided', render: (h) => fmtDateTime(h.decidedAt) },
              { key: 'decisionNote', header: 'Note', render: (h) => h.decisionNote ?? '—' },
            ]}
          />
        ) : null}
      </Card>
      <div className="el-grid">
        <Card title="Blocked by">
          <DataTable
            rows={d.blockedBy}
            rowKey={(b) => b.id}
            empty={<EmptyState title="No dependencies" />}
            columns={[
              {
                key: 'code',
                header: 'Task',
                render: (b) => <a href={`/ops/tasks/${b.id}`}>{b.code}</a>,
              },
              { key: 'title', header: 'Title' },
              {
                key: 'status',
                header: 'Status',
                render: (b) => TASK_STATUS_LABELS[b.status as TaskStatus],
              },
            ]}
          />
        </Card>
        <Card title="Blocks">
          <DataTable
            rows={d.blocks}
            rowKey={(b) => b.id}
            empty={<EmptyState title="Blocks nothing" />}
            columns={[
              {
                key: 'code',
                header: 'Task',
                render: (b) => <a href={`/ops/tasks/${b.id}`}>{b.code}</a>,
              },
              { key: 'title', header: 'Title' },
            ]}
          />
        </Card>
      </div>
      <Card
        title="Comments"
        description="Comments cannot be edited. The author or an operations manager can hide one with a reason; the reason stays visible."
      >
        {d.comments.length ? (
          <ol className="el-stack">
            {d.comments.map((c) => (
              <li key={c.id}>
                <p className="el-field-hint">
                  {c.authorName} · {fmtDateTime(c.createdAt)}
                </p>
                {c.hidden ? (
                  <p>
                    <StatusBadge tone="neutral">Hidden</StatusBadge> {fmtDateTime(c.hiddenAt)} —{' '}
                    {c.hiddenReason}
                    {c.body ? <span className="el-pre"> Original: {c.body}</span> : null}
                  </p>
                ) : (
                  <p className="el-pre">{c.body}</p>
                )}
                {c.canHide ? (
                  <ActionForm
                    action={`/ops/api/v1/tasks/${t.id}/comments/${c.id}/hide`}
                    submitLabel="Hide comment"
                    variant="secondary"
                    compact
                    fields={[{ name: 'reason', label: 'Reason for hiding', required: true }]}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No comments yet" />
        )}
        {d.canContribute ? (
          <ActionForm
            action={`/ops/api/v1/tasks/${t.id}/comments`}
            submitLabel="Add comment"
            fields={[{ name: 'body', label: 'Comment', type: 'textarea', required: true }]}
          />
        ) : null}
      </Card>
      <Card
        title="Documents and evidence"
        description="References only: a label and where the document is kept (a link or a location). Elevate OS stores no files."
      >
        <DataTable
          rows={d.references}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No documents referenced" />}
          columns={[
            { key: 'kind', header: 'Kind', render: (x) => humanise(x.kind) },
            { key: 'label', header: 'Label' },
            {
              key: 'location',
              header: 'Where',
              render: (x) =>
                x.removedAt ? (
                  <s>{x.location}</s>
                ) : isUrl(x.location) ? (
                  <a href={x.location} rel="noreferrer">
                    {x.location}
                  </a>
                ) : (
                  x.location
                ),
            },
            {
              key: 'addedByName',
              header: 'Added',
              render: (x) => `${x.addedByName}, ${fmtDateTime(x.createdAt)}`,
            },
            {
              key: 'act',
              header: '',
              render: (x) =>
                x.removedAt ? (
                  `Removed: ${x.removedReason ?? ''}`
                ) : x.canRemove ? (
                  <ActionForm
                    action={`/ops/api/v1/tasks/${t.id}/references/${x.id}/remove`}
                    submitLabel="Remove reference"
                    variant="secondary"
                    compact
                    fields={[{ name: 'reason', label: 'Reason', required: true }]}
                  />
                ) : null,
            },
          ]}
        />
        {d.canContribute ? (
          <ActionForm
            action={`/ops/api/v1/tasks/${t.id}/references`}
            submitLabel="Add reference"
            compact
            fields={[
              {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                defaultValue: 'document',
                options: [
                  { value: 'document', label: 'Document' },
                  { value: 'evidence', label: 'Evidence' },
                  { value: 'other', label: 'Other' },
                ],
              },
              { name: 'label', label: 'Label', required: true },
              {
                name: 'location',
                label: 'Link or location',
                required: true,
                hint: 'e.g. https://… or "Admissions drive › 2026 › forms"',
              },
            ]}
          />
        ) : null}
      </Card>
      <Card
        title="Escalations"
        description="Recipients come from the owner’s reporting line. The owner keeps the task."
      >
        <DataTable
          rows={d.escalations}
          rowKey={(e) => e.id}
          empty={<EmptyState title="Not escalated" />}
          columns={[
            { key: 'level', header: 'Level', render: (e) => `L${e.level}` },
            { key: 'reason', header: 'Reason' },
            {
              key: 'recipientName',
              header: 'Recipient',
              render: (e) => e.recipientName ?? 'Operations managers (no manager on record)',
            },
            { key: 'respondBy', header: 'Respond by', render: (e) => fmtDate(e.respondBy) },
            {
              key: 'status',
              header: 'Status',
              render: (e) => <StatusBadge tone={statusTone(e.status)}>{e.status}</StatusBadge>,
            },
            { key: 'raisedAt', header: 'Raised', render: (e) => fmtDateTime(e.raisedAt) },
            {
              key: 'act',
              header: '',
              render: (e) =>
                e.status !== 'resolved' ? (
                  <ActionForm
                    action={`/ops/api/v1/escalations/${e.id}`}
                    submitLabel="Update escalation"
                    compact
                    fields={[
                      {
                        name: 'action',
                        label: 'Action',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'acknowledge', label: 'Acknowledge' },
                          { value: 'resolve', label: 'Resolve' },
                        ],
                      },
                      { name: 'note', label: 'Note' },
                    ]}
                  />
                ) : (
                  e.resolutionNote
                ),
            },
          ]}
        />
      </Card>
      {t.completedAt ? (
        <Card title="Completion">
          <p>
            {fmtDateTime(t.completedAt)} — {t.completionNote ?? ''}{' '}
            {t.evidenceLink ? (
              isUrl(t.evidenceLink) ? (
                <a href={t.evidenceLink} rel="noreferrer">
                  evidence
                </a>
              ) : (
                `evidence: ${t.evidenceLink}`
              )
            ) : null}
          </p>
          {t.blockerOverrideReason ? (
            <p>Completed despite blockers: {t.blockerOverrideReason}</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

async function Activity({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getTaskActivity(db, user, id));
  if (!r.ok) return null; // the detail section above already shows the access / not-found state
  return (
    <Card
      title="Activity"
      description="Every change to this task, newest first: status, reassignments, dependencies, comments, documents, escalations, reviews and reminders."
    >
      <DataTable
        rows={r.data}
        rowKey={(a) => a.id}
        empty={<EmptyState title="No recorded activity" />}
        columns={[
          { key: 'at', header: 'When', render: (a) => fmtDateTime(a.at) },
          { key: 'actorName', header: 'Who', render: (a) => a.actorName ?? '—' },
          { key: 'kind', header: 'Type', render: (a) => humanise(a.kind) },
          { key: 'summary', header: 'What happened' },
        ]}
      />
    </Card>
  );
}
