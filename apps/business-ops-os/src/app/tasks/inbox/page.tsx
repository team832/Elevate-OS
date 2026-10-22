import type { AuthenticatedUser } from '@elevate/authentication';
import { getDb } from '@elevate/database';
import { EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { EOD_STATUSES } from '../../../domain/staff-tasks';
import { EOD_STATUS_LABELS } from '../../../server/eod-export';
import { eodInbox, hasInbox } from '../../../server/eod-review';
import { eodInboxQuery } from '../../../server/eod-schemas';
import { reportFilterOptions } from '../../../server/task-period-report';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { TasksNav } from '../_components/eod-nav';
import { ReviewPane } from '../_components/eod-review';
import { EOD_TONES } from '../_components/eod-views';
import type { Params } from '../_components/task-views';

export const dynamic = 'force-dynamic';
const BASE = '/ops/tasks/inbox';

async function Inbox({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const parsed = eodInboxQuery.safeParse(sp);
  const q = parsed.success ? parsed.data : { page: 1 };
  const r = await load(async (db) => ({
    inbox: await eodInbox(db, user, q),
    options: await reportFilterOptions(db, user),
  }));
  if (!r.ok) return r.view;
  const { inbox, options } = r.data;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Employee name', value: sp.q }}
        filters={[
          { name: 'from', label: 'Report day from', type: 'date', value: sp.from },
          { name: 'to', label: 'Report day to', type: 'date', value: sp.to },
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: options.departments,
            value: sp.departmentId,
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: EOD_STATUSES.filter((s) => s !== 'draft').map((s) => ({
              value: s,
              label: EOD_STATUS_LABELS[s],
            })),
            value: sp.status,
          },
          {
            name: 'blockers',
            label: 'Blockers',
            type: 'select',
            anyLabel: 'With or without',
            options: [{ value: '1', label: 'Has blockers' }],
            value: sp.blockers,
          },
        ]}
      />
      {!parsed.success ? (
        <p className="el-field-hint">Some filters were not valid and were ignored.</p>
      ) : null}
      <RecordTable
        caption={`${inbox.total} report${inbox.total === 1 ? '' : 's'}`}
        rows={inbox.rows}
        rowKey={(x) => x.id}
        rowHref={(x) => listHref(BASE, sp, { open: x.id })}
        linkColumn="staffName"
        empty={
          <EmptyState
            title="No reports to review"
            description="Reports appear here when someone who reports to you submits one. Clear a filter to see more."
          />
        }
        columns={[
          { key: 'staffName', header: 'Employee' },
          { key: 'department', header: 'Department', render: (x) => x.department ?? 'Not set' },
          { key: 'reportDate', header: 'Report day', render: (x) => fmtDate(x.reportDate) },
          {
            key: 'status',
            header: 'Status',
            render: (x) => (
              <>
                <StatusBadge tone={EOD_TONES[x.status]}>{EOD_STATUS_LABELS[x.status]}</StatusBadge>
                {x.imported ? (
                  <>
                    {' '}
                    <StatusBadge tone="neutral">Imported — not sent</StatusBadge>
                  </>
                ) : null}
                {x.isSample ? (
                  <>
                    {' '}
                    <span className="el-badge-sample">SAMPLE DATA</span>
                  </>
                ) : null}
              </>
            ),
          },
          { key: 'version', header: 'Version', numeric: true, render: (x) => x.currentVersion },
          { key: 'submittedAt', header: 'Submitted', render: (x) => fmtDateTime(x.submittedAt) },
          {
            key: 'facts',
            header: 'Open / blocked at cut-off',
            render: (x) =>
              (['backlog', 'blocked'] as const)
                .map(
                  (k) =>
                    `${x.counts?.[k] ?? 'Not recorded'} ${k === 'backlog' ? 'open' : 'blocked'}`,
                )
                .join(' · '),
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={inbox.page}
        pageSize={inbox.pageSize}
        total={inbox.total}
      />
      {sp.open ? (
        <ReviewPane user={user} id={sp.open} closeHref={listHref(BASE, sp, { open: undefined })} />
      ) : null}
    </div>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:read', BASE);
  const sp = await searchParams;
  const inbox = await hasInbox(getDb(), access.user).catch(() => false);
  return (
    <Frame access={access} active="tasks-inbox">
      <PageHeader
        title="Manager inbox"
        description="End-of-day reports sent to you. Read each one, then acknowledge it or ask for a revision."
        tabs={<TasksNav user={access.user} current="inbox" inbox={inbox} />}
      />
      <Section>
        {inbox ? (
          <Inbox user={access.user} sp={sp} />
        ) : (
          <EmptyState
            title="No one reports to you"
            description="The inbox is for managers and EOD reviewers. Reporting lines are set in the Staff directory."
          />
        )}
      </Section>
    </Frame>
  );
}
