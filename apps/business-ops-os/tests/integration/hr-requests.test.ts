/**
 * Requests through HR (owner brief 23 Oct 2026 §6; owner answers 3 and 5): the only staff-to-staff
 * channel. Message fixed after submit; each recipient sees only what HR forwarded to them; a reply
 * goes to HR, never to the sender; Schar stays in HR's queue until set up; related records only
 * where the sender may already look; HR acts only inside its scope; in-app notifications only.
 * Fictional people only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  notifications,
  opsHrRequests,
  opsStaffTasks,
  opsTaskCollaborators,
  staffMembers,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as uploadRoute } from '../../src/app/api/v1/attachments/route';
import { GET as downloadRoute } from '../../src/app/api/v1/attachments/[id]/route';
import { POST as createRoute } from '../../src/app/api/v1/hr-requests/route';
import { PATCH as patchRoute } from '../../src/app/api/v1/hr-requests/[id]/route';
import { POST as actionRoute } from '../../src/app/api/v1/hr-requests/[id]/[action]/route';
import { POST as taskActionRoute } from '../../src/app/api/v1/staff-tasks/[id]/[action]/route';
import { addDays, istToday } from '../../src/domain/dates';
import { getHrRequest, hrQueue, type HrRequestView } from '../../src/server/hr-requests-read';
import { updateHrSetting } from '../../src/server/hr-settings';
import { updateSetting } from '../../src/server/settings';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const due = addDays(istToday(new Date()), 3);
let hr: StaffUser; // HR manager, scope ACADEMICS + MARKETING_GROWTH (default setting)
let ops: StaffUser; // operations manager, every department
let sender: StaffUser; // teacher in ACADEMICS
let asha: StaffUser; // recipient A (teacher)
let bina: StaffUser; // recipient B (marketing)
let finance: StaffUser; // FINANCE: outside HR's scope

const BASE = (u: TestUser) =>
  u.roles.includes('teacher')
    ? '/academic'
    : u.roles.includes('marketing_contributor')
      ? '/marketing'
      : '/ops';
const api = (u: TestUser, p = '') => `${BASE(u)}/api/v1/hr-requests${p}`;
type Req = HrRequestView;
const send = (u: TestUser, json: Record<string, unknown>) =>
  callRoute<Req>(createRoute, authedRequest(u, api(u), { method: 'POST', json }));
const act = (u: TestUser, id: string, action: string, json: Record<string, unknown> = {}) =>
  callRoute<Req>(
    actionRoute,
    authedRequest(u, api(u, `/${id}/${action}`), { method: 'POST', json }),
    {
      id,
      action,
    },
  );
const ask = (more: Record<string, unknown> = {}) =>
  send(sender, {
    category: 'classes',
    subject: 'Swap Friday class',
    message: 'Can we swap?',
    ...more,
  });
/** Submitted and reviewed by HR. */
async function reviewed(more: Record<string, unknown> = {}) {
  const id = (await ask(more)).data!.id;
  expect((await act(hr, id, 'review')).status).toBe(200);
  return id;
}
const inDept = async (s: StaffUser, code: string) => {
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, code));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: d!.id })
    .where(eq(staffMembers.id, s.staffId));
};
const notesFor = async (u: TestUser, entityId: string) =>
  (
    await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, u.id), eq(notifications.entityId, entityId)))
  ).map((n) => n.kind);

beforeAll(async () => {
  vi.stubEnv('ATTACHMENTS_DIR', mkdtempSync(path.join(os.tmpdir(), 'elevate-hr-requests-')));
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR' });
  ops = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  sender = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Chitra' });
  asha = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Asha' });
  bina = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer Bina' });
  finance = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Dev' });
  for (const s of [sender, asha]) await inDept(s, 'ACADEMICS');
  await inDept(bina, 'MARKETING_GROWTH');
  await inDept(finance, 'FINANCE');
});
afterEach(() => vi.unstubAllGlobals());

