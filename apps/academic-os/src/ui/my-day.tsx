/** Role home views (brief §4): teacher "My day" and the coordinator's exceptions. Server components. */
import type { ReactNode } from 'react';
import type { taskDaySummary } from '@elevate/business-ops-os/work';
import { metric } from '@elevate/shared-contracts';
import { ButtonLink, Card, DataTable, EmptyState, MetricStrip, StatusBadge } from '@elevate/shared-ui';
import type { coordinatorOverview, SessionListRow, teacherDay } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { StateBadge, fmtDateTime } from './badges';

type TeacherDay = Extract<Awaited<ReturnType<typeof teacherDay>>, { kind: 'teacher' }>;
type Overview = Awaited<ReturnType<typeof coordinatorOverview>>;
type TaskDay = Awaited<ReturnType<typeof taskDaySummary>>;

const EOD: Record<NonNullable<TaskDay>['eod'], [string, 'neutral' | 'warning' | 'success']> = {
  not_started: ['Not started', 'neutral'],
  draft: ['Draft, not submitted', 'warning'],
  submitted: ['Submitted', 'success'],
  revision_requested: ['Changes requested', 'warning'],
  acknowledged: ['Acknowledged', 'success'],
};

/** Open tasks and today's EOD report state (shared Ops task service, D-073). Counts are server aggregates. */
export function TasksDay({ summary }: { summary: TaskDay }) {
  if (!summary) {
    return <Card title="Tasks and EOD"><p>No staff record linked to your account; ask an academic coordinator.</p></Card>;
  }
  const [eod, tone] = EOD[summary.eod];
  return (
    <Card title="Tasks and EOD" description={`Open tasks assigned to you, and your end-of-day report for ${summary.day}. As of ${fmtDateTime(summary.asOf)}.`}>
      <p>
        {`${summary.open} open · ${summary.overdue} overdue · ${summary.dueToday} due today. `}
        <a href={MODULE_PATHS.tasks}>Open my tasks</a>
      </p>
      <p>
        {'Today’s EOD report: '}<StatusBadge tone={tone}>{eod}</StatusBadge> <a href={`${MODULE_PATHS.tasks}?tab=eod`}>Open EOD report</a>
      </p>
    </Card>
  );
}

/** Count of the caller's meetings starting today (shared Ops service, D-073); null = no staff record. */
export function MeetingsDay({ day, total }: { day: string; total: number | null }) {
  return (
    <Card title="Meetings today" description={`Meetings and events you take part in that start on ${day} (IST), any status.`}>
      <p>
        {total === null ? 'No staff record linked to your account; ask an academic coordinator. ' : `${total} today. `}
        <a href={MODULE_PATHS.meetings}>Open my meetings</a>
      </p>
    </Card>
  );
}

const range = (r: { from: string; to: string }) => (r.from === r.to ? r.from : `${r.from} to ${r.to}`);
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "22 Oct 2026" or "19–25 Oct 2026". */
const spoken = (r: { from: string; to: string }) => DAY.formatRange(new Date(`${r.from}T00:00:00Z`), new Date(`${r.to}T00:00:00Z`));
const where = (s: SessionListRow) => s.roomCode ? `Room ${s.roomCode}` : s.onlineLink ? 'Online' : 'No room set';
const delivery = (s: SessionListRow) => <StateBadge state={s.status === 'held' ? 'delivered' : s.status} />;
const timetable = (q: Record<string, string>) => `${MODULE_PATHS.timetable}?${new URLSearchParams(q)}`;

function ClassList({ rows, empty, action, showDate = true }: { rows: SessionListRow[]; empty: string; action: (s: SessionListRow) => { href: string; label: string }; showDate?: boolean }) {
  if (rows.length === 0) return <p>{empty}</p>;
  return (
    <ul className="acd-day">
      {rows.map((s) => (
        <li key={s.id}>
          <span>
            {showDate ? `${s.date} ` : ''}
            <strong>{s.startTime}</strong>
          </span>
          <span>
            {s.batchCode} · {s.subjectName ?? s.sessionType.replace('_', ' ')} · {where(s)} {delivery(s)}
          </span>
          <a href={action(s).href}>{action(s).label}</a>
        </li>
      ))}
    </ul>
  );
}

