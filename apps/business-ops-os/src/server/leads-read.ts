/**
 * Lead list and lead record (OPS-001, OPS-005): list flags, the record with its enquiries,
 * activity, cases, follow-ups, duplicate flags and audit history (private fields masked).
 */
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { containsPattern } from '@elevate/server-kit';
import { alias } from 'drizzle-orm/pg-core';
import { can } from '@elevate/authorization';
import {
  users,
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
import type { LeadId, StaffMemberId } from '@elevate/shared-types';
import {
  ADMISSION_STATUSES,
  isOpenStatus,
  istInstant,
  istToday,
  istWeekContaining,
  type AdmissionStatus,
} from '../domain';
import { CONTACT_AND_KYC_KEYS, KYC_KEY_SET, stripPrivateKeys } from '../domain/students';
import { programmeRef, staffRef } from './admissions';
import { accessScope, type AccessScope, type Actor } from './context';
import { leadCovered, visibleFlags, withoutHiddenLeads } from './lead-duplicates';
import {
  assertLeadAccess,
  canSeeLeadPrivate,
  getLeadRow,
  maskedLead,
  type LeadRow,
} from './leads-access';
import { admissionConversions, stageHistory } from './lead-stages';

function assignmentStatus(
  lead: Pick<LeadRow, 'ownerStaffId' | 'acceptedAt'>,
): 'unassigned' | 'handoff_pending' | 'accepted' {
  if (!lead.ownerStaffId) return 'unassigned';
  return lead.acceptedAt ? 'accepted' : 'handoff_pending';
}

/** The `flag` filters of the lead list; each is the same SQL as the row's own flag. */
export const LEAD_LIST_FLAGS = [
  'new_this_week',
  'awaiting_contact',
  'unassigned',
  'handoff_pending',
  'overdue',
  'due_today',
  'missing_next_action',
  'duplicate',
] as const;
export type LeadFlag = (typeof LEAD_LIST_FLAGS)[number];

const NOT_OPEN = ADMISSION_STATUSES.filter((s) => !isOpenStatus(s));
/** The case a lead's row shows: an open one first, then the newest. */
const currentCase = alias(opsAdmissions, 'current_case');
const isCurrentCase = eq(
  currentCase.id,
  sql`(select a.id from ops.admissions a where a.lead_id = ${opsLeads.id}
        order by a.status in ${NOT_OPEN}, a.created_at desc, a.id desc limit 1)`,
);
const hasOpenCase = sql<boolean>`(${currentCase.id} is not null and ${currentCase.status} not in ${NOT_OPEN})`;
const openFollowUp = (due: SQL) =>
  sql<boolean>`exists (select 1 from ops.follow_ups f where f.lead_id = ${opsLeads.id} and f.status = 'open' and ${due})`;
const openDuplicate = (also: SQL) =>
  sql`from ops.duplicate_flags d where d.status = 'open' and (d.lead_id = ${opsLeads.id} or d.matched_lead_id = ${opsLeads.id}) and ${also}`;

/** Each flag as SQL, so a tile or filter can count it over every lead, not over a page of rows. */
function leadFlags(now: Date, actor: Actor): Record<LeadFlag, SQL<boolean>> {
  const today = istToday(now);
  // A case's follow-ups are the case's (D-073): without case access they make nothing due.
  const seen = can(actor, 'ops:admissions:read') ? sql`true` : sql`f.admission_id is null`;
  const weekStart = istInstant(istWeekContaining(today).from).toISOString();
  return {
    new_this_week: sql`${opsLeads.firstReceivedAt} >= ${weekStart}`,
    // An open lead nobody has reached two-way yet (BR-OPS-4).
    awaiting_contact: sql`(${opsLeads.firstSuccessfulContactAt} is null and (${currentCase.id} is null or ${hasOpenCase}))`,
    unassigned: sql`${opsLeads.ownerStaffId} is null`,
    handoff_pending: sql`(${opsLeads.ownerStaffId} is not null and ${opsLeads.acceptedAt} is null)`,
    overdue: openFollowUp(sql`f.due_date < ${today} and ${seen}`),
    due_today: openFollowUp(sql`f.due_date = ${today} and ${seen}`),
    missing_next_action: sql`(${hasOpenCase} and not ${openFollowUp(sql`true`)})`,
    duplicate: sql`exists (select 1 ${openDuplicate(sql`true`)})`,
  };
}

export type LeadFilters = {
  q?: string;
  status?: AdmissionStatus;
  /** null: leads without a stage. */
  leadStage?: string | null;
  flag?: LeadFlag;
  /** Any of these flags. */
  anyFlag?: readonly LeadFlag[];
  ownerStaffId?: string;
};

function leadWhere(scope: SQL, f: LeadFilters, flags: ReturnType<typeof leadFlags>) {
  const q = f.q && containsPattern(f.q);
  return and(
    isNull(opsLeads.mergedIntoLeadId),
    scope,
    q ? or(sql`${opsLeads.studentName} ILIKE ${q}`, sql`${opsLeads.code} ILIKE ${q}`) : undefined,
    f.status ? eq(currentCase.status, f.status) : undefined,
    f.leadStage === null
      ? isNull(opsLeads.stageKey)
      : f.leadStage
        ? eq(opsLeads.stageKey, f.leadStage)
        : undefined,
    f.ownerStaffId ? eq(opsLeads.ownerStaffId, f.ownerStaffId as StaffMemberId) : undefined,
    f.flag ? flags[f.flag] : undefined,
    f.anyFlag ? or(...f.anyFlag.map((k) => flags[k])) : undefined,
  );
}

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

/**
 * Leads under the filters, newest first: `limit` (default 500) from `offset`. A count over the
 * same filters is `leadCounts`, never the length of this list.
 */
export async function listLeads(
  db: Database,
  actor: Actor,
  filters: LeadFilters & { limit?: number; offset?: number } = {},
  now: Date = new Date(),
) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  if (!scope) return [];
  const flags = leadFlags(now, actor);
  const rows = await db
    .select({
      lead: opsLeads,
      ownerName: staffMembers.fullName,
      programmeCode: programmes.code,
      programmeName: programmes.name,
      admissionId: currentCase.id,
      status: currentCase.status,
      handoffStatus: currentCase.handoffStatus,
      newThisWeek: flags.new_this_week,
      awaitingContact: flags.awaiting_contact,
      overdue: flags.overdue,
      dueToday: flags.due_today,
      missingNextAction: flags.missing_next_action,
      openDuplicates: sql`(select count(*) ${openDuplicate(sql`true`)})`.mapWith(Number),
      exactDuplicate: sql<boolean>`exists (select 1 ${openDuplicate(sql`d.level = 'exact'`)})`,
    })
    .from(opsLeads)
    .leftJoin(currentCase, isCurrentCase)
    .leftJoin(staffMembers, eq(staffMembers.id, opsLeads.ownerStaffId))
    .leftJoin(programmes, eq(programmes.id, opsLeads.programmeId))
    .where(leadWhere(scope, filters, flags))
    .orderBy(desc(opsLeads.firstReceivedAt), desc(opsLeads.code))
    .limit(filters.limit ?? 500)
    .offset(filters.offset ?? 0);
  return rows.map(({ lead, ...r }) => ({
    id: lead.id,
    code: lead.code,
    studentName: lead.studentName,
    isSample: lead.isSample,
    stageKey: lead.stageKey,
    doNotContact: lead.doNotContact,
    programmeCode: r.programmeCode,
    programmeName: r.programmeName,
    ownerStaffId: lead.ownerStaffId,
    ownerName: r.ownerName,
    receivedAt: lead.firstReceivedAt,
    assignment: assignmentStatus(lead),
    admissionId: r.admissionId,
    status: r.status as AdmissionStatus | null,
    handoffStatus: r.handoffStatus,
    flags: {
      overdue: r.overdue,
      dueToday: r.dueToday,
      missingNextAction: r.missingNextAction,
      openDuplicates: r.openDuplicates,
      exactDuplicate: r.exactDuplicate,
      newThisWeek: r.newThisWeek,
      awaitingContact: r.awaitingContact,
    },
  }));
}

