/**
 * Offboarding and separation (OPS-047, OPS-048, D-028), plus the lifecycle
 * case detail view and the create / approve / cancel entry points for both
 * kinds (onboarding specifics live in ./onboarding.ts).
 *
 * Separation flow: offboarding case (separation record + generated checklist)
 * → final approval by `ops:lifecycle:approve`, never the employee themself →
 * employment status `on_notice` → the day after the last working day
 * `runSeparations` (or the approval itself, when that day has passed) marks
 * the employee `separated`, sets core.staff_members.status = inactive and
 * publishes `ops.employee.separated` v1 in the same transaction
 * (`publishSeparation`). The platform consumer disables the login and deletes
 * its sessions; `syncCaseSystemItems` then completes the access-revocation
 * item from the delivery record. Nothing historical is deleted.
 */
import { and, asc, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import {
  auditEvents,
  eventDeliveries,
  opsAdmissions,
  opsAssetAssignments,
  opsAssets,
  opsEmployeeRecords,
  opsLeads,
  opsLifecycleCases,
  opsLifecycleItems,
  opsResponsibilities,
  opsTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { publishEvent, recordAudit, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  hrLifecycleKeys,
  PLATFORM_ACCESS_REVOCATION_CONSUMER,
  ValidationError,
} from '@elevate/shared-contracts';
import type { IntegrationEventId, IsoDateTime, StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../../domain/dates';
import {
  checkSeparationDates,
  completionGaps,
  generateOffboardingItems,
  isItemOverdue,
  isResolved,
  ITEM_KIND_LABELS,
  separationDue,
  type ItemKind,
  type ItemStatus,
  type LifecycleKind,
  type OwnedWork,
  type SeparationType,
  type TransferEntityType,
} from '../../domain/hr/lifecycle';
import { activeStaff, nextCode, staffIdForUser, userIdsForStaff, type Actor } from '../context';
import { assertHrScope, hrScope } from '../hr-scope';
import { loadSettings } from '../settings';
import { changeEmploymentStatus } from './employee-core';
import type { CreateCaseInput } from './lifecycle-schemas';
import {
  approveOnboarding,
  assertCanApprove,
  CASE_LINK,
  canSeeSeparationReason,
  caseItems,
  createOnboardingCase,
  employeeOf,
  getCaseRow,
  insertItems,
  lifecycleManager,
  lockCase,
  notifyAssignees,
  type CaseRow,
  type ItemRow,
} from './onboarding';
import { entityHistory, staffNames, userNames } from './recruitment';
import './wiring';

const OPEN_TASK = ['not_started', 'in_progress', 'waiting', 'at_risk', 'blocked'];
const CLOSED_ADMISSION = ['enrolled', 'lost'];

// --- separation event --------------------------------------------------------------------------

export interface PublishSeparationInput {
  staffId: StaffMemberId;
  /** Last working day (IST calendar date). */
  lastWorkingDay: IsoDate;
  separatedAt: Date;
  /** Offboarding case; omit for a separation recorded without a case. */
  caseId?: string | null;
}

/**
 * Publish `ops.employee.separated` v1 inside the caller's transaction (the one
 * that marks the employee separated). Idempotent: the key is per case, or per
 * staff member and last working day without a case, so calling it twice
 * stores one event. Reads the employee code and linked login itself.
 */
export async function publishSeparation(
  tx: Database,
  input: PublishSeparationInput,
): Promise<{ eventId: IntegrationEventId; created: boolean; userId: UserId | null }> {
  const [row] = await tx
    .select({ employeeCode: opsEmployeeRecords.employeeCode, userId: staffMembers.userId })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(eq(opsEmployeeRecords.staffId, input.staffId));
  if (!row) throw new ValidationError('This staff member has no employee record.');
  const event = await publishEvent(tx, {
    type: 'ops.employee.separated',
    version: 1,
    idempotencyKey: input.caseId
      ? hrLifecycleKeys.separation(input.caseId)
      : hrLifecycleKeys.separationWithoutCase(input.staffId, input.lastWorkingDay),
    payload: {
      staffId: input.staffId,
      employeeCode: row.employeeCode,
      ...(row.userId ? { userId: row.userId } : {}),
      ...(input.caseId ? { caseId: input.caseId } : {}),
      lastWorkingDay: input.lastWorkingDay,
      separatedAt: input.separatedAt.toISOString() as IsoDateTime,
    },
  });
  return { eventId: event.id, created: event.created, userId: row.userId };
}

// --- checklist sources --------------------------------------------------------------------------

async function openAssignmentsOf(db: Database, staffId: StaffMemberId) {
  return db
    .select({ id: opsAssetAssignments.id, assetCode: opsAssets.code, assetName: opsAssets.name })
    .from(opsAssetAssignments)
    .innerJoin(opsAssets, eq(opsAssets.id, opsAssetAssignments.assetId))
    .where(and(eq(opsAssetAssignments.staffId, staffId), isNull(opsAssetAssignments.returnedAt)))
    .orderBy(asc(opsAssets.code));
}

/** Open tasks, leads with an open admission, open admissions and active responsibilities held by the employee. */
export async function ownedWorkOf(db: Database, staffId: StaffMemberId): Promise<OwnedWork[]> {
  const tasks = await db
    .select({ id: opsTasks.id, code: opsTasks.code, title: opsTasks.title })
    .from(opsTasks)
    .where(
      and(
        inArray(opsTasks.status, OPEN_TASK),
        or(
          eq(opsTasks.ownerStaffId, staffId),
          eq(opsTasks.accountableStaffId, staffId),
          eq(opsTasks.backupStaffId, staffId),
        ),
      ),
    );
  const admissions = await db
    .select({ id: opsAdmissions.id, code: opsAdmissions.code, leadId: opsAdmissions.leadId })
    .from(opsAdmissions)
    .where(
      and(
        eq(opsAdmissions.counsellorStaffId, staffId),
        notInArray(opsAdmissions.status, CLOSED_ADMISSION),
      ),
    );
  const openLeadIds = (
    await db
      .select({ leadId: opsAdmissions.leadId })
      .from(opsAdmissions)
      .where(notInArray(opsAdmissions.status, CLOSED_ADMISSION))
  ).map((r) => r.leadId);
  const leads = openLeadIds.length
    ? await db
        .select({ id: opsLeads.id, code: opsLeads.code })
        .from(opsLeads)
        .where(
          and(
            eq(opsLeads.ownerStaffId, staffId),
            isNull(opsLeads.mergedIntoLeadId),
            inArray(opsLeads.id, openLeadIds),
          ),
        )
    : [];
  const responsibilities = await db
    .select({
      id: opsResponsibilities.id,
      code: opsResponsibilities.code,
      title: opsResponsibilities.title,
    })
    .from(opsResponsibilities)
    .where(
      and(
        eq(opsResponsibilities.status, 'active'),
        or(
          eq(opsResponsibilities.holderStaffId, staffId),
          eq(opsResponsibilities.backupStaffId, staffId),
        ),
      ),
    );
  return [
    ...tasks.map((t) => ({
      type: 'task' as const,
      id: t.id as string,
      label: `${t.code} ${t.title}`,
    })),
    ...leads.map((l) => ({ type: 'lead' as const, id: l.id as string, label: l.code })),
    ...admissions.map((a) => ({ type: 'admission' as const, id: a.id as string, label: a.code })),
    ...responsibilities.map((r) => ({
      type: 'responsibility' as const,
      id: r.id as string,
      label: `${r.code} ${r.title}`,
    })),
  ];
}

async function generateOffboarding(tx: Database, actor: Actor, c: CaseRow) {
  const employee = await employeeOf(tx, c.staffId);
  const settings = await loadSettings(tx);
  const items = generateOffboardingItems({
    lastWorkingDay: c.lastWorkingDay as IsoDate,
    openAssignments: await openAssignmentsOf(tx, c.staffId),
    ownedWork: await ownedWorkOf(tx, c.staffId),
    config: settings['hr.offboarding_checklist'].value,
  });
  return insertItems(tx, c, items, {
    hr: await staffIdForUser(tx, actor.id),
    manager: employee.managerId,
    employee: c.staffId,
  });
}

// --- open / refresh -----------------------------------------------------------------------------

async function openOffboardingCase(
  db: Database,
  actor: Actor,
  input: Extract<CreateCaseInput, { kind: 'offboarding' }>,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  const dates = checkSeparationDates(input.noticeDate ?? null, input.lastWorkingDay);
  if (!dates.ok)
    throw new ValidationError(dates.message, {
      details: [{ location: 'body', path: ['noticeDate'], message: dates.message }],
    });
  return withTransaction(db, async (tx) => {
    const employee = await employeeOf(tx, input.staffId);
    if (employee.employmentStatus === 'separated')
      throw new ConflictError(`${employee.employeeCode} is already separated.`);
    if (employee.employmentStartDate && input.lastWorkingDay < employee.employmentStartDate)
      throw new ValidationError(
        'The last working day cannot be before the employment start date.',
        {
          details: [
            { location: 'body', path: ['lastWorkingDay'], message: 'Before the start date' },
          ],
        },
      );
    const [live] = await tx
      .select({ code: opsLifecycleCases.code })
      .from(opsLifecycleCases)
      .where(
        and(
          eq(opsLifecycleCases.staffId, employee.staffId),
          eq(opsLifecycleCases.kind, 'offboarding'),
          inArray(opsLifecycleCases.status, ['open', 'approved']),
        ),
      );
    if (live)
      throw new ConflictError(
        `${employee.employeeCode} already has an offboarding case (${live.code}).`,
      );
    const code = await nextCode(tx, 'lifecycleCase', 'ops.lifecycle_cases');
    const row = (
      await tx
        .insert(opsLifecycleCases)
        .values({
          code,
          kind: 'offboarding',
          staffId: employee.staffId,
          separationType: input.separationType,
          noticeDate: input.noticeDate ?? null,
          lastWorkingDay: input.lastWorkingDay,
          separationReason: input.reason?.trim() || null,
          openedBy: actor.id,
        })
        .returning()
    )[0]!;
    const items = await generateOffboarding(tx, actor, row);
    // The separation reason never goes into the audit payload.
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lifecycle_case.opened',
      entityType: 'lifecycle_case',
      entityId: row.id,
      after: {
        code,
        kind: 'offboarding',
        staffId: row.staffId,
        separationType: row.separationType,
        noticeDate: row.noticeDate,
        lastWorkingDay: row.lastWorkingDay,
        hasReason: Boolean(row.separationReason),
        items: items.length,
      },
      requestId,
    });
    await notifyAssignees(tx, row, items, actor.id);
    return row;
  });
}

/** Add checklist items for assets assigned / work taken on since the case was opened (idempotent). */
export async function refreshOffboardingChecklist(
  db: Database,
  actor: Actor,
  caseId: string,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  return withTransaction(db, async (tx) => {
    const c = await lockCase(tx, caseId);
    if (c.kind !== 'offboarding')
      throw new ConflictError('Only offboarding checklists are regenerated.');
    if (c.status !== 'open' && c.status !== 'approved')
      throw new ConflictError(`${c.code} is ${c.status}.`);
    const added = await generateOffboarding(tx, actor, c);
    if (added.length)
      await recordAudit(tx, {
        actorUserId: actor.id,
        module: 'ops',
        action: 'lifecycle_case.checklist_refreshed',
        entityType: 'lifecycle_case',
        entityId: c.id,
        after: { added: added.map((i) => i.itemKey) },
        requestId,
      });
    return { added: added.length };
  });
}

// --- ownership transfer -------------------------------------------------------------------------

/** Staff columns replaced on hand-over, per record type; `backup` is cleared if it would equal `primary`. */
const TRANSFER = {
  task: {
    table: opsTasks,
    fields: ['ownerStaffId', 'accountableStaffId', 'backupStaffId'],
    backup: ['backupStaffId', 'ownerStaffId'],
  },
  lead: { table: opsLeads, fields: ['ownerStaffId'] },
  admission: { table: opsAdmissions, fields: ['counsellorStaffId'] },
  responsibility: {
    table: opsResponsibilities,
    fields: ['holderStaffId', 'backupStaffId'],
    backup: ['backupStaffId', 'holderStaffId'],
  },
} as const satisfies Record<
  TransferEntityType,
  { table: unknown; fields: readonly string[]; backup?: readonly [string, string] }
>;

/**
 * Hand one record over to `targetStaffId`: every staff column on it that points
 * at the leaving employee becomes the target. Audited on the record and the
 * case; completes the checklist item.
 */
export async function transferOwnership(
  db: Database,
  actor: Actor,
  caseId: string,
  itemId: string,
  targetStaffId: string,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  const target = await activeStaff(db, targetStaffId, 'targetStaffId');
  return withTransaction(db, async (tx) => {
    const c = await lockCase(tx, caseId);
    if (c.status !== 'open' && c.status !== 'approved')
      throw new ConflictError(`${c.code} is ${c.status}.`);
    if (target.id === c.staffId)
      throw new ValidationError('Choose someone other than the leaving employee.');
    const [item] = await tx
      .select()
      .from(opsLifecycleItems)
      .where(
        and(eq(opsLifecycleItems.id, itemId as ItemRow['id']), eq(opsLifecycleItems.caseId, c.id)),
      )
      .for('update');
    if (!item?.transferEntityType || !item.transferEntityId)
      throw new ValidationError('This item is not an ownership transfer.');
    if (isResolved(item.status as ItemStatus))
      throw new ConflictError('This hand-over is already resolved.');
    const type = item.transferEntityType as TransferEntityType;
    const spec: {
      table: typeof opsTasks;
      fields: readonly string[];
      backup?: readonly [string, string];
    } = TRANSFER[type] as never;
    const [row] = (await tx
      .select()
      .from(spec.table)
      .where(eq(spec.table.id, item.transferEntityId as never))
      .for('update')) as Record<string, unknown>[];
    if (!row) throw new ConflictError(`The ${type} no longer exists.`);
    const before = Object.fromEntries(spec.fields.map((f) => [f, row[f]]));
    const after = Object.fromEntries(
      spec.fields.map((f) => [f, row[f] === c.staffId ? target.id : row[f]]),
    );
    if (spec.backup && after[spec.backup[0]] && after[spec.backup[0]] === after[spec.backup[1]])
      after[spec.backup[0]] = null;
    await tx
      .update(spec.table)
      .set(after)
      .where(eq(spec.table.id, row.id as never));
    const meta = { reason: 'offboarding', caseId: c.id };
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `${type}.reassigned`,
      entityType: type,
      entityId: item.transferEntityId,
      before,
      after,
      requestId,
      metadata: meta,
    });
    const [done] = await tx
      .update(opsLifecycleItems)
      .set({
        status: 'done',
        transferTargetStaffId: target.id,
        evidence: `Handed over to ${target.fullName}`,
        completedAt: new Date(),
        completedBy: actor.id,
      })
      .where(eq(opsLifecycleItems.id, item.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lifecycle_item.transferred',
      entityType: 'lifecycle_case',
      entityId: c.id,
      after: {
        itemId: item.id,
        entityType: type,
        entityId: item.transferEntityId,
        targetStaffId: target.id,
      },
      requestId,
    });
    const recipients = (await userIdsForStaff(tx, [target.id])).filter((u) => u !== actor.id);
    if (recipients.length)
      await notify(tx, {
        userIds: recipients,
        module: 'ops',
        kind: 'lifecycle.ownership_transferred',
        title: `Handed over to you: ${item.title.replace(/^Hand over /, '')}`,
        link: CASE_LINK(c),
        entityType: 'lifecycle_case',
        entityId: c.id,
      });
    return done as ItemRow;
  });
}

