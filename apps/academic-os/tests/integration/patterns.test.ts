/** Brief §9, acceptance tests 3 and 5: draft → validate/preview → publish; conflicts incl. concurrent edits; series edits from a date. */
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicClassSessions, academicTeacherUnavailability, academicTimetablePatterns, auditEvents, notifications } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as listPatternsRoute, POST as createPatternRoute } from '../../src/app/api/v1/patterns/route';
import { GET as previewRoute } from '../../src/app/api/v1/patterns/[id]/preview/route';
import * as patternRoute from '../../src/app/api/v1/patterns/[id]/route';
import { POST as publishRoute } from '../../src/app/api/v1/patterns/[id]/publish/route';
import { POST as exclusionRoute } from '../../src/app/api/v1/exclusions/route';
import { fmtDay } from '@elevate/shared-types';
import { cancelSession, createPattern, createSessions, createStudent, editSeries, enrolManually, markDelivered, publishPattern } from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let other: World;
const p: Record<string, string> = {};
const MONDAYS_FEB = ['2099-02-02', '2099-02-09', '2099-02-16', '2099-02-23'];

type Preview = { pattern: { version: number }; toCreate: string[]; occurrences: { date: string; sessionId: string | null; skipped: string | null; conflicts: string[] }[]; check: { verdict: string; hard: { code: string }[] } };
const pattern = (over: Record<string, unknown> = {}) => ({ batchId: w.batch.id, subjectId: w.quant.id, staffId: w.teacherStaff, weekday: 1, startTime: '09:00', durationMinutes: 75, effectiveFrom: '2099-02-01', effectiveTo: '2099-02-28', ...over });
const preview = (id: string) => callRoute<Preview>(previewRoute, authedRequest(u.coordinator, `/academic/api/v1/patterns/${id}/preview`), { id });
const publish = (user: Users['teacher'], id: string, version: number) => callRoute<{ created: unknown[] }>(publishRoute, authedRequest(user, `/academic/api/v1/patterns/${id}/publish`, { json: { version } }), { id });

