import { readdirSync, readFileSync } from 'node:fs';
import { sourceReasonWords } from '@elevate/shared-contracts';
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
  Funnel,
  FunnelTable,
} from '../../src/app/reports/_components/admissions-charts';
import { AcademicEvidenceView } from '../../src/app/students/_components/academic-sections';
import { ReportList } from '../../src/app/students/_components/report-list';
import {
  FeeBadge,
  pastTabs,
  STUDENT_COLUMNS,
  type Row,
} from '../../src/app/students/_components/student-list';
import { TasksNav } from '../../src/app/tasks/_components/eod-nav';
import { EodFactsView, EodHistory } from '../../src/app/tasks/_components/eod-facts';
import { EodStatus } from '../../src/app/tasks/_components/eod-views';
import { QuickAdd } from '../../src/app/tasks/_components/quick-add';
import { AckBadge, TaskFacts, WaitingAlert } from '../../src/app/tasks/_components/task-detail';
import type { TaskDetail } from '../../src/server/task-detail';
import type { Overview } from '../../src/server/overview';
import { OverviewBlocks } from '../../src/app/_components/overview-blocks';
import { taskItems } from '../../src/app/admissions/applications/_components/application-detail';
import { RequestFacts } from '../../src/app/hr-requests/_components/parts';
import {
  AdmissionFacts,
  PrimaryAction,
  ProgrammesTable,
} from '../../src/app/students/_components/profile-sections';
import { OutcomeDonut, StudentSummary } from '../../src/app/reports/_components/admissions-charts';
import { requestRouteText } from '../../src/app/hr-requests/hr-requests-body';
import { StaffEditModal, StaffProfile } from '../../src/app/staff/staff-record';
import { MARKETING_LABELS, MarketingPanel } from '../../src/ui/cross-module';
import { openHref, PAGE_GATES } from '../../src/ui/open-link';
import { RecordTable } from '../../src/ui/record-table';
import { TeacherReports } from '../../src/app/teachers/teacher-reports';

