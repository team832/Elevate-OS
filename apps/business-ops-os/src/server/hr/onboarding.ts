/**
 * Lifecycle cases — shared HR lifecycle helpers, case helpers and onboarding
 * (OPS-045, OPS-046, D-028). Offboarding, separation and the case detail view
 * live in ./offboarding.ts.
 *
 * Access: `ops:lifecycle:read` with HR scope (hr-scope.ts: `all`, or own =
 * self + reporting chain for department managers); checklist work needs
 * `ops:lifecycle:manage` at scope `all`; the final approval needs
 * `ops:lifecycle:approve` and is never given by the employee themself.
 *
 * Relation to the wave 2 `ops.onboarding_items` (organisation.ts): those rows
 * are the simple per-staff document checklist on /ops/staff/[id] and keep
 * working unchanged. HRC onboarding cases are the HR process with assignees,
 * due dates, gating and approval; they do not read or write onboarding_items.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import {
  opsEmployeeRecords,
  opsLifecycleCases,
  opsLifecycleItems,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify, type NotifyInput } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { istToday, type IsoDate } from '../../domain/dates';
import {
  checkItemUpdate,
  completionGaps,
  generateOnboardingItems,
  isItemOverdue,
  isResolved,
  type GeneratedItem,
  type LifecycleKind,
} from '../../domain/hr/lifecycle';
import {
  activeStaff,
  nextCode,
  notFound,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type Actor,
} from '../context';
import { assertHrScope, assertNotSelf, hrScope, hrScopeIds, type HrScope } from '../hr-scope';
import { loadSettings } from '../settings';
import { notifyOthers, opsAudit, rowById, type AuditData } from '../ops-common';
import { changeEmploymentStatus } from './employee-core';
import type { AddItemInput, CaseListQuery, UpdateItemInput } from './lifecycle-schemas';

export type CaseRow = typeof opsLifecycleCases.$inferSelect;
export type ItemRow = typeof opsLifecycleItems.$inferSelect;

// --- shared helpers (recruitment, onboarding, offboarding) -------------------------------------

/** 400 with a field path; `detail` is the per-field message. */
export const fieldError = (path: string, message: string, detail = message) =>
  new ValidationError(message, { details: [{ location: 'body', path: [path], message: detail }] });

/** Case-insensitive `%q%` match on any of the columns. */
export const search = (q: string, ...cols: Parameters<typeof ilike>[0][]) =>
  or(...cols.map((c) => ilike(c, `%${q}%`)));

export const sortBy = (dir: 'asc' | 'desc', col: Parameters<typeof asc>[0]) =>
  dir === 'asc' ? asc(col) : desc(col);

/** A list response page (`pageOf(q, [])` is the empty page). */
export const pageOf = <T>(q: { page: number; pageSize: number }, rows: T[], total = 0) => ({
  rows,
  total: Number(total),
  page: q.page,
  pageSize: q.pageSize,
});

/** notifyOthers to the logins of `staffIds` and to `userIds`. */
export const notifyPeople = async (
  tx: Database,
  actor: Actor,
  staffIds: readonly (string | null | undefined)[],
  message: Omit<NotifyInput, 'userIds' | 'module'>,
  userIds: readonly UserId[] = [],
) => notifyOthers(tx, actor, [...(await userIdsForStaff(tx, staffIds)), ...userIds], message);

/** opsAudit with `requestId` inside the data object; a null actor is the system. */
export const auditOf = (entityType: string) => {
  const write = opsAudit(entityType);
  return (
    tx: Database,
    actor: Actor | null,
    entityId: string | null,
    action: string,
    { requestId, ...data }: AuditData & { requestId?: string } = {},
  ) => write(tx, actor, entityId, action, data, requestId);
};

// --- case helpers ------------------------------------------------------------------------------

export const auditCase = auditOf('lifecycle_case');

