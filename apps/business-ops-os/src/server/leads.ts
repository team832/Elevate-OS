/**
 * Leads and enquiries (OPS-001…OPS-006): capture with normalised contacts,
 * duplicate warnings (never auto-merge), assignment and acceptance, contact
 * attempts, explicit audited merge, and history.
 */
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
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
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { LeadId, ProgrammeId, StaffMemberId } from '@elevate/shared-types';
import {
  findDuplicateMatches,
  followUpFlags,
  isOpenStatus,
  normaliseEmail,
  normalisePhone,
  PHONE_ERROR_MESSAGES,
  type AdmissionStatus,
  type ContactRecord,
  type DuplicateMatch,
  type IsoDate,
} from '../domain';
import {
  accessScope,
  activeStaff,
  clean,
  nextCode,
  notFound,
  programmeByCode,
  staffIdForUser,
  userIdsForStaff,
  type AccessScope,
  type Actor,
} from './context';
import { createRuleFollowUp } from './follow-ups';
import { applyTransition, createAdmissionRecord, lockAdmission } from './pipeline';
import type {
  ActivityInput,
  CreateLeadInput,
  DuplicateCheckInput,
  EnquiryInput,
  UpdateLeadInput,
} from './schemas';
import { loadSettings } from './settings';

export type LeadRow = typeof opsLeads.$inferSelect;

const SUCCESSFUL_OUTCOMES = new Set(['connected_two_way', 'replied', 'visited']);

// --- contact normalisation at the boundary ----------------------------------------------------

interface NormalisedContacts {
  studentPhone: string | null;
  studentEmail: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
}

/** Normalise the four contact fields; every invalid field is reported (400 with paths). */
export function normaliseContacts(input: {
  studentPhone?: string | null;
  studentEmail?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
}): NormalisedContacts {
  const details: { location: 'body'; path: string[]; message: string }[] = [];
  const phone = (field: 'studentPhone' | 'guardianPhone') => {
    const raw = input[field];
    if (raw === undefined || raw === null || raw.trim() === '') return null;
    const r = normalisePhone(raw);
    if (r.ok) return r.e164;
    details.push({ location: 'body', path: [field], message: PHONE_ERROR_MESSAGES[r.reason] });
    return null;
  };
  const email = (field: 'studentEmail' | 'guardianEmail') => {
    const raw = input[field];
    if (raw === undefined || raw === null || raw.trim() === '') return null;
    const r = normaliseEmail(raw);
    if (r.ok) return r.email;
    details.push({ location: 'body', path: [field], message: 'Not a valid email address.' });
    return null;
  };
  const out = {
    studentPhone: phone('studentPhone'),
    studentEmail: email('studentEmail'),
    guardianPhone: phone('guardianPhone'),
    guardianEmail: email('guardianEmail'),
  };
  if (details.length > 0)
    throw new ValidationError('Some contact details are not valid.', { details });
  return out;
}

// --- access ------------------------------------------------------------------------------------

/** Own scope: the lead's owner, or the counsellor of any of its admissions. */
async function leadCovered(
  db: Database,
  access: AccessScope,
  lead: Pick<LeadRow, 'id' | 'ownerStaffId'>,
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

export async function assertLeadAccess(
  db: Database,
  access: AccessScope,
  lead: Pick<LeadRow, 'id' | 'ownerStaffId'>,
) {
  if (!(await leadCovered(db, access, lead)))
    throw new ForbiddenError('You can only work on leads assigned to you.');
}

function ownLeadFilter(db: Database, staffId: StaffMemberId): SQL {
  return or(
    eq(opsLeads.ownerStaffId, staffId),
    inArray(
      opsLeads.id,
      db
        .select({ id: opsAdmissions.leadId })
        .from(opsAdmissions)
        .where(eq(opsAdmissions.counsellorStaffId, staffId)),
    ),
  ) as SQL;
}

async function getLeadRow(db: Database, id: string, lock = false): Promise<LeadRow> {
  const q = db
    .select()
    .from(opsLeads)
    .where(eq(opsLeads.id, id as LeadId))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) notFound('Lead');
  return row;
}

// --- duplicate detection -----------------------------------------------------------------------

