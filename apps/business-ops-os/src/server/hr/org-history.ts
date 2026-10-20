/**
 * Organisation structure and history (OPS-032, OPS-033): departments with their
 * heads (succession kept), the reporting hierarchy (org chart) and the append-only
 * employment history written by the employee services. Reporting lines are
 * validated with `checkReportingLine` (organisation.ts → assertManager).
 */
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import {
  departments,
  opsDepartmentHeads,
  opsEmployeeRecords,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../../domain/dates';
import { buildOrgTree, flattenOrgTree, planHeadSuccession } from '../../domain/hr/org';
import type { z } from 'zod';
import { accessScope, activeStaff, type Actor } from '../context';
import { opsAudit, rowById } from '../ops-common';
import type { assignHeadBody, endHeadBody } from './schemas';

const audit = opsAudit('department');

const currentHead = (tx: Database, departmentId: string) =>
  tx
    .select()
    .from(opsDepartmentHeads)
    .where(
      and(
        eq(opsDepartmentHeads.departmentId, departmentId as DepartmentId),
        isNull(opsDepartmentHeads.endsOn),
      ),
    )
    .for('update');

/** Departments with current head, head history and headcount. */
export async function listDepartmentsWithHeads(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:organisation:read');
  const [depts, heads, staff] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)),
    db
      .select({
        id: opsDepartmentHeads.id,
        departmentId: opsDepartmentHeads.departmentId,
        staffId: opsDepartmentHeads.staffId,
        fullName: staffMembers.fullName,
        startsOn: opsDepartmentHeads.startsOn,
        endsOn: opsDepartmentHeads.endsOn,
        reason: opsDepartmentHeads.reason,
      })
      .from(opsDepartmentHeads)
      .innerJoin(staffMembers, eq(staffMembers.id, opsDepartmentHeads.staffId))
      .orderBy(desc(opsDepartmentHeads.startsOn)),
    db
      .select({ departmentId: staffMembers.departmentId, status: staffMembers.status })
      .from(staffMembers),
  ]);
  return depts.map((d) => {
    const history = heads.filter((h) => h.departmentId === d.id);
    return {
      ...d,
      headcount: staff.filter((s) => s.departmentId === d.id && s.status !== 'inactive').length,
      currentHead: history.find((h) => h.endsOn === null) ?? null,
      headHistory: history,
    };
  });
}

/** Appoint a department head from `startsOn`; the current head's tenure ends the day before. */
export async function assignDepartmentHead(
  db: Database,
  actor: Actor,
  departmentId: string,
  input: z.output<typeof assignHeadBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  const startsOn = input.startsOn ?? istToday(new Date());
  return withTransaction(db, async (tx) => {
    const dept = await rowById(tx, departments, departmentId, 'Department', true);
    if (dept.status === 'archived') throw new ConflictError('The department is archived.');
    await activeStaff(tx, input.staffId, 'staffId');
    const [current] = await currentHead(tx, dept.id);
    const plan = planHeadSuccession(current ?? null, { staffId: input.staffId, startsOn });
    if (!plan.ok) throw new ConflictError(plan.message);
    if (current && plan.endCurrentOn)
      await tx
        .update(opsDepartmentHeads)
        .set({ endsOn: plan.endCurrentOn, endedBy: actor.id })
        .where(eq(opsDepartmentHeads.id, current.id));
    const [row] = await tx
      .insert(opsDepartmentHeads)
      .values({
        departmentId: dept.id,
        staffId: input.staffId as StaffMemberId,
        startsOn,
        reason: input.reason ?? null,
        assignedBy: actor.id,
      })
      .returning();
    await audit(
      tx,
      actor,
      dept.id,
      'department.head_assigned',
      {
        before: current ? { headStaffId: current.staffId, startsOn: current.startsOn } : null,
        after: { headStaffId: input.staffId, startsOn, previousEndsOn: plan.endCurrentOn },
      },
      requestId,
    );
    return row;
  });
}

/** End the current head's tenure without a successor. */
export async function endDepartmentHead(
  db: Database,
  actor: Actor,
  departmentId: string,
  input: z.output<typeof endHeadBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:organisation:manage');
  const endsOn = input.endsOn ?? istToday(new Date());
  return withTransaction(db, async (tx) => {
    const [current] = await currentHead(tx, departmentId);
    if (!current) throw new NotFoundError('The department has no current head.');
    if (endsOn < current.startsOn)
      throw new ValidationError('The end date is before the head’s start date.', {
        details: [{ location: 'body', path: ['endsOn'], message: 'Before start date' }],
      });
    const [row] = await tx
      .update(opsDepartmentHeads)
      .set({
        endsOn,
        endedBy: actor.id,
        reason: current.reason
          ? `${current.reason} · Ended: ${input.reason}`
          : `Ended: ${input.reason}`,
      })
      .where(eq(opsDepartmentHeads.id, current.id))
      .returning();
    const audited = {
      before: { headStaffId: current.staffId, endsOn: null },
      after: { headStaffId: current.staffId, endsOn },
    };
    await audit(tx, actor, current.departmentId, 'department.head_ended', audited, requestId);
    return row;
  });
}

/** Org chart: the reporting hierarchy of active / on-leave staff (loops shown, never hidden). */
export async function getOrgChart(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:organisation:read');
  const rows = await db
    .select({
      id: staffMembers.id,
      fullName: staffMembers.fullName,
      managerId: staffMembers.managerId,
      title: staffMembers.title,
      departmentName: departments.name,
      status: staffMembers.status,
      employeeCode: opsEmployeeRecords.employeeCode,
    })
    .from(staffMembers)
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .leftJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, staffMembers.id))
    .where(ne(staffMembers.status, 'inactive'))
    .orderBy(asc(staffMembers.fullName));
  const codes = new Map(rows.map((r) => [r.id as string, r.employeeCode]));
  const tree = buildOrgTree(rows.map((r) => ({ ...r, id: r.id as string })));
  return flattenOrgTree(tree).map(({ node, depth }) => ({
    id: node.id,
    fullName: node.fullName,
    title: node.title,
    departmentName: node.departmentName,
    status: node.status,
    employeeCode: codes.get(node.id) ?? null,
    depth,
    directReports: node.reports.length,
    detached: node.detached,
  }));
}
