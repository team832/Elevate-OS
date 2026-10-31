/**
 * The student's fee statement from the database (domain/fee-statement.ts). No permission check:
 * callers hold `ops:fees:read` on the case. The whole student, not one case: an agreement covers a
 * bundle and a chain may continue on another of the student's cases.
 */
import { eq, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeePlans,
  opsFeeRecords,
  type Database,
  type opsAdmissions as Admissions,
} from '@elevate/database';
import { feeStatement } from '../domain/fee-statement';
import { inOrder } from './ops-common';

export async function feeStatementFor(
  db: Database,
  a: Pick<typeof Admissions.$inferSelect, 'id' | 'studentId'>,
) {
  const [plans, rows] = await inOrder([
    a.studentId ? db.select().from(opsFeePlans).where(eq(opsFeePlans.studentId, a.studentId)) : [],
    db
      .select({ r: opsFeeRecords })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .where(
        a.studentId
          ? or(eq(opsAdmissions.studentId, a.studentId), eq(opsAdmissions.id, a.id))
          : eq(opsAdmissions.id, a.id),
      ),
  ]);
  return feeStatement(
    plans,
    rows.map(({ r }) => r),
  );
}
