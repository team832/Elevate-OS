import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiForm, describeDetails } from '../../src/ui/api-form';
import { fmtDateTime, fmtHours, Maybe, PlanBadge, StateBadge } from '../../src/ui/badges';
import { CoverageSection, FeasibilitySection } from '../../src/ui/batch-sections';
import { ConflictList } from '../../src/ui/conflicts';
import { InterventionsTable } from '../../src/ui/interventions';
import { TeacherHome } from '../../src/ui/my-day';
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
    expect(out).toContain('No batch is assigned to you today.');
    expect(out).toContain('2 review drafts not submitted yet</a>');
  });
});

describe('Academic navigation (brief §6)', () => {
  const as = (...roles: string[]) => ({ id: 'u1', roles }) as never;
  it.each([
    ['teacher', ['My day', 'My meetings', 'Timetable', 'My batches', 'Students', 'Student attendance', 'Teaching logs', 'Curriculum', 'Assessments', 'Student reviews', 'My tasks', 'My EOD report']],
    ['academic_coordinator', ['My day', 'Timetable', 'Batches', 'Students', 'Student attendance', 'Teaching logs', 'Curriculum', 'Assessments', 'Student reviews', 'My tasks', 'My EOD report', 'Teachers', 'Enrolments', 'Enrolment intake', 'Progress and support', 'Reports', 'Academic settings']],
    ['marketing_manager', ['My tasks', 'My EOD report']], // own tasks only; the workspace gate keeps them out of this shell
  ])('%s sees its items in order; Coordination only with all-scope permissions', (role, labels) => {
    expect(navFor(as(role)).map((n) => n.label)).toEqual(labels);
  });

  it('renders the teacher sidebar with Tasks and EOD under /academic, never /ops', () => {
    const teacher = { id: 'u1', roles: ['teacher'], email: 't@example.test', displayName: 'Sample Teacher' } as never;
    const out = html(<AppShell user={teacher} modules={['academic']} current="academic" logoutAction="/academic/api/v1/auth/logout" nav={navFor(teacher)}>x</AppShell>);
    for (const [href, label] of [['/academic/meetings', 'My meetings'], ['/academic/tasks', 'My tasks'], ['/academic/tasks?tab=eod', 'My EOD report']]) {
      expect(out).toContain(`href="${href}"><span class="el-nav-mark" aria-hidden="true"></span><span>${label}</span>`);
    }
    expect(out).not.toContain('/ops');
  });

  it('links to another workspace only for its members, as an absolute URL', () => {
    expect(workspaceLink(as('teacher'), 'ops', '/students/x')).toBeNull();
    expect(workspaceLink(as('admissions_counsellor'), 'ops', '/students/x')).toMatch(/^https?:\/\/[^/]+\/ops\/students\/x$/);
  });
});
