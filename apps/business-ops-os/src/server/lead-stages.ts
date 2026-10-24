/**
 * Lead stages (owner brief 23 Oct 2026 §11): configuration by the marketing manager
 * (`ops:leads:assign`), stage changes with history and audit, Converted only after Ops confirms
 * the admission, and the Do-not-contact flag kept in step with its stage. Rules: domain/lead-stages.ts.
 */
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsLeads,
  opsLeadStageHistory,
  opsLeadStages,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError } from '@elevate/shared-contracts';
import type { LeadId } from '@elevate/shared-types';
import {
  DNC_STAGE,
  DUPLICATE_STAGE,
  admissionConversion,
  isConfirmedAdmission,
  stageChangeProblem,
  SYSTEM_LEAD_STAGES,
  type LeadStageKind,
} from '../domain/lead-stages';
import { accessScope, clean, type Actor } from './context';
import { lockWorkableLead, type LeadRow } from './leads-access';
import { fieldError, opsAudit } from './ops-common';

export type LeadStage = typeof opsLeadStages.$inferSelect;
const audit = opsAudit('lead');
const stageAudit = opsAudit('lead_stage');
/** System flows set these stages, so they stay switched on. */
const ALWAYS_ACTIVE = new Set(['converted', DUPLICATE_STAGE, DNC_STAGE]);

/** Insert the 12 system stages (idempotent; SEED's reference seed and tests call it). */
export async function ensureSystemLeadStages(tx: Database) {
  for (const [i, s] of SYSTEM_LEAD_STAGES.entries())
    await tx
      .insert(opsLeadStages)
      .values({ ...s, sortOrder: (i + 1) * 10, isSystem: true })
      .onConflictDoNothing({ target: opsLeadStages.key });
}

/** All stages in order, inactive ones included (history and reports still name them). */
export async function listLeadStages(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:leads:read');
  return db.select().from(opsLeadStages).orderBy(asc(opsLeadStages.sortOrder), opsLeadStages.key);
}

async function stageByKey(db: Database, key: string, lock = false) {
  const q = db.select().from(opsLeadStages).where(eq(opsLeadStages.key, key)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new NotFoundError('Lead stage not found.');
  return row;
}

export async function createLeadStage(
  db: Database,
  actor: Actor,
  input: {
    key: string;
    label: string;
    sortOrder: number;
    kind: Exclude<LeadStageKind, 'won'>;
    requiresReason: boolean;
  },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:assign');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsLeadStages)
      .values({ ...input, label: input.label.trim() })
      .onConflictDoNothing({ target: opsLeadStages.key })
      .returning();
    if (!row) throw new ConflictError(`A stage with the key "${input.key}" already exists.`);
    await stageAudit(tx, actor, row.id, 'lead_stage.created', { after: row }, requestId);
    return row;
  });
}

/** Label, order and on/off only: keys never change, so history and reports stay readable. */
export async function updateLeadStage(
  db: Database,
  actor: Actor,
  key: string,
  input: { label?: string; sortOrder?: number; active?: boolean },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:assign');
  return withTransaction(db, async (tx) => {
    const before = await stageByKey(tx, key, true);
    if (input.active === false && ALWAYS_ACTIVE.has(key))
      throw fieldError('active', 'This stage is used by the system and stays on.');
    const [after] = await tx
      .update(opsLeadStages)
      .set({ ...input, label: input.label?.trim() || before.label, updatedAt: new Date() })
      .where(eq(opsLeadStages.id, before.id))
      .returning();
    await stageAudit(tx, actor, before.id, 'lead_stage.updated', { before, after }, requestId);
    return after as LeadStage;
  });
}

/** Only an unused stage the manager added can be removed; otherwise switch it off. */
export async function deleteLeadStage(db: Database, actor: Actor, key: string, requestId?: string) {
  await accessScope(db, actor, 'ops:leads:assign');
  return withTransaction(db, async (tx) => {
    const stage = await stageByKey(tx, key, true);
    if (stage.isSystem) throw new ConflictError('System stages cannot be deleted.');
    const [used] = await tx
      .select({ id: opsLeadStageHistory.id })
      .from(opsLeadStageHistory)
      .where(or(eq(opsLeadStageHistory.toKey, key), eq(opsLeadStageHistory.fromKey, key)))
      .limit(1);
    if (used) throw new ConflictError('Leads have used this stage; switch it off instead.');
    await tx.delete(opsLeadStages).where(eq(opsLeadStages.id, stage.id));
    await stageAudit(tx, actor, stage.id, 'lead_stage.deleted', { before: stage }, requestId);
    return { deleted: key };
  });
}

/** Numbered admissions of a lead with what they mean for conversion, newest first. */
export async function admissionConversions(db: Database, leadId: LeadId) {
  const rows = await db
    .select({
      id: opsAdmissions.id,
      admissionNumber: opsAdmissions.admissionNumber,
      status: opsAdmissions.status,
      legacyVerification: opsAdmissions.legacyVerification,
    })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.leadId, leadId))
    .orderBy(desc(opsAdmissions.createdAt));
  return rows
    .map((r) => ({ ...r, conversion: admissionConversion(r) }))
    .filter((r) => r.conversion !== 'none');
}