/** `tasks`: the Tasks and EOD block (null when the user holds no task permission). */
export function TeacherHome({ day, tasks = null }: { day: TeacherDay; tasks?: ReactNode }) {
  const recent = `Classes from ${range(day.window)} that have ended.`;
  return (
    <div className="el-stack">
      <Card title="Next class" description={`Today, ${day.today}`}>
        {day.next ? (
          <div className="acd-next">
            <strong>
              {day.next.startTime} · {day.next.batchCode} · {day.next.subjectName ?? day.next.sessionType.replace('_', ' ')}
            </strong>
            <span>
              {day.next.durationMinutes} min · {where(day.next)} · {delivery(day.next)}
            </span>
            <div>
              <ButtonLink href={MODULE_PATHS.attendance(day.next.id)}>Open class</ButtonLink> {day.next.onlineLink ? <a href={day.next.onlineLink}>Class link</a> : null}
            </div>
          </div>
        ) : (
          <EmptyState title="No more classes today" description="Your later classes are on the timetable." />
        )}
      </Card>
      <Card title="Today's other classes" description={day.today}>
        <ClassList rows={day.todays} showDate={false} empty="No other classes today." action={(s) => ({ href: MODULE_PATHS.attendance(s.id), label: 'Open class' })} />
      </Card>
      <Card title={`Your batches (${day.batches.length})`} description={`Batches with a teaching assignment of yours open on ${day.today}.`}>
        <DataTable
          compact
          rows={day.batches}
          rowKey={(b) => b.id}
          empty={<p>No batch is assigned to you today. An academic coordinator assigns teachers to batches.</p>}
          columns={[
            { key: 'code', header: 'Batch', render: (b) => <a href={MODULE_PATHS.batch(b.id)}><strong>{b.code}</strong></a> },
            { key: 'course', header: 'Course', render: (b) => `${b.programmeCode} · ${b.courseName}` },
            { key: 'placed', header: 'Students placed', numeric: true, render: (b) => b.activeEnrolments },
          ]}
        />
      </Card>
      {tasks}
      <Card title={`Student attendance not recorded (${day.attendanceMissing.length})`} description={`${recent} At least one placed student has no mark.`}>
        <ClassList rows={day.attendanceMissing} empty="Every ended class has a mark for each placed student." action={(s) => ({ href: MODULE_PATHS.attendance(s.id), label: 'Record attendance' })} />
        {day.attendanceMissing.length ? <p><a href={MODULE_PATHS.studentAttendance}>All classes needing attendance</a></p> : null}
      </Card>
      <Card title={`Teaching logs not submitted (${day.logsMissing.length})`} description={`${recent} No submitted class record yet.`}>
        <ClassList rows={day.logsMissing} empty="All your ended classes have a submitted log." action={(s) => ({ href: MODULE_PATHS.teachingLog(s.id), label: 'Write log' })} />
      </Card>
      <Card title={`Demo students awaiting your feedback (${day.demoAwaitingFeedback.length})`} description={`${recent} Marked present or late, no review submitted by you yet. A missing review is pending, not negative.`}>
        <DataTable
          compact
          rows={day.demoAwaitingFeedback}
          rowKey={(d) => d.id}
          empty={<p>No demo student is waiting for your feedback.</p>}
          columns={[
            { key: 'name', header: 'Demo student', render: (d) => <>{d.displayName} <StatusBadge tone="info">Day {d.demoDayNumber}</StatusBadge> {d.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}</> },
            { key: 'class', header: 'Class', render: (d) => `${d.session.date} ${d.session.startTime} · ${d.session.batchCode}` },
            { key: 'go', header: '', render: (d) => <a href={`${MODULE_PATHS.newReview}?coreStudentId=${d.coreStudentId}&opsDemoSessionId=${d.opsDemoSessionId}`}>Write review<span className="el-visually-hidden"> for {d.displayName}</span></a> },
          ]}
        />
        {day.draftReviews ? <p><a href={`${MODULE_PATHS.reviews}?mine=1&status=draft`}>{`${day.draftReviews} review draft${day.draftReviews === 1 ? '' : 's'} not submitted yet`}</a>. Drafts stay private to you until you submit them.</p> : null}
      </Card>
      <Card title={`Assessments to mark (${day.assessmentsToMark.length})`} description="Open now: conducted but not finalised, in batches you are assigned to.">
        <DataTable
          compact
          rows={day.assessmentsToMark}
          rowKey={(a) => a.id}
          empty={<p>Nothing to mark.</p>}
          columns={[
            { key: 'title', header: 'Assessment', render: (a) => a.title },
            { key: 'date', header: 'Held on', render: (a) => a.scheduledDate ?? 'Not recorded' },
            { key: 'go', header: '', render: (a) => <a href={MODULE_PATHS.marks(a.id)}>Enter marks<span className="el-visually-hidden"> for {a.title}</span></a> },
          ]}
        />
      </Card>
      <Card title={`Support follow-ups (${day.support.filter((s) => s.due).length} due)`} description={`Open support actions assigned to you; "due" means a due date on or before ${day.today}.`}>
        <DataTable
          compact
          rows={day.support}
          rowKey={(s) => s.id}
          empty={<p>No open support actions are assigned to you.</p>}
          columns={[
            { key: 'student', header: 'Student', render: (s) => <a href={MODULE_PATHS.studentProgress(s.studentId)}>{s.studentName}</a> },
            { key: 'action', header: 'Action', render: (s) => s.action },
            { key: 'due', header: 'Due', render: (s) => (s.dueDate ? <>{s.dueDate} {s.due ? <StatusBadge tone="warning">Due</StatusBadge> : null}</> : 'No due date') },
          ]}
        />
      </Card>
      <Card title="Your HR attendance">
        <p>
          <StatusBadge tone="neutral">{day.hrAttendance}</StatusBadge> Elevate OS has no HR attendance source yet, so nothing here says whether you were present or on leave. Marking a class delivered is not HR attendance.
        </p>
      </Card>
    </div>
  );
}

