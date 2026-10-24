import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { rangeOf } from '../../src/server/overview';
import { NAV } from '../../src/ui/frame';
import { FeesNav, PeopleNav } from '../../src/ui/admissions-nav';
import { WorkspaceLink } from '../../src/app/_components/workspace-link';

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

describe('Business Operations navigation (brief 22 Oct 2026 §5)', () => {
  it('top items in the agreed order; Settings stays at the sidebar foot', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Overview',
      'My attendance',
      'My reports',
      'Requests through HR', // HR-REQ
      'Admissions',
      'Demo Students',
      'Active Students',
      'Past Students',
      'Fees and Collections',
      'Teachers',
      'Academic Summary',
      'Tests and Mock Tests', // TESTS-OPS
      'Tasks and EOD Reports',
      // HR section (brief 23 Oct 2026 §6)
      'HR Overview',
      'Staff Directory',
      'Teaching Assignments',
      'Attendance',
      'Tasks',
      'Submission Review',
      'Staff Requests', // HR-REQ
      'Work Reports',
      'Student Feedback about Teachers',
      'HR Settings',
      'Marketing Summary',
      'Reports',
    ]);
  });

  it.each([
    ['leads', 'Admissions'],
    ['applications', 'Admissions'],
    ['meetings', 'Admissions'],
    ['approvals', 'Fees and Collections'],
    ['staff', 'Teachers'],
    ['tasks-inbox', 'Tasks and EOD Reports'],
    ['tasks-reports', 'Tasks and EOD Reports'],
    ['tasks-imports', 'Tasks and EOD Reports'],
  ])('a %s page lights up %s', (key, label) => {
    expect(NAV.filter((n) => n.keys.has(key)).map((n) => n.label)).toEqual([label]);
  });

  it.each([
    [
      'finance_officer',
      ['Overview', 'Admissions', 'Fees and Collections', 'Tasks and EOD Reports', 'Reports'],
      ['Academic Summary', 'Marketing Summary', 'Teachers'],
    ],
    ['operations_manager', ['Academic Summary', 'Marketing Summary', 'Teachers'], []],
    [
      'admissions_counsellor',
      ['Demo Students', 'Teachers'],
      ['Academic Summary', 'Marketing Summary'],
    ],
  ])('%s sees only permitted items', (role, shown, hidden) => {
    const labels = NAV.filter((n) => can(as(role), n.permission)).map((n) => n.label);
    for (const l of shown) expect(labels).toContain(l);
    for (const l of hidden) expect(labels).not.toContain(l);
  });

  it('area tabs keep Approvals and the staff directory reachable, each with its permission', () => {
    const fees = html(<FeesNav current="collections" user={as('finance_officer')} />);
    for (const t of ['Fee structure', 'Collections', 'Outstanding', 'Approvals'])
      expect(fees).toContain(`>${t}</a>`);
    expect(html(<PeopleNav current="teachers" user={as('operations_manager')} />)).toContain(
      '>All staff</a>',
    );
    expect(html(<FeesNav current="structure" user={as('teacher')} />)).not.toContain('Collections');
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
