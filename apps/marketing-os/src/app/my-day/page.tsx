import type { Metadata } from 'next';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { followUpDaySummary } from '@elevate/business-ops-os/leads';
import { listTasks, taskDaySummary, taskListQuery } from '@elevate/business-ops-os/work';
import { Card, DataTable, StatCard } from '@elevate/shared-ui';
import { CONTENT_STATES, modulePath } from '../../domain';
import { myContentByState, myStaffId } from '../../server';
import { ContentStateBadge } from '../../ui/badges';
import { TaskTable } from '../../ui/my-work';
import { PersonalTiles } from '../../ui/overview';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My day' };

export default async function MyDayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath('my-day')}
      active="my-day"
      title="My day"
      description="Your tasks, content, follow-ups and end-of-day report for today (IST)."
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
  const [followUps, summary, content, overdue, today, submitted] = await Promise.all([
    can(user, 'ops:leads:read') ? followUpDaySummary(db, user).catch(failed) : undefined,
    tasksOk ? taskDaySummary(db, user).catch(failed) : undefined,
    myContentByState(db, user),
    tasks({ due: 'overdue' }),
    tasks({ due: 'today' }),
    tasks({ status: 'in_review' }),
  ]);
  // A task due today and already late is in both lists; show it once.
  const due = [...new Map([...overdue, ...today].map((t) => [t.id, t])).values()];
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
          <Card
            title="Tasks overdue or due today"
            description="Open tasks past their deadline, and tasks due today (IST)."
            actions={<a href={modulePath('tasks')}>All my tasks</a>}
          >
            <TaskTable rows={due} empty="Nothing overdue or due today" />
          </Card>
          <Card
            title="Submitted, waiting for review"
            description="Your tasks a reviewer has not decided on yet. Submitting is not approval."
          >
            <TaskTable rows={submitted} empty="No submission is waiting for review" />
          </Card>
        </>
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
