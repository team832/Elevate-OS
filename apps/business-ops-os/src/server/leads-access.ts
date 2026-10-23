/**
 * Lead access shared by the lead services (./leads.ts, ./leads-read.ts, ./leads-actions.ts):
 * who may work on a lead, private-field masking (D-028) and the "lead assigned" notice.
 */
import { scopeFor } from '@elevate/authorization';
import { opsLeads, type Database } from '@elevate/database';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { omitKyc, redactStudentPrivate } from '../domain/students';
import { staffIdForUser, type AccessScope, type Actor } from './context';
import { leadCovered } from './lead-duplicates';
import { rowById } from './ops-common';
import { notifyHosted } from './task-links';

export type LeadRow = typeof opsLeads.$inferSelect;

export async function assertLeadAccess(
  db: Database,
  access: AccessScope,
  lead: Pick<LeadRow, 'id' | 'ownerStaffId'>,
) {
  if (!(await leadCovered(db, access, lead)))
    throw new ForbiddenError('You can only work on leads assigned to you.');
}

/**
 * Field-level protection (D-028): student and guardian contact details are
 * shown only to holders of `ops:student_private:read` — all records
 * (operations manager) or own scope (the counsellor who owns the lead or
 * counsels its admission). Director and auditor read leads without them.
 * Duplicate detection still reads contacts server-side. Marketing: `ops:lead_contacts:read`.
 */
export async function canSeeLeadPrivate(
  db: Database,
  actor: Actor,
  lead: Pick<LeadRow, 'id' | 'ownerStaffId'>,
  kyc = false,
): Promise<boolean> {
  // D-073 (Proposed): Marketing follows up on leads with ops:lead_contacts:read: the contact
  // fields on the lead itself. KYC columns (`kyc`) always need ops:student_private:read.
  const scope =
    scopeFor(actor, 'ops:student_private:read') ??
    (kyc ? null : scopeFor(actor, 'ops:lead_contacts:read'));
  if (scope === 'all') return true;
  if (scope !== 'own') return false;
  return leadCovered(db, { scope: 'own', staffId: await staffIdForUser(db, actor.id) }, lead);
}

/** The lead DTO: private fields removed unless the caller may see them. */
export async function maskedLead(db: Database, actor: Actor, lead: LeadRow) {
  const masked = redactStudentPrivate(lead, await canSeeLeadPrivate(db, actor, lead));
  return (await canSeeLeadPrivate(db, actor, lead, true)) ? masked : omitKyc(masked);
}

export const getLeadRow = (db: Database, id: string, lock = false) =>
  rowById(db, opsLeads, id, 'Lead', lock);

/** Lock a lead the caller may work on; merged leads are read-only. */
export async function lockWorkableLead(
  tx: Database,
  access: AccessScope,
  id: string,
  merged: string,
) {
  const lead = await getLeadRow(tx, id, true);
  await assertLeadAccess(tx, access, lead);
  if (lead.mergedIntoLeadId) throw new ConflictError(merged);
  return lead;
}

/** "Lead assigned" to the new owner (never to the person who assigned it). */
export async function notifyAssigned(
  tx: Database,
  actor: Actor,
  userIds: UserId[],
  lead: LeadRow,
  title: string,
  body: string,
) {
  await notifyHosted(tx, actor, userIds, 'leads', `/leads/${lead.id}`, {
    kind: 'lead.assigned',
    title: `${title}: ${lead.studentName} (${lead.code})`,
    body,
    entityType: 'lead',
    entityId: lead.id,
  });
}
