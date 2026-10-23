/**
 * Marketing employee experience (brief 23 Oct 2026 §16, §20 scenario 7): an HR-assigned task
 * arrives in Marketing OS unchanged, only its owner can open it, and approval never publishes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import {
  departments,
  marketingContentItems,
  marketingPublishingAttempts,
  marketingPublishingRecords,
  staffMembers,
} from '@elevate/database';
import { workRoutes } from '@elevate/business-ops-os/work';
import { authedRequest, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { toIsoDate } from '@elevate/shared-types';
import { GET as taskRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { GET as myTasksRoute } from '../../src/app/api/v1/staff-tasks/route';
import { POST as actionRoute } from '../../src/app/api/v1/staff-tasks/[id]/[action]/route';
import { GET as attachmentRoute } from '../../src/app/api/v1/attachments/[id]/route';
import DashboardPage from '../../src/app/page';
import DeliverablesPage from '../../src/app/deliverables/page';
import MyDayPage from '../../src/app/my-day/page';
import { TASK_PUBLISHED_TEXT } from '../../src/domain';
import { createContentItem, createIdea, setAssignment } from '../../src/server';
import { call, seedRegistry, uniqueTitle } from '../helpers';

const ctx = setupTestDatabase();
const dir = mkdtempSync(path.join(os.tmpdir(), 'elevate-mkt-attachments-'));
const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@elevate/database', async (real) => ({
  ...(await real<typeof import('@elevate/database')>()),
  getDb: () => ctx.db,
}));
// The frame's auth and Suspense are tested elsewhere; here it just hands over the user.
vi.mock('../../src/ui/shell', async (real) => ({
  ...(await real<typeof import('../../src/ui/shell')>()),
  MarketingPage: (p: { children: (u: unknown) => unknown }) => p.children(state.user),
  Section: (p: { load: () => unknown }) => p.load(),
}));

type Staff = TestUser & { staffId: string };
let hr: Staff;
let chitra: Staff;
let dev: Staff;
let taskId: string;
let attachmentId: string;
let contentId: string;
const today = toIsoDate();

let departmentId: string;
/** Fictional staff in Marketing & Growth (inside HR's proposed staff scope). */
async function person(role: 'hr_manager' | 'marketing_contributor', name: string): Promise<Staff> {
  const user = await createTestUser(ctx.db, { roles: [role] });
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: name, departmentId: departmentId as never })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}

const render = async (page: Promise<React.ReactNode>, user: TestUser) => {
  state.user = user;
  const html = await new Response((await prerender(await page)).prelude).text();
  return html.replaceAll('<!-- -->', '');
};
const download = (user: TestUser) =>
  attachmentRoute(authedRequest(user, `/marketing/api/v1/attachments/${attachmentId}`), {
    params: Promise.resolve({ id: attachmentId }),
  });
const version = async (user: TestUser) =>
  (await call<{ version: number }>(taskRoute, user, '/x', { params: { id: taskId } })).data!
    .version;