describe('sending a request', () => {
  it('401 signed out, 403 without the permission, 400 without a subject', async () => {
    const anon = await callRoute(
      createRoute,
      buildRequest('/ops/api/v1/hr-requests', { json: {} }),
    );
    expect(anon.status).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await send(auditor, { category: 'other', subject: 'x', message: 'y' })).status).toBe(
      403,
    );
    const bad = await send(sender, { category: 'classes', message: 'No subject' });
    expect(bad.status).toBe(400);
    expect(bad.error!.details).toEqual([expect.objectContaining({ path: ['subject'] })]);
  });

  it('a draft can change; once sent the message is fixed (409) and stays as written', async () => {
    const draft = await ask({ draft: true, message: '' });
    expect(draft.data).toMatchObject({ status: 'draft', request: { submittedAt: null } });
    const id = draft.data!.id;
    const patch = (json: Record<string, unknown>) =>
      callRoute<Req>(
        patchRoute,
        authedRequest(sender, api(sender, `/${id}`), { method: 'PATCH', json }),
        { id },
      );
    expect((await patch({ message: 'Please swap Friday with Monday.' })).status).toBe(200);
    // HR never sees a draft.
    await expect(getHrRequest(ctx.db, hr, id)).rejects.toMatchObject({ status: 404 });
    expect((await act(sender, id, 'submit')).data).toMatchObject({ status: 'submitted' });
    const late = await patch({ message: 'Changed my mind' });
    expect(late.status).toBe(409);
    const [row] = await ctx.db
      .select()
      .from(opsHrRequests)
      .where(eq(opsHrRequests.id, id as never));
    expect(row!.message).toBe('Please swap Friday with Monday.');
    expect((await act(sender, id, 'submit')).status).toBe(409);
  });

  it('notifies HR in the app only (HR and the operations manager); nothing goes out', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const id = (await ask({ urgency: 'urgent' })).data!.id;
    expect(await notesFor(hr, id)).toEqual(['hr_request.submitted']);
    expect(await notesFor(ops, id)).toEqual(['hr_request.submitted']);
    expect(await notesFor(sender, id)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('related records: only what the sender can already open', () => {
  it.each<[string, () => Promise<Record<string, unknown>>, number]>([
    [
      'their own task',
      async () => ({ relatedKind: 'task', relatedId: (await taskFor(sender)).id }),
      201,
    ],
    [
      'another teacher’s task',
      async () => ({ relatedKind: 'task', relatedId: (await taskFor(asha)).id }),
      403,
    ],
    [
      'a student (teachers cannot open Ops students)',
      async () => ({ relatedKind: 'student', relatedId: crypto.randomUUID() }),
      403,
    ],
    [
      'a campaign (cannot be checked yet)',
      async () => ({ relatedKind: 'campaign', relatedId: crypto.randomUUID() }),
      400,
    ],
  ])('%s → %i', async (_n, link, status) => {
    expect((await ask(await link())).status).toBe(status);
  });
});

async function taskFor(owner: StaffUser) {
  const [t] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: owner.staffId,
      title: 'Sample own task',
      dueOn: due,
      originalDueOn: due,
      status: 'pending',
      createdBy: hr.id,
    })
    .returning();
  return t!;
}

