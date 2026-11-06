/**
 * My work → Approval cover (F4-10): someone who approves leave, handles requests to HR or approves
 * fee discounts names a cover and dates; the covers they hold for others are listed apart. A cover
 * without HR's own access gets the covered approver's requests from staff here (`?open=<id>`). The
 * person is always the signed-in user.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import { HR_QUEUE_TABS } from '../../domain/hr-requests';
import { istToday } from '../../domain/dates';
import { istWhen } from '../../domain/staff-tasks';
import { leaveRange } from '../../domain/leave';
import {
  COVER_KIND_LABELS,
  COVER_PAGE,
  activeCoverFor,
  coverOptions,
  myCovers,
  type CoverState as State,
} from '../../server/approval-cover';
import { hrQueue } from '../../server/hr-requests-read';
import { ActionForm } from '../../ui/action-form';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { RequestStatus } from '../hr-requests/_components/parts';
import { HrRequestModal } from '../hr/requests/request-modal';
import type { Params } from '../tasks/_components/task-common';
import '../ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approval cover' };

const API = '/ops/api/v1/approval-cover';
const STATE: Record<State, [label: string, tone: 'success' | 'info' | 'neutral' | 'warning']> = {
  active: ['Active today', 'success'],
  upcoming: ['Upcoming', 'info'],
  ended: ['Ended', 'neutral'],
  revoked: ['Revoked', 'warning'],
};

export default async function ApprovalCoverPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:module:access', COVER_PAGE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="approval-cover">
      <PageHeader
        title="Approval cover"
        description="While you are away, name someone to decide your approvals on the dates you choose. They decide on your behalf, and it is recorded so. Nobody decides their own item, and the maker of an item still never approves it."
      />
      <Section label="Loading covers…">
        <Covers user={access.user} />
      </Section>
      {can(access.user, 'ops:hr_requests:read') ? null : (
        <Section label="Loading requests…">
          <CoverQueue user={access.user} sp={sp} />
        </Section>
      )}
      {sp.open ? (
        <HrRequestModal user={access.user} sp={sp} id={sp.open} base={COVER_PAGE} />
      ) : null}
    </Frame>
  );
}

async function Covers({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => ({
    mine: await myCovers(db, user),
    people: await coverOptions(db, user),
  }));
  if (!r.ok) return r.view;
  const { mine, people } = r.data;
  const live = (s: State) => s === 'active' || s === 'upcoming';
  const stateCol = {
    key: 'state',
    header: 'Status',
    render: (c: (typeof mine.given)[number]) => (
      <StatusBadge tone={STATE[c.state][1]}>{STATE[c.state][0]}</StatusBadge>
    ),
  };
  const datesCol = {
    key: 'dates',
    header: 'Dates (IST)',
    render: (c: (typeof mine.given)[number]) => leaveRange(c.fromDate, c.toDate),
  };
  const revoke = (c: (typeof mine.given)[number], label: string, who: string) =>
    live(c.state) ? (
      <ActionForm
        action={`${API}/${c.id}/revoke`}
        submitLabel={label}
        labelSuffix={` — ${who}, ${leaveRange(c.fromDate, c.toDate)}`}
        variant="secondary"
        compact
        successText="Ended."
      />
    ) : null;
  return (
    <div className="el-stack">
      {mine.kinds.length ? (
        <Segment
          title="Name a cover"
          description={`Covers what you approve: ${mine.kinds.map((k) => COVER_KIND_LABELS[k].toLowerCase()).join(', ')}. Only one cover at a time; the dates are IST days.`}
        >
          <ActionForm
            action={API}
            submitLabel="Name cover"
            successText="Cover named. They have been told."
            resetOnSuccess
            fields={[
              {
                name: 'coverStaffId',
                label: 'Who covers for you',
                type: 'select',
                required: true,
                options: people,
                emptyHint:
                  'Nobody can be named yet: the setting "Who may be named as approval cover" lists the roles, and they need a working login.',
              },
              {
                name: 'fromDate',
                label: 'First day',
                type: 'date',
                required: true,
                defaultValue: istToday(new Date()),
              },
              { name: 'toDate', label: 'Last day', type: 'date', required: true },
              { name: 'note', label: 'Note for them (optional)', type: 'textarea' },
            ]}
          />
        </Segment>
      ) : (
        <p className="el-field-hint">
          You do not approve leave, requests to HR or fee discounts, so there is nothing for you to
          hand over.
        </p>
      )}
      {mine.kinds.length || mine.given.length ? (
        <Segment title="Covers you named">
          <RecordTable
            caption={`${mine.given.length} cover${mine.given.length === 1 ? '' : 's'}`}
            rows={mine.given}
            rowKey={(c) => c.id}
            sampleOf={(c) => c.isSample}
            empty="You have not named a cover."
            columns={[
              { key: 'coverName', header: 'Cover' },
              datesCol,
              stateCol,
              { key: 'note', header: 'Note', render: (c) => c.note ?? '' },
              { key: 'act', header: '', render: (c) => revoke(c, 'Revoke', c.coverName) },
            ]}
          />
        </Segment>
      ) : null}
      <Segment
        title="You are covering"
        description="On these days the items of the person you cover appear in your usual lists (requests from staff, leave, a student's fee tab)."
      >
        <RecordTable
          caption={`${mine.held.length} cover${mine.held.length === 1 ? '' : 's'}`}
          rows={mine.held}
          rowKey={(c) => c.id}
          sampleOf={(c) => c.isSample}
          empty="Nobody has named you as their cover."
          columns={[
            { key: 'approverName', header: 'Covering for' },
            datesCol,
            stateCol,
            { key: 'note', header: 'Note', render: (c) => c.note ?? '' },
            { key: 'act', header: '', render: (c) => revoke(c, 'Step down', c.approverName) },
          ]}
        />
      </Segment>
    </div>
  );
}

/** Requests from staff the approver you cover would see (HR's own queue page is not yours). */
async function CoverQueue({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load(async (db) =>
    (await activeCoverFor(db, user.id, 'hr_request')).length
      ? hrQueue(db, user, {
          view: 'queue',
          tab: HR_QUEUE_TABS.find((t) => t.key === sp.tab)?.key,
          page: Math.max(1, Number(sp.page) || 1),
        })
      : null,
  );
  if (!r.ok) return r.view;
  const q = r.data;
  if (!q) return null;
  return (
    <Segment
      title="Requests from staff, as cover"
      description="What the person you cover would handle today. Each step is recorded on their behalf."
    >
      <Tabs
        idBase="cover-queue"
        label="Request status"
        selected={q.tab}
        items={HR_QUEUE_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          href: listHref(COVER_PAGE, {}, { tab: t.key }),
          count: q.counts[t.key],
        }))}
      >
        <RecordTable
          caption={`${q.total} request${q.total === 1 ? '' : 's'}`}
          rows={q.rows}
          rowKey={(x) => x.id}
          rowHref={(x) => listHref(COVER_PAGE, sp, { open: x.id })}
          linkColumn="subject"
          sampleOf={(x) => x.isSample}
          empty="Nothing here."
          columns={[
            { key: 'subject', header: 'Subject' },
            { key: 'senderName', header: 'From' },
            { key: 'categoryLabel', header: 'Category' },
            {
              key: 'sent',
              header: 'Sent (IST)',
              render: (x) => (x.submittedAt ? istWhen(x.submittedAt) : 'Not recorded'),
            },
            { key: 'status', header: 'Status', render: (x) => <RequestStatus status={x.status} /> },
          ]}
        />
        <Pager
          basePath={COVER_PAGE}
          params={sp}
          page={q.page}
          pageSize={q.pageSize}
          total={q.total}
        />
      </Tabs>
    </Segment>
  );
}
