/**
 * Build a batch's draft timetable (ACD-029, D-111: "rules build, AI explains"). Under the timetable
 * lock: load the batch's needs and the whole centre's timetable, run the pure builder (A24), save
 * each placed slot as a DRAFT pattern through `createPattern`, audit. Nothing is published and no
 * session is created; the coordinator previews and publishes each draft as usual (A21).
 * After the commit, the AI adapter writes a short note from facts with no personal data; when AI
 * is not set up or fails, the rule-written summary is returned instead and says so.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { academicCalendarRules, academicRooms, academicSubjects, academicTeacherAssignments, academicTimetablePatterns, type Database } from '@elevate/database';
import { aiAssist, AiDraftError } from '@elevate/server-kit/ai';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId } from '@elevate/shared-types';
import { z } from 'zod';
import { BUILD_REASON_TEXT, buildTimetable, eachDate, patternDates, summariseBuild, WEEKDAY_NAMES, type BuildResult, type BuildSubject, type TimetableSession } from '../../domain';
import { assignmentActiveOn, audit, getBatchOrThrow, resolveScope, type Actor } from '../context';
import type { buildTimetableBody } from '../schemas-sessions';
import { createPattern, listPatterns } from './patterns';
import { conflictContext, lockTimetable, weekRange } from './timetable';

type BuildBody = z.output<typeof buildTimetableBody>;
const AI_NOTE_LABEL = 'AI note — check the drafts before publishing';
const SYSTEM_NOTE_LABEL = 'Summary written by the system; AI note unavailable';
const noteAnswer = z.object({ note: z.string().trim().min(1).max(1200) });
const ta = academicTeacherAssignments;

/** Teaching weekdays common to every regular calendar rule touching the dates, and their smallest classes-per-day. */
async function batchCalendar(tx: Database, batchId: string, from: string, to: string) {
  const rules = await tx
    .select()
    .from(academicCalendarRules)
    .where(and(eq(academicCalendarRules.batchId, batchId as BatchId), eq(academicCalendarRules.kind, 'regular'), lte(academicCalendarRules.periodStart, to), gte(academicCalendarRules.periodEnd, from)));
  const notes: string[] = [];
  if (rules.length && eachDate(from, to).some((d) => !rules.some((r) => r.periodStart <= d && d <= r.periodEnd))) notes.push('Some of these dates have no calendar rule; the drafts still cover them.');
  const weekdays = rules.length ? [1, 2, 3, 4, 5, 6, 7].filter((w) => rules.every((r) => r.weekdays.includes(w))) : [];
  if (new Set(rules.map((r) => [...r.weekdays].sort().join())).size > 1) notes.push('Teaching weekdays change within these dates; only the weekdays common to all of them were used.');
  return { weekdays, maxClassesPerDay: rules.length ? Math.min(...rules.map((r) => r.slotsPerDay)) : null, notes };
}

/** Draft patterns of other batches hold their times too, so building several batches before publishing does not double-book. */
async function otherDrafts(tx: Database, input: BuildBody, range: { from: string; to: string }, exclusions: Parameters<typeof patternDates>[1]): Promise<TimetableSession[]> {
  const drafts = await tx
    .select()
    .from(academicTimetablePatterns)
    .where(and(eq(academicTimetablePatterns.status, 'draft'), lte(academicTimetablePatterns.effectiveFrom, range.to), gte(academicTimetablePatterns.effectiveTo, range.from)));
  if (drafts.some((d) => d.batchId === input.batchId && d.effectiveFrom <= input.to && d.effectiveTo! >= input.from)) throw new ConflictError('This batch already has draft patterns for these dates. Publish or delete them before building again.');
  return drafts.filter((d) => d.batchId !== input.batchId).flatMap((d) =>
    patternDates({ weekday: d.weekday, from: d.effectiveFrom > range.from ? d.effectiveFrom : range.from, to: d.effectiveTo! < range.to ? d.effectiveTo! : range.to, batchId: d.batchId }, exclusions)
      .filter((o) => !o.skipped)
      .map((o) => ({ id: `draft-${d.id}-${o.date}`, batchId: d.batchId, teacherStaffId: d.staffId, roomId: d.roomId, date: o.date, startTime: d.startTime, durationMinutes: d.durationMinutes, status: 'scheduled' as const, sessionType: 'teaching' as const })),
  );
}