// --- system-completed items ---------------------------------------------------------------------

/**
 * Complete items the system owns: asset returns from ops.asset_assignments
 * (returned_at set) and the access revocation from the platform delivery of
 * the separation event (processed → done with the platform's audit result;
 * dead → blocked with the error). Runs in the caller's transaction.
 */
export async function syncCaseSystemItems(tx: Database, c: CaseRow): Promise<number> {
  if (c.kind !== 'offboarding') return 0;
  const items = await caseItems(tx, c.id);
  let changed = 0;
  const assetItems = items.filter(
    (i) => i.kind === 'asset_return' && i.assetAssignmentId && !isResolved(i.status as ItemStatus),
  );
  if (assetItems.length) {
    const assignments = await tx
      .select()
      .from(opsAssetAssignments)
      .where(
        inArray(
          opsAssetAssignments.id,
          assetItems.map((i) => i.assetAssignmentId!),
        ),
      );
    for (const i of assetItems) {
      const a = assignments.find((x) => x.id === i.assetAssignmentId);
      if (!a?.returnedAt) continue;
      await tx
        .update(opsLifecycleItems)
        .set({
          status: 'done',
          completedAt: a.returnedAt,
          completedBy: a.returnedBy,
          evidence: `Returned ${a.returnedAt.toISOString().slice(0, 10)} (asset register)${a.conditionOnReturn ? `; condition: ${a.conditionOnReturn}` : ''}`,
        })
        .where(eq(opsLifecycleItems.id, i.id));
      await recordAudit(tx, {
        actorType: 'system',
        module: 'ops',
        action: 'lifecycle_item.auto_completed',
        entityType: 'lifecycle_case',
        entityId: c.id,
        after: { itemId: i.id, kind: 'asset_return', assignmentId: a.id },
      });
      changed += 1;
    }
  }
  const access = items.find(
    (i) => i.kind === 'access_revocation' && i.status !== 'done' && i.status !== 'not_applicable',
  );
  if (access && c.separationEventId) {
    const [delivery] = await tx
      .select()
      .from(eventDeliveries)
      .where(
        and(
          eq(eventDeliveries.eventId, c.separationEventId),
          eq(eventDeliveries.consumer, PLATFORM_ACCESS_REVOCATION_CONSUMER),
        ),
      );
    if (delivery?.status === 'processed') {
      const [result] = await tx
        .select({ metadata: auditEvents.metadata, at: auditEvents.at })
        .from(auditEvents)
        .where(
          and(eq(auditEvents.module, 'platform'), eq(auditEvents.action, 'user.access_revoked')),
        )
        .orderBy(asc(auditEvents.at))
        .then((rows) =>
          rows.filter(
            (r) => (r.metadata as { eventId?: string } | null)?.eventId === c.separationEventId,
          ),
        );
      const meta = (result?.metadata ?? {}) as {
        sessionsDeleted?: number;
        alreadyDisabled?: boolean;
      };
      const evidence = result
        ? `Platform disabled the login${meta.alreadyDisabled ? ' (it was already disabled)' : ''} and deleted ${meta.sessionsDeleted ?? 0} session(s) on ${(result.at ?? delivery.processedAt)?.toISOString()}.`
        : `Platform processed the separation event on ${delivery.processedAt?.toISOString() ?? 'an unknown time'}.`;
      await tx
        .update(opsLifecycleItems)
        .set({
          status: 'done',
          completedAt: delivery.processedAt ?? new Date(),
          completedBy: null,
          evidence,
        })
        .where(eq(opsLifecycleItems.id, access.id));
      await recordAudit(tx, {
        actorType: 'system',
        module: 'ops',
        action: 'lifecycle_item.auto_completed',
        entityType: 'lifecycle_case',
        entityId: c.id,
        after: { itemId: access.id, kind: 'access_revocation', eventId: c.separationEventId },
      });
      changed += 1;
    } else if (delivery?.status === 'dead' && access.status !== 'blocked') {
      await tx
        .update(opsLifecycleItems)
        .set({
          status: 'blocked',
          notes: `Platform could not revoke access: ${delivery.lastError ?? 'unknown error'}`,
        })
        .where(eq(opsLifecycleItems.id, access.id));
      changed += 1;
    }
  }
  return changed;
}

