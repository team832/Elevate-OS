import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import {
  auditEvents,
  notifications,
  opsAppointmentChanges,
  opsAppointmentParticipants,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  staffMembers,
  students,
} from '@elevate/database';
import { GET as list, POST as schedule } from '../../src/app/api/v1/appointments/route';
import { GET as getOne, PATCH as change } from '../../src/app/api/v1/appointments/[id]/route';
import { GET as teachers } from '../../src/app/api/v1/teachers/route';
import { OWNER_SUPPLIED_STAFF, seedTeachers } from '../../seed/teachers';
import type { IsoDate } from '../../src/domain';
import { listMyMeetings } from '../../src/server/appointments';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let studentId: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher']);
  const [s] = await ctx.db
    .insert(students)
    .values({ fullName: 'Asha Test', isSample: true })
    .returning();
  studentId = s!.id;
});

type Appt = {
  id: string;
  status: string;
  reminderStatus: string;
  startsAt: string;
  endsAt: string;
};
let day = 30;
/** A fresh IST day per test so slots never collide across tests. */
const dayOf = (d = day) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const at = (hhmm: string, d = day) => new Date(`${dayOf(d)}T${hhmm}:00+05:30`).toISOString();
const book = (user: StaffUser, over: Record<string, unknown> = {}) =>
  callRoute<Appt>(
    schedule,
    authedRequest(user, '/ops/api/v1/appointments', {
      method: 'POST',
      json: {
        type: 'parent_teacher_meeting',
        staffId: teacher.staffId,
        studentId,
        startsAt: at('10:00'),
        endsAt: at('11:00'),
        mode: 'offline',
        subject: 'Mathematics',
        ...over,
      },
    }),
  );
const patch = (user: StaffUser, id: string, json: unknown) =>
  callRoute<Appt>(
    change,
    authedRequest(user, `/ops/api/v1/appointments/${id}`, { method: 'PATCH', json }),
    { id },
  );