export async function buildDraftTimetable(db: Database, actor: Actor, input: BuildBody) {
  await resolveScope(db, actor, 'academic:timetable:write');
  const built = await withTransaction(db, async (tx) => {
    await lockTimetable(tx);
    const batch = await getBatchOrThrow(tx, input.batchId);
    if (batch.status === 'completed' || batch.status === 'cancelled') throw new ValidationError(`Batch ${batch.code} is ${batch.status}.`);
    const courseSubjects = await tx.select().from(academicSubjects).where(eq(academicSubjects.courseId, batch.courseId));
    const unknown = input.subjects.filter((s) => !courseSubjects.some((c) => c.id === s.subjectId));
    if (unknown.length) throw new ValidationError('A subject is not part of the batch’s course.', { details: { subjectIds: unknown.map((s) => s.subjectId) } });
    // Teachers assigned for the whole period, the primary teacher first.
    const assignments = await tx
      .select({ subjectId: ta.subjectId, staffId: ta.staffMemberId, role: ta.role })
      .from(ta)
      .where(and(eq(ta.batchId, batch.id), assignmentActiveOn(input.from), assignmentActiveOn(input.to)))
      .orderBy(asc(ta.staffMemberId));
    const subjects: BuildSubject[] = input.subjects.map((s) => ({
      subjectId: s.subjectId,
      label: courseSubjects.find((c) => c.id === s.subjectId)!.name,
      weeklyClasses: s.weeklyClasses,
      teacherStaffIds: [...new Set(assignments.filter((a) => a.subjectId === s.subjectId).sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary')).map((a) => a.staffId as string))],
    }));
    const calendar = await batchCalendar(tx, batch.id, input.from, input.to);
    const rooms = await tx.select().from(academicRooms).where(eq(academicRooms.status, 'active')).orderBy(asc(academicRooms.code));
    const range = weekRange(input);
    const ctx = await conflictContext(tx, range.from, range.to);
    const held = await otherDrafts(tx, input, range, ctx.exclusions);
    const result = buildTimetable({
      batchId: batch.id,
      from: input.from,
      to: input.to,
      teachingWeekdays: calendar.weekdays,
      maxClassesPerDay: calendar.maxClassesPerDay,
      dayStart: input.dayStart,
      dayEnd: input.dayEnd,
      classMinutes: ctx.classLengthByBatch[batch.id]?.minutes ?? null,
      subjects,
      roomIds: rooms.map((r) => r.id),
      centre: { ...ctx, existing: [...ctx.existing, ...held] },
    });
    result.notes.push(...calendar.notes);
    if (held.length) result.notes.push('Times held by draft patterns of other batches were avoided.');
    const drafts = [];
    for (const slot of result.placed) {
      drafts.push(await createPattern(tx, actor, { batchId: batch.id, subjectId: slot.subjectId, staffId: slot.teacherStaffId, roomId: slot.roomId ?? undefined, weekday: slot.weekday, startTime: slot.startTime, durationMinutes: slot.durationMinutes, effectiveFrom: input.from, effectiveTo: input.to }));
    }
    await audit(tx, actor, {
      action: 'timetable.build_drafted',
      entityType: 'batch',
      entityId: batch.id,
      metadata: { from: input.from, to: input.to, dayStart: input.dayStart, dayEnd: input.dayEnd, requested: input.subjects, patternIds: drafts.map((d) => d.id), unplaced: result.unplaced },
    });
    const slotOf = new Map(drafts.map((d, i) => [d.id as string, result.placed[i]!]));
    const named = (await listPatterns(tx, actor, { batchId: batch.id })).filter((p) => slotOf.has(p.id));
    return { batchId: batch.id, result, subjects, drafts: named.map((p) => ({ id: p.id, subjectName: p.subjectName, weekday: p.weekday, startTime: p.startTime, durationMinutes: p.durationMinutes, teacherName: p.teacherName, roomCode: p.roomCode, classes: slotOf.get(p.id)!.classes, warnings: slotOf.get(p.id)!.preferences.map((c) => BUILD_REASON_TEXT[c]) })) };
  });

  const { result, subjects } = built;
  return {
    drafts: built.drafts,
    unplaced: result.unplaced.map((u) => ({ subjectId: u.subjectId, subjectName: subjects.find((s) => s.subjectId === u.subjectId)!.label, missing: u.missing, reasons: u.reasonCodes.map((code) => ({ code, text: BUILD_REASON_TEXT[code] })) })),
    notes: result.notes,
    note: await explain(db, actor, built.batchId, result, subjects),
  };
}

/** Facts for the AI: subject names, counts, weekdays, times, reason codes and "Teacher n" labels — no names, ids or contacts. */
function aiFacts(result: BuildResult, subjects: readonly BuildSubject[]) {
  const teacher = new Map<string, string>();
  const label = (staffId: string) => teacher.get(staffId) ?? teacher.set(staffId, `Teacher ${teacher.size + 1}`).get(staffId)!;
  const name = (id: string) => subjects.find((s) => s.subjectId === id)!.label;
  return JSON.stringify({
    requested: subjects.map((s) => ({ subject: name(s.subjectId), classesPerWeek: s.weeklyClasses })),
    placed: result.placed.map((p) => ({ subject: name(p.subjectId), weekday: WEEKDAY_NAMES[p.weekday - 1], start: p.startTime, minutes: p.durationMinutes, teacher: label(p.teacherStaffId), warnings: p.preferences })),
    notPlaced: result.unplaced.map((u) => ({ subject: name(u.subjectId), missing: u.missing, reasons: u.reasonCodes.map((c) => `${c}: ${BUILD_REASON_TEXT[c]}`) })),
    notes: result.notes,
  });
}

async function explain(db: Database, actor: Actor, batchId: string, result: BuildResult, subjects: readonly BuildSubject[]) {
  const system = { text: summariseBuild(result, subjects), source: 'system' as const, label: SYSTEM_NOTE_LABEL };
  const ai = aiAssist();
  if (ai.status === 'not_configured') return system;
  const input = aiFacts(result, subjects);
  const entry = { entityType: 'batch', entityId: batchId };
  await audit(db, actor, { ...entry, action: 'ai.draft_requested', metadata: { feature: 'timetable_note', inputChars: input.length } });
  let status = 'ok';
  try {
    const parsed = noteAnswer.safeParse(
      await ai.draft({
        name: 'timetable_note',
        instructions:
          'You explain a draft class timetable that a rule-based builder made for a coaching institute coordinator. Use only the facts given. Write 3 to 5 short sentences in plain English: what was placed, what could not be placed and why. Never call the timetable optimal or the best. Do not invent teachers, rooms, dates or numbers; refer to teachers only by the labels given. End by reminding the coordinator to check each draft before publishing.',
        input,
        schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false },
        maxOutputTokens: 400,
      }),
    );
    if (!parsed.success) throw new AiDraftError('invalid_output');
    return { text: parsed.data.note, source: 'ai' as const, label: AI_NOTE_LABEL };
  } catch (e) {
    // The drafts are already saved: an AI failure only means the system summary is shown.
    status = e instanceof AiDraftError ? e.reason : 'upstream_error';
    return system;
  } finally {
    await audit(db, actor, { ...entry, action: 'ai.draft_finished', metadata: { feature: 'timetable_note', status } });
  }
}
