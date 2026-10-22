import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewFields } from '../../src/app/reviews/review-fields';
import { ApiForm, describeDetails } from '../../src/ui/api-form';
import { AttendanceForm } from '../../src/ui/attendance-form';
import { fmtDateTime, fmtHours, Maybe, PlanBadge, StateBadge } from '../../src/ui/badges';
import { CoverageSection, FeasibilitySection } from '../../src/ui/batch-sections';
import { ConflictList } from '../../src/ui/conflicts';
import { InterventionsTable } from '../../src/ui/interventions';
import {
  CoordinatorTiles,
  DeliveryFigures,
  FigureDefinitions,
  MeetingsDay,
  TasksDay,
  TeacherHome,
} from '../../src/ui/my-day';
import { metric } from '@elevate/shared-contracts';
import { AppShell } from '@elevate/shared-ui';
import { navFor, workspaceLink } from '../../src/ui/shell';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const badge = (tone: string, text: string) =>
  `<span class="el-badge el-tone-${tone}">${text}</span>`;

describe('Academic badges and formatters', () => {
  it.each([
    [<Maybe value={null} />, badge('neutral', 'Missing')],
    [<Maybe value="" />, badge('neutral', 'Missing')],
    [<Maybe value={0} suffix="%" />, '0%'],
    [<PlanBadge status={null} />, badge('neutral', 'unknown')],
    [<PlanBadge status="provisional" prefix="dates" />, badge('warning', 'dates: provisional')],
    [<StateBadge state="in_progress" />, badge('info', 'in progress')],
    [<StateBadge state="not_assessed" />, badge('neutral', 'not assessed')],
  ])('%#: missing is "Missing" (a real 0 stays 0) and codes read as words', (node, expected) => {
    expect(html(node)).toBe(expected);
  });

  it('formats hours and IST time, with a dash for no time', () => {
    expect(fmtHours(90)).toBe('1.5 h');
    expect(fmtHours(0)).toBe('0 h');
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime('2026-10-22T04:30:00Z').replace(/\s/g, ' ')).toBe('22 Oct 2026, 10:00 am');
  });
});

describe('ApiForm', () => {
  const out = html(
    <ApiForm
      action="/academic/api/v1/batches"
      submitLabel="Create batch"
      idPrefix="b"
      fields={[
        { name: 'code', label: 'Batch code', required: true, hint: 'e.g. CLAT-26-A' },
        {
          name: 'note',
          label: 'Note',
          type: 'select',
          options: [{ value: 'x', label: '<i>X</i>' }],
        },
      ]}
    />,
  );

  it('labels every field, marks required ones and links hints', () => {
    // The red "*" comes from the shared CSS on required controls; the label text has none.
    expect(out).toContain('<label for="b-code">Batch code</label>');
    expect(out).toMatch(
      /<input[^>]*id="b-code"[^>]*required=""[^>]*aria-describedby="b-code-hint"/,
    );
    expect(out).toContain('id="b-code-hint"');
    expect(out).toContain('<label for="b-note">Note</label>');
    expect(out).toContain('<option value="">—</option>');
  });

  it('names the action on the button and escapes option text', () => {
    expect(out).toContain('>Create batch</button>');
    expect(out).toContain('&lt;i&gt;X&lt;/i&gt;');
  });

  it('error details keep only readable messages, with line and path', () => {
    expect(
      describeDetails({
        issues: [
          { path: ['sessions', 0, 'date'], message: 'Invalid date' },
          { line: 4, message: 'Unknown batch' },
        ],
        requestId: 'req-123',
        id: '0f6c',
      }),
    ).toEqual(['sessions.0.date: Invalid date', 'line 4: Unknown batch']);
    expect(describeDetails(null)).toEqual([]);
  });
});

describe('ConflictList', () => {
  it('keeps hard conflicts apart from preferences and flags unverified dates', () => {
    const out = html(
      <ConflictList
        verdict="infeasible"
        hard={[
          {
            code: 'TEACHER_CLASH',
            severity: 'hard',
            date: null,
            message: 'Double-booked',
            unverified: true,
          },
        ]}
        preferences={[]}
      />,
    );
    expect(out).toContain(
      `Result: ${badge('danger', 'infeasible')} — 1 hard conflict(s), 0 preference warning(s).`,
    );
    expect(out).toContain('Hard conflicts');
    expect(out).not.toContain('Preferences (warnings only)');
    expect(out).toContain('teacher clash');
    expect(out).toContain(badge('danger', 'date unverified'));
    expect(out).not.toMatch(/optimal/i);
  });
});

