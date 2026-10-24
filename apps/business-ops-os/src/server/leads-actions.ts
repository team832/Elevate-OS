/**
 * Lead actions (OPS-003, OPS-004, OPS-006): assignment and acceptance, contact attempts that
 * move new cases to contacted, and the explicit audited merge of two leads.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsDuplicateFlags,
  opsEnquiries,
  opsFollowUps,
  opsLeadActivities,
  opsLeads,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { LeadId } from '@elevate/shared-types';
import { istToday, isOpenStatus } from '../domain';
import { callSeconds } from '../domain/lead-stages';
import {
  accessScope,
  activeStaff,
  clean,
  staffIdForUser,
  userIdsForStaff,
  type Actor,
} from './context';
import { CONTACT_KEYS, siblingsOnly } from './lead-duplicates';
import { getLeadRow, lockWorkableLead, notifyAssigned, type LeadRow } from './leads-access';
import { opsAudit } from './ops-common';
import { applyTransition, lockAdmission, lockLeadIdentity } from './pipeline';
import { scheduleCallFollowUp } from './lead-calls';
import type { ContactActivityInput } from './lead-stages-schemas';
import { markMergedDnc, markMergedDuplicate } from './lead-stages';
import { loadSettings } from './settings';

const SUCCESSFUL_OUTCOMES = new Set(['connected_two_way', 'replied', 'visited']);

export async function assignLead(
  db: Database,
  actor: Actor,
  leadId: string,
  ownerStaffId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:assign');
  const owner = await activeStaff(db, ownerStaffId, 'ownerStaffId');
  const actorStaffId = await staffIdForUser(db, actor.id);
  return withTransaction(db, async (tx) => {
    const before = await getLeadRow(tx, leadId, true);
    if (before.mergedIntoLeadId) throw new ConflictError('This lead was merged into another lead.');
    const now = new Date();
    const [after] = await tx
      .update(opsLeads)
      .set({
        ownerStaffId: owner.id,
        ownerAssignedAt: now,
        acceptedAt: owner.id === actorStaffId ? now : null,
      })
      .where(eq(opsLeads.id, before.id))
      .returning();
    // Open admissions follow the lead unless another counsellor already holds them.
    const open = await tx.select().from(opsAdmissions).where(eq(opsAdmissions.leadId, before.id));
    for (const a of open) {
      if (!isOpenStatus(a.status)) continue;
      if (a.counsellorStaffId && a.counsellorStaffId !== before.ownerStaffId) continue;
      await tx
        .update(opsAdmissions)
        .set({ counsellorStaffId: owner.id })
        .where(eq(opsAdmissions.id, a.id));
    }
    if (before.ownerStaffId) {
      await tx
        .update(opsFollowUps)
        .set({ ownerStaffId: owner.id })
        .where(
          and(
            eq(opsFollowUps.leadId, before.id),
            eq(opsFollowUps.status, 'open'),
            eq(opsFollowUps.ownerStaffId, before.ownerStaffId),
          ),
        );
    }
    await opsAudit('lead')(
      tx,
      actor,
      before.id,
      'lead.assigned',
      {
        before: { ownerStaffId: before.ownerStaffId },
        after: { ownerStaffId: owner.id },
        metadata: { leadId: before.id },
      },
      requestId,
    );
    await notifyAssigned(
      tx,
      actor,
      await userIdsForStaff(tx, [owner.id]),
      before,
      'Lead assigned to you',
      'Accept the handoff to confirm you own the next action.',
    );
    return after as LeadRow;
  });
}

export async function acceptLead(db: Database, actor: Actor, leadId: string, requestId?: string) {
  await accessScope(db, actor, 'ops:leads:write');
  const staffId = await staffIdForUser(db, actor.id);
  return withTransaction(db, async (tx) => {
    const lead = await getLeadRow(tx, leadId, true);
    if (lead.mergedIntoLeadId) throw new ConflictError('This lead was merged into another lead.');
    if (!staffId || lead.ownerStaffId !== staffId)
      throw new ForbiddenError('Only the assigned owner can accept this lead.');
    if (lead.acceptedAt) return lead;
    const [after] = await tx
      .update(opsLeads)
      .set({ acceptedAt: new Date() })
      .where(eq(opsLeads.id, lead.id))
      .returning();
    await opsAudit('lead')(
      tx,
      actor,
      lead.id,
      'lead.accepted',
      { after: { acceptedAt: after?.acceptedAt }, metadata: { leadId: lead.id } },
      requestId,
    );
    return after as LeadRow;
  });
}

/**
 * Log a contact attempt (OPS-006). A successful two-way contact sets
 * `first_successful_contact_at` once and moves every `new` admission of the lead
 * to `contacted` (BR-OPS-4); unanswered attempts change nothing.
 */