/** How many leads match, in SQL over the whole set: in all, per current case status, and how many are sample. */
export async function leadCounts(
  db: Database,
  actor: Actor,
  filters: LeadFilters = {},
  now: Date = new Date(),
) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  const rows = scope
    ? await db
        .select({
          status: currentCase.status,
          n: count(),
          samples: sql`count(*) filter (where ${opsLeads.isSample})`.mapWith(Number),
        })
        .from(opsLeads)
        .leftJoin(currentCase, isCurrentCase)
        .where(leadWhere(scope, filters, leadFlags(now, actor)))
        .groupBy(currentCase.status)
    : [];
  return {
    total: rows.reduce((n, r) => n + r.n, 0),
    samples: rows.reduce((n, r) => n + r.samples, 0),
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
      Record<AdmissionStatus, number>
    >,
  };
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
  const flags = await Promise.all(
    [...flagsOut, ...flagsIn].map(async (f) => ({
      ...f,
      open: await leadCovered(db, access, { id: f.otherId, ownerStaffId: f.otherOwner }),
    })),
  );
  const privateVisible = await canSeeLeadPrivate(db, actor, lead);
  const kycVisible = await canSeeLeadPrivate(db, actor, lead, true);
  const attribution = can(actor, 'ops:lead_attribution:read');
  // Keys the audit history must not show this reader (enquiry.created carries campaign refs).
  const hidden = new Set([
    ...(kycVisible ? [] : privateVisible ? KYC_KEY_SET : CONTACT_AND_KYC_KEYS),
    ...(attribution ? [] : ['campaignRef', 'contentRef']),
  ]);
  return {
    lead: await maskedLead(db, actor, lead),
    privateVisible,
    assignment: assignmentStatus(lead),
    owner: await staffRef(db, lead.ownerStaffId),
    programme: await programmeRef(db, lead.programmeId),
    enquiries: enquiries.map((e) => ({
      ...e.enquiry,
      // Campaign internals only for roles allowed to see marketing attribution (brief §10).
      ...(attribution ? {} : { campaignRef: null, contentRef: null }),
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
    duplicates: visibleFlags(flags),
    stages,
    stageChanges,
    // Marketing sees number, status and meaning only; Ops case readers also get the case id.
    converted: converted.map(({ id, admissionNumber, status, conversion }) => ({
      admissionNumber,
      status,
      conversion,
      ...(cases ? { id } : {}),
    })),
    history: history
      .filter((h) => kycVisible || h.action !== 'lead.kyc_updated')
      .map((h) => (access.scope === 'all' ? h : withoutHiddenLeads(h, flags)))
      .map((h) => ({
        ...h,
        before: stripPrivateKeys(h.before, hidden),
        after: stripPrivateKeys(h.after, hidden),
      })),
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
      actorName: users.displayName,
      before: auditEvents.before,
      after: auditEvents.after,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        or(
          and(eq(auditEvents.entityType, 'lead'), inArray(auditEvents.entityId, leadIds)),
          inArray(sql`${auditEvents.metadata}->>'leadId'`, leadIds),
        ),
        all ? undefined : inArray(auditEvents.entityType, LEAD_RECORDS),
        // A case's follow-up is the case's (D-073), its audit rows too.
        all
          ? undefined
          : sql`not (${auditEvents.entityType} = 'follow_up' and coalesce(${auditEvents.after}->>'admissionId', ${auditEvents.before}->>'admissionId') is not null)`,
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(300);
}