// --- approval and separation --------------------------------------------------------------------

async function applySeparation(tx: Database, c: CaseRow, now: Date, requestId?: string) {
  const lwd = c.lastWorkingDay as IsoDate;
  // The job applies the approver's decision; the HR helper records them as the changer.
  const onBehalfOf: Actor = { id: c.approvedBy as UserId, roles: [] };
  const employee = await employeeOf(tx, c.staffId);
  if (employee.employmentStatus !== 'separated')
    await changeEmploymentStatus(
      tx,
      onBehalfOf,
      c.staffId,
      'separated',
      {
        reason: `Separation ${c.code} (last working day ${lwd})`,
        effectiveOn: addDays(lwd, 1),
        endDate: lwd,
      },
      requestId,
    );
  if (employee.staffStatus !== 'inactive') {
    await tx.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.id, c.staffId));
    await recordAudit(tx, {
      actorType: 'system',
      module: 'ops',
      action: 'staff.deactivated',
      entityType: 'staff_member',
      entityId: c.staffId,
      before: { status: employee.staffStatus },
      after: { status: 'inactive' },
      requestId,
      metadata: { caseId: c.id },
    });
  }
  const event = await publishSeparation(tx, {
    staffId: c.staffId,
    lastWorkingDay: lwd,
    separatedAt: now,
    caseId: c.id,
  });
  const [after] = await tx
    .update(opsLifecycleCases)
    .set({
      status: 'completed',
      separatedAt: now,
      completedAt: now,
      separationEventId: event.eventId,
    })
    .where(eq(opsLifecycleCases.id, c.id))
    .returning();
  if (!event.userId)
    await tx
      .update(opsLifecycleItems)
      .set({
        status: 'done',
        completedAt: now,
        evidence: 'No login account was linked; nothing to revoke.',
      })
      .where(
        and(eq(opsLifecycleItems.caseId, c.id), eq(opsLifecycleItems.kind, 'access_revocation')),
      );
  await recordAudit(tx, {
    actorType: 'system',
    module: 'ops',
    action: 'lifecycle_case.separation_applied',
    entityType: 'lifecycle_case',
    entityId: c.id,
    after: {
      status: 'completed',
      lastWorkingDay: lwd,
      eventId: event.eventId,
      eventCreated: event.created,
    },
    requestId,
  });
  return after as CaseRow;
}

