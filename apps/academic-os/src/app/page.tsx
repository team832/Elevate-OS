import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatTile, StatusBadge } from '@elevate/shared-ui';
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

function HoursTile({ label, value, note }: { label: string; value: number | null; note: string }) {
  return value === null ? (
    <div className="el-stat el-stat-missing" data-status="missing">
      <p className="el-stat-label">{label}</p>
      <p className="el-stat-value">Missing</p>
      <p className="el-stat-note">{note}</p>
    </div>
  ) : (
    <div className="el-stat" data-status="ok">
      <p className="el-stat-label">{label}</p>
      <p className="el-stat-value">{value} h</p>
      <p className="el-stat-note">{note}</p>
    </div>
  );
}

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
      <PageHeader title="Academic OS" description={`Delivery figures for ${window.from} to ${window.to} (Asia/Kolkata). Planned figures are never shown as delivered; missing data is shown as missing, not zero.`} />
      <div className="el-stack">
        {summary ? (
          summary.ok ? (
            <>
              <div className="el-grid">
                {Object.entries(summary.data.metrics).map(([key, metric]) => (
                  <StatTile key={key} label={LABELS[key] ?? key} metric={metric} />
                ))}
              </div>
              <Card title="Planned vs delivered hours" description={summary.data.extensions.note}>
                <div className="el-grid">
                  <HoursTile label="Planned hours (current plans)" value={summary.data.extensions.overall.hoursPlanned} note="Sum of planned minutes of active batches’ locked/provisional plans ÷ 60. A plan, not delivery." />
                  <HoursTile label="Delivered hours (verified, all time)" value={summary.data.extensions.overall.hoursDelivered} note="Verified class records only." />
                  <HoursTile label="Delivered hours in window" value={summary.data.extensions.overall.hoursDeliveredInWindow} note="Verified class minutes of sessions dated in the window." />
                </div>
              </Card>
            </>
          ) : (
            <LoadError error={summary.error} />
          )
        ) : null}

        {mySessions ? (
          <Card title="Your sessions today" description="Sessions you teach. Log what you taught and take attendance from the teaching log.">
            {mySessions.ok ? (
              <DataTable
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
                    <span key={status} style={{ marginRight: '0.75rem' }}>
                      <PlanBadge status={status} /> {n}
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
          <Card title="Enrolment intake" description="Requests from Business Ops (ops.admission.enrolment_requested).">
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
