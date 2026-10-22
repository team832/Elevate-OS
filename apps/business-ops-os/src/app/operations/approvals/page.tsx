import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listApprovalInbox, type ApprovalInboxItem } from '../../../server/approvals';
import { ActionForm } from '../../../ui/action-form';
import { FeesNav } from '../../../ui/admissions-nav';
import { StatCard } from '../../../ui/charts';
import { fmtDateTime, fmtPaise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/operations/approvals';

/** Whole days since the request, in words. */
function age(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days < 1 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`;
}

const tuition = (i: ApprovalInboxItem) =>
  `${typeof i.beforePaise === 'number' ? fmtPaise(i.beforePaise) : 'New agreement'} → ${fmtPaise(i.afterPaise)}`;

/** "+₹20,000 (+20 %)"; a new agreement has no change. */
function change({ beforePaise: before, afterPaise: after = 0 }: ApprovalInboxItem) {
  if (typeof before !== 'number') return '—';
  const d = after - before;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const pct = before ? ` (${sign}${Math.abs(Math.round((d * 1000) / before) / 10)} %)` : '';
  return `${sign}${fmtPaise(Math.abs(d))}${pct}`;
}

const Ready = ({ i }: { i: ApprovalInboxItem }) =>
  i.ready ? (
    <StatusBadge tone="success">Ready to decide</StatusBadge>
  ) : (
    <>
      <StatusBadge tone="warning">Not yet</StatusBadge> {i.blockers.join(' ')}
    </>
  );

/** /ops/operations/approvals — everything waiting for the signed-in user's decision. */
export default async function ApprovalsInboxPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:module:access', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="approvals">
      <PageHeader
        title="Approvals waiting for you"
        description="Fee changes you may decide. Someone else decides your own requests and the agreements you made."
        tabs={<FeesNav current="approvals" user={access.user} />}
      />
      <Section label="Collecting your approvals…">
        <Inbox user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Inbox({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load((db) => listApprovalInbox(db, user));
  if (!r.ok) return r.view;
  const { sources, total, unavailable } = r.data;
  if (sources.length === 0)
    return (
      <EmptyState
        title="You have no approval rights in Business Ops"
        description="Approvals appear here when your role lets you decide fee arrangements."
      />
    );
  const close = listHref(BASE, sp, { open: undefined });
  const note = (i: ApprovalInboxItem) =>
    can(user, 'ops:fees:read') ? (i.detail ?? 'None') : 'Hidden (needs fee access)';
  const open = sources.flatMap((s) => s.items).find((i) => i.id === sp.open);
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Waiting by list">
        {sources.map((s) => (
          <li key={s.key}>
            <StatCard
              label={s.label}
              value={s.count}
              note={s.status === 'unavailable' ? 'Could not be loaded' : 'Waiting for you'}
              href={`#${s.key}`}
            />
          </li>
        ))}
      </ul>
      {unavailable ? (
        <Alert tone="warning" title="Some lists could not be loaded">
          The counts leave those lists out. Reload the page to try again.
        </Alert>
      ) : null}
      {total === 0 && !unavailable ? (
        <EmptyState
          title="Nothing waiting for your decision"
          description="Your own requests never appear here."
        />
      ) : (
        sources.map((s) => (
          <Segment
            key={s.key}
            id={s.key}
            title={s.label}
            meta={
              s.status === 'ok' ? (
                <StatusBadge tone={s.count ? 'warning' : 'success'}>{s.count} waiting</StatusBadge>
              ) : (
                <StatusBadge tone="danger">Unavailable</StatusBadge>
              )
            }
            description={s.status === 'unavailable' ? s.error : undefined}
            flush
          >
            {s.status === 'ok' ? (
              <RecordTable
                rows={s.items}
                rowKey={(i) => i.id}
                rowHref={(i) => listHref(BASE, sp, { open: i.id })}
                empty="Nothing waiting."
                columns={[
                  { key: 'title', header: 'Request' },
                  ...(s.items.some((i) => i.afterPaise !== undefined)
                    ? [
                        { key: 'tuition', header: 'Tuition before → after', render: tuition },
                        { key: 'change', header: 'Change', numeric: true, render: change },
                      ]
                    : []),
                  { key: 'detail', header: 'Note', render: note },
                  {
                    key: 'requestedByName',
                    header: 'Requested by',
                    render: (i) => i.requestedByName ?? 'Not recorded',
                  },
                  { key: 'age', header: 'Waiting', render: (i) => age(i.requestedAt) },
                  { key: 'ready', header: 'State', render: (i) => <Ready i={i} /> },
                ]}
              />
            ) : (
              <p className="el-field-hint">Reload the page to try again.</p>
            )}
          </Segment>
        ))
      )}
      {open ? (
        <RecordModal
          id="approval-modal"
          title={open.title}
          meta={<Ready i={open} />}
          fullHref={open.link}
          closeHref={close}
          returnId={open.id}
        >
          <Segment title="Request" level={3} flush>
            <DetailTable
              rows={[
                open.afterPaise !== undefined && {
                  label: 'Tuition before → after',
                  value: tuition(open),
                },
                open.afterPaise !== undefined && { label: 'Change', value: change(open) },
                { label: 'Note', value: note(open) },
                { label: 'Requested by', value: open.requestedByName ?? 'Not recorded' },
                {
                  label: 'Waiting since',
                  value: `${fmtDateTime(open.requestedAt)} (${age(open.requestedAt).toLowerCase()})`,
                },
              ]}
            />
          </Segment>
          {open.decide ? (
            <Segment title="Your decision" level={3}>
              <div className="el-stack">
                <ActionForm
                  action={open.decide}
                  submitLabel="Approve"
                  extra={{ decision: 'approved' }}
                  redirectTo={close}
                  compact
                />
                <ActionForm
                  action={open.decide}
                  submitLabel="Reject"
                  variant="danger"
                  extra={{ decision: 'rejected' }}
                  redirectTo={close}
                  fields={[{ name: 'comment', label: 'Reason', type: 'textarea', required: true }]}
                />
              </div>
            </Segment>
          ) : (
            <p className="el-field-hint">
              This request is decided on its record: use “Open full record”.
            </p>
          )}
        </RecordModal>
      ) : null}
    </div>
  );
}
