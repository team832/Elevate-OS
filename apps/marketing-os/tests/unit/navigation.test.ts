import { describe, expect, it } from 'vitest';
import type { Principal } from '@elevate/authorization';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { NAV, navFor, tabsFor } from '../../src/ui/shell';

const as = (role: RoleKey): Principal => ({ id: 'u-test' as UserId, roles: [role] });

/** Brief 23 Oct 2026 §9, in order. */
const BRIEF_NAV = [
  'Overview',
  'My Day',
  'Leads',
  'Sales Calls and Follow-ups',
  'Campaigns',
  'Marketing Calendar',
  'Ideas',
  'Content and Deliverables',
  'SEO / AIO / GEO',
  'Targets',
  'My Tasks',
  'My Work Updates',
  'Reports',
  'HR Requests',
  'Personal Settings',
];
const PENDING: string[] = [];

describe('Marketing navigation', () => {
  it('declares exactly the 15 sections of the brief, in order', () => {
    expect([...new Set(NAV.map((n) => n.label))]).toEqual(BRIEF_NAV);
  });

  it('a manager gets every built section, in the brief order, and no dead link', () => {
    const nav = navFor(as('marketing_manager'), 'eod');
    expect(nav.map((n) => n.label)).toEqual(BRIEF_NAV.filter((l) => !PENDING.includes(l)));
    expect(nav.find((n) => n.label === 'Sales Calls and Follow-ups')!.href).toBe(
      '/marketing/sales-calls',
    );
    expect(nav.filter((n) => n.active).map((n) => n.label)).toEqual(['My Work Updates']);
  });

  it('a marketing employee gets the same list without the team Overview', () => {
    expect(
      navFor(as('marketing_contributor'), 'my-attendance').map((n) => [n.label, !!n.active]),
    ).toEqual(
      BRIEF_NAV.filter((l) => l !== 'Overview' && !PENDING.includes(l)).map((l) => [
        l,
        l === 'My Day',
      ]),
    );
  });

  it.each([
    ['marketing_manager', 'campaigns'],
    ['marketing_contributor', 'my-campaigns'],
    ['director', 'campaigns'],
    ['auditor', 'campaigns'],
  ] as const)(
    '%s sees only items it holds the permission for, all inside /marketing',
    (role, active) => {
      const nav = navFor(as(role), active);
      expect(nav.every((n) => n.href.startsWith('/marketing'))).toBe(true);
      expect(nav.filter((n) => n.active).map((n) => n.label)).toEqual(['Campaigns']);
      expect(nav.map((n) => n.label).join(' ')).not.toMatch(/student|kyc|fee|review|guardian/i);
    },
  );

  it('filters tabs by permission and hides a lone tab', () => {
    const manager = as('marketing_manager');
    expect(tabsFor(manager, 'follow-ups')).toEqual([
      ['/marketing/sales-calls', 'Sales calls'],
      ['/marketing/follow-ups', 'Follow-ups'],
    ]);
    expect(tabsFor(manager, 'leads').map(([, l]) => l)).toEqual(['Leads', 'Lead stages']);
    expect(tabsFor(manager, 'campaigns')).toEqual([
      ['/marketing/campaigns', 'Campaigns'],
      ['/marketing/my-campaigns', 'Assigned to me'],
      ['/marketing/accounts', 'Accounts'],
    ]);
    expect(tabsFor(manager, 'reports').map(([, l]) => l)).toEqual([
      'Weekly report',
      'Metrics import',
      'Monthly report',
    ]);
    expect(tabsFor(as('teacher'), 'calendar')).toEqual([]);
  });
});
