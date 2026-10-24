/**
 * Screens of SEO/AIO/GEO, Targets and the monthly report (brief 23 Oct 2026 §14, §15, §24):
 * honest empty states, "Not connected" / "Manual" labels, metric definitions with sources,
 * "Not available" instead of 0, chart rows = drill-down rows, no spend claims.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import {
  departments,
  marketingCalendarItems,
  marketingOptimisationCategories,
  staffMembers,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import OptimisationPage from '../../src/app/optimisation/page';
import OptimisationItemPage from '../../src/app/optimisation/[id]/page';
import TargetsPage from '../../src/app/targets/page';
import TargetPage from '../../src/app/targets/[id]/page';
import MonthlyReportPage from '../../src/app/reports/monthly/page';
import { NO_CALL_TARGET, TARGET_METRICS } from '../../src/domain/metrics';
import { NO_GUARANTEE, ONE_OBSERVATION } from '../../src/domain/optimisation';
import { addObservation, createOptimisationItem } from '../../src/server/optimisation';
import { createTarget } from '../../src/server/targets';

const ctx = setupTestDatabase();
const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@elevate/database', async (real) => ({
  ...(await real<typeof import('@elevate/database')>()),
  getDb: () => ctx.db,
}));
vi.mock('../../src/ui/shell', async (real) => ({
  ...(await real<typeof import('../../src/ui/shell')>()),
  MarketingPage: (p: { children: (u: unknown) => unknown }) => p.children(state.user),
  Section: (p: { load: () => unknown }) => p.load(),
}));

type Page = (props: {
  searchParams: Promise<Record<string, string>>;
  params: Promise<{ id: string }>;
}) => Promise<React.ReactNode>;
const render = async (user: TestUser, Page: Page, id = '', sp: Record<string, string> = {}) => {
  state.user = user;
  const node = await Page({ searchParams: Promise.resolve(sp), params: Promise.resolve({ id }) });
  const html = await new Response((await prerender(<>{node}</>)).prelude).text();
  return html.replaceAll('<!-- -->', '').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
};

let manager: TestUser & { staffId: string };
let contributor: TestUser;

beforeAll(async () => {
  const [dept] = await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoNothing()
    .returning({ id: departments.id });
  const user = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: 'Sample Marketing Manager', departmentId: dept!.id })
    .returning({ id: staffMembers.id });
  manager = { ...user, staffId: s!.id };
  contributor = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
});

describe('SEO / AIO / GEO screens', () => {
  it('with no categories: says so, shows "Not connected" and offers no form', async () => {
    const html = await render(manager, OptimisationPage as Page);
    expect(html).toContain('No categories configured');
    expect(html).toContain('Not connected');
    expect(html).toContain(NO_GUARANTEE);
    expect(html).not.toContain('New work item');
    expect(html).not.toMatch(/guarantees? (higher )?rank/i);
  });

  it('explains configured meanings; the item page labels observations Manual', async () => {
    await ctx.db.insert(marketingOptimisationCategories).values({
      key: 'geo',
      label: 'GEO',
      meaning: 'Sample meaning: being cited in AI-generated answers.',
    });
    const item = await createOptimisationItem(ctx.db, manager, {
      pageUrl: 'https://example.test/ipmat',
      topic: 'Sample IPMAT page answers',
      categoryKey: 'geo',
      checks: ['student_answers'],
    });
    await addObservation(ctx.db, manager, item.id, {
      platform: 'Perplexity',
      query: 'ipmat coaching sikar',
      observedOn: '2026-10-21',
      result: 'Sample: listed third, no link.',
    });
    const list = await render(manager, OptimisationPage as Page);
    expect(list).toContain('Sample meaning: being cited in AI-generated answers.');
    expect(list).toContain('Sample IPMAT page answers');
    expect(list).toContain('0 of 1 done');
    expect(list).toContain('New work item');
    const detail = await render(manager, OptimisationItemPage as Page, item.id);
    expect(detail).toContain(ONE_OBSERVATION);
    expect(detail).toContain('>Manual<');
    expect(detail).toContain('Log manual observation');
    expect(detail).not.toContain('Save review'); // own item: no self-review form
  });
});

describe('Targets screens', () => {
  it('define all seven metrics with their source, never a call count, and show missing as "Not available"', async () => {
    const at = new Date('2026-10-06T10:00:00+05:30');
    await ctx.db.insert(marketingCalendarItems).values({
      title: 'Sample approved reel',
      itemType: 'short_video',
      status: 'approved',
      plannedAt: at,
      originalPlannedAt: at,
      ownerStaffId: manager.staffId as never,
      approvedAt: at,
      approvedBy: manager.id,
      createdBy: manager.id,
      isSample: true,
    });
    const base = {
      scope: 'employee',
      staffId: manager.staffId,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    } as const;
    const content = await createTarget(ctx.db, manager, {
      ...base,
      metricKey: 'approved_content',
      targetValue: 4,
    });
    // A team lead target: counted for the manager, "Not available" to an employee (own leads only).
    await createTarget(ctx.db, manager, {
      ...base,
      scope: 'team',
      staffId: null,
      metricKey: 'demo_bookings',
      targetValue: 10,
    });
    const html = await render(manager, TargetsPage as Page, '', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    for (const m of Object.values(TARGET_METRICS)) {
      expect(html).toContain(m.label);
      expect(html).toContain(`Source: ${m.sourceLabel}.`);
    }
    expect(html).toContain(NO_CALL_TARGET);
    expect(html).toContain('>proposed</span>');
    expect(html).toContain('25%'); // 1 of 4
    expect(html).toContain('0%'); // no demo bookings yet: a counted zero, not a missing value
    expect(html).toContain('Set a target');
    const drill = await render(manager, TargetPage as Page, content.id);
    expect(drill).toContain('Records counted (1)');
    expect(drill).toContain('Sample approved reel');
    expect(drill).toContain('Change or remove');
    const asEmployee = await render(contributor, TargetsPage as Page, '', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(asEmployee).not.toContain('Set a target');
    expect(asEmployee).toContain('Not available');
    expect(asEmployee).toContain('Not in the chart: 1 target whose source is not available');
  });
});

describe('Monthly report screen', () => {
  it('shows counted facts, keeps Ops parts "Not available" and claims no spend', async () => {
    const html = await render(manager, MonthlyReportPage as Page, '', { month: '2026-10' });
    expect(html).toContain('Sample Marketing Manager, October 2026');
    expect(html).toContain('No verified spend data');
    expect(html).toContain('Leads by stage reached');
    expect(html).toContain('Not available');
    expect(html).toContain('Write and submit your monthly report');
    // Ops sends period reports to the reporting manager (eod-reports.ts), not to HR.
    expect(html).toContain('Submitted for review (goes to your reporting manager)');
    expect(html).not.toMatch(/to HR/);
    expect(html).toContain('/marketing/my-reports?kind=month&amp;date=2026-10-01');
    expect(html).toContain('Print these facts');
  });

  it('an employee without a staff record gets a plain explanation', async () => {
    await expect(render(contributor, MonthlyReportPage as Page)).rejects.toThrow(
      /not linked to a staff record/,
    );
  });
});