describe('POST /ops/api/v1/appointments', () => {
  it('401 signed out, 403 for auditor and teacher, 400 for bad input and unknown staff', async () => {
    day += 1;
    expect(
      (await callRoute(schedule, buildRequest('/ops/api/v1/appointments', { json: {} }))).status,
    ).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect(
      (
        await callRoute(
          schedule,
          authedRequest(auditor, '/ops/api/v1/appointments', { method: 'POST', json: {} }),
        )
      ).status,
    ).toBe(403);
    expect((await book(teacher)).status).toBe(403);
    expect((await book(manager, { type: 'party' })).status).toBe(400);
    const unknown = await book(manager, { staffId: '00000000-0000-4000-8000-000000000001' });
    expect(unknown.status).toBe(400);
    expect(unknown.error?.details).toEqual([expect.objectContaining({ path: ['staffId'] })]);
  });

  it('201: persists, adds participants, notifies the teacher in-app with the simulated label, audits', async () => {
    day += 1;
    const res = await book(counsellor, { location: undefined });
    expect(res.status).toBe(201);
    const appt = res.data!;
    expect(appt).toMatchObject({ status: 'scheduled', reminderStatus: 'sent_in_app' });
    const people = await ctx.db
      .select()
      .from(opsAppointmentParticipants)
      .where(eq(opsAppointmentParticipants.appointmentId, appt.id as never));
    expect(people.map((p) => [p.kind, p.role])).toEqual(
      expect.arrayContaining([
        ['staff', 'teacher'],
        ['student', 'student'],
      ]),
    );
    const [note] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, appt.id));
    expect(note).toMatchObject({ userId: teacher.id, kind: 'appointment.scheduled' });
    expect(note?.body).toContain('simulated — not sent');
    expect(note?.body).toContain('Sikar centre');
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, appt.id));
    expect(audit.map((a) => a.action)).toContain('appointment.scheduled');
  });

  it('409 on overlap naming the clash; touching edges allowed; a cancelled slot is free again', async () => {
    day += 1;
    const first = await book(manager);
    expect(first.status).toBe(201);
    const clash = await book(manager, { startsAt: at('10:30'), endsAt: at('11:30') });
    expect(clash.status).toBe(409);
    expect(clash.error?.message).toMatch(/Clashes with .*parent-teacher meeting/);
    expect((await book(manager, { startsAt: at('11:00'), endsAt: at('12:00') })).status).toBe(201);
    expect(
      (await patch(manager, first.data!.id, { action: 'cancel', reason: 'Guardian unwell' }))
        .status,
    ).toBe(200);
    expect((await book(manager, { startsAt: at('10:15'), endsAt: at('10:45') })).status).toBe(201);
  });

  it('concurrent overlapping bookings: exactly one succeeds', async () => {
    day += 1;
    const results = await Promise.all([
      book(manager),
      book(manager, { startsAt: at('10:30'), endsAt: at('11:30') }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('PATCH /ops/api/v1/appointments/:id', () => {
  it('reschedule keeps history with reason and re-checks overlaps; cancel needs a reason', async () => {
    day += 1;
    const a = (await book(manager)).data!;
    await book(manager, { startsAt: at('14:00'), endsAt: at('15:00') });
    expect(
      (
        await patch(manager, a.id, {
          action: 'reschedule',
          startsAt: at('14:30'),
          reason: 'Teacher request',
        })
      ).status,
    ).toBe(409);
    const moved = await patch(manager, a.id, {
      action: 'reschedule',
      startsAt: at('16:00'),
      reason: 'Teacher request',
    });
    expect(moved.status).toBe(200);
    expect(moved.data).toMatchObject({
      status: 'rescheduled',
      startsAt: at('16:00'),
      endsAt: at('17:00'),
    });
    expect((await patch(manager, a.id, { action: 'cancel', reason: '' })).status).toBe(400);
    expect((await patch(manager, a.id, { action: 'cancel', reason: 'Exam clash' })).status).toBe(
      200,
    );
    expect((await patch(manager, a.id, { action: 'confirm' })).status).toBe(409);
    const history = await ctx.db
      .select()
      .from(opsAppointmentChanges)
      .where(eq(opsAppointmentChanges.appointmentId, a.id as never));
    expect(history.map((h) => [h.field, h.newValue, h.reason])).toEqual(
      expect.arrayContaining([
        ['status', 'rescheduled', 'Teacher request'],
        ['starts_at', at('16:00'), 'Teacher request'],
        ['status', 'cancelled', 'Exam clash'],
      ]),
    );
    const detail = await callRoute<{ changes: unknown[] }>(
      getOne,
      authedRequest(manager, `/ops/api/v1/appointments/${a.id}`),
      { id: a.id },
    );
    expect(detail.data?.changes).toHaveLength(history.length);
  });

  it('q filters by student name (case-insensitive) and the total counts the same rows', async () => {
    day += 1;
    const mine = (await book(manager)).data!;
    const search = (q: string) =>
      callRoute<{ rows: { id: string }[]; total: number }>(
        list,
        authedRequest(manager, `/ops/api/v1/appointments?from=${dayOf()}&to=${dayOf()}&q=${q}`),
      );
    const hit = await search('asha');
    expect(hit.data).toMatchObject({ rows: [{ id: mine.id }], total: 1 });
    expect((await search('nobody')).data).toMatchObject({ rows: [], total: 0 });
  });

  it('own scope: a teacher lists only their appointments and cannot change them', async () => {
    day += 1;
    const other = await staffUser(ctx.db, ['teacher']);
    const mine = (await book(manager)).data!;
    await book(manager, { staffId: other.staffId });
    // Teachers read their meetings in Academic OS ("My meetings"); the Ops API is not theirs (D-072).
    const date = dayOf() as IsoDate;
    const res = await listMyMeetings(ctx.db, teacher, { from: date, to: date });
    expect(res?.rows.map((r) => r.id)).toEqual([mine.id]);
    const viaOps = await callRoute(list, authedRequest(teacher, '/ops/api/v1/appointments'));
    expect(viaOps.status).toBe(403);
    expect((await patch(teacher, mine.id, { action: 'confirm' })).status).toBe(403);
  });
});

describe('teacher seed (owner-supplied, brief §12)', () => {
  it('creates 8 owner-supplied staff with no login or contact data, idempotently; Nikunj Bindal teaches Accounts (D-047); Soma and Soma Tiwari stay two people (OA-2)', async () => {
    // A database seeded before D-047 holds "Accountancy / CA" with no teacher; re-seeding removes it.
    await ctx.db.insert(opsStaffSubjectCapabilities).values({ subject: 'Accountancy / CA' });
    await seedTeachers(ctx.db);
    // A database seeded before OA-2 holds Soma Tiwari's old subject; re-seeding retires it.
    const [tiwari] = await ctx.db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.fullName, 'Soma Tiwari'));
    await ctx.db
      .insert(opsStaffSubjectCapabilities)
      .values({ staffId: tiwari!.id, subject: 'Current Affairs' });
    await seedTeachers(ctx.db);
    const names = OWNER_SUPPLIED_STAFF.map((t) => t.fullName);
    const rows = await ctx.db
      .select({ s: staffMembers, p: opsStaffProfiles })
      .from(staffMembers)
      .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(inArray(staffMembers.fullName, names));
    expect(rows).toHaveLength(8);
    for (const { s, p } of rows) {
      expect(s.userId).toBeNull();
      expect(p.verificationStatus).toBe(s.fullName === 'Soma' ? 'unverified' : 'confirmed');
      // The random staff id can hold 10 digits in a row; only the other fields matter here.
      expect(JSON.stringify({ ...p, staffId: null })).not.toMatch(/@|\+91|\d{10}/);
    }
    const tushar = rows.find((r) => r.s.fullName === 'Tushar Bhakte')!;
    expect(tushar.p.notes).toMatch(/Not a verified credential/);
    expect(rows.find((r) => r.s.fullName === 'Sushant Bindal')?.p.roleNote).toBe(
      'CEO / director of coaching',
    );
    const caps = await ctx.db.select().from(opsStaffSubjectCapabilities);
    const subjectsOf = (name: string) =>
      caps
        .filter((c) => c.staffId === rows.find((r) => r.s.fullName === name)!.s.id)
        .map((c) => c.subject)
        .sort();
    expect(subjectsOf('Soma')).toEqual(['CLAT Current Affairs']);
    expect(subjectsOf('Soma Tiwari')).toEqual(['Economics']);
    expect(subjectsOf('Satish Raghuvanshi')).toEqual([
      'Class 11 Mathematics',
      'Class 12 Mathematics',
      'IPMAT Quantitative Aptitude',
    ]);
    const nikunj = rows.find((r) => r.s.fullName === 'Nikunj Bindal')!;
    expect(nikunj.p.roleNote).toBe('Head of Business Operations');
    expect(
      caps
        .filter((c) => c.staffId === nikunj.s.id)
        .map((c) => c.subject)
        .sort(),
    ).toEqual([
      'CA Foundation Paper 1 (Accounting)',
      'CUET Accountancy',
      'Class 11/12 Accountancy',
    ]);
    const picker = await callRoute<{
      teachers: { fullName: string }[];
      unassignedSubjects: string[];
    }>(teachers, authedRequest(counsellor, '/ops/api/v1/teachers?subject=mathematics'));
    expect(picker.data?.teachers.map((t) => t.fullName).sort()).toEqual([
      'Satish Raghuvanshi',
      'Sobha',
    ]);
    expect(picker.data?.unassignedSubjects).toEqual([]);
  });
});
