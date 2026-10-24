/** The teacher's "My day" (brief §16): next class, students, work lists and assessment counts, each linked to its detail. */
import type { ReactNode } from 'react';
import { ButtonLink, Card, DataTable, EmptyState, StatCard, StatusBadge } from '@elevate/shared-ui';
import type { SessionListRow, teacherDay } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { AssignmentTable } from './assignments';
import { StateBadge, fmtRange } from './badges';

type TeacherDay = Extract<Awaited<ReturnType<typeof teacherDay>>, { kind: 'teacher' }>;

const where = (s: SessionListRow) =>
  s.roomCode ? `Room ${s.roomCode}` : s.onlineLink ? 'Online' : 'No room set';
const subject = (s: SessionListRow) => s.subjectName ?? s.sessionType.replace('_', ' ');
const delivery = (s: SessionListRow) => (
  <StateBadge state={s.status === 'held' ? 'delivered' : s.status} />
);

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

/** Brief §21: how many assessments are assigned, completed, awaiting marking and published (same rows as the lists below and Ops' teacher page). */
function AssessmentCounts({ day }: { day: TeacherDay }) {
  const c = day.assessmentCounts; // null = not available, never zeros
  const tiles = [
    [
      'Assessments assigned',
      c?.assigned ?? null,
      'Not cancelled, in your batches and subjects, with you responsible, evaluator, or neither named.',
    ],
    ['Completed', c?.completed ?? null, 'Of those, conducted or finalised.'],
    [
      'Awaiting marking',
      c?.awaitingMarking ?? null,
      'Held, with a student unmarked or a score not verified.',
    ],
    ['Results published', c?.published ?? null, 'Final or provisional results released.'],
  ] as const;
  return (
    <section aria-labelledby="acd-assessments">
      <h2 id="acd-assessments" className="el-section-title">
        Your assessments, all dates
      </h2>
      <div className="el-grid">
        {tiles.map(([label, value, note]) => (
          <StatCard
            key={label}
            label={label}
            value={value}
            missingLabel="Not available"
            note={c ? note : 'No subject and batch assigned to you today, so nothing is counted.'}
            href={MODULE_PATHS.assessments}
          />
        ))}
      </div>
    </section>
  );
}

function AssessmentList({
  title,
  description,
  rows,
  empty,
  action,
  count,
}: {
  title: string;
  description: string;
  rows: TeacherDay['assessmentsToMark'];
  empty: string;
  action: string;
  count?: (a: TeacherDay['assessmentsToMark'][number]) => string;
}) {
  return (
    <Card title={title} description={description}>
      <DataTable
        compact
        rows={rows}
        rowKey={(a) => a.id}
        empty={
          <EmptyState
            title={empty}
            description="Assessments of your batches are listed under All assessments."
          />
        }
        columns={[
          {
            key: 'title',
            header: 'Assessment',
            render: (a) =>
              `${a.title} · ${a.batchCode}${a.subjectName ? ` · ${a.subjectName}` : ''}`,
          },
          { key: 'date', header: 'Date', render: (a) => a.scheduledDate ?? 'Not recorded' },
          ...(count ? [{ key: 'n', header: 'Scores', render: count }] : []),
          {
            key: 'go',
            header: '',
            render: (a) => (
              <a href={MODULE_PATHS.marks(a.id)}>
                {action}
                <span className="el-visually-hidden"> for {a.title}</span>
              </a>
            ),
          },
        ]}
      />
      <ListLink href={MODULE_PATHS.assessments}>All assessments</ListLink>
    </Card>
  );
}

/** `tiles`: the tasks, EOD and meetings tiles (null when the user holds no such permission). */
export function TeacherHome({ day, tiles = null }: { day: TeacherDay; tiles?: ReactNode }) {
  const recent = `Classes from ${fmtRange(day.window)} that have ended.`;
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
        <AssignmentTable
          rows={day.assignments}
          today={day.today}
          placed={new Map(day.batches.map((b) => [b.id as string, b.activeEnrolments]))}
          empty="No subject or batch is assigned to you yet; an academic coordinator assigns them"
        />
      </Card>
      <Card
        title={`Your students (${day.students.length})`}
        description="Placed today in a batch you teach. Names and student codes only; contact and family details stay with the coordinator."
      >
        {day.students.length ? (
          <ul className="acd-day">
            {day.students.map((s) => (
              <li key={s.id}>
                <span className="acd-day-time">{s.code}</span>
                <a href={MODULE_PATHS.student(s.id)}>{s.fullName}</a>
                {s.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No students placed in your batches today"
            description="A coordinator places students in batches; they appear here once placed."
          />
        )}
      </Card>
      {tiles}
      <AssessmentCounts day={day} />
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
      <AssessmentList
        title={`Assessments to mark (${day.assessmentsToMark.length})`}
        description="Held tests you mark (as evaluator, or as responsible teacher when no evaluator is named) with a student unmarked or a score not yet verified."
        rows={day.assessmentsToMark}
        empty="Nothing to mark"
        action="Enter marks"
      />
      <AssessmentList
        title={`Results awaiting review (${day.resultsToReview.length})`}
        description="Scores imported from a score sheet that nobody has verified yet. Check each against the paper before it counts."
        rows={day.resultsToReview}
        empty="No imported scores are waiting for you"
        action="Review scores"
        count={(a) => `${a.awaitingReview} to verify`}
      />
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
