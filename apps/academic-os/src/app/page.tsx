import { can, scopeFor } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { metric } from '@elevate/shared-contracts';
import { Alert, Card, DataTable, MetricStrip, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { buildAcademicDeliverySummary, coordinatorOverview, getIntakeQueue, teacherDay, todayIst } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { CoordinatorHome, TeacherHome } from '../ui/my-day';
import { AcademicShell, LoadError, actorFor, gate, load } from '../ui/shell';
import '../ui/workspace.css';

export const dynamic = 'force-dynamic';

const LABELS: Record<string, string> = {
  activeStudents: 'Active students',
  activeBatches: 'Active batches',
  classesPlanned: 'Classes on the timetable',
  classesDelivered: 'Classes delivered (verified)',
  classesCancelled: 'Classes cancelled',
  attendanceRate: 'Attendance rate',
  assessmentsPlanned: 'Assessments scheduled',
  assessmentsConducted: 'Assessments finalised',
  studentsAtRisk: 'Students at risk',
  syllabusCompletionRate: 'Syllabus completion (verified)',
};

/** Planned vs delivered hours (outside the summary contract; null = not measured). */
const HOURS = [
  ['hoursPlanned', 'Planned hours', 'Current locked or provisional plans. A plan, not delivery.'],
  ['hoursDelivered', 'Delivered hours', 'Verified class records, all time.'],
  ['hoursDeliveredInWindow', 'Delivered hours, 30 days', 'Verified class records in the window.'],
] as const;

/** Role home: a teacher sees My day; anyone who reads the whole timetable sees the coordinator's exceptions. */
export default async function HomePage() {
  const access = await gate('academic:module:access', MODULE_PATHS.home);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="home">{null}</AcademicShell>;
  const db = getDb();
  const user = access.user;
  const actor = actorFor(user);
  const today = todayIst();
  const window = { from: addDays(today as IsoDate, -29), to: today };
  const timetableScope = scopeFor(user, 'academic:timetable:read');
  const day = timetableScope === 'own' ? await load(() => teacherDay(db, actor)) : null;
  const overview = timetableScope === 'all' ? await load(() => coordinatorOverview(db, actor)) : null;
  const summary = can(user, 'academic:summary:read') ? await load(() => buildAcademicDeliverySummary(db, window)) : null;
  const intake = can(user, 'academic:enrolments:read') ? await load(() => getIntakeQueue(db)) : null;

  return (
    <AcademicShell access={access} active="home">
      <PageHeader title={day ? 'My day' : 'Academic overview'} description={`Today is ${today} (IST). Every count names its dates; missing is never zero and planned is never delivered.`} />
      <div className="el-stack">
        {day ? (
          !day.ok ? <LoadError error={day.error} /> : day.data.kind === 'teacher' ? <TeacherHome day={day.data} /> : <Alert tone="info" title="No staff record">Your sign-in is not linked to a staff record, so no classes can be shown. Ask an academic coordinator.</Alert>
        ) : null}
        {overview ? overview.ok ? <CoordinatorHome o={overview.data} /> : <LoadError error={overview.error} /> : null}
        {intake ? (
          <Card title="Enrolment intake" description="Admissions confirmed in Business Operations, waiting to become enrolments.">
            {intake.ok ? (
              <p>
                <StatusBadge tone={intake.data.waiting > 0 ? 'warning' : 'neutral'}>{intake.data.waiting} waiting</StatusBadge>{' '}
                <StatusBadge tone={intake.data.problems.length > 0 ? 'danger' : 'neutral'}>{intake.data.problems.length} failed or dead</StatusBadge>{' '}
                <a href={MODULE_PATHS.intake}>Open intake queue</a>
              </p>
            ) : (
              <LoadError error={intake.error} />
            )}
          </Card>
        ) : null}
        {summary ? summary.ok ? <Figures summary={summary.data} /> : <LoadError error={summary.error} /> : null}
      </div>
    </AcademicShell>
  );
}

/**
 * Measured figures in one strip; figures that cannot be measured yet are listed together
 * with their reasons (never drawn as 0), and every definition stays one click away.
 */
function Figures({ summary }: { summary: Awaited<ReturnType<typeof buildAcademicDeliverySummary>> }) {
  const hours = summary.extensions.overall;
  const all = [
    ...Object.entries(summary.metrics).map(([key, m]) => ({ key, label: LABELS[key] ?? key, metric: m, definition: m.definition })),
    ...HOURS.map(([key, label, definition]) => {
      const value = hours[key];
      const meta = { definition, window: summary.window, unit: 'hours' as const };
      return { key, label, definition, metric: value === null ? metric.missing('Nothing to measure yet.', meta) : metric.ok(value, meta) };
    }),
  ];
  const missing = all.filter((f) => f.metric.status === 'missing');
  return (
    <>
      <MetricStrip label="Delivery figures" items={all.filter((f) => f.metric.status !== 'missing')} />
      {missing.length ? (
        <Alert tone="info" title={`Not measured yet (${missing.length})`}>
          <ul>
            {missing.map((f) => (
              <li key={f.key}>
                <strong>{f.label}:</strong> {f.metric.status === 'missing' ? f.metric.reason : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card title="How each figure is counted">
        <DataTable compact
          rows={all}
          rowKey={(f) => f.key}
          columns={[
            { key: 'label', header: 'Figure' },
            { key: 'definition', header: 'Counted as' },
          ]}
        />
      </Card>
    </>
  );
}
