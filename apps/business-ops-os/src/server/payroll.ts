/**
 * Payroll (F4-14, Proposed): salary components and structures, advances, monthly runs and payslip
 * lines. Each write is one transaction with an audit row of record ids and counts only: salaries
 * never go into audit payloads, notifications or logs, and responses carry ids, not amounts (an
 * Idempotency-Key replay stores the response). Prepared by ops:payroll:manage; approved by an
 * ops:payroll:approve holder who neither started nor submitted the run; approved runs are locked.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { can, requirePermission, type Permission } from '@elevate/authorization';
import {
  opsLeaveRecords,
  opsPayrollComponents,
  opsPayrollRuns,
  opsPayslipLines,
  opsPayslips,
  opsSalaryAdvances,
  opsSalaryStructureLines,
  opsSalaryStructures,
  opsStaffProfiles,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { monthRange } from '../domain/attendance';
import { istToday } from '../domain/dates';
import {
  daysInMonth,
  LOCKED,
  lossOfPayDays,
  lossOfPayPaise,
  MANUAL_SOURCES,
  NOT_DRAFT,
  NO_APPROVER,
  OWN_RUN,
  RUN_AUTHOR,
  payslipTotals,
  recoveryPaise,
  RUN_ACTIONS,
  runActionRefusal,
  type RunAction,
} from '../domain/payroll';
import { fmtDate, fmtMonth } from '../ui/format';
import { userIdsHolding, type Actor } from './context';
import { fieldError, notifyOthers, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import type {
  advanceBody,
  componentBody,
  lineBody,
  paidBody,
  structureBody,
} from './payroll-schemas';

export const PAYROLL_MANAGE = 'ops:payroll:manage';
export const PAYROLL_APPROVE = 'ops:payroll:approve';
export const PAYSLIPS_READ = 'ops:payslips:read';
type In<S extends z.ZodType> = z.output<S>;

/** Who sees salary figures: those who prepare or approve payroll (own payslips are separate). */
export const seesPayroll = (actor: Actor) =>
  can(actor, PAYROLL_MANAGE) || can(actor, PAYROLL_APPROVE);
export function requirePayroll(
  actor: Actor,
  perms: readonly Permission[] = [PAYROLL_MANAGE, PAYROLL_APPROVE],
) {
  if (!perms.some((p) => can(actor, p)))
    throw new ForbiddenError('Payroll is open only to the people who prepare or approve it.');
}

/** Sum of recovery lines per advance, in the runs `runs` selects (approved only, or all but one). */
export async function recoveredBy(
  db: Database,
  advanceIds: readonly string[],
  runs: 'approved' | { except: string },
) {
  const rows = await db
    .select({
      advanceId: opsPayslipLines.advanceId,
      paise: sql<number>`sum(${opsPayslipLines.amountPaise})`.mapWith(Number),
    })
    .from(opsPayslipLines)
    .innerJoin(opsPayslips, eq(opsPayslips.id, opsPayslipLines.payslipId))
    .innerJoin(opsPayrollRuns, eq(opsPayrollRuns.id, opsPayslips.runId))
    .where(
      and(
        inArray(opsPayslipLines.advanceId, [...advanceIds]),
        runs === 'approved'
          ? eq(opsPayrollRuns.status, 'approved')
          : ne(opsPayrollRuns.id, runs.except),
      ),
    )
    .groupBy(opsPayslipLines.advanceId);
  return new Map(rows.map((r) => [r.advanceId as string, r.paise]));
}

const componentAudit = opsAudit('payroll_component');
const structureAudit = opsAudit('salary_structure');
const advanceAudit = opsAudit('salary_advance');
const runAudit = opsAudit('payroll_run');
const lineAudit = opsAudit('payslip_line');
const payslipAudit = opsAudit('payslip');

export async function createComponent(
  db: Database,
  actor: Actor,
  body: In<typeof componentBody>,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsPayrollComponents)
      .values({ ...body, createdBy: actor.id })
      .onConflictDoNothing()
      .returning({ id: opsPayrollComponents.id });
    if (!row)
      throw fieldError('code', `The code "${body.code}" is already used by another component.`);
    await componentAudit(tx, actor, row.id, 'payroll_component.created', {}, requestId);
    return row;
  });
}

