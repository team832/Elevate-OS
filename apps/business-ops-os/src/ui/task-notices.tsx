/**
 * Task notification UI (owner brief 23 Oct 2026 §8): the five delivery states of assigned work,
 * and the due-soon / overdue panel every workspace's day page shows (mounted through
 * `@elevate/business-ops-os/work`). Work stays in the panel until it is submitted or closed.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { deadlineText, istWhen } from '../domain/staff-tasks';
import {
  noticeStates,
  reminderPreview,
  type NoticeFacts,
  type ReminderSettings,
} from '../domain/task-notices';
import { loadSettings } from '../server/settings';
import { dueWork } from '../server/task-reminders';
import { load } from './frame';
import { RecordTable } from './record-table';
import { Segment } from './sections';
import '../app/ops.css';

/**
 * "Delivered 23 Oct, 4:10 pm · Notice read: not yet · …" — each state named apart. Acknowledging
 * (task action, tasks.acknowledged_at) and reading the notice (notifications.read_at, set by
 * opening it or by Mark as read) never touch each other, so either can come first.
 */
export function NoticeStates({ f, explain }: { f: NoticeFacts; explain?: boolean }) {
  return (
    <>
      <ul className="ops-notice-states" aria-label="Notification states">
        {noticeStates(f).map((s) => (
          <li key={s.key}>
            {s.at ? (
              <StatusBadge tone="success">{`${s.label} ${istWhen(s.at)}`}</StatusBadge>
            ) : (
              <StatusBadge>{`${s.label}: not yet`}</StatusBadge>
            )}
          </li>
        ))}
      </ul>
      {explain ? (
        <p className="el-field-hint">
          Acknowledged: the person pressed Acknowledge on the task. Notice read: they opened the
          notification or marked it read. These are separate, so either can come first.
        </p>
      ) : null}
    </>
  );
}

/** What a person really gets from the reminder settings, from their current values. */
export function ReminderPreview({
  s,
  personalHours,
}: {
  s: ReminderSettings;
  personalHours?: number | null;
}) {
  const p = reminderPreview(s, personalHours);
  return (
    <Alert title="What this means for a person">
      <p>{p.schedule}</p>
      <p>{p.personal}</p>
      <p>{p.running}</p>
    </Alert>
  );
}

/** The same, for a workspace's Personal Settings (the setting lives here in Business Operations). */
export async function MyReminderPreview({ personalHours }: { personalHours: number | null }) {
  const r = await load((db) => loadSettings(db));
  if (!r.ok) return r.view;
  return <ReminderPreview s={r.data['tasks.reminders'].value} personalHours={personalHours} />;
}

type Item = NonNullable<Awaited<ReturnType<typeof dueWork>>>['items'][number];

/** The signed-in person's overdue and due-soon tasks; nothing for people without tasks or a staff record. */
export async function DueWork({ user, base }: { user: AuthenticatedUser; base: string }) {
  if (!can(user, 'ops:tasks:read')) return null;
  const r = await load((db) => dueWork(db, user));
  if (!r.ok) return r.view;
  if (!r.data) return null;
  const { items, dueSoonHours, capped } = r.data;
  return (
    <Segment
      title={`Due soon and overdue (${capped ? `first ${items.length}` : items.length})`}
      description={`Your open tasks past their deadline or due in the next ${dueSoonHours} hours. They stay here until you submit or finish them.`}
      flush
    >
      <RecordTable<Item>
        rows={items}
        rowKey={(t) => t.id}
        rowHref={(t) => `${base}/tasks/${t.id}`}
        empty={`Nothing overdue and nothing due in the next ${dueSoonHours} hours.`}
        columns={[
          { key: 'title', header: 'Task' },
          {
            key: 'state',
            header: 'State',
            render: (t) =>
              t.state === 'overdue' ? (
                <StatusBadge tone="danger">Overdue</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Due soon</StatusBadge>
              ),
          },
          { key: 'due', header: 'Deadline (IST)', render: (t) => deadlineText(t.dueOn, t.dueTime) },
        ]}
      />
    </Segment>
  );
}