describe('Batch, support and teacher views', () => {
  it('no plan or no capacity check: says why instead of showing zeros', () => {
    const cov = html(
      <CoverageSection data={{ note: 'Coverage note.', plan: null, coverage: {} } as never} />,
    );
    expect(cov).toContain('Nothing planned');
    expect(cov).not.toContain('0 of 0');
    const feas = html(
      <FeasibilitySection
        data={{ result: null, message: 'No calendar rules for this batch.' } as never}
      />,
    );
    expect(feas).toContain('Capacity not assessed');
    expect(feas).toContain('No calendar rules for this batch.');
  });

  it('support plans: empty state says where to start; missing goal is "Not recorded"; closed plans are read-only', () => {
    const empty = html(<InterventionsTable rows={[]} canWrite />);
    expect(empty).toContain('No support plans');
    expect(empty).toContain('Open one from a student&#x27;s progress page');
    const row = {
      id: 'i1',
      studentId: 's1',
      studentName: 'Aarav Sample Student',
      trigger: 'low_attendance',
      description: 'Missed 3 classes',
      evidence: null,
      goal: null,
      action: 'Call parent',
      responsibleName: 'Sample Teacher',
      dueDate: null,
      reviewOn: null,
      status: 'closed',
      outcome: null,
    };
    const closed = html(<InterventionsTable rows={[row] as never} canWrite />);
    expect(closed).toContain('Not recorded');
    expect(closed).toContain('low attendance: Missed 3 classes');
    expect(closed).toContain('No date');
    expect(closed).not.toContain('Update plan');
    expect(
      html(<InterventionsTable rows={[{ ...row, status: 'open' }] as never} canWrite />),
    ).toContain('Save plan for Aarav Sample Student');
    expect(
      html(<InterventionsTable rows={[{ ...row, status: 'open' }] as never} canWrite={false} />),
    ).not.toContain('Update plan');
  });

  it('teacher home: sample demo students are badged and HR attendance is never claimed', () => {
    const day = {
      today: '2026-10-22',
      window: { from: '2026-10-15', to: '2026-10-22' },
      next: null,
      todays: [],
      attendanceMissing: [],
      logsMissing: [],
      demoAwaitingFeedback: [
        {
          id: 'd1',
          displayName: 'Tanisha Demo Student',
          demoDayNumber: 2,
          isSample: true,
          coreStudentId: 'c1',
          opsDemoSessionId: 'o1',
          session: { date: '2026-10-21', startTime: '10:00', batchCode: 'DEMO' },
        },
      ],
      assessmentsToMark: [],
      support: [],
      batches: [],
      draftReviews: 2,
      hrAttendance: 'Not available',
    };
    const out = html(<TeacherHome day={day as never} />);
    expect(out).toContain('Tanisha Demo Student');
    expect(out).toContain('<span class="el-badge el-badge-sample">Sample data</span>');
    expect(out).toContain(
      'Write review<span class="el-visually-hidden"> for Tanisha Demo Student</span>',
    );
    expect(out).toContain('No more classes today');
    expect(out).toContain('Marking a class delivered is not HR attendance.');
    expect(out).toContain('Student attendance not recorded (0)');
    expect(out).toContain('Your batches (0)');
    expect(out).toContain('No batch is assigned to you today');
    expect(out).toContain('2 review drafts not submitted yet</a>');
  });
});

describe('Academic navigation (brief §6)', () => {
  const as = (...roles: string[]) => ({ id: 'u1', roles }) as never;
  it.each([
    [
      'teacher',
      [
        'My day',
        'My meetings',
        'Timetable',
        'My batches',
        'Students',
        'Student attendance',
        'Teaching logs',
        'Curriculum',
        'Assessments',
        'Student reviews',
        'My tasks',
        'My EOD report',
      ],
    ],
    [
      'academic_coordinator',
      [
        'My day',
        'Timetable',
        'Batches',
        'Students',
        'Student attendance',
        'Teaching logs',
        'Curriculum',
        'Assessments',
        'Student reviews',
        'My tasks',
        'My EOD report',
        'Teachers',
        'Enrolments',
        'Enrolment intake',
        'Progress and support',
        'Reports',
        'Academic settings',
      ],
    ],
    ['marketing_manager', ['My tasks', 'My EOD report']], // own tasks only; the workspace gate keeps them out of this shell
  ])('%s sees its items in order; Coordination only with all-scope permissions', (role, labels) => {
    expect(navFor(as(role)).map((n) => n.label)).toEqual(labels);
  });

  it('renders the teacher sidebar with Tasks and EOD under /academic, never /ops', () => {
    const teacher = {
      id: 'u1',
      roles: ['teacher'],
      email: 't@example.test',
      displayName: 'Sample Teacher',
    } as never;
    const out = html(
      <AppShell
        user={teacher}
        modules={['academic']}
        current="academic"
        logoutAction="/academic/api/v1/auth/logout"
        nav={navFor(teacher)}
      >
        x
      </AppShell>,
    );
    for (const [href, label] of [
      ['/academic/meetings', 'My meetings'],
      ['/academic/tasks', 'My tasks'],
      ['/academic/tasks?tab=eod', 'My EOD report'],
    ]) {
      expect(out).toContain(
        `href="${href}"><span class="el-nav-mark" aria-hidden="true"></span><span>${label}</span>`,
      );
    }
    expect(out).not.toContain('/ops');
  });

  it('links to another workspace only for its members, as an absolute URL', () => {
    expect(workspaceLink(as('teacher'), 'ops', '/students/x')).toBeNull();
    expect(workspaceLink(as('admissions_counsellor'), 'ops', '/students/x')).toMatch(
      /^https?:\/\/[^/]+\/ops\/students\/x$/,
    );
  });
});

