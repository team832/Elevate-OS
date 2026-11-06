/**
 * Leads and enquiries (OPS-001…OPS-006): capture with normalised contacts,
 * duplicate warnings (never auto-merge; matching and review in ./lead-duplicates.ts),
 * assignment and acceptance, contact attempts, explicit audited merge, and history.
 */
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import {
  opsAdmissions,
  opsEnquiries,
  opsLeads,
  opsLeadSources,
  students,
  type Database,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  enrolmentKeys,
  ForbiddenError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { LeadId, ProgrammeId, StaffMemberId, UserId } from '@elevate/shared-types';
import { findDuplicateMatches, isOpenStatus } from '../domain';
import {
  auditDuplicateCheck,
  CONTACT_KEYS,
  describeMatches,
  duplicateCandidates,
  flagDuplicates,
  hasContact,
  matchesForNew,
  normaliseContacts,
} from './lead-duplicates';
import {
  accessScope,
  activeStaff,
  clean,
  nextCode,
  programmeByCode,
  staffIdForUser,
  type Actor,
} from './context';
import { opsAudit } from './ops-common';
import { createRuleFollowUp } from './follow-ups';
import { shareNewLead } from './lead-sharing';
import { setInitialLeadStage } from './lead-stages';
import { createAdmissionRecord } from './pipeline';
import { lockWorkableLead, maskedLead, notifyAssigned, type LeadRow } from './leads-access';
import type { CreateLeadInput, EnquiryInput, UpdateLeadInput } from './schemas';
import { loadSettings } from './settings';

export type { LeadRow } from './leads-access';
export { getLead, LEAD_LIST_FLAGS, leadCounts, listLeads } from './leads-read';
export { acceptLead, assignLead, logActivity, mergeLeads } from './leads-actions';

async function assertSource(db: Database, code: string) {
  const [row] = await db
    .select()
    .from(opsLeadSources)
    .where(eq(opsLeadSources.code, code))
    .limit(1);
  if (!row || row.status !== 'active')
    throw new ValidationError(`Unknown or retired lead source "${code}".`, {
      details: [{ location: 'body', path: ['sourceCode'], message: 'Unknown lead source' }],
    });
}

/** The enquiry row of a capture or a later enquiry (each keeps its own source, BR-OPS-5). */
function enquiryValues(
  leadId: LeadId,
  input: EnquiryInput,
  programmeId: ProgrammeId | null,
  receivedAt: Date,
  createdBy: UserId,
) {
  return {
    leadId,
    receivedAt,
    sourceCode: input.sourceCode,
    channel: clean(input.channel),
    discoverySource: clean(input.discoverySource),
    campaignRef: clean(input.campaignRef),
    contentRef: clean(input.contentRef),
    programmeId,
    interestMode: input.interestMode,
    notes: clean(input.notes),
    createdBy,
  };
}

export async function createLead(
  db: Database,
  actor: Actor,
  /** `isSample` is for the development seed only (no route accepts it, D-036). */
  input: CreateLeadInput & { isSample?: boolean },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contacts = normaliseContacts(input);
  if (!hasContact(contacts)) {
    throw new ValidationError('Give at least one phone number or email (student or parent).', {
      details: [
        { location: 'body', path: ['studentPhone'], message: 'At least one contact is required' },
      ],
    });
  }
  await assertSource(db, input.sourceCode);
  const programme = input.programmeCode ? await programmeByCode(db, input.programmeCode) : null;
  let ownerStaffId: StaffMemberId | null =
    (input.ownerStaffId as StaffMemberId | null | undefined) ?? null;
  if (access.scope === 'own') {
    if (ownerStaffId && ownerStaffId !== access.staffId)
      throw new ForbiddenError(
        'You can only create leads owned by yourself; ask an operations manager to assign others.',
      );
    ownerStaffId = access.staffId;
  }
  let owner = ownerStaffId ? await activeStaff(db, ownerStaffId, 'ownerStaffId') : null;
  const actorStaffId = await staffIdForUser(db, actor.id);
  const settings = await loadSettings(db);
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const previousSchool = clean(input.previousSchool);
  const acknowledgement = input.acknowledgeDuplicates?.reason ?? null;

  const outcome = await withTransaction(db, async (tx) => {
    // The code lock first: a parallel save of the same contact is committed before this check.
    const code = await nextCode(tx, 'lead', 'ops.leads');
    const matches = await matchesForNew(tx, contacts, input.studentName, previousSchool);
    if (matches.some((m) => m.level === 'exact') && !input.acknowledgeDuplicates)
      return { refused: matches };
    // F4-16: a lead nobody owns goes to the next counsellor of its sharing rule (rule row locked).
    const sharing = ownerStaffId ? null : await shareNewLead(tx, settings, programme?.id ?? null);
    if (sharing?.owner) [owner, ownerStaffId] = [sharing.owner, sharing.owner.id];
    const now = new Date();
    const [inserted] = await tx
      .insert(opsLeads)
      .values({
        code,
        studentName: input.studentName.trim(),
        preferredName: clean(input.preferredName),
        ...contacts,
        currentStage: input.currentStage ?? null,
        schoolBoard: clean(input.schoolBoard),
        previousSchool,
        city: clean(input.city),
        guardianName: clean(input.guardianName),
        guardianRelationship: input.guardianRelationship ?? null,
        programmeId: programme?.id ?? null,
        interestMode: input.interestMode,
        firstReceivedAt: receivedAt,
        ownerStaffId,
        ownerAssignedAt: ownerStaffId ? now : null,
        acceptedAt: ownerStaffId && ownerStaffId === actorStaffId ? now : null,
        notes: clean(input.notes),
        isSample: input.isSample ?? false,
        createdBy: actor.id,
      })
      .returning();
    if (!inserted) throw new Error('lead insert returned no row');
    const lead = await setInitialLeadStage(tx, actor, inserted, requestId);
    await tx
      .insert(opsEnquiries)
      .values(enquiryValues(lead.id, input, programme?.id ?? null, receivedAt, actor.id));
    const admission = await createAdmissionRecord(tx, {
      leadId: lead.id,
      programmeId: programme?.id ?? null,
      counsellorStaffId: ownerStaffId,
      createdBy: actor.id,
      requestId,
    });
    await flagDuplicates(tx, lead.id, matches, acknowledgement);
    await createRuleFollowUp(tx, {
      trigger: 'lead_received',
      eventAt: receivedAt,
      leadId: lead.id,
      admissionId: admission.id,
      ownerStaffId,
      settings,
      createdBy: actor.id,
    });
    await opsAudit('lead')(
      tx,
      actor,
      lead.id,
      'lead.created',
      {
        after: lead,
        metadata: {
          leadId: lead.id,
          duplicates: matches.map((m) => ({ code: m.code, level: m.level, signals: m.signals })),
          acknowledgement,
          sharing: sharing && { ruleId: sharing.ruleId, outcome: sharing.outcome },
        },
      },
      requestId,
    );
    await notifyAssigned(
      tx,
      actor,
      owner?.userId ? [owner.userId] : [],
      lead,
      'New lead assigned',
      'Accept the handoff and make first contact.',
    );
    return {
      lead: await maskedLead(tx, actor, lead),
      admission,
      duplicates: await describeMatches(tx, access, matches),
    };
  });
  if (outcome.refused) {
    // Outside the transaction: a refusal saves nothing, but this lookup stays on record.
    await auditDuplicateCheck(db, actor, contacts, outcome.refused, requestId);
    throw new ConflictError(
      'This contact already exists. Attach a new enquiry to the existing lead, or confirm with a reason that this is a different person.',
      { details: { duplicates: await describeMatches(db, access, outcome.refused) } },
    );
  }
  return outcome;
}

/** Lead text fields: trimmed, empty → null. */
const TEXT_FIELDS = [
  'preferredName',
  'schoolBoard',
  'previousSchool',
  'city',
  'guardianName',
  'notes',
] as const;

/**
 * A corrected name reaches the canonical student and the person's other leads in this
 * transaction, and Academic through `ops.student.renamed` v1. Documents already issued keep the
 * name at issue (Proposed, the owner's question): see `admissionConfirmation`.
 */
async function renameStudent(
  tx: Database,
  actor: Actor,
  leadId: LeadRow['id'],
  fullName: string,
  requestId?: string,
) {
  const cases = await tx
    .selectDistinct({ id: opsAdmissions.studentId })
    .from(opsAdmissions)
    .where(and(eq(opsAdmissions.leadId, leadId), isNotNull(opsAdmissions.studentId)));
  const ids = cases.map((c) => c.id!);
  if (!ids.length) return;
  await tx
    .update(opsLeads)
    .set({ studentName: fullName })
    .where(
      inArray(
        opsLeads.id,
        tx
          .select({ id: opsAdmissions.leadId })
          .from(opsAdmissions)
          .where(inArray(opsAdmissions.studentId, ids)),
      ),
    );
  const renamed = await tx
    .update(students)
    .set({ fullName })
    .where(and(inArray(students.id, ids), ne(students.fullName, fullName)))
    .returning({ id: students.id });
  const renamedAt = new Date().toISOString();
  for (const { id } of renamed) {
    await opsAudit('student')(
      tx,
      actor,
      id,
      'student.renamed',
      { after: { fullName }, metadata: { leadId } },
      requestId,
    );
    await publishEvent(tx, {
      type: 'ops.student.renamed',
      version: 1,
      idempotencyKey: enrolmentKeys.renamed(id, renamedAt),
      payload: { coreStudentId: id, fullName, renamedAt, renamedByUserId: actor.id } as never,
    });
  }
}

export async function updateLead(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateLeadInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const touched = CONTACT_KEYS.filter((k) => k in input);
  const normalised = touched.length ? normaliseContacts(input) : null;
  const programmeId =
    'programmeCode' in input
      ? input.programmeCode
        ? (await programmeByCode(db, input.programmeCode)).id
        : null
      : undefined;
  return withTransaction(db, async (tx) => {
    const before = await lockWorkableLead(
      tx,
      access,
      id,
      'This lead was merged into another lead; edit that one.',
    );
    const patch: Partial<typeof opsLeads.$inferInsert> = {};
    for (const k of touched) patch[k] = normalised?.[k] ?? null;
    for (const k of TEXT_FIELDS)
      if (k in input) patch[k] = clean(input[k] as string | null | undefined);
    if (input.studentName) patch.studentName = input.studentName.trim();
    if ('currentStage' in input) patch.currentStage = input.currentStage ?? null;
    if ('guardianRelationship' in input)
      patch.guardianRelationship = input.guardianRelationship ?? null;
    if (input.interestMode) patch.interestMode = input.interestMode;
    if (programmeId !== undefined) patch.programmeId = programmeId as ProgrammeId | null;
    const merged = { ...before, ...patch };
    if (!hasContact(merged))
      throw new ValidationError('A lead needs at least one phone number or email.');
    const [after] = await tx
      .update(opsLeads)
      .set(patch)
      .where(eq(opsLeads.id, before.id))
      .returning();
    // New contact details may reveal duplicates: flag them (never block an edit, never merge).
    if (touched.length || 'previousSchool' in input || input.studentName) {
      const candidates = await duplicateCandidates(tx, merged, merged.previousSchool, before.id);
      await flagDuplicates(
        tx,
        before.id,
        findDuplicateMatches({ ...merged, id: before.id }, candidates),
      );
    }
    await opsAudit('lead')(
      tx,
      actor,
      before.id,
      'lead.updated',
      { before, after, metadata: { leadId: before.id } },
      requestId,
    );
    if (patch.studentName) await renameStudent(tx, actor, before.id, patch.studentName, requestId);
    return maskedLead(tx, actor, after as LeadRow);
  });
}

export async function addEnquiry(
  db: Database,
  actor: Actor,
  leadId: string,
  input: EnquiryInput,
  requestId?: string,
  /** False for the public website form: a stranger's post only adds a note (REV-W4 I2). */
  { openCase = true }: { openCase?: boolean } = {},
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  await assertSource(db, input.sourceCode);
  const programme = input.programmeCode ? await programmeByCode(db, input.programmeCode) : null;
  return withTransaction(db, async (tx) => {
    const lead = await lockWorkableLead(
      tx,
      access,
      leadId,
      'This lead was merged into another lead.',
    );
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const [enquiry] = await tx
      .insert(opsEnquiries)
      .values(enquiryValues(lead.id, input, programme?.id ?? null, receivedAt, actor.id))
      .returning();
    let admission = null;
    if (programme && openCase) {
      const open = await tx
        .select({ id: opsAdmissions.id, status: opsAdmissions.status })
        .from(opsAdmissions)
        .where(and(eq(opsAdmissions.leadId, lead.id), eq(opsAdmissions.programmeId, programme.id)));
      if (!open.some((a) => isOpenStatus(a.status)))
        admission = await createAdmissionRecord(tx, {
          leadId: lead.id,
          programmeId: programme.id,
          counsellorStaffId: lead.ownerStaffId,
          createdBy: actor.id,
          requestId,
        });
    }
    await opsAudit('enquiry')(
      tx,
      actor,
      enquiry?.id ?? null,
      'enquiry.created',
      { after: enquiry, metadata: { leadId: lead.id, openedAdmission: admission?.id ?? null } },
      requestId,
    );
    return { enquiry, admission };
  });
}

/** Lead sources for forms (OPS-002). */
export async function listLeadSources(db: Database) {
  return db
    .select()
    .from(opsLeadSources)
    .where(eq(opsLeadSources.status, 'active'))
    .orderBy(opsLeadSources.sortOrder);
}