export async function setComponentStatus(
  db: Database,
  actor: Actor,
  id: string,
  status: 'active' | 'retired',
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsPayrollComponents, id, 'Component', true);
    if (before.status === status) return { id };
    await tx
      .update(opsPayrollComponents)
      .set({ status, updatedAt: new Date() })
      .where(eq(opsPayrollComponents.id, id));
    await componentAudit(
      tx,
      actor,
      id,
      `payroll_component.${status === 'retired' ? 'retired' : 'restored'}`,
      {},
      requestId,
    );
    return { id };
  });
}

/** A salary from the 1st of a month; a change is a new structure, never an edit (history kept). */
export async function createStructure(
  db: Database,
  actor: Actor,
  body: In<typeof structureBody>,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  const componentIds = Object.keys(body.lines);
  return withTransaction(db, async (tx) => {
    await rowById(tx, staffMembers, body.staffId, 'Staff member');
    const active = await tx
      .select({ id: opsPayrollComponents.id })
      .from(opsPayrollComponents)
      .where(
        and(
          inArray(opsPayrollComponents.id, componentIds),
          eq(opsPayrollComponents.status, 'active'),
        ),
      );
    if (active.length !== componentIds.length)
      throw new ValidationError(
        'A component is retired or no longer exists. Reload the page and enter the amounts again.',
      );
    const [row] = await tx
      .insert(opsSalaryStructures)
      .values({
        staffId: body.staffId,
        effectiveFrom: body.effectiveFrom,
        note: body.note ?? null,
        createdBy: actor.id,
      })
      .onConflictDoNothing()
      .returning({ id: opsSalaryStructures.id });
    if (!row)
      throw fieldError(
        'effectiveFrom',
        'This person already has a salary from that month. A salary is never edited: choose a later month for the change.',
      );
    await tx.insert(opsSalaryStructureLines).values(
      componentIds.map((componentId) => ({
        structureId: row.id,
        componentId,
        monthlyAmountPaise: body.lines[componentId]!,
      })),
    );
    await structureAudit(
      tx,
      actor,
      row.id,
      'salary_structure.created',
      { metadata: { staffId: body.staffId, lines: componentIds.length } },
      requestId,
    );
    return row;
  });
}

export async function createAdvance(
  db: Database,
  actor: Actor,
  body: In<typeof advanceBody>,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  if (body.givenOn > istToday(new Date()))
    throw fieldError('givenOn', 'The date given cannot be in the future.');
  return withTransaction(db, async (tx) => {
    await rowById(tx, staffMembers, body.staffId, 'Staff member');
    const [row] = await tx
      .insert(opsSalaryAdvances)
      .values({
        staffId: body.staffId,
        amountPaise: body.amount,
        monthlyInstalmentPaise: body.monthlyInstalment,
        givenOn: body.givenOn,
        recoverFrom: body.recoverFrom,
        reason: body.reason,
        reference: body.reference ?? null,
        createdBy: actor.id,
      })
      .returning({ id: opsSalaryAdvances.id });
    await advanceAudit(
      tx,
      actor,
      row!.id,
      'salary_advance.created',
      { metadata: { staffId: body.staffId } },
      requestId,
    );
    return row!;
  });
}

/** Stops further recovery; lines already in payroll stay. */
export async function cancelAdvance(
  db: Database,
  actor: Actor,
  id: string,
  reason: string,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsSalaryAdvances, id, 'Advance', true);
    if (before.cancelledAt)
      throw new InvalidStateTransitionError('This advance is already cancelled.');
    await tx
      .update(opsSalaryAdvances)
      .set({ cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: reason })
      .where(eq(opsSalaryAdvances.id, id));
    await advanceAudit(
      tx,
      actor,
      id,
      'salary_advance.cancelled',
      { metadata: { staffId: before.staffId } },
      requestId,
    );
    return { id };
  });
}

