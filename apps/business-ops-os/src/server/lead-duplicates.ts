/**
 * Lead contacts and duplicates (OPS-002, OPS-003): contact normalisation at the boundary,
 * own-scope coverage of a lead, duplicate matching and flags (never auto-merge), the
 * duplicate preview and the review queue. Merging itself lives in ./leads.ts.
 */
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import {
  opsAdmissions,
  opsDuplicateFlags,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { LeadId } from '@elevate/shared-types';
import {
  compareContacts,
  findDuplicateMatches,
  normaliseEmail,
  normalisePhone,
  PHONE_ERROR_MESSAGES,
  type ContactRecord,
  type DuplicateMatch,
} from '../domain';
import { accessScope, clean, type AccessScope, type Actor } from './context';
import { inOrder, opsAudit, rowById } from './ops-common';
import type { DuplicateCheckInput } from './schemas';

// --- contact normalisation at the boundary ----------------------------------------------------

const CONTACT_FIELDS = {
  studentPhone: 'phone',
  studentEmail: 'email',
  guardianPhone: 'phone',
  guardianEmail: 'email',
} as const;
type ContactField = keyof typeof CONTACT_FIELDS;
export const CONTACT_KEYS = Object.keys(CONTACT_FIELDS) as ContactField[];
export type NormalisedContacts = Record<ContactField, string | null>;

export const hasContact = (c: Partial<NormalisedContacts>) => CONTACT_KEYS.some((k) => c[k]);

/** Normalise the four contact fields; every invalid field is reported (400 with paths). */
export function normaliseContacts(
  input: Partial<Record<ContactField, string | null>>,
): NormalisedContacts {
  const details: { location: 'body'; path: string[]; message: string }[] = [];
  const out = {} as NormalisedContacts;
  for (const field of CONTACT_KEYS) {
    const raw = input[field];
    out[field] = null;
    if (raw === undefined || raw === null || raw.trim() === '') continue;
    if (CONTACT_FIELDS[field] === 'phone') {
      const r = normalisePhone(raw);
      if (r.ok) out[field] = r.e164;
      else
        details.push({ location: 'body', path: [field], message: PHONE_ERROR_MESSAGES[r.reason] });
    } else {
      const r = normaliseEmail(raw);
      if (r.ok) out[field] = r.email;
      else details.push({ location: 'body', path: [field], message: 'Not a valid email address.' });
    }
  }
  if (details.length > 0)
    throw new ValidationError('Some contact details are not valid.', { details });
  return out;
}

// --- access ------------------------------------------------------------------------------------

/** Own scope: the lead's owner, or the counsellor of any of its admissions. */
export async function leadCovered(
  db: Database,
  access: AccessScope,
  lead: Pick<typeof opsLeads.$inferSelect, 'id' | 'ownerStaffId'>,
) {
  if (access.scope === 'all') return true;
  if (!access.staffId) return false;
  if (lead.ownerStaffId === access.staffId) return true;
  const [row] = await db
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .where(
      and(eq(opsAdmissions.leadId, lead.id), eq(opsAdmissions.counsellorStaffId, access.staffId)),
    )
    .limit(1);
  return Boolean(row);
}

// --- duplicate detection -----------------------------------------------------------------------

export async function duplicateCandidates(
  db: Database,
  contacts: NormalisedContacts,
  previousSchool: string | null,
  excludeLeadId?: string,
): Promise<ContactRecord[]> {
  const phones = [contacts.studentPhone, contacts.guardianPhone].filter((v): v is string =>
    Boolean(v),
  );
  const emails = [contacts.studentEmail, contacts.guardianEmail].filter((v): v is string =>
    Boolean(v),
  );
  const conditions: SQL[] = [];
  if (phones.length)
    conditions.push(
      inArray(opsLeads.studentPhone, phones),
      inArray(opsLeads.guardianPhone, phones),
    );
  if (emails.length)
    conditions.push(
      inArray(opsLeads.studentEmail, emails),
      inArray(opsLeads.guardianEmail, emails),
    );
  if (previousSchool) conditions.push(isNotNull(opsLeads.previousSchool));
  if (conditions.length === 0) return [];
  const where = [isNull(opsLeads.mergedIntoLeadId), or(...conditions) as SQL];
  if (excludeLeadId) where.push(ne(opsLeads.id, excludeLeadId as LeadId));
  return db
    .select({
      id: opsLeads.id,
      code: opsLeads.code,
      studentName: opsLeads.studentName,
      studentPhone: opsLeads.studentPhone,
      studentEmail: opsLeads.studentEmail,
      guardianPhone: opsLeads.guardianPhone,
      guardianEmail: opsLeads.guardianEmail,
      previousSchool: opsLeads.previousSchool,
    })
    .from(opsLeads)
    .where(and(...where))
    .limit(2000);
}

/**
 * Merge guard (brief §5): leads whose names are not similar are never merged, whatever contact
 * they share — a parent's number often sits in the child's phone field for siblings.
 */
export const siblingsOnly = (a: ContactRecord, b: ContactRecord) =>
  !compareContacts(a, b)?.signals.includes('similar_name');

/** Duplicate matches for a lead that does not exist yet. */
export async function matchesForNew(
  db: Database,
  contacts: NormalisedContacts,
  studentName: string,
  previousSchool: string | null,
) {
  return findDuplicateMatches(
    { id: '', code: '', studentName, previousSchool, ...contacts },
    await duplicateCandidates(db, contacts, previousSchool),
  );
}

/** Record open duplicate flags for `leadId` (an existing flag for the pair is kept). */
export async function flagDuplicates(
  tx: Database,
  leadId: LeadId,
  matches: DuplicateMatch[],
  exactAcknowledgement: string | null = null,
) {
  for (const m of matches)
    await tx
      .insert(opsDuplicateFlags)
      .values({
        leadId,
        matchedLeadId: m.leadId as LeadId,
        level: m.level,
        signals: m.signals,
        acknowledgement: m.level === 'exact' ? exactAcknowledgement : null,
      })
      .onConflictDoNothing();
}

export interface VisibleDuplicate extends DuplicateMatch {
  /** False when the caller may not open the matched lead (own scope): only the code is shown. */
  accessible: boolean;
  studentName: string | null;
  ownerName: string | null;
}

export async function describeMatches(
  db: Database,
  access: AccessScope,
  matches: DuplicateMatch[],
): Promise<VisibleDuplicate[]> {
  if (matches.length === 0) return [];
  const rows = await db
    .select({
      id: opsLeads.id,
      studentName: opsLeads.studentName,
      ownerStaffId: opsLeads.ownerStaffId,
      ownerName: staffMembers.fullName,
    })
    .from(opsLeads)
    .leftJoin(staffMembers, eq(staffMembers.id, opsLeads.ownerStaffId))
    .where(
      inArray(
        opsLeads.id,
        matches.map((m) => m.leadId as LeadId),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  return inOrder(
    matches.map((m) => async () => {
      const r = byId.get(m.leadId);
      const accessible = r ? await leadCovered(db, access, r) : false;
      return {
        ...m,
        accessible,
        studentName: accessible ? (r?.studentName ?? null) : null,
        ownerName: r?.ownerName ?? null,
      };
    }),
  );
}

/** Preview: what duplicate warnings would a lead with these details raise? */
export async function checkDuplicates(db: Database, actor: Actor, input: DuplicateCheckInput) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contacts = normaliseContacts(input);
  const matches = await matchesForNew(db, contacts, input.studentName, clean(input.previousSchool));
  return { normalised: contacts, matches: await describeMatches(db, access, matches) };
}

// --- review queue ---------------------------------------------------------------------------------

/** Dismiss a duplicate warning after review ("different people"). */
export async function dismissDuplicateFlag(
  db: Database,
  actor: Actor,
  flagId: string,
  note: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:merge');
  return withTransaction(db, async (tx) => {
    const flag = await rowById(tx, opsDuplicateFlags, flagId, 'Duplicate flag', true);
    if (flag.status !== 'open') throw new ConflictError(`This flag is already ${flag.status}.`);
    const [after] = await tx
      .update(opsDuplicateFlags)
      .set({ status: 'dismissed', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note })
      .where(eq(opsDuplicateFlags.id, flag.id))
      .returning();
    await opsAudit('duplicate_flag')(
      tx,
      actor,
      flag.id,
      'duplicate.dismissed',
      { before: flag, after, metadata: { leadId: flag.leadId } },
      requestId,
    );
    return after;
  });
}

/** Open duplicate flags for the merge-review queue. */
export async function listDuplicateQueue(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:leads:merge');
  const rows = await db
    .select({ flag: opsDuplicateFlags, leadCode: opsLeads.code, leadName: opsLeads.studentName })
    .from(opsDuplicateFlags)
    .innerJoin(opsLeads, eq(opsLeads.id, opsDuplicateFlags.leadId))
    .where(eq(opsDuplicateFlags.status, 'open'))
    .orderBy(desc(opsDuplicateFlags.createdAt))
    .limit(200);
  const matchedIds = rows.map((r) => r.flag.matchedLeadId);
  const matched = matchedIds.length
    ? await db
        .select({ id: opsLeads.id, code: opsLeads.code, studentName: opsLeads.studentName })
        .from(opsLeads)
        .where(inArray(opsLeads.id, matchedIds))
    : [];
  const byId = new Map(matched.map((m) => [m.id as string, m]));
  return rows.map((r) => ({
    ...r.flag,
    leadCode: r.leadCode,
    leadName: r.leadName,
    matchedCode: byId.get(r.flag.matchedLeadId)?.code ?? null,
    matchedName: byId.get(r.flag.matchedLeadId)?.studentName ?? null,
  }));
}
