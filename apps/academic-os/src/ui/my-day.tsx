/**
 * Role home views (brief §4): the teacher's "My day" and the coordinator's dashboard. Server
 * components. Figures come from the services as they are: missing is shown in words, never 0,
 * and a chart is drawn only where the service already returns a series.
 */
import type { ReactNode } from 'react';
import type { taskDaySummary } from '@elevate/business-ops-os/work';
import { metric } from '@elevate/shared-contracts';
import {
  Alert,
  BarChart,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  MetricStrip,
  StatCard,
  StatusBadge,
  fmtPercent,
  percent,
  type Datum,
} from '@elevate/shared-ui';
import type {
  buildAcademicDeliverySummary,
  coordinatorOverview,
  SessionListRow,
  teacherDay,
} from '../server';
import { MODULE_PATHS } from '../server/paths';
import { AssignmentTable } from './assignments';
import { StateBadge, fmtDateTime } from './badges';

type TeacherDay = Extract<Awaited<ReturnType<typeof teacherDay>>, { kind: 'teacher' }>;
type Overview = Awaited<ReturnType<typeof coordinatorOverview>>;
type TaskDay = Awaited<ReturnType<typeof taskDaySummary>>;
type Summary = Awaited<ReturnType<typeof buildAcademicDeliverySummary>>;

const NO_STAFF = 'No staff record';
const LINK_STAFF = 'Your sign-in is not linked to a staff record; ask an academic coordinator.';
const EOD: Record<NonNullable<TaskDay>['eod'], [word: string, note: string]> = {
  not_started: ['Not started', 'Nothing written yet.'],
  draft: ['Draft', 'Saved, not submitted.'],
  submitted: ['Submitted', 'Waiting for review.'],
  revision_requested: ['Changes requested', 'The reviewer sent it back.'],
  acknowledged: ['Acknowledged', 'Reviewed and accepted.'],
};

/** Tasks due today, overdue, awaiting HR review, and today's EOD report as tiles (shared Ops task service, D-073). No staff record is missing, never 0. */
export function TasksDay({ summary }: { summary: TaskDay }) {
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

const range = (r: { from: string; to: string }) =>
  r.from === r.to ? r.from : `${r.from} to ${r.to}`;
const DAY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "22 Oct 2026" or "19–25 Oct 2026". */
const spoken = (r: { from: string; to: string }) =>
  DAY.formatRange(new Date(`${r.from}T00:00:00Z`), new Date(`${r.to}T00:00:00Z`));
const where = (s: SessionListRow) =>
  s.roomCode ? `Room ${s.roomCode}` : s.onlineLink ? 'Online' : 'No room set';
const subject = (s: SessionListRow) => s.subjectName ?? s.sessionType.replace('_', ' ');
const delivery = (s: SessionListRow) => (
  <StateBadge state={s.status === 'held' ? 'delivered' : s.status} />
);
const timetable = (q: Record<string, string>) =>
  `${MODULE_PATHS.timetable}?${new URLSearchParams(q)}`;

function ClassList({
  rows,
  empty,
  action,
  showDate = true,
}: {
  rows: SessionListRow[];
  empty: string;
  action: (s: SessionListRow) => { href: string; label: string };
  showDate?: boolean;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="acd-day">
      {rows.map((s) => (
        <li key={s.id}>
          <span className="acd-day-time">
            {showDate ? `${s.date} ` : ''}
            {s.startTime}
          </span>
          <span>
            {s.batchCode} · {subject(s)} · {where(s)} {delivery(s)}
          </span>
          <a href={action(s).href}>{action(s).label}</a>
        </li>
      ))}
    </ul>
  );
}

/** The next class as the hero tile: time, batch and subject, room, delivery state, one primary action. */
function NextClass({ next, today }: { next: SessionListRow | null; today: string }) {
  if (!next)
    return (
      <EmptyState
        title="No more classes today"
        description="Your later classes are on the timetable."
        action={<ButtonLink href={MODULE_PATHS.timetable}>Open timetable</ButtonLink>}
      />
    );
  return (
    <section className="acd-next" aria-labelledby="acd-next-label">
      <div>
        <p id="acd-next-label" className="el-stat-label">
          Next class, {today}
        </p>
        <p className="acd-next-time">{next.startTime}</p>
      </div>
      <div>
        <p className="acd-next-title">
          {next.batchCode} · {subject(next)}
        </p>
        <p className="acd-next-meta">
          {next.durationMinutes} min · {where(next)} {delivery(next)}
        </p>
      </div>
      <div className="acd-next-actions">
        <ButtonLink variant="primary" href={MODULE_PATHS.attendance(next.id)}>
          Open class
        </ButtonLink>
        {next.onlineLink ? <a href={next.onlineLink}>Class link</a> : null}
      </div>
    </section>
  );
}

const ListLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <p>
    <a href={href}>{children}</a>
  </p>
);

