/**
 * Recomputes every sample student's money from the raw ledger rows, by a separate count, and compares
 * it with what domain/fee-statement gives and what the screens and the exit record were given.
 * Returns the differences, one line each; none is the only right answer.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  opsAdmissions,
  opsExitRecords,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsReportExports,
  students,
  type Database,
} from '@elevate/database';
import { feeStatement } from '@elevate/business-ops-os/domain';
import { getStudent, plansWithLedger } from '@elevate/business-ops-os/server';

type Row = typeof opsFeeRecords.$inferSelect;
type Plan = typeof opsFeePlans.$inferSelect;

/** Rows that still count: not voided, and neither side of a reversal. */
function live(rows: readonly Row[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reversal = (r: Row) =>
    r.status !== 'voided' &&
    !!r.reversesRecordId &&
    byId.get(r.reversesRecordId)?.kind === r.kind;
  const cancelled = new Set(rows.filter(reversal).map((r) => r.reversesRecordId));
  return rows.filter((r) => r.status !== 'voided' && !reversal(r) && !cancelled.has(r.id));
}

const signed = (rows: readonly Row[]) => {
  let due = 0;
  let credits = 0;
  let net = 0;
  for (const r of rows)
    if (r.kind === 'due') due += r.amountPaise;
    else if (r.kind === 'received') net += r.amountPaise;
    else if (r.kind === 'refund') net -= r.amountPaise;
    else if (r.kind === 'adjustment' && r.direction === 'debit') due += r.amountPaise;
    else credits += r.amountPaise;
  return { due, credits, net };
};

/** The version of each agreement that was last accepted: its total, with every version's rows. */
function recount(plans: readonly Plan[], rows: readonly Row[]) {
  const replaced = new Set(plans.map((p) => p.supersedesPlanId));
  const byId = new Map(plans.map((p) => [p.id, p]));
  let due = 0;
  let credits = 0;
  let net = 0;
  let known = false;
  for (const head of plans.filter((p) => !replaced.has(p.id))) {
    let accepted: Plan | undefined = head;
    while (accepted && !accepted.approvedAt && accepted.status !== 'active')
      accepted = byId.get(accepted.supersedesPlanId as never);
    if (!accepted) continue;
    const chain = new Set<string>();
    for (let p: Plan | undefined = accepted; p; p = byId.get(p.supersedesPlanId as never))
      chain.add(p.id);
    // A draft change after the accepted version holds no money.
    const s = signed(live(rows.filter((r) => r.planId && chain.has(r.planId))));
    due += accepted.totalPaise + s.due;
    credits += s.credits;
    net += s.net;
    known = true;
  }
  for (const category of ['tuition', 'registration', 'demo'] as const) {
    const outside = rows.filter((r) => !r.planId && r.chargeCategory === category);
    const s = signed(live(outside));
    const charged = live(outside).some((r) => r.kind === 'due');
    net += s.net;
    if (!charged) continue;
    due += s.due;
    credits += s.credits;
    known = true;
  }
  // Net received on a charge nobody recorded lowers no balance.
  const uncharged = (['tuition', 'registration', 'demo'] as const).reduce((n, category) => {
    const outside = live(rows.filter((r) => !r.planId && r.chargeCategory === category));
    return outside.some((r) => r.kind === 'due') ? n : n + signed(outside).net;
  }, 0);
  return { due, credits, net, balance: known ? due - credits - (net - uncharged) : null };
}

export async function sampleMoneyDifferences(
  db: Database,
  reader: { id: string; roles: string[] },
) {
  const out: string[] = [];
  const people = await db.select().from(students).where(eq(students.isSample, true));
  for (const person of people) {
    const say = (what: string, a: unknown, b: unknown) => {
      if (a !== b) out.push(`${person.fullName}: ${what}: ${String(a)} against ${String(b)}`);
    };
    const [plans, joined] = await Promise.all([
      db.select().from(opsFeePlans).where(eq(opsFeePlans.studentId, person.id)),
      db
        .select({ r: opsFeeRecords })
        .from(opsFeeRecords)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
        .where(eq(opsAdmissions.studentId, person.id)),
    ]);
    const rows = joined.map((j) => j.r);
    const statement = feeStatement(plans, rows);
    const count = recount(plans, rows);
    say('amount due', count.due, statement.duePaise);
    say('discounts and credits', count.credits, statement.creditAdjustmentsPaise);
    say('received, net', count.net, statement.netReceivedPaise);
    say('balance', count.balance, statement.balancePaise);

    // What the student's page is given.
    const profile = await getStudent(db, reader as never, person.id).catch(() => null);
    if (profile?.fees) {
      say('page: amount due', profile.fees.duePaise, statement.duePaise);
      say('page: received, net', profile.fees.netReceivedPaise, statement.netReceivedPaise);
      say('page: balance', profile.fees.balancePaise, statement.balancePaise);
    }

    // Each agreement: its instalments add up to its total, what they still owe to its ledger.
    const ids = plans.map((p) => p.id);
    const instalments = ids.length
      ? await db.select().from(opsFeeInstalments).where(inArray(opsFeeInstalments.planId, ids))
      : [];
    for (const p of plans)
      say(
        `agreement ${p.label} v${p.version}: instalments`,
        instalments.filter((i) => i.planId === p.id).reduce((n, i) => n + i.amountPaise, 0),
        p.totalPaise,
      );
    for (const d of await plansWithLedger(db, plans, new Date())) {
      const left = d.instalments.reduce((n, i) => n + i.remainingPaise, 0);
      say(
        `agreement ${d.plan.label} v${d.plan.version}: owed`,
        left + d.aboveInstalmentsPaise,
        d.totals.outstandingPaise,
      );
    }

    // The exit record holds the balance on the day of the exit; nothing moved after it.
    const exits = await db
      .select({ x: opsExitRecords })
      .from(opsExitRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsExitRecords.admissionId))
      .where(eq(opsAdmissions.studentId, person.id));
    for (const { x } of exits) say(`exit ${x.exitStatus} balance`, x.balancePaise, statement.balancePaise);

    // A report froze the statement when it was made.
    const reports = await db
      .select({ code: opsReportExports.referenceCode, snapshot: opsReportExports.snapshot })
      .from(opsReportExports)
      .where(eq(opsReportExports.studentId, person.id));
    for (const r of reports) {
      const fees = (r.snapshot as { fees?: { balancePaise: number | null; duePaise: number } }).fees;
      if (fees) say(`report ${r.code} balance`, fees.balancePaise, statement.balancePaise);
    }
  }
  return { students: people.length, differences: out };
}
