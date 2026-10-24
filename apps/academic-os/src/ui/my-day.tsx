/**
 * Role home views (brief §4). This file keeps the work tiles both roles share; the teacher's "My day"
 * is in teacher-home.tsx and the coordinator's dashboard in coordinator-home.tsx (re-exported here).
 * Server components: missing is shown in words, never 0.
 */
import { STANDING_LABELS, type myReports, type taskDaySummary } from '@elevate/business-ops-os/work';
import { StatCard } from '@elevate/shared-ui';
import { MODULE_PATHS } from '../server/paths';
import { fmtDateTime } from './badges';

export * from './coordinator-home';
export * from './teacher-home';

type TaskDay = Awaited<ReturnType<typeof taskDaySummary>>;
type Reports = Awaited<ReturnType<typeof myReports>>;

const NO_STAFF = 'No staff record';
const LINK_STAFF = 'Your sign-in is not linked to a staff record; ask an academic coordinator.';
const EOD: Record<NonNullable<TaskDay>['eod'], [word: string, note: string]> = {
  not_started: ['Not started', 'Nothing written yet.'],
  draft: ['Draft', 'Saved, not submitted.'],
  submitted: ['Submitted', 'Waiting for review.'],
  revision_requested: ['Changes requested', 'The reviewer sent it back.'],
  acknowledged: ['Acknowledged', 'Reviewed and accepted.'],
};

const REPORT_TILES = [['week', 'This week’s report'], ['month', 'This month’s report']] as const;
const standing = (v: NonNullable<Reports>['recent'][number] | undefined) =>
  v ? `${STANDING_LABELS[v.standing]}${v.late ? ' (late)' : ''}` : null;

/** Tasks due today, overdue, awaiting HR review, today's EOD report and this week's and month's work reports as tiles (shared Ops task service, D-073). No staff record is missing, never 0. */
export function TasksDay({ summary, week, month }: { summary: TaskDay; week: Reports; month: Reports }) {
  const [eod, eodNote] = summary ? EOD[summary.eod] : [null, LINK_STAFF];
  const asOf = summary ? `As of ${fmtDateTime(summary.asOf)}; ${summary.open} open in all.` : LINK_STAFF;
  return (
    <>
      <StatCard label="Tasks due today" value={summary?.dueToday ?? null} missingLabel={NO_STAFF} note={asOf} href={`${MODULE_PATHS.tasks}?due=today`} />
      <StatCard label="Overdue tasks" value={summary?.overdue ?? null} missingLabel={NO_STAFF} note="Open tasks past their deadline. Submitted work is not overdue." href={`${MODULE_PATHS.tasks}?due=overdue`} />
      <StatCard
        label="Work awaiting HR review"
        value={summary?.submitted ?? null}
        missingLabel={NO_STAFF}
        note={summary ? 'Your tasks you submitted that a reviewer has not decided yet.' : LINK_STAFF}
        href={`${MODULE_PATHS.tasks}?status=in_review`}
      />
      <StatCard label={`EOD report, ${summary?.day ?? 'today'}`} value={eod} missingLabel={NO_STAFF} note={eodNote} href={`${MODULE_PATHS.tasks}?tab=eod`} />
      {REPORT_TILES.map(([kind, label]) => {
        const [now, last] = (kind === 'week' ? week : month)?.recent ?? [];
        return (
          <StatCard key={kind} label={label} value={standing(now)} missingLabel={NO_STAFF} note={last ? `${now!.label}. ${last.label}: ${standing(last)}.` : LINK_STAFF} href={`${MODULE_PATHS.myReports}?kind=${kind}`} />
        );
      })}
    </>
  );
}

/** Count of the caller's meetings starting today (shared Ops service, D-073); null = no staff record. */
export function MeetingsDay({ day, total }: { day: string; total: number | null }) {
  return (
    <StatCard
      label="Meetings today"
      value={total}
      missingLabel={NO_STAFF}
      note={
        total === null
          ? LINK_STAFF
          : `Meetings and events you take part in that start on ${day} (IST), any status.`
      }
      href={MODULE_PATHS.meetings}
    />
  );
}
