import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthenticatedUser } from '@elevate/authentication';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { scopeFor } from '@elevate/authorization';
import { ROLE_KEYS } from '@elevate/shared-types';
import { rangeOf } from '../../src/server/overview';
import { NAV, navFor } from '../../src/ui/frame';
import { AdmissionsNav, FeesNav, PeopleNav, TaskReviewNav } from '../../src/ui/admissions-nav';
import { WorkspaceLink } from '../../src/app/_components/workspace-link';
import { openHref, PAGE_GATES } from '../../src/ui/open-link';

const NOW = new Date('2026-10-22T06:00:00Z');
const as = (...roles: string[]) => ({ id: 'u1', roles }) as unknown as AuthenticatedUser;
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('overview date range (default: this month to date, IST)', () => {
  const month = { from: '2026-10-01', to: '2026-10-22' };
  it.each([
    ['nothing given', {}, month, false],
    [
      'a valid range',
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-09-01', to: '2026-09-30' },
      false,
    ],
    [
      'one day',
      { from: '2026-10-05', to: '2026-10-05' },
      { from: '2026-10-05', to: '2026-10-05' },
      false,
    ],
    [
      'exactly a year (366 days)',
      { from: '2025-10-22', to: '2026-10-22' },
      { from: '2025-10-22', to: '2026-10-22' },
      false,
    ],
    ['longer than a year', { from: '2025-10-21', to: '2026-10-22' }, month, true],
    ['reversed', { from: '2026-10-10', to: '2026-10-01' }, month, true],
    ['not a real date', { from: '2026-02-30', to: '2026-03-10' }, month, true],
    ['only one end', { from: '2026-10-01' }, month, true],
    ['junk', { from: 'x', to: '<script>' }, month, true],
  ])('%s', (_, sp, range, rejected) => {
    const at = rangeOf(sp, NOW);
    expect(at.range).toEqual(range);
    expect(at.rejected).toBe(rejected);
  });

  it('quick periods: this month, last month, last 30 days', () => {
    expect(rangeOf({}, NOW).presets).toEqual([
      ['This month', month],
      ['Last month', { from: '2026-09-01', to: '2026-09-30' }],
      ['Last 30 days', { from: '2026-09-23', to: '2026-10-22' }],
    ]);
  });
});

