import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import { FOLLOW_UP_KIND_LABELS, type FollowUpKind } from '../../domain';
import { listFollowUps } from '../../server/follow-ups';
import { fmtDate, humanise, statusTone } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import type { LeadsBodyProps } from './leads-body';
import '../ops.css';

const VIEWS = [
  ['open', 'Open'],
  ['mine', 'Mine'],
  ['due_today', 'Due today'],
  ['overdue', 'Overdue'],
  ['all', 'All'],
] as const;
const PAGE_SIZE = 25;

/** `<base>/follow-ups`: lead follow-ups in the caller's scope by view; a row opens its lead. */
export function FollowUpsBody({ user, base, searchParams: sp, tabs }: LeadsBodyProps) {
  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Next actions on leads, each with an owner and an IST due date. Open the lead to record the outcome."
        tabs={tabs}
      />
      <Section>
        <FollowUps user={user} sp={sp} base={base} />
      </Section>
    </>
  );
}

async function FollowUps({
  user,
  sp,
  base,
}: {
  user: AuthenticatedUser;
  sp: LeadsBodyProps['searchParams'];
  base: string;
}) {
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? 'open';
  const r = await load((db) => listFollowUps(db, user, { view }));
  if (!r.ok) return r.view;
  const self = `${base}/follow-ups`;
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <Tabs
      idBase="follow-up-views"
      label="Follow-up views"
      selected={view}
      items={VIEWS.map(([key, label]) => ({
        key,
        label,
        href: listHref(self, {}, { view: key === 'open' ? undefined : key }),
      }))}
    >
      <RecordTable
        caption={`${r.data.length} follow-up${r.data.length === 1 ? '' : 's'}`}
        rows={r.data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        rowKey={(f) => f.id}
        rowHref={(f) => `${base}/leads/${f.leadId}`}
        linkColumn="lead"
        empty={
          <EmptyState
            title="No follow-ups here"
            description="Add a follow-up from the Follow-ups tab of a lead."
          />
        }
        columns={[
          { key: 'lead', header: 'Lead', render: (f) => `${f.studentName} (${f.leadCode})` },
          { key: 'title', header: 'Next action' },
          {
            key: 'kind',
            header: 'Kind',
            render: (f) => FOLLOW_UP_KIND_LABELS[f.kind as FollowUpKind],
          },
          {
            key: 'dueDate',
            header: 'Due (IST)',
            render: (f) => (
              <>
                {fmtDate(f.dueDate)}{' '}
                {f.due.state === 'overdue' ? (
                  <StatusBadge tone="danger">Overdue</StatusBadge>
                ) : f.due.state === 'due_today' ? (
                  <StatusBadge tone="warning">Due today</StatusBadge>
                ) : null}
              </>
            ),
          },
          { key: 'ownerName', header: 'Owner' },
          {
            key: 'status',
            header: 'Status',
            render: (f) => (
              <StatusBadge tone={statusTone(f.status)}>{humanise(f.status)}</StatusBadge>
            ),
          },
        ]}
      />
      <Pager basePath={self} params={sp} page={page} pageSize={PAGE_SIZE} total={r.data.length} />
    </Tabs>
  );
}