type Run = typeof opsPayrollRuns.$inferSelect;
const counts = async (tx: Database, runId: string) => {
  const [r] = await tx
    .select({
      payslips: sql<number>`count(DISTINCT ${opsPayslips.id})`.mapWith(Number),
      lines: count(opsPayslipLines.id),
    })
    .from(opsPayslips)
    .leftJoin(opsPayslipLines, eq(opsPayslipLines.payslipId, opsPayslips.id))
    .where(eq(opsPayslips.runId, runId));
  return r!;
};

/**
 * (Re)build a draft's lines: each staff member's structure in force on the 1st (unless they left
 * before it), loss of pay from approved unpaid leave, and advance instalments. Hand-made lines
 * stay; a payslip left with no lines goes.
 */
async function buildPayslips(tx: Database, actor: Actor, run: Run) {
  const month = run.month;
  const end = monthRange(month.slice(0, 7)).to;
  const days = daysInMonth(month);
  const inForce = await tx
    .selectDistinctOn([opsSalaryStructures.staffId], {
      id: opsSalaryStructures.id,
      staffId: opsSalaryStructures.staffId,
    })
    .from(opsSalaryStructures)
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, opsSalaryStructures.staffId))
    .where(
      and(
        lte(opsSalaryStructures.effectiveFrom, month),
        or(isNull(opsStaffProfiles.leftOn), gte(opsStaffProfiles.leftOn, month)),
      ),
    )
    .orderBy(opsSalaryStructures.staffId, desc(opsSalaryStructures.effectiveFrom));
  const staffIds = inForce.map((s) => s.staffId);
  const salary = await tx
    .select({
      structureId: opsSalaryStructureLines.structureId,
      componentId: opsSalaryStructureLines.componentId,
      amountPaise: opsSalaryStructureLines.monthlyAmountPaise,
      kind: opsPayrollComponents.kind,
      label: opsPayrollComponents.name,
    })
    .from(opsSalaryStructureLines)
    .innerJoin(
      opsPayrollComponents,
      eq(opsPayrollComponents.id, opsSalaryStructureLines.componentId),
    )
    .where(
      inArray(
        opsSalaryStructureLines.structureId,
        inForce.map((s) => s.id),
      ),
    )
    .orderBy(desc(opsPayrollComponents.kind), asc(opsPayrollComponents.name));
  const leave = await tx
    .select({
      staffId: opsLeaveRecords.staffId,
      fromDate: opsLeaveRecords.fromDate,
      toDate: opsLeaveRecords.toDate,
      kind: opsLeaveRecords.kind,
      dayPart: opsLeaveRecords.dayPart,
    })
    .from(opsLeaveRecords)
    .where(
      and(
        inArray(opsLeaveRecords.staffId, staffIds),
        eq(opsLeaveRecords.status, 'approved'),
        lte(opsLeaveRecords.fromDate, end),
        gte(opsLeaveRecords.toDate, month),
      ),
    );
  const advances = await tx
    .select()
    .from(opsSalaryAdvances)
    .where(
      and(
        inArray(opsSalaryAdvances.staffId, staffIds),
        isNull(opsSalaryAdvances.cancelledAt),
        lte(opsSalaryAdvances.recoverFrom, month),
      ),
    )
    .orderBy(asc(opsSalaryAdvances.givenOn))
    .for('update'); // two months built at once wait here, so one advance is not recovered twice
  const recovered = await recoveredBy(
    tx,
    advances.map((a) => a.id),
    { except: run.id },
  );

  const ofRun = tx
    .select({ id: opsPayslips.id })
    .from(opsPayslips)
    .where(eq(opsPayslips.runId, run.id));
  await tx
    .delete(opsPayslipLines)
    .where(
      and(
        inArray(opsPayslipLines.payslipId, ofRun),
        notInArray(opsPayslipLines.source, [...MANUAL_SOURCES]),
      ),
    );
  await tx
    .update(opsPayslips)
    .set({ structureId: null, lossOfPayDays: 0, updatedAt: new Date() })
    .where(and(eq(opsPayslips.runId, run.id), notInArray(opsPayslips.staffId, staffIds)));
  const unpaid = (await loadSettings(tx))['hr.leave_unpaid_types'].value.types;
  const lop = new Map(
    staffIds.map((id) => [
      id as string,
      lossOfPayDays(
        month,
        leave.filter((l) => l.staffId === id),
        unpaid,
      ),
    ]),
  );
  const slips = inForce.length
    ? await tx
        .insert(opsPayslips)
        .values(
          inForce.map((s) => ({
            runId: run.id,
            staffId: s.staffId,
            structureId: s.id,
            daysInMonth: days,
            lossOfPayDays: lop.get(s.staffId)!,
          })),
        )
        .onConflictDoUpdate({
          target: [opsPayslips.runId, opsPayslips.staffId],
          set: {
            structureId: sql`excluded.structure_id`,
            daysInMonth: days,
            lossOfPayDays: sql`excluded.loss_of_pay_days`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: opsPayslips.id,
          staffId: opsPayslips.staffId,
          structureId: opsPayslips.structureId,
        })
    : [];
  const lines = slips.flatMap((slip) => {
    const base = { payslipId: slip.id, createdBy: actor.id };
    const own = salary.filter((l) => l.structureId === slip.structureId);
    const lopDays = lop.get(slip.staffId)!;
    const lopPaise = lossOfPayPaise(payslipTotals(own).earningsPaise, lopDays, days);
    return [
      ...own.map((l) => ({
        ...base,
        kind: l.kind,
        source: 'structure' as const,
        componentId: l.componentId,
        label: l.label,
        amountPaise: l.amountPaise,
      })),
      ...(lopPaise > 0
        ? [
            {
              ...base,
              kind: 'deduction' as const,
              source: 'loss_of_pay' as const,
              label: `Loss of pay (${lopDays} ${lopDays === 1 ? 'day' : 'days'})`,
              amountPaise: lopPaise,
            },
          ]
        : []),
      ...advances
        .filter((a) => a.staffId === slip.staffId)
        .map((a) => ({
          ...base,
          kind: 'deduction' as const,
          source: 'advance_recovery' as const,
          advanceId: a.id,
          label: `Recovery of salary advance (${fmtDate(a.givenOn)})`,
          amountPaise: recoveryPaise(a, recovered.get(a.id) ?? 0),
        }))
        .filter((l) => l.amountPaise > 0),
    ];
  });
  if (lines.length) await tx.insert(opsPayslipLines).values(lines);
  await tx
    .delete(opsPayslips)
    .where(
      and(
        eq(opsPayslips.runId, run.id),
        sql`NOT EXISTS (SELECT 1 FROM ${opsPayslipLines} WHERE ${opsPayslipLines.payslipId} = ${opsPayslips.id})`,
      ),
    );
  return counts(tx, run.id);
}

