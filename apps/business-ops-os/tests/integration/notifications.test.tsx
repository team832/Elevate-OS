/**
 * Notifications inbox (brief §9): own rows only, newest first, paged; mark read by id or all;
 * links open in the viewer's workspace (Ops code hosted by Academic/Marketing, D-073).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { appOrigin } from '@elevate/configuration/workspaces';
import { notifications } from '@elevate/database';
import { notify } from '@elevate/notifications';
import type { NotificationId } from '@elevate/shared-types';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET, POST } from '../../src/app/api/v1/notifications/route';
import { GET as open } from '../../src/app/notifications/[id]/open/route';
import { NotificationsBody } from '../../src/work';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
// Teachers reach the shared route through Academic (a route under /ops needs Ops membership, D-072).
const URL_ = '/academic/api/v1/notifications';
type Page = {
  items: { id: string; title: string; readAt: string | null }[];
  total: number;
  unread: number;
};
const list = (u: TestUser, query = '') => callRoute<Page>(GET, authedRequest(u, `${URL_}${query}`));
const mark = (u: TestUser, json: unknown) =>
  callRoute<{ marked: number; unread: number }>(
    POST,
    authedRequest(u, URL_, { method: 'POST', json }),
  );

let teacher: TestUser;
let other: TestUser;
let othersId: NotificationId;

beforeAll(async () => {
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
  other = await createTestUser(ctx.db, { roles: ['teacher'] });
  // A minute apart, so "newest first" is certain.
  await ctx.db.insert(notifications).values(
    Array.from({ length: 30 }, (_, k) => ({
      userId: teacher.id,
      module: 'ops' as const,
      kind: 'task.assigned',
      title: `Sample notice ${k + 1}`,
      link: k === 29 ? '/academic/tasks/abc' : '/ops/admissions/xyz',
      createdAt: new Date(Date.UTC(2026, 9, 1) + k * 60_000),
    })),
  );
  othersId = (
    await notify(ctx.db, {
      userIds: [other.id],
      module: 'ops',
      kind: 'task.assigned',
      title: 'Sample private notice',
    })
  )[0]!;
});

describe('GET /api/v1/notifications', () => {
  it('401 signed out, 403 without a role', async () => {
    expect((await callRoute(GET, buildRequest(URL_))).status).toBe(401);
    const nobody = await createTestUser(ctx.db, { roles: [] });
    expect((await list(nobody)).status).toBe(403);
  });

  it('lists only my notifications, newest first, 25 a page, with totals', async () => {
    const one = await list(teacher);
    expect(one.status).toBe(200);
    expect(one.data).toMatchObject({ total: 30, unread: 30 });
    expect(one.data!.items).toHaveLength(25);
    expect(one.data!.items[0]!.title).toBe('Sample notice 30');
    const two = await list(teacher, '?page=2');
    expect(two.data!.items.map((n) => n.title)).toEqual(
      [5, 4, 3, 2, 1].map((i) => `Sample notice ${i}`),
    );
    expect(JSON.stringify([one.data, two.data])).not.toContain('Sample private notice');
  });
});

describe('POST /api/v1/notifications (mark read)', () => {
  it('another user’s id changes nothing', async () => {
    const res = await mark(teacher, { ids: [othersId] });
    expect(res.data).toMatchObject({ marked: 0 });
    const [row] = await ctx.db.select().from(notifications).where(eq(notifications.id, othersId));
    expect(row!.readAt).toBeNull();
  });

  it('rejects a body with neither ids nor all (400)', async () => {
    expect((await mark(teacher, {})).status).toBe(400);
    expect((await mark(teacher, { ids: ['not-a-uuid'] })).status).toBe(400);
  });

  it('marks one by id, then all', async () => {
    const first = (await list(teacher)).data!.items[0]!;
    expect((await mark(teacher, { ids: [first.id] })).data).toEqual({ marked: 1, unread: 29 });
    expect((await mark(teacher, { all: true })).data).toEqual({ marked: 29, unread: 0 });
    const [row] = await ctx.db.select().from(notifications).where(eq(notifications.id, othersId));
    expect(row!.readAt).toBeNull();
  });
});

describe('NotificationsBody', () => {
  it('resolves links for the host workspace and pages the list', async () => {
    const out = await html(<NotificationsBody user={teacher} base="/academic" searchParams={{}} />);
    // Every link opens through the permission-checked redirect (NOTIFY), never the stored path.
    expect(out).toMatch(/href="\/academic\/notifications\/[0-9a-f-]{36}\/open"/);
    expect(out).not.toContain('/ops/admissions/xyz');
    expect(out.replaceAll('<!-- -->', '')).toContain('Showing 1–25 of 30');
    expect(out).toContain('href="/academic/notifications?page=2"');
    expect(out).not.toContain('Sample private notice');
  });

  it('marks unread rows and offers "Mark all as read" only when something is unread', async () => {
    const fresh = await createTestUser(ctx.db, { roles: ['teacher'] });
    await notify(ctx.db, {
      userIds: [fresh.id],
      module: 'academic',
      kind: 'x',
      title: 'Sample new one',
    });
    const out = await html(<NotificationsBody user={fresh} base="/ops" searchParams={{}} />);
    expect(out).toContain('Unread');
    expect(out).toContain('Mark all as read');
    await mark(fresh, { all: true });
    const after = await html(<NotificationsBody user={fresh} base="/ops" searchParams={{}} />);
    expect(after).not.toContain('Mark all as read');
  });

  it('says what will appear here when there is nothing', async () => {
    const empty = await createTestUser(ctx.db, { roles: ['teacher'] });
    const out = await html(<NotificationsBody user={empty} base="/ops" searchParams={{}} />);
    expect(out).toContain('No notifications yet');
  });
});

describe('GET <base>/notifications/{id}/open across workspaces (NOTIFY)', () => {
  it('a link into another workspace the person belongs to opens on that origin', async () => {
    const both = await createTestUser(ctx.db, { roles: ['teacher', 'operations_manager'] });
    const [id] = await notify(ctx.db, {
      userIds: [both.id],
      module: 'ops',
      kind: 'x',
      title: 'Sample cross-workspace notice',
      link: '/ops/admissions',
    });
    const res = await callRoute(open, authedRequest(both, `/academic/notifications/${id}/open`), {
      id: id!,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${appOrigin('ops')}/ops/admissions`);
  });

  it('says "You no longer have access to this item" when sent back refused', async () => {
    const out = await html(
      <NotificationsBody user={teacher} base="/academic" searchParams={{ open: 'denied' }} />,
    );
    expect(out).toContain('You no longer have access to this item.');
  });
});
