/**
 * Business planning registers: decision log (OPS-021), risks/issues/blockers
 * (OPS-023), projects and milestones with dependencies (OPS-025), and the
 * imported work inventory.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  opsDecisions,
  opsMilestoneDependencies,
  opsMilestones,
  opsProjects,
  opsRiskMitigations,
  opsRisks,
  opsTasks,
  opsWorkItems,
  staffMembers,
  type Database,
  type OpsDecisionId,
  type OpsMilestoneId,
  type OpsRiskId,
  type OpsRiskMitigationId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { z } from 'zod';
import {
  checkMitigationTransition,
  istToday,
  PROJECT_BLOCK_REASON_LABELS,
  projectBlockReasons,
  riskFlags,
  riskSeverity,
  wouldCreateCycle,
  type Level,
  type MitigationStatus,
} from '../domain';
import { accessScope, activeStaff, nextCode, notFound, type Actor } from './context';
import { defined, opsAudit, rowById } from './ops-common';
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
import type { mitigationBody, mitigationUpdateBody } from './work-schemas';

const audit = {
  decision: opsAudit('decision'),
  risk: opsAudit('risk'),
  project: opsAudit('project'),
};

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
    await audit.decision(tx, actor, row?.id, 'decision.created', { after: row }, requestId);
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
    const before = await rowById(tx, opsDecisions, id, 'Decision', true);
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
      .set(defined(input) as Partial<typeof opsDecisions.$inferInsert>)
      .where(eq(opsDecisions.id, before.id))
      .returning();
    await audit.decision(tx, actor, before.id, 'decision.updated', { before, after }, requestId);
    return after;
  });
}

// --- risks ----------------------------------------------------------------------------------------

export async function listRisks(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:risks:read');
  const rows = await db.select().from(opsRisks).orderBy(desc(opsRisks.createdAt));
  const name = await staffNames(db);
  const mitigations = await listMitigations(db, actor);
  return rows.map((r) => ({
    ...r,
    ownerName: name(r.ownerStaffId),
    mitigations: mitigations.filter((m) => m.riskId === r.id),
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
    await audit.risk(tx, actor, row?.id, 'risk.created', { after: row }, requestId);
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
    const before = await rowById(tx, opsRisks, id, 'Risk', true);
    const [after] = await tx
      .update(opsRisks)
      .set(defined(input) as Partial<typeof opsRisks.$inferInsert>)
      .where(eq(opsRisks.id, before.id))
      .returning();
    await audit.risk(tx, actor, before.id, 'risk.updated', { before, after }, requestId);
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
    await audit.project(tx, actor, row?.id, 'project.created', { after: row }, requestId);
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
    const before = await rowById(tx, opsProjects, id, 'Project', true);
    const merged = { ...before, ...defined(input) };
    if (merged.startDate && merged.endDate && merged.endDate < merged.startDate)
      throw new ValidationError('The end date is before the start date.');
    const [after] = await tx
      .update(opsProjects)
      .set(defined(input) as Partial<typeof opsProjects.$inferInsert>)
      .where(eq(opsProjects.id, before.id))
      .returning();
    await audit.project(tx, actor, before.id, 'project.updated', { before, after }, requestId);
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
    const project = await rowById(tx, opsProjects, projectId, 'Project', true);
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
    await audit.project(tx, actor, project.id, 'milestone.created', { after: row }, requestId);
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
    const before = await rowById(tx, opsMilestones, id, 'Milestone', true);
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
    await audit.project(
      tx,
      actor,
      before.projectId,
      'milestone.updated',
      { before, after },
      requestId,
    );
    return after;
  });
}

// --- work inventory -----------------------------------------------------------------------------------

export async function listWorkInventory(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:risks:read');
  return db.select().from(opsWorkItems).orderBy(asc(opsWorkItems.code));
}

// --- risk mitigations (OPS-067) ------------------------------------------------------------------

export async function listMitigations(db: Database, actor: Actor, riskId?: string) {
  await accessScope(db, actor, 'ops:risks:read');
  const rows = await db
    .select()
    .from(opsRiskMitigations)
    .where(riskId ? eq(opsRiskMitigations.riskId, riskId as OpsRiskId) : undefined)
    .orderBy(asc(opsRiskMitigations.createdAt));
  const name = await staffNames(db);
  const today = istToday(new Date());
  return rows.map((m) => ({
    ...m,
    ownerName: name(m.ownerStaffId),
    overdue:
      (m.status === 'planned' || m.status === 'in_progress') &&
      m.dueDate !== null &&
      m.dueDate < today,
  }));
}

export async function addMitigation(
  db: Database,
  actor: Actor,
  riskId: string,
  input: z.output<typeof mitigationBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const risk = await rowById(tx, opsRisks, riskId, 'Risk', true);
    if (risk.status === 'closed' || risk.status === 'resolved')
      throw new ConflictError('Reopen the risk before adding mitigation actions.');
    const [row] = await tx
      .insert(opsRiskMitigations)
      .values({
        riskId: risk.id,
        action: input.action,
        ownerStaffId: (input.ownerStaffId as never) ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: actor.id,
      })
      .returning();
    await audit.risk(tx, actor, risk.id, 'risk.mitigation_added', { after: row }, requestId);
    return row;
  });
}

export async function updateMitigation(
  db: Database,
  actor: Actor,
  riskId: string,
  mitigationId: string,
  input: z.output<typeof mitigationUpdateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:risks:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsRiskMitigations)
      .where(
        and(
          eq(opsRiskMitigations.id, mitigationId as OpsRiskMitigationId),
          eq(opsRiskMitigations.riskId, riskId as OpsRiskId),
        ),
      )
      .for('update');
    if (!before) notFound('Mitigation');
    const patch: Partial<typeof opsRiskMitigations.$inferInsert> = {};
    if (input.status && input.status !== before.status) {
      const check = checkMitigationTransition(
        before.status as MitigationStatus,
        input.status,
        input.outcome ?? before.outcome,
      );
      if (!check.ok) throw new ValidationError(check.message);
      patch.status = input.status;
      patch.completedAt = input.status === 'done' ? new Date() : null;
    } else if (before.status === 'done' || before.status === 'dropped') {
      throw new ConflictError('A finished mitigation action cannot be changed.');
    }
    if (input.outcome !== undefined) patch.outcome = input.outcome;
    if ('ownerStaffId' in input) patch.ownerStaffId = (input.ownerStaffId as never) ?? null;
    if ('dueDate' in input) patch.dueDate = input.dueDate ?? null;
    const [after] = await tx
      .update(opsRiskMitigations)
      .set(patch)
      .where(eq(opsRiskMitigations.id, before.id))
      .returning();
    await audit.risk(
      tx,
      actor,
      before.riskId,
      'risk.mitigation_updated',
      { before, after },
      requestId,
    );
    return after;
  });
}

// --- blocked projects (OPS-067) ------------------------------------------------------------------

/** Live projects with at least one block reason (pure rules: domain/registers.ts). */
export async function listBlockedProjects(db: Database, actor: Actor, now = new Date()) {
  await accessScope(db, actor, 'ops:risks:read');
  return blockedProjectRows(db, now);
}