/** A draft for a month (this one or earlier), built from salaries, leave and advances. */
export async function createRun(db: Database, actor: Actor, month: string, requestId?: string) {
  requirePermission(actor, PAYROLL_MANAGE);
  if (month > istToday(new Date()).slice(0, 7))
    throw fieldError('month', 'Payroll is prepared for this month or an earlier one.');
  return withTransaction(db, async (tx) => {
    const [run] = await tx
      .insert(opsPayrollRuns)
      .values({ month: `${month}-01`, createdBy: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!run)
      throw new ConflictError(
        `Payroll for ${fmtMonth(month)} already exists. Open it from the list.`,
      );
    const made = await buildPayslips(tx, actor, run);
    await runAudit(tx, actor, run.id, 'payroll_run.created', { metadata: made }, requestId);
    return { id: run.id, ...made };
  });
}

const ACTION_PERMISSIONS: Record<RunAction, Permission[]> = {
  rebuild: [PAYROLL_MANAGE],
  submit: [PAYROLL_MANAGE],
  return: [PAYROLL_MANAGE, PAYROLL_APPROVE],
  approve: [PAYROLL_APPROVE],
};

export async function runAction(
  db: Database,
  actor: Actor,
  id: string,
  action: RunAction,
  requestId?: string,
) {
  requirePayroll(actor, ACTION_PERMISSIONS[action]);
  return withTransaction(db, async (tx) => {
    const run = await rowById(tx, opsPayrollRuns, id, 'Payroll', true);
    const authors = action === 'approve' ? await runAuthors(tx, id) : [];
    const refusal = runActionRefusal(run, action, actor.id, authors);
    if (refusal)
      throw refusal === OWN_RUN || refusal === RUN_AUTHOR
        ? new ForbiddenError(refusal)
        : new InvalidStateTransitionError(refusal);
    const made = action === 'rebuild' ? await buildPayslips(tx, actor, run) : await counts(tx, id);
    if (action === 'submit') await assertSubmittable(tx, id, made.payslips);
    const approvers = action === 'submit' ? await eligibleApprovers(tx, run, actor.id) : [];
    if (action === 'submit' && !approvers.length)
      throw new InvalidStateTransitionError(NO_APPROVER);
    const now = new Date();
    const { to, done } = RUN_ACTIONS[action];
    await tx
      .update(opsPayrollRuns)
      .set({
        status: to,
        ...(to === 'draft' && { submittedBy: null, submittedAt: null }),
        ...(to === 'submitted' && { submittedBy: actor.id, submittedAt: now }),
        ...(to === 'approved' && { approvedBy: actor.id, approvedAt: now }),
        updatedAt: now,
      })
      .where(eq(opsPayrollRuns.id, id));
    await runAudit(tx, actor, id, `payroll_run.${done}`, { metadata: made }, requestId);
    if (action === 'submit') {
      await notifyOthers(tx, actor, approvers, {
        kind: 'payroll.submitted',
        title: `Payroll for ${fmtMonth(run.month.slice(0, 7))} is waiting for your approval`,
        link: `/ops/hr/payroll/${id}`,
        entityType: 'payroll_run',
        entityId: id,
      });
    }
    return { id, status: to, ...made };
  });
}

/** Active approval holders who may approve the run once `submitter` submits it. */
async function eligibleApprovers(tx: Database, run: Run, submitter: string): Promise<UserId[]> {
  const barred = [run.createdBy as string, submitter, ...(await runAuthors(tx, run.id))];
  const holders = (await userIdsHolding(tx, PAYROLL_APPROVE)).filter((u) => !barred.includes(u));
  const active = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, holders), eq(users.status, 'active')));
  return active.map((u) => u.id);
}

