import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthenticatedUser } from '@elevate/authentication';
import { admissionsFunnel } from '../../src/domain/admissions-funnel';
import { buildEodFacts, type EodFacts } from '../../src/domain/eod';
import { fmtDate, fmtDateTime, fmtMonth, fmtPaise } from '../../src/ui/format';
import { AdmissionsNav } from '../../src/ui/admissions-nav';
import { RecordJourney } from '../../src/app/admissions/_components/journey';
import {
  ApplicationMeta,
  PaperAnswers,
  type ApplicationView,
} from '../../src/app/admissions/applications/_components/application-detail';
import {
  ConversionBreakdown,
  FunnelTable,
} from '../../src/app/reports/_components/admissions-charts';
import { AcademicEvidenceView } from '../../src/app/students/_components/academic-sections';
import {
  FeeBadge,
  STUDENT_COLUMNS,
  type Row,
} from '../../src/app/students/_components/student-list';
import { TasksNav } from '../../src/app/tasks/_components/eod-nav';
import { EodFactsView, EodHistory } from '../../src/app/tasks/_components/eod-facts';
import { ReviewPane } from '../../src/app/tasks/_components/eod-review';
import { EodStatus } from '../../src/app/tasks/_components/eod-views';
import { QuickAdd } from '../../src/app/tasks/_components/quick-add';
import { AckBadge, TaskFacts, WaitingAlert } from '../../src/app/tasks/_components/task-detail';
import type { TaskDetail } from '../../src/server/task-detail';

const loaded = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));
vi.mock('../../src/ui/frame', async (orig) => ({
  ...(await orig<object>()),
  load: async () => ({ ok: true, data: loaded.data }),
}));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const as = (...roles: string[]) => ({ id: 'u1', roles }) as unknown as AuthenticatedUser;
const SAMPLE = '<span class="el-badge el-badge-sample">';
const NOW = '2026-10-21T04:30:00.000Z';
const facts = (over: Partial<EodFacts> = {}): EodFacts => ({
  ...buildEodFacts({
    staffId: 's1',
    reportDate: '2026-10-20',
    now: new Date(NOW),
    tasks: [],
    events: [],
    updates: [],
    academic: { status: 'unavailable', reason: 'timeout', fetchedAt: NOW },
  }),
  ...over,
});

describe('screen formatters', () => {
  it.each([
    [12345600, '₹1,23,456'],
    [1000000000, '₹1,00,00,000'],
    [150050, '₹1,500.50'],
    [0, '₹0'],
    [-10000000, '−₹1,00,000'],
    [null, '—'],
  ])('fmtPaise(%s) = %s (Indian grouping; missing is a dash, not ₹0)', (paise, text) => {
    expect(fmtPaise(paise)).toBe(text);
  });

  it('dates: IST calendar days and times; empty or invalid shows a dash', () => {
    expect(fmtDate('2026-10-22')).toBe('22 Oct 2026');
    expect(fmtDateTime(new Date('2026-10-22T04:30:00Z')).replace(/\s/g, ' ')).toBe(
      '22 Oct 2026, 10:00 am IST',
    );
    expect(fmtMonth('2026-10')).toBe('October 2026');
    for (const v of [null, '', 'not a date']) expect(fmtDateTime(v)).toBe('—');
    expect(fmtDate(null)).toBe('—');
  });
});