beforeAll(async () => {
  vi.stubEnv('ATTACHMENTS_DIR', dir);
  await seedRegistry(ctx.db);
  const [dept] = await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoUpdate({ target: departments.code, set: { name: 'Marketing & Growth' } })
    .returning({ id: departments.id });
  departmentId = dept!.id;
  hr = await person('hr_manager', 'Sample HR Manager');
  chitra = await person('marketing_contributor', 'Sample Marketer Chitra');
  dev = await person('marketing_contributor', 'Sample Marketer Dev');
  // HR assigns from Business Operations (the same handler the Ops route serves).
  const created = await call<{ id: string }>(
    workRoutes['staff-tasks'].POST,
    hr,
    '/ops/api/v1/staff-tasks',
    {
      json: {
        title: 'Sample: three IPMAT admission creatives',
        details: 'Prepare three creatives for the sample IPMAT admission campaign.',
        staffId: chitra.staffId,
        dueOn: today,
        dueTime: '16:00',
        category: 'Creative',
        expectedDeliverable: 'Three previews and their source files',
        acceptanceCriteria: 'Brand colours; no student photos without consent.',
        reviewRequired: true,
        reviewerStaffId: hr.staffId,
      },
    },
  );
  expect(created.status).toBe(201);
  taskId = created.data!.id;
  const upload = await call<{ id: string }>(
    workRoutes.attachments.POST,
    hr,
    '/ops/api/v1/attachments',
    {
      json: {
        ownerKind: 'task',
        ownerId: taskId,
        purpose: 'reference',
        name: 'sample-brief.pdf',
        mime: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64'),
      },
    },
  );
  expect(upload.status).toBe(201);
  attachmentId = upload.data!.id;
  const manager = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  const { idea } = await createIdea(ctx.db, manager, {
    coursePrefix: 'IPMAT',
    title: uniqueTitle(),
  });
  contentId = (
    await createContentItem(ctx.db, manager, idea.id, { title: 'Sample creative', format: 'image' })
  ).id;
  await setAssignment(ctx.db, manager, contentId, { role: 'designer', userId: chitra.id });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('scenario 7: HR assigns a creative task to a marketer', () => {
  it('arrives in Marketing OS with the same deadline, brief, attachment and acceptance criteria', async () => {
    const res = await call(taskRoute, chitra, '/marketing/api/v1/staff-tasks/x', {
      params: { id: taskId },
    });
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.data);
    for (const text of [
      'Sample: three IPMAT admission creatives',
      'Prepare three creatives for the sample IPMAT admission campaign.',
      'Brand colours; no student photos without consent.',
      'Three previews and their source files',
      today,
      '16:00',
    ])
      expect(body).toContain(text);
    const mine = await call<{ rows: { id: string }[] }>(
      myTasksRoute,
      chitra,
      '/marketing/api/v1/staff-tasks',
    );
    expect(mine.data!.rows.map((r) => r.id)).toEqual([taskId]);
    expect((await download(chitra)).status).toBe(200);
  });

  it('another marketer gets 404 for the task and its attachment, and sees nothing in their list', async () => {
    expect((await call(taskRoute, dev, '/x', { params: { id: taskId } })).status).toBe(404);
    expect((await download(dev)).status).toBe(404);
    const theirs = await call<{ rows: unknown[] }>(
      myTasksRoute,
      dev,
      '/marketing/api/v1/staff-tasks',
    );
    expect(theirs.data!.rows).toEqual([]);
  });

  it('My day and Deliverables show the task and the content, approval and publishing kept apart', async () => {
    const day = await render(MyDayPage({ searchParams: Promise.resolve({}) }), chitra);
    expect(day).toContain('Sample: three IPMAT admission creatives');
    const list = await render(DeliverablesPage({ searchParams: Promise.resolve({}) }), chitra);
    expect(list).toContain('Three previews and their source files');
    expect(list).toContain('Sample creative');
    expect(list).toContain('Not published');
    expect(list).toContain(TASK_PUBLISHED_TEXT);
    expect(list).not.toContain('data-label="Approved">Approved<');
    const other = await render(DeliverablesPage({ searchParams: Promise.resolve({}) }), dev);
    expect(other).not.toContain('Sample: three IPMAT admission creatives');
    expect(other).not.toContain('Sample creative');
  });

  it('task approval never publishes or sends anything', async () => {
    const act = async (user: TestUser, action: string, json: Record<string, unknown> = {}) =>
      call(actionRoute, user, '/x', {
        params: { id: taskId, action },
        json: { expectedVersion: await version(user), ...json },
      });
    expect((await act(chitra, 'start')).status).toBe(200);
    const submitted = await act(chitra, 'submit-for-review', {
      completionNote: 'Three sample creatives are ready.',
      evidence: `Content item ${contentId} in Marketing OS`,
    });
    expect(submitted.status).toBe(200);
    expect((await act(hr, 'approve')).status).toBe(200);

    const [item] = await ctx.db
      .select({ state: marketingContentItems.state })
      .from(marketingContentItems)
      .where(eq(marketingContentItems.id, contentId as never));
    expect(item!.state).toBe('draft');
    expect(await ctx.db.select().from(marketingPublishingRecords)).toEqual([]);
    expect(await ctx.db.select().from(marketingPublishingAttempts)).toEqual([]);
    const list = await render(DeliverablesPage({ searchParams: Promise.resolve({}) }), chitra);
    expect(list).toContain('data-label="Approved">Approved<');
    expect(list).toContain(TASK_PUBLISHED_TEXT);
  });

  it('a marketing employee opening / is sent to My day', async () => {
    await expect(
      render(DashboardPage({ searchParams: Promise.resolve({}) }), chitra),
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
