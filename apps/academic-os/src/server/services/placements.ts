/**
 * Batch placements (ACD-019, owner brief §8): the effective-dated batch membership of ONE enrolment.
 *
 * - One open placement per enrolment (unique index); `enrolments.batch_id` mirrors the open
 *   placement for older readers. A transfer ends the old placement the day before the
 *   effective date and opens a new one that points back at it. History is never rewritten;
 *   attendance, teaching logs and marks are never touched here.
 * - Seat checks run after locking the batch row (SELECT … FOR UPDATE), so two allocations
 *   cannot both take the last seat. Demo attendees are REPORTED beside the seat count (setting
 *   `demo.attendees_count_toward_capacity`), never enforced here.
 * - Clash check: none of the student's other open placements may have a live session that
 *   overlaps one of the new batch's sessions on/after the start date. Only sessions that
 *   already exist are checked.
 * Every change needs `academic:enrolments:decide` (coordinator) and is audited.
 */
import { and, asc, count, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import {
  academicBatchPlacements,
  academicBatches,
  academicChapters,
  academicClassSessions,
  academicCourses,
  academicEnrolments,
  academicSessionDemoAttendees,
  academicStudents,
  programmes,
  type AcademicPlacementId,
  type Database,
} from '@elevate/database';
import { can } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, EnrolmentId, StudentId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import { enrolmentView, findSessionClashes, isBatchFull, transferEndDate } from '../../domain/placements';
import { assertBatchInScope, audit, resolveScope, todayIst, type Actor } from '../context';
import type { PLACEMENT_VIEWS, allocateBody, endEnrolmentBody, transferBody } from '../schemas-placements';
import { getBatchCoverage } from './curriculum';
import { getSetting } from './settings';

const pl = academicBatchPlacements;
type Batch = typeof academicBatches.$inferSelect;
type Enrolment = typeof academicEnrolments.$inferSelect;
const holdsSeatFrom = (from: string) => or(isNull(pl.endDate), gte(pl.endDate, from));

/** Lock the batch row for the seat check (same pattern as manual enrolment) and require it to be open. */
export async function lockOpenBatch(tx: Database, batchId: string): Promise<Batch> {
  const [batch] = await tx.select().from(academicBatches).where(eq(academicBatches.id, batchId as BatchId)).for('update');
  if (!batch) throw new ValidationError('Batch not found.');
  if (batch.status === 'completed' || batch.status === 'cancelled') throw new ValidationError(`Batch ${batch.code} is ${batch.status}.`);
  return batch;
}

/** Placements holding a seat in the batch on or after `from`. */
export async function seatsTaken(db: Database, batchId: string, from: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(pl).where(and(eq(pl.batchId, batchId as BatchId), holdsSeatFrom(from)));
  return Number(n);
}

export async function clashMessages(tx: Database, enrolment: Enrolment, batch: Batch, from: string): Promise<string[]> {
  const others = await tx
    .select({ batchId: pl.batchId, batchCode: academicBatches.code, startDate: pl.startDate, endDate: pl.endDate })
    .from(pl)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, pl.enrolmentId))
    .innerJoin(academicBatches, eq(academicBatches.id, pl.batchId))
    .where(and(eq(academicEnrolments.studentId, enrolment.studentId), ne(pl.enrolmentId, enrolment.id), holdsSeatFrom(from)));
  if (others.length === 0) return [];
  const s = academicClassSessions;
  const sessions = await tx
    .select({ id: s.id, batchId: s.batchId, date: s.date, startTime: s.startTime, durationMinutes: s.durationMinutes, status: s.status })
    .from(s)
    .where(and(inArray(s.batchId, [batch.id, ...others.map((o) => o.batchId)]), gte(s.date, from)));
  const existing = sessions.filter((x) => others.some((o) => o.batchId === x.batchId && x.date >= o.startDate && (!o.endDate || x.date <= o.endDate)));
  const code = (batchId: string) => others.find((o) => o.batchId === batchId)?.batchCode ?? batchId;
  return findSessionClashes(existing, sessions.filter((x) => x.batchId === batch.id), from).map(
    (c) => `${c.date}: ${batch.code} at ${c.incoming.startTime} overlaps ${code(c.existing.batchId)} at ${c.existing.startTime}`,
  );
}