describe('forwarding: each recipient sees only their own forward', () => {
  it('two recipients, HR notes, replies to HR and the relay to the sender', async () => {
    const id = await reviewed();
    const fwd = (to: StaffUser, body: string) =>
      act(hr, id, 'forward', {
        toStaffId: to.staffId,
        body,
        hrNote: `Routing note for ${to.displayName}`,
      });
    expect((await fwd(asha, 'For Asha: can you take Friday?')).data).toMatchObject({
      status: 'forwarded',
    });
    expect((await fwd(bina, 'For Bina: is the room free?')).status).toBe(200);
    expect(await notesFor(asha, id)).toEqual(['hr_request.forwarded']);

    const a = await getHrRequest(ctx.db, asha, id);
    expect(a.request).toBeNull(); // never the sender's own words
    expect(a.events.map((e) => e.body)).toEqual(['For Asha: can you take Friday?']);
    expect(a.events.every((e) => e.hrNote === null)).toBe(true);
    expect((await getHrRequest(ctx.db, bina, id)).events.map((e) => e.body)).toEqual([
      'For Bina: is the room free?',
    ]);

    // The reply goes to HR: the sender is not notified and never sees it.
    expect((await act(asha, id, 'respond', { body: 'Yes, I can take Friday.' })).status).toBe(200);
    expect(await notesFor(sender, id)).toEqual([]);
    expect(await notesFor(hr, id)).toContain('hr_request.recipient_responded');
    const b = await getHrRequest(ctx.db, bina, id);
    expect(b.events.map((e) => e.kind)).toEqual(['forwarded']);
    const s1 = await getHrRequest(ctx.db, sender, id);
    expect(s1.events.map((e) => e.kind)).toEqual([
      'submitted',
      'reviewed',
      'forwarded',
      'forwarded',
    ]);
    expect(
      s1.events.every((e) => e.body === null && e.hrNote === null && e.forwardedToStaffId === null),
    ).toBe(true);

    // HR sees everything, then passes the answer on.
    const h = await getHrRequest(ctx.db, hr, id);
    expect(h.events.map((e) => e.hrNote).filter(Boolean)).toHaveLength(2);
    expect((await act(hr, id, 'relay', { body: 'Asha will take Friday.' })).status).toBe(200);
    expect(await notesFor(sender, id)).toEqual(['hr_request.relay']);
    const s2 = await getHrRequest(ctx.db, sender, id);
    expect(s2.events.at(-1)).toMatchObject({
      kind: 'response_relayed',
      body: 'Asha will take Friday.',
    });
    expect((await act(hr, id, 'resolve')).data).toMatchObject({ status: 'resolved' });
    expect((await act(asha, id, 'respond', { body: 'Too late' })).status).toBe(409);
  });

  it('a file HR shares on a forward opens for that recipient only, never the sender’s files', async () => {
    const id = await reviewed();
    await act(hr, id, 'forward', { toStaffId: asha.staffId, body: 'See the timetable' });
    await act(hr, id, 'forward', { toStaffId: bina.staffId, body: 'Room question' });
    const forwardTo = async (s: StaffUser) =>
      (await getHrRequest(ctx.db, hr, id)).events.find(
        (e) => e.kind === 'forwarded' && e.forwardedToStaffId === s.staffId,
      )!.id;
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64');
    const up = (u: TestUser, ownerId: string) =>
      callRoute<{ id: string }>(
        uploadRoute,
        authedRequest(u, `${BASE(u)}/api/v1/attachments`, {
          method: 'POST',
          json: {
            ownerKind: 'hr_request',
            ownerId,
            purpose: 'reference',
            name: 't.pdf',
            mime: 'application/pdf',
            dataBase64: pdf,
          },
        }),
      );
    const get = async (u: TestUser, fileId: string) =>
      (
        await downloadRoute(authedRequest(u, `${BASE(u)}/api/v1/attachments/${fileId}`), {
          params: Promise.resolve({ id: fileId }),
        })
      ).status;
    const shared = await up(hr, await forwardTo(asha));
    expect(shared.status).toBe(201);
    expect(await get(asha, shared.data!.id)).toBe(200);
    expect(await get(bina, shared.data!.id)).toBe(404);
    expect(await get(sender, shared.data!.id)).toBe(404);
    // The sender may not add files once the request is sent.
    expect((await up(sender, id)).status).toBe(403);
    expect((await up(asha, await forwardTo(asha))).status).toBe(403);
  });
});

describe('Schar: a configured recipient that is not set up stays with HR', () => {
  it('unresolved → badge in the queue, forward refused; set up → forwarded to them', async () => {
    const id = (await ask({ recipient: 'key:schar', subject: 'For Schar' })).data!.id;
    await act(hr, id, 'review');
    const row = async () =>
      (await hrQueue(ctx.db, hr, { view: 'queue', tab: 'review', q: 'For Schar' })).rows[0]!;
    expect((await row()).recipient).toEqual({
      label: 'Schar',
      unresolved: 'Recipient not set up: Schar',
    });
    const refused = await act(hr, id, 'forward', { body: 'For Schar' });
    expect(refused.status).toBe(409);
    expect(refused.error!.message).toMatch(/Recipient not set up/);
    expect((await row()).id).toBe(id);
    await updateHrSetting(ctx.db, hr, {
      key: 'hr.request_recipients',
      value: { schar: bina.staffId },
    });
    expect((await row()).recipient).toEqual({
      label: 'Schar (Sample Marketer Bina)',
      unresolved: null,
    });
    const ok = await act(hr, id, 'forward', { body: 'For Schar' });
    expect(ok.status).toBe(200);
    expect((await getHrRequest(ctx.db, bina, id)).events.map((e) => e.body)).toEqual(['For Schar']);
    await updateHrSetting(ctx.db, hr, { key: 'hr.request_recipients', value: { schar: null } });
  });
});

