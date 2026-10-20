/**
 * Operational exceptions and incidents. Fee-type exceptions (refund, waiver,
 * special fee, extension) are flagged "needs authorised approval"; the authority
 * limits are an open owner decision (BR-OPS-15, OD-013), so no approval route is
 * hard-coded yet.
 */
import { desc, eq } from 'drizzle-orm';
import { opsIncidents, opsSops, staffMembers, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  checkIncidentTransition,
  incidentNeedsAuthorisedApproval,
  incidentSla,
  type IncidentStatus,
} from '../domain';
import { accessScope, activeStaff, nextCode, type Actor } from './context';
import { opsAudit, rowById } from './ops-common';
import type { incidentBody, incidentUpdateBody } from './schemas';
import { loadSettings } from './settings';

const audit = opsAudit('incident');

export async function listIncidents(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:incidents:read');
  const rows = await db
    .select({ incident: opsIncidents, ownerName: staffMembers.fullName, sopCode: opsSops.code })
    .from(opsIncidents)
    .leftJoin(staffMembers, eq(staffMembers.id, opsIncidents.ownerStaffId))
    .leftJoin(opsSops, eq(opsSops.id, opsIncidents.sopId))
    .orderBy(desc(opsIncidents.occurredAt))
    .limit(500);
  const sla = (await loadSettings(db))['incidents.resolution_sla'];
  const now = new Date();
  return rows.map((r) => ({
    ...r.incident,
    ownerName: r.ownerName,
    sopCode: r.sopCode,
    sla: incidentSla(r.incident, now, sla.value),
  }));
}

/** Resolution-SLA setting shown beside the list (its decision state is proposed). */
export async function incidentSlaSetting(db: Database) {
  return (await loadSettings(db))['incidents.resolution_sla'];
}

export async function createIncident(
  db: Database,
  actor: Actor,
  input: z.output<typeof incidentBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:incidents:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000)
    throw new ValidationError('An incident cannot be in the future.');
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'incident', 'ops.incidents');
    const [row] = await tx
      .insert(opsIncidents)
      .values({
        code,
        kind: input.kind,
        category: input.category,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity,
        ownerStaffId: (input.ownerStaffId as StaffMemberId | null) ?? null,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        sopId: (input.sopId as never) ?? null,
        occurredAt,
        needsAuthorisedApproval: incidentNeedsAuthorisedApproval(input.category),
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, row?.id, 'incident.created', { after: row }, requestId);
    return row;
  });
}

export async function updateIncident(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof incidentUpdateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:incidents:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsIncidents, id, 'Incident', true);
    const patch: Partial<typeof opsIncidents.$inferInsert> = {};
    if (input.status && input.status !== before.status) {
      const check = checkIncidentTransition(
        before.status as IncidentStatus,
        input.status,
        input.resolution ?? before.resolution,
      );
      if (!check.ok) throw new ValidationError(check.message);
      patch.status = input.status;
      if (input.status === 'resolved') patch.resolvedAt = new Date();
      if (input.status === 'in_progress' || input.status === 'open') patch.resolvedAt = null;
    }
    if (input.resolution !== undefined) patch.resolution = input.resolution;
    if ('ownerStaffId' in input)
      patch.ownerStaffId = (input.ownerStaffId as StaffMemberId | null) ?? null;
    if (input.severity) patch.severity = input.severity;
    const [after] = await tx
      .update(opsIncidents)
      .set(patch)
      .where(eq(opsIncidents.id, before.id))
      .returning();
    await audit(tx, actor, before.id, 'incident.updated', { before, after }, requestId);
    return after;
  });
}
