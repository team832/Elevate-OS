/**
 * Admit cards for a test (F4-03): roll numbers on the roster, venue and instructions on the test.
 * Written by Business Ops through the internal route (the acting user is the audit actor) or by
 * an academic coordinator (`academic:assessments:write`). Roll numbers: with the test row locked,
 * the rows without one are numbered after the highest given, by batch code then name, so a number
 * is never given twice or reused (a removed row keeps its number; a later row gets the next).
 */
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { z } from 'zod';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicBatches,
  academicCourses,
  academicRooms,
  academicStudents,
  type AcademicAssessmentId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type academicAdmitCardsV1Schema,
  type AdmitCardWrite,
} from '@elevate/shared-contracts';
import { audit, type Actor } from '../context';

const A = academicAssessments;
const R = academicAssessmentRoster;

async function lockTest(tx: Database, id: string) {
  const [a] = await tx
    .select()
    .from(A)
    .where(eq(A.id, id as AcademicAssessmentId))
    .for('update');
  if (!a) throw new NotFoundError('Assessment not found.');
  return a;
}

/** academic.admit_cards v1: the test, its venue and the roster rows (not removed), by batch then name. */
export async function admitCardsFor(
  db: Database,
  id: string,
): Promise<z.input<typeof academicAdmitCardsV1Schema>> {
  const [row] = await db
    .select({ a: A, courseName: academicCourses.name, roomName: academicRooms.name })
    .from(A)
    .innerJoin(academicBatches, eq(academicBatches.id, A.batchId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId))
    .leftJoin(academicRooms, eq(academicRooms.id, A.venueRoomId))
    .where(eq(A.id, id as AcademicAssessmentId));
  if (!row) throw new NotFoundError('Assessment not found.');
  const { a } = row;
  const rows = await db
    .select({
      rosterId: R.id,
      coreStudentId: academicStudents.coreStudentId,
      admissionNumber: R.admissionNumberSnapshot,
      displayName: R.displayNameSnapshot,
      batchId: R.batchId,
      batchCode: academicBatches.code,
      rollNumber: R.rollNumber,
    })
    .from(R)
    .innerJoin(academicBatches, eq(academicBatches.id, R.batchId))
    .innerJoin(academicStudents, eq(academicStudents.id, R.studentId))
    .where(and(eq(R.assessmentId, a.id), isNull(R.removedAt)))
    .orderBy(asc(academicBatches.code), asc(R.displayNameSnapshot), asc(R.id));
  const rooms = await db
    .select({ id: academicRooms.id, code: academicRooms.code, name: academicRooms.name })
    .from(academicRooms)
    .where(eq(academicRooms.status, 'active'))
    .orderBy(asc(academicRooms.code));
  return {
    contract: 'academic.admit_cards',
    version: 1,
    generatedAt: new Date().toISOString(),
    assessment: {
      id: a.id,
      code: a.code,
      title: a.title,
      status: a.status,
      courseName: row.courseName,
      scheduledDate: a.scheduledDate,
      startTime: a.startTime,
      durationMinutes: a.durationMinutes,
      rosterSnapshotAt: a.rosterSnapshotAt?.toISOString() ?? null,
      venue: { online: a.venueOnline, roomId: a.venueRoomId, roomName: row.roomName },
      instructions: a.admitCardInstructions,
      isSample: a.isSample,
    },
    rooms: rooms.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` })),
    rows: rows.map((r) => ({ ...r, coreStudentId: r.coreStudentId ?? null })),
  };
}

async function giveRollNumbers(tx: Database, actor: Actor, id: string) {
  const a = await lockTest(tx, id);
  if (!a.rosterSnapshotAt)
    throw new ConflictError('Take the roster first: roll numbers go to the roster.');
  if (a.status === 'cancelled') throw new ConflictError('This test is cancelled.');
  const [{ highest } = { highest: null }] = await tx
    .select({ highest: max(R.rollNumber) })
    .from(R)
    .where(eq(R.assessmentId, a.id));
  const open = await tx
    .select({ id: R.id })
    .from(R)
    .innerJoin(academicBatches, eq(academicBatches.id, R.batchId))
    .where(and(eq(R.assessmentId, a.id), isNull(R.rollNumber), isNull(R.removedAt)))
    .orderBy(asc(academicBatches.code), asc(R.displayNameSnapshot), asc(R.id));
  let next = (highest ?? 0) + 1;
  for (const r of open) await tx.update(R).set({ rollNumber: next++ }).where(eq(R.id, r.id));
  await audit(tx, actor, {
    action: 'assessment.roll_numbers_given',
    entityType: 'assessment',
    entityId: a.id,
    metadata: { given: open.length, from: open.length ? (highest ?? 0) + 1 : null },
  });
}

async function setVenue(
  tx: Database,
  actor: Actor,
  id: string,
  b: Extract<AdmitCardWrite, { action: 'venue' }>,
) {
  const before = await lockTest(tx, id);
  const roomId = b.venue === 'online' || b.venue === 'not_set' ? null : b.venue;
  if (roomId) {
    const [room] = await tx
      .select({ status: academicRooms.status })
      .from(academicRooms)
      .where(eq(academicRooms.id, roomId as never));
    if (room?.status !== 'active')
      throw new ValidationError('Choose an active room.', {
        details: [{ location: 'body', path: ['venue'], message: 'Choose an active room.' }],
      });
  }
  const [after] = await tx
    .update(A)
    .set({
      venueRoomId: roomId as never,
      venueOnline: b.venue === 'online',
      admitCardInstructions: b.instructions || null,
    })
    .where(eq(A.id, before.id))
    .returning();
  const pick = (x: typeof before) => ({
    venueRoomId: x.venueRoomId,
    venueOnline: x.venueOnline,
    admitCardInstructions: x.admitCardInstructions,
  });
  await audit(tx, actor, {
    action: 'assessment.admit_card_venue_set',
    entityType: 'assessment',
    entityId: before.id,
    before: pick(before),
    after: pick(after!),
  });
}

/** Give roll numbers, or set the venue and instructions; answers academic.admit_cards v1. */
export async function writeAdmitCards(
  db: Database,
  actor: Actor,
  id: string,
  body: AdmitCardWrite,
) {
  await withTransaction(db, (tx) =>
    body.action === 'roll_numbers' ? giveRollNumbers(tx, actor, id) : setVenue(tx, actor, id, body),
  );
  return admitCardsFor(db, id);
}