async function approveOffboarding(
  tx: Database,
  actor: Actor,
  c: CaseRow,
  comment: string | null,
  requestId?: string,
) {
  const items = await caseItems(tx, c.id);
  const gaps = completionGaps(
    'offboarding',
    items.map((i) => ({ ...i, kind: i.kind as ItemKind, status: i.status as ItemStatus })),
  );
  if (gaps.length)
    throw new ConflictError('Required checklist items are still open.', {
      details: { missing: gaps },
    });
  const now = new Date();
  const [approved] = await tx
    .update(opsLifecycleCases)
    .set({ status: 'approved', approvedBy: actor.id, approvedAt: now, approvalComment: comment })
    .where(eq(opsLifecycleCases.id, c.id))
    .returning();
  const employee = await employeeOf(tx, c.staffId);
  if (employee.employmentStatus === 'active')
    await changeEmploymentStatus(
      tx,
      actor,
      c.staffId,
      'on_notice',
      { reason: `Separation ${c.code} approved` },
      requestId,
    );
  await recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'lifecycle_case.approved',
    entityType: 'lifecycle_case',
    entityId: c.id,
    before: { status: c.status },
    after: { status: 'approved', lastWorkingDay: c.lastWorkingDay },
    requestId,
  });
  const today = istToday(now);
  if (separationDue(c.lastWorkingDay as IsoDate, today))
    return applySeparation(tx, approved as CaseRow, now, requestId);
  return approved as CaseRow;
}

