import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '../../../domain';
import { getTaskDetail } from '../../../server/tasks';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, statusTone } from '../../../ui/format';
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
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getTaskDetail(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const t = d.task;
  const status = t.status as TaskStatus;
  const openBlockers = d.blockedBy.filter((b) => !['completed', 'cancelled'].includes(b.status));
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
          <ActionForm
            action={`/ops/api/v1/tasks/${t.id}/status`}
            submitLabel="Update"
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
                    submitLabel="Update"
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
              /^https?:\/\//.test(t.evidenceLink) ? (
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
