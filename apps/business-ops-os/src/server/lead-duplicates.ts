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
  type DuplicateLevel,
  type DuplicateMatch,
  type DuplicateSignal,
} from '../domain';
import { stripPrivateKeys } from '../domain/students';
import { accessScope, clean, type AccessScope, type Actor } from './context';
import { opsAudit, rowById } from './ops-common';
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

/** A duplicate as this caller sees it: the detail only on a lead they may open. */
export type VisibleDuplicate =
  | (DuplicateMatch & { accessible: true; studentName: string | null; ownerName: string | null })
  | { accessible: false; level: DuplicateLevel; studentName: null };

const NOT_CONTACT: readonly DuplicateSignal[] = ['similar_name', 'same_school'];
const STUDENT_SIDE: readonly string[] = [
  'student_phone',
  'student_email',
  'student_contact_is_guardian_contact',
];
const hiddenLevel = (signals: readonly string[]): DuplicateLevel =>
  signals.some((s) => STUDENT_SIDE.includes(s)) ? 'exact' : 'possible';

/**
 * Proposed, owner decides (HAT-005). A lead the caller may not open gives one warning per level:
 * no id, code, owner, signals, score or count. The level comes from the shared contact alone, so
 * guessing the name changes nothing. A match on name and school with no shared contact is left out
 * (it would confirm a hidden student from a name alone); it still reaches merge review on save.
 */
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
  const open: VisibleDuplicate[] = [];
  const hidden = new Set<DuplicateLevel>();
  for (const m of matches) {
    const r = byId.get(m.leadId);
    if (r && (await leadCovered(db, access, r)))
      open.push({
        leadId: m.leadId,
        code: m.code,
        level: m.level,
        signals: m.signals,
        nameSimilarity: m.nameSimilarity,
        accessible: true,
        studentName: r.studentName,
        ownerName: r.ownerName,
      });
    else if (m.signals.some((s) => !NOT_CONTACT.includes(s))) hidden.add(hiddenLevel(m.signals));
  }
  return [
    ...open,
    ...[...hidden].map((level) => ({ accessible: false as const, level, studentName: null })),
  ];
}

/** A saved flag with the other lead of its pair, and whether this reader may open that lead. */
export interface SeenFlag {
  flag: typeof opsDuplicateFlags.$inferSelect;
  otherId: LeadId;
  otherCode: string;
  open: boolean;
}

/** Saved flags for this reader, by the rule of describeMatches: both directions of a pair. */
export function visibleFlags(flags: SeenFlag[]) {
  const hidden = new Map(
    flags
      .filter((f) => !f.open)
      .map(({ flag }) => {
        const level = hiddenLevel(flag.signals);
        const row = { level, status: flag.status, otherAccessible: false as const };
        return [`${level}:${flag.status}`, row];
      }),
  );
  return [
    ...flags
      .filter((f) => f.open)
      .map((f) => ({
        ...f.flag,
        otherLeadId: f.otherId,
        otherCode: f.otherCode,
        otherAccessible: true as const,
      })),
    ...hidden.values(),
  ];
}

const FLAG_DETAIL: ReadonlySet<string> = new Set([
  'matchedLeadId',
  'level',
  'signals',
  'acknowledgement',
  'reviewNote',
  'reviewedBy',
]);

/**
 * An audit row for an own-scope reader, without a lead they may not open: lead.created names its
 * matches and a flag's row holds the whole flag. A flag not on this lead (a merged lead's) is hidden.
 */
export function withoutHiddenLeads<
  H extends { entityType: string; entityId: string | null; before: unknown; after: unknown; metadata: unknown },
>(row: H, flags: SeenFlag[]): H {
  if (row.entityType === 'duplicate_flag' && !flags.some((f) => f.open && f.flag.id === row.entityId))
    return {
      ...row,
      before: stripPrivateKeys(row.before, FLAG_DETAIL),
      after: stripPrivateKeys(row.after, FLAG_DETAIL),
    };
  const meta = row.metadata as { duplicates?: { code: string }[] } | null;
  if (!meta?.duplicates) return row;
  const open = (d: { code: string }) => flags.some((f) => f.open && f.otherCode === d.code);
  return { ...row, metadata: { ...meta, duplicates: meta.duplicates.filter(open) } };
}

/** A lookup of leads by contact details goes on record in the actor's name, never the details. */
export const auditDuplicateCheck = (
  db: Database,
  actor: Actor,
  contacts: NormalisedContacts,
  matches: DuplicateMatch[],
  requestId?: string,
) =>
  opsAudit('lead_duplicate_check')(
    db,
    actor,
    null,
    'lead.duplicate_check',
    {
      metadata: {
        searchedOn: CONTACT_KEYS.filter((k) => contacts[k]),
        results: matches.length,
        matchedLeadIds: matches.map((m) => m.leadId),
      },
    },
    requestId,
  );

/** Preview: what duplicate warnings would a lead with these details raise? */
export async function checkDuplicates(
  db: Database,
  actor: Actor,
  input: DuplicateCheckInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contacts = normaliseContacts(input);
  const matches = await matchesForNew(db, contacts, input.studentName, clean(input.previousSchool));
  await auditDuplicateCheck(db, actor, contacts, matches, requestId);
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
