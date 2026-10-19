import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listApprovalInbox } from '../../../server/approvals';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

/** /ops/operations/approvals — everything waiting for the signed-in user's decision. */
export default async function ApprovalsInboxPage() {
  const access = await gate('ops:module:access', '/ops/operations/approvals');
  return (
    <Frame access={access} active="approvals">
      <PageHeader
        title="Approvals waiting for you"
        description="Requests you are allowed to decide. Your own requests never appear here: someone else decides them. Open an item to decide it on its record."
      />
      <Section label="Collecting your approvals…">
        <Inbox user={access.user} />
      </Section>
    </Frame>
  );
}

async function Inbox({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listApprovalInbox(db, user));
  if (!r.ok) return r.view;
  const { sources, total, unavailable } = r.data;
  if (sources.length === 0)
    return (
      <EmptyState
        title="You have no approval rights in Business Ops"
        description="Approvals appear here when your role lets you decide SOPs, fee arrangements, task reviews or company policies."
      />
    );
  return (
    <div className="el-stack">
      <nav className="el-subnav" aria-label="Approval sources">
        {sources.map((s) => (
          <a key={s.key} href={`#${s.key}`}>
            {s.label} ({s.count ?? 'unavailable'})
          </a>
        ))}
      </nav>
      {unavailable ? (
        <Alert tone="warning" title="Some lists could not be loaded">
          The counts below leave those lists out. Reload the page to try again.
        </Alert>
      ) : null}
      {total === 0 && !unavailable ? (
        <EmptyState title="Nothing is waiting for your decision" />
      ) : null}
      {sources.map((s) => (
        <div key={s.key} id={s.key}>
          <Card
            title={`${s.label} — ${s.count ?? 'unavailable'}`}
            description={s.status === 'unavailable' ? s.error : undefined}
          >
            {s.status === 'ok' ? (
              <DataTable
                rows={s.items}
                rowKey={(i) => i.id}
                empty={<p>Nothing waiting.</p>}
                columns={[
                  {
                    key: 'title',
                    header: 'Item',
                    render: (i) => <a href={i.link}>{i.title}</a>,
                  },
                  {
                    key: 'requestedByName',
                    header: 'Requested by',
                    render: (i) => i.requestedByName ?? '—',
                  },
                  {
                    key: 'requestedAt',
                    header: 'Waiting since',
                    render: (i) => fmtDateTime(i.requestedAt),
                  },
                  { key: 'detail', header: 'Note', render: (i) => i.detail ?? '—' },
                  {
                    key: 'ready',
                    header: 'Ready to decide',
                    render: (i) =>
                      i.ready ? (
                        <StatusBadge tone="success">Ready</StatusBadge>
                      ) : (
                        <>
                          <StatusBadge tone="warning">Not yet</StatusBadge> {i.blockers.join(' ')}
                        </>
                      ),
                  },
                ]}
              />
            ) : null}
          </Card>
        </div>
      ))}
    </div>
  );
}