export async function logActivity(
  db: Database,
  actor: Actor,
  leadId: string,
  input: ContactActivityInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const staffId = await staffIdForUser(db, actor.id);
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const lead = await lockWorkableLead(
      tx,
      access,
      leadId,
      'This lead was merged into another lead; log the contact on that one.',
    );
    // Do not contact (brief §11): only what the family started, or a note, may be logged.
    if (lead.doNotContact && input.kind !== 'note' && input.direction !== 'inbound')
      throw new ConflictError(
        'This lead is marked Do not contact, so calls and messages to them cannot be logged. If they contacted you, log it as an inbound call; to contact them again, change the stage with a reason first.',
      );
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000)
      throw new ValidationError('A contact attempt cannot be in the future.');
    for (const field of ['durationMinutes', 'direction'] as const)
      if ((input[field] ?? null) !== null && input.kind !== 'call')
        throw new ValidationError('Only a call has a direction and a duration.', {
          details: [{ location: 'body', path: [field], message: 'Calls only' }],
        });
    if (input.nextFollowUpOn && input.nextFollowUpOn < istToday(new Date()))
      throw new ValidationError('The next follow-up cannot be in the past.', {
        details: [{ location: 'body', path: ['nextFollowUpOn'], message: 'Today or later' }],
      });
    const [activity] = await tx
      .insert(opsLeadActivities)
      .values({
        leadId: lead.id,
        kind: input.kind,
        outcome: input.outcome,
        occurredAt,
        note: clean(input.note),
        staffId,
        direction: input.direction ?? null,
        durationSeconds: callSeconds(input.durationMinutes),
        nextAction: clean(input.nextAction),
        nextFollowUpOn: input.nextFollowUpOn ?? null,
        createdBy: actor.id,
      })
      .returning();
    const followUp = input.nextFollowUpOn
      ? await scheduleCallFollowUp(
          tx,
          actor,
          lead,
          staffId,
          { dueDate: input.nextFollowUpOn, title: clean(input.nextAction) },
          requestId,
        )
      : null;
    const successful = SUCCESSFUL_OUTCOMES.has(input.outcome) && input.kind !== 'note';
    const moved: string[] = [];
    if (successful) {
      if (!lead.firstSuccessfulContactAt)
        await tx
          .update(opsLeads)
          .set({ firstSuccessfulContactAt: occurredAt })
          .where(eq(opsLeads.id, lead.id));
      const admissions = await tx
        .select({ id: opsAdmissions.id })
        .from(opsAdmissions)
        .where(and(eq(opsAdmissions.leadId, lead.id), eq(opsAdmissions.status, 'new')));
      for (const a of admissions) {
        const locked = await lockAdmission(tx, a.id);
        if (!locked || locked.status !== 'new') continue;
        await applyTransition(tx, {
          admission: locked,
          to: 'contacted',
          actorUserId: actor.id,
          reason: `First successful contact (${input.kind})`,
          context: { hasSuccessfulContact: true },
          requestId,
          settings,
        });
        moved.push(a.id);
      }
    }
    await opsAudit('lead_activity')(
      tx,
      actor,
      activity?.id ?? null,
      'lead.contact_logged',
      { after: activity, metadata: { leadId: lead.id, successful } },
      requestId,
    );
    return { activity, successful, admissionsMovedToContacted: moved, followUp };
  });
}

/** Fields of the merge target that the source fills when the target's are empty. */
const MERGE_FILL_FIELDS = [...CONTACT_KEYS, 'guardianName', 'previousSchool', 'city'] as const;

/**
 * Explicit, audited merge of `sourceId` INTO `targetId` (OPS-003). Keeps both
 * enquiries and their sources (moved, marked `merged_from_lead_id`), moves
 * contact activity and lead-level follow-ups, fills only EMPTY contact fields of
 * the target, and closes the source's open admissions as lost ("merged"). Refused
 * when the source has an admitted or enrolment case (a human must resolve it).
 * The source keeps its contacts (history intact); once merged it is excluded from matching.
 */
