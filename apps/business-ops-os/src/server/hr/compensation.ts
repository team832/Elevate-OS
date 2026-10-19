/**
 * Compensation records (OPS-036) — SENSITIVE, `ops:compensation:*` (hr_manager,
 * finance_officer only; no `own` grants). COMPENSATION RECORDS ONLY — NOT A
 * PAYROLL SYSTEM: no deductions, tax, PF, ESI or payslips (D-028).
 *
 * Draft → approved (by a different person; never one's own pay) → superseded.
 * Audit payloads carry status, dates and the names of changed fields, never
 * amounts or components. Export of the terms effective on a date is
 * `ops:compensation:export`, audited with an export reference.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  opsCompensationRecords,
  opsEmployeeRecords,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday } from '../../domain/dates';
import {
  compensationCsv,
  effectiveRecordAt,
  planCompensationApproval,
  validateCompensation,
} from '../../domain/hr/compensation';
import { staffIdForUser, type Actor } from '../context';
import { assertNotSelf, hrScope } from '../hr-scope';
import type {
  compensationListQuery,
  CreateCompensationInput,
  updateCompensationBody,
} from './schemas';

type CompensationId = typeof opsCompensationRecords.$inferSelect.id;
type CompensationRow = typeof opsCompensationRecords.$inferSelect;

/** Compensation needs an `all` grant; there is no own-scope access to pay data. */
async function requireCompensation(
  db: Database,
  actor: Actor,
  permission: 'ops:compensation:read' | 'ops:compensation:manage' | 'ops:compensation:export',
) {
  const scope = await hrScope(db, actor, permission);
  if (scope.scope !== 'all') throw new ForbiddenError('Compensation records are restricted.');
  return scope;
}

function invalid(issues: { path: (string | number)[]; message: string }[]): never {
  throw new ValidationError(issues[0]?.message ?? 'Invalid compensation record.', {
    details: issues.map((i) => ({ location: 'body', path: i.path, message: i.message })),
  });
}

const auditView = (r: CompensationRow) => ({
  staffId: r.staffId,
  basis: r.basis,
  status: r.status,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

function dto(r: CompensationRow & { employeeCode: string; fullName: string }) {
  return {
    id: r.id,
    staffId: r.staffId,
    employeeCode: r.employeeCode,
    fullName: r.fullName,
    basis: r.basis,
    amountPaise: r.amountPaise,
    currency: r.currency,
    components: r.components,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    status: r.status,
    note: r.note,
    createdBy: r.createdBy,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    createdAt: r.createdAt,
  };
}

const withEmployee = (db: Database) =>
  db
    .select({
      record: opsCompensationRecords,
      employeeCode: opsEmployeeRecords.employeeCode,
      fullName: staffMembers.fullName,
    })
    .from(opsCompensationRecords)
    .innerJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, opsCompensationRecords.staffId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsCompensationRecords.staffId));

/** Records (newest first) with the record effective today per employee. */
export async function listCompensation(
  db: Database,
  actor: Actor,
  query: z.output<typeof compensationListQuery>,
) {
  await requireCompensation(db, actor, 'ops:compensation:read');
  const where: SQL[] = [];
  if (query.staffId) where.push(eq(opsCompensationRecords.staffId, query.staffId as StaffMemberId));
  if (query.status) where.push(eq(opsCompensationRecords.status, query.status));
  const rows = await withEmployee(db)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(opsEmployeeRecords.employeeCode), desc(opsCompensationRecords.effectiveFrom));
  const today = istToday(new Date());
  const records = rows.map((r) =>
    dto({ ...r.record, employeeCode: r.employeeCode, fullName: r.fullName }),
  );
  const byStaff = new Map<string, typeof records>();
  for (const r of records) byStaff.set(r.staffId, [...(byStaff.get(r.staffId) ?? []), r]);
  const effectiveToday = [...byStaff.values()].map((list) => {
    const { record, conflict } = effectiveRecordAt(list, today);
    return {
      staffId: list[0]!.staffId,
      employeeCode: list[0]!.employeeCode,
      fullName: list[0]!.fullName,
      recordId: record?.id ?? null,
      conflict,
    };
  });
  return { records, effectiveToday, today };
}

