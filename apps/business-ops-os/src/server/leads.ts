/**
 * Leads and enquiries (OPS-001…OPS-006): capture with normalised contacts,
 * duplicate warnings (never auto-merge; matching and review in ./lead-duplicates.ts),
 * assignment and acceptance, contact attempts, explicit audited merge, and history.
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  auditEvents,
  opsAdmissions,
  opsDuplicateFlags,
  opsEnquiries,
  opsFollowUps,
  opsLeadActivities,
  opsLeads,
  opsLeadSources,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { can, scopeFor } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { LeadId, ProgrammeId, StaffMemberId, UserId } from '@elevate/shared-types';
import {
  findDuplicateMatches,
  followUpFlags,
  isOpenStatus,
  istToday,
  istWeekContaining,
  type AdmissionStatus,
  type IsoDate,
} from '../domain';
import { redactStudentPrivate, stripPrivateKeys } from '../domain/students';
import { programmeRef, staffRef } from './admissions';
import {
  CONTACT_KEYS,
  describeMatches,
  duplicateCandidates,
  flagDuplicates,
  hasContact,
  leadCovered,
  matchesForNew,
  normaliseContacts,
  siblingsOnly,
} from './lead-duplicates';
import {
  accessScope,
  activeStaff,
  clean,
  nextCode,
  programmeByCode,
  staffIdForUser,
  userIdsForStaff,
  type AccessScope,
  type Actor,
} from './context';
import { notifyOthers, opsAudit, rowById } from './ops-common';
import { createRuleFollowUp } from './follow-ups';
import {
  applyTransition,
  createAdmissionRecord,
  lockAdmission,
  lockLeadIdentity,
} from './pipeline';
import type { ActivityInput, CreateLeadInput, EnquiryInput, UpdateLeadInput } from './schemas';
import { loadSettings } from './settings';

export type LeadRow = typeof opsLeads.$inferSelect;

const SUCCESSFUL_OUTCOMES = new Set(['connected_two_way', 'replied', 'visited']);

// --- access ------------------------------------------------------------------------------------

async function assertLeadAccess(
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
 * Duplicate detection still reads contacts server-side.
 */
async function canSeeLeadPrivate(
  db: Database,
  actor: Actor,
  lead: Pick<LeadRow, 'id' | 'ownerStaffId'>,
): Promise<boolean> {
  const scope = scopeFor(actor, 'ops:student_private:read');
  if (scope === 'all') return true;
  if (scope !== 'own') return false;
  return leadCovered(db, { scope: 'own', staffId: await staffIdForUser(db, actor.id) }, lead);
}

/** The lead DTO: private fields removed unless the caller may see them. */
async function maskedLead(db: Database, actor: Actor, lead: LeadRow) {
  return redactStudentPrivate(lead, await canSeeLeadPrivate(db, actor, lead));
}

const getLeadRow = (db: Database, id: string, lock = false) =>
  rowById(db, opsLeads, id, 'Lead', lock);

/** Lock a lead the caller may work on; merged leads are read-only. */
async function lockWorkableLead(tx: Database, access: AccessScope, id: string, merged: string) {
  const lead = await getLeadRow(tx, id, true);
  await assertLeadAccess(tx, access, lead);
  if (lead.mergedIntoLeadId) throw new ConflictError(merged);
  return lead;
}

// --- create -------------------------------------------------------------------------------------

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

