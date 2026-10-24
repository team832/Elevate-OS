/**
 * Task notification UI (owner brief 23 Oct 2026 §8): the five delivery states of assigned work,
 * and the due-soon / overdue panel every workspace's day page shows (mounted through
 * `@elevate/business-ops-os/work`). Work stays in the panel until it is submitted or closed.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';
import { deadlineText, istWhen } from '../domain/staff-tasks';
import { noticeStates, type NoticeFacts } from '../domain/task-notices';
import { dueWork } from '../server/task-reminders';
import { load } from './frame';
import { RecordTable } from './record-table';
import { Segment } from './sections';
import '../app/ops.css';

/** "Delivered 23 Oct, 4:10 pm · Read: not yet · …" — each state named apart. */
export function NoticeStates({ f }: { f: NoticeFacts }) {
  return (
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
  );
}

type Item = NonNullable<Awaited<ReturnType<typeof dueWork>>>['items'][number];

/** The signed-in person's overdue and due-soon tasks; nothing for people without tasks or a staff record. */
export async function DueWork({ user, base }: { user: AuthenticatedUser; base: string }) {
  if (!can(user, 'ops:tasks:read')) return null;
  const r = await load((db) => dueWork(db, user));
  if (!r.ok) return r.view;
  if (!r.data) return null;
  const { items, dueSoonHours } = r.data;
  return (
    <Segment
      title={`Due soon and overdue (${items.length})`}
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
