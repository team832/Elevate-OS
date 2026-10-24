/** The coordinator's dashboard: delivery figures, exceptions, coverage, uncovered classes and intake (brief §4). */
import { metric } from '@elevate/shared-contracts';
import {
  Alert,
  BarChart,
  Card,
  DataTable,
  EmptyState,
  MetricStrip,
  StatCard,
  fmtPercent,
  percent,
  type Datum,
} from '@elevate/shared-ui';
import type { buildAcademicDeliverySummary, coordinatorOverview } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { fmtRange } from './badges';

type Overview = Awaited<ReturnType<typeof coordinatorOverview>>;
type Summary = Awaited<ReturnType<typeof buildAcademicDeliverySummary>>;

const DAY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "22 Oct 2026" or "19–25 Oct 2026". */
const spoken = (r: { from: string; to: string }) =>
  DAY.formatRange(new Date(`${r.from}T00:00:00Z`), new Date(`${r.to}T00:00:00Z`));
const timetable = (q: Record<string, string>) =>
  `${MODULE_PATHS.timetable}?${new URLSearchParams(q)}`;

/** Coordinator tiles: today and this week, the exceptions, and coverage per active batch (the one series the overview returns). */
export function CoordinatorTiles({ o }: { o: Overview }) {
  const figures = (f: Overview['todayFigures'], label: string) => {
    const title = `${label}, ${spoken(f.range)}`;
    const item = (name: string, value: number, definition: string, q: Record<string, string>) => ({
      label: name,
      metric: metric.ok(value, { definition, window: f.range, unit: 'count' }),
      note: definition,
      href: timetable({ from: f.range.from, to: f.range.to, ...q }),
    });
    return (
      <section>
        <h2 className="el-section-title">{title}</h2>
        <MetricStrip
          label={title}
          items={[
            item('Planned', f.planned, 'Scheduled or delivered classes.', {}),
            item('Delivered', f.delivered, 'Marked delivered by a teacher or coordinator.', {
              status: 'held',
            }),
            item(
              'Delivery not recorded',
              f.notRecorded,
              'Ended, still scheduled: nobody marked them delivered.',
              { status: 'scheduled', to: o.today },
            ),
            item('Cancelled', f.cancelled, 'Cancelled classes (they free their slot).', {
              status: 'cancelled',
            }),
          ]}
        />
      </section>
    );
  };
  const now = { from: o.today, to: o.today };
  const counts = [
    [
      'Conflicts this week',
      o.conflicts.hard,
      `Hard timetable conflicts, ${fmtRange(o.conflicts.range)}.`,
      timetable(o.conflicts.range),
      o.conflicts.range,
    ],
    [
      'Classes missing attendance',
      o.attendanceMissing.count,
      `Ended classes ${fmtRange(o.attendanceMissing.range)} with a placed student unmarked.`,
      timetable(o.attendanceMissing.range),
      o.attendanceMissing.range,
    ],
    [
      'Classes missing a log',
      o.logsMissing.count,
      `Delivered classes ${fmtRange(o.logsMissing.range)} without a submitted log.`,
      `${MODULE_PATHS.teaching}?${new URLSearchParams(o.logsMissing.range)}`,
      o.logsMissing.range,
    ],
    [
      'Enrolments awaiting a batch',
      o.awaitingBatch,
      `Active enrolments with no current placement, as of ${o.today}.`,
      `${MODULE_PATHS.enrolments}?view=awaiting`,
      now,
    ],
    [
      'Assessments to mark',
      o.pendingMarking,
      `Conducted, not finalised, as of ${o.today}.`,
      MODULE_PATHS.assessments,
      now,
    ],
    [
      'Open support cases',
      o.openSupport,
      `Support actions open or in progress, as of ${o.today}.`,
      MODULE_PATHS.progress,
      now,
    ],
  ] as const;
  // A batch without a plan has nothing to measure against: null, never 0%.
  const coverage: Datum[] = o.coverage.map((c) => ({
    label: c.code,
    value: c.hasPlan ? percent(c.chaptersTaught, c.chaptersPlanned) : null,
    href: MODULE_PATHS.batch(c.batchId),
  }));
  return (
    <div className="el-stack">
      {figures(o.todayFigures, 'Today')}
      {figures(o.weekFigures, 'This week')}
      <section>
        <h2 className="el-section-title">Exceptions (each states its own dates)</h2>
        <MetricStrip
          label="Exceptions (each states its own dates)"
          items={counts.map(([label, value, definition, href, window]) => ({
            label,
            metric: metric.ok(value, { definition, window, unit: 'count' }),
            note: definition,
            href,
          }))}
        />
      </section>
      <Card
        title="Curriculum coverage, active batches"
        description={`Chapters with a submitted first-teaching log, as a share of the batch's current plan, as of ${o.today}. What the batch was taught, not what students have mastered. A batch without a plan shows "Not recorded".`}
      >
        {coverage.length ? (
          <BarChart
            label="Chapters taught as a share of the plan, by batch"
            data={coverage}
            format={fmtPercent}
            max={100}
            emptyText="No active batch has a locked or provisional curriculum plan."
          />
        ) : (
          <EmptyState title="No active batches" />
        )}
      </Card>
    </div>
  );
}

