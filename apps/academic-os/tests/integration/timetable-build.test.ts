/**
 * ACD-029 / D-111 "rules build, AI explains": POST timetable/build saves DRAFT patterns only, under the
 * timetable lock, audited; the AI note is simulated (fetch to https://ai.test) and never gets a name.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { academicClassSessions, academicTimetablePatterns, auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { POST as buildRoute } from '../../src/app/api/v1/timetable/build/route';
import { createCalendarRule, createRoom } from '../../src/server';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
type Built = { drafts: { id: string; weekday: number; startTime: string; teacherName: string; roomCode: string | null; classes: number }[]; unplaced: { subjectName: string; missing: number; reasons: { code: string }[] }[]; note: { text: string; source: 'ai' | 'system'; label: string } };
const body = (b: World, subjects: [{ id: string }, number][]) => ({ batchId: b.batch.id, from: '2099-05-04', to: '2099-05-17', dayStart: '09:00', dayEnd: '12:00', subjects: subjects.map(([s, n]) => ({ subjectId: s.id, weeklyClasses: n })) });
const build = (user: Users['teacher'] | null, json: object) => callRoute<Built>(buildRoute, user ? authedRequest(user, '/academic/api/v1/timetable/build', { json }) : buildRequest('/academic/api/v1/timetable/build', { json }));
const sent: string[] = [];
let reply = (): Response => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"note":"Four classes were placed as drafts. Check them before publishing."}' } }] });

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST timetable/build (ACD-029)', () => {
  let u: Users;
  let w: World;
  let first: Built;

  async function batchWithCalendar() {
    const b = await world(ctx.db, u);
    await createCalendarRule(ctx.db, actor(u.coordinator), { batchId: b.batch.id, label: 'Weekdays (fictional)', periodStart: '2099-05-01', periodEnd: '2099-05-31', weekdays: [1, 2, 3, 4, 5], slotsPerDay: 2, kind: 'regular', status: 'provisional' });
    return b;
  }

  it('checks sign-in, permission and the body', async () => {
    u = await users(ctx.db);
    w = await batchWithCalendar();
    await createRoom(ctx.db, actor(u.coordinator), { code: 'R-BUILD', name: 'Room (fictional)' });
    const other = await world(ctx.db, u);
    expect((await build(null, body(w, [[w.quant, 2]]))).status).toBe(401);
    expect((await build(u.teacher, body(w, [[w.quant, 2]]))).status).toBe(403);
    expect((await build(u.coordinator, { ...body(w, [[w.quant, 2]]), dayEnd: '08:00' })).status).toBe(400);
    expect((await build(u.coordinator, body(w, []))).status).toBe(400);
    expect((await build(u.coordinator, body(w, [[other.quant, 2]]))).status).toBe(400);
  });

  it('creates DRAFT patterns only, audits, and says when the note is the system summary', async () => {
    const res = await build(u.coordinator, body(w, [[w.quant, 2], [w.verbal, 2]]));
    expect(res.status).toBe(201);
    first = res.data!;
    expect(first.drafts).toHaveLength(4);
    expect(first.drafts.every((d) => d.roomCode === 'R-BUILD' && d.classes === 2)).toBe(true);
    expect(first.unplaced).toEqual([]);
    expect(first.note).toMatchObject({ source: 'system', label: 'Summary written by the system; AI note unavailable' });
    expect(first.note.text).toMatch(/^Placed 4 of 4 weekly classes as draft patterns; nothing is published yet\./);
    const patterns = await ctx.db.select().from(academicTimetablePatterns).where(eq(academicTimetablePatterns.batchId, w.batch.id));
    expect(patterns.map((p) => p.status)).toEqual(['draft', 'draft', 'draft', 'draft']);
    expect(await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.batchId, w.batch.id))).toEqual([]);
    const [audit] = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'timetable.build_drafted'), eq(auditEvents.entityId, w.batch.id)));
    expect((audit!.metadata as { patternIds: string[] }).patternIds.sort()).toEqual(patterns.map((p) => p.id).sort());
    expect(await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'ai.draft_requested'))).toEqual([]);
    expect((await build(u.coordinator, body(w, [[w.quant, 1]]))).status).toBe(409); // drafts exist: nothing is replaced
  });

  it('avoids a teacher held by another batch’s drafts; the AI note gets no names', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test-only-groq-key-123456');
    vi.stubEnv('GROQ_MODEL', 'test-model');
    vi.stubEnv('GROQ_BASE_URL', 'https://ai.test/v1');
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (!String(url).startsWith('https://ai.test/')) return real(url, init);
        sent.push(String(init?.body));
        return reply();
      }),
    );
    const other = await batchWithCalendar(); // same quant teacher as the first batch
    const res = (await build(u.coordinator, body(other, [[other.quant, 2]]))).data!;
    const firstQuant = first.drafts.filter((d) => d.teacherName === res.drafts[0]!.teacherName).map((d) => `${d.weekday} ${d.startTime}`);
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts.map((d) => `${d.weekday} ${d.startTime}`).filter((slot) => firstQuant.includes(slot))).toEqual([]);
    expect(res.note).toEqual({ source: 'ai', label: 'AI note — check the drafts before publishing', text: 'Four classes were placed as drafts. Check them before publishing.' });
    expect(sent).toHaveLength(1);
    for (const secret of ['Tina', 'Tom', 'fictional', other.teacherStaff, other.batch.id, other.batch.code, other.quant.id]) expect(sent[0]).not.toContain(secret);
    expect(sent[0]).toContain('Teacher 1');
    const ai = await ctx.db.select().from(auditEvents).where(and(inArray(auditEvents.action, ['ai.draft_requested', 'ai.draft_finished']), eq(auditEvents.entityId, other.batch.id)));
    expect(ai.map((a) => [a.action, (a.metadata as { status?: string }).status])).toEqual([['ai.draft_requested', undefined], ['ai.draft_finished', 'ok']]);
  });

  it('a failed AI answer falls back to the system summary; the drafts stay saved', async () => {
    reply = () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"note":' } }] });
    const third = await batchWithCalendar();
    const res = await build(u.coordinator, body(third, [[third.verbal, 1]]));
    expect(res.status).toBe(201);
    expect(res.data!.note.source).toBe('system');
    expect(res.data!.drafts).toHaveLength(1);
    const [finished] = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'ai.draft_finished'), eq(auditEvents.entityId, third.batch.id)));
    expect(finished!.metadata).toMatchObject({ feature: 'timetable_note', status: 'invalid_output' });
  });
});