export const CASE_LINK = (c: { id: string; kind: string }) =>
  `/ops/hr/${c.kind === 'offboarding' ? 'offboarding' : 'onboarding'}/${c.id}`;

/** Notification link + entity for a case. */
export const caseRef = (c: { id: string; kind: string }) => ({
  link: CASE_LINK(c),
  entityType: 'lifecycle_case',
  entityId: c.id,
});

export const getCaseRow = (db: Database, id: string, lock = false) =>
  rowById(db, opsLifecycleCases, id, 'Case', lock);

export const lockCase = (tx: Database, id: string) => getCaseRow(tx, id, true);

export async function caseItems(db: Database, caseId: string): Promise<ItemRow[]> {
  return db
    .select()
    .from(opsLifecycleItems)
    .where(eq(opsLifecycleItems.caseId, caseId as CaseRow['id']))
    .orderBy(asc(opsLifecycleItems.seq));
}

/** HL-A8 gaps of a case, read in the caller's transaction; throws when any remain. */
export async function assertNoGaps(tx: Database, c: CaseRow) {
  const gaps = completionGaps(c.kind, await caseItems(tx, c.id));
  if (gaps.length)
    throw new ConflictError('Required checklist items are still open.', {
      details: { missing: gaps },
    });
}

/** HR scope for lifecycle work: manage at scope `all` only (HR / operations). */
export async function lifecycleManager(db: Database, actor: Actor): Promise<HrScope> {
  const scope = await hrScope(db, actor, 'ops:lifecycle:manage');
  if (scope.scope !== 'all') throw new ForbiddenError('Only HR can work lifecycle checklists.');
  return scope;
}

/** Separation reasons: lifecycle approvers and all-scope lifecycle managers (HR). */
export function canSeeSeparationReason(actor: Actor): boolean {
  return can(actor, 'ops:lifecycle:approve') || scopeFor(actor, 'ops:lifecycle:manage') === 'all';
}

export async function employeeOf(db: Database, staffId: string) {
  const [row] = await db
    .select({
      staffId: opsEmployeeRecords.staffId,
      employeeCode: opsEmployeeRecords.employeeCode,
      employmentStatus: opsEmployeeRecords.employmentStatus,
      employmentStartDate: opsEmployeeRecords.employmentStartDate,
      fullName: staffMembers.fullName,
      userId: staffMembers.userId,
      managerId: staffMembers.managerId,
      staffStatus: staffMembers.status,
    })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId))
    .limit(1);
  if (!row)
    throw fieldError('staffId', 'This staff member has no employee record.', 'No employee record');
  return row;
}

/** A second live (open or approved) case of the same kind is refused. */
export async function assertNoLiveCase(
  tx: Database,
  employee: { staffId: StaffMemberId; employeeCode: string },
  kind: LifecycleKind,
) {
  const [live] = await tx
    .select({ code: opsLifecycleCases.code })
    .from(opsLifecycleCases)
    .where(
      and(
        eq(opsLifecycleCases.staffId, employee.staffId),
        eq(opsLifecycleCases.kind, kind),
        inArray(opsLifecycleCases.status, ['open', 'approved']),
      ),
    );
  if (live)
    throw new ConflictError(
      kind === 'onboarding'
        ? `${employee.employeeCode} already has an open onboarding case (${live.code}).`
        : `${employee.employeeCode} already has an offboarding case (${live.code}).`,
    );
}

