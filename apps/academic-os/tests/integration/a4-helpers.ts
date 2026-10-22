/** Test helpers for progress, results and reports tests (fictional data only). */
import { inArray } from 'drizzle-orm';
import { academicClassSessions, type Database } from '@elevate/database';
import { recordAttendance, type Actor } from '../../src/server';
import { attendanceBody } from '../../src/server/schemas';

/** Delivery is an explicit action (R12); tests set it directly. */
export const markHeld = (db: Database, ids: readonly string[]) =>
  db.update(academicClassSessions).set({ status: 'held' }).where(inArray(academicClassSessions.id, ids as never[]));

export const attend = (db: Database, by: Actor, sessionId: string, marks: { studentId: string; status: 'present' | 'late' | 'partial' | 'absent' | 'excused' }[]) =>
  recordAttendance(db, by, sessionId, attendanceBody.parse({ marks }));
