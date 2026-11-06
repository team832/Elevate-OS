/**
 * Payroll reads (F4-14): the payroll page (runs, salaries, advances, components), one run's
 * payslips, a person's own payslips, and the payslip PDF and run spreadsheet downloads. Salary
 * figures reach only ops:payroll:manage / approve holders, and each person's own payslips once
 * the payroll is approved (anyone else gets "not found"). Downloads are audited without amounts.
 */
import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { can, requirePermission, type Principal } from '@elevate/authorization';
import {
  departments,
  OPS_PAYSLIP_LINE_SOURCES,
  opsPayrollComponents,
  opsPayrollRuns,
  opsPayslipLines,
  opsPayslips,
  opsSalaryAdvances,
  opsSalaryStructureLines,
  opsSalaryStructures,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { csvResponse, toCsv } from '@elevate/server-kit';
import { PAY_MODE_LABELS, payslipTotals, runActionRefusal } from '../domain/payroll';
import { namesOf } from './admissions-lookups';
import { notFound, staffIdForUser, type Actor } from './context';
import { opsAudit } from './ops-common';
import { formOptions } from './options';
import { loadSettings } from './settings';
import {
  PAYROLL_APPROVE,
  PAYSLIPS_READ,
  recoveredBy,
  requirePayroll,
  runAuthors,
  seesPayroll,
} from './payroll';
import { payslipsPdf } from './pdf/payslip';
import { pdfResponse } from './pdf/document';

const lines = opsPayslipLines;
const total = (kind: 'earning' | 'deduction') =>
  sql<number>`coalesce(sum(${lines.amountPaise}) FILTER (WHERE ${lines.kind} = ${kind}), 0)`.mapWith(
    Number,
  );
const SUMS = { earningsPaise: total('earning'), deductionsPaise: total('deduction') };
const net = <T extends { earningsPaise: number; deductionsPaise: number }>(r: T) => ({
  ...r,
  netPaise: r.earningsPaise - r.deductionsPaise,
});
const profile = eq(opsStaffProfiles.staffId, staffMembers.id);
/** The leave types counted as loss of pay (setting hr.leave_unpaid_types). */
const unpaidTypes = async (db: Database) =>
  (await loadSettings(db))['hr.leave_unpaid_types'].value.types as readonly string[];

export async function payrollHome(db: Database, actor: Actor) {
  requirePayroll(actor);
  const components = await db
    .select()
    .from(opsPayrollComponents)
    .orderBy(
      asc(opsPayrollComponents.status),
      desc(opsPayrollComponents.kind),
      asc(opsPayrollComponents.name),
    );
  const runs = await db
    .select({
      ...getTableColumns(opsPayrollRuns),
      payslips: sql<number>`count(DISTINCT ${opsPayslips.id})`.mapWith(Number),
      ...SUMS,
    })
    .from(opsPayrollRuns)
    .leftJoin(opsPayslips, eq(opsPayslips.runId, opsPayrollRuns.id))
    .leftJoin(lines, eq(lines.payslipId, opsPayslips.id))
    .groupBy(opsPayrollRuns.id)
    .orderBy(desc(opsPayrollRuns.month));
  const structures = await db
    .select({
      ...getTableColumns(opsSalaryStructures),
      staffName: staffMembers.fullName,
      sampleStaff: opsStaffProfiles.isSample,
    })
    .from(opsSalaryStructures)
    .innerJoin(staffMembers, eq(staffMembers.id, opsSalaryStructures.staffId))
    .leftJoin(opsStaffProfiles, profile)
    .orderBy(asc(staffMembers.fullName), desc(opsSalaryStructures.effectiveFrom));
  const structureLines = await db
    .select({
      structureId: opsSalaryStructureLines.structureId,
      amountPaise: opsSalaryStructureLines.monthlyAmountPaise,
      kind: opsPayrollComponents.kind,
      label: opsPayrollComponents.name,
    })
    .from(opsSalaryStructureLines)
    .innerJoin(
      opsPayrollComponents,
      eq(opsPayrollComponents.id, opsSalaryStructureLines.componentId),
    )
    .orderBy(desc(opsPayrollComponents.kind), asc(opsPayrollComponents.name));
  const advances = await db
    .select({
      ...getTableColumns(opsSalaryAdvances),
      staffName: staffMembers.fullName,
      sampleStaff: opsStaffProfiles.isSample,
    })
    .from(opsSalaryAdvances)
    .innerJoin(staffMembers, eq(staffMembers.id, opsSalaryAdvances.staffId))
    .leftJoin(opsStaffProfiles, profile)
    .orderBy(desc(opsSalaryAdvances.givenOn));
  const recovered = await recoveredBy(
    db,
    advances.map((a) => a.id),
    'approved',
  );
  const versions = structures.map((s) => {
    const own = structureLines.filter((l) => l.structureId === s.id);
    return { ...s, lines: own, ...payslipTotals(own) };
  });
  return {
    components,
    runs: runs.map(net),
    salaries: [...new Set(structures.map((s) => s.staffId))].map((staffId) => {
      const mine = versions.filter((v) => v.staffId === staffId);
      return {
        staffId,
        staffName: mine[0]!.staffName,
        isSample: Boolean(mine[0]!.sampleStaff),
        versions: mine,
      };
    }),
    advances: advances.map((a) => {
      const recoveredPaise = recovered.get(a.id) ?? 0;
      return { ...a, recoveredPaise, remainingPaise: a.amountPaise - recoveredPaise };
    }),
    staff: (await formOptions(db)).staff,
    unpaidTypes: await unpaidTypes(db),
  };
}
export type PayrollHome = Awaited<ReturnType<typeof payrollHome>>;

const SOURCE_ORDER = (l: { kind: string; source: string }) =>
  (l.kind === 'earning' ? 0 : 10) + OPS_PAYSLIP_LINE_SOURCES.indexOf(l.source as never);

/** A run's payslips (or one of them) with staff facts, lines (earnings first) and totals. */
export async function runPayslips(db: Database, runId: string, payslipId?: string) {
  const slips = await db
    .select({
      ...getTableColumns(opsPayslips),
      staffName: staffMembers.fullName,
      title: staffMembers.title,
      department: departments.name,
      staffCode: opsStaffProfiles.staffCode,
      sampleStaff: opsStaffProfiles.isSample,
    })
    .from(opsPayslips)
    .innerJoin(staffMembers, eq(staffMembers.id, opsPayslips.staffId))
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .leftJoin(opsStaffProfiles, profile)
    .where(and(eq(opsPayslips.runId, runId), payslipId ? eq(opsPayslips.id, payslipId) : undefined))
    .orderBy(asc(staffMembers.fullName));
  const all = await db
    .select()
    .from(lines)
    .where(
      inArray(
        lines.payslipId,
        slips.map((s) => s.id),
      ),
    )
    .orderBy(asc(lines.createdAt), asc(lines.label));
  all.sort((a, b) => SOURCE_ORDER(a) - SOURCE_ORDER(b));
  return slips.map((s) => {
    const own = all.filter((l) => l.payslipId === s.id);
    return { ...s, isSample: Boolean(s.sampleStaff), lines: own, ...payslipTotals(own) };
  });
}
export type RunPayslip = Awaited<ReturnType<typeof runPayslips>>[number];

const runRow = async (db: Database, id: string) => {
  const [run] = await db.select().from(opsPayrollRuns).where(eq(opsPayrollRuns.id, id));
  return run ?? notFound('Payroll');
};

export async function payrollRun(db: Database, actor: Actor, id: string) {
  requirePayroll(actor);
  const run = await runRow(db, id);
  const slips = await runPayslips(db, id);
  return {
    run,
    names: await namesOf(db, [run.createdBy, run.submittedBy, run.approvedBy]),
    slips,
    totals: payslipTotals(slips.flatMap((s) => s.lines)),
    /** Why this reader may not approve (null = may), when they hold approval. */
    approveRefusal: can(actor, PAYROLL_APPROVE)
      ? runActionRefusal(run, 'approve', actor.id, await runAuthors(db, id))
      : 'Waiting for someone who approves payroll.',
    unpaidTypes: await unpaidTypes(db),
    staff: (await formOptions(db)).staff,
  };
}

/** The signed-in person's payslips in approved payroll, newest first; null = no staff record. */
export async function myPayslips(db: Database, actor: Principal) {
  requirePermission(actor, PAYSLIPS_READ);
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const rows = await db
    .select({
      id: opsPayslips.id,
      month: opsPayrollRuns.month,
      paidOn: opsPayslips.paidOn,
      paidMode: opsPayslips.paidMode,
      ...SUMS,
    })
    .from(opsPayslips)
    .innerJoin(opsPayrollRuns, eq(opsPayrollRuns.id, opsPayslips.runId))
    .leftJoin(lines, eq(lines.payslipId, opsPayslips.id))
    .where(and(eq(opsPayslips.staffId, staffId), eq(opsPayrollRuns.status, 'approved')))
    .groupBy(opsPayslips.id, opsPayrollRuns.month)
    .orderBy(desc(opsPayrollRuns.month));
  return rows.map(net);
}

const fileAudit = opsAudit('payroll_run');
const slipAudit = opsAudit('payslip');
const reference = (month: string, tail: string) => `PAY-${month.slice(0, 7)}-${tail}`;

/** One payslip PDF: payroll holders any; others only their own, once approved (else not found). */
export async function payslipFile(db: Database, actor: Actor, id: string) {
  const [slip] = await db
    .select({
      runId: opsPayslips.runId,
      staffId: opsPayslips.staffId,
      status: opsPayrollRuns.status,
    })
    .from(opsPayslips)
    .innerJoin(opsPayrollRuns, eq(opsPayrollRuns.id, opsPayslips.runId))
    .where(eq(opsPayslips.id, id));
  const own = async () =>
    slip!.status === 'approved' &&
    can(actor, PAYSLIPS_READ) &&
    slip!.staffId === (await staffIdForUser(db, actor.id));
  if (!slip || !(seesPayroll(actor) || (await own()))) notFound('Payslip');
  const run = await runRow(db, slip.runId);
  const [one] = await runPayslips(db, run.id, id);
  const tail = one!.staffCode ?? id.slice(0, 8);
  const pdf = await payslipsPdf(run, [one!], reference(run.month, tail));
  await slipAudit(db, actor, id, 'payslip.downloaded', { metadata: { runId: run.id } });
  return pdfResponse(pdf.bytes, `payslip-${run.month.slice(0, 7)}-${tail}.pdf`);
}

/** Every payslip of a run: one PDF (a page each) or a spreadsheet. Payroll holders only. */
export async function runFile(db: Database, actor: Actor, id: string, format: 'pdf' | 'csv') {
  requirePayroll(actor);
  const run = await runRow(db, id);
  const slips = await runPayslips(db, id);
  await fileAudit(db, actor, id, 'payroll_run.downloaded', {
    metadata: { format, payslips: slips.length },
  });
  const name = `payroll-${run.month.slice(0, 7)}`;
  if (format === 'pdf')
    return pdfResponse(
      (await payslipsPdf(run, slips, reference(run.month, 'ALL'))).bytes,
      `${name}.pdf`,
    );
  const rupees = (paise: number) => paise / 100;
  return csvResponse(
    toCsv(
      [
        'Staff member',
        'Employee ID',
        'Days in month',
        'Loss-of-pay days',
        'Earnings (₹)',
        'Deductions (₹)',
        'Net pay (₹)',
        'Paid on',
        'Mode',
        'Reference',
        'Sample data',
      ],
      slips.map((s) => [
        s.staffName,
        s.staffCode ?? 'Not recorded',
        s.daysInMonth,
        s.lossOfPayDays,
        rupees(s.earningsPaise),
        rupees(s.deductionsPaise),
        rupees(s.netPaise),
        s.paidOn ?? 'Not paid',
        s.paidMode ? PAY_MODE_LABELS[s.paidMode] : '',
        s.paidReference ?? '',
        s.isSample ? 'Sample data' : '',
      ]),
    ),
    `${name}.csv`,
  );
}