/** Insert generated items (idempotent per itemKey), resolving assignees. Returns inserted rows. */
export async function insertItems(
  tx: Database,
  caseRow: CaseRow,
  items: readonly GeneratedItem[],
  people: { hr: StaffMemberId | null; manager: StaffMemberId | null; employee: StaffMemberId },
): Promise<ItemRow[]> {
  const existing = await caseItems(tx, caseRow.id);
  const have = new Set(existing.map((i) => i.itemKey));
  let seq = existing.reduce((m, i) => Math.max(m, i.seq), 0);
  const fresh = items.filter((i) => !have.has(i.itemKey));
  if (fresh.length === 0) return [];
  return tx
    .insert(opsLifecycleItems)
    .values(
      fresh.map((i) => ({
        caseId: caseRow.id,
        itemKey: i.itemKey,
        seq: (seq += 1),
        kind: i.kind,
        title: i.title,
        required: i.required,
        assigneeStaffId: i.assignee === 'none' ? null : people[i.assignee],
        dueDate: i.dueDate,
        assetAssignmentId: (i.assetAssignmentId as ItemRow['assetAssignmentId']) ?? null,
        transferEntityType: i.transferEntityType ?? null,
        transferEntityId: i.transferEntityId ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning();
}

export async function notifyAssignees(
  tx: Database,
  caseRow: CaseRow,
  items: readonly ItemRow[],
  actor: Actor,
) {
  await notifyPeople(
    tx,
    actor,
    items.map((i) => i.assigneeStaffId),
    {
      kind: 'lifecycle.items_assigned',
      title: `${caseRow.code}: checklist items assigned to you`,
      ...caseRef(caseRow),
    },
  );
}

// --- onboarding --------------------------------------------------------------------------------

/**
 * Open an onboarding case with the template checklist (HL-A5). No permission
 * check: callers authorise (conversion = ops:recruitment:decide; manual =
 * ops:lifecycle:manage). Refuses a second live onboarding case.
 */
export async function openOnboardingCase(
  tx: Database,
  actor: Actor,
  input: {
    staffId: StaffMemberId;
    applicationId?: string | null;
    baseDate?: IsoDate | null;
    requestId?: string;
  },
): Promise<CaseRow> {
  const employee = await employeeOf(tx, input.staffId);
  if (employee.employmentStatus !== 'onboarding' && employee.employmentStatus !== 'active')
    throw new ConflictError(
      `${employee.employeeCode} is ${employee.employmentStatus}; onboarding is not possible.`,
    );
  await assertNoLiveCase(tx, employee, 'onboarding');
  const settings = await loadSettings(tx);
  const code = await nextCode(tx, 'lifecycleCase', 'ops.lifecycle_cases');
  const row = (
    await tx
      .insert(opsLifecycleCases)
      .values({
        code,
        kind: 'onboarding',
        staffId: input.staffId,
        applicationId: (input.applicationId as CaseRow['applicationId']) ?? null,
        openedBy: actor.id,
      })
      .returning()
  )[0]!;
  const base = input.baseDate ?? employee.employmentStartDate ?? istToday(new Date());
  const items = await insertItems(
    tx,
    row,
    generateOnboardingItems(settings['hr.onboarding_template'].value, base as IsoDate),
    {
      hr: await staffIdForUser(tx, actor.id),
      manager: employee.managerId,
      employee: input.staffId,
    },
  );
  await auditCase(tx, actor, row.id, 'lifecycle_case.opened', {
    after: {
      code,
      kind: 'onboarding',
      staffId: input.staffId,
      items: items.length,
      applicationId: row.applicationId,
    },
    requestId: input.requestId,
    metadata: { templateState: settings['hr.onboarding_template'].decisionState },
  });
  await notifyAssignees(tx, row, items, actor);
  return row;
}

export async function createOnboardingCase(
  db: Database,
  actor: Actor,
  staffId: string,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  return withTransaction(db, (tx) =>
    openOnboardingCase(tx, actor, { staffId: staffId as StaffMemberId, requestId }),
  );
}

/**
 * HL-A8 for onboarding: every required item resolved → an approver who is not
 * the employee completes the case; employment status onboarding → active via
 * the HR records helper (history row + audit). An already-active employee
 * keeps their status.
 */
export async function approveOnboarding(
  tx: Database,
  actor: Actor,
  caseRow: CaseRow,
  comment: string | null,
  requestId?: string,
) {
  await assertNoGaps(tx, caseRow);
  const now = new Date();
  const [after] = await tx
    .update(opsLifecycleCases)
    .set({
      status: 'completed',
      approvedBy: actor.id,
      approvedAt: now,
      approvalComment: comment,
      completedAt: now,
    })
    .where(eq(opsLifecycleCases.id, caseRow.id))
    .returning();
  const employee = await employeeOf(tx, caseRow.staffId);
  if (employee.employmentStatus === 'onboarding')
    await changeEmploymentStatus(
      tx,
      actor,
      caseRow.staffId,
      'active',
      { reason: `Onboarding ${caseRow.code} approved` },
      requestId,
    );
  await auditCase(tx, actor, caseRow.id, 'lifecycle_case.approved', {
    before: { status: caseRow.status },
    after: { status: 'completed' },
    requestId,
  });
  await notifyPeople(tx, actor, [caseRow.staffId, employee.managerId], {
    kind: 'lifecycle.onboarding_completed',
    title: `${caseRow.code}: onboarding completed`,
    ...caseRef(caseRow),
  });
  return after as CaseRow;
}

/** Shared approval preconditions (permission, no self-approval). */
export async function assertCanApprove(db: Database, actor: Actor, caseRow: CaseRow) {
  const scope = await hrScope(db, actor, 'ops:lifecycle:approve');
  assertHrScope(scope, caseRow.staffId, 'this case');
  assertNotSelf(scope.staffId, caseRow.staffId, 'your own onboarding or separation');
}

// --- lists -------------------------------------------------------------------------------------

export async function listCases(db: Database, actor: Actor, q: CaseListQuery) {
  const ids = hrScopeIds(await hrScope(db, actor, 'ops:lifecycle:read'));
  if (ids?.length === 0) return pageOf(q, []);
  const where = and(
    ids ? inArray(opsLifecycleCases.staffId, ids) : undefined,
    q.kind ? eq(opsLifecycleCases.kind, q.kind) : undefined,
    q.status ? eq(opsLifecycleCases.status, q.status) : undefined,
    q.q
      ? search(q.q, opsLifecycleCases.code, staffMembers.fullName, opsEmployeeRecords.employeeCode)
      : undefined,
  );
  const sortCol = {
    code: opsLifecycleCases.code,
    updated: opsLifecycleCases.updatedAt,
    employee: staffMembers.fullName,
  }[q.sort];
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(opsLifecycleCases)
    .innerJoin(staffMembers, eq(staffMembers.id, opsLifecycleCases.staffId))
    .innerJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, opsLifecycleCases.staffId))
    .where(where);
  const rows = await db
    .select({
      c: opsLifecycleCases,
      fullName: staffMembers.fullName,
      employeeCode: opsEmployeeRecords.employeeCode,
      employmentStatus: opsEmployeeRecords.employmentStatus,
    })
    .from(opsLifecycleCases)
    .innerJoin(staffMembers, eq(staffMembers.id, opsLifecycleCases.staffId))
    .innerJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, opsLifecycleCases.staffId))
    .where(where)
    .orderBy(sortBy(q.dir, sortCol), asc(opsLifecycleCases.code))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const caseIds = rows.map((r) => r.c.id);
  const items = caseIds.length
    ? await db
        .select({
          caseId: opsLifecycleItems.caseId,
          required: opsLifecycleItems.required,
          status: opsLifecycleItems.status,
          dueDate: opsLifecycleItems.dueDate,
        })
        .from(opsLifecycleItems)
        .where(inArray(opsLifecycleItems.caseId, caseIds))
    : [];
  const today = istToday(new Date());
  const mapped = rows.map((r) => {
    const mine = items.filter((i) => i.caseId === r.c.id);
    const required = mine.filter((i) => i.required);
    return {
      id: r.c.id,
      code: r.c.code,
      kind: r.c.kind,
      status: r.c.status,
      staffId: r.c.staffId,
      fullName: r.fullName,
      employeeCode: r.employeeCode,
      employmentStatus: r.employmentStatus,
      // No separation type or reason in lists.
      lastWorkingDay: r.c.lastWorkingDay,
      requiredDone: required.filter((i) => isResolved(i.status)).length,
      requiredTotal: required.length,
      overdue: mine.filter((i) =>
        isItemOverdue({ status: i.status, dueDate: i.dueDate as IsoDate | null }, today),
      ).length,
      updatedAt: r.c.updatedAt,
    };
  });
  return pageOf(q, mapped, total);
}