describe('patterns: draft → preview → publish (test 3)', () => {
  it('only the coordinator creates; bodies are validated', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    other = await world(ctx.db, u);
    const create = (user: Users['teacher'] | null, json: Record<string, unknown>) => callRoute<{ id: string; status: string }>(createPatternRoute, user ? authedRequest(user, '/academic/api/v1/patterns', { json }) : buildRequest('/academic/api/v1/patterns', { json }));
    expect((await create(null, pattern())).status).toBe(401);
    expect((await create(u.teacher, pattern())).status).toBe(403);
    expect((await create(u.coordinator, pattern({ weekday: 8 }))).status).toBe(400);
    expect((await create(u.coordinator, pattern({ subjectId: other.quant.id }))).status).toBe(400);
    const ok = await create(u.coordinator, pattern());
    expect(ok.data).toMatchObject({ status: 'draft' });
    p.main = ok.data!.id;
    expect((await callRoute<unknown[]>(listPatternsRoute, authedRequest(u.teacher, '/academic/api/v1/patterns'))).data).toHaveLength(1);
    expect((await callRoute<unknown[]>(listPatternsRoute, authedRequest(u.teacher2, '/academic/api/v1/patterns'))).data).toHaveLength(0);
  });

  it('a draft can be edited (version-checked) or deleted; a published pattern cannot', async () => {
    const patch = (id: string, json: Record<string, unknown>) => callRoute<{ startTime: string; version: number }>(patternRoute.PATCH, authedRequest(u.coordinator, `/academic/api/v1/patterns/${id}`, { method: 'PATCH', json }), { id });
    const del = (user: Users['teacher'], id: string, json: Record<string, unknown> = { version: 2, confirm: true }) => callRoute(patternRoute.DELETE, authedRequest(user, `/academic/api/v1/patterns/${id}`, { method: 'DELETE', json }), { id });
    const draft = await createPattern(ctx.db, actor(u.coordinator), pattern({ startTime: '16:00' }));
    expect((await patch(draft.id, { startTime: '16:30', version: 9 })).status).toBe(409);
    expect((await patch(draft.id, { weekday: 9, version: 1 })).status).toBe(400);
    expect((await patch(draft.id, { startTime: '16:30', version: 1 })).data).toMatchObject({ startTime: '16:30', version: 2 });
    expect((await del(u.teacher, draft.id)).status).toBe(403);
    expect((await del(u.coordinator, draft.id, { version: 2 })).status).toBe(400); // confirmation required
    expect((await del(u.coordinator, draft.id, { version: 1, confirm: true })).status).toBe(409); // stale version
    expect((await del(u.coordinator, draft.id)).status).toBe(200);
    expect(await ctx.db.select().from(academicTimetablePatterns).where(eq(academicTimetablePatterns.id, draft.id))).toEqual([]);
  });

  it('preview lists occurrences, skips closures and shows teacher conflicts; publishing is refused until they are fixed', async () => {
    await callRoute(exclusionRoute, authedRequest(u.coordinator, '/academic/api/v1/exclusions', { json: { kind: 'holiday', label: 'Holiday (fictional)', date: '2099-02-16', status: 'confirmed' } }));
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: other.batch.id, subjectId: other.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2099-02-09', startTime: '09:30', durationMinutes: 75 }]);
    const first = (await preview(p.main!)).data!;
    expect(first.occurrences.map((o) => o.date)).toEqual(MONDAYS_FEB);
    expect(first.occurrences.find((o) => o.date === '2099-02-16')!.skipped).toBe('Holiday (fictional)');
    expect(first.occurrences.find((o) => o.date === '2099-02-09')!.conflicts).toHaveLength(1);
    expect(first.check.hard.map((c) => c.code)).toEqual(['TEACHER_OVERLAP']);
    expect((await publish(u.teacher, p.main!, 1)).status).toBe(403);
    expect((await publish(u.coordinator, p.main!, 1)).status).toBe(409);
    expect(await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.patternId, p.main as never))).toEqual([]);

    await cancelSession(ctx.db, actor(u.coordinator), sessions[0]!.id, 'Moved (fictional)'); // cancelled sessions free the slot
    expect((await publish(u.coordinator, p.main!, 5)).status).toBe(409); // stale version
    const ok = await publish(u.coordinator, p.main!, 1);
    expect(ok.status).toBe(200);
    expect(ok.data!.created).toHaveLength(3);
    const scheduledAudit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'class_session.scheduled'));
    expect(scheduledAudit.filter((a) => (a.metadata as { patternId?: string } | null)?.patternId === p.main)).toHaveLength(3);
    expect((await callRoute(patternRoute.PATCH, authedRequest(u.coordinator, `/academic/api/v1/patterns/${p.main}`, { method: 'PATCH', json: { startTime: '10:00', version: 2 } }), { id: p.main! })).status).toBe(409); // published
    expect((await publish(u.coordinator, p.main!, 2)).data!.created).toHaveLength(0); // idempotent re-publish
    expect(await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.patternId, p.main as never))).toHaveLength(3);
  });

  it('a student placed in two batches blocks overlapping patterns; an unavailable teacher is flagged', async () => {
    const coord = actor(u.coordinator);
    const student = await createStudent(ctx.db, coord, { fullName: 'Farah Sample Student' });
    await enrolManually(ctx.db, coord, { studentId: student.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: student.id, batchId: other.batch.id, startDate: '2026-09-01', reason: 'Second programme (fictional)' });
    const thirdTeacher = await staffFor(ctx.db, null, 'Uma Sample Teacher');
    const clash = await createPattern(ctx.db, coord, pattern({ batchId: other.batch.id, subjectId: other.verbal.id, staffId: thirdTeacher, startTime: '09:30' }));
    const clashPreview = (await preview(clash.id)).data!;
    expect(clashPreview.check.hard.map((c) => c.code)).toContain('STUDENT_OVERLAP');
    await ctx.db.insert(academicTeacherUnavailability).values({ staffId: thirdTeacher, fromDate: '2099-02-23', toDate: '2099-02-23', reason: 'Away (fictional)', enteredByUserId: u.coordinator.id });
    const late = await createPattern(ctx.db, coord, pattern({ batchId: other.batch.id, subjectId: other.verbal.id, staffId: thirdTeacher, startTime: '14:00' }));
    const res = (await preview(late.id)).data!;
    expect(res.occurrences.find((o) => o.date === '2099-02-23')!.conflicts.join(' ')).toMatch(/not HR leave/);
  });

  it('two conflicting changes at the same time: exactly one wins, the other gets a conflict', async () => {
    const coord = actor(u.coordinator);
    const one = (batch: World) => createSessions(ctx.db, coord, [{ batchId: batch.batch.id, subjectId: batch.quant.id, teacherStaffId: w.teacher2Staff, sessionType: 'teaching', date: '2099-04-07', startTime: '15:00', durationMinutes: 75 }]);
    const results = await Promise.allSettled([one(w), one(other)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  });
});