/** Who wrote a line in the run or a salary structure its payslips use: never its approver. */
export async function runAuthors(db: Database, runId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: opsPayslipLines.createdBy })
    .from(opsPayslipLines)
    .innerJoin(opsPayslips, eq(opsPayslips.id, opsPayslipLines.payslipId))
    .where(eq(opsPayslips.runId, runId))
    .union(
      db
        .selectDistinct({ id: opsSalaryStructures.createdBy })
        .from(opsSalaryStructures)
        .innerJoin(opsPayslips, eq(opsPayslips.structureId, opsSalaryStructures.id))
        .where(eq(opsPayslips.runId, runId)),
    );
  return rows.map((r) => r.id);
}

async function assertSubmittable(tx: Database, runId: string, payslips: number) {
  if (!payslips)
    throw new InvalidStateTransitionError(
      'This payroll has no payslips. Set salaries, then rebuild it.',
    );
  const lines = await tx
    .select({
      payslipId: opsPayslipLines.payslipId,
      kind: opsPayslipLines.kind,
      amountPaise: opsPayslipLines.amountPaise,
      name: staffMembers.fullName,
    })
    .from(opsPayslipLines)
    .innerJoin(opsPayslips, eq(opsPayslips.id, opsPayslipLines.payslipId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsPayslips.staffId))
    .where(eq(opsPayslips.runId, runId));
  const below = [...new Set(lines.map((l) => l.payslipId))].filter(
    (p) => payslipTotals(lines.filter((l) => l.payslipId === p)).netPaise < 0,
  );
  if (below.length)
    throw new ValidationError(
      `Net pay is below zero for ${below.map((p) => lines.find((l) => l.payslipId === p)!.name).join(', ')}. Remove a one-off deduction, cancel the advance or add an earning first.`,
    );
}