/** POST …/lifecycle-cases/{id}/approve — final approval of either kind. */
export async function approveLifecycleCase(
  db: Database,
  actor: Actor,
  id: string,
  comment: string | null | undefined,
  requestId?: string,
) {
  const pre = await getCaseRow(db, id);
  await assertCanApprove(db, actor, pre);
  return withTransaction(db, async (tx) => {
    const c = await lockCase(tx, id);
    if (c.status !== 'open')
      throw new ConflictError(`${c.code} is ${c.status}; only open cases can be approved.`);
    await syncCaseSystemItems(tx, c);
    return c.kind === 'onboarding'
      ? approveOnboarding(tx, actor, c, comment?.trim() || null, requestId)
      : approveOffboarding(tx, actor, c, comment?.trim() || null, requestId);
  });
}

/**
 * Job `separations`: apply every approved offboarding case whose last working
 * day is before `today` (IST), each in its own transaction; then complete
 * access-revocation items whose platform delivery has been processed.
 * Idempotent: applied cases are `completed`, and the event key is per case.
 */
export async function runSeparations(db: Database, today: IsoDate = istToday(new Date())) {
  const due = await db
    .select({ id: opsLifecycleCases.id })
    .from(opsLifecycleCases)
    .where(
      and(
        eq(opsLifecycleCases.kind, 'offboarding'),
        eq(opsLifecycleCases.status, 'approved'),
        lt(opsLifecycleCases.lastWorkingDay, today),
      ),
    );
  let applied = 0;
  for (const { id } of due) {
    const done = await withTransaction(db, async (tx) => {
      const c = await lockCase(tx, id);
      if (c.status !== 'approved' || !separationDue(c.lastWorkingDay as IsoDate, today))
        return false;
      await applySeparation(tx, c, new Date());
      return true;
    });
    if (done) applied += 1;
  }
  const pending = await db
    .select({ caseId: opsLifecycleItems.caseId })
    .from(opsLifecycleItems)
    .innerJoin(opsLifecycleCases, eq(opsLifecycleCases.id, opsLifecycleItems.caseId))
    .where(
      and(
        eq(opsLifecycleItems.kind, 'access_revocation'),
        inArray(opsLifecycleItems.status, ['pending', 'blocked']),
        eq(opsLifecycleCases.status, 'completed'),
      ),
    );
  let synced = 0;
  for (const { caseId } of pending)
    synced += await withTransaction(db, async (tx) =>
      syncCaseSystemItems(tx, await lockCase(tx, caseId)),
    );
  return { today, applied, accessItemsCompleted: synced };
}