describe('a teacher given a series is told (FLB-003)', () => {
  const noticesTo = (user: Users['teacher']) => ctx.db.select().from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.kind, 'timetable_pattern.series_changed')));

  it('moving a series tells the new teacher and the old one, once each, and nobody else; first publish tells its teacher', async () => {
    const coord = actor(u.coordinator);
    const [fromOld, fromNew] = [(await noticesTo(u.teacher)).length, (await noticesTo(u.teacher2)).length];
    const created = await createPattern(ctx.db, coord, pattern({ startTime: '15:00', effectiveFrom: '2099-06-01', effectiveTo: '2099-06-30' }));
    const first = await publishPattern(ctx.db, coord, created.id, 1);
    const published = await noticesTo(u.teacher);
    expect(published).toHaveLength(fromOld + 1);
    expect(published.at(-1)!.title).toContain(`${first.created.length} classes`);
    expect(await noticesTo(u.teacher2)).toHaveLength(fromNew);
    const res = await editSeries(ctx.db, coord, created.id, { effectiveDate: '2099-06-15', staffId: w.teacher2Staff, reason: 'Teacher change (fictional)', version: 2 }, new Date('2099-06-02T06:00:00Z'));
    const [oldNotes, newNotes] = [await noticesTo(u.teacher), await noticesTo(u.teacher2)];
    expect(oldNotes).toHaveLength(fromOld + 2);
    expect(oldNotes.at(-1)!.title).toContain(`${res.cancelled.length} classes`);
    expect(newNotes).toHaveLength(fromNew + 1);
    expect(newNotes.at(-1)).toMatchObject({ link: '/academic/timetable', body: 'Teacher change (fictional)' });
    expect(newNotes.at(-1)!.title).toContain(`${res.created.length} classes`);
    expect(await noticesTo(u.coordinator)).toEqual([]);
  });
});

describe('no last date: the column allows it, no route writes it (RL1-005)', () => {
  const noEnd = async (startTime: string, over: Record<string, unknown> = {}) => (await ctx.db.insert(academicTimetablePatterns).values({ ...pattern({ effectiveFrom: '2099-05-01', effectiveTo: null, startTime, ...over }), createdByUserId: u.coordinator.id } as never).returning())[0]!;

  it('a draft opens, plans no classes and cannot be published until it has a last date', async () => {
    const { id } = await noEnd('15:00');
    const patch = (json: Record<string, unknown>) => callRoute(patternRoute.PATCH, authedRequest(u.coordinator, `/academic/api/v1/patterns/${id}`, { method: 'PATCH', json }), { id });
    const seen = await preview(id);
    expect(seen.status).toBe(200);
    expect(seen.data).toMatchObject({ toCreate: [], occurrences: [], check: { hard: [] } });
    expect((await publish(u.coordinator, id, 1)).status).toBe(400);
    expect((await patch({ startTime: '15:30', version: 1 })).status).toBe(400);
    expect((await patch({ effectiveTo: '2099-05-31', version: 1 })).status).toBe(200);
    expect((await preview(id)).data!.toCreate).toEqual(['2099-05-04', '2099-05-11', '2099-05-18', '2099-05-25']);
  });

  it('a published one lists only the classes it has; a series change is refused and moves nothing', async () => {
    const { id } = await noEnd('17:00', { status: 'published', publishedAt: new Date(), publishedByUserId: u.coordinator.id });
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2099-05-04', startTime: '17:00', durationMinutes: 75 }]);
    await ctx.db.update(academicClassSessions).set({ patternId: id as never }).where(eq(academicClassSessions.id, sessions[0]!.id));
    expect((await preview(id)).data).toMatchObject({ toCreate: [], occurrences: [{ date: '2099-05-04', sessionId: sessions[0]!.id }] });
    await expect(editSeries(ctx.db, actor(u.coordinator), id, { effectiveDate: '2099-05-11', reason: 'Sample change', version: 1 }, new Date('2099-05-02T06:00:00Z'))).rejects.toMatchObject({ status: 400 });
    const [kept] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessions[0]!.id));
    expect(kept!.status).toBe('scheduled');
  });
});