const loaded = vi.hoisted(() => ({ data: undefined as unknown, fail: false }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));
vi.mock('../../src/ui/frame', async (orig) => ({
  ...(await orig<object>()),
  load: async () => (loaded.fail ? { ok: false, view: null } : { ok: true, data: loaded.data }),
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

describe('why another workspace could not be read', () => {
  it.each([
    ['HTTP 500', 'the other workspace reported a problem'],
    ['Response did not match the contract', 'the other workspace reported a problem'],
    ['Timed out', 'Timed out'],
    ['Could not reach the source', 'Could not reach the source'],
  ])('%s (RVC-015)', (reason, plain) => expect(sourceReasonWords(reason)).toBe(plain));
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

  it('funnel chart leaves out "every planned day", so each share is of the stage the domain divides by', () => {
    const lead = {
      demoBooked: true,
      attended: true,
      completed: false,
      converted: true,
      enrolled: false,
    };
    const out = html(<Funnel report={{ funnel: admissionsFunnel([lead]) } as never} />);
    expect(out).not.toContain('Attended every planned demo day');
    expect(out).toContain('Converted to admission');
    expect(out).toContain('100% of previous');
  });

  it('conversion with no demos: an empty state with a reason, no bars', () => {
    const out = html(
      <ConversionBreakdown
        title="By counsellor"
        user={as('operations_manager')}
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
    expect(out).toContain('Source unavailable');
    expect(out).toContain('Academic OS could not be read (timeout); checked 21 Oct 2026');
    expect(out).toContain('No numbers are shown rather than zeros.');
    expect(out).toContain('>Try again</button>');
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
    expect(out).toContain('0 of 0 recorded');
    expect(out).toContain('No classes held in this period.');
  });
});

describe('tasks and end-of-day reports', () => {
  it.each([
    ['draft', false, 'neutral', 'Draft'],
    ['submitted', true, 'info', 'Submitted'],
    ['revision_requested', false, 'warning', 'Changes requested'],
    ['acknowledged', false, 'success', 'Reviewed'],
  ] as const)('EOD %s reads in words (late flagged: %s)', (status, late, tone, text) => {
    const out = html(<EodStatus r={{ status, late }} />);
    expect(out).toContain(`<span class="el-badge el-tone-${tone}">${text}</span>`);
    expect(out.includes('Submitted later')).toBe(late);
  });

  it('EOD facts (REP WorkReportFacts): Academic down is said, never shown as 0 or absence', () => {
    const out = html(<EodFactsView f={facts()} base="/ops" openable={new Set()} />);
    expect(out).toContain('No task activity recorded');
    expect(out).toContain('Source unavailable: Academic OS');
    expect(out).not.toContain('confirmed absences');
    expect(out).toContain('None recorded in this period.');
  });

  it('EOD facts: a task the reader cannot open is listed as text, not a dead link (RVC-028)', () => {
    const at = new Date(NOW).toISOString();
    const received = [
      { taskId: 'mine', title: 'Still mine', at, detail: null },
      { taskId: 'moved', title: 'Moved away', at, detail: null },
    ];
    const out = html(<EodFactsView f={facts({ received })} base="/ops" openable={new Set(['mine'])} />);
    expect(out).toContain('href="/ops/tasks/mine"');
    expect(out).not.toContain('/ops/tasks/moved');
    expect(out).toContain('Moved away');
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
    const out = html(<EodFactsView f={facts({ academic })} base="/ops" openable={new Set()} />);
    expect(out).toContain('2 of 3 scheduled classes delivered');
    expect(out).toContain('marking pending Not recorded');
  });

  it('EOD history: nothing yet says so; a request shows who asked', () => {
    const openable = new Set<string>();
    expect(
      html(<EodHistory r={{ versions: [], trail: [] } as never} base="/ops" openable={openable} />),
    ).toContain('Not submitted yet.');
    const out = html(
      <EodHistory
        base="/ops"
        openable={openable}
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
    expect(out).toContain('Changes requested by Sample Manager');
    expect(out).toContain('&lt;b&gt;Add times&lt;/b&gt;');
  });

  it('teacher reports segment fails on its own: error inside it, the generate form still renders', async () => {
    loaded.fail = true;
    try {
      const out = html(await TeacherReports({ user: as('director'), staffId: 's1' }));
      expect(out).toContain('id="teacher-reports"');
      expect(out).toContain('Stored reports could not be loaded');
      expect(out).toContain('Generate teacher report');
      expect(out).not.toContain('Download PDF');
    } finally {
      loaded.fail = false;
    }
  });

  it.each([
    ['teacher', false, []],
    ['operations_manager', true, ['Inbox', 'Imports']],
  ])('task tabs for %s: Inbox and Imports only when allowed', (role, inbox, extra) => {
    const out = html(<TasksNav user={as(role)} current="day" inbox={inbox} base="/ops" />);
    for (const t of ['Inbox', 'Imports']) expect(out.includes(`>${t}</a>`)).toBe(extra.includes(t));
    expect(out).toContain('>My day</a>');
    expect(out).toContain('href="/ops/my-reports"');
  });

  it('quick add: labelled, required marked, button names the action', () => {
    const out = html(<QuickAdd action="/ops/api/v1/staff-tasks" version="1" />);
    expect(out).toMatch(/<label for="([^"]+)">Quick add: what came in\?<\/label>/); // "*" via CSS
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
    createdByName: 'Sample Creator',
    requesterText: 'Sample Creator (created this task)',
    source: 'manual',
    departmentText: null,
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
    status: 'pending',
    expectedDeliverable: null,
    collaborators: [],
    deliveredAt: null,
    originalDueOn: '2026-10-22',
  } as unknown as TaskDetail;

  it('task facts: missing people and text are named, progress is marked self-reported', () => {
    const out = html(<TaskFacts d={task} base="/ops" />);
    expect(out.match(/Not recorded/g)?.length).toBeGreaterThanOrEqual(2);
    for (const t of [
      'Only the title was given',
      '0% (self-reported)',
      'No review step: the owner marks it done',
      'Delivered: not yet',
      'Notice read: not yet',
      'Acknowledged: not yet',
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

describe('Overview dashboard (missing is not zero; a sparkline only with a series)', () => {
  const range = { from: '2026-10-01', to: '2026-10-21' };
  const parts = {
    funnel: null,
    report: null,
    pipeline: null,
    collections: null,
    outstanding: null,
    crossModule: null,
    reviews: null,
    team: null,
    kpis: null,
    series: null,
  };
  const base = { asOf: NOW, range, ...parts } as Overview;
  const funnel = {
    ok: true,
    data: {
      scope: 'all',
      window: range,
      funnel: admissionsFunnel([]),
      demoConversion: { total: 0, byOutcome: [] },
    },
  } as never;

  it('no series: labelled tiles without a sparkline; an unrecorded total is words, not ₹0', () => {
    const out = html(
      <OverviewBlocks
        user={as('operations_manager')}
        o={{
          ...base,
          funnel,
          collections: { ok: true, data: { collected: null } as never },
          team: { ok: false, reason: 'Choose 92 days or fewer to see task and EOD figures.' },
        }}
      />,
    );
    for (const t of [
      'Leads received',
      'Demos converted',
      'Collected in the period',
      'EOD reports missing',
    ])
      expect(out).toContain(t);
    expect(out).toContain('view=previous&amp;outcome=converted'); // the tile opens what it counts
    expect(out).toContain('No payment recorded yet');
    expect(out).toContain('Choose 92 days or fewer');
    expect(out).not.toContain('₹0');
    expect(out).not.toContain('el-spark');
    expect(out).not.toContain('Leads received per day');
  });

  it('with a series: a sparkline on the tile and the per-day chart with its axis', () => {
    const perDay = (counts: number[]) =>
      counts.map((count, i) => ({ date: `2026-10-${19 + i}`, count }));
    const series = {
      ok: true,
      data: { scope: 'all', leadsPerDay: perDay([1, 0, 2]), conversionsPerDay: perDay([0, 0, 1]) },
    } as never;
    const out = html(
      <OverviewBlocks user={as('operations_manager')} o={{ ...base, funnel, series }} />,
    );
    expect(out).toContain('el-spark');
    expect(out).toContain('Leads received per day');
    expect(out).toContain('19 Oct');
    expect(out).toContain('Not enough data'); // an empty funnel is never drawn as zero bars
  });
});

describe('a link that opens "No access" for this person is not shown (CHK-014)', () => {
  const hrefs = (out: string) =>
    [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  const opensAll = (role: string, out: string) =>
    expect(hrefs(out).filter((h) => !openHref(as(role), h))).toEqual([]);
  const range = { from: '2026-10-01', to: '2026-10-21' };
  const ok = (data: unknown) => ({ ok: true, data }) as never;
  const m = { status: 'ok', value: 1, definition: 'd', window: range, unit: 'count' };
  const down = { status: 'unavailable', reason: 'test', fetchedAt: NOW };
  const overview = {
    asOf: NOW,
    range,
    series: null,
    funnel: ok({
      scope: 'all',
      window: range,
      funnel: admissionsFunnel([]),
      demoConversion: { total: 0, byOutcome: [] },
    }),
    report: ok({ bySource: [] }),
    pipeline: ok({
      confirmed: { metric: { value: 2 } },
      applications: {
        awaiting: { signatures_confirmed: { value: 2 } },
        approvalBlocked: 0,
        approvalChecked: 0,
      },
      onboarding: { completion: { done: 1, total: 2 }, items: { value: 1 }, admissions: 1 },
    }),
    collections: ok({ collected: { netPaise: 500_00 } }),
    outstanding: ok({
      views: { due: { count: 1, owedPaise: 100 }, overdue: { count: 1, owedPaise: 100 } },
    }),
    crossModule: ok({ academic: down, marketing: down }),
    reviews: ok({ status: 'available', total: 3 }),
    team: ok({
      asOf: NOW,
      totals: { eodSubmitted: 1, eodMissing: 1, overdue: 1, blocked: 1 },
      people: [],
    }),
    kpis: ok({
      asOf: NOW,
      kpis: { newLeads: m, conversion: m, followUpCompliance: m, overdueWork: m },
      workload: { rows: [], unassigned: 0 },
    }),
  } as unknown as Overview;
  const OPS_ROLES = [
    'operations_manager',
    'hr_manager',
    'admissions_counsellor',
    'director',
    'auditor',
    'academic_coordinator',
    'finance_officer',
  ];

  it('PAGE_GATES repeats every gate() in src/app, so it cannot drift from the pages', () => {
    const app = new URL('../../src/app/', import.meta.url);
    const found = readdirSync(app, { recursive: true, encoding: 'utf8' })
      .map((f) => f.replaceAll('\\', '/'))
      .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
      .flatMap((f): [string, string][] => {
        const permission = readFileSync(new URL(f, app), 'utf8').match(
          /\bgate\(\s*'([\w:]+)'/,
        )?.[1];
        return permission ? [[`/ops/${f}`.replace(/\/?page\.tsx$/, ''), permission]] : [];
      });
    expect(Object.fromEntries(found)).toEqual(PAGE_GATES);
  });

  it.each([
    // The walker's pairs (c-walk3-grouped.txt), then what must stay open.
    ['admissions_counsellor', '/ops/academic-summary?from=2026-10-01', false],
    ['admissions_counsellor', '/ops/marketing-summary', false],
    ['academic_coordinator', '/ops/leads', false],
    ['finance_officer', '/ops/meetings?view=week', false],
    ['hr_manager', '/ops/leads/abc', false],
    ['finance_officer', '/ops/admissions', false],
    ['finance_officer', '/ops/students', false],
    ['finance_officer', '/ops/students/abc?tab=fees', false],
    ['finance_officer', '/ops/students/past?tab=former', false],
    ['auditor', '/ops/hr/review', false],
    ['auditor', '/ops/hr/tasks?staffId=abc', false],
    ['academic_coordinator', '/ops/admissions/abc', false],
    ['academic_coordinator', '/ops/admissions/demos/abc', false],
    ['academic_coordinator', '/ops/staff/abc', false],
    ['finance_officer', '/ops/admissions/overview', true],
    ['finance_officer', '/ops/admissions/abc#fee-agreement', true],
    ['finance_officer', '/ops/fees/collections', true],
    ['academic_coordinator', '/ops/students/abc', true],
    ['auditor', '/ops/hr', true],
    ['finance_officer', '#today-classes', true],
  ])('%s, %s opens: %s', (role, href, opens) => {
    expect(openHref(as(role), href)).toBe(opens ? href : undefined);
  });

  it.each(OPS_ROLES)('Overview as %s: every link opens and every figure stays', (role) => {
    const out = html(<OverviewBlocks o={overview} user={as(role)} />);
    opensAll(role, out);
    for (const figure of [
      'Collected in the period',
      'Overdue instalments',
      'Waiting for confirmation',
      'Teacher reviews published',
      'EOD reports missing',
      'Checklist items done',
    ])
      expect(out, figure).toContain(figure);
  });

  it('Overview: EOD submitted and missing add up to the expected days (HMO-023)', () => {
    const team = ok({
      asOf: NOW,
      totals: { eodSubmitted: 5, eodMissing: 100, overdue: 0, blocked: 0 },
      people: [{ eod: { days: 100 } }],
    });
    const out = html(<OverviewBlocks o={{ ...overview, team }} user={as('operations_manager')} />);
    expect(out).toContain('0 of 100 expected days; 5 for other days');
    expect(out).not.toContain('Of 100 expected');
  });

  it('Overview: a manager keeps the links a finance officer loses', () => {
    const lost = ['/ops/leads', '/ops/students', '/ops/academic-summary?'];
    const of = (role: string) => hrefs(html(<OverviewBlocks o={overview} user={as(role)} />));
    for (const h of lost) {
      expect(
        of('operations_manager').some((x) => x.startsWith(h)),
        h,
      ).toBe(true);
      expect(
        of('finance_officer').some((x) => x.startsWith(h)),
        h,
      ).toBe(false);
    }
    expect(of('finance_officer')).toContain('/ops/fees/outstanding?status=overdue');
  });

  it('report tables keep their counts without the link', () => {
    const report = {
      window: range,
      demoConversion: { byOutcome: [{ group: 'converted', demos: 7 }] },
    } as never;
    const students = { active: 11, on_hold: 12, former: 13 } as never;
    const group = {
      group: 'CLAT',
      programmeCode: 'CLAT',
      demos: 9,
      decided: 8,
      converted: 6,
      ratePct: 75,
    };
    const out = (role: string) =>
      html(
        <>
          <OutcomeDonut report={report} user={as(role)} />
          <StudentSummary students={students} user={as(role)} />
          <ConversionBreakdown
            title="By programme"
            rows={[group]}
            window={range as never}
            filter={(g) => ({ programme: g.programmeCode })}
            user={as(role)}
          />
        </>,
      );
    const finance = out('finance_officer');
    opensAll('finance_officer', finance);
    expect(hrefs(finance)).toEqual([]);
    for (const n of ['>7<', '>11<', '>12<', '>13<', '>6<']) expect(finance).toContain(n);
    expect(hrefs(out('operations_manager'))).toContain('/ops/students');
  });

  const profile = {
    admission: { id: 'a1', status: 'enrolled', statusLabel: 'Enrolled', admissionNumber: '001' },
    identity: { id: 's1' },
    exitRecords: [],
    numberChanges: [],
    owner: null,
    academic: { path: null },
    actions: { resume: false, report: false },
    handoff: { retry: { allowed: true } },
    demos: [{ id: 'dm1', outcome: 'converted', outcomeAt: new Date(NOW) }],
    cases: [{ id: 'a1', admissionNumber: 'ADM-77', statusLabel: 'Enrolled', status: 'enrolled' }],
  } as never;

  it('a student record keeps the demo date and admission number without the link', () => {
    const out = (role: string) =>
      html(
        <>
          <AdmissionFacts d={profile} user={as(role)} />
          <ProgrammesTable d={profile} user={as(role)} />
          <PrimaryAction d={profile} base="/ops/students/s1" user={as(role)} />
        </>,
      );
    const coordinator = out('academic_coordinator');
    opensAll('academic_coordinator', coordinator);
    expect(coordinator).toContain('Converted demo');
    expect(coordinator).toContain('ADM-77');
    expect(coordinator).not.toContain('Request enrolment again');
    const manager = out('operations_manager');
    expect(hrefs(manager)).toContain('/ops/admissions/demos/dm1');
    expect(hrefs(manager)).toContain('/ops/admissions/a1');
    expect(manager).toContain('Request enrolment again');
  });

  it('application tasks: the fix stays in words, the link goes with the access', () => {
    const d = {
      admission: { id: 'a1', leadId: 'l1' },
      can: { write: false },
      tasks: [
        { task: 'details', missing: [{ message: 'Student phone missing', fix: 'contact' }] },
        { task: 'declarations', missing: [{ message: 'Declaration not set' }] },
      ],
    } as never;
    const [details, declarations] = taskItems(as('finance_officer'), d, '/ops/x');
    expect(html(details!.missing[0])).toBe('Student phone missing. ');
    expect(declarations!.href).toBeNull();
    const [mine, settings] = taskItems(as('operations_manager'), d, '/ops/x');
    expect(html(mine!.missing[0])).toContain('/ops/leads/l1?act=details');
    expect(settings!.href).toBe('/ops/settings?group=admissions');
  });

  it('an HR request about a student says so when HR cannot open student records', () => {
    const view = {
      as: 'hr',
      categoryLabel: 'General',
      request: {
        relatedKind: 'student',
        relatedId: 's1',
        status: 'submitted',
        recipient: { label: 'HR' },
        urgency: 'normal',
        submittedAt: null,
        linkedTaskId: null,
      },
    } as never;
    const out = (role: string) => html(<RequestFacts user={as(role)} view={view} base="/ops" />);
    expect(out('hr_manager')).toContain('your role does not open student records');
    expect(hrefs(out('hr_manager'))).toEqual([]);
    expect(hrefs(out('operations_manager'))).toEqual(['/ops/students?open=s1']);
  });

  it('a column whose value is an element renders it, never "[object Object]" (FLA-001)', () => {
    const out = html(
      <RecordTable
        rows={[{ id: '1', status: <button type="button">Mark attended</button> }]}
        rowKey={(r) => r.id}
        columns={[{ key: 'status', header: 'Attendance or status' }]}
      />,
    );
    expect(out).toContain('<button type="button">Mark attended</button>');
    expect(out).not.toContain('[object Object]');
  });

  it('a list row whose record does not open keeps its data and has no row link', () => {
    const out = html(
      <RecordTable
        rows={[{ id: '1', name: 'Sample Student' }]}
        rowKey={(r) => r.id}
        rowHref={(r) => openHref(as('finance_officer'), `/ops/students/${r.id}`)}
        columns={[{ key: 'name', header: 'Student' }]}
      />,
    );
    expect(out).toContain('Sample Student');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('ops-row-link');
  });
});

describe('a login and a staff record (PPL-005)', () => {
  const d = {
    staff: { id: 's1', fullName: 'Sample Teacher', title: null, status: 'active', userId: null },
    profile: null,
    reports: [],
    manager: null,
    department: null,
  } as never;
  const logins = [{ value: 'u9', label: 'Sample Login (sample@example.test)' }];

  it('the edit form offers the logins with no staff record', () => {
    const out = html(<StaffEditModal d={d} logins={logins} closeHref="/ops/staff/s1" />);
    expect(out).toContain('name="userId"');
    expect(out).toContain('Sample Login (sample@example.test)');
  });

  it.each([
    ['operations_manager', 'Not linked: link a login', '/ops/staff/s1?act=edit'],
    ['hr_manager', 'An operations manager links it on this record', null],
    ['auditor', 'An operations manager links it on this record', null],
  ])('no login, as %s: says what to do and who can', (role, words, href) => {
    const out = html(
      <StaffProfile d={d} user={as(role)} editHref="/ops/staff/s1?act=edit" level={2} />,
    );
    expect(out).toContain(words);
    expect(out.includes(`href="${href}"`)).toBe(href !== null);
  });
});

describe('who reads a request first is true for the reader', () => {
  it.each([
    [true, 'HR reads every request first', 'operations manager'],
    [false, 'an operations manager reads your request first', 'HR reads every request'],
  ])('HR covers this person: %s', (covers, says, never) => {
    expect(requestRouteText(covers)).toContain(says);
    expect(requestRouteText(covers)).not.toContain(never);
  });
});

describe('Marketing panel (FLA-005)', () => {
  it('names each source connection in words, never a raw code', () => {
    const m = {
      status: 'ok',
      value: 1,
      definition: 'd',
      window: { from: '2026-10-01', to: '2026-10-31' },
      unit: 'count',
    };
    const out = html(
      <MarketingPanel
        result={
          {
            status: 'available',
            fetchedAt: NOW,
            data: {
              generatedAt: NOW,
              metrics: Object.fromEntries(Object.keys(MARKETING_LABELS).map((k) => [k, m])),
              dataSources: [{ name: 'Metricool', connection: 'not_configured', lastSyncAt: null }],
            },
          } as never
        }
      />,
    );
    expect(out).toContain('Metricool (Not configured)');
    expect(out).not.toContain('not_configured');
  });
});

describe('Past students tabs (CHK-015)', () => {
  it.each([
    ['academic_coordinator', ['former']],
    ['finance_officer', ['former']],
    ['admissions_counsellor', ['former', 'demos']],
    ['operations_manager', ['former', 'demos']],
  ])('%s is offered %j: never a tab that refuses them', (role, keys) => {
    expect(pastTabs(as(role)).map((t) => t.key)).toEqual(keys);
  });
});

describe('student report kinds (D-078)', () => {
  it('the generated-reports list names the kind, period and status with a PDF link; empty says what to do', () => {
    const row = {
      id: 'r1',
      referenceCode: 'SR-SAMPLE0001',
      audience: 'guardian' as const,
      status: 'draft' as const,
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      at: new Date(NOW),
    };
    const out = html(
      <ReportList
        rows={[row, { ...row, id: 'r2', audience: 'internal', status: 'final' }]}
        studentId="s1"
      />,
    );
    expect(out).toContain('PTM report (for parents)');
    expect(out).toContain('Internal report (KYC, student details, scores, reviews)');
    expect(out).toContain('1 Sept 2026 to 30 Sept 2026');
    expect(out).toContain('<span class="el-badge el-tone-neutral">Draft</span>');
    expect(out).toContain('<span class="el-badge el-tone-success">Final</span>');
    expect(out).toContain('href="/ops/api/v1/students/s1/report/SR-SAMPLE0001/pdf"');
    expect(html(<ReportList rows={[]} studentId="s1" />)).toContain('No report generated yet');
  });
});

describe('what a page may not hold', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('no inline <style>: the content security policy blocks it (RVC-017)', () => {
    expect(read('../../src/app/students/[id]/report/page.tsx')).not.toContain('<style');
  });
  it('no false "HR attendance unavailable" (RVC-003)', () => {
    expect(read('../../src/app/teachers/page.tsx')).not.toContain('HR attendance unavailable');
    expect(read('../../src/server/pdf/teacher-report.ts')).not.toContain('HR attendance unavailable');
  });
});