describe('student list columns', () => {
  const row = {
    admissionNumber: null,
    studentName: 'Aarav <Sample> Student',
    isSample: true,
    phoneMasked: '98•••••210',
    counsellorName: null,
    feeStatus: null,
    status: 'enrolled',
    statusLabel: 'Active',
    statusSince: null,
    statusReason: null,
    nextFollowUp: null,
    nextMeeting: null,
  } as unknown as Row;
  const cell = (key: keyof typeof STUDENT_COLUMNS) => html(STUDENT_COLUMNS[key].render!(row));

  it('student cell: name escaped, SAMPLE DATA badge, masked phone only', () => {
    const out = cell('student');
    expect(out).toContain('Aarav &lt;Sample&gt; Student');
    expect(out).toContain(`${SAMPLE}Sample data</span>`);
    expect(out).toContain('98•••••210');
    expect(out).not.toMatch(/\d{10}/);
  });

  it.each([
    ['number', 'Not assigned'],
    ['counsellor', 'Unassigned'],
    ['fees', 'Restricted'],
    ['reason', 'Not recorded'],
    ['since', 'Not recorded'],
    ['next', 'Nothing scheduled'],
  ] as const)('missing %s reads "%s", never blank or 0', (key, text) => {
    expect(cell(key)).toContain(text);
  });

  it('fee status shows its words; a plan not configured is not "Paid"', () => {
    expect(html(<FeeBadge status="not_configured" />)).toBe(
      '<span class="el-badge el-tone-neutral">Fee plan not configured</span>',
    );
    expect(html(<FeeBadge status="paid" />)).toContain('Paid (as recorded)');
  });
});

describe('admissions pieces', () => {
  it.each([
    [1, 0, ['done', 'current', 'upcoming', 'upcoming']],
    [4, 0, ['done', 'done', 'done', 'done']],
    [2, 1, ['done', 'current', 'upcoming']],
  ])('journey at %s from %s marks stages %j', (at, from, states) => {
    const out = html(<RecordJourney at={at} from={from} />);
    expect([...out.matchAll(/data-state="(\w+)"/g)].map((m) => m[1])).toEqual(states);
    expect(out.includes('Demo')).toBe(from === 0);
  });

  const app = (over: object) =>
    ({
      application: {
        status: 'draft',
        statusLabel: 'Draft',
        reference: 'APP-001',
        currentVersion: 2,
        isSample: false,
      },
      snapshot: { form: null },
      ...over,
    }) as unknown as ApplicationView;

  it('application header: status in words, SAMPLE DATA only on sample records', () => {
    const real = html(<ApplicationMeta d={app({})} />);
    expect(real).toContain(
      '<span class="el-badge el-tone-warning">Draft</span> APP-001 · version 2',
    );
    expect(real).not.toContain('el-badge-sample');
    const sample = app({});
    sample.application.isSample = true;
    expect(html(<ApplicationMeta d={sample} />)).toContain(`${SAMPLE}Sample data</span>`);
  });

  it('paper form: unanswered fields say "Not recorded"; no form (or no permission) renders nothing', () => {
    expect(html(<PaperAnswers d={app({})} level={2} />)).toBe('');
    const out = html(
      <PaperAnswers
        d={app({ snapshot: { form: { gender: 'Female', whatsapp: '' } } })}
        level={2}
      />,
    );
    expect(out).toContain('<td>Female</td>');
    expect(out.match(/Not recorded/g)).toHaveLength(9);
    expect(out).toContain('Not given (default)');
  });

  it('funnel with no leads: rates are "Not enough data", not 0%', () => {
    const out = html(<FunnelTable report={{ funnel: admissionsFunnel([]) } as never} />);
    expect(out).toContain('Not enough data');
    expect(out).not.toContain('0%');
  });

  it('conversion with no demos: an empty state with a reason, no bars', () => {
    const out = html(
      <ConversionBreakdown
        title="By counsellor"
        rows={[]}
        window={{ from: '2026-10-01', to: '2026-10-21' } as never}
      />,
    );
    expect(out).toContain('No demo classes in this period, or no demo has an outcome yet.');
    expect(out).toContain('No demo classes in this period');
  });

  it.each([
    ['counsellor', ['Overview', 'Demo students', 'Active students'], ['Settings']],
    ['teacher', ['Events and counselling'], ['Demo students', 'Applications', 'Settings']],
  ])('admissions tabs for a %s show only permitted areas', (role, shown, hidden) => {
    const out = html(
      <AdmissionsNav
        current="overview"
        user={as(`${role === 'counsellor' ? 'admissions_' : ''}${role}`)}
      />,
    );
    for (const t of shown) expect(out).toContain(`>${t}</a>`);
    for (const t of hidden) expect(out).not.toContain(`>${t}</a>`);
  });
});

