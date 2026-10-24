import type { Metadata } from 'next';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { followUpDaySummary, listLeads } from '@elevate/business-ops-os/leads';
import { DueWork, listTasks, taskDaySummary, taskListQuery } from '@elevate/business-ops-os/work';
import {
  Card,
  DataTable,
  EmptyState,
  SourceBadge,
  StatCard,
  StatusBadge,
} from '@elevate/shared-ui';
import { CONTENT_STATES, MODULE, formatIst, istMidnightUtc, modulePath } from '../../domain';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { myContentByState, myStaffId } from '../../server';
import { ContentStateBadge } from '../../ui/badges';
import { TaskTable } from '../../ui/my-work';
import { calendarListHref, listCalendarItems } from '../../server/calendar-queries';
import { CALENDAR_STATUS_LABELS } from '../../domain/calendar';
import { PersonalTiles } from '../../ui/overview';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My Day' };

export default async function MyDayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath('my-day')}
      active="my-day"
      title="My Day"
      description="Your tasks, calendar items, follow-ups and end-of-day report for today (IST)."
      actions={<a href={modulePath('my-attendance')}>My attendance</a>}
      searchParams={await searchParams}
    >
      {(user) => <Section load={async () => <MyDay user={user} />} />}
    </MarketingPage>
  );
}

const failed = () => 'failed' as const;
const LIST = 10;

/** One component for every marketer, filled from the signed-in person's own records. */
async function MyDay({ user }: { user: AuthenticatedUser }) {
  const db = getDb();
  const staffId = await myStaffId(db, user.id);
  const tasksOk = can(user, 'ops:tasks:read');
  const tasks = (q: Record<string, string>) =>
    staffId && tasksOk
      ? listTasks(db, user, taskListQuery.parse({ staffId, ...q }), LIST).then((r) => r.rows)
      : Promise.resolve([]);
  const leadsOk = can(user, 'ops:leads:read');
  // The last 30 days (late items) to 7 days ahead; the calendar link opens the same window.
  const window = { from: addDays(toIsoDate(), -30), to: addDays(toIsoDate(), 7) };
  const [followUps, summary, content, submitted, calendar, leads] = await Promise.all([
    leadsOk ? followUpDaySummary(db, user).catch(failed) : undefined,
    tasksOk ? taskDaySummary(db, user).catch(failed) : undefined,
    myContentByState(db, user),
    tasks({ status: 'in_review' }),
    staffId && can(user, 'marketing:calendar:read')
      ? listCalendarItems(db, {
          from: istMidnightUtc(window.from),
          to: istMidnightUtc(addDays(window.to, 1)),
          ownerStaffId: staffId,
          due: true,
        })
      : null,
    leadsOk && staffId ? listLeads(db, user) : null,
  ]);
  const toContact = leads?.filter(
    (l) =>
      l.ownerStaffId === staffId &&
      (l.flags.awaitingContact || l.flags.overdue || l.flags.dueToday),
  );
  const now = new Date();
  const states = CONTENT_STATES.filter((s) => s !== 'archived');
  return (
    <div className="el-stack">
      <section className="el-grid" aria-label="Today's figures">
        <PersonalTiles followUps={followUps} tasks={summary} />
        <StatCard
          label="My content awaiting review"
          value={content.in_review}
          href={modulePath('deliverables')}
          note={`${content.changes_requested} with changes requested`}
        />
      </section>
      {tasksOk ? (
        <>
          <DueWork user={user} base={MODULE.basePath} />
          <Card
            title="Submitted, waiting for review"
            description="Your tasks a reviewer has not decided on yet. Submitting is not approval."
          >
            <TaskTable rows={submitted} empty="No submission is waiting for review" />
          </Card>
        </>
      ) : null}
      {calendar ? (
        <Card
          title={`Calendar items due (${calendar.length})`}
          description="Calendar items you own, not yet published or cancelled, planned in the last 30 days or the next 7 (IST)."
          actions={
            <a href={calendarListHref({ ...window, owner: staffId ?? undefined, due: true })}>
              Open in the calendar
            </a>
          }
        >
          <DataTable
            compact
            rows={calendar}
            rowKey={(i) => i.id}
            empty={
              <EmptyState
                title="Nothing of yours is due"
                description="Plan an item on the Marketing Calendar, or pick up an approved idea."
              />
            }
            columns={[
              {
                key: 'when',
                header: 'Planned (IST)',
                render: (i) =>
                  i.plannedAt! < now ? (
                    <StatusBadge tone="warning">Past date · {formatIst(i.plannedAt)}</StatusBadge>
                  ) : (
                    formatIst(i.plannedAt)
                  ),
              },
              {
                key: 'title',
                header: 'Item',
                render: (i) => (
                  <>
                    <a href={modulePath(`calendar/${i.id}`)}>{i.title}</a>{' '}
                    {i.isSample ? <SourceBadge source="sample" /> : null}
                  </>
                ),
              },
              { key: 'status', header: 'Status', render: (i) => CALENDAR_STATUS_LABELS[i.status] },
            ]}
          />
        </Card>
      ) : null}
      {toContact ? (
        <Card
          title="Leads to contact"
          meta={toContact.some((l) => l.isSample) ? <SourceBadge source="sample" /> : undefined}
          description={`Your leads nobody has reached yet, or with a follow-up due today or overdue: ${toContact.length}. Showing up to ${LIST}.`}
          actions={<a href={modulePath('leads?flag=awaiting_contact')}>Awaiting first contact</a>}
        >
          <DataTable
            compact
            rows={toContact.slice(0, LIST)}
            rowKey={(l) => l.id}
            empty={
              <EmptyState
                title="No lead is waiting for you"
                description="Leads assigned to you appear here until you reach them; log each call on the lead."
              />
            }
            columns={[
              {
                key: 'lead',
                header: 'Lead',
                render: (l) => (
                  <a href={modulePath(`leads/${l.id}`)}>
                    {l.code}: {l.studentName}
                  </a>
                ),
              },
              {
                key: 'why',
                header: 'Why',
                render: (l) =>
                  [
                    l.flags.awaitingContact && 'Not reached yet',
                    l.flags.overdue && 'Follow-up overdue',
                    l.flags.dueToday && 'Follow-up due today',
                  ]
                    .filter(Boolean)
                    .join(' · '),
              },
              { key: 'received', header: 'Received (IST)', render: (l) => formatIst(l.receivedAt) },
            ]}
          />
        </Card>
      ) : null}
      <Card
        title="My content by state"
        description="Content items you created or are assigned to. Approved is not published: posts go out only through the publish step."
        actions={<a href={modulePath('deliverables')}>My deliverables</a>}
      >
        <DataTable
          compact
          rows={states}
          rowKey={(s) => s}
          columns={[
            { key: 'state', header: 'State', render: (s) => <ContentStateBadge state={s} /> },
            { key: 'n', header: 'Items', numeric: true, render: (s) => content[s] },
          ]}
        />
      </Card>
    </div>
  );
}