describe('editing a published series from a date (test 5)', () => {
  it('delivered and earlier classes stay; later undelivered ones move to the new series', async () => {
    const coord = actor(u.coordinator);
    const created = await createPattern(ctx.db, coord, pattern({ subjectId: w.verbal.id, staffId: w.teacher2Staff, startTime: '12:00', effectiveFrom: '2099-03-01', effectiveTo: '2099-03-31' }));
    await publishPattern(ctx.db, coord, created.id, 1);
    const now = new Date('2099-03-12T06:00:00Z');
    const occurrences = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.patternId, created.id));
    const byDate = (d: string) => occurrences.find((o) => o.date === d)!.id;
    await markDelivered(ctx.db, actor(u.teacher2), byDate('2099-03-02'), {}, now);
    const edit = { effectiveDate: '2099-03-13', startTime: '13:30', reason: 'New room timings (fictional)', version: 2 };
    await expect(editSeries(ctx.db, coord, created.id, { ...edit, effectiveDate: '2099-03-12' }, now)).rejects.toMatchObject({ status: 400 });
    await expect(editSeries(ctx.db, coord, created.id, { ...edit, version: 1 }, now)).rejects.toMatchObject({ status: 409 });
    const res = await editSeries(ctx.db, coord, created.id, edit, now);
    expect(res.cancelled.map((c) => c.date).sort()).toEqual(['2099-03-16', '2099-03-23', '2099-03-30']);
    expect(res.cancelled.every((c) => c.statusReason === `Series changed from ${fmtDay('2099-03-13')}: New room timings (fictional)`)).toBe(true);
    const cancelAudit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'class_session.cancelled'), inArray(auditEvents.entityId, res.cancelled.map((c) => c.id as string))));
    expect(cancelAudit).toHaveLength(3);
    // One notice for the whole change, not one per class (FLB-003).
    const notes = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, u.teacher2.id), eq(notifications.entityId, res.pattern.id)));
    expect(notes.map((n) => [n.link, n.body])).toEqual([['/academic/timetable', 'New room timings (fictional)']]);
    expect(notes[0]!.title).toContain(`from ${fmtDay('2099-03-13')}`);
    expect(await ctx.db.select().from(notifications).where(and(eq(notifications.userId, u.teacher2.id), inArray(notifications.entityId, res.cancelled.map((c) => c.id as string))))).toEqual([]);
    expect(res.created.map((c) => [c.date, c.startTime])).toEqual([['2099-03-16', '13:30'], ['2099-03-23', '13:30'], ['2099-03-30', '13:30']]);
    const kept = await ctx.db.select().from(academicClassSessions).where(and(eq(academicClassSessions.patternId, created.id)));
    expect(kept.find((k) => k.date === '2099-03-02')).toMatchObject({ status: 'held', startTime: '12:00' });
    expect(kept.find((k) => k.date === '2099-03-09')).toMatchObject({ status: 'scheduled', startTime: '12:00' });
    const [old] = await ctx.db.select().from(academicTimetablePatterns).where(eq(academicTimetablePatterns.id, created.id));
    expect(old).toMatchObject({ effectiveTo: '2099-03-12', status: 'published' });
    // A single class can still be changed on its own (reschedule/cancel); the series edit left it alone.
    await cancelSession(ctx.db, coord, byDate('2099-03-09'), 'One-off closure (fictional)');
  });
});
