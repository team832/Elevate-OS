/**
 * Work assets (OPS-038) — `ops:assets:*`. Register (AST-#####), assign to an
 * employee, record the return with its condition; history per asset and per
 * employee. One open assignment per asset (rule + unique index). `own` scope
 * (employees, department managers) sees only assets assigned — now or before —
 * to staff in their HR scope.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  opsAssetAssignments,
  opsAssets,
  opsEmployeeRecords,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday } from '../../domain/dates';
import {
  checkAssetStatusChange,
  checkAssignment,
  statusAfterReturn,
  type AssetStatus,
} from '../../domain/hr/assets';
import { pageWindow } from '../../domain/hr/employees';
import { nextCode, userIdsForStaff, type Actor } from '../context';
import { assertHrScope, hrCovers, hrScope, hrScopeIds } from '../hr-scope';
import { opsAudit, rowById } from '../ops-common';
import { likePattern } from './access';
import type {
  assetListQuery,
  assignAssetBody,
  createAssetBody,
  returnAssetBody,
  updateAssetBody,
} from './schemas';

const audit = opsAudit('asset');

type AssetId = typeof opsAssets.$inferSelect.id;

const openAssignmentOf = (assetId: AssetId | typeof opsAssets.id) =>
  and(eq(opsAssetAssignments.assetId, assetId), isNull(opsAssetAssignments.returnedAt));

async function manageAll(db: Database, actor: Actor) {
  const scope = await hrScope(db, actor, 'ops:assets:manage');
  if (scope.scope !== 'all')
    throw new ForbiddenError('Managing assets needs access to all assets.');
  return scope;
}

/** Asset register with current holder; search, status/category filter, pagination. */
export async function listAssets(
  db: Database,
  actor: Actor,
  query: z.output<typeof assetListQuery>,
) {
  const scope = await hrScope(db, actor, 'ops:assets:read');
  const ids = hrScopeIds(scope);
  const where: SQL[] = [];
  if (ids) {
    const visible = ids.length
      ? db
          .selectDistinct({ assetId: opsAssetAssignments.assetId })
          .from(opsAssetAssignments)
          .where(inArray(opsAssetAssignments.staffId, ids))
      : null;
    where.push(visible ? inArray(opsAssets.id, visible) : sql`false`);
  }
  if (query.q) {
    const like = likePattern(query.q);
    where.push(
      or(
        ilike(opsAssets.code, like),
        ilike(opsAssets.name, like),
        ilike(opsAssets.serialNumber, like),
      )!,
    );
  }
  if (query.status) where.push(eq(opsAssets.status, query.status));
  if (query.category) where.push(eq(opsAssets.category, query.category));
  const cond = where.length ? and(...where) : undefined;
  const { page, pageSize, offset } = pageWindow(query.page, query.pageSize);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        asset: opsAssets,
        holderStaffId: opsAssetAssignments.staffId,
        holderName: staffMembers.fullName,
        assignedOn: opsAssetAssignments.assignedOn,
        expectedReturnOn: opsAssetAssignments.expectedReturnOn,
      })
      .from(opsAssets)
      .leftJoin(opsAssetAssignments, openAssignmentOf(opsAssets.id))
      .leftJoin(staffMembers, eq(staffMembers.id, opsAssetAssignments.staffId))
      .where(cond)
      .orderBy(asc(opsAssets.code))
      .limit(pageSize)
      .offset(offset),
    db.select({ n: count() }).from(opsAssets).where(cond),
  ]);
  const categories = await db
    .selectDistinct({ category: opsAssets.category })
    .from(opsAssets)
    .orderBy(asc(opsAssets.category));
  const today = istToday(new Date());
  return {
    items: rows.map((r) => {
      const holderVisible = r.holderStaffId ? hrCovers(scope, r.holderStaffId) : false;
      return {
        ...r.asset,
        holder:
          r.holderStaffId && holderVisible
            ? { staffId: r.holderStaffId, fullName: r.holderName }
            : null,
        assignedOn: holderVisible ? r.assignedOn : null,
        expectedReturnOn: holderVisible ? r.expectedReturnOn : null,
        returnOverdue: Boolean(holderVisible && r.expectedReturnOn && r.expectedReturnOn < today),
      };
    }),
    total: total?.n ?? 0,
    page,
    pageSize,
    categories: ids ? [] : categories.map((c) => c.category),
  };
}

const assetRow = (db: Database, id: string, lock = false) =>
  rowById(db, opsAssets, id, 'Asset', lock);

async function assignmentHistory(db: Database, where: SQL) {
  return db
    .select({
      id: opsAssetAssignments.id,
      assetId: opsAssetAssignments.assetId,
      assetCode: opsAssets.code,
      assetName: opsAssets.name,
      staffId: opsAssetAssignments.staffId,
      staffName: staffMembers.fullName,
      assignedOn: opsAssetAssignments.assignedOn,
      expectedReturnOn: opsAssetAssignments.expectedReturnOn,
      returnedAt: opsAssetAssignments.returnedAt,
      conditionOnReturn: opsAssetAssignments.conditionOnReturn,
      notes: opsAssetAssignments.notes,
    })
    .from(opsAssetAssignments)
    .innerJoin(opsAssets, eq(opsAssets.id, opsAssetAssignments.assetId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsAssetAssignments.staffId))
    .where(where)
    .orderBy(desc(opsAssetAssignments.assignedOn), desc(opsAssetAssignments.createdAt));
}

