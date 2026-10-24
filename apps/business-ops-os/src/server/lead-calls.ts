/**
 * Sales calls (owner brief 23 Oct 2026 §11): the call log is what staff record about calls they
 * make from their own phone; nothing is dialled or recorded by the app. Logging goes through
 * logActivity (./leads-actions.ts); this file lists calls and keeps the next follow-up.
 */
import { and, asc, desc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm';
import {
  opsFollowUps,
  opsLeadActivities,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istInstant, type IsoDate } from '../domain';
import { accessScope, type Actor } from './context';
import { createFollowUp } from './follow-ups';
import type { LeadRow } from './leads-access';
import { leadScope } from './leads-read';
import type { CallFilters } from './lead-stages-schemas';
import { opsAudit } from './ops-common';

/**
 * The call's next follow-up date: moves the caller's open follow-up on this lead, or creates one
 * through the follow-up service (one open lead follow-up per owner, never a pile of them).
 */
export async function scheduleCallFollowUp(
  tx: Database,
  actor: Actor,
  lead: LeadRow,
  staffId: StaffMemberId | null,
  input: { dueDate: IsoDate; title: string | null },
  requestId?: string,
) {
  const owner = staffId ?? lead.ownerStaffId;
  const [open] = owner
    ? await tx
        .select()
        .from(opsFollowUps)
        .where(
          and(
            eq(opsFollowUps.leadId, lead.id),
            isNull(opsFollowUps.admissionId),
            eq(opsFollowUps.status, 'open'),
            eq(opsFollowUps.ownerStaffId, owner),
          ),
        )
        .orderBy(asc(opsFollowUps.dueDate))
        .limit(1)
    : [];
  if (!open)
    return createFollowUp(
      tx,
      actor,
      {
        leadId: lead.id,
        kind: 'general',
        title: input.title,
        dueDate: input.dueDate,
        ownerStaffId: owner,
      },
      requestId,
    );
  const [after] = await tx
    .update(opsFollowUps)
    .set({ dueDate: input.dueDate, title: input.title ?? open.title })
    .where(eq(opsFollowUps.id, open.id))
    .returning();
  await opsAudit('follow_up')(
    tx,
    actor,
    open.id,
    'followup.rescheduled',
    { before: open, after, metadata: { leadId: lead.id } },
    requestId,
  );
  return after;
}

/** Calls on the leads the caller may work (own scope: their leads), newest first. */
export async function listCalls(db: Database, actor: Actor, filters: CallFilters = {}) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  if (!scope) return [];
  const where: SQL[] = [eq(opsLeadActivities.kind, 'call'), scope];
  if (filters.from) where.push(gte(opsLeadActivities.occurredAt, istInstant(filters.from)));
  if (filters.to) where.push(lt(opsLeadActivities.occurredAt, istInstant(addDays(filters.to, 1))));
  if (filters.direction) where.push(eq(opsLeadActivities.direction, filters.direction));
  if (filters.outcome) where.push(eq(opsLeadActivities.outcome, filters.outcome));
  if (filters.staffId) where.push(eq(opsLeadActivities.staffId, filters.staffId as StaffMemberId));
  if (filters.leadId) where.push(eq(opsLeadActivities.leadId, filters.leadId as LeadRow['id']));
  const rows = await db
    .select({
      call: opsLeadActivities,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      isSample: opsLeads.isSample,
      doNotContact: opsLeads.doNotContact,
      staffName: staffMembers.fullName,
    })
    .from(opsLeadActivities)
    .innerJoin(opsLeads, eq(opsLeads.id, opsLeadActivities.leadId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsLeadActivities.staffId))
    .where(and(...where))
    .orderBy(desc(opsLeadActivities.occurredAt))
    .limit(500);
  return rows.map(({ call, ...rest }) => ({ ...call, ...rest }));
}
