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
  /** Only ledger rows recorded up to then (a receipt's balance after its payment). */
  upTo?: Date,
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
    upTo ? asAt(plans, upTo) : plans,
    rows.map(({ r }) => r).filter((r) => !upTo || r.recordedAt <= upTo),
  );
}

/**
 * The agreement versions as they stood at `t`: versions made later left out, later activations
 * and closings undone, so a receipt's balance never changes on a reprint.
 * shortcut: activation is dated by its approval's decision (no activation time is stored); a
 * payment recorded between the two sees that version a little early. Store activated_at if it matters.
 */
const asAt = (plans: (typeof opsFeePlans.$inferSelect)[], t: Date) =>
  plans
    .filter((p) => p.createdAt <= t)
    .map((p) => {
      const approvedAt = p.approvedAt && p.approvedAt <= t ? p.approvedAt : null;
      const status = p.closedAt && p.closedAt <= t ? 'closed' : approvedAt ? 'active' : 'draft';
      return { ...p, approvedAt, status };
    });
