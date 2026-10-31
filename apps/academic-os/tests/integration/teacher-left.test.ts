/**
 * HR ended a teacher's employment (PPL-006): core.staff_members says inactive. Nothing is ended or
 * moved automatically, but Academic stops calling their classes fine. Fictional data only.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { academicTeacherAssignments, staffMembers } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { checkTimetableFor, coordinatorOverview, createPattern, createSessions, listTeachers, uncoveredSessions } from '../../src/server';
import { assignSubstitute } from '../../src/server/services/delivery';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
const DATE = '2099-03-02';
const session = (staffKey: 'teacherStaff' | 'teacher2Staff', subject: 'quant' | 'verbal', date = DATE, startTime = '09:00') => ({
  batchId: w.batch.id,
  subjectId: w[subject].id,
  teacherStaffId: w[staffKey],
  sessionType: 'teaching' as const,
  date,
  startTime,
  durationMinutes: 75,
});
const check = () => checkTimetableFor(ctx.db, actor(u.coordinator), { from: DATE, to: DATE, batchId: w.batch.id, candidates: [] });
const uncovered = () => uncoveredSessions(ctx.db, actor(u.coordinator), { from: DATE, to: DATE });

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
});

describe('a teacher who has left', () => {
  let leaverClass: string;

  it('before HR ends it the class is fine', async () => {
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [session('teacherStaff', 'quant'), session('teacher2Staff', 'verbal', DATE, '11:00')]);
    leaverClass = sessions[0]!.id;
    expect((await check()).verdict).toBe('feasible');
    expect(await uncovered()).toEqual([]);
  });

  it('afterwards the check is infeasible on that class only, Uncovered classes names them, the teachers list marks them', async () => {
    await ctx.db.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.id, w.teacherStaff));
    const result = await check();
    expect(result.verdict).toBe('infeasible');
    expect(result.hard).toEqual([expect.objectContaining({ code: 'TEACHER_LEFT', sessionIds: [leaverClass] })]);
    expect(result.hard[0]!.message).toMatch(/left/);
    const flagged = await uncovered();
    expect(flagged.map((s) => s.id)).toEqual([leaverClass]);
    expect(flagged[0]!.unavailableNames).toEqual(['Tina Teacher (fictional) (left)']);
    const listed = await listTeachers(ctx.db, actor(u.coordinator));
    expect(listed.find((t) => t.staffId === w.teacherStaff)).toMatchObject({ left: true });
    expect(listed.find((t) => t.staffId === w.teacher2Staff)).toMatchObject({ left: false });
    const overview = await coordinatorOverview(ctx.db, actor(u.coordinator), new Date(`${DATE}T04:00:00Z`));
    expect(overview.conflicts.hard).toBeGreaterThan(0);
    expect(overview.uncovered.sessions.map((s) => s.id)).toContain(leaverClass);
  });

  it('nothing was ended or moved: the assignment stays active and the class stays scheduled with them', async () => {
    const [assignment] = await ctx.db.select().from(academicTeacherAssignments).where(eq(academicTeacherAssignments.staffMemberId, w.teacherStaff));
    expect(assignment).toMatchObject({ status: 'active', endDate: null });
  });

  it('they cannot be put on the timetable: one-off class, new series, substitute (FLB-002)', async () => {
    const refused = { code: 'VALIDATION_FAILED', message: expect.stringMatching(/inactive/) };
    await expect(createSessions(ctx.db, actor(u.coordinator), [session('teacherStaff', 'quant', '2099-03-03')])).rejects.toMatchObject(refused);
    await expect(createPattern(ctx.db, actor(u.coordinator), { batchId: w.batch.id, subjectId: w.quant.id, staffId: w.teacherStaff, weekday: 1, startTime: '09:00', durationMinutes: 75, effectiveFrom: '2099-04-01', effectiveTo: '2099-04-30' } as never)).rejects.toMatchObject(refused);
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [session('teacher2Staff', 'verbal', '2099-03-04')]);
    await expect(assignSubstitute(ctx.db, actor(u.coordinator), sessions[0]!.id, { staffId: w.teacherStaff, reason: 'Cover (fictional)' } as never)).rejects.toMatchObject(refused);
  });

  it('a substitute clears the flag', async () => {
    const substitute = await staffFor(ctx.db, null, 'Sample Substitute (fictional)');
    await assignSubstitute(ctx.db, actor(u.coordinator), leaverClass, { staffId: substitute, reason: 'Teacher left (fictional)' } as never);
    expect((await check()).verdict).toBe('feasible');
    expect(await uncovered()).toEqual([]);
  });
});
