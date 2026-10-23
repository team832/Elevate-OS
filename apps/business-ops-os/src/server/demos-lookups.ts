/**
 * Demo lookups: the demo fee from the ledger, the cases a demo can be booked for, and the day's
 * demo classes for Academic (internal route). Re-exported by demos-read.ts.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsFeeRecords,
  opsLeads,
  programmes,
  type Database,
} from '@elevate/database';
import { DEMO_BOOKABLE_STATUSES, demoFeeStatus } from '../domain/demos';
import { MANUAL_FEE_DISCLAIMER, type FeeRecordLike } from '../domain/fees';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type Actor } from './context';

type Demo = typeof opsDemos.$inferSelect;

/**
 * Demo fee: assessed, paid and balance only from ledger rows with charge category `demo` (no
 * "paid" checkbox); entries are written through the fee service (POST /fees, /fees/{id}).
 * Callers check ops:fees:read.
 */
export async function demoFees(db: Database, demoId: Demo['id']) {
  const records = await db
    .select()
    .from(opsFeeRecords)
    .where(and(eq(opsFeeRecords.demoId, demoId), eq(opsFeeRecords.chargeCategory, 'demo')))
    .orderBy(desc(opsFeeRecords.recordedAt));
  return {
    records,
    ...demoFeeStatus(records as FeeRecordLike[]),
    disclaimer: MANUAL_FEE_DISCLAIMER,
  };
}

/** Demo fee state per demo (ledger rows, charge category `demo`), for other screens; callers check ops:fees:read. */
export async function demoFeeStates(db: Database, ids: readonly Demo['id'][]) {
  const rows = ids.length
    ? await db
        .select()
        .from(opsFeeRecords)
        .where(
          and(inArray(opsFeeRecords.demoId, [...ids]), eq(opsFeeRecords.chargeCategory, 'demo')),
        )
    : [];
  return new Map(
    ids.map((id) => [
      id,
      demoFeeStatus(rows.filter((r) => r.demoId === id) as FeeRecordLike[]).state,
    ]),
  );
}

/** Cases a demo can be booked for: counselled (or demo scheduled) with no open demo, within scope. */
export async function bookableAdmissions(db: Database, actor: Actor) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  return db
    .select({
      id: opsAdmissions.id,
      code: opsAdmissions.code,
      studentName: opsLeads.studentName,
      programmeCode: programmes.code,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(
      and(
        inArray(opsAdmissions.status, DEMO_BOOKABLE_STATUSES),
        ownAdmissionFilter(access),
        sql`NOT EXISTS (SELECT 1 FROM ops.demos d WHERE d.admission_id = ${opsAdmissions.id} AND d.outcome = 'open')`,
      ),
    )
    .orderBy(asc(opsLeads.studentName))
    .limit(200);
}

/**
 * GET /ops/api/internal/v1/demo-sessions?date= (caller academic, R5): the day's demo classes (IST)
 * that are not cancelled, with the minimum Academic needs to add a demo student to a class roster.
 * No contact, guardian or KYC data.
 */
export async function demoSessionsForDay(db: Database, date: string) {
  const rows = await db
    .select({
      demoSessionId: opsDemoSessions.id,
      coreStudentId: opsAdmissions.studentId,
      displayName: opsLeads.studentName,
      dayNumber: opsDemoSessions.dayNumber,
      subject: opsDemoSessions.subject,
      startsAt: opsDemoSessions.startsAt,
      isSample: opsLeads.isSample,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .where(
      and(
        sql`(${opsDemoSessions.startsAt} AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date`,
        sql`${opsDemoSessions.attendance} <> 'cancelled'`,
        isNotNull(opsAdmissions.studentId),
      ),
    )
    .orderBy(asc(opsDemoSessions.startsAt));
  return {
    items: rows.map((r) => ({
      ...r,
      coreStudentId: r.coreStudentId!,
      startsAt: r.startsAt.toISOString(),
    })),
  };
}