/** Employees a new case can be opened for (manage holders only). */
export async function lifecycleCandidates(db: Database, actor: Actor, kind: LifecycleKind) {
  await lifecycleManager(db, actor);
  const statuses =
    kind === 'onboarding'
      ? (['onboarding', 'active'] as const)
      : (['onboarding', 'active', 'on_notice'] as const);
  const rows = await db
    .select({
      staffId: opsEmployeeRecords.staffId,
      employeeCode: opsEmployeeRecords.employeeCode,
      fullName: staffMembers.fullName,
    })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(inArray(opsEmployeeRecords.employmentStatus, [...statuses]))
    .orderBy(asc(staffMembers.fullName));
  return rows.map((r) => ({
    value: r.staffId as string,
    label: `${r.fullName} (${r.employeeCode})`,
  }));
}

// --- checklist items ---------------------------------------------------------------------------

/** Lock the case for checklist work; completed and cancelled cases are closed. */
async function workableCase(tx: Database, id: string) {
  const c = await lockCase(tx, id);
  if (c.status === 'completed' || c.status === 'cancelled')
    throw new ConflictError(`${c.code} is ${c.status}; its checklist is closed.`);
  return c;
}

/** HL-A7: update one checklist item (status, evidence, notes, assignee, due date). */
export async function updateCaseItem(
  db: Database,
  actor: Actor,
  caseId: string,
  itemId: string,
  input: UpdateItemInput,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  if (input.assigneeStaffId) await activeStaff(db, input.assigneeStaffId, 'assigneeStaffId');
  return withTransaction(db, async (tx) => {
    const c = await workableCase(tx, caseId);
    const [before] = await tx
      .select()
      .from(opsLifecycleItems)
      .where(
        and(eq(opsLifecycleItems.id, itemId as ItemRow['id']), eq(opsLifecycleItems.caseId, c.id)),
      )
      .for('update');
    if (!before) notFound('Checklist item');
    const patch: Partial<typeof opsLifecycleItems.$inferInsert> = {};
    if (input.status && input.status !== before.status) {
      const check = checkItemUpdate({
        kind: before.kind,
        from: before.status,
        to: input.status,
        notes: input.notes ?? before.notes,
        evidence: input.evidence ?? before.evidence,
      });
      if (!check.ok) {
        if (check.code === 'SYSTEM_ONLY') throw new ConflictError(check.message);
        throw fieldError(check.code === 'EVIDENCE_REQUIRED' ? 'evidence' : 'notes', check.message);
      }
      const resolved = isResolved(input.status);
      Object.assign(patch, {
        status: input.status,
        completedAt: resolved ? new Date() : null,
        completedBy: resolved ? actor.id : null,
      });
    }
    if (input.evidence !== undefined) patch.evidence = input.evidence;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.assigneeStaffId !== undefined)
      patch.assigneeStaffId = input.assigneeStaffId as StaffMemberId | null;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    const [after] = await tx
      .update(opsLifecycleItems)
      .set(patch)
      .where(eq(opsLifecycleItems.id, before.id))
      .returning();
    if (before.kind === 'final_settlement' && patch.status === 'done')
      await tx
        .update(opsLifecycleCases)
        .set({ settlementReference: after?.evidence ?? null })
        .where(eq(opsLifecycleCases.id, c.id));
    const view = (i?: ItemRow) => ({
      itemId: before.id,
      status: i?.status,
      assigneeStaffId: i?.assigneeStaffId,
      dueDate: i?.dueDate,
    });
    await auditCase(tx, actor, c.id, 'lifecycle_item.updated', {
      before: view(before),
      after: view(after),
      requestId,
    });
    if (after?.assigneeStaffId && after.assigneeStaffId !== before.assigneeStaffId)
      await notifyAssignees(tx, c, [after], actor);
    return after as ItemRow;
  });
}