/** `tiles`: the tasks, EOD and meetings tiles (null when the user holds no such permission). */
export function TeacherHome({ day, tiles = null }: { day: TeacherDay; tiles?: ReactNode }) {
  const recent = `Classes from ${range(day.window)} that have ended.`;
  return (
    <div className="el-stack">
      <NextClass next={day.next} today={day.today} />
      <Card title="Today's other classes" description={day.today}>
        <ClassList
          rows={day.todays}
          showDate={false}
          empty="No other classes today"
          action={(s) => ({ href: MODULE_PATHS.attendance(s.id), label: 'Open class' })}
        />
        <ListLink href={MODULE_PATHS.timetable}>My timetable</ListLink>
      </Card>
      <Card
        title={`Your subjects and batches (${day.assignments.length})`}
        description={`Assignments open on ${day.today}, and pending ones recorded without a batch. A pending assignment opens no students until a coordinator sets its batch.`}
      >
        <AssignmentTable rows={day.assignments} today={day.today} placed={new Map(day.batches.map((b) => [b.id as string, b.activeEnrolments]))} empty="No subject or batch is assigned to you yet; an academic coordinator assigns them" />
      </Card>
      {tiles}
      <Card
        title={`Student attendance not recorded (${day.attendanceMissing.length})`}
        description={`${recent} At least one placed student has no mark.`}
      >
        <ClassList
          rows={day.attendanceMissing}
          empty="Every ended class has a mark for each placed student"
          action={(s) => ({ href: MODULE_PATHS.attendance(s.id), label: 'Record attendance' })}
        />
        {day.attendanceMissing.length ? (
          <p>
            <a href={MODULE_PATHS.studentAttendance}>All classes needing attendance</a>
          </p>
        ) : null}
      </Card>
      <Card
        title={`Teaching logs not submitted (${day.logsMissing.length})`}
        description={`${recent} No submitted class record yet.`}
      >
        <ClassList
          rows={day.logsMissing}
          empty="All your ended classes have a submitted log"
          action={(s) => ({ href: MODULE_PATHS.teachingLog(s.id), label: 'Write log' })}
        />
        <ListLink href={MODULE_PATHS.teaching}>All teaching logs</ListLink>
      </Card>
      <Card
        title={`Demo students awaiting your feedback (${day.demoAwaitingFeedback.length})`}
        description={`${recent} Marked present or late, no review submitted by you yet. A missing review is pending, not negative.`}
      >
        <DataTable
          compact
          rows={day.demoAwaitingFeedback}
          rowKey={(d) => d.id}
          empty={<EmptyState title="No demo student is waiting for your feedback" />}
          columns={[
            {
              key: 'name',
              header: 'Demo student',
              render: (d) => (
                <>
                  {d.displayName} <StatusBadge tone="info">Day {d.demoDayNumber}</StatusBadge>{' '}
                  {d.isSample ? (
                    <span className="el-badge el-badge-sample">Sample data</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'class',
              header: 'Class',
              render: (d) => `${d.session.date} ${d.session.startTime} · ${d.session.batchCode}`,
            },
            {
              key: 'go',
              header: '',
              render: (d) => (
                <a
                  href={`${MODULE_PATHS.newReview}?coreStudentId=${d.coreStudentId}&opsDemoSessionId=${d.opsDemoSessionId}`}
                >
                  Write review<span className="el-visually-hidden"> for {d.displayName}</span>
                </a>
              ),
            },
          ]}
        />
        {day.draftReviews ? (
          <p>
            <a href={`${MODULE_PATHS.reviews}?mine=1&status=draft`}>
              {`${day.draftReviews} review draft${day.draftReviews === 1 ? '' : 's'} not submitted yet`}
            </a>
            . Drafts stay private to you until you submit them.
          </p>
        ) : null}
      </Card>
      <Card
        title={`Assessments to mark (${day.assessmentsToMark.length})`}
        description="Open now: conducted but not finalised, in batches you are assigned to."
      >
        <DataTable
          compact
          rows={day.assessmentsToMark}
          rowKey={(a) => a.id}
          empty={<EmptyState title="Nothing to mark" />}
          columns={[
            { key: 'title', header: 'Assessment', render: (a) => a.title },
            { key: 'date', header: 'Held on', render: (a) => a.scheduledDate ?? 'Not recorded' },
            {
              key: 'go',
              header: '',
              render: (a) => (
                <a href={MODULE_PATHS.marks(a.id)}>
                  Enter marks<span className="el-visually-hidden"> for {a.title}</span>
                </a>
              ),
            },
          ]}
        />
        <ListLink href={MODULE_PATHS.assessments}>All assessments</ListLink>
      </Card>
      <Card
        title={`Support follow-ups (${day.support.filter((s) => s.due).length} due)`}
        description={`Open support actions assigned to you; "due" means a due date on or before ${day.today}.`}
      >
        <DataTable
          compact
          rows={day.support}
          rowKey={(s) => s.id}
          empty={<EmptyState title="No open support actions are assigned to you" />}
          columns={[
            {
              key: 'student',
              header: 'Student',
              render: (s) => (
                <a href={MODULE_PATHS.studentProgress(s.studentId)}>{s.studentName}</a>
              ),
            },
            { key: 'action', header: 'Action', render: (s) => s.action },
            {
              key: 'due',
              header: 'Due',
              render: (s) =>
                s.dueDate ? (
                  <>
                    {s.dueDate} {s.due ? <StatusBadge tone="warning">Due</StatusBadge> : null}
                  </>
                ) : (
                  'No due date'
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

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
      `Hard timetable conflicts, ${range(o.conflicts.range)}.`,
      timetable(o.conflicts.range),
      o.conflicts.range,
    ],
    [
      'Classes missing attendance',
      o.attendanceMissing.count,
      `Ended classes ${range(o.attendanceMissing.range)} with a placed student unmarked.`,
      timetable(o.attendanceMissing.range),
      o.attendanceMissing.range,
    ],
    [
      'Classes missing a log',
      o.logsMissing.count,
      `Delivered classes ${range(o.logsMissing.range)} without a submitted log.`,
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
      description={`Scheduled ${range(o.uncovered.range)}. Someone teaching this class (planned teacher, co-teacher or substitute) is unavailable and no replacement is recorded. Academic availability records, not HR leave; nothing is reassigned automatically.`}
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
