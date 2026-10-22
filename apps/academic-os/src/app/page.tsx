import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, PageHeader } from '@elevate/shared-ui';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { listMyMeetings, taskDaySummary } from '@elevate/business-ops-os/work';
import {
  buildAcademicDeliverySummary,
  coordinatorOverview,
  getIntakeQueue,
  teacherDay,
  todayIst,
} from '../server';
import { MODULE_PATHS } from '../server/paths';
import {
  CoordinatorTiles,
  DeliveryFigures,
  FigureDefinitions,
  IntakeTiles,
  MeetingsDay,
  TasksDay,
  TeacherHome,
  UncoveredClasses,
} from '../ui/my-day';
import { AcademicShell, LoadError, actorFor, gate, load } from '../ui/shell';

export const dynamic = 'force-dynamic';

/**
 * Role home: a teacher sees My day; anyone who reads the whole timetable sees the coordinator
 * dashboard (tiles, then charts, then today's work lists, then the definitions).
 */
export default async function HomePage() {
  const access = await gate('academic:module:access', MODULE_PATHS.home);
  if (access.status !== 'allowed')
    return (
      <AcademicShell access={access} active="home">
        {null}
      </AcademicShell>
    );
  const db = getDb();
  const user = access.user;
  const actor = actorFor(user);
  const today = todayIst();
  const window = { from: addDays(today as IsoDate, -29), to: today };
  const timetableScope = scopeFor(user, 'academic:timetable:read');
  const day = timetableScope === 'own' ? await load(() => teacherDay(db, actor)) : null;
  const overview =
    timetableScope === 'all' ? await load(() => coordinatorOverview(db, actor)) : null;
  const summary = can(user, 'academic:summary:read')
    ? await load(() => buildAcademicDeliverySummary(db, window))
    : null;
  const tasks = can(user, 'ops:tasks:read') ? await load(() => taskDaySummary(db, user)) : null;
  const meetings = can(user, 'ops:appointments:read')
    ? await load(() =>
        listMyMeetings(db, user, { from: today as IsoDate, to: today as IsoDate }, 1),
      )
    : null;
  const intake = can(user, 'academic:enrolments:read')
    ? await load(() => getIntakeQueue(db))
    : null;
  const tiles = [
    tasks ? (
      tasks.ok ? (
        <TasksDay key="tasks" summary={tasks.data} />
      ) : (
        <LoadError key="tasks" error={tasks.error} />
      )
    ) : null,
    meetings ? (
      meetings.ok ? (
        <MeetingsDay key="meetings" day={today} total={meetings.data?.total ?? null} />
      ) : (
        <LoadError key="meetings" error={meetings.error} />
      )
    ) : null,
  ].filter(Boolean);
  const work = tiles.length ? <div className="el-grid">{tiles}</div> : null;
  const teacher = day?.ok && day.data.kind === 'teacher';

  return (
    <AcademicShell access={access} active="home">
      <PageHeader
        title={day ? 'My day' : 'Academic overview'}
        description={`Today is ${today} (IST). Every count names its dates; missing is never zero and planned is never delivered.`}
      />
      <div className="el-stack">
        {day ? (
          !day.ok ? (
            <LoadError error={day.error} />
          ) : day.data.kind === 'teacher' ? (
            <TeacherHome day={day.data} tiles={work} />
          ) : (
            <Alert tone="info" title="No staff record">
              Your sign-in is not linked to a staff record, so no classes can be shown. Ask an
              academic coordinator.
            </Alert>
          )
        ) : null}
        {teacher ? null : work}
        {intake ? (
          intake.ok ? (
            <IntakeTiles waiting={intake.data.waiting} problems={intake.data.problems.length} />
          ) : (
            <LoadError error={intake.error} />
          )
        ) : null}
        {overview ? (
          overview.ok ? (
            <CoordinatorTiles o={overview.data} />
          ) : (
            <LoadError error={overview.error} />
          )
        ) : null}
        {summary ? (
          summary.ok ? (
            <DeliveryFigures summary={summary.data} />
          ) : (
            <LoadError error={summary.error} />
          )
        ) : null}
        {overview?.ok ? <UncoveredClasses o={overview.data} /> : null}
        {summary?.ok ? <FigureDefinitions summary={summary.data} /> : null}
      </div>
    </AcademicShell>
  );
}