/** "Lead assigned" to the new owner (never to the person who assigned it). */
async function notifyAssigned(
  tx: Database,
  actor: Actor,
  userIds: UserId[],
  lead: LeadRow,
  title: string,
  body: string,
) {
  await notifyOthers(tx, actor, userIds, {
    kind: 'lead.assigned',
    title: `${title}: ${lead.studentName} (${lead.code})`,
    body,
    link: `/ops/leads/${lead.id}`,
    entityType: 'lead',
    entityId: lead.id,
  });
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
  const owner = ownerStaffId ? await activeStaff(db, ownerStaffId, 'ownerStaffId') : null;
  const actorStaffId = await staffIdForUser(db, actor.id);
  const settings = await loadSettings(db);
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const previousSchool = clean(input.previousSchool);
  const acknowledgement = input.acknowledgeDuplicates?.reason ?? null;

  return withTransaction(db, async (tx) => {
    const matches = await matchesForNew(tx, contacts, input.studentName, previousSchool);
    if (matches.some((m) => m.level === 'exact') && !input.acknowledgeDuplicates) {
      throw new ConflictError(
        'This contact already exists. Attach a new enquiry to the existing lead, or confirm with a reason that this is a different person.',
        { details: { duplicates: await describeMatches(tx, access, matches) } },
      );
    }
    const code = await nextCode(tx, 'lead', 'ops.leads');
    const now = new Date();
    const [lead] = await tx
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
    if (!lead) throw new Error('lead insert returned no row');
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
}

// --- read ---------------------------------------------------------------------------------------

function assignmentStatus(
  lead: Pick<LeadRow, 'ownerStaffId' | 'acceptedAt'>,
): 'unassigned' | 'handoff_pending' | 'accepted' {
  if (!lead.ownerStaffId) return 'unassigned';
  return lead.acceptedAt ? 'accepted' : 'handoff_pending';
}

type LeadListRow = {
  assignment: ReturnType<typeof assignmentStatus>;
  flags: {
    overdue: boolean;
    missingNextAction: boolean;
    openDuplicates: number;
    newThisWeek: boolean;
    awaitingContact: boolean;
  };
};

/** The `flag` filters of the lead list (an unknown flag filters nothing); pages count with them too. */
export const LEAD_LIST_FLAGS = new Map<string, (r: LeadListRow) => boolean>([
  ['new_this_week', (r) => r.flags.newThisWeek],
  ['awaiting_contact', (r) => r.flags.awaitingContact],
  ['unassigned', (r) => r.assignment === 'unassigned'],
  ['handoff_pending', (r) => r.assignment === 'handoff_pending'],
  ['overdue', (r) => r.flags.overdue],
  ['missing_next_action', (r) => r.flags.missingNextAction],
  ['duplicate', (r) => r.flags.openDuplicates > 0],
]);

export async function listLeads(
  db: Database,
  actor: Actor,
  filters: { q?: string; status?: AdmissionStatus; flag?: string } = {},
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const conditions: SQL[] = [isNull(opsLeads.mergedIntoLeadId)];
  if (access.scope === 'own') {
    if (!access.staffId) return [];
    conditions.push(
      or(
        eq(opsLeads.ownerStaffId, access.staffId),
        inArray(
          opsLeads.id,
          db
            .select({ id: opsAdmissions.leadId })
            .from(opsAdmissions)
            .where(eq(opsAdmissions.counsellorStaffId, access.staffId)),
        ),
      ) as SQL,
    );
  }
  if (filters.q) {
    const q = `%${filters.q.replace(/[%_]/g, '')}%`;
    conditions.push(
      or(sql`${opsLeads.studentName} ILIKE ${q}`, sql`${opsLeads.code} ILIKE ${q}`) as SQL,
    );
  }
  const leads = await db
    .select({
      lead: opsLeads,
      ownerName: staffMembers.fullName,
      programmeCode: programmes.code,
      programmeName: programmes.name,
    })
    .from(opsLeads)
    .leftJoin(staffMembers, eq(staffMembers.id, opsLeads.ownerStaffId))
    .leftJoin(programmes, eq(programmes.id, opsLeads.programmeId))
    .where(and(...conditions))
    .orderBy(desc(opsLeads.firstReceivedAt), desc(opsLeads.code))
    .limit(500);
  const ids = leads.map((l) => l.lead.id);
  if (ids.length === 0) return [];
  const [admissions, followUps, flags] = await Promise.all([
    db.select().from(opsAdmissions).where(inArray(opsAdmissions.leadId, ids)),
    db
      .select({
        leadId: opsFollowUps.leadId,
        status: opsFollowUps.status,
        dueDate: opsFollowUps.dueDate,
      })
      .from(opsFollowUps)
      .where(and(inArray(opsFollowUps.leadId, ids), eq(opsFollowUps.status, 'open'))),
    db
      .select({
        leadId: opsDuplicateFlags.leadId,
        matched: opsDuplicateFlags.matchedLeadId,
        level: opsDuplicateFlags.level,
      })
      .from(opsDuplicateFlags)
      .where(
        and(
          eq(opsDuplicateFlags.status, 'open'),
          or(inArray(opsDuplicateFlags.leadId, ids), inArray(opsDuplicateFlags.matchedLeadId, ids)),
        ),
      ),
  ]);
  const settings = await loadSettings(db);
  const window = settings['followups.due_rules'].value.upcomingWindowDays;
  const isOpen = (a: { status: AdmissionStatus }) => isOpenStatus(a.status);
  const weekStart = istWeekContaining(istToday(now)).from;
  const rows = leads.map(({ lead, ownerName, programmeCode, programmeName }) => {
    const current =
      admissions
        .filter((a) => a.leadId === lead.id)
        .sort(
          (a, b) =>
            Number(isOpen(b)) - Number(isOpen(a)) || b.createdAt.getTime() - a.createdAt.getTime(),
        )[0] ?? null;
    const fu = followUpFlags(
      followUps
        .filter((f) => f.leadId === lead.id)
        .map((f) => ({ status: f.status, dueDate: f.dueDate as IsoDate })),
      now,
      window,
    );
    const duplicateFlags = flags.filter((f) => f.leadId === lead.id || f.matched === lead.id);
    return {
      id: lead.id,
      code: lead.code,
      studentName: lead.studentName,
      isSample: lead.isSample,
      programmeCode,
      programmeName,
      ownerStaffId: lead.ownerStaffId,
      ownerName,
      receivedAt: lead.firstReceivedAt,
      assignment: assignmentStatus(lead),
      admissionId: current?.id ?? null,
      status: (current?.status as AdmissionStatus | undefined) ?? null,
      handoffStatus: current?.handoffStatus ?? null,
      flags: {
        overdue: fu.overdue,
        dueToday: fu.dueToday,
        missingNextAction: (current ? isOpen(current) : false) && fu.missingNextAction,
        openDuplicates: duplicateFlags.length,
        exactDuplicate: duplicateFlags.some((f) => f.level === 'exact'),
        newThisWeek: istToday(lead.firstReceivedAt) >= weekStart,
        // An open lead nobody has reached two-way yet (BR-OPS-4).
        awaitingContact: !lead.firstSuccessfulContactAt && (!current || isOpen(current)),
      },
    };
  });
  const flagFilter = filters.flag ? LEAD_LIST_FLAGS.get(filters.flag) : undefined;
  return rows.filter(
    (r) => (!filters.status || r.status === filters.status) && (!flagFilter || flagFilter(r)),
  );
}

/** Duplicate flags of a lead in one direction, with the other lead of each pair. */
function flagsOf(db: Database, leadId: LeadId, side: 'leadId' | 'matchedLeadId') {
  const other = side === 'leadId' ? opsDuplicateFlags.matchedLeadId : opsDuplicateFlags.leadId;
  return db
    .select({
      flag: opsDuplicateFlags,
      otherCode: opsLeads.code,
      otherId: opsLeads.id,
      otherOwner: opsLeads.ownerStaffId,
    })
    .from(opsDuplicateFlags)
    .innerJoin(opsLeads, eq(opsLeads.id, other))
    .where(eq(opsDuplicateFlags[side], leadId));
}

export async function getLead(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const lead = await getLeadRow(db, id);
  await assertLeadAccess(db, access, lead);
  const [enquiries, activities, admissions, followUps, flagsOut, flagsIn, history] =
    await Promise.all([
      db
        .select({
          enquiry: opsEnquiries,
          sourceLabel: opsLeadSources.label,
          programmeCode: programmes.code,
        })
        .from(opsEnquiries)
        .innerJoin(opsLeadSources, eq(opsLeadSources.code, opsEnquiries.sourceCode))
        .leftJoin(programmes, eq(programmes.id, opsEnquiries.programmeId))
        .where(eq(opsEnquiries.leadId, lead.id))
        .orderBy(desc(opsEnquiries.receivedAt)),
      db
        .select({ activity: opsLeadActivities, staffName: staffMembers.fullName })
        .from(opsLeadActivities)
        .leftJoin(staffMembers, eq(staffMembers.id, opsLeadActivities.staffId))
        .where(eq(opsLeadActivities.leadId, lead.id))
        .orderBy(desc(opsLeadActivities.occurredAt)),
      db
        .select({
          admission: opsAdmissions,
          programmeCode: programmes.code,
          counsellorName: staffMembers.fullName,
        })
        .from(opsAdmissions)
        .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
        .leftJoin(staffMembers, eq(staffMembers.id, opsAdmissions.counsellorStaffId))
        .where(eq(opsAdmissions.leadId, lead.id))
        .orderBy(desc(opsAdmissions.createdAt)),
      db
        .select({ followUp: opsFollowUps, ownerName: staffMembers.fullName })
        .from(opsFollowUps)
        .innerJoin(staffMembers, eq(staffMembers.id, opsFollowUps.ownerStaffId))
        .where(eq(opsFollowUps.leadId, lead.id))
        .orderBy(desc(opsFollowUps.dueDate)),
      flagsOf(db, lead.id, 'leadId'),
      flagsOf(db, lead.id, 'matchedLeadId'),
      leadHistory(db, lead.id),
    ]);
  const duplicates = await Promise.all(
    [...flagsOut, ...flagsIn].map(async (f) => ({
      ...f.flag,
      otherLeadId: f.otherId,
      otherCode: f.otherCode,
      otherAccessible: await leadCovered(db, access, { id: f.otherId, ownerStaffId: f.otherOwner }),
    })),
  );
  const privateVisible = await canSeeLeadPrivate(db, actor, lead);
  return {
    lead: redactStudentPrivate(lead, privateVisible),
    privateVisible,
    assignment: assignmentStatus(lead),
    owner: await staffRef(db, lead.ownerStaffId),
    programme: await programmeRef(db, lead.programmeId),
    enquiries: enquiries.map((e) => ({
      ...e.enquiry,
      // Campaign internals only for roles allowed to see marketing attribution (brief §10).
      ...(can(actor, 'ops:lead_attribution:read') ? {} : { campaignRef: null, contentRef: null }),
      sourceLabel: e.sourceLabel,
      programmeCode: e.programmeCode,
    })),
    activities: activities.map((a) => ({ ...a.activity, staffName: a.staffName })),
    admissions: admissions.map((a) => ({
      ...a.admission,
      programmeCode: a.programmeCode,
      counsellorName: a.counsellorName,
    })),
    followUps: followUps.map((f) => ({ ...f.followUp, ownerName: f.ownerName })),
    duplicates,
    history: privateVisible
      ? history
      : history.map((h) => ({
          ...h,
          before: stripPrivateKeys(h.before),
          after: stripPrivateKeys(h.after),
        })),
  };
}

/** Audit trail of a lead and everything linked to it (admissions, follow-ups, activities). */
async function leadHistory(db: Database, leadId: string) {
  return db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      actorType: auditEvents.actorType,
      actorUserId: auditEvents.actorUserId,
      before: auditEvents.before,
      after: auditEvents.after,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        or(
          and(eq(auditEvents.entityType, 'lead'), eq(auditEvents.entityId, leadId)),
          sql`${auditEvents.metadata}->>'leadId' = ${leadId}`,
        ),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(300);
}

// --- update, enquiries, assignment, activity --------------------------------------------------------

/** Lead text fields: trimmed, empty → null. */
const TEXT_FIELDS = [
  'preferredName',
  'schoolBoard',
  'previousSchool',
  'city',
  'guardianName',
  'notes',
] as const;

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
    return maskedLead(tx, actor, after as LeadRow);
  });
}

export async function addEnquiry(
  db: Database,
  actor: Actor,
  leadId: string,
  input: EnquiryInput,
  requestId?: string,
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
    if (programme) {
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
  input: ActivityInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const staffId = await staffIdForUser(db, actor.id);
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const lead = await getLeadRow(tx, leadId, true);
    await assertLeadAccess(tx, access, lead);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000)
      throw new ValidationError('A contact attempt cannot be in the future.');
    const [activity] = await tx
      .insert(opsLeadActivities)
      .values({
        leadId: lead.id,
        kind: input.kind,
        outcome: input.outcome,
        occurredAt,
        note: clean(input.note),
        staffId,
        createdBy: actor.id,
      })
      .returning();
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
    return { activity, successful, admissionsMovedToContacted: moved };
  });
}

// --- merge review -----------------------------------------------------------------------------------

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

/** Lead sources for forms (OPS-002). */
export async function listLeadSources(db: Database) {
  return db
    .select()
    .from(opsLeadSources)
    .where(eq(opsLeadSources.status, 'active'))
    .orderBy(opsLeadSources.sortOrder);
}