async function assertEmployee(db: Database, staffId: string) {
  const [e] = await db
    .select({ status: opsEmployeeRecords.employmentStatus })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId));
  if (!e)
    throw new ValidationError('Unknown employee.', {
      details: [{ location: 'body', path: ['staffId'], message: 'Unknown employee' }],
    });
  if (e.status === 'separated')
    throw new ConflictError('The employee has separated; no new compensation terms.');
}

export async function createCompensationDraft(
  db: Database,
  actor: Actor,
  input: CreateCompensationInput,
  requestId?: string,
) {
  const scope = await requireCompensation(db, actor, 'ops:compensation:manage');
  assertNotSelf(scope.staffId, input.staffId, 'your own compensation');
  const check = validateCompensation(input);
  if (!check.ok) invalid(check.issues);
  await assertEmployee(db, input.staffId);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsCompensationRecords)
      .values({
        staffId: input.staffId as StaffMemberId,
        basis: input.basis,
        amountPaise: input.amountPaise,
        components: input.components.map((c) => ({ ...c, label: c.label.trim() })),
        effectiveFrom: input.effectiveFrom,
        note: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('compensation insert returned no row');
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'compensation.drafted',
      entityType: 'compensation_record',
      entityId: row.id,
      after: auditView(row),
      metadata: { fieldsSet: ['basis', 'amountPaise', 'components', 'effectiveFrom'] },
      requestId,
    });
    return { id: row.id, status: row.status };
  });
}

async function lockRecord(tx: Database, id: string) {
  const [row] = await tx
    .select()
    .from(opsCompensationRecords)
    .where(eq(opsCompensationRecords.id, id as CompensationId))
    .for('update');
  if (!row) throw new NotFoundError('Compensation record not found.');
  return row;
}

export async function updateCompensationDraft(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateCompensationBody>,
  requestId?: string,
) {
  const scope = await requireCompensation(db, actor, 'ops:compensation:manage');
  return withTransaction(db, async (tx) => {
    const before = await lockRecord(tx, id);
    assertNotSelf(scope.staffId, before.staffId, 'your own compensation');
    if (before.status !== 'draft')
      throw new InvalidStateTransitionError(
        'Only drafts can be edited; draft a new record instead.',
      );
    const merged = {
      basis: input.basis ?? before.basis,
      amountPaise: input.amountPaise ?? before.amountPaise,
      components: input.components ?? before.components,
      effectiveFrom: input.effectiveFrom ?? before.effectiveFrom,
    };
    const check = validateCompensation(merged);
    if (!check.ok) invalid(check.issues);
    const [after] = await tx
      .update(opsCompensationRecords)
      .set({ ...merged, ...('note' in input ? { note: input.note ?? null } : {}) })
      .where(eq(opsCompensationRecords.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'compensation.draft_updated',
      entityType: 'compensation_record',
      entityId: before.id,
      before: auditView(before),
      after: auditView(after!),
      metadata: { fieldsChanged: Object.keys(input) },
      requestId,
    });
    return { id: before.id, status: after!.status };
  });
}

