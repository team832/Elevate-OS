/**
 * Admit cards in Academic (F4-03): roll numbers given once, by batch then name, the same on every
 * rerun and never reused (a removed row keeps its number, a later row gets the next); venue rules;
 * internal route callers; academic coordinators through the public route. Fictional people only.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { academicAssessmentRoster, academicRooms, auditEvents } from '@elevate/database';
import { academicAdmitCardsV1Schema, type AcademicAdmitCardsV1 } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as createRoute } from '../../src/app/api/internal/v1/assessments/route';
import { POST as snapshotRoute } from '../../src/app/api/internal/v1/assessments/[id]/roster/route';
import { POST as correctionRoute } from '../../src/app/api/internal/v1/assessments/[id]/roster/corrections/route';
import {
  GET as cardsRoute,
  POST as writeRoute,
} from '../../src/app/api/internal/v1/assessments/[id]/admit-cards/route';
import { POST as publicRoute } from '../../src/app/api/v1/assessments/[id]/admit-cards/route';
import { createBatch, createRoom, createStudent, enrolManually } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let ops: TestUser;
let testId: string;
const s: Record<string, string> = {};

type Handler = Parameters<typeof callRoute>[0];
const headers = (caller = 'ops', acting: string | null = ops.id) => ({
  authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`,
  'x-elevate-caller': caller,
  ...(acting ? { 'x-elevate-acting-user': acting } : {}),
});
const internal = <T = AcademicAdmitCardsV1>(
  route: Handler,
  sub: string,
  json?: unknown,
  h = headers(),
) =>
  callRoute<T>(
    route,
    buildRequest(`/academic/api/internal/v1/assessments/${testId}/${sub}`, { json, headers: h }),
    { id: testId },
  );
const write = (json: unknown, h = headers()) => internal(writeRoute, 'admit-cards', json, h);
const cards = async () =>
  academicAdmitCardsV1Schema.parse((await internal(cardsRoute, 'admit-cards')).data);
const rolls = async () =>
  Object.fromEntries((await cards()).rows.map((r) => [r.displayName, r.rollNumber]));

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
  const coord = actor(u.coordinator);
  const batch = async (code: string) =>
    (
      await createBatch(ctx.db, coord, {
        code: uniq(code),
        name: 'Admit card batch (fictional)',
        courseId: w.course.id,
        startDate: '2026-09-01',
        status: 'active',
      })
    ).id;
  const bA = await batch('AC-A-');
  const bB = await batch('AC-B-');
  s.bA = bA;
  for (const [name, b] of [
    ['Sample Zara (fictional)', bA],
    ['Sample Amit (fictional)', bA],
    ['Sample Bina (fictional)', bB],
    ['Sample Aaron (fictional)', bA],
  ] as const) {
    const st = await createStudent(ctx.db, coord, { fullName: name });
    s[name] = st.id;
    if (!name.includes('Aaron'))
      await enrolManually(ctx.db, coord, {
        studentId: st.id,
        batchId: b,
        startDate: '2026-09-01',
        reason: 'Test (fictional)',
      });
  }
  const created = await callRoute<{ assessment: { id: string } }>(
    createRoute,
    buildRequest('/academic/api/internal/v1/assessments', {
      headers: headers(),
      json: {
        code: uniq('AC-'),
        kind: 'full_mock',
        title: 'Admit card mock (fictional)',
        academicYear: '2026-27',
        batchIds: [bA, bB],
        scheduledDate: '2026-12-20',
      },
    }),
  );
  expect(created.status).toBe(200);
  testId = created.data!.assessment.id;
});

describe('roll numbers', () => {
  it('waits for the roster', async () => {
    const r = await write({ action: 'roll_numbers' });
    expect(r.status).toBe(409);
    expect(r.error?.message).toMatch(/roster first/);
  });

  it('numbers by batch then name, and a rerun changes nothing', async () => {
    expect((await internal(snapshotRoute, 'roster', {})).status).toBe(200);
    expect(Object.values(await rolls())).toEqual([null, null, null]);
    expect((await write({ action: 'roll_numbers' })).status).toBe(200);
    const first = await rolls();
    expect(first).toEqual({
      'Sample Amit (fictional)': 1,
      'Sample Zara (fictional)': 2,
      'Sample Bina (fictional)': 3,
    });
    expect((await write({ action: 'roll_numbers' })).status).toBe(200);
    expect(await rolls()).toEqual(first);
    const audits = await ctx.db
      .select({ m: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, testId),
          eq(auditEvents.action, 'assessment.roll_numbers_given'),
        ),
      );
    expect(audits.map((a) => (a.m as { given: number }).given)).toEqual([3, 0]);
  });

  it('never reuses a number: a removed row keeps its own, a later row gets the next', async () => {
    const correct = (json: object) => internal(correctionRoute, 'roster/corrections', json);
    expect(
      (
        await correct({
          action: 'remove',
          studentId: s['Sample Zara (fictional)'],
          reason: 'Left the batch (test)',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await correct({
          action: 'add',
          studentId: s['Sample Aaron (fictional)'],
          batchId: s.bA,
          reason: 'Joined late (test)',
        })
      ).status,
    ).toBe(400); // not placed in a covered batch: Academic refuses the add
    await enrolManually(ctx.db, actor(u.coordinator), {
      studentId: s['Sample Aaron (fictional)']!,
      batchId: s.bA!,
      startDate: '2026-09-01',
      reason: 'Test (fictional)',
    });
    expect(
      (
        await correct({
          action: 'add',
          studentId: s['Sample Aaron (fictional)'],
          batchId: s.bA,
          reason: 'Joined late (test)',
        })
      ).status,
    ).toBe(200);
    await write({ action: 'roll_numbers' });
    expect(await rolls()).toEqual({
      'Sample Aaron (fictional)': 4,
      'Sample Amit (fictional)': 1,
      'Sample Bina (fictional)': 3,
    });
    const [zara] = await ctx.db
      .select({ roll: academicAssessmentRoster.rollNumber })
      .from(academicAssessmentRoster)
      .where(eq(academicAssessmentRoster.studentId, s['Sample Zara (fictional)'] as never));
    expect(zara!.roll).toBe(2);
  });
});

describe('venue and instructions', () => {
  let room: string;
  let closed: string;
  beforeAll(async () => {
    const coord = actor(u.coordinator);
    room = (await createRoom(ctx.db, coord, { code: uniq('R'), name: 'Room 1 (fictional)' })).id;
    closed = (await createRoom(ctx.db, coord, { code: uniq('R'), name: 'Old room (fictional)' }))
      .id;
    await ctx.db
      .update(academicRooms)
      .set({ status: 'inactive' })
      .where(eq(academicRooms.id, closed as never));
  });

  it.each([
    [
      () => ({ venue: room, instructions: 'Bring a pencil (test).' }),
      { online: false, roomName: 'Room 1 (fictional)' },
      'Bring a pencil (test).',
    ],
    [
      () => ({ venue: 'online', instructions: '' }),
      { online: true, roomId: null, roomName: null },
      null,
    ],
    [() => ({ venue: 'not_set' }), { online: false, roomId: null, roomName: null }, null],
  ])('%#: saved as given', async (body, venue, instructions) => {
    const r = await write({ action: 'venue', ...body() });
    expect(r.status).toBe(200);
    expect(r.data!.assessment.venue).toMatchObject(venue);
    expect(r.data!.assessment.instructions).toBe(instructions);
    expect(r.data!.rooms.map((x) => x.id)).not.toContain(closed);
  });

  it.each([
    ['an inactive room', () => ({ venue: closed })],
    ['an unknown room', () => ({ venue: crypto.randomUUID() })],
    ['a made-up venue word', () => ({ venue: 'hall' })],
    [
      'instructions over 600 characters',
      () => ({ venue: 'online', instructions: 'x'.repeat(601) }),
    ],
  ])('refuses %s', async (_n, body) => {
    expect((await write({ action: 'venue', ...body() })).status).toBe(400);
  });
});

describe('who may write', () => {
  it.each([
    ['another module', () => headers('marketing'), 403],
    ['no acting user', () => headers('ops', null), 400],
  ])('internal route refuses %s', async (_n, h, status) => {
    expect((await write({ action: 'roll_numbers' }, h())).status).toBe(status);
  });

  it.each([
    ['a coordinator', () => u.coordinator, 200],
    ['a teacher', () => u.teacher, 403],
    ['a director', () => u.director, 403],
  ])('public route for %s: %i', async (_n, who, status) => {
    const r = await callRoute(
      publicRoute,
      authedRequest(who(), `/academic/api/v1/assessments/${testId}/admit-cards`, {
        method: 'POST',
        json: { action: 'roll_numbers' },
      }),
      { id: testId },
    );
    expect(r.status).toBe(status);
  });
});