describe('who may manage', () => {
  it.each<[string, () => TestUser, number]>([
    ['the sender', () => sender, 403],
    ['another teacher (cannot see it)', () => asha, 404],
  ])('%s cannot review: %i', async (_n, who, status) => {
    const id = (await ask()).data!.id;
    expect((await act(who(), id, 'review')).status).toBe(status);
  });

  it('HR outside its department scope cannot see or act; the operations manager can', async () => {
    const id = (
      await send(finance, { category: 'other', subject: 'Finance question', message: 'Hi' })
    ).data!.id;
    expect((await act(hr, id, 'review')).status).toBe(404);
    expect((await hrQueue(ctx.db, hr, { view: 'queue', q: 'Finance question' })).total).toBe(0);
    expect(await notesFor(hr, id)).toEqual([]);
    expect((await act(ops, id, 'review')).status).toBe(200);
  });

  it('HR never handles its own request', async () => {
    const id = (await send(ops, { category: 'other', subject: 'Own', message: 'Mine' })).data!.id;
    expect((await act(ops, id, 'review')).status).toBe(403);
    expect((await act(hr, id, 'review')).status).toBe(200);
  });

  it('decline needs a reason the sender sees; an audit row for every step', async () => {
    const id = await reviewed();
    expect((await act(hr, id, 'decline')).status).toBe(400);
    expect((await act(hr, id, 'decline', { body: 'Ask your coordinator.' })).data).toMatchObject({
      status: 'declined',
      request: { decidedAt: expect.any(String) },
    });
    expect(await notesFor(sender, id)).toEqual(['hr_request.decline']);
    const audits = await ctx.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'hr_request'), eq(auditEvents.entityId, id)));
    expect(audits.map((a) => a.action)).toEqual([
      'hr_request.created',
      'hr_request.review',
      'hr_request.decline',
    ]);
  });

  it('HR creates one linked task from a request', async () => {
    const id = await reviewed();
    const task = { title: 'Sample swap Friday class', staffId: asha.staffId, dueOn: due };
    const made = await act(hr, id, 'create-task', { task });
    expect(made.data!.request!.linkedTaskId).toEqual(expect.any(String));
    const [t] = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.id, made.data!.request!.linkedTaskId!));
    expect(t).toMatchObject({ staffId: asha.staffId, title: 'Sample swap Friday class' });
    expect((await getHrRequest(ctx.db, hr, id)).events.at(-1)).toMatchObject({
      kind: 'task_created',
    });
    expect((await act(hr, id, 'create-task', { task })).status).toBe(409);
  });
});

describe('tasks.peer_discussion (owner answer 5)', () => {
  it.each<['hr_and_reviewer_only' | 'allowed', number]>([
    ['hr_and_reviewer_only', 403],
    ['allowed', 200],
  ])('a collaborator comment with %s → %i', async (mode, status) => {
    await updateSetting(ctx.db, ops, { key: 'tasks.peer_discussion', value: { mode } });
    const [t] = await ctx.db
      .insert(opsStaffTasks)
      .values({
        staffId: sender.staffId,
        title: 'Sample shared task',
        dueOn: due,
        originalDueOn: due,
        status: 'pending',
        visibility: 'collaborators',
        createdBy: hr.id,
      })
      .returning();
    await ctx.db
      .insert(opsTaskCollaborators)
      .values({ taskId: t!.id, staffId: asha.staffId, addedBy: hr.id });
    const version = async () =>
      (await ctx.db.select().from(opsStaffTasks).where(eq(opsStaffTasks.id, t!.id)))[0]!.version;
    const comment = async (u: TestUser) =>
      callRoute(
        taskActionRoute,
        authedRequest(u, `/academic/api/v1/staff-tasks/${t!.id}/comment`, {
          method: 'POST',
          json: { reason: 'Use last year’s key', expectedVersion: await version() },
        }),
        { id: t!.id, action: 'comment' },
      );
    expect((await comment(asha)).status).toBe(status);
    expect((await comment(sender)).status).toBe(200); // the owner always may
  });
});

