/**
 * Events, webinars and messages (brief §12; acceptance 22): audience snapshot, explicit
 * additions/removals, registration and attendance, scheduling sends nothing, sending without a
 * provider is simulated (never "sent"), participant privacy, 401/403/400. Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  opsAppointmentParticipants,
  opsContactPreferences,
  opsEventMessages,
  opsGuardians,
  students,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { POST as scheduleOne } from '../../src/app/api/v1/appointments/route';
import { POST as scheduleEvent } from '../../src/app/api/v1/appointments/events/route';
import { GET as getOne, PATCH as change } from '../../src/app/api/v1/appointments/[id]/route';
import {
  PATCH as changeParticipant,
  POST as addParticipant,
} from '../../src/app/api/v1/appointments/[id]/participants/route';
import { POST as draft } from '../../src/app/api/v1/appointments/[id]/messages/route';
import { POST as send } from '../../src/app/api/v1/appointments/[id]/messages/[messageId]/route';
import { getAppointment, listAppointments } from '../../src/server/appointments';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let consenting: string;
let silent: string;

type Participant = {
  id: string;
  kind: string;
  studentId: string | null;
  name: string;
  nameSnapshot: string | null;
  addedVia: string;
  removedAt: string | null;
  registrationStatus: string | null;
};
type Event = {
  id: string;
  participants: Participant[];
  messages: { status: string }[];
  audience: unknown;
};

let day = 40;
const at = (d: number, hhmm = '17:00') =>
  new Date(
    `${new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)}T${hhmm}:00+05:30`,
  ).toISOString();
const req = (user: { token: string }, json: unknown, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/x', { method, json });
const schedule = (user: { token: string }, over: Record<string, unknown> = {}) => {
  day += 1;
  return callRoute<Event & { participantsAdded: number }>(
    scheduleEvent,
    req(user, {
      type: 'webinar',
      title: 'Sample CLAT strategy webinar',
      staffId: teacher.staffId,
      startsAt: at(day),
      durationMinutes: 60,
      mode: 'online',
      onlineLink: 'https://meet.example.test/sample',
      audience: { populations: ['active'], programmeCodes: ['CLAT'] },
      ...over,
    }),
  );
};
const read = async (user: { token: string }, id: string) =>
  callRoute<Event>(getOne, authedRequest(user, '/ops/api/v1/x'), { id });

/** An active CLAT student whose lead has (or lacks) email consent. */
async function activeStudent(name: string, consent: boolean) {
  const id = await identity(ctx.db, name);
  const a = await caseOf(ctx.db, manager.id, id, 'enrolled');
  if (consent)
    await ctx.db.insert(opsContactPreferences).values({
      leadId: a.leadId,
      consentStatus: 'given',
      consentBy: 'guardian',
      allowedChannels: ['email'],
      recordedBy: manager.id,
    });
  return id;
}

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher']);
  consenting = await activeStudent('Sample Webinar Student A', true);
  silent = await activeStudent('Sample Webinar Student B', false);
  await ctx.db.insert(opsGuardians).values({
    studentId: consenting as never,
    fullName: 'Sample Guardian A',
    relationship: 'mother',
    email: 'sample-guardian-a@example.test',
    consentStatus: 'given',
    createdBy: manager.id,
  });
});