const draftRun = async (tx: Database, runId: string) => {
  const run = await rowById(tx, opsPayrollRuns, runId, 'Payroll', true);
  if (run.status !== 'draft')
    throw new InvalidStateTransitionError(run.status === 'approved' ? LOCKED : NOT_DRAFT);
  return run;
};

/** A one-off line or a correction of an earlier month; makes the person's payslip if needed. */
export async function addLine(
  db: Database,
  actor: Actor,
  runId: string,
  body: In<typeof lineBody>,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  return withTransaction(db, async (tx) => {
    const run = await draftRun(tx, runId);
    await rowById(tx, staffMembers, body.staffId, 'Staff member');
    const [slip] = await tx
      .insert(opsPayslips)
      .values({ runId, staffId: body.staffId, daysInMonth: daysInMonth(run.month) })
      .onConflictDoUpdate({
        target: [opsPayslips.runId, opsPayslips.staffId],
        set: { updatedAt: new Date() },
      })
      .returning({ id: opsPayslips.id });
    const [line] = await tx
      .insert(opsPayslipLines)
      .values({
        payslipId: slip!.id,
        kind: body.kind,
        source: body.source,
        label: body.label,
        amountPaise: body.amount,
        note: body.note,
        createdBy: actor.id,
      })
      .returning({ id: opsPayslipLines.id });
    await lineAudit(
      tx,
      actor,
      line!.id,
      'payslip_line.added',
      { metadata: { runId, payslipId: slip!.id } },
      requestId,
    );
    return { id: line!.id, payslipId: slip!.id };
  });
}

export async function removeLine(db: Database, actor: Actor, lineId: string, requestId?: string) {
  requirePermission(actor, PAYROLL_MANAGE);
  return withTransaction(db, async (tx) => {
    const line = await rowById(tx, opsPayslipLines, lineId, 'Payslip line', true);
    const slip = await rowById(tx, opsPayslips, line.payslipId, 'Payslip');
    await draftRun(tx, slip.runId);
    if (!(MANUAL_SOURCES as readonly string[]).includes(line.source))
      throw new InvalidStateTransitionError(
        'Lines from salaries, leave and advances change only when the payroll is rebuilt.',
      );
    await tx.delete(opsPayslipLines).where(eq(opsPayslipLines.id, lineId));
    await tx
      .delete(opsPayslips)
      .where(
        and(
          eq(opsPayslips.id, slip.id),
          sql`NOT EXISTS (SELECT 1 FROM ${opsPayslipLines} WHERE ${opsPayslipLines.payslipId} = ${opsPayslips.id})`,
        ),
      );
    await lineAudit(
      tx,
      actor,
      lineId,
      'payslip_line.removed',
      { metadata: { runId: slip.runId, payslipId: slip.id } },
      requestId,
    );
    return { id: lineId };
  });
}

export async function markPaid(
  db: Database,
  actor: Actor,
  payslipId: string,
  body: In<typeof paidBody>,
  requestId?: string,
) {
  requirePermission(actor, PAYROLL_MANAGE);
  if (body.paidOn > istToday(new Date()))
    throw fieldError('paidOn', 'The payment date cannot be in the future.');
  return withTransaction(db, async (tx) => {
    const slip = await rowById(tx, opsPayslips, payslipId, 'Payslip', true);
    const run = await rowById(tx, opsPayrollRuns, slip.runId, 'Payroll');
    if (run.status !== 'approved')
      throw new InvalidStateTransitionError('Approve this payroll before marking payslips paid.');
    if (slip.paidOn)
      throw new InvalidStateTransitionError(
        `This payslip was already marked paid on ${slip.paidOn}.`,
      );
    await tx
      .update(opsPayslips)
      .set({
        paidOn: body.paidOn,
        paidMode: body.paidMode,
        paidReference: body.paidReference ?? null,
        paidBy: actor.id,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(opsPayslips.id, payslipId));
    await payslipAudit(
      tx,
      actor,
      payslipId,
      'payslip.paid',
      { metadata: { runId: slip.runId } },
      requestId,
    );
    return { id: payslipId };
  });
}
