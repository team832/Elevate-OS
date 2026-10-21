import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { metric } from '@elevate/shared-contracts';
import { Alert, Card, DataTable, EmptyState, MetricStrip, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { buildAcademicDeliverySummary, getIntakeQueue, listPlans, listSessions, todayIst } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { PlanBadge, StateBadge } from '../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../ui/shell';

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

export default async function DashboardPage() {
  const access = await gate('academic:module:access', MODULE_PATHS.home);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="home">{null}</AcademicShell>;
  const db = getDb();
  const user = access.user;
  const today = todayIst();
  const window = { from: addDays(today as IsoDate, -29), to: today };
  const showSummary = can(user, 'academic:summary:read');
  const summary = showSummary ? await load(() => buildAcademicDeliverySummary(db, window)) : null;
  const plans = can(user, 'academic:courses:read') ? await load(() => listPlans(db)) : null;
  const intake = can(user, 'academic:enrolments:read') ? await load(() => getIntakeQueue(db)) : null;
  const mySessions = !showSummary ? await load(() => listSessions(db, actorFor(user), { from: today, to: today })) : null;

  const planCounts = plans?.ok
    ? Object.entries(plans.data.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {}))
    : [];

  return (
    <AcademicShell access={access} active="home">
      <PageHeader title="Academic OS" description={`Delivery from ${window.from} to ${window.to} (IST). Planned is never counted as delivered; missing is never zero.`} />
      <div className="el-stack">
        {summary ? (
          summary.ok ? (
            <Figures summary={summary.data} />
          ) : (
            <LoadError error={summary.error} />
          )
        ) : null}

        {mySessions ? (
          <Card title="Your sessions today" description="Sessions you teach. Log what you taught and take attendance from the teaching log.">
            {mySessions.ok ? (
              <DataTable compact
                rows={mySessions.data}
                rowKey={(s) => s.id}
                empty={<EmptyState title="No sessions today" description="Nothing is timetabled for you today." />}
                columns={[
                  { key: 'time', header: 'Time', render: (s) => `${s.startTime} (${s.durationMinutes} min)` },
                  { key: 'batch', header: 'Batch', render: (s) => s.batchCode },
                  { key: 'chapter', header: 'Planned chapter', render: (s) => s.chapterTitle ?? '—' },
                  { key: 'status', header: 'Status', render: (s) => <StateBadge state={s.status} /> },
                  { key: 'go', header: '', render: (s) => <a href={MODULE_PATHS.attendance(s.id)}>Attendance</a> },
                ]}
              />
            ) : (
              <LoadError error={mySessions.error} />
            )}
          </Card>
        ) : null}

        {plans ? (
          <Card title="Curriculum plan versions" description="Counts by status. Locked and provisional are plans; delivery is recorded only in class records.">
            {plans.ok ? (
              planCounts.length === 0 ? (
                <EmptyState title="No curriculum plans yet" description="Import the legacy plans (npm run db:seed) or create one under Curriculum." />
              ) : (
                <p>
                  {planCounts.map(([status, n]) => (
                    <span key={status}>
                      <PlanBadge status={status} /> {n}{' '}
                    </span>
                  ))}
                  <a href={MODULE_PATHS.curriculum}>Open curriculum</a>
                </p>
              )
            ) : (
              <LoadError error={plans.error} />
            )}
          </Card>
        ) : null}

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

        {!showSummary && !mySessions ? <Alert tone="info">The delivery summary needs academic:summary:read.</Alert> : null}
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