// --- create / cancel ----------------------------------------------------------------------------

export async function createLifecycleCase(
  db: Database,
  actor: Actor,
  input: CreateCaseInput,
  requestId?: string,
) {
  return input.kind === 'onboarding'
    ? createOnboardingCase(db, actor, input.staffId, requestId)
    : openOffboardingCase(db, actor, input, requestId);
}

/**
 * Cancel an open case (lifecycle manager), or retract an approved separation
 * before it is applied (approver only; on_notice → active).
 */
export async function cancelLifecycleCase(
  db: Database,
  actor: Actor,
  id: string,
  reason: string,
  requestId?: string,
) {
  await lifecycleManager(db, actor);
  return withTransaction(db, async (tx) => {
    const c = await lockCase(tx, id);
    if (c.status === 'completed' || c.status === 'cancelled')
      throw new ConflictError(`${c.code} is ${c.status}.`);
    if (c.status === 'approved') {
      if (!can(actor, 'ops:lifecycle:approve'))
        throw new ForbiddenError('Only a lifecycle approver can retract an approved separation.');
      const employee = await employeeOf(tx, c.staffId);
      if (employee.employmentStatus === 'on_notice')
        await changeEmploymentStatus(
          tx,
          actor,
          c.staffId,
          'active',
          { reason: `Separation ${c.code} retracted: ${reason}` },
          requestId,
        );
    }
    const [after] = await tx
      .update(opsLifecycleCases)
      .set({ status: 'cancelled', statusReason: reason })
      .where(eq(opsLifecycleCases.id, c.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lifecycle_case.cancelled',
      entityType: 'lifecycle_case',
      entityId: c.id,
      before: { status: c.status },
      after: { status: 'cancelled' },
      requestId,
    });
    return after as CaseRow;
  });
}

