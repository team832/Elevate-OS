/**
 * Overview dashboard blocks (server components, no data access): the day's figures as KPI
 * tiles and the pipeline charts. Every number comes from loadDashboard or the shared Business
 * Ops summaries; a summary that failed or has no staff record is said in words, never as 0.
 */
import type { followUpDaySummary } from '@elevate/business-ops-os/leads';
import type { taskDaySummary } from '@elevate/business-ops-os/work';
import { BarChart, Card, StatCard } from '@elevate/shared-ui';
import { CONTENT_STATES, INTEGRATION_STATUSES, formatIst, modulePath } from '../domain';
import type { loadDashboard } from '../server';
import { INTEGRATION_LABELS } from './badges';

type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
/** Figures, null without a staff record, or 'failed' when the summary could not load. */
export type FollowUpSummary = Awaited<ReturnType<typeof followUpDaySummary>> | 'failed';
export type TaskSummary = Awaited<ReturnType<typeof taskDaySummary>> | 'failed';

const words = (s: string) => s.replace('_', ' ');
const asOf = (at: Date) => `as of ${formatIst(at)}`;
const noStaff = (what: string) =>
  `No staff record is linked to your account, so your ${what} cannot be shown.`;
const missing = (label: string, note: string) => (
  <StatCard label={label} value={null} missingLabel="Not available" note={note} />
);

export function OverviewTiles({
  due,
  awaiting,
  running,
  ideas,
  quarantined,
  followUps,
  tasks,
}: {
  due: number;
  awaiting: number;
  running: number;
  ideas: number;
  quarantined: number;
  /** Omitted when the person may not read leads / tasks: the tiles are not shown. */
  followUps?: FollowUpSummary | undefined;
  tasks?: TaskSummary | undefined;
}) {
  return (
    <section className="el-grid" aria-label="Today's figures">
      <StatCard
        label="Content due this week"
        value={due}
        href={modulePath('calendar')}
        note="Scheduled for the next 7 days (IST)"
      />
      <StatCard
        label="Awaiting approval"
        value={awaiting}
        href="#awaiting"
        note="Content items in review"
      />
      <StatCard
        label="Campaigns running"
        value={running}
        href={modulePath('campaigns')}
        note="Status active"
      />
      <StatCard
        label="Ideas"
        value={ideas}
        href={modulePath('ideas')}
        note={`${quarantined} quarantined, waiting for OD-003`}
      />
      <PersonalTiles followUps={followUps} tasks={tasks} />
    </section>
  );
}

/** The signed-in person's follow-ups, tasks and EOD status (Overview and My day). */
export function PersonalTiles({
  followUps,
  tasks,
}: {
  /** Omitted when the person may not read leads / tasks: the tiles are not shown. */
  followUps?: FollowUpSummary | undefined;
  tasks?: TaskSummary | undefined;
}) {
  return (
    <>
      {followUps === undefined ? null : followUps === 'failed' || followUps === null ? (
        missing(
          'Follow-ups',
          followUps === null ? noStaff('follow-ups') : 'Follow-up counts could not be loaded.',
        )
      ) : (
        <>
          <StatCard
            label="Follow-ups due today"
            value={followUps.dueToday}
            href={modulePath('follow-ups?view=due_today')}
            note={`${followUps.upcoming} upcoming in the next ${followUps.upcomingWindowDays} days · ${asOf(followUps.asOf)}`}
          />
          <StatCard
            label="Follow-ups overdue"
            value={followUps.overdue}
            href={modulePath('follow-ups?view=overdue')}
            note="Due before today"
          />
        </>
      )}
      {tasks === undefined ? null : tasks === 'failed' || tasks === null ? (
        missing(
          'My tasks',
          tasks === null ? noStaff('tasks') : 'Your task status could not be loaded.',
        )
      ) : (
        <>
          <StatCard
            label="Open tasks"
            value={tasks.open}
            href={modulePath('tasks')}
            note={`${tasks.dueToday} due today · ${tasks.overdue} overdue · ${asOf(tasks.asOf)}`}
          />
          <StatCard
            label="EOD report"
            value={words(tasks.eod)}
            href={modulePath('tasks?tab=eod')}
            note={`For ${tasks.day}`}
          />
        </>
      )}
    </>
  );
}

/** Content items by state (bars) and accounts by integration (donut), from the same counts as the lists. */
export function PipelineCharts({
  d,
}: {
  d: Pick<
    Dashboard,
    'totalItems' | 'itemsByState' | 'legacyItemsByState' | 'accountsByIntegration'
  >;
}) {
  const legacy = CONTENT_STATES.filter((s) => d.legacyItemsByState[s]).map(
    (s) => `${words(s)} ${d.legacyItemsByState[s]}`,
  );
  return (
    <div className="mkt-panels">
      <Card
        title="Content items by state"
        description={`${d.totalItems} items.${legacy.length ? ` Imported from the legacy tracker, keeping its status: ${legacy.join(', ')}.` : ''}`}
      >
        <BarChart
          label="Content items by state"
          data={CONTENT_STATES.map((s) => ({ label: words(s), value: d.itemsByState[s] }))}
          emptyText="No content items yet."
        />
      </Card>
      <Card
        title="Accounts by integration"
        description="Integration status of each account, in words. No live publishing adapter exists (D-014): sandbox means the mock adapter only, and nothing is posted."
      >
        <BarChart
          label="Accounts by integration"
          data={INTEGRATION_STATUSES.map((s) => ({
            label: INTEGRATION_LABELS[s],
            value: d.accountsByIntegration[s],
          }))}
          emptyText="No accounts in the registry yet."
        />
      </Card>
    </div>
  );
}