describe('POST /appointments/events', () => {
  it('401 / 403 / 400: signed out, auditor, ineligible population, one-to-one route refuses events', async () => {
    expect((await callRoute(scheduleEvent, buildRequest('/x', { json: {} }))).status).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await schedule(auditor)).status).toBe(403);
    expect((await schedule(teacher)).status).toBe(403);
    expect((await schedule(manager, { title: '' })).status).toBe(400);
    // `lead` is not in the proposed eligibility (demo, active).
    expect((await schedule(manager, { audience: { populations: ['lead'] } })).status).toBe(400);
    const one = await callRoute(
      scheduleOne,
      req(manager, { type: 'event', startsAt: at(5), mode: 'online', studentId: consenting }),
    );
    expect(one.status).toBe(400);
  });

  it('snapshots the audience (students + guardians), sends nothing, and keeps the list when the filter changes', async () => {
    const r = await schedule(manager);
    expect(r.status).toBe(201);
    const id = r.data!.id;
    const before = (await read(manager, id)).data!;
    const studentRows = before.participants.filter((p) => p.kind === 'student');
    expect(studentRows.map((p) => p.studentId)).toEqual(
      expect.arrayContaining([consenting, silent]),
    );
    expect(studentRows.every((p) => p.addedVia === 'audience_snapshot' && p.nameSnapshot)).toBe(
      true,
    );
    expect(before.participants.some((p) => p.kind === 'guardian')).toBe(true);
    // Scheduling sent nothing.
    expect(
      await ctx.db
        .select()
        .from(opsEventMessages)
        .where(eq(opsEventMessages.appointmentId, id as never)),
    ).toEqual([]);

    // A new matching student and a narrower filter later: the list is not rewritten.
    await activeStudent('Sample Late Joiner', true);
    await ctx.db
      .update(students)
      .set({ fullName: 'Sample Renamed A' })
      .where(eq(students.id, consenting as never));
    const edit = await callRoute(
      change,
      req(
        manager,
        { action: 'edit', audience: { populations: ['active'], programmeCodes: ['IPMAT'] } },
        'PATCH',
      ),
      { id },
    );
    expect(edit.status).toBe(200);
    const after = (await read(manager, id)).data!;
    expect(after.audience).toMatchObject({ programmeCodes: ['IPMAT'] });
    expect(after.participants.map((p) => [p.id, p.nameSnapshot, p.removedAt])).toEqual(
      before.participants.map((p) => [p.id, p.nameSnapshot, p.removedAt]),
    );
  });

  it('explicit additions and removals are recorded; capacity and attendance rules hold', async () => {
    const r = await schedule(manager, { audience: {}, capacity: 1 });
    const id = r.data!.id;
    expect(r.data!.participantsAdded).toBe(0);
    const add = (studentId: string) =>
      callRoute(addParticipant, req(manager, { studentId }), { id });
    // Named students follow events.eligibility too (a past-only student is outside demo + active).
    const past = await identity(ctx.db, 'Sample Past Only');
    await caseOf(ctx.db, manager.id, past, 'withdrawn');
    expect((await add(past)).status).toBe(400);
    expect((await schedule(manager, { audience: {}, participantStudentIds: [past] })).status).toBe(
      400,
    );
    expect((await add(silent)).status).toBe(201);
    expect((await add(silent)).status).toBe(409);
    expect((await add(consenting)).status).toBe(201);
    const people = (await read(manager, id)).data!.participants.filter((p) => p.kind === 'student');
    expect(people.every((p) => p.addedVia === 'manual')).toBe(true);
    const [a, b] = people;
    const patch = (json: Record<string, unknown>) =>
      callRoute(changeParticipant, req(manager, json, 'PATCH'), { id });
    expect(
      (await patch({ action: 'update', participantId: a!.id, registrationStatus: 'registered' }))
        .status,
    ).toBe(200);
    expect(
      (await patch({ action: 'update', participantId: b!.id, registrationStatus: 'registered' }))
        .status,
    ).toBe(409);
    expect(
      (await patch({ action: 'update', participantId: a!.id, attendance: 'present' })).status,
    ).toBe(400);
    expect(
      (
        await patch({
          action: 'remove',
          participantId: b!.id,
          reason: 'Clash with school exam (test)',
        })
      ).status,
    ).toBe(200);
    expect(
      (await patch({ action: 'remove', participantId: b!.id, reason: 'Again (test)' })).status,
    ).toBe(409);
    const [removed] = await ctx.db
      .select()
      .from(opsAppointmentParticipants)
      .where(eq(opsAppointmentParticipants.id, b!.id));
    expect(removed).toMatchObject({
      removedBy: manager.id,
      removedReason: 'Clash with school exam (test)',
    });
    expect(removed!.removedAt).not.toBeNull();
  });
});