/** Classes whose teacher is unavailable with no substitute recorded (today's work for the coordinator). */
export function UncoveredClasses({ o }: { o: Overview }) {
  return (
    <Card
      title={`Uncovered classes (${o.uncovered.sessions.length})`}
      description={`Scheduled ${fmtRange(o.uncovered.range)}. Someone teaching this class (planned teacher, co-teacher or substitute) is unavailable and no replacement is recorded. Academic availability records, not HR leave; nothing is reassigned automatically.`}
    >
      <DataTable
        compact
        rows={o.uncovered.sessions}
        rowKey={(s) => s.id}
        empty={<EmptyState title="No uncovered classes in this range" />}
        columns={[
          {
            key: 'when',
            header: 'Class',
            render: (s) => (
              <a href={MODULE_PATHS.attendance(s.id)}>
                <strong>
                  {s.date} {s.startTime}
                </strong>
              </a>
            ),
          },
          {
            key: 'batch',
            header: 'Batch',
            render: (s) => `${s.batchCode} · ${s.subjectName ?? ''}`,
          },
          { key: 'away', header: 'Unavailable', render: (s) => s.unavailableNames.join(', ') },
        ]}
      />
    </Card>
  );
}

/** Enrolment intake queue as tiles with links (admissions confirmed in Business Operations). */
export function IntakeTiles({ waiting, problems }: { waiting: number; problems: number }) {
  return (
    <div className="el-grid">
      <StatCard
        label="Enrolment intake: waiting"
        value={waiting}
        note="Admissions confirmed in Business Operations, not yet enrolments."
        href={MODULE_PATHS.intake}
      />
      <StatCard
        label="Enrolment intake: failed or dead"
        value={problems}
        note="Deliveries that failed; dead after five attempts."
        href={MODULE_PATHS.intake}
      />
    </div>
  );
}

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

function figuresOf(summary: Summary) {
  const hours = summary.extensions.overall;
  return [
    ...Object.entries(summary.metrics).map(([key, m]) => ({
      key,
      label: LABELS[key] ?? key,
      metric: m,
      definition: m.definition,
    })),
    ...HOURS.map(([key, label, definition]) => {
      const value = hours[key];
      const meta = { definition, window: summary.window, unit: 'hours' as const };
      return {
        key,
        label,
        definition,
        metric:
          value === null ? metric.missing('Nothing to measure yet.', meta) : metric.ok(value, meta),
      };
    }),
  ];
}

/**
 * Measured figures as tiles; figures that cannot be measured yet are listed with their reasons
 * (never drawn as 0). Per-programme charts only when the summary carries programmes.
 */
export function DeliveryFigures({ summary }: { summary: Summary }) {
  const all = figuresOf(summary);
  const missing = all.filter((f) => f.metric.status === 'missing');
  const byProgramme = (key: 'attendanceRate' | 'classesDelivered'): Datum[] =>
    summary.programmes.map((p) => ({ label: p.programmeCode, value: p.metrics[key].value }));
  const window = spoken(summary.window);
  return (
    <>
      <MetricStrip
        label="Delivery figures"
        items={all.filter((f) => f.metric.status !== 'missing')}
      />
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
      {summary.programmes.length ? (
        <div className="acd-charts">
          <Card
            title="Attendance rate by programme"
            description={`${summary.metrics.attendanceRate.definition} Held classes ${window}; a programme with no marks shows "Not recorded".`}
          >
            <BarChart
              label="Attendance rate by programme"
              data={byProgramme('attendanceRate')}
              format={fmtPercent}
              max={100}
              emptyText="No attendance has been recorded for held classes in this window."
            />
          </Card>
          <Card
            title="Classes delivered by programme"
            description={`Classes marked delivered, ${window}. A programme with no timetable shows "Not recorded".`}
          >
            <BarChart
              label="Classes delivered by programme"
              data={byProgramme('classesDelivered')}
              emptyText="No class has been marked delivered in this window."
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}

/** Every figure's definition, one click from the tiles. */
export function FigureDefinitions({ summary }: { summary: Summary }) {
  return (
    <Card title="How each figure is counted">
      <DataTable
        compact
        rows={figuresOf(summary)}
        rowKey={(f) => f.key}
        columns={[
          { key: 'label', header: 'Figure' },
          { key: 'definition', header: 'Counted as' },
        ]}
      />
    </Card>
  );
}
