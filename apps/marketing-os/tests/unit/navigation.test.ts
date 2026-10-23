import { describe, expect, it } from 'vitest';
import type { Principal } from '@elevate/authorization';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { navFor, tabsFor } from '../../src/ui/shell';

const as = (role: RoleKey): Principal => ({ id: 'u-test' as UserId, roles: [role] });

describe('Marketing navigation', () => {
  it('managers keep the module sections plus team review', () => {
    expect(
      navFor(as('marketing_manager'), 'eod').map((n) => [n.label, n.href, !!n.active]),
    ).toEqual([
      ['Overview', '/marketing', false],
      ['Leads', '/marketing/leads', false],
      ['Follow-ups', '/marketing/follow-ups', false],
      ['Campaigns', '/marketing/campaigns', false],
      ['Content Calendar', '/marketing/calendar', false],
      ['Tasks', '/marketing/tasks', false],
      ['Team review', '/marketing/tasks?tab=all&status=in_review', false],
      ['EOD Reports', '/marketing/tasks?tab=eod', true],
      ['My Attendance', '/marketing/my-attendance', false],
      ['Reports', '/marketing/metrics/weekly', false],
    ]);
  });

  it('a marketing employee gets their own work, in the brief order (§16)', () => {
    expect(navFor(as('marketing_contributor'), 'my-day').map((n) => [n.label, !!n.active])).toEqual(
      [
        ['My Day', true],
        ['My Tasks', false],
        ['Assigned Campaigns', false],
        ['Deliverables', false],
        ['Content Calendar', false],
        ['Follow-ups', false],
        ['My Attendance', false],
        ['My Reports', false],
      ],
    );
  });

  it.each([
    ['marketing_manager', 'Campaigns'],
    ['marketing_contributor', 'Assigned Campaigns'],
    ['director', 'Campaigns'],
    ['auditor', 'Campaigns'],
  ] as const)(
    '%s sees only items it holds the permission for, all inside /marketing',
    (role, label) => {
      const nav = navFor(as(role), label === 'Campaigns' ? 'campaigns' : 'my-campaigns');
      expect(nav.every((n) => n.href.startsWith('/marketing'))).toBe(true);
      expect(nav.filter((n) => n.active).map((n) => n.label)).toEqual([label]);
      // Managers' "Team review" is staff task review; no one gets a student-review item.
      const labels = nav.map((n) => n.label).filter((l) => l !== 'Team review');
      expect(labels.join(' ')).not.toMatch(/student|kyc|fee|review|guardian/i);
      if (role === 'marketing_contributor') expect(labels).toHaveLength(nav.length);
    },
  );

  it('filters tabs by permission and hides a lone tab', () => {
    const manager = as('marketing_manager');
    expect(tabsFor(manager, 'campaigns')).toEqual([
      ['/marketing/campaigns', 'Campaigns'],
      ['/marketing/accounts', 'Accounts'],
    ]);
    expect(tabsFor(manager, 'reports').map(([, l]) => l)).toEqual([
      'Weekly report',
      'Metrics import',
    ]);
    expect(tabsFor(as('teacher'), 'calendar')).toEqual([]);
  });
});