export async function addCaseItem(
  db: Database,
  actor: Actor,
  caseId: string,
  input: AddItemInput,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  if (input.assigneeStaffId) await activeStaff(db, input.assigneeStaffId, 'assigneeStaffId');
  return withTransaction(db, async (tx) => {
    const c = await workableCase(tx, caseId);
    const existing = await caseItems(tx, c.id);
    const n = existing.filter((i) => i.itemKey.startsWith('custom:')).length + 1;
    const [row] = await tx
      .insert(opsLifecycleItems)
      .values({
        caseId: c.id,
        itemKey: `custom:${n}`,
        seq: existing.reduce((m, i) => Math.max(m, i.seq), 0) + 1,
        kind: 'custom',
        title: input.title,
        required: input.required,
        assigneeStaffId: (input.assigneeStaffId as StaffMemberId | null) ?? null,
        dueDate: input.dueDate ?? null,
      })
      .returning();
    await auditCase(tx, actor, c.id, 'lifecycle_item.added', {
      after: { itemId: row?.id, title: input.title, required: input.required },
      requestId,
    });
    if (row) await notifyAssignees(tx, c, [row], actor);
    return row as ItemRow;
  });
}

// --- reminders job ------------------------------------------------------------------------------

/**
 * Job `lifecycle-reminders`: one in-app reminder per overdue checklist item
 * per IST day (pending or blocked, due before today, case open or approved).
 * Unassigned items go to HR managers. Idempotent within a day via
 * `last_reminded_on`.
 */