async function duplicateCandidates(
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

export interface VisibleDuplicate extends DuplicateMatch {
  /** False when the caller may not open the matched lead (own scope): only the code is shown. */
  accessible: boolean;
  studentName: string | null;
  ownerName: string | null;
}

async function describeMatches(
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
  const out: VisibleDuplicate[] = [];
  for (const m of matches) {
    const r = byId.get(m.leadId);
    const accessible = r
      ? await leadCovered(db, access, { id: r.id, ownerStaffId: r.ownerStaffId })
      : false;
    out.push({
      ...m,
      accessible,
      studentName: accessible ? (r?.studentName ?? null) : null,
      ownerName: r?.ownerName ?? null,
    });
  }
  return out;
}

/** Preview: what duplicate warnings would a lead with these details raise? */
export async function checkDuplicates(db: Database, actor: Actor, input: DuplicateCheckInput) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contacts = normaliseContacts(input);
  const candidates = await duplicateCandidates(db, contacts, clean(input.previousSchool));
  const matches = findDuplicateMatches(
    {
      id: '',
      code: '',
      studentName: input.studentName,
      previousSchool: clean(input.previousSchool),
      ...contacts,
    },
    candidates,
  );
  return { normalised: contacts, matches: await describeMatches(db, access, matches) };
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

export async function createLead(
  db: Database,
  actor: Actor,
  input: CreateLeadInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contacts = normaliseContacts(input);
  if (
    !contacts.studentPhone &&
    !contacts.studentEmail &&
    !contacts.guardianPhone &&
    !contacts.guardianEmail
  ) {
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

  return withTransaction(db, async (tx) => {
    const candidates = await duplicateCandidates(tx, contacts, previousSchool);
    const matches = findDuplicateMatches(
      { id: '', code: '', studentName: input.studentName, previousSchool, ...contacts },
      candidates,
    );
    const exact = matches.filter((m) => m.level === 'exact');
    if (exact.length > 0 && !input.acknowledgeDuplicates) {
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
        createdBy: actor.id,
      })
      .returning();
    if (!lead) throw new Error('lead insert returned no row');
    await tx.insert(opsEnquiries).values({
      leadId: lead.id,
      receivedAt,
      sourceCode: input.sourceCode,
      channel: clean(input.channel),
      discoverySource: clean(input.discoverySource),
      campaignRef: clean(input.campaignRef),
      contentRef: clean(input.contentRef),
      programmeId: programme?.id ?? null,
      interestMode: input.interestMode,
      notes: clean(input.notes),
      createdBy: actor.id,
    });
    const admission = await createAdmissionRecord(tx, {
      leadId: lead.id,
      programmeId: programme?.id ?? null,
      counsellorStaffId: ownerStaffId,
      createdBy: actor.id,
      requestId,
    });
    for (const m of matches) {
      await tx
        .insert(opsDuplicateFlags)
        .values({
          leadId: lead.id,
          matchedLeadId: m.leadId as LeadId,
          level: m.level,
          signals: m.signals,
          acknowledgement:
            m.level === 'exact' ? (input.acknowledgeDuplicates?.reason ?? null) : null,
        })
        .onConflictDoNothing();
    }
    await createRuleFollowUp(tx, {
      trigger: 'lead_received',
      eventAt: receivedAt,
      leadId: lead.id,
      admissionId: admission.id,
      ownerStaffId,
      settings,
      createdBy: actor.id,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lead.created',
      entityType: 'lead',
      entityId: lead.id,
      after: lead,
      requestId,
      metadata: {
        leadId: lead.id,
        duplicates: matches.map((m) => ({ code: m.code, level: m.level, signals: m.signals })),
        acknowledgement: input.acknowledgeDuplicates?.reason ?? null,
      },
    });
    if (owner?.userId && owner.userId !== actor.id) {
      await notify(tx, {
        userIds: [owner.userId],
        module: 'ops',
        kind: 'lead.assigned',
        title: `New lead assigned: ${lead.studentName} (${lead.code})`,
        body: 'Accept the handoff and make first contact.',
        link: `/ops/leads/${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
      });
    }
    return { lead, admission, duplicates: await describeMatches(tx, access, matches) };
  });
}

// --- read ---------------------------------------------------------------------------------------

export function assignmentStatus(
  lead: Pick<LeadRow, 'ownerStaffId' | 'acceptedAt'>,
): 'unassigned' | 'handoff_pending' | 'accepted' {
  if (!lead.ownerStaffId) return 'unassigned';
  return lead.acceptedAt ? 'accepted' : 'handoff_pending';
}

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
    conditions.push(ownLeadFilter(db, access.staffId));
  }
  if (filters.q) {
    const q = `%${filters.q.replace(/[%_]/g, '')}%`;
    conditions.push(
      or(sql`${opsLeads.studentName} ILIKE ${q}`, sql`${opsLeads.code} ILIKE ${q}`) as SQL,
    );
  }
  const leads = await db
    .select({ lead: opsLeads, ownerName: staffMembers.fullName, programmeCode: programmes.code })
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
  const rows = leads.map(({ lead, ownerName, programmeCode }) => {
    const mine = admissions
      .filter((a) => a.leadId === lead.id)
      .sort(
        (a, b) =>
          Number(isOpenStatus(b.status as AdmissionStatus)) -
            Number(isOpenStatus(a.status as AdmissionStatus)) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    const current = mine[0] ?? null;
    const open = current ? isOpenStatus(current.status as AdmissionStatus) : false;
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
      programmeCode,
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
        missingNextAction: open && fu.missingNextAction,
        openDuplicates: duplicateFlags.length,
        exactDuplicate: duplicateFlags.some((f) => f.level === 'exact'),
      },
    };
  });
  return rows.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    switch (filters.flag) {
      case 'unassigned':
        return r.assignment === 'unassigned';
      case 'handoff_pending':
        return r.assignment === 'handoff_pending';
      case 'overdue':
        return r.flags.overdue;
      case 'missing_next_action':
        return r.flags.missingNextAction;
      case 'duplicate':
        return r.flags.openDuplicates > 0;
      default:
        return true;
    }
  });
}

export async function getLead(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const lead = await getLeadRow(db, id);
  await assertLeadAccess(db, access, lead);
  const [owner] = lead.ownerStaffId
    ? await db
        .select({ id: staffMembers.id, fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, lead.ownerStaffId))
    : [];
  const [programme] = lead.programmeId
    ? await db
        .select({ code: programmes.code, name: programmes.name })
        .from(programmes)
        .where(eq(programmes.id, lead.programmeId))
    : [];
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
      db
        .select({
          flag: opsDuplicateFlags,
          otherCode: opsLeads.code,
          otherId: opsLeads.id,
          otherOwner: opsLeads.ownerStaffId,
        })
        .from(opsDuplicateFlags)
        .innerJoin(opsLeads, eq(opsLeads.id, opsDuplicateFlags.matchedLeadId))
        .where(eq(opsDuplicateFlags.leadId, lead.id)),
      db
        .select({
          flag: opsDuplicateFlags,
          otherCode: opsLeads.code,
          otherId: opsLeads.id,
          otherOwner: opsLeads.ownerStaffId,
        })
        .from(opsDuplicateFlags)
        .innerJoin(opsLeads, eq(opsLeads.id, opsDuplicateFlags.leadId))
        .where(eq(opsDuplicateFlags.matchedLeadId, lead.id)),
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
  return {
    lead,
    assignment: assignmentStatus(lead),
    owner: owner ?? null,
    programme: programme ?? null,
    enquiries: enquiries.map((e) => ({
      ...e.enquiry,
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
    history,
  };
}

/** Audit trail of a lead and everything linked to it (admissions, follow-ups, activities). */
export async function leadHistory(db: Database, leadId: string) {
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

export async function updateLead(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateLeadInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:leads:write');
  const contactPatch: Partial<NormalisedContacts> = {};
  const contactKeys = ['studentPhone', 'studentEmail', 'guardianPhone', 'guardianEmail'] as const;
  const touched = contactKeys.filter((k) => k in input);
  if (touched.length) {
    const normalised = normaliseContacts(input);
    for (const k of touched) contactPatch[k] = normalised[k];
  }
  const programmeId =
    'programmeCode' in input
      ? input.programmeCode
        ? (await programmeByCode(db, input.programmeCode)).id
        : null
      : undefined;
  return withTransaction(db, async (tx) => {
    const before = await getLeadRow(tx, id, true);
    await assertLeadAccess(tx, access, before);
    if (before.mergedIntoLeadId)
      throw new ConflictError('This lead was merged into another lead; edit that one.');
    const patch: Partial<typeof opsLeads.$inferInsert> = { ...contactPatch };
    const textKeys = [
      'preferredName',
      'schoolBoard',
      'previousSchool',
      'city',
      'guardianName',
      'notes',
    ] as const;
    for (const k of textKeys)
      if (k in input) patch[k] = clean(input[k] as string | null | undefined);
    if (input.studentName) patch.studentName = input.studentName.trim();
    if ('currentStage' in input) patch.currentStage = input.currentStage ?? null;
    if ('guardianRelationship' in input)
      patch.guardianRelationship = input.guardianRelationship ?? null;
    if (input.interestMode) patch.interestMode = input.interestMode;
    if (programmeId !== undefined) patch.programmeId = programmeId as ProgrammeId | null;
    const merged = { ...before, ...patch };
    if (
      !merged.studentPhone &&
      !merged.studentEmail &&
      !merged.guardianPhone &&
      !merged.guardianEmail
    )
      throw new ValidationError('A lead needs at least one phone number or email.');
    const [after] = await tx
      .update(opsLeads)
      .set(patch)
      .where(eq(opsLeads.id, before.id))
      .returning();
    // New contact details may reveal duplicates: flag them (never block an edit, never merge).
    if (touched.length || 'previousSchool' in input || input.studentName) {
      const candidates = await duplicateCandidates(tx, merged, merged.previousSchool, before.id);
      const matches = findDuplicateMatches({ ...merged, id: before.id }, candidates);
      for (const m of matches) {
        await tx
          .insert(opsDuplicateFlags)
          .values({
            leadId: before.id,
            matchedLeadId: m.leadId as LeadId,
            level: m.level,
            signals: m.signals,
          })
          .onConflictDoNothing();
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lead.updated',
      entityType: 'lead',
      entityId: before.id,
      before,
      after,
      requestId,
      metadata: { leadId: before.id },
    });
    return after as LeadRow;
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
    const lead = await getLeadRow(tx, leadId, true);
    await assertLeadAccess(tx, access, lead);
    if (lead.mergedIntoLeadId) throw new ConflictError('This lead was merged into another lead.');
    const [enquiry] = await tx
      .insert(opsEnquiries)
      .values({
        leadId: lead.id,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        sourceCode: input.sourceCode,
        channel: clean(input.channel),
        discoverySource: clean(input.discoverySource),
        campaignRef: clean(input.campaignRef),
        contentRef: clean(input.contentRef),
        programmeId: programme?.id ?? null,
        interestMode: input.interestMode,
        notes: clean(input.notes),
        createdBy: actor.id,
      })
      .returning();
    let admission = null;
    if (programme) {
      const open = await tx
        .select({ id: opsAdmissions.id, status: opsAdmissions.status })
        .from(opsAdmissions)
        .where(and(eq(opsAdmissions.leadId, lead.id), eq(opsAdmissions.programmeId, programme.id)));
      if (!open.some((a) => isOpenStatus(a.status as AdmissionStatus))) {
        admission = await createAdmissionRecord(tx, {
          leadId: lead.id,
          programmeId: programme.id,
          counsellorStaffId: lead.ownerStaffId,
          createdBy: actor.id,
          requestId,
        });
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'enquiry.created',
      entityType: 'enquiry',
      entityId: enquiry?.id ?? null,
      after: enquiry,
      requestId,
      metadata: { leadId: lead.id, openedAdmission: admission?.id ?? null },
    });
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
      if (!isOpenStatus(a.status as AdmissionStatus)) continue;
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lead.assigned',
      entityType: 'lead',
      entityId: before.id,
      before: { ownerStaffId: before.ownerStaffId },
      after: { ownerStaffId: owner.id },
      requestId,
      metadata: { leadId: before.id },
    });
    const recipients = await userIdsForStaff(tx, [owner.id]);
    if (recipients.length && recipients[0] !== actor.id) {
      await notify(tx, {
        userIds: recipients,
        module: 'ops',
        kind: 'lead.assigned',
        title: `Lead assigned to you: ${before.studentName} (${before.code})`,
        body: 'Accept the handoff to confirm you own the next action.',
        link: `/ops/leads/${before.id}`,
        entityType: 'lead',
        entityId: before.id,
      });
    }
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lead.accepted',
      entityType: 'lead',
      entityId: lead.id,
      after: { acceptedAt: after?.acceptedAt },
      requestId,
      metadata: { leadId: lead.id },
    });
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
      if (!lead.firstSuccessfulContactAt) {
        await tx
          .update(opsLeads)
          .set({ firstSuccessfulContactAt: occurredAt })
          .where(eq(opsLeads.id, lead.id));
      }
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
          actorType: 'user',
          actorUserId: actor.id,
          reason: `First successful contact (${input.kind})`,
          context: { hasSuccessfulContact: true },
          requestId,
          settings,
        });
        moved.push(a.id);
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'lead.contact_logged',
      entityType: 'lead_activity',
      entityId: activity?.id ?? null,
      after: activity,
      requestId,
      metadata: { leadId: lead.id, successful },
    });
    return { activity, successful, admissionsMovedToContacted: moved };
  });
}

// --- merge review -----------------------------------------------------------------------------------

/**
 * Explicit, audited merge of `sourceId` INTO `targetId` (OPS-003). Keeps both
 * enquiries and their sources (moved, marked `merged_from_lead_id`), moves
 * contact activity and lead-level follow-ups, fills only EMPTY contact fields of
 * the target, and closes the source's open admissions as lost ("merged"). Refused
 * when the source has an admitted or enrolment case (a human must resolve it).
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
    const [first, second] = [sourceId, targetId].sort();
    const locked = new Map<string, LeadRow>();
    for (const id of [first as string, second as string])
      locked.set(id, await getLeadRow(tx, id, true));
    const source = locked.get(sourceId) as LeadRow;
    const target = locked.get(targetId) as LeadRow;
    if (source.mergedIntoLeadId || target.mergedIntoLeadId)
      throw new ConflictError('One of these leads was already merged.');
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
      if (!isOpenStatus(a.status as AdmissionStatus)) continue;
      const row = await lockAdmission(tx, a.id);
      if (!row) continue;
      await applyTransition(tx, {
        admission: row,
        to: 'lost',
        actorType: 'user',
        actorUserId: actor.id,
        reason: `Merged duplicate into ${target.code}`,
        context: {},
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
    for (const k of [
      'studentPhone',
      'studentEmail',
      'guardianPhone',
      'guardianEmail',
      'guardianName',
      'previousSchool',
      'city',
    ] as const) {
      if (!target[k] && source[k]) fill[k] = source[k];
    }
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
    // Clear the source's unique-looking contacts? No: keep history intact; the source is excluded from matching once merged.
    const [mergedSource] = await tx
      .update(opsLeads)
      .set({ mergedIntoLeadId: target.id, mergedAt: new Date() })
      .where(eq(opsLeads.id, source.id))
      .returning();
    await tx
      .update(opsDuplicateFlags)
      .set({ status: 'merged', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note })
      .where(
        or(
          and(
            eq(opsDuplicateFlags.leadId, source.id),
            eq(opsDuplicateFlags.matchedLeadId, target.id),
          ),
          and(
            eq(opsDuplicateFlags.leadId, target.id),
            eq(opsDuplicateFlags.matchedLeadId, source.id),
          ),
        ),
      );
    for (const lead of [source, target]) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        module: 'ops',
        action: 'lead.merged',
        entityType: 'lead',
        entityId: lead.id,
        before: lead,
        after: lead.id === source.id ? mergedSource : { ...target, ...fill },
        requestId,
        metadata: { leadId: lead.id, sourceLeadId: source.id, targetLeadId: target.id, note },
      });
    }
    return { sourceCode: source.code, targetCode: target.code, targetId: target.id };
  });
}

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
    const [flag] = await tx
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.id, flagId as typeof opsDuplicateFlags.$inferSelect.id))
      .for('update');
    if (!flag) notFound('Duplicate flag');
    if (flag.status !== 'open') throw new ConflictError(`This flag is already ${flag.status}.`);
    const [after] = await tx
      .update(opsDuplicateFlags)
      .set({ status: 'dismissed', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note })
      .where(eq(opsDuplicateFlags.id, flag.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'duplicate.dismissed',
      entityType: 'duplicate_flag',
      entityId: flag.id,
      before: flag,
      after,
      requestId,
      metadata: { leadId: flag.leadId },
    });
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

/** Lead sources for forms (OPS-002). */
export async function listLeadSources(db: Database) {
  return db
    .select()
    .from(opsLeadSources)
    .where(eq(opsLeadSources.status, 'active'))
    .orderBy(opsLeadSources.sortOrder);
}
