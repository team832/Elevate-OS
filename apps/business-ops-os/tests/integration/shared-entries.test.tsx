/**
 * D-073: the task/EOD and lead screens and routes, mounted through the `./work` and `./leads`
 * entries by Academic OS and Marketing OS, keep their links in the host workspace and the same
 * permission checks; notifications land in a workspace the recipient belongs to.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { notifications } from '@elevate/database';
import { GET as studentsRoute } from '../../src/app/api/v1/students/route';
import { GET as kycRoute } from '../../src/app/api/v1/students/[id]/kyc/route';
import { GET as feesRoute } from '../../src/app/api/v1/fees/route';
import { GET as admissionsRoute } from '../../src/app/api/v1/admissions/route';
import { GET as reviewsRoute } from '../../src/app/api/v1/feedback/about-students/route';
import { FollowUpsBody, LeadBody, LeadsBody, leadsNav, leadsRoutes } from '../../src/leads';
import {
  InboxBody,
  linkUrl,
  TaskBody,
  TaskReportsBody,
  TasksBody,
  taskDaySummary,
  workNav,
  workRoutes,
} from '../../src/work';
import { setupReference, staffUser, phone, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));
// Client forms send to `action` from JavaScript; print it (and the redirect) so it can be checked.
vi.mock('../../src/ui/action-form', async (real) => ({
  ...(await real()),
  ActionForm: (p: { action: string; redirectTo?: string }) => (
    <form action={p.action} data-redirect={p.redirectTo} />
  ),
}));
vi.mock('../../src/ui/lead-create-form', () => ({
  LeadCreateForm: (p: { base: string }) => <form action={`${p.base}/api/v1/leads`} />,
}));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const post = (u: StaffUser, json: unknown, method = 'POST') =>
  authedRequest(u, '/x', { method, json });

let coordinator: StaffUser; // academic_coordinator: the teacher's manager, no Ops access
let teacher: StaffUser;
let counsellor: StaffUser;
let mm: StaffUser; // marketing_manager
let mc: StaffUser; // marketing_contributor
let teacherTask: string;
let counsellorTask: string;
let leadId: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  coordinator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
  teacher = await staffUser(ctx.db, ['teacher'], {
    managerId: coordinator.staffId,
    name: 'Sample Teacher',
  });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Counsellor' });
  mm = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Manager' });
  mc = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Contributor' });
  const create = async (u: StaffUser, title: string) =>
    (
      await callRoute<{ id: string }>(
        workRoutes['staff-tasks'].POST,
        post(u, { title, priority: 'medium', recurrence: 'none' }),
      )
    ).data!.id;
  teacherTask = await create(teacher, 'Sample: print worksheets');
  counsellorTask = await create(counsellor, 'Sample: call back');
  const lead = await callRoute<{ lead: { id: string } }>(
    leadsRoutes.leads.POST,
    post(counsellor, {
      studentName: 'Sample Student',
      studentPhone: phone(),
      programmeCode: 'CLAT',
      sourceCode: 'WALK_IN',
    }),
  );
  leadId = lead.data!.lead.id;
});
// The EOD facts ask Academic OS for teaching activity; it is "unavailable" here.
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('bodies render with the host basePath', () => {
  it.each<[string, Record<string, string>, string]>([
    ['my day', {}, 'action="/academic/api/v1/staff-tasks"'],
    ['tracker with a pop-up', { tab: 'all', open: 'TASK' }, 'href="/academic/tasks/'],
    ['log a task', { new: '1' }, 'data-redirect="/academic/tasks"'],
    ['EOD report', { tab: 'eod' }, 'action="/academic/api/v1/eod-reports"'],
  ])('Academic tasks: %s', async (_, sp, expected) => {
    const searchParams = { ...sp, open: sp.open && teacherTask };
    const out = await html(
      <TasksBody user={teacher} base="/academic" searchParams={searchParams} />,
    );
    expect(out).toContain(expected);
    expect(out).not.toContain('/ops/');
  });

  it('Academic: task page, inbox and reports', async () => {
    const out = [
      await html(<TaskBody user={teacher} base="/academic" id={teacherTask} />),
      await html(<InboxBody user={coordinator} base="/academic" searchParams={{}} />),
      await html(<TaskReportsBody user={coordinator} base="/academic" searchParams={{}} />),
    ].join('');
    expect(out).toContain('action="/academic/api/v1/staff-tasks/');
    expect(out).toContain('href="/academic/api/v1/task-reports?');
    expect(out).not.toContain('/ops/');
  });

  it('Marketing: leads list, pop-up, full lead and follow-ups', async () => {
    const out = [
      await html(<LeadsBody user={mm} base="/marketing" searchParams={{ open: leadId }} />),
      await html(<LeadsBody user={mm} base="/marketing" searchParams={{ new: '1' }} />),
      await html(<LeadBody user={mm} base="/marketing" id={leadId} searchParams={{}} />),
      await html(<FollowUpsBody user={mm} base="/marketing" searchParams={{ view: 'all' }} />),
    ].join('');
    expect(out).toContain(`href="/marketing/leads/${leadId}"`);
    expect(out).toContain('href="/marketing/follow-ups?view=overdue"');
    expect(out).toContain('action="/marketing/api/v1/leads"');
    expect(out).not.toContain('/ops/');
    // Admission details stay in Business Operations: stage only, no counsellor or reason.
    expect(out).toContain('Conversion stage per programme');
    expect(out).not.toContain('Counsellor</th>');
    expect(out).not.toContain('Book a demo');
  });

  it('nav rows point into the host', () => {
    expect([...workNav('/academic'), ...leadsNav('/marketing')].map((r) => r.href)).toEqual([
      '/academic/tasks',
      '/academic/tasks?tab=eod',
      '/academic/tasks/inbox',
      '/academic/tasks/reports',
      '/marketing/leads',
      '/marketing/follow-ups',
    ]);
  });
});

describe('routes through the entries keep the Ops permission checks', () => {
  it('teacher: own tasks and EOD yes, others’ tasks no, leads no', async () => {
    const r = workRoutes;
    const id = (v: string) => ({ id: v });
    expect(
      (await callRoute(r['staff-tasks/[id]'].GET, post(teacher, undefined, 'GET'), id(teacherTask)))
        .status,
    ).toBe(200);
    expect(
      (
        await callRoute(
          r['staff-tasks/[id]'].GET,
          post(teacher, undefined, 'GET'),
          id(counsellorTask),
        )
      ).status,
    ).toBe(404);
    const draft = await callRoute<{ id: string }>(
      r['eod-reports'].POST,
      post(teacher, { reportDate: new Date().toISOString().slice(0, 10), summary: 'Sample day' }),
    );
    expect(draft.status).toBe(200);
    expect(
      (
        await callRoute(
          r['eod-reports/[id]'].GET,
          post(teacher, undefined, 'GET'),
          id(draft.data!.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (await callRoute(r['eod-reports/[id]'].GET, post(mc, undefined, 'GET'), id(draft.data!.id)))
        .status,
    ).toBe(404);
    expect((await callRoute(leadsRoutes.leads.GET, post(teacher, undefined, 'GET'))).status).toBe(
      403,
    );
  });

  it('marketing manager: leads 200; students, KYC, fees, admissions and reviews 403', async () => {
    const get = (route: Parameters<typeof callRoute>[0], params = {}) =>
      callRoute(route, authedRequest(mm, '/x'), params);
    expect((await get(leadsRoutes.leads.GET)).status).toBe(200);
    const lead = await get(leadsRoutes['leads/[id]'].GET, { id: leadId });
    expect(lead.status).toBe(200);
    const d = lead.data as {
      admissions: object[];
      history: { entityType: string }[];
      privateVisible: boolean;
    };
    expect(Object.keys(d.admissions[0]!).sort()).toEqual([
      'code',
      'createdAt',
      'id',
      'programmeCode',
      'status',
    ]);
    expect(d.privateVisible).toBe(true); // ops:lead_contacts:read (D-073, Proposed)
    expect(d.history.every((h) => h.entityType !== 'admission')).toBe(true);
    expect(
      (
        await callRoute(
          leadsRoutes['leads/[id]/assign'].POST,
          post(mm, { ownerStaffId: mc.staffId }),
          { id: leadId },
        )
      ).status,
    ).toBe(200);
    for (const route of [studentsRoute, feesRoute, admissionsRoute, reviewsRoute])
      expect((await get(route)).status).toBe(403);
    expect((await get(kycRoute, { id: leadId })).status).toBe(403);
  });

  it('marketing contributor sees only own leads', async () => {
    const own = await callRoute<{ lead: { id: string } }>(
      leadsRoutes.leads.POST,
      post(mc, { studentName: 'Sample Own Lead', studentPhone: phone(), sourceCode: 'WALK_IN' }),
    );
    expect(own.status).toBe(201);
    const other = await callRoute<{ lead: { id: string } }>(
      leadsRoutes.leads.POST,
      post(mm, { studentName: 'Sample Other Lead', studentPhone: phone(), sourceCode: 'WALK_IN' }),
    );
    const list = await callRoute<{ id: string }[]>(leadsRoutes.leads.GET, authedRequest(mc, '/x'));
    const ids = list.data!.map((l) => l.id);
    expect(ids).toContain(own.data!.lead.id);
    expect(ids).not.toContain(other.data!.lead.id);
    const read = await callRoute(leadsRoutes['leads/[id]'].GET, authedRequest(mc, '/x'), {
      id: other.data!.lead.id,
    });
    expect([403, 404]).toContain(read.status);
    const mine = await callRoute<{ privateVisible: boolean }>(
      leadsRoutes['leads/[id]'].GET,
      authedRequest(mc, '/x'),
      { id: own.data!.lead.id },
    );
    expect(mine.data!.privateVisible).toBe(true);
  });
});

describe('links a recipient opens later', () => {
  const linkOf = async (userId: string, kind: string) =>
    (
      await ctx.db
        .select({ link: notifications.link })
        .from(notifications)
        .where(and(eq(notifications.userId, userId as never), eq(notifications.kind, kind)))
    ).map((n) => n.link);

  it('teacher gets Academic links, a coordinator (also an Ops member) Ops links; a marketing owner gets a Marketing link', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = workRoutes;
    await callRoute(
      r['staff-tasks/[id]'].PATCH,
      post(teacher, { status: 'done', expectedVersion: 1 }, 'PATCH'),
      { id: teacherTask },
    );
    const draft = await callRoute<{ id: string; version: number }>(
      r['eod-reports'].POST,
      post(teacher, { reportDate: day, summary: 'Sample day' }),
    );
    const id = draft.data!.id;
    const sent = await callRoute(
      r['eod-reports/[id]/submit'].POST,
      post(teacher, { expectedVersion: draft.data!.version }),
      { id },
    );
    expect(sent.status).toBe(200);
    // Coordinators belong to Business Ops too (D-073), and Ops is preferred for tasks.
    expect(await linkOf(coordinator.id, 'eod.submitted')).toEqual([`/ops/tasks/inbox?open=${id}`]);
    const reply = await callRoute(
      r['eod-reports/[id]/review'].POST,
      post(coordinator, { kind: 'comment', text: 'Sample note' }),
      { id },
    );
    expect(reply.status).toBe(200);
    const [link] = await linkOf(teacher.id, 'eod.comment');
    expect(link).toBe(`/academic/tasks?tab=eod&date=${day}`);
    expect(linkUrl(link!)).toBe(`http://localhost:3001/academic/tasks?tab=eod&date=${day}`);
    expect(await linkOf(mc.id, 'lead.assigned')).toEqual([`/marketing/leads/${leadId}`]);
  });
});

describe('taskDaySummary', () => {
  it('counts the caller’s own open work and today’s EOD status; null without a staff record', async () => {
    const s = await taskDaySummary(ctx.db, counsellor);
    expect(s).toMatchObject({ open: 1, dueToday: 1, eod: 'not_started' });
    expect(await taskDaySummary(ctx.db, teacher)).toMatchObject({ open: 0, eod: 'submitted' });
    expect(
      await taskDaySummary(ctx.db, await createTestUser(ctx.db, { roles: ['teacher'] })),
    ).toBeNull();
  });
});
