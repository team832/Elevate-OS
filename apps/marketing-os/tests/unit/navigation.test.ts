import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { can, type Principal } from '@elevate/authorization';
import { ROLE_KEYS, type RoleKey, type UserId } from '@elevate/shared-types';
import { NAV, navFor, tabsFor } from '../../src/ui/shell';

const as = (role: RoleKey): Principal => ({ id: 'u-test' as UserId, roles: [role] });

/** Site map (Blueprint step 3, 6 Nov 2026), in order; Settings is the link at the rail's foot. */
const SITE_MAP = [
  ['Today', 'Overview'],
  ['Today', 'My day'],
  ['Leads', 'Leads'],
  ['Leads', 'Calls and follow-ups'],
  ['Plan and make', 'Campaigns'],
  ['Plan and make', 'Marketing calendar'],
  ['Plan and make', 'Ideas'],
  ['Plan and make', 'Content and deliverables'],
  ['Results', 'SEO / AIO / GEO'],
  ['Results', 'Targets'],
  ['Results', 'Reports'],
  ['My work', 'My tasks'],
  ['My work', 'My attendance and leave'],
  ['My work', 'My payslips'],
  ['My work', 'My reports'],
  ['My work', 'Requests to HR'],
];
const LABELS = SITE_MAP.map(([, label]) => label);
/** The permission a page checks, read from its file (src/app/<path>/page.tsx). */
const pagePermission = (href: string) =>
  readFileSync(
    new URL(
      `../../src/app/${href.replace(/^\/marketing\/?/, '').replace(/.+/, '$&/')}page.tsx`,
      import.meta.url,
    ),
    'utf8',
  ).match(/permission="([\w:]+)"/)?.[1];

describe('Marketing navigation', () => {
  it('declares the site map sections, grouped, in order', () => {
    expect(NAV.map((n) => [n.group, n.label])).toEqual(SITE_MAP);
  });

  it('a manager gets every section, in order, and no dead link', () => {
    const nav = navFor(as('marketing_manager'), 'eod');
    expect(nav.map((n) => n.label)).toEqual(LABELS);
    expect(nav.find((n) => n.label === 'Calls and follow-ups')!.href).toBe(
      '/marketing/sales-calls',
    );
    expect(nav.find((n) => n.label === 'My attendance and leave')!.href).toBe(
      '/marketing/my-attendance',
    );
    expect(nav.filter((n) => n.active).map((n) => n.label)).toEqual(['My reports']);
  });

  it('a marketing employee gets the same list without the team Overview', () => {
    expect(
      navFor(as('marketing_contributor'), 'my-attendance').map((n) => [n.label, !!n.active]),
    ).toEqual(
      LABELS.filter((l) => l !== 'Overview').map((l) => [l, l === 'My attendance and leave']),
    );
  });

  it.each([
    ['content', 'Content and deliverables'],
    ['team-review', 'My tasks'],
    ['my-campaigns', 'Campaigns'],
  ])('a %s page lights up %s', (active, label) => {
    expect(
      navFor(as('marketing_manager'), active)
        .filter((n) => n.active)
        .map((n) => n.label),
    ).toEqual([label]);
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
    expect(tabsFor(manager, 'leads').map(([, l]) => l)).toEqual([
      'Leads',
      'Lead stages',
      'Lead sharing',
    ]);
    expect(tabsFor(as('marketing_contributor'), 'leads').map(([, l]) => l)).toEqual([
      'Leads',
      'Lead stages',
    ]);
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

  it('Personal settings is a tab of Settings, not a rail item', () => {
    expect(tabsFor(as('marketing_contributor'), 'personal-settings')).toEqual([
      ['/marketing/settings', 'Rules and settings'],
      ['/marketing/settings/personal', 'Personal settings'],
    ]);
    expect(navFor(as('marketing_contributor'), 'personal-settings').some((n) => n.active)).toBe(
      false,
    );
  });

  it('each rail item asks for the permission its page checks', () => {
    for (const n of NAV) expect(n.permission, n.label).toBe(pagePermission(`/marketing/${n.path}`));
  });

  it.each(ROLE_KEYS)('%s: every item and tab it is shown opens for it', (role) => {
    const u = as(role);
    const tabs = ['leads', 'follow-ups', 'campaigns', 'reports', 'settings'].flatMap((k) =>
      tabsFor(u, k),
    );
    for (const href of [...navFor(u, '').map((n) => n.href), ...tabs.map(([h]) => h)])
      expect(can(u, pagePermission(href) as never), `${role} ${href}`).toBe(true);
  });
});