describe('scope and guardian rows (I-3, I-4)', () => {
  it('an own-scope counsellor reaches only their own students and does not see guardian names', async () => {
    const mine = await identity(ctx.db, 'Sample Counsellor Own');
    await caseOf(ctx.db, manager.id, mine, 'enrolled', { counsellorStaffId: counsellor.staffId });
    await ctx.db.insert(opsGuardians).values({
      studentId: mine as never,
      fullName: 'Sample Guardian Own',
      relationship: 'father',
      createdBy: manager.id,
    });
    const r = await schedule(counsellor, { staffId: counsellor.staffId });
    expect(r.status).toBe(201);
    const seen = (await read(counsellor, r.data!.id)).data!;
    const studentIds = seen.participants
      .filter((p) => p.kind === 'student')
      .map((p) => p.studentId);
    expect(studentIds).toEqual([mine]);
    // Own-scope private access does not show guardian names in an event list.
    expect(seen.participants.find((p) => p.kind === 'guardian')?.name).toBe(
      'Guardian (restricted)',
    );
    expect(
      (
        await callRoute(addParticipant, req(counsellor, { studentId: consenting }), {
          id: r.data!.id,
        })
      ).status,
    ).toBe(400);
    const m = await read(manager, (await schedule(manager)).data!.id);
    const asCounsellor = await read(counsellor, m.data!.id);
    expect(asCounsellor.status).toBe(403); // not their event
  });

  it('removing a student also removes the guardians invited through them; re-adding does not duplicate live rows', async () => {
    const id = (await schedule(manager, { audience: {}, participantStudentIds: [consenting] }))
      .data!.id;
    const live = async () =>
      (await read(manager, id)).data!.participants.filter(
        (p) => !p.removedAt && p.kind !== 'staff',
      );
    const student = (await live()).find((p) => p.kind === 'student')!;
    expect((await live()).some((p) => p.kind === 'guardian')).toBe(true);
    await callRoute(
      changeParticipant,
      req(
        manager,
        { action: 'remove', participantId: student.id, reason: 'Not attending (test)' },
        'PATCH',
      ),
      { id },
    );
    expect(await live()).toEqual([]);
    expect(
      (await callRoute(addParticipant, req(manager, { studentId: consenting }), { id })).status,
    ).toBe(201);
    expect((await live()).map((p) => p.kind).sort()).toEqual(['guardian', 'student']);
  });
});

describe('messages: preview, then an explicit send that is simulated without a provider', () => {
  it('draft counts only consenting contacts; send needs ops:event_messages:send; never "sent"', async () => {
    const id = (
      await schedule(manager, { audience: {}, participantStudentIds: [consenting, silent] })
    ).data!.id;
    const d = await callRoute<{
      id: string;
      status: string;
      preview: { reachable: number; providerConnected: boolean };
    }>(
      draft,
      req(manager, { channel: 'email', body: 'Sample reminder: the webinar starts at 5 pm.' }),
      { id },
    );
    expect(d.status).toBe(201);
    expect(d.data).toMatchObject({ status: 'draft', preview: { providerConnected: false } });
    // Student A (consent, email) and guardian A (own consent) — student B has no consent.
    expect(d.data!.preview.reachable).toBe(2);
    expect(JSON.stringify(d.data)).not.toContain('@example.test');

    const params = { id, messageId: d.data!.id };
    expect((await callRoute(send, buildRequest('/x', { json: {} }), params)).status).toBe(401);
    expect((await callRoute(send, req(counsellor, {}), params)).status).toBe(403);
    const sent = await callRoute<{
      status: string;
      providerRef: string | null;
      recipientCount: number;
    }>(send, req(manager, {}), params);
    expect(sent.status).toBe(200);
    expect(sent.data).toMatchObject({ status: 'simulated', providerRef: null, recipientCount: 2 });
    expect((await callRoute(send, req(manager, {}), params)).status).toBe(409);
    const rows = await ctx.db
      .select()
      .from(opsEventMessages)
      .where(eq(opsEventMessages.appointmentId, id as never));
    expect(rows.every((m) => m.status !== 'sent')).toBe(true);

    const listed = async () =>
      (await listAppointments(ctx.db, manager, {}, 200)).rows.find((a) => a.id === id);
    const people = (await read(manager, id)).data!.participants.filter(
      (p) => p.kind !== 'staff' && !p.removedAt,
    ).length;
    expect(await listed()).toMatchObject({
      participantCount: people,
      latestMessageStatus: 'simulated',
    });
    await callRoute(draft, req(manager, { channel: 'email', body: 'Sample follow-up.' }), { id });
    expect((await listed())?.latestMessageStatus).toBe('draft');
  });
});

describe('participant privacy', () => {
  it('a teacher (owner, no private access) sees names only: no contacts, guardian names restricted', async () => {
    const id = (await schedule(manager)).data!.id;
    // The read behind Academic OS "My meetings" (teachers are not Business Ops members, D-072).
    const r = await getAppointment(ctx.db, teacher, id);
    const json = JSON.stringify(r);
    expect(json).not.toContain('@example.test');
    expect(json).not.toContain('Sample Guardian A');
    expect(r.participants.find((p) => p.kind === 'guardian')?.name).toBe('Guardian (restricted)');
    const other = await staffUser(ctx.db, ['teacher']);
    await expect(getAppointment(ctx.db, other, id)).rejects.toThrow(/assigned to you/);
    expect((await read(teacher, id)).status).toBe(403);
  });
});
