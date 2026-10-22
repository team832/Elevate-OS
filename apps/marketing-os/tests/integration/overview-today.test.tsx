/** Overview "Today" block: follow-up counts from Business Ops' followUpDaySummary (D-073). */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { opsLeadSources, staffMembers } from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { toIsoDate } from '@elevate/shared-types';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as createFollowUp } from '../../src/app/api/v1/follow-ups/route';
import DashboardPage from '../../src/app/page';
import { call, seedRegistry } from '../helpers';

const ctx = setupTestDatabase();
const state = vi.hoisted(() => ({ user: null as unknown, failFollowUps: false }));

vi.mock('@elevate/database', async (real) => ({
  ...(await real<typeof import('@elevate/database')>()),
  getDb: () => ctx.db,
}));
vi.mock('@elevate/business-ops-os/leads', async (real) => {
  const mod = await real<typeof import('@elevate/business-ops-os/leads')>();
  return {
    ...mod,
    followUpDaySummary: (...a: Parameters<typeof mod.followUpDaySummary>) =>
      state.failFollowUps ? Promise.reject(new Error('down')) : mod.followUpDaySummary(...a),
  };
});
// The frame's auth and Suspense are tested elsewhere; here it just hands over the user.
vi.mock('../../src/ui/shell', () => ({
  MarketingPage: (p: { children: (u: unknown) => unknown }) => p.children(state.user),
  Section: (p: { load: () => unknown }) => p.load(),
}));

const render = async (user: TestUser) => {
  state.user = user;
  const page = await DashboardPage({ searchParams: Promise.resolve({}) });
  const html = await new Response((await prerender(page)).prelude).text();
  return html.replaceAll('<!-- -->', '');
};
let manager: TestUser & { staffId: string };

beforeAll(async () => {
  await seedRegistry(ctx.db);
  await ctx.db.insert(opsLeadSources).values({ code: 'UNKNOWN', label: 'Unknown' });
  const user = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: 'Sample Marketing Manager' })
    .returning({ id: staffMembers.id });
  manager = { ...user, staffId: s!.id };
  const lead = await call<{ lead: { id: string } }>(
    createLead,
    manager,
    '/marketing/api/v1/leads',
    {
      json: { studentName: 'Sample Overview Lead', studentEmail: 'sample.overview@example.test' },
    },
  );
  for (const dueDate of [toIsoDate(), '2020-01-01'])
    expect(
      (
        await call(createFollowUp, manager, '/marketing/api/v1/follow-ups', {
          json: { leadId: lead.data!.lead.id, kind: 'general', dueDate, ownerStaffId: s!.id },
        })
      ).status,
    ).toBe(201);
});

describe('Marketing Overview: follow-up counts', () => {
  it('shows due today and overdue as tiles that open the list, with an as-of time', async () => {
    const html = await render(manager);
    const tile = (href: string, label: string, value: string) =>
      `<a href="${href}" class="el-stat el-kpi"><span class="el-stat-label">${label}</span><span class="el-stat-value">${value}</span>`;
    expect(html).toContain(
      tile('/marketing/follow-ups?view=due_today', 'Follow-ups due today', '1'),
    );
    expect(html).toContain(tile('/marketing/follow-ups?view=overdue', 'Follow-ups overdue', '1'));
    expect(html).toContain('0 upcoming in the next 2 days · as of ');
  });

  it.each([
    ['no staff record', false, 'so your follow-ups cannot be shown'],
    ['a failed load', true, 'Follow-up counts could not be loaded.'],
  ])('%s shows a message, never 0', async (_, fail, text) => {
    state.failFollowUps = fail;
    const user = fail
      ? manager
      : await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
    const html = await render(user);
    state.failFollowUps = false;
    expect(html).toContain(text);
    expect(html).not.toContain('view=due_today');
  });
});