describe('Business Operations navigation (site map, Blueprint step 3, 6 Nov 2026)', () => {
  /** The rail as "Group: item, item", in order. */
  const menu = (...roles: string[]) =>
    navFor(as(...roles)).reduce<string[]>((out, n) => {
      const last = out.at(-1);
      if (last?.startsWith(`${n.group}: `)) out[out.length - 1] = `${last}, ${n.label}`;
      else out.push(`${n.group}: ${n.label}`);
      return out;
    }, []);
  const ADMISSIONS = 'Admissions: Leads, Follow-ups, Demos, Applications, Counselling and events';
  const TODAY = 'Today: Overview, Calendar';
  const STUDENTS = 'Students: Active students, Past students';
  const FEES = 'Fees: Fee structure, Collections, Outstanding instalments, Overdue fees';
  const TEACHING = 'Teaching: Teachers, Tests and mock tests';
  const HR =
    'Team (HR): HR overview, Staff directory, Joining and leaving, Teaching assignments, Attendance and leave';
  const HR_ALL = 'Task review, Requests from staff, Work reports, Student feedback about teachers, HR settings';
  const REPORTS = 'Reports: Reports, Academic summary, Marketing summary';
  const MINE = 'My work: Tasks and EOD reports, My attendance and leave, My payslips, My reports';

  it.each([
    [
      'operations_manager',
      [
        TODAY,
        ADMISSIONS,
        `${STUDENTS}, Absent students, Certificates`,
        `${FEES}, Fee approvals`,
        TEACHING,
        `${HR}, ${HR_ALL}`,
        REPORTS,
        `${MINE}, Requests to HR, Approval cover`,
      ],
    ],
    [
      'director',
      [
        TODAY,
        ADMISSIONS,
        `${STUDENTS}, Certificates`,
        `${FEES}, Fee approvals`,
        TEACHING,
        `${HR}, Payroll, Task review, Work reports`,
        REPORTS,
        `${MINE}, Requests to HR, Approval cover`,
      ],
    ],
    [
      'auditor',
      [
        TODAY,
        ADMISSIONS,
        `${STUDENTS}, Certificates`,
        FEES,
        TEACHING,
        `${HR}, Work reports`,
        REPORTS,
        'My work: Tasks and EOD reports, My attendance and leave, My reports',
      ],
    ],
    // No report and no empty HR group: one Task review entry.
    [
      'academic_coordinator',
      [
        TODAY,
        `${STUDENTS}, Certificates`,
        TEACHING,
        'Team (HR): Task review',
        `${MINE}, Requests to HR`,
      ],
    ],
    [
      'admissions_counsellor',
      [
        TODAY,
        ADMISSIONS,
        `${STUDENTS}, Absent students, Certificates`,
        FEES,
        'Teaching: Teachers',
        'Reports: Reports',
        `${MINE}, Requests to HR`,
      ],
    ],
    [
      'hr_manager',
      [TODAY, 'Teaching: Teachers', `${HR}, Payroll, ${HR_ALL}`, `${MINE}, Approval cover`],
    ],
    [
      'finance_officer',
      [
        TODAY,
        'Admissions: Applications',
        FEES,
        'Reports: Reports',
        `${MINE}, Requests to HR, Approval cover`,
      ],
    ],
  ])(
    '%s sees its rail, grouped, with no item that opens an empty or refused page',
    (role, rail) => {
      expect(menu(role)).toEqual(rail);
    },
  );

  // REV-5: the page files' own `active` keys and gates, read from src/app (so neither can drift).
  const app = new URL('../../src/app/', import.meta.url);
  const PAGES = readdirSync(app, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
    .flatMap((f): [string, string][] => {
      const key = readFileSync(new URL(f, app), 'utf8').match(/\bactive="([\w-]+)"/)?.[1];
      return key ? [[`/ops/${f}`.replace(/\/?page\.tsx$/, ''), key]] : [];
    });
  /** No rail item by design: an area tab, the bell, the search box, the Settings link. */
  const UNLIT = ['/ops/admissions/overview', '/ops/notifications', '/ops/search', '/ops/settings'];
  /** The page opens with content: its gate and body check (openHref), and all scope for HR lists. */
  const opens = (role: string, n: (typeof NAV)[number]) =>
    openHref(as(role), n.href) !== undefined &&
    (!n.allScope || scopeFor(as(role), PAGE_GATES[n.href]!) === 'all');

  it.each(ROLE_KEYS)(
    '%s: the rail shows exactly the items whose page opens with content',
    (role) => {
      const shown = new Set(navFor(as(role)).map((n) => n.href));
      for (const n of NAV) expect(shown.has(n.href), `${role} ${n.href}`).toBe(opens(role, n));
    },
  );

  it('every page lights its one rail item for whoever sees that item, and nothing otherwise', () => {
    for (const [route, key] of PAGES) {
      const items = NAV.filter((n) => n.keys.has(key));
      expect(items.length, `${route} (${key})`).toBe(UNLIT.includes(route) ? 0 : 1);
      for (const role of ROLE_KEYS) {
        if (!openHref(as(role), route)) continue;
        const lit = navFor(as(role), key).filter((n) => n.active);
        const item = items[0];
        expect(
          lit.map((n) => n.label),
          `${role} on ${route}`,
        ).toEqual(item && opens(role, item) ? [item.label] : []);
      }
    }
  });

  it('pages light the item they belong to (their `active` prop)', () => {
    const lit = Object.fromEntries(
      PAGES.map(([route, key]) => [
        route,
        navFor(as('operations_manager'), key).find((n) => n.active)?.label,
      ]),
    );
    expect(lit).toMatchObject({
      '/ops': 'Overview',
      '/ops/leads/sales-calls': 'Leads',
      '/ops/follow-ups': 'Follow-ups',
      '/ops/admissions/demos/[id]': 'Demos',
      '/ops/admissions/[id]': 'Applications',
      '/ops/meetings/[id]': 'Counselling and events',
      '/ops/fees': 'Fee structure',
      '/ops/fees/collections': 'Collections',
      '/ops/fees/outstanding': 'Outstanding instalments',
      '/ops/operations/approvals': 'Fee approvals',
      '/ops/staff': 'Teachers',
      '/ops/hr/tasks': 'Task review',
      '/ops/hr/review': 'Task review',
      '/ops/tasks/inbox': 'Tasks and EOD reports',
      '/ops/tasks/imports': 'Tasks and EOD reports',
      '/ops/reports/admissions': 'Reports',
      '/ops/calendar': 'Calendar',
      '/ops/leads/sharing': 'Leads',
      '/ops/fees/defaulters': 'Overdue fees',
      '/ops/certificates': 'Certificates',
      '/ops/hr/assets': 'Joining and leaving',
      '/ops/approval-cover': 'Approval cover',
    });
  });

  it('every rail item opens a page that exists', () => {
    for (const n of NAV)
      expect(
        existsSync(new URL(`../../src/app${n.href.slice(4)}/page.tsx`, import.meta.url)),
        n.href,
      ).toBe(true);
  });

  it('area tabs keep every page reachable; Fee approvals only for approvers', () => {
    const fees = (role: string) => html(<FeesNav current="collections" user={as(role)} />);
    for (const t of ['Fee structure', 'Collections', 'Outstanding instalments', 'Overdue fees'])
      expect(fees('finance_officer')).toContain(`>${t}</a>`);
    expect(fees('finance_officer')).not.toContain('Fee approvals');
    expect(fees('director')).toContain('>Fee approvals</a>');
    const admissions = (role: string) => html(<AdmissionsNav current="leads" user={as(role)} />);
    expect(admissions('operations_manager')).toContain('>Lead sharing</a>');
    expect(admissions('admissions_counsellor')).not.toContain('Lead sharing');
    expect(html(<PeopleNav current="teachers" user={as('operations_manager')} />)).toContain(
      '>All staff</a>',
    );
    expect(html(<FeesNav current="structure" user={as('teacher')} />)).not.toContain('Collections');
    const review = html(<TaskReviewNav current="review" user={as('academic_coordinator')} />);
    for (const [href, t] of [
      ['/ops/hr/review', 'Task review'],
      ['/ops/hr/tasks', 'Tasks'],
    ])
      expect(review).toMatch(new RegExp(`href="${href}"[^>]*>${t}</a>`));
  });
});

describe('links into another workspace', () => {
  it.each([
    [['operations_manager'], 'academic', false],
    [['operations_manager', 'academic_coordinator'], 'academic', true],
    [['operations_manager'], 'marketing', false],
    [['operations_manager', 'marketing_contributor'], 'marketing', true],
  ] as const)('%j → %s link shown: %s', (roles, workspace, shown) => {
    const out = html(
      <WorkspaceLink user={as(...roles)} workspace={workspace}>
        Open
      </WorkspaceLink>,
    );
    if (shown) expect(out).toMatch(new RegExp(`href="https?://[^"]+/${workspace}"`));
    else expect(out).toBe('');
  });
});
