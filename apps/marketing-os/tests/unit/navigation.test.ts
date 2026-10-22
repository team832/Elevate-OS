import { describe, expect, it } from 'vitest';
import type { Principal } from '@elevate/authorization';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { navFor, tabsFor } from '../../src/ui/shell';

const as = (role: RoleKey): Principal => ({ id: 'u-test' as UserId, roles: [role] });

describe('Marketing navigation', () => {
  it('lists the sections in work order, with the mounted Business Ops screens and no Events', () => {
    expect(
      navFor(as('marketing_manager'), 'eod').map((n) => [n.label, n.href, !!n.active]),
    ).toEqual([
      ['Overview', '/marketing', false],
      ['Leads', '/marketing/leads', false],
      ['Follow-ups', '/marketing/follow-ups', false],
      ['Campaigns', '/marketing/campaigns', false],
      ['Content Calendar', '/marketing/calendar', false],
      ['Tasks', '/marketing/tasks', false],
      ['EOD Reports', '/marketing/tasks?tab=eod', true],
      ['Reports', '/marketing/metrics/weekly', false],
    ]);
  });

  it.each(['marketing_manager', 'marketing_contributor', 'director', 'auditor'] as const)(
    '%s sees only items it holds the permission for, all inside /marketing',
    (role) => {
      const nav = navFor(as(role), 'campaigns');
      expect(nav.every((n) => n.href.startsWith('/marketing'))).toBe(true);
      expect(nav.filter((n) => n.active).map((n) => n.label)).toEqual(['Campaigns']);
      expect(nav.map((n) => n.label).join(' ')).not.toMatch(/student|kyc|fee|review|guardian/i);
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
