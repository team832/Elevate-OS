/**
 * Fees area read views (owner brief 22 Oct 2026 §5): money recorded as received or refunded in a
 * date range, and tuition instalments still owed, across the cases the reader may see
 * (`ops:fees:read`; own scope = cases they counsel or whose lead they own). Manually recorded
 * figures, not verified payments. Read only.
 */
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeePlans,
  opsFeeRecords,
  opsLeads,
  students,
  type Database,
} from '@elevate/database';
import { istToday, type KpiWindow } from '../domain';
import { feeCollections } from '../domain/admissions-kpis';
import type { FeeRecordLike, FeeRecordStatus } from '../domain/fees';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type Actor } from './context';
import { plansWithLedger } from './fee-agreements';

export const FEE_PAGE_SIZE = 25;
const MONEY_KINDS = ['received', 'refund'] as const;

/** One page of payments and refunds dated in the window (newest first) and the window's net total. */
export async function listCollections(
  db: Database,
  actor: Actor,
  q: KpiWindow & { status?: FeeRecordStatus; page: number },
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const scope = and(ownAdmissionFilter(access), inArray(opsFeeRecords.kind, MONEY_KINDS));
  const where = and(
    scope,
    gte(opsFeeRecords.paymentDate, q.from),
    lte(opsFeeRecords.paymentDate, q.to),
    q.status ? eq(opsFeeRecords.status, q.status) : undefined,
  );
  const [rows, [total], all] = await Promise.all([
    db
      .select({
        id: opsFeeRecords.id,
        code: opsFeeRecords.code,
        kind: opsFeeRecords.kind,
        reverses: opsFeeRecords.reversesRecordId,
        chargeCategory: opsFeeRecords.chargeCategory,
        amountPaise: opsFeeRecords.amountPaise,
        paymentDate: opsFeeRecords.paymentDate,
        method: opsFeeRecords.method,
        receiptReference: opsFeeRecords.receiptReference,
        status: opsFeeRecords.status,
        admissionId: opsFeeRecords.admissionId,
        studentId: opsAdmissions.studentId,
        studentName: opsLeads.studentName,
      })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(where)
      .orderBy(desc(opsFeeRecords.paymentDate), desc(opsFeeRecords.code))
      .limit(FEE_PAGE_SIZE)
      .offset((q.page - 1) * FEE_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(where),
    // shortcut: every payment/refund row in scope (a reversal may be dated outside the window);
    // move the total to SQL if the ledger reaches tens of thousands of rows.
    db
      .select({ r: opsFeeRecords })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(scope),
  ]);
  return {
    rows,
    total: total?.n ?? 0,
    page: q.page,
    pageSize: FEE_PAGE_SIZE,
    /** Net received minus refunds in the window; null = no payment recorded at all (not ₹0). */
    collected: feeCollections(
      all.map(({ r }) => r as FeeRecordLike & { paymentDate: string | null }),
      q,
    ),
  };
}

/**
 * Tuition instalments of active agreements with money still owed, oldest due date first (no due
 * date last). Allocation as on the student's fee section (plansWithLedger, A-FEE-2).
 * shortcut: computes every active agreement in scope per request; fine for hundreds of students.
 */
export async function outstandingInstalments(db: Database, actor: Actor, now = new Date()) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const plans = await db
    .select({ plan: opsFeePlans, studentName: students.fullName })
    .from(opsFeePlans)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(students, eq(students.id, opsFeePlans.studentId))
    .where(and(eq(opsFeePlans.status, 'active'), ownAdmissionFilter(access)));
  const name = new Map(plans.map((p) => [p.plan.id as string, p.studentName]));
  const detailed = await plansWithLedger(
    db,
    plans.map((p) => p.plan),
    now,
  );
  const today = istToday(now);
  return detailed
    .flatMap((d) =>
      d.instalments
        .filter((a) => a.remainingPaise > 0)
        .map((a) => ({
          id: a.instalment.id as string,
          studentId: d.plan.studentId as string,
          studentName: name.get(d.plan.id) ?? null,
          plan: d.plan.label,
          sequence: a.instalment.sequence,
          of: d.instalments.length,
          dueDate: a.instalment.dueDate,
          amountPaise: a.instalment.amountPaise,
          remainingPaise: a.remainingPaise,
          status: a.status,
          dueNow: a.instalment.dueDate !== null && a.instalment.dueDate <= today,
        })),
    )
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}
export type OutstandingInstalment = Awaited<ReturnType<typeof outstandingInstalments>>[number];

type Instalment = Pick<OutstandingInstalment, 'dueNow' | 'status' | 'remainingPaise'>;
/** Outstanding filters: due by today (incl. overdue), overdue, not yet due (or no due date). */
export const OUTSTANDING_VIEWS = {
  due: (i: Instalment) => i.dueNow,
  overdue: (i: Instalment) => i.status === 'overdue',
  upcoming: (i: Instalment) => !i.dueNow,
};
export type OutstandingView = keyof typeof OUTSTANDING_VIEWS;

const tally = (list: readonly Instalment[]) => ({
  count: list.length,
  owedPaise: list.reduce((n, i) => n + i.remainingPaise, 0),
});

/** One page of outstanding instalments by view and due-date range, with the count per view. */
export async function listOutstanding(
  db: Database,
  actor: Actor,
  q: { status?: OutstandingView; from?: string; to?: string; page: number },
  now = new Date(),
) {
  const all = await outstandingInstalments(db, actor, now);
  const rows = all.filter(
    (i) =>
      (!q.status || OUTSTANDING_VIEWS[q.status](i)) &&
      (!q.from || (i.dueDate !== null && i.dueDate >= q.from)) &&
      (!q.to || (i.dueDate !== null && i.dueDate <= q.to)),
  );
  return {
    rows: rows.slice((q.page - 1) * FEE_PAGE_SIZE, q.page * FEE_PAGE_SIZE),
    total: rows.length,
    owedPaise: tally(rows).owedPaise,
    page: q.page,
    pageSize: FEE_PAGE_SIZE,
    any: all.length > 0,
    views: Object.fromEntries(
      Object.entries(OUTSTANDING_VIEWS).map(([k, test]) => [k, tally(all.filter(test))]),
    ) as Record<OutstandingView, ReturnType<typeof tally>>,
  };
}