export function CoordinatorHome({ o }: { o: Overview }) {
  const strip = (f: Overview['todayFigures'], label: string) => {
    const window = { ...f.range };
    const item = (name: string, value: number, definition: string, q: Record<string, string>) => ({ label: name, metric: metric.ok(value, { definition, window, unit: 'count' }), note: definition, href: timetable({ from: f.range.from, to: f.range.to, ...q }) });
    return (
      <Card title={`${label}, ${spoken(f.range)}`}>
        <MetricStrip
          label={`${label}, ${spoken(f.range)}`}
          items={[
            item('Planned', f.planned, 'Scheduled or delivered classes.', {}),
            item('Delivered', f.delivered, 'Marked delivered by a teacher or coordinator.', { status: 'held' }),
            item('Delivery not recorded', f.notRecorded, 'Ended, still scheduled: nobody marked them delivered.', { status: 'scheduled', to: o.today }),
            item('Cancelled', f.cancelled, 'Cancelled classes (they free their slot).', { status: 'cancelled' }),
          ]}
        />
      </Card>
    );
  };
  const now = { from: o.today, to: o.today };
  const counts = [
    ['Conflicts this week', o.conflicts.hard, `Hard timetable conflicts, ${range(o.conflicts.range)}.`, timetable({ from: o.conflicts.range.from, to: o.conflicts.range.to }), o.conflicts.range],
    ['Classes missing attendance', o.attendanceMissing.count, `Ended classes ${range(o.attendanceMissing.range)} with a placed student unmarked.`, timetable({ from: o.attendanceMissing.range.from, to: o.attendanceMissing.range.to }), o.attendanceMissing.range],
    ['Classes missing a log', o.logsMissing.count, `Delivered classes ${range(o.logsMissing.range)} without a submitted log.`, `${MODULE_PATHS.teaching}?${new URLSearchParams(o.logsMissing.range)}`, o.logsMissing.range],
    ['Enrolments awaiting a batch', o.awaitingBatch, `Active enrolments with no current placement, as of ${o.today}.`, `${MODULE_PATHS.enrolments}?view=awaiting`, now],
    ['Assessments to mark', o.pendingMarking, `Conducted, not finalised, as of ${o.today}.`, MODULE_PATHS.assessments, now],
    ['Open support cases', o.openSupport, `Support actions open or in progress, as of ${o.today}.`, MODULE_PATHS.progress, now],
  ] as const;
  return (
    <div className="el-stack">
      {strip(o.todayFigures, 'Today')}
      {strip(o.weekFigures, 'This week')}
      <MetricStrip
        label="Exceptions (each states its own dates)"
        items={counts.map(([label, value, definition, href, window]) => ({ label, metric: metric.ok(value, { definition, window, unit: 'count' }), note: definition, href }))}
      />
      <Card title="Curriculum coverage, active batches" description={`Chapters with a submitted first-teaching log against the batch's current plan, as of ${o.today}. What the batch was taught, not what students have mastered.`}>
        <DataTable
          compact
          rows={o.coverage}
          rowKey={(c) => c.batchId}
          empty={<p>No active batches.</p>}
          columns={[
            { key: 'batch', header: 'Batch', render: (c) => <a href={MODULE_PATHS.batch(c.batchId)}><strong>{c.code}</strong></a> },
            { key: 'taught', header: 'Chapters taught / planned', render: (c) => (c.hasPlan ? `${c.chaptersTaught} / ${c.chaptersPlanned}` : 'No plan applies: nothing is planned') },
          ]}
        />
      </Card>
      <Card title={`Uncovered classes (${o.uncovered.sessions.length})`} description={`Scheduled ${range(o.uncovered.range)}. Someone teaching this class (planned teacher, co-teacher or substitute) is unavailable and no replacement is recorded. Academic availability records, not HR leave; nothing is reassigned automatically.`}>
        <DataTable
          compact
          rows={o.uncovered.sessions}
          rowKey={(s) => s.id}
          empty={<p>No uncovered classes in this range.</p>}
          columns={[
            { key: 'when', header: 'Class', render: (s) => <a href={MODULE_PATHS.attendance(s.id)}><strong>{s.date} {s.startTime}</strong></a> },
            { key: 'batch', header: 'Batch', render: (s) => `${s.batchCode} · ${s.subjectName ?? ''}` },
            { key: 'away', header: 'Unavailable', render: (s) => s.unavailableNames.join(', ') },
          ]}
        />
      </Card>
    </div>
  );
}