// --- detail -------------------------------------------------------------------------------------

export async function getLifecycleCase(db: Database, actor: Actor, id: string) {
  const scope = await hrScope(db, actor, 'ops:lifecycle:read');
  let c = await getCaseRow(db, id);
  assertHrScope(scope, c.staffId, 'this case');
  if (c.kind === 'offboarding' && c.status !== 'cancelled') {
    const changed = await withTransaction(db, async (tx) =>
      syncCaseSystemItems(tx, await lockCase(tx, id)),
    );
    if (changed) c = await getCaseRow(db, id);
  }
  const employee = await employeeOf(db, c.staffId);
  const items = await caseItems(db, c.id);
  const staffIds = [
    ...items.map((i) => i.assigneeStaffId),
    ...items.map((i) => i.transferTargetStaffId),
    employee.managerId,
  ];
  const names = await staffNames(db, staffIds);
  const uNames = await userNames(db, [
    c.openedBy,
    c.approvedBy,
    ...items.map((i) => i.completedBy),
  ]);
  let delivery: {
    status: string;
    attempts: number;
    lastError: string | null;
    processedAt: Date | null;
  } | null = null;
  if (c.separationEventId) {
    const [d] = await db
      .select({
        status: eventDeliveries.status,
        attempts: eventDeliveries.attempts,
        lastError: eventDeliveries.lastError,
        processedAt: eventDeliveries.processedAt,
      })
      .from(eventDeliveries)
      .where(
        and(
          eq(eventDeliveries.eventId, c.separationEventId),
          eq(eventDeliveries.consumer, PLATFORM_ACCESS_REVOCATION_CONSUMER),
        ),
      );
    delivery = d ?? null;
  }
  const today = istToday(new Date());
  const typed = items.map((i) => ({
    ...i,
    kind: i.kind as ItemKind,
    status: i.status as ItemStatus,
  }));
  const kind = c.kind as LifecycleKind;
  const myStaff = scope.staffId;
  const canManage = scopeFor(actor, 'ops:lifecycle:manage') === 'all';
  const isSelf = Boolean(myStaff) && myStaff === c.staffId;
  return {
    case: {
      id: c.id,
      code: c.code,
      kind,
      status: c.status,
      statusReason: c.statusReason,
      staffId: c.staffId,
      applicationId: c.applicationId,
      separationType: c.separationType as SeparationType | null,
      noticeDate: c.noticeDate,
      lastWorkingDay: c.lastWorkingDay,
      /** null when hidden from this user; `reasonHidden` says which. */
      separationReason: canSeeSeparationReason(actor) ? c.separationReason : null,
      reasonHidden: !canSeeSeparationReason(actor) && Boolean(c.separationReason),
      settlementReference: canManage ? c.settlementReference : null,
      openedByName: uNames.get(c.openedBy) ?? null,
      approvedByName: c.approvedBy ? (uNames.get(c.approvedBy) ?? null) : null,
      approvedAt: c.approvedAt,
      approvalComment: c.approvalComment,
      separatedAt: c.separatedAt,
      completedAt: c.completedAt,
      createdAt: c.createdAt,
    },
    employee: {
      staffId: employee.staffId,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      employmentStatus: employee.employmentStatus,
      employmentStartDate: employee.employmentStartDate,
      managerName: employee.managerId ? (names.get(employee.managerId) ?? null) : null,
      hasLogin: Boolean(employee.userId),
    },
    items: typed.map((i) => ({
      id: i.id,
      itemKey: i.itemKey,
      kind: i.kind,
      kindLabel: ITEM_KIND_LABELS[i.kind],
      title: i.title,
      required: i.required,
      status: i.status,
      assigneeStaffId: i.assigneeStaffId,
      assigneeName: i.assigneeStaffId ? (names.get(i.assigneeStaffId) ?? null) : null,
      dueDate: i.dueDate,
      overdue:
        c.status === 'open' || c.status === 'approved'
          ? isItemOverdue({ status: i.status, dueDate: i.dueDate as IsoDate | null }, today)
          : false,
      evidence: i.evidence,
      notes: i.notes,
      transferEntityType: i.transferEntityType,
      transferTargetName: i.transferTargetStaffId
        ? (names.get(i.transferTargetStaffId) ?? null)
        : null,
      completedByName: i.completedBy
        ? (uNames.get(i.completedBy) ?? null)
        : i.completedAt
          ? 'System'
          : null,
      completedAt: i.completedAt,
      systemCompleted: i.kind === 'asset_return' || i.kind === 'access_revocation',
    })),
    gaps: completionGaps(kind, typed),
    accessRevocation: c.separationEventId ? { eventId: c.separationEventId, delivery } : null,
    canManage: canManage && (c.status === 'open' || c.status === 'approved'),
    canApprove: can(actor, 'ops:lifecycle:approve') && !isSelf && c.status === 'open',
    isSelf,
    canRetract: can(actor, 'ops:lifecycle:approve') && canManage && c.status === 'approved',
    history: await entityHistory(db, 'lifecycle_case', c.id),
  };
}

export { CASE_LINK };