describe('Academic evidence on the student profile', () => {
  it('source unavailable: says when it was checked and shows no zeros', () => {
    const out = html(
      <AcademicEvidenceView
        evidence={{ status: 'unavailable', reason: 'timeout', checkedAt: NOW }}
      />,
    );
    expect(out).toContain('Source unavailable (checked 21 Oct 2026');
    expect(out).toContain('No results or attendance are shown rather than zeros.');
    expect(out).not.toMatch(/>0</);
  });

  it('absent is never a score; raw score / max beside the percent; no classes is said in words', () => {
    const evidence = {
      status: 'available',
      checkedAt: NOW,
      window: { from: '2026-09-01', to: '2026-10-21' },
      attendance: {
        present: 0,
        late: 0,
        partial: 0,
        absent: 0,
        excused: 0,
        recorded: 0,
        attended: 0,
        notRecorded: 0,
        ratePercent: null,
      },
      results: [
        {
          assessmentId: 'a',
          heldOn: '2026-09-02',
          code: 'CT-1',
          examType: 'sectional',
          rescored: false,
          subject: null,
          score: null,
          maxScore: 40,
          percent: null,
          comparison: 'Absent — not scored, not compared',
        },
        {
          assessmentId: 'b',
          heldOn: '2026-09-09',
          code: 'CT-2',
          examType: 'sectional',
          rescored: true,
          resultVersion: 2,
          subject: 'Quant',
          score: 30,
          maxScore: 40,
          percent: 75,
          comparison: 'x',
        },
      ],
      trends: [],
      enrolments: [],
    } as never;
    const out = html(<AcademicEvidenceView evidence={evidence} />);
    expect(out).toContain('>Absent<');
    expect(out).toContain('30 / 40 (75%)');
    expect(out).toContain('re-scored v2');
    expect(out).toContain('Not recorded');
    expect(out).toContain('No classes recorded in this period');
    expect(out).toContain('No classes held in this period.');
  });
});