describe('review round 1', () => {
  it('C1: every action answers with what the caller may see; a recipient’s reply returns no sender fields', async () => {
    const id = await reviewed({ subject: 'SECRET-SUBJECT', message: 'SECRET-MESSAGE' });
    await act(hr, id, 'forward', { toStaffId: asha.staffId, body: 'For Asha only' });
    const res = await act(asha, id, 'respond', { body: 'My answer' });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.data);
    for (const secret of [
      'SECRET-SUBJECT',
      'SECRET-MESSAGE',
      sender.staffId,
      'senderStaffId',
      'relatedKind',
      'relatedId',
      'subject',
      'message',
    ])
      expect(text).not.toContain(secret);
    expect(res.data).toMatchObject({ id, status: 'forwarded', request: null });
    const created = await ask({ subject: 'Own words' });
    expect(created.data).toMatchObject({ as: 'sender', request: { subject: 'Own words' } });
  });

  it.each<[string, () => StaffUser, () => Record<string, unknown>, () => StaffUser, number]>([
    ['scoped HR → staff outside its departments', () => hr, () => ({}), () => finance, 403],
    [
      'scoped HR → the sender’s own named recipient',
      () => hr,
      () => ({ recipient: `staff:${finance.staffId}` }),
      () => finance,
      200,
    ],
    ['scoped HR → a colleague inside its departments', () => hr, () => ({}), () => asha, 200],
    ['operations manager → anyone', () => ops, () => ({}), () => finance, 200],
  ])('I1: forward %s', async (_n, by, more, to, status) => {
    const id = (await ask(more())).data!.id;
    await act(by(), id, 'review');
    expect(
      (await act(by(), id, 'forward', { toStaffId: to().staffId, body: 'Please help' })).status,
    ).toBe(status);
  });

  it('I2: a task from a request cannot link a batch (no Academic call while the request is locked)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const id = await reviewed();
    const task = { title: 'Sample', staffId: asha.staffId, dueOn: due };
    const linked = await act(hr, id, 'create-task', {
      task: { ...task, relatedRef: `batch:${crypto.randomUUID()}` },
    });
    expect(linked.status).toBe(400);
    expect((await act(hr, id, 'create-task', { task })).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('M1: only HR may write an HR note; a recipient’s is dropped', async () => {
    const id = await reviewed();
    await act(hr, id, 'forward', { toStaffId: asha.staffId, body: 'Over to you' });
    await act(asha, id, 'respond', { body: 'Done', hrNote: 'SPOOFED NOTE' });
    const draftId = (await ask({ draft: true })).data!.id;
    await act(sender, draftId, 'submit', { hrNote: 'SPOOF 2' });
    const notes = (await getHrRequest(ctx.db, hr, id)).events.map((e) => e.hrNote);
    expect(notes).not.toContain('SPOOFED NOTE');
    expect((await getHrRequest(ctx.db, hr, draftId)).events.map((e) => e.hrNote)).toEqual([null]);
  });

  it.each(['key:constructor', 'key:nobody'])(
    'M2: %s is not a configured recipient (400)',
    async (recipient) => {
      const res = await ask({ recipient });
      expect(res.status).toBe(400);
      expect(res.error!.details).toEqual([expect.objectContaining({ path: ['recipient'] })]);
    },
  );

  it('M3: the sender and a recipient never get user ids in the log', async () => {
    const id = await reviewed();
    await act(hr, id, 'forward', { toStaffId: asha.staffId, body: 'Over to you' });
    await act(asha, id, 'respond', { body: 'Done' });
    for (const who of [sender, asha])
      for (const e of (await getHrRequest(ctx.db, who, id)).events)
        expect(e).not.toHaveProperty('actorUserId');
  });
});