export async function mergeLeads(
  db: Database,
  actor: Actor,
  sourceId: string,
  targetId: string,
  note: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:merge');
  if (sourceId === targetId) throw new ValidationError('Choose two different leads.');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    // A booking on the target's case waits, then reuses the merged identity (no second one).
    await lockLeadIdentity(tx, targetId);
    // Lock both leads in id order (no deadlock between two opposite merges).
    const locked = new Map<string, LeadRow>();
    for (const id of [sourceId, targetId].sort()) locked.set(id, await getLeadRow(tx, id, true));
    const source = locked.get(sourceId) as LeadRow;
    const target = locked.get(targetId) as LeadRow;
    if (source.mergedIntoLeadId || target.mergedIntoLeadId)
      throw new ConflictError('One of these leads was already merged.');
    if (siblingsOnly(source, target))
      throw new ConflictError(
        `${source.code} and ${target.code} have different names, so they may be siblings sharing a parent's contact. They are not merged: dismiss the duplicate flag, or correct the name first if this really is the same student.`,
      );
    const admissions = await tx
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.leadId, source.id));
    const blocking = admissions.filter((a) =>
      ['admitted', 'enrolment_requested', 'enrolled'].includes(a.status),
    );
    if (blocking.length)
      throw new ConflictError(
        `${source.code} has an admitted or enrolled case (${blocking.map((b) => b.code).join(', ')}); resolve it before merging.`,
      );
    for (const a of admissions) {
      if (!isOpenStatus(a.status)) continue;
      const row = await lockAdmission(tx, a.id);
      if (!row) continue;
      await applyTransition(tx, {
        admission: row,
        to: 'lost',
        actorUserId: actor.id,
        reason: `Merged duplicate into ${target.code}`,
        reasonCode: 'duplicate_merged',
        requestId,
        settings,
      });
    }
    await tx
      .update(opsEnquiries)
      .set({ leadId: target.id, mergedFromLeadId: source.id })
      .where(eq(opsEnquiries.leadId, source.id));
    await tx
      .update(opsLeadActivities)
      .set({ leadId: target.id })
      .where(eq(opsLeadActivities.leadId, source.id));
    await tx
      .update(opsFollowUps)
      .set({ leadId: target.id })
      .where(
        and(
          eq(opsFollowUps.leadId, source.id),
          isNull(opsFollowUps.admissionId),
          eq(opsFollowUps.status, 'open'),
        ),
      );
    const fill: Partial<typeof opsLeads.$inferInsert> = {};
    for (const k of MERGE_FILL_FIELDS) if (!target[k] && source[k]) fill[k] = source[k];
    if (source.firstReceivedAt < target.firstReceivedAt)
      fill.firstReceivedAt = source.firstReceivedAt;
    if (
      source.firstSuccessfulContactAt &&
      (!target.firstSuccessfulContactAt ||
        source.firstSuccessfulContactAt < target.firstSuccessfulContactAt)
    )
      fill.firstSuccessfulContactAt = source.firstSuccessfulContactAt;
    if (Object.keys(fill).length)
      await tx.update(opsLeads).set(fill).where(eq(opsLeads.id, target.id));
    // Do not contact is never lost in a merge.
    if (source.doNotContact && !target.doNotContact)
      await markMergedDnc(tx, actor, target, source.code, requestId);
    await markMergedDuplicate(tx, actor, source, target.code, requestId);
    const [mergedSource] = await tx
      .update(opsLeads)
      .set({ mergedIntoLeadId: target.id, mergedAt: new Date() })
      .where(eq(opsLeads.id, source.id))
      .returning();
    const pair = (a: LeadId, b: LeadId) =>
      and(eq(opsDuplicateFlags.leadId, a), eq(opsDuplicateFlags.matchedLeadId, b));
    await tx
      .update(opsDuplicateFlags)
      .set({ status: 'merged', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note })
      .where(or(pair(source.id, target.id), pair(target.id, source.id)));
    for (const lead of [source, target])
      await opsAudit('lead')(
        tx,
        actor,
        lead.id,
        'lead.merged',
        {
          before: lead,
          after: lead.id === source.id ? mergedSource : { ...target, ...fill },
          metadata: { leadId: lead.id, sourceLeadId: source.id, targetLeadId: target.id, note },
        },
        requestId,
      );
    return { sourceCode: source.code, targetCode: target.code, targetId: target.id };
  });
}