export async function runLifecycleReminders(db: Database, now: Date = new Date()) {
  const today = istToday(now);
  return withTransaction(db, async (tx) => {
    const due = await tx
      .select({
        item: opsLifecycleItems,
        caseCode: opsLifecycleCases.code,
        caseId: opsLifecycleCases.id,
        kind: opsLifecycleCases.kind,
      })
      .from(opsLifecycleItems)
      .innerJoin(opsLifecycleCases, eq(opsLifecycleCases.id, opsLifecycleItems.caseId))
      .where(
        and(
          inArray(opsLifecycleCases.status, ['open', 'approved']),
          inArray(opsLifecycleItems.status, ['pending', 'blocked']),
          lt(opsLifecycleItems.dueDate, today),
          or(isNull(opsLifecycleItems.lastRemindedOn), ne(opsLifecycleItems.lastRemindedOn, today)),
        ),
      );
    const hrManagers = due.some((d) => !d.item.assigneeStaffId)
      ? await userIdsWithRole(tx, 'hr_manager')
      : [];
    let reminded = 0;
    for (const d of due) {
      const recipients = d.item.assigneeStaffId
        ? await userIdsForStaff(tx, [d.item.assigneeStaffId])
        : hrManagers;
      if (recipients.length) {
        await notify(tx, {
          userIds: recipients,
          module: 'ops',
          kind: 'lifecycle.item_overdue',
          title: `${d.caseCode}: overdue — ${d.item.title}`,
          body: `Due ${d.item.dueDate}.`,
          ...caseRef({ id: d.caseId, kind: d.kind }),
        });
        reminded += 1;
      }
      await tx
        .update(opsLifecycleItems)
        .set({ lastRemindedOn: today })
        .where(eq(opsLifecycleItems.id, d.item.id));
    }
    if (due.length)
      await auditOf('job')(tx, null, 'lifecycle-reminders', 'lifecycle.reminders_sent', {
        after: { today, overdueItems: due.length, reminded },
      });
    return { today, overdueItems: due.length, reminded };
  });
}