/** Approve a draft (A-HR-06): different person, forward in time, supersedes the current terms. */
export async function approveCompensation(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  // TODO(permission request): a dedicated `ops:compensation:approve` would separate
  // drafting from approving; today any `manage` holder other than the drafter approves.
  const scope = await requireCompensation(db, actor, 'ops:compensation:manage');
  const approverStaffId = scope.staffId ?? (await staffIdForUser(db, actor.id));
  return withTransaction(db, async (tx) => {
    const record = await lockRecord(tx, id);
    const others = await tx
      .select()
      .from(opsCompensationRecords)
      .where(eq(opsCompensationRecords.staffId, record.staffId))
      .for('update');
    const plan = planCompensationApproval(record, others, {
      userId: actor.id,
      staffId: approverStaffId,
    });
    if (!plan.ok) {
      if (plan.code === 'SELF_APPROVAL') throw new ForbiddenError(plan.message);
      if (plan.code === 'CONFLICT') throw new ConflictError(plan.message);
      throw new InvalidStateTransitionError(plan.message);
    }
    if (plan.supersede)
      await tx
        .update(opsCompensationRecords)
        .set({
          status: 'superseded',
          effectiveTo: plan.supersede.effectiveTo,
          supersededById: record.id,
        })
        .where(eq(opsCompensationRecords.id, plan.supersede.id as CompensationId));
    const [after] = await tx
      .update(opsCompensationRecords)
      .set({ status: 'approved', approvedBy: actor.id, approvedAt: new Date() })
      .where(eq(opsCompensationRecords.id, record.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'compensation.approved',
      entityType: 'compensation_record',
      entityId: record.id,
      before: auditView(record),
      after: auditView(after!),
      metadata: {
        supersededRecordId: plan.supersede?.id ?? null,
        supersededEffectiveTo: plan.supersede?.effectiveTo ?? null,
      },
      requestId,
    });
    await notify(tx, {
      userIds: [record.createdBy],
      module: 'ops',
      kind: 'hr.compensation_approved',
      title: 'Compensation record approved',
      body: `Effective from ${record.effectiveFrom}.`,
      link: `/ops/hr/compensation?staffId=${record.staffId}`,
    });
    return { id: record.id, status: 'approved' as const, supersededId: plan.supersede?.id ?? null };
  });
}

export async function cancelCompensation(
  db: Database,
  actor: Actor,
  id: string,
  reason: string,
  requestId?: string,
) {
  const scope = await requireCompensation(db, actor, 'ops:compensation:manage');
  return withTransaction(db, async (tx) => {
    const record = await lockRecord(tx, id);
    assertNotSelf(scope.staffId, record.staffId, 'your own compensation');
    if (record.status !== 'draft')
      throw new InvalidStateTransitionError('Only drafts can be cancelled.');
    await tx
      .update(opsCompensationRecords)
      .set({ status: 'cancelled' })
      .where(eq(opsCompensationRecords.id, record.id));
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'compensation.cancelled',
      entityType: 'compensation_record',
      entityId: record.id,
      before: auditView(record),
      after: { ...auditView(record), status: 'cancelled' },
      metadata: { reason },
      requestId,
    });
    return { id: record.id, status: 'cancelled' as const };
  });
}

/** CSV of the terms effective on `asOf` for an authorised payroll process (no payroll is run). */
export async function exportCompensation(
  db: Database,
  actor: Actor,
  options: { asOf?: string },
  requestId?: string,
) {
  await requireCompensation(db, actor, 'ops:compensation:export');
  const asOf = options.asOf ?? istToday(new Date());
  const rows = await withEmployee(db).where(
    inArray(opsCompensationRecords.status, ['approved', 'superseded']),
  );
  const byStaff = new Map<string, typeof rows>();
  for (const r of rows)
    byStaff.set(r.record.staffId, [...(byStaff.get(r.record.staffId) ?? []), r]);
  const exportRows = [];
  let conflicts = 0;
  for (const list of byStaff.values()) {
    const { record, conflict } = effectiveRecordAt(
      list.map((l) => ({ ...l.record, employeeCode: l.employeeCode, fullName: l.fullName })),
      asOf,
    );
    if (conflict) conflicts += 1;
    if (record)
      exportRows.push({
        employeeCode: record.employeeCode,
        fullName: record.fullName,
        basis: record.basis,
        amountPaise: record.amountPaise,
        effectiveFrom: record.effectiveFrom,
        effectiveTo: record.effectiveTo,
        components: record.components,
        recordId: record.id,
      });
  }
  if (conflicts > 0)
    throw new ConflictError(
      `${conflicts} employee(s) have overlapping approved records on ${asOf}; fix them before exporting.`,
    );
  const exportReference = `CMPX-${asOf.replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const csv = compensationCsv(exportRows, { exportReference, asOf });
  await withTransaction(db, (tx) =>
    recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'compensation.exported',
      entityType: 'compensation_export',
      entityId: null,
      // Reference and row count only — never amounts.
      metadata: { exportReference, asOf, rowCount: exportRows.length },
      requestId,
    }),
  );
  return { csv, exportReference, rowCount: exportRows.length, asOf };
}
