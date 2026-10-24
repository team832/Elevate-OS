/**
 * `<base>/notifications` (brief §9): the signed-in person's in-app notifications, shared by every
 * workspace (D-073). Every link opens through `<base>/notifications/{id}/open`, which marks it read
 * and re-checks access first (one in another workspace then opens on its own origin).
 */
import { Alert, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ActionForm } from '../../ui/action-form';
import { fmtDateTime } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { NoticeStates } from '../../ui/task-notices';
import type { BodyProps } from '../tasks/_components/bodies';
import '../ops.css';
import { inboxPage, inboxQuery } from './inbox';

type Row = Awaited<ReturnType<typeof inboxPage>>['items'][number];

/** Why <base>/notifications/{id}/open sent the person back here. */
const REFUSED: Record<string, string> = {
  denied: 'You no longer have access to this item.',
  missing: 'That notification is not in your list.',
};

export function NotificationsBody(props: BodyProps) {
  return (
    <Section label="Loading notifications…">
      <Inbox {...props} />
    </Section>
  );
}

async function Inbox({ user, base, searchParams }: BodyProps) {
  const page = inboxQuery.safeParse({ page: searchParams.page }).data?.page ?? 1;
  const result = await load((db) => inboxPage(db, user.id, page));
  if (!result.ok) return result.view;
  const { items, total, unread, pageSize } = result.data;
  const api = `${base}/api/v1/notifications`;
  const refused = REFUSED[searchParams.open ?? ''];
  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread === 1 ? '1 unread notification.' : `${unread} unread notifications.`}
        actions={
          unread > 0 ? (
            <ActionForm
              action={api}
              extra={{ all: true }}
              submitLabel="Mark all as read"
              successText="All marked as read."
              variant="secondary"
              compact
            />
          ) : null
        }
      />
      {refused ? <Alert tone="warning">{refused}</Alert> : null}
      <RecordTable<Row>
        rows={items}
        rowKey={(n) => n.id}
        caption={`${total} ${total === 1 ? 'notification' : 'notifications'}, newest first`}
        empty="No notifications yet. Tasks assigned to you, reviews of your work and approvals that need you will appear here."
        columns={[
          {
            key: 'title',
            header: 'Notification',
            render: (n) => (
              <>
                {n.link ? <a href={`${base}/notifications/${n.id}/open`}>{n.title}</a> : n.title}
                {n.body ? <p className="el-field-hint">{n.body}</p> : null}
                {n.task ? <NoticeStates f={{ ...n.task, readAt: n.readAt }} /> : null}
              </>
            ),
          },
          { key: 'at', header: 'Received', render: (n) => fmtDateTime(n.createdAt) },
          {
            key: 'state',
            header: 'Status',
            render: (n) =>
              n.readAt ? (
                <StatusBadge>Read</StatusBadge>
              ) : (
                <StatusBadge tone="info">Unread</StatusBadge>
              ),
          },
          {
            key: 'action',
            header: 'Action',
            render: (n) =>
              n.readAt ? null : (
                <ActionForm
                  action={api}
                  extra={{ ids: [n.id] }}
                  submitLabel="Mark as read"
                  successText="Marked as read."
                  labelSuffix={` — ${n.title}`}
                  variant="secondary"
                  compact
                />
              ),
          },
        ]}
      />
      <Pager
        basePath={`${base}/notifications`}
        params={searchParams}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </>
  );
}