/** One asset with its full assignment history (own scope: only if it was assigned to someone in scope). */
export async function getAsset(db: Database, actor: Actor, id: string) {
  const scope = await hrScope(db, actor, 'ops:assets:read');
  const asset = await assetRow(db, id);
  const history = await assignmentHistory(db, eq(opsAssetAssignments.assetId, asset.id));
  if (scope.scope === 'own' && !history.some((h) => hrCovers(scope, h.staffId)))
    throw new ForbiddenError('You cannot see this asset.');
  const visible = history.filter((h) => hrCovers(scope, h.staffId));
  return {
    asset,
    history: visible,
    hiddenAssignments: history.length - visible.length,
    open: visible.find((h) => h.returnedAt === null) ?? null,
  };
}

/** Assets assigned to one employee, current and past. */
export async function listAssetsForEmployee(db: Database, actor: Actor, staffId: string) {
  const scope = await hrScope(db, actor, 'ops:assets:read');
  assertHrScope(scope, staffId, 'this employee’s assets');
  return assignmentHistory(db, eq(opsAssetAssignments.staffId, staffId as StaffMemberId));
}

export async function createAsset(
  db: Database,
  actor: Actor,
  input: z.output<typeof createAssetBody>,
  requestId?: string,
) {
  await manageAll(db, actor);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'asset', 'ops.assets');
    const [row] = await tx
      .insert(opsAssets)
      .values({
        code,
        name: input.name,
        category: input.category,
        serialNumber: input.serialNumber?.trim() || null,
        notes: input.notes ?? null,
      })
      .returning();
    await audit(tx, actor, row!.id, 'asset.registered', { after: row }, requestId);
    return row!;
  });
}

export async function updateAsset(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateAssetBody>,
  requestId?: string,
) {
  await manageAll(db, actor);
  return withTransaction(db, async (tx) => {
    const before = await assetRow(tx, id, true);
    if (input.status && input.status !== before.status) {
      const check = checkAssetStatusChange(before.status, input.status);
      if (!check.ok) throw new InvalidStateTransitionError(check.message);
    }
    const patch = Object.fromEntries(
      Object.entries(input).filter(
        ([k, v]) => v !== undefined && !(k === 'status' && v === before.status),
      ),
    );
    if (Object.keys(patch).length === 0) return before;
    const [after] = await tx
      .update(opsAssets)
      .set(patch)
      .where(eq(opsAssets.id, before.id))
      .returning();
    await audit(tx, actor, before.id, 'asset.updated', { before, after }, requestId);
    return after!;
  });
}

export async function assignAsset(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof assignAssetBody>,
  requestId?: string,
) {
  await manageAll(db, actor);
  const assignedOn = input.assignedOn ?? istToday(new Date());
  return withTransaction(db, async (tx) => {
    const asset = await assetRow(tx, id, true);
    const [open] = await tx
      .select({ id: opsAssetAssignments.id })
      .from(opsAssetAssignments)
      .where(openAssignmentOf(asset.id));
    const [emp] = await tx
      .select({ status: opsEmployeeRecords.employmentStatus, staffStatus: staffMembers.status })
      .from(staffMembers)
      .leftJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, staffMembers.id))
      .where(eq(staffMembers.id, input.staffId as StaffMemberId));
    if (!emp) throw new NotFoundError('Employee not found.');
    const check = checkAssignment({
      assetStatus: asset.status,
      hasOpenAssignment: Boolean(open),
      employeeStatus: emp.status,
      staffStatus: emp.staffStatus,
      assignedOn,
      expectedReturnOn: input.expectedReturnOn ?? null,
    });
    if (!check.ok) throw new ConflictError(check.message);
    const [row] = await tx
      .insert(opsAssetAssignments)
      .values({
        assetId: asset.id,
        staffId: input.staffId as StaffMemberId,
        assignedOn,
        expectedReturnOn: input.expectedReturnOn ?? null,
        notes: input.notes ?? null,
        assignedBy: actor.id,
      })
      .returning();
    await tx.update(opsAssets).set({ status: 'assigned' }).where(eq(opsAssets.id, asset.id));
    await audit(
      tx,
      actor,
      asset.id,
      'asset.assigned',
      {
        before: { status: asset.status },
        after: { status: 'assigned', staffId: input.staffId, assignedOn },
      },
      requestId,
    );
    await notify(tx, {
      userIds: await userIdsForStaff(tx, [input.staffId]),
      module: 'ops',
      kind: 'hr.asset_assigned',
      title: `${asset.code} ${asset.name} assigned to you`,
      link: `/ops/operations/assets/${asset.id}`,
    });
    return row!;
  });
}

export async function returnAsset(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof returnAssetBody>,
  requestId?: string,
) {
  await manageAll(db, actor);
  return withTransaction(db, async (tx) => {
    const asset = await assetRow(tx, id, true);
    const [open] = await tx
      .select()
      .from(opsAssetAssignments)
      .where(openAssignmentOf(asset.id))
      .for('update');
    if (!open) throw new InvalidStateTransitionError('The asset is not assigned to anyone.');
    const status: AssetStatus = statusAfterReturn(input.condition);
    const [row] = await tx
      .update(opsAssetAssignments)
      .set({
        returnedAt: new Date(),
        returnedBy: actor.id,
        conditionOnReturn: input.condition,
        notes: input.notes
          ? [open.notes, `Return: ${input.notes}`].filter(Boolean).join(' · ')
          : open.notes,
      })
      .where(eq(opsAssetAssignments.id, open.id))
      .returning();
    await tx.update(opsAssets).set({ status }).where(eq(opsAssets.id, asset.id));
    await audit(
      tx,
      actor,
      asset.id,
      'asset.returned',
      {
        before: { status: asset.status, staffId: open.staffId },
        after: { status, condition: input.condition },
      },
      requestId,
    );
    return row!;
  });
}
