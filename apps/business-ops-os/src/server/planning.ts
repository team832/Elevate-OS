/**
 * Business planning registers: decision log (OPS-021), risks/issues/blockers
 * (OPS-023), projects and milestones with dependencies (OPS-025), and the
 * imported work inventory.
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import {
  opsDecisions,
  opsMilestoneDependencies,
  opsMilestones,
  opsProjects,
  opsRisks,
  opsWorkItems,
  staffMembers,
  type Database,
  type OpsDecisionId,
  type OpsMilestoneId,
  type OpsProjectId,
  type OpsRiskId,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { z } from 'zod';
import { riskFlags, riskSeverity, wouldCreateCycle, type Level } from '../domain';
import { accessScope, activeStaff, nextCode, notFound, type Actor } from './context';
import type {
  decisionBody,
  milestoneBody,
  milestoneUpdateBody,
  projectBody,
  riskBody,
  updateDecisionBody,
  updateProjectBody,
  updateRiskBody,
} from './schemas';

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function staffNames(db: Database) {
  const rows = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers);
  return (id: string | null) => rows.find((r) => r.id === id)?.fullName ?? null;
}

// --- decisions -----------------------------------------------------------------------------------

export async function listDecisions(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:decisions:read');
  const rows = await db.select().from(opsDecisions).orderBy(asc(opsDecisions.code));
  const name = await staffNames(db);
  return rows.map((d) => ({
    ...d,
    decidedByName: name(d.decidedByStaffId),
    legacy: d.code.startsWith('LEGACY-'),
  }));
}

export async function createDecision(
  db: Database,
  actor: Actor,
  input: z.output<typeof decisionBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:decisions:write');
  if (input.state === 'superseded')
    throw new ValidationError(
      'Record the replacing decision first, then mark this one superseded.',
    );
  if (input.state === 'confirmed' && !input.decidedOn)
    throw new ValidationError('A confirmed decision needs the date it was decided (PLT-007).', {
      details: [{ location: 'body', path: ['decidedOn'], message: 'Required' }],
    });
  if (input.decidedByStaffId) await activeStaff(db, input.decidedByStaffId, 'decidedByStaffId');
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'decision', 'ops.decisions');
    const [row] = await tx
      .insert(opsDecisions)
      .values({
        ...input,
        code,
        decidedByStaffId: (input.decidedByStaffId as never) ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'decision.created',
      entityType: 'decision',
      entityId: row?.id ?? null,
      after: row,
      requestId,
    });
    return row;
  });
}

export async function updateDecision(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateDecisionBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:decisions:write');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsDecisions)
      .where(eq(opsDecisions.id, id as OpsDecisionId))
      .for('update');
    if (!before) notFound('Decision');
    const state = input.state ?? before.state;
    const supersededBy = 'supersededById' in input ? input.supersededById : before.supersededById;
    if (state === 'superseded') {
      if (!supersededBy)
        throw new ValidationError('Say which decision supersedes this one.', {
          details: [{ location: 'body', path: ['supersededById'], message: 'Required' }],
        });
      if (supersededBy === before.id)
        throw new ValidationError('A decision cannot supersede itself.');
      const [other] = await tx
        .select({ id: opsDecisions.id })
        .from(opsDecisions)
        .where(eq(opsDecisions.id, supersededBy as OpsDecisionId));
      if (!other) throw new ValidationError('Unknown superseding decision.');
    }
    if (state === 'confirmed' && !(input.decidedOn ?? before.decidedOn))
      throw new ValidationError('A confirmed decision needs the date it was decided (PLT-007).');
    const [after] = await tx
      .update(opsDecisions)
      .set(defined(input))
      .where(eq(opsDecisions.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'decision.updated',
      entityType: 'decision',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after;
  });
}

// --- risks ----------------------------------------------------------------------------------------

export async function listRisks(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:risks:read');
  const rows = await db.select().from(opsRisks).orderBy(desc(opsRisks.createdAt));
  const name = await staffNames(db);
  return rows.map((r) => ({
    ...r,
    ownerName: name(r.ownerStaffId),
    severity: riskSeverity(r.likelihood as Level | null, r.impact as Level | null),
    flags: riskFlags({
      status: r.status,
      likelihood: r.likelihood as Level | null,
      impact: r.impact as Level | null,
      ownerStaffId: r.ownerStaffId,
    }),
  }));
}

export async function createRisk(
  db: Database,
  actor: Actor,
  input: z.output<typeof riskBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'risk', 'ops.risks');
    const [row] = await tx
      .insert(opsRisks)
      .values({ ...(input as typeof opsRisks.$inferInsert), code, createdBy: actor.id })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'risk.created',
      entityType: 'risk',
      entityId: row?.id ?? null,
      after: row,
      requestId,
    });
    return row;
  });
}

export async function updateRisk(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateRiskBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsRisks)
      .where(eq(opsRisks.id, id as OpsRiskId))
      .for('update');
    if (!before) notFound('Risk');
    const [after] = await tx
      .update(opsRisks)
      .set(defined(input) as Partial<typeof opsRisks.$inferInsert>)
      .where(eq(opsRisks.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'risk.updated',
      entityType: 'risk',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after;
  });
}

// --- projects and milestones -------------------------------------------------------------------------

export async function listProjects(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:risks:read');
  const projects = await db.select().from(opsProjects).orderBy(asc(opsProjects.code));
  const milestones = projects.length
    ? await db
        .select()
        .from(opsMilestones)
        .where(
          inArray(
            opsMilestones.projectId,
            projects.map((p) => p.id),
          ),
        )
        .orderBy(asc(opsMilestones.dueDate))
    : [];
  const deps = milestones.length
    ? await db
        .select()
        .from(opsMilestoneDependencies)
        .where(
          inArray(
            opsMilestoneDependencies.milestoneId,
            milestones.map((m) => m.id),
          ),
        )
    : [];
  const name = await staffNames(db);
  return projects.map((p) => ({
    ...p,
    ownerName: name(p.ownerStaffId),
    milestones: milestones
      .filter((m) => m.projectId === p.id)
      .map((m) => ({
        ...m,
        ownerName: name(m.ownerStaffId),
        dependsOn: deps.filter((d) => d.milestoneId === m.id).map((d) => d.dependsOnMilestoneId),
      })),
  }));
}

export async function createProject(
  db: Database,
  actor: Actor,
  input: z.output<typeof projectBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  if (input.startDate && input.endDate && input.endDate < input.startDate)
    throw new ValidationError('The end date is before the start date.');
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'project', 'ops.projects');
    const [row] = await tx
      .insert(opsProjects)
      .values({ ...(input as typeof opsProjects.$inferInsert), code, createdBy: actor.id })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'project.created',
      entityType: 'project',
      entityId: row?.id ?? null,
      after: row,
      requestId,
    });
    return row;
  });
}

export async function updateProject(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateProjectBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsProjects)
      .where(eq(opsProjects.id, id as OpsProjectId))
      .for('update');
    if (!before) notFound('Project');
    const merged = { ...before, ...defined(input) };
    if (merged.startDate && merged.endDate && merged.endDate < merged.startDate)
      throw new ValidationError('The end date is before the start date.');
    const [after] = await tx
      .update(opsProjects)
      .set(defined(input) as Partial<typeof opsProjects.$inferInsert>)
      .where(eq(opsProjects.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'project.updated',
      entityType: 'project',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after;
  });
}

async function addMilestoneEdge(tx: Database, milestoneId: string, dependsOn: string) {
  const edges = await tx
    .select({
      from: opsMilestoneDependencies.milestoneId,
      to: opsMilestoneDependencies.dependsOnMilestoneId,
    })
    .from(opsMilestoneDependencies);
  const check = wouldCreateCycle(edges, milestoneId, dependsOn);
  if (check.cycle)
    throw new ConflictError('That dependency would create a cycle between milestones.', {
      details: { cycle: check.path },
    });
  const [target] = await tx
    .select({ id: opsMilestones.id })
    .from(opsMilestones)
    .where(eq(opsMilestones.id, dependsOn as OpsMilestoneId));
  if (!target) throw new ValidationError('Unknown milestone in dependsOn.');
  await tx
    .insert(opsMilestoneDependencies)
    .values({
      milestoneId: milestoneId as OpsMilestoneId,
      dependsOnMilestoneId: dependsOn as OpsMilestoneId,
    })
    .onConflictDoNothing();
}

export async function addMilestone(
  db: Database,
  actor: Actor,
  projectId: string,
  input: z.output<typeof milestoneBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  return withTransaction(db, async (tx) => {
    const [project] = await tx
      .select()
      .from(opsProjects)
      .where(eq(opsProjects.id, projectId as OpsProjectId))
      .for('update');
    if (!project) notFound('Project');
    const [row] = await tx
      .insert(opsMilestones)
      .values({
        projectId: project.id,
        title: input.title,
        dueDate: input.dueDate ?? null,
        ownerStaffId: (input.ownerStaffId as never) ?? null,
      })
      .returning();
    if (!row) throw new Error('milestone insert returned no row');
    for (const dep of input.dependsOnMilestoneIds) await addMilestoneEdge(tx, row.id, dep);
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'milestone.created',
      entityType: 'project',
      entityId: project.id,
      after: row,
      requestId,
    });
    return row;
  });
}

export async function updateMilestone(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof milestoneUpdateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsMilestones)
      .where(eq(opsMilestones.id, id as OpsMilestoneId))
      .for('update');
    if (!before) notFound('Milestone');
    if (input.addDependsOnMilestoneId)
      await addMilestoneEdge(tx, before.id, input.addDependsOnMilestoneId);
    if (input.status === 'done') {
      const deps = await tx
        .select({ status: opsMilestones.status, title: opsMilestones.title })
        .from(opsMilestoneDependencies)
        .innerJoin(
          opsMilestones,
          eq(opsMilestones.id, opsMilestoneDependencies.dependsOnMilestoneId),
        )
        .where(eq(opsMilestoneDependencies.milestoneId, before.id));
      const open = deps.filter((d) => d.status === 'planned' || d.status === 'missed');
      if (open.length)
        throw new ConflictError(
          `Finish the milestones this depends on first: ${open.map((o) => o.title).join(', ')}.`,
        );
    }
    const patch: Partial<typeof opsMilestones.$inferInsert> = {};
    if (input.status) {
      patch.status = input.status;
      patch.completedAt = input.status === 'done' ? new Date() : null;
    }
    if ('dueDate' in input) patch.dueDate = input.dueDate ?? null;
    const [after] = Object.keys(patch).length
      ? await tx.update(opsMilestones).set(patch).where(eq(opsMilestones.id, before.id)).returning()
      : [before];
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'milestone.updated',
      entityType: 'project',
      entityId: before.projectId,
      before,
      after,
      requestId,
    });
    return after;
  });
}

// --- work inventory -----------------------------------------------------------------------------------

export async function listWorkInventory(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:risks:read');
  return db.select().from(opsWorkItems).orderBy(asc(opsWorkItems.code));
}