describe('Academic dashboards (22 Oct 2026 redesign)', () => {
  const win = { from: '2026-10-15', to: '2026-10-22' };
  const session = {
    id: 's1',
    date: '2026-10-22',
    startTime: '11:00',
    durationMinutes: 75,
    batchCode: 'CLAT-26-A',
    subjectName: 'Legal reasoning',
    sessionType: 'teaching',
    roomCode: 'R2',
    onlineLink: null,
    status: 'scheduled',
  };
  const day = {
    today: '2026-10-22',
    window: win,
    next: null,
    todays: [],
    attendanceMissing: [],
    logsMissing: [],
    demoAwaitingFeedback: [],
    assessmentsToMark: [],
    support: [],
    batches: [],
    draftReviews: 0,
    hrAttendance: 'Not available',
  };

  it('teacher hero: the next class shows its time, room and state with one primary "Open class" action', () => {
    const out = html(
      <TeacherHome
        day={
          { ...day, next: session, todays: [{ ...session, id: 's2', startTime: '14:00' }] } as never
        }
      />,
    );
    expect(out).toContain('<p class="acd-next-time">11:00</p>');
    expect(out).toContain(
      'el-button-primary" href="/academic/teaching/attendance/s1">Open class</a>',
    );
    expect(out).toContain('Room R2');
    expect(out).toContain('<ul class="acd-day"><li><span class="acd-day-time">14:00</span>');
    expect(out).not.toContain('No more classes today');
  });

  it('work tiles: no staff record is words, never 0; counts come through as figures', () => {
    const none = html(
      <>
        <TasksDay summary={null} />
        <MeetingsDay day="2026-10-22" total={null} />
      </>,
    );
    expect(none.match(/No staff record/g)).toHaveLength(3);
    expect(none).not.toMatch(/>0</);
    const ok = html(
      <TasksDay
        summary={
          {
            day: '2026-10-22',
            asOf: '2026-10-22T04:30:00Z',
            open: 3,
            overdue: 1,
            dueToday: 2,
            eod: 'draft',
          } as never
        }
      />,
    );
    expect(ok).toContain('<span class="el-stat-value">3</span>');
    expect(ok).toContain('<span class="el-stat-value">Draft</span>');
    expect(ok).toContain('1 overdue · 2 due today');
  });

  const overview = {
    today: '2026-10-22',
    week: { from: '2026-10-19', to: '2026-10-25' },
    todayFigures: {
      range: { from: '2026-10-22', to: '2026-10-22' },
      planned: 4,
      delivered: 1,
      cancelled: 0,
      notRecorded: 2,
    },
    weekFigures: {
      range: { from: '2026-10-19', to: '2026-10-25' },
      planned: 20,
      delivered: 9,
      cancelled: 1,
      notRecorded: 3,
    },
    uncovered: { range: { from: '2026-10-22', to: '2026-11-04' }, sessions: [] },
    conflicts: { range: { from: '2026-10-19', to: '2026-10-25' }, hard: 0 },
    attendanceMissing: { range: { from: '2026-10-19', to: '2026-10-22' }, count: 2 },
    logsMissing: { range: { from: '2026-10-19', to: '2026-10-22' }, count: 1 },
    awaitingBatch: 0,
    pendingMarking: 1,
    openSupport: 0,
    coverage: [],
  };

  it('coordinator tiles: today and the week as tiles; no chart without batches; a batch without a plan is "Not recorded", never 0%', () => {
    const none = html(<CoordinatorTiles o={overview as never} />);
    expect(none).toContain('<h2 class="el-section-title">Today, 22 Oct 2026</h2>');
    expect(none).toMatch(/This week, 19.{1,3}25 Oct 2026/);
    expect(none).toContain('Delivery not recorded');
    expect(none).toContain('Conflicts this week');
    expect(none).not.toContain('el-hbars');
    expect(none).toContain('No active batches');
    const coverage = [
      { batchId: 'b1', code: 'CLAT-26-A', hasPlan: true, chaptersPlanned: 10, chaptersTaught: 4 },
      { batchId: 'b2', code: 'IPMAT-27', hasPlan: false, chaptersPlanned: 0, chaptersTaught: 0 },
    ];
    const some = html(<CoordinatorTiles o={{ ...overview, coverage } as never} />);
    expect(some).toContain('class="el-hbars"');
    expect(some).toContain('<a href="/academic/batches/b1">CLAT-26-A</a>');
    expect(some).toContain('40%');
    expect(some).toContain('Not recorded');
    expect(some).not.toContain('>0%<');
  });

  it('delivery figures: missing figures are listed with their reason; programme charts only when programmes exist', () => {
    const meta = (unit: 'count' | 'percent' = 'count') => ({
      definition: 'Fixture definition.',
      window: win,
      unit,
    });
    const ok = (v: number, unit?: 'count' | 'percent') => metric.ok(v, meta(unit));
    const metrics = {
      activeStudents: ok(12),
      activeBatches: ok(2),
      classesPlanned: ok(30),
      classesDelivered: ok(20),
      classesCancelled: ok(1),
      attendanceRate: metric.missing('No attendance has been recorded.', meta('percent')),
      assessmentsPlanned: ok(3),
      assessmentsConducted: ok(1),
      studentsAtRisk: metric.missing('Rules not implemented.', meta()),
      syllabusCompletionRate: ok(35, 'percent'),
    };
    const summary = {
      window: win,
      metrics,
      programmes: [],
      extensions: {
        overall: { hoursPlanned: null, hoursDelivered: null, hoursDeliveredInWindow: 12.5 },
      },
    };
    const none = html(<DeliveryFigures summary={summary as never} />);
    expect(none).toContain('Not measured yet (4)');
    expect(none).toContain('<strong>Attendance rate:</strong> No attendance has been recorded.');
    expect(none).toContain('12.5 h');
    expect(none).not.toContain('el-hbars');
    const programmes = [
      { programmeCode: 'CLAT', metrics: { ...metrics, attendanceRate: ok(78, 'percent') } },
      { programmeCode: 'IPMAT', metrics },
    ];
    const some = html(<DeliveryFigures summary={{ ...summary, programmes } as never} />);
    expect(some).toContain('Attendance rate by programme');
    expect(some).toContain('78%');
    expect(some).toContain('Not recorded');
    expect(html(<FigureDefinitions summary={summary as never} />)).toContain(
      'How each figure is counted',
    );
  });

  it('attendance marks: the blank "not recorded" pill renders first and is the default for an unmarked student', () => {
    const row = {
      studentId: 's1',
      code: 'STU-1',
      fullName: 'Aarav Sample Student',
      status: null,
      minutesPresent: null,
      onPlacement: true,
      isSample: true,
      reviewHref: null,
    };
    const out = html(
      <AttendanceForm action="/a" bulkAction="/b" roster={[row]} demos={[]} canRecord />,
    );
    expect(out).toMatch(
      /<fieldset class="acd-marks"><legend class="el-visually-hidden">Attendance for Aarav Sample Student<\/legend><label><input type="radio" name="status-s1" checked="" value=""\/><span>not recorded<\/span><\/label><label><input type="radio" name="status-s1" value="present"\/>/,
    );
    const marked = html(
      <AttendanceForm
        action="/a"
        bulkAction="/b"
        roster={[{ ...row, status: 'late' }]}
        demos={[]}
        canRecord
      />,
    );
    expect(marked).toContain('checked="" value="late"');
    expect(marked).not.toContain('checked="" value=""');
  });
});

describe('Review form (D-058)', () => {
  it('every evidence field carries the privacy hint and the proposed 1,500-character limit; the visibility hint names the readers', () => {
    const out = html(
      <ApiForm
        action="/academic/api/v1/reviews"
        submitLabel="Submit review"
        idPrefix="review"
        fields={reviewFields()}
      />,
    );
    expect(out.match(/maxlength="1500"/gi)).toHaveLength(6); // React's static markup keeps the camel case
    expect(
      out.match(/Never family or contact details, fee remarks, personality labels/g),
    ).toHaveLength(6);
    expect(out).toMatch(
      /<select[^>]*id="review-visibility"[^>]*aria-describedby="review-visibility-hint"/,
    );
    expect(out).toContain('Business Operations feedback readers');
    expect(out).toContain('may use only strengths, areas needing support and suggested action');
  });
});