/** Open a placement (seats checked on the locked batch, clashes optional), mirror it on enrolments.batch_id, audit it. */
export async function startPlacement(
  tx: Database,
  actor: Actor | null,
  input: {
    enrolment: Enrolment;
    batch: Batch;
    startDate: string;
    placedByUserId: UserId;
    reason?: string | null;
    transferFromPlacementId?: AcademicPlacementId;
    checkClash: boolean;
    action: string;
  },
) {
  const { enrolment, batch, startDate } = input;
  const taken = await seatsTaken(tx, batch.id, startDate);
  if (isBatchFull(batch.capacity, taken)) throw new ConflictError(`Batch ${batch.code} is full (${taken}/${batch.capacity}).`);
  const clashes = input.checkClash ? await clashMessages(tx, enrolment, batch, startDate) : [];
  if (clashes.length) {
    throw new ConflictError(`The student already has classes in another batch at the same time as ${batch.code}.`, { details: clashes.map((message) => ({ message })) });
  }
  const [placement] = await tx
    .insert(pl)
    .values({ enrolmentId: enrolment.id, batchId: batch.id, startDate, placedByUserId: input.placedByUserId, reason: input.reason ?? null, transferFromPlacementId: input.transferFromPlacementId ?? null })
    .returning();
  await tx.update(academicEnrolments).set({ batchId: batch.id, courseId: batch.courseId }).where(eq(academicEnrolments.id, enrolment.id));
  await audit(tx, actor, { action: input.action, entityType: 'batch_placement', entityId: placement!.id, after: placement, metadata: { enrolmentId: enrolment.id } });
  return placement!;
}

async function lockEnrolment(tx: Database, enrolmentId: string, allowed: readonly string[] = ['active']) {
  const [enrolment] = await tx.select().from(academicEnrolments).where(eq(academicEnrolments.id, enrolmentId as EnrolmentId)).for('update');
  if (!enrolment) throw new NotFoundError('Enrolment not found.');
  if (!allowed.includes(enrolment.status)) throw new ConflictError(`This enrolment is ${enrolment.status}.`);
  const [open] = await tx.select().from(pl).where(and(eq(pl.enrolmentId, enrolment.id), isNull(pl.endDate)));
  return { enrolment, open: open ?? null };
}

function assertFits(enrolment: Enrolment, batch: Batch) {
  if (batch.programmeId !== enrolment.programmeId) throw new ValidationError(`Batch ${batch.code} belongs to another programme.`);
  if (enrolment.courseId && enrolment.courseId !== batch.courseId) {
    throw new ValidationError(`Batch ${batch.code} follows a different course; a different course needs its own enrolment.`);
  }
}

/** Place an enrolment that is awaiting a batch. */
export async function allocatePlacement(db: Database, actor: Actor, input: z.output<typeof allocateBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:enrolments:decide');
  return withTransaction(db, async (tx) => {
    const { enrolment, open } = await lockEnrolment(tx, input.enrolmentId);
    if (open) throw new ConflictError('This enrolment already has a batch. Use Transfer to move it.');
    const batch = await lockOpenBatch(tx, input.batchId);
    assertFits(enrolment, batch);
    const today = todayIst(now);
    const startDate = input.startDate ?? (enrolment.startDate && enrolment.startDate > today ? enrolment.startDate : today);
    return startPlacement(tx, actor, { enrolment, batch, startDate, reason: input.reason, placedByUserId: actor.user.id, checkClash: true, action: 'placement.allocated' });
  });
}

/**
 * Chapters the new batch has already taught (submitted or verified, as the coverage read
 * counts them) that the old batch has not: a PROPOSED catch-up list. No task is created.
 */
export async function proposedCatchUp(db: Database, actor: Actor, fromBatchId: string, toBatchId: string) {
  const covered = async (batchId: string) => {
    const { coverage } = await getBatchCoverage(db, actor, batchId, null);
    return [...coverage.chapters, ...coverage.unplanned].filter((c) => c.verifiedMinutes + c.unverifiedMinutes > 0).map((c) => c.chapterId);
  };
  const before = new Set(await covered(fromBatchId));
  const missing = (await covered(toBatchId)).filter((id) => !before.has(id));
  const chapters = missing.length
    ? await db
        .select({ chapterId: academicChapters.id, code: academicChapters.code, title: academicChapters.title })
        .from(academicChapters)
        .where(inArray(academicChapters.id, missing as never[]))
        .orderBy(asc(academicChapters.code))
    : [];
  return { status: 'proposed' as const, chapters, note: 'Taught in the new batch but not yet in the old one. The coordinator decides any catch-up; nothing has been assigned.' };
}