/** No permission check: used by the operations report after its own check. */
export async function blockedProjectRows(db: Database, now = new Date()) {
  const today = istToday(now);
  const projects = await db
    .select()
    .from(opsProjects)
    .where(inArray(opsProjects.status, ['planned', 'active', 'on_hold']))
    .orderBy(asc(opsProjects.code));
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const milestones = await db
    .select()
    .from(opsMilestones)
    .where(inArray(opsMilestones.projectId, ids));
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
  const blockedTasks = await db
    .select({ projectId: opsTasks.projectId })
    .from(opsTasks)
    .where(and(inArray(opsTasks.projectId, ids), eq(opsTasks.status, 'blocked')));
  const blockers = await db
    .select({ projectId: opsRisks.projectId })
    .from(opsRisks)
    .where(
      and(
        inArray(opsRisks.projectId, ids),
        inArray(opsRisks.kind, ['issue', 'blocker']),
        inArray(opsRisks.status, ['open', 'mitigating']),
      ),
    );
  const name = await staffNames(db);
  return projects
    .map((p) => {
      const ms = milestones
        .filter((m) => m.projectId === p.id)
        .map((m) => ({
          id: m.id as string,
          title: m.title,
          status: m.status,
          dueDate: m.dueDate,
          dependsOn: deps
            .filter((d) => d.milestoneId === m.id)
            .map((d) => d.dependsOnMilestoneId as string),
        }));
      const counts = {
        blockedTasks: blockedTasks.filter((t) => t.projectId === p.id).length,
        openBlockers: blockers.filter((b) => b.projectId === p.id).length,
      };
      const reasons = projectBlockReasons(p, ms, counts, today);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        ownerName: name(p.ownerStaffId),
        reasons,
        reasonLabels: reasons.map((r) => PROJECT_BLOCK_REASON_LABELS[r]),
        missedMilestones: ms.filter((m) => m.status === 'missed').map((m) => m.title),
        ...counts,
      };
    })
    .filter((p) => p.reasons.length > 0);
}