describe('tasks and end-of-day reports', () => {
  it.each([
    ['draft', false, 'neutral', 'Draft'],
    ['submitted', true, 'info', 'Submitted'],
    ['revision_requested', false, 'warning', 'Revision requested'],
    ['acknowledged', false, 'success', 'Acknowledged'],
  ] as const)('EOD %s reads in words (late flagged: %s)', (status, late, tone, text) => {
    const out = html(<EodStatus r={{ status, late }} />);
    expect(out).toContain(`<span class="el-badge el-tone-${tone}">${text}</span>`);
    expect(out.includes('Submitted later')).toBe(late);
  });

  it('EOD facts: Academic down and HR unknown are said, never shown as 0 or absence', () => {
    const out = html(<EodFactsView f={facts()} base="/ops" />);
    expect(out).toContain('No task activity recorded');
    expect(out).toContain('Academic OS unavailable');
    expect(out).toContain('HR attendance unavailable');
    expect(out).toContain('this is not a record of absence');
    expect(out).toContain('None recorded on this day.');
  });

  it('EOD facts: missing Academic counts read "Not recorded"', () => {
    const academic = {
      status: 'available',
      checkedAt: NOW,
      planned: 3,
      delivered: 2,
      cancelled: 0,
      substituted: 0,
      logsPending: 1,
      markingPending: null,
      reviewsSubmitted: 0,
    } as const;
    const out = html(<EodFactsView f={facts({ academic })} base="/ops" />);
    expect(out).toContain('2 of 3 planned classes delivered');
    expect(out).toContain('marking pending Not recorded');
  });

  it('EOD history: nothing yet says so; a request shows who asked', () => {
    expect(html(<EodHistory r={{ versions: [], trail: [] } as never} base="/ops" />)).toContain(
      'Not submitted yet.',
    );
    const out = html(
      <EodHistory
        base="/ops"
        r={
          {
            versions: [],
            trail: [
              {
                id: 't',
                createdAt: NOW,
                kind: 'revision_requested',
                actorName: 'Sample Manager',
                text: '<b>Add times</b>',
                taskId: null,
              },
            ],
          } as never
        }
      />,
    );
    expect(out).toContain('Revision requested by Sample Manager');
    expect(out).toContain('&lt;b&gt;Add times&lt;/b&gt;');
  });

  it('EOD review pane: sample reports carry the full SAMPLE DATA badge', async () => {
    loaded.data = {
      id: 'r1',
      staffName: 'Sample Counsellor',
      reportDate: '2026-10-20',
      status: 'submitted',
      late: false,
      isSample: true,
      current: null,
      summary: null,
      nextDayPlan: null,
      notes: null,
      sourceChanged: false,
      versions: [],
      trail: [],
      facts: facts(),
      canReview: false,
    };
    const out = html(
      await ReviewPane({
        user: as('director'),
        id: 'r1',
        closeHref: '/ops/tasks/inbox',
        base: '/ops',
      }),
    );
    expect(out).toContain(`${SAMPLE}SAMPLE DATA</span>`);
    expect(out).toContain('Not written');
  });

  it.each([
    ['teacher', false, []],
    ['operations_manager', true, ['Inbox', 'Imports']],
  ])('task tabs for %s: Inbox and Imports only when allowed', (role, inbox, extra) => {
    const out = html(<TasksNav user={as(role)} current="day" inbox={inbox} base="/ops" />);
    for (const t of ['Inbox', 'Imports']) expect(out.includes(`>${t}</a>`)).toBe(extra.includes(t));
    expect(out).toContain('>My day</a>');
  });

  it('quick add: labelled, required marked, button names the action', () => {
    const out = html(<QuickAdd action="/ops/api/v1/staff-tasks" version="1" />);
    expect(out).toMatch(/<label for="([^"]+)">Quick add: what came in\? \*<\/label>/);
    expect(out).toMatch(/<input[^>]*required=""/);
    expect(out).toContain('>Add task</button>');
  });

  const task = {
    events: [],
    details: null,
    acceptanceCriteria: null,
    staffName: null,
    backupName: null,
    reviewRequired: false,
    reviewerName: null,
    selfLogged: false,
    assignedByName: null,
    requesterName: null,
    requesterNote: null,
    source: 'manual',
    departmentName: null,
    priority: 'high',
    receivedAt: new Date(NOW),
    plannedStartOn: null,
    dueOn: '2026-10-22',
    dueTime: null,
    acknowledgedAt: null,
    progressPercent: 0,
    reason: null,
    completedAt: null,
    linkedRef: null,
    leadId: null,
    admissionId: null,
    waitingOn: [],
  } as unknown as TaskDetail;

  it('task facts: missing people and text are named, progress is marked self-reported', () => {
    const out = html(<TaskFacts d={task} base="/ops" />);
    expect(out.match(/Not recorded/g)?.length).toBeGreaterThanOrEqual(4);
    for (const t of [
      'None recorded',
      'No acceptance criteria recorded',
      'Not yet',
      '0% (self-reported)',
      'No review step: the owner marks it done',
    ])
      expect(out).toContain(t);
    expect(out).not.toContain('Related lead');
  });

  it('unacknowledged task: badge and alert say so; acknowledged with no waits shows nothing', () => {
    expect(html(<AckBadge at={null} />)).toContain('Not acknowledged');
    expect(html(<AckBadge at={new Date(NOW)} />)).toBe('');
    expect(html(<WaitingAlert d={task} />)).toContain(
      'Assigned to the owner, not yet acknowledged',
    );
    expect(html(<WaitingAlert d={{ ...task, acknowledgedAt: new Date(NOW) }} />)).toBe('');
    expect(
      html(
        <WaitingAlert d={{ ...task, acknowledgedAt: new Date(NOW), waitingOn: ['Print forms'] }} />,
      ),
    ).toContain('Waiting on “Print forms”');
  });
});
