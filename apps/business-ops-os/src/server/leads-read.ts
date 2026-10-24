/**
 * Lead list and lead record (OPS-001, OPS-005): list flags, the record with its enquiries,
 * activity, cases, follow-ups, duplicate flags and audit history (private fields masked).
 */
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  auditEvents,
  opsAdmissions,
  opsDuplicateFlags,
  opsEnquiries,
  opsFollowUps,
  opsLeadActivities,
  opsLeads,
  opsLeadSources,
  opsLeadStages,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { LeadId } from '@elevate/shared-types';
import {
  followUpFlags,
  isOpenStatus,
  istToday,
  istWeekContaining,
  type AdmissionStatus,
  type IsoDate,
} from '../domain';
import { CONTACT_AND_KYC_KEYS, KYC_KEY_SET, stripPrivateKeys } from '../domain/students';
import { programmeRef, staffRef } from './admissions';
import { accessScope, type AccessScope, type Actor } from './context';
import { leadCovered } from './lead-duplicates';
import {
  assertLeadAccess,
  canSeeLeadPrivate,
  getLeadRow,
  maskedLead,
  type LeadRow,
} from './leads-access';
import { admissionConversions, stageHistory } from './lead-stages';
import { loadSettings } from './settings';

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

/** SQL for the leads a scope covers (own: owner or counsellor of a case); null = none. */
export function leadScope(db: Database, access: AccessScope): SQL | null {
  if (access.scope === 'all') return sql`true`;
  if (!access.staffId) return null;
  return or(
    eq(opsLeads.ownerStaffId, access.staffId),
    inArray(
      opsLeads.id,
      db
        .select({ id: opsAdmissions.leadId })
        .from(opsAdmissions)
        .where(eq(opsAdmissions.counsellorStaffId, access.staffId)),
    ),
  ) as SQL;
}

export async function listLeads(
  db: Database,
  actor: Actor,
  filters: { q?: string; status?: AdmissionStatus; flag?: string } = {},
  now: Date = new Date(),
) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  if (!scope) return [];
  const conditions: SQL[] = [isNull(opsLeads.mergedIntoLeadId), scope];
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
      stageKey: lead.stageKey,
      doNotContact: lead.doNotContact,
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
  // Without admissions access (Marketing) a case is only its conversion stage (D-073).
  const cases = can(actor, 'ops:admissions:read');
  // Leads merged into this one: their history and stage history stay visible here (brief §11).
  const family = [
    lead.id,
    ...(
      await db
        .select({ id: opsLeads.id })
        .from(opsLeads)
        .where(eq(opsLeads.mergedIntoLeadId, lead.id))
    ).map((m) => m.id),
  ];
  const [
    enquiries,
    activities,
    admissions,
    followUps,
    flagsOut,
    flagsIn,
    history,
    stages,
    stageChanges,
    converted,
  ] = await Promise.all([
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
    leadHistory(db, family, cases),
    db.select().from(opsLeadStages).orderBy(asc(opsLeadStages.sortOrder)),
    stageHistory(db, family),
    admissionConversions(db, lead.id),
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
  const kycVisible = await canSeeLeadPrivate(db, actor, lead, true);
  return {
    lead: await maskedLead(db, actor, lead),
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
    admissions: admissions.map(({ admission: a, programmeCode, counsellorName }) =>
      cases
        ? { ...a, programmeCode, counsellorName }
        : {
            id: a.id,
            code: a.code,
            status: a.status,
            admissionNumber: a.admissionNumber,
            createdAt: a.createdAt,
            programmeCode,
          },
    ),
    // Admission follow-ups belong to the admissions case (D-073): only with case access.
    followUps: followUps
      .filter((f) => cases || f.followUp.admissionId === null)
      .map((f) => ({ ...f.followUp, ownerName: f.ownerName })),
    duplicates,
    stages,
    stageChanges,
    // Marketing sees number, status and meaning only; Ops case readers also get the case id.
    converted: converted.map(({ id, admissionNumber, status, conversion }) => ({
      admissionNumber,
      status,
      conversion,
      ...(cases ? { id } : {}),
    })),
    history: kycVisible
      ? history
      : history
          .filter((h) => h.action !== 'lead.kyc_updated')
          .map((h) => {
            const keys = privateVisible ? KYC_KEY_SET : CONTACT_AND_KYC_KEYS;
            return {
              ...h,
              before: stripPrivateKeys(h.before, keys),
              after: stripPrivateKeys(h.after, keys),
            };
          }),
  };
}

const LEAD_RECORDS = ['lead', 'enquiry', 'lead_activity', 'follow_up', 'duplicate_flag'];

/** Audit trail of a lead and everything linked to it; cases, demos, fees… only with `all`. */
async function leadHistory(db: Database, leadIds: LeadId[], all: boolean) {
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
          and(eq(auditEvents.entityType, 'lead'), inArray(auditEvents.entityId, leadIds)),
          inArray(sql`${auditEvents.metadata}->>'leadId'`, leadIds),
        ),
        all ? undefined : inArray(auditEvents.entityType, LEAD_RECORDS),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(300);
}