/** Write the stage, its history row and audit; the DNC flag follows its stage. */
async function moveStage(
  tx: Database,
  actor: Actor,
  lead: LeadRow,
  toKey: string,
  reason: string | null,
  requestId?: string,
) {
  const now = new Date();
  const patch: Partial<LeadRow> = { stageKey: toKey, stageChangedAt: now };
  if (toKey === DNC_STAGE) patch.doNotContact = true;
  // Leaving Do not contact clears the flag; a merged-away DNC lead keeps it.
  else if (lead.stageKey === DNC_STAGE && toKey !== DUPLICATE_STAGE) patch.doNotContact = false;
  const [after] = await tx.update(opsLeads).set(patch).where(eq(opsLeads.id, lead.id)).returning();
  await tx.insert(opsLeadStageHistory).values({
    leadId: lead.id,
    fromKey: lead.stageKey,
    toKey,
    reason,
    actorUserId: actor.id,
    changedAt: now,
  });
  await audit(
    tx,
    actor,
    lead.id,
    'lead.stage_changed',
    {
      before: { stageKey: lead.stageKey, doNotContact: lead.doNotContact },
      after: { stageKey: toKey, doNotContact: patch.doNotContact ?? lead.doNotContact },
      metadata: { leadId: lead.id, reason },
    },
    requestId,
  );
  return after as LeadRow;
}

export async function changeLeadStage(
  db: Database,
  actor: Actor,
  leadId: string,
  input: { stageKey: string; reason?: string | null },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const reason = clean(input.reason);
  return withTransaction(db, async (tx) => {
    const lead = await lockWorkableLead(
      tx,
      access,
      leadId,
      'This lead was merged into another lead.',
    );
    const [to] = await tx.select().from(opsLeadStages).where(eq(opsLeadStages.key, input.stageKey));
    if (!to) throw fieldError('stageKey', 'Unknown stage.');
    const problem = stageChangeProblem({
      fromKey: lead.stageKey,
      to,
      reason,
      hasConfirmedAdmission:
        to.kind === 'won' && (await admissionConversions(tx, lead.id)).some(isConfirmedAdmission),
    });
    if (problem) throw fieldError(problem.field, problem.message);
    const after = await moveStage(tx, actor, lead, to.key, reason, requestId);
    return { id: after.id, stageKey: after.stageKey, doNotContact: after.doNotContact };
  });
}

async function activeStage(tx: Database, key: string) {
  const [row] = await tx
    .select({ key: opsLeadStages.key })
    .from(opsLeadStages)
    .where(and(eq(opsLeadStages.key, key), eq(opsLeadStages.active, true)));
  return row;
}

/** A new lead starts at "New" once stages are set up (before that it stays unstaged). */
export async function setInitialLeadStage(
  tx: Database,
  actor: Actor,
  lead: LeadRow,
  requestId?: string,
) {
  return (await activeStage(tx, 'new')) ? moveStage(tx, actor, lead, 'new', null, requestId) : lead;
}

/** The merged-away lead moves to Duplicate (its own history stays on it). */
export async function markMergedDuplicate(
  tx: Database,
  actor: Actor,
  source: LeadRow,
  targetCode: string,
  requestId?: string,
) {
  if (source.stageKey !== DUPLICATE_STAGE && (await activeStage(tx, DUPLICATE_STAGE)))
    await moveStage(tx, actor, source, DUPLICATE_STAGE, `Merged into ${targetCode}`, requestId);
}

/**
 * A merge carried Do not contact onto the target: the target moves to that stage (history and
 * audit name the merged lead); without the stage only the flag is set.
 */
export async function markMergedDnc(
  tx: Database,
  actor: Actor,
  target: LeadRow,
  sourceCode: string,
  requestId?: string,
) {
  if (target.stageKey !== DNC_STAGE && (await activeStage(tx, DNC_STAGE)))
    return moveStage(tx, actor, target, DNC_STAGE, `Merged from ${sourceCode}`, requestId);
  await tx.update(opsLeads).set({ doNotContact: true }).where(eq(opsLeads.id, target.id));
}

/** Stage history of these leads (a lead plus the leads merged into it), newest first. */
export function stageHistory(db: Database, leadIds: LeadId[]) {
  return db
    .select({
      id: opsLeadStageHistory.id,
      leadId: opsLeadStageHistory.leadId,
      fromKey: opsLeadStageHistory.fromKey,
      toKey: opsLeadStageHistory.toKey,
      reason: opsLeadStageHistory.reason,
      changedAt: opsLeadStageHistory.changedAt,
    })
    .from(opsLeadStageHistory)
    .where(inArray(opsLeadStageHistory.leadId, leadIds))
    .orderBy(desc(opsLeadStageHistory.changedAt));
}