/** Move an enrolment to another batch of the same course from `effectiveDate`. */
export async function transferPlacement(db: Database, actor: Actor, input: z.output<typeof transferBody>) {
  await resolveScope(db, actor, 'academic:enrolments:decide');
  const result = await withTransaction(db, async (tx) => {
    const { enrolment, open } = await lockEnrolment(tx, input.enrolmentId);
    if (!open) throw new ValidationError('This enrolment has no batch yet. Allocate it instead.');
    if (open.batchId === input.toBatchId) throw new ValidationError('The student is already in this batch.');
    const endDate = transferEndDate(input.effectiveDate);
    if (endDate < open.startDate) throw new ValidationError(`The transfer date must be after ${open.startDate}, when the current placement started.`);
    const batch = await lockOpenBatch(tx, input.toBatchId);
    assertFits(enrolment, batch);
    const [ended] = await tx.update(pl).set({ endDate, endedByUserId: actor.user.id, endedReason: input.reason }).where(eq(pl.id, open.id)).returning();
    await audit(tx, actor, { action: 'placement.ended', entityType: 'batch_placement', entityId: open.id, before: open, after: ended, metadata: { enrolmentId: enrolment.id, transferTo: batch.id } });
    const placement = await startPlacement(tx, actor, {
      enrolment,
      batch,
      startDate: input.effectiveDate,
      reason: input.reason,
      transferFromPlacementId: open.id,
      placedByUserId: actor.user.id,
      checkClash: true,
      action: 'placement.transferred',
    });
    return { ended: ended!, placement };
  });
  return { ...result, catchUp: await proposedCatchUp(db, actor, result.ended.batchId, result.placement.batchId) };
}

/** Complete or withdraw ONE enrolment and end its open placement; other enrolments are not touched. */
/** Future end dates are refused for now (nothing would flip the status on that day). */
export async function endEnrolment(db: Database, actor: Actor, input: z.output<typeof endEnrolmentBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:enrolments:decide');
  return withTransaction(db, async (tx) => {
    const { enrolment, open } = await lockEnrolment(tx, input.enrolmentId, ['active', 'paused']);
    if (input.endDate > todayIst(now)) throw new ValidationError('The end date cannot be in the future. End the enrolment on or after its last day.');
    const earliest = [enrolment.startDate, open?.startDate].filter(Boolean).sort().at(-1);
    if (earliest && input.endDate < earliest) throw new ValidationError(`The end date cannot be before ${earliest}, when the enrolment or placement started.`);
    const [placement] = open ? await tx.update(pl).set({ endDate: input.endDate, endedByUserId: actor.user.id, endedReason: input.reason }).where(eq(pl.id, open.id)).returning() : [null];
    const [row] = await tx.update(academicEnrolments).set({ status: input.outcome }).where(eq(academicEnrolments.id, enrolment.id)).returning();
    await audit(tx, actor, { action: 'enrolment.ended', entityType: 'enrolment', entityId: enrolment.id, before: enrolment, after: row, metadata: { outcome: input.outcome, endDate: input.endDate, reason: input.reason, placementId: open?.id ?? null } });
    return { enrolment: row!, placement };
  });
}

/** Placement history (oldest first) for a batch or a student, with batch and student names. */
export async function placementHistory(db: Database, filter: { batchId?: string; studentId?: string }) {
  return db
    .select({
      id: pl.id,
      enrolmentId: pl.enrolmentId,
      batchId: pl.batchId,
      batchCode: academicBatches.code,
      startDate: pl.startDate,
      endDate: pl.endDate,
      reason: pl.reason,
      endedReason: pl.endedReason,
      transferFromPlacementId: pl.transferFromPlacementId,
      studentId: academicStudents.id,
      studentName: academicStudents.fullName,
      studentCode: academicStudents.code,
      isSample: academicStudents.isSample,
      enrolmentStatus: academicEnrolments.status,
    })
    .from(pl)
    .innerJoin(academicBatches, eq(academicBatches.id, pl.batchId))
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, pl.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(and(filter.batchId ? eq(pl.batchId, filter.batchId as BatchId) : undefined, filter.studentId ? eq(academicStudents.id, filter.studentId as StudentId) : undefined))
    .orderBy(asc(academicStudents.fullName), asc(pl.startDate));
}

/** Placement reasons are for coordinators (academic:enrolments:decide) only; others get null. */
export function withReasons<T extends { reason: string | null; endedReason: string | null }>(actor: Actor, rows: T[]): T[] {
  return can(actor.user, 'academic:enrolments:decide') ? rows : rows.map((r) => ({ ...r, reason: null, endedReason: null }));
}

/** The batch's Students tab: every placement with dates (teachers: own batches only). */
export async function listBatchPlacements(db: Database, actor: Actor, batchId: string) {
  assertBatchInScope(await resolveScope(db, actor, 'academic:batches:read'), batchId);
  return withReasons(actor, await placementHistory(db, { batchId }));
}

/** Students placed on `day` per batch (open placements), optionally for one batch. */
export async function placedCounts(db: Database, day: string = todayIst(), batchId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ batchId: pl.batchId, n: count() })
    .from(pl)
    .where(and(lte(pl.startDate, day), holdsSeatFrom(day), batchId ? eq(pl.batchId, batchId as BatchId) : undefined))
    .groupBy(pl.batchId);
  return new Map(rows.map((r) => [r.batchId as string, Number(r.n)]));
}

/** Seats from `day` on, with demo attendees on upcoming classes reported (not enforced) next to the proposed rule. */
export async function seatReport(db: Database, batch: Pick<Batch, 'id' | 'capacity'>, day: string = todayIst()) {
  const s = academicClassSessions;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(academicSessionDemoAttendees)
    .innerJoin(s, eq(s.id, academicSessionDemoAttendees.sessionId))
    .where(and(eq(s.batchId, batch.id as BatchId), gte(s.date, day), eq(s.status, 'scheduled')));
  const rule = await getSetting(db, 'demo.attendees_count_toward_capacity');
  return { capacity: batch.capacity, placed: await seatsTaken(db, batch.id, day), demoAttendeesUpcoming: Number(n), demoRule: { counts: rule.value.counts, status: rule.status } };
}

/** Enrolment lists: awaiting batch, placed, transfers, ended — tab counts come from the same rows. */
export async function listPlacementViews(db: Database, actor: Actor, view: (typeof PLACEMENT_VIEWS)[number]) {
  await resolveScope(db, actor, 'academic:enrolments:read');
  const rows = await db
    .select({
      e: academicEnrolments,
      studentName: academicStudents.fullName,
      studentCode: academicStudents.code,
      isSample: academicStudents.isSample,
      coreStudentId: academicStudents.coreStudentId,
      programmeCode: programmes.code,
      programmeName: programmes.name,
      courseCode: academicCourses.code,
    })
    .from(academicEnrolments)
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .innerJoin(programmes, eq(programmes.id, academicEnrolments.programmeId))
    .leftJoin(academicCourses, eq(academicCourses.id, academicEnrolments.courseId))
    .orderBy(asc(academicStudents.fullName))
    .limit(2000); // shortcut: no paging; add it when a centre has more than 2,000 enrolments
  const byEnrolment = new Map<string, Awaited<ReturnType<typeof placementHistory>>>();
  for (const p of withReasons(actor, await placementHistory(db, {}))) byEnrolment.set(p.enrolmentId, [...(byEnrolment.get(p.enrolmentId) ?? []), p]);
  const out = rows.map((r) => {
    const mine = byEnrolment.get(r.e.id) ?? [];
    const open = mine.find((p) => p.endDate === null);
    const transfers = mine
      .filter((p) => p.transferFromPlacementId)
      .map((p) => {
        const from = mine.find((o) => o.id === p.transferFromPlacementId);
        return { placementId: p.id, effectiveDate: p.startDate, reason: p.reason, fromBatchId: from?.batchId ?? null, fromBatchCode: from?.batchCode ?? null, toBatchId: p.batchId, toBatchCode: p.batchCode };
      });
    return {
      enrolmentId: r.e.id,
      studentId: r.e.studentId,
      studentName: r.studentName,
      studentCode: r.studentCode,
      isSample: r.isSample,
      coreStudentId: r.coreStudentId,
      sourceAdmissionId: r.e.sourceAdmissionId,
      programmeId: r.e.programmeId,
      programmeCode: r.programmeCode,
      programmeName: r.programmeName,
      courseId: r.e.courseId,
      courseCode: r.courseCode,
      academicYear: r.e.academicYear,
      startDate: r.e.startDate,
      status: r.e.status,
      source: r.e.source,
      manualReason: r.e.manualReason,
      view: enrolmentView(r.e.status, Boolean(open)),
      placement: open ?? mine.at(-1) ?? null,
      transfers,
    };
  });
  const counts = {
    awaiting: out.filter((r) => r.view === 'awaiting').length,
    placed: out.filter((r) => r.view === 'placed').length,
    transfers: out.filter((r) => r.transfers.length > 0).length,
    ended: out.filter((r) => r.view === 'ended').length,
  };
  const shown = out.filter((r) => (view === 'transfers' ? r.transfers.length > 0 : r.view === view));
  // Proposed catch-up per transfer, as of today (computed once per batch pair).
  const catchUp = new Map<string, Awaited<ReturnType<typeof proposedCatchUp>>>();
  for (const t of view === 'transfers' ? shown.flatMap((r) => r.transfers) : []) {
    const key = `${t.fromBatchId}:${t.toBatchId}`;
    if (t.fromBatchId && !catchUp.has(key)) catchUp.set(key, await proposedCatchUp(db, actor, t.fromBatchId, t.toBatchId));
  }
  return {
    view,
    counts,
    rows: shown.map((r) => ({ ...r, transfers: r.transfers.map((t) => ({ ...t, catchUp: catchUp.get(`${t.fromBatchId}:${t.toBatchId}`)?.chapters ?? null })) })),
  };
}
