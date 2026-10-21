/**
 * Admissions dashboard (OPS-078): loads plain rows and hands them to the pure
 * KPI functions in domain/admissions-kpis.ts and domain/kpis.ts (cohort
 * conversion reused). Definitions: docs/parts/admissions.md → "KPI definitions".
 *
 * Permission `ops:admissions:read`. With scope `own` (counsellor) every row is
 * limited to the counsellor's leads and admissions and the page says so.
 * Missing is never zero: rates with no denominator are `missing`.
 */
import { and, asc, desc, eq, inArray, isNull, or, type SQL, type SQLWrapper } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  approvals,
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsAdmissionTransitions,
  opsAppointments,
  opsDemos,
  opsDemoSessions,
  opsEnquiries,
  opsFeePlans,
  opsFollowUps,
  opsLeads,
  opsLeadSources,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  istToday,
  istWeekContaining,
  latestElapsedCohortWeek,
  leadToAdmissionConversion,
  type FeeApprovalState,
  type IsoDate,
  type KpiWindow,
} from '../../domain';
import {
  admissionsByStatus,
  closuresByReason,
  handoffOutcomes,
  leadsBySource,
  newEnquiries,
  overdueFollowUps,
  pendingCounselling,
  pendingDecisions,
  upcomingDemos,
} from '../../domain/admissions-kpis';
import { admissionsFunnel, conversionBy, studentSummary } from '../../domain/admissions-funnel';
import { demoProgress } from '../../domain/demos';
import { studentPopulation } from '../../domain/student-lifecycle';
import { ACADEMIC_INTAKE_CONSUMER } from '../admissions';
import { feeAgreementPolicy } from '../approval-policies';
import { accessScope, type Actor } from '../context';
import { loadSettings } from '../settings';

const REPLY_OUTCOME = new Map<string, 'confirmed' | 'rejected'>([
  ['academic.enrolment.confirmed', 'confirmed'],
  ['academic.enrolment.rejected', 'rejected'],
]);

export interface AdmissionsReportOptions {
  from?: string;
  to?: string;
  now?: Date;
}

/** Ids of the leads and admissions an `own` scope covers (owner or counsellor). */
async function ownSets(db: Database, staffId: StaffMemberId | null) {
  if (!staffId) return { leadIds: [] as string[], admissionIds: [] as string[] };
  const [rows, owned] = await Promise.all([
    db
      .select({ admissionId: opsAdmissions.id, leadId: opsAdmissions.leadId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(or(eq(opsAdmissions.counsellorStaffId, staffId), eq(opsLeads.ownerStaffId, staffId))),
    db.select({ id: opsLeads.id }).from(opsLeads).where(eq(opsLeads.ownerStaffId, staffId)),
  ]);
  return {
    leadIds: [...new Set([...rows.map((r) => r.leadId as string), ...owned.map((o) => o.id)])],
    admissionIds: rows.map((r) => r.admissionId as string),
  };
}

export async function buildAdmissionsReport(
  db: Database,
  actor: Actor,
  options: AdmissionsReportOptions = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const now = options.now ?? new Date();
  const week = istWeekContaining(istToday(now));
  const window: KpiWindow = {
    from: (options.from ?? week.from) as IsoDate,
    to: (options.to ?? week.to) as IsoDate,
  };
  const ownStaffId = access.scope === 'own' ? access.staffId : undefined;
  const own = ownStaffId !== undefined ? await ownSets(db, ownStaffId) : null;
  /** Own scope: only these ids (none = no rows); all scope: no filter. */
  const within = (col: SQLWrapper, ids: string[] | undefined): SQL | undefined =>
    ids ? (ids.length ? inArray(col, ids as never[]) : eq(col, null as never)) : undefined;
  const leadFilter = (col: typeof opsLeads.id | typeof opsEnquiries.leadId) =>
    within(col, own?.leadIds);
  const admissionFilter = (col: typeof opsAdmissions.id) => within(col, own?.admissionIds);

  const [
    settings,
    enquiries,
    sources,
    leads,
    admittedTransitions,
    admissions,
    sessions,
    demos,
    followUps,
    requestEvents,
    closures,
  ] = await Promise.all([
    loadSettings(db),
    db
      .select({
        leadId: opsEnquiries.leadId,
        receivedAt: opsEnquiries.receivedAt,
        sourceCode: opsEnquiries.sourceCode,
      })
      .from(opsEnquiries)
      .where(leadFilter(opsEnquiries.leadId)),
    db.select({ code: opsLeadSources.code, label: opsLeadSources.label }).from(opsLeadSources),
    db
      .select({
        id: opsLeads.id,
        receivedAt: opsLeads.firstReceivedAt,
        merged: opsLeads.mergedIntoLeadId,
      })
      .from(opsLeads)
      .where(leadFilter(opsLeads.id)),
    db
      .select({ leadId: opsAdmissions.leadId, at: opsAdmissionTransitions.at })
      .from(opsAdmissionTransitions)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAdmissionTransitions.admissionId))
      .where(
        and(eq(opsAdmissionTransitions.toStatus, 'admitted'), admissionFilter(opsAdmissions.id)),
      ),
    db
      .select({ id: opsAdmissions.id, status: opsAdmissions.status })
      .from(opsAdmissions)
      .innerJoin(
        opsLeads,
        and(eq(opsLeads.id, opsAdmissions.leadId), isNull(opsLeads.mergedIntoLeadId)),
      )
      .where(admissionFilter(opsAdmissions.id)),
    db
      .select({
        status: opsAppointments.status,
        scheduledAt: opsAppointments.startsAt,
      })
      .from(opsAppointments)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAppointments.admissionId))
      .where(admissionFilter(opsAdmissions.id)),
    db
      .select({
        demoId: opsDemos.id,
        outcome: opsDemos.outcome,
        attendance: opsDemoSessions.attendance,
        startsAt: opsDemoSessions.startsAt,
      })
      .from(opsDemoSessions)
      .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
      .where(admissionFilter(opsAdmissions.id)),
    db
      .select({ status: opsFollowUps.status, dueDate: opsFollowUps.dueDate })
      .from(opsFollowUps)
      .where(own ? eq(opsFollowUps.ownerStaffId, ownStaffId as never) : undefined),
    // Handoff attempts: every request event Ops published (replies and deliveries below).
    db
      .select({
        id: integrationEvents.id,
        occurredAt: integrationEvents.occurredAt,
        payload: integrationEvents.payload,
      })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.type, 'ops.admission.enrolment_requested'),
          eq(integrationEvents.producer, 'ops'),
        ),
      ),
    db
      .select({ at: opsAdmissionTransitions.at, reasonCode: opsAdmissionTransitions.reasonCode })
      .from(opsAdmissionTransitions)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAdmissionTransitions.admissionId))
      .where(and(eq(opsAdmissionTransitions.toStatus, 'lost'), admissionFilter(opsAdmissions.id))),
  ]);
  const conversionDays = settings['kpi.conversion'].value.windowDays;
  const cohort = latestElapsedCohortWeek(now, conversionDays);

  // Fee state per admission from its agreement versions' own approvals (A-FEE-8): approved only
  // while the approved version is active; otherwise the latest request's state.
  // shortcut: a bundle's extra cases (agreement on the primary case) read "none", fine for counts.
  const approvalRows = admissions.length
    ? await db
        .select({
          admissionId: opsFeePlans.admissionId,
          planStatus: opsFeePlans.status,
          status: approvals.status,
        })
        .from(approvals)
        .innerJoin(opsFeePlans, eq(opsFeePlans.id, approvals.subjectId))
        .where(
          and(
            eq(approvals.policy, feeAgreementPolicy.key),
            inArray(
              opsFeePlans.admissionId,
              admissions.map((a) => a.id),
            ),
          ),
        )
        .orderBy(desc(approvals.requestedAt), desc(approvals.id))
    : [];
  const feeState = new Map<string, FeeApprovalState>();
  for (const r of approvalRows) {
    if (r.status === 'approved' && r.planStatus !== 'active') continue;
    if (r.status === 'approved' || !feeState.has(r.admissionId))
      feeState.set(r.admissionId, r.status as FeeApprovalState);
  }

  // Each handoff request's reply and Academic's delivery.
  const ownAdmissions = own ? new Set(own.admissionIds) : null;
  const scopedRequests = requestEvents.filter(
    (e) => !ownAdmissions || ownAdmissions.has((e.payload as { admissionId: string }).admissionId),
  );
  const requestIds = scopedRequests.map((e) => e.id);
  const [replies, deliveries] = requestIds.length
    ? await Promise.all([
        db
          .select({ correlationId: integrationEvents.correlationId, type: integrationEvents.type })
          .from(integrationEvents)
          .where(
            and(
              inArray(integrationEvents.correlationId, requestIds as string[]),
              inArray(integrationEvents.type, [
                'academic.enrolment.confirmed',
                'academic.enrolment.rejected',
              ]),
            ),
          ),
        db
          .select({ eventId: eventDeliveries.eventId, status: eventDeliveries.status })
          .from(eventDeliveries)
          .where(
            and(
              inArray(eventDeliveries.eventId, requestIds),
              eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
            ),
          ),
      ])
    : [[], []];
  const replyOf = new Map(replies.map((r) => [r.correlationId as string, r.type]));
  const deliveryOf = new Map(deliveries.map((d) => [d.eventId as string, d.status]));

  const firstAdmitted = new Map<string, Date>();
  for (const t of admittedTransitions) {
    const prev = firstAdmitted.get(t.leadId);
    if (!prev || t.at < prev) firstAdmitted.set(t.leadId, t.at);
  }
  const admissionRows = admissions.map((a) => ({
    status: a.status,
    feeApproval: feeState.get(a.id) ?? ('none' as FeeApprovalState),
  }));
  const sourceLabel = new Map(sources.map((s) => [s.code, s.label]));
  const closureLabels = new Map(
    settings['admissions.closure_reasons'].value.codes.map((c) => [c.code, c.label]),
  );

  return {
    asOf: now.toISOString(),
    window,
    scope: access.scope,
    cohort: { ...cohort, windowDays: conversionDays, setting: settings['kpi.conversion'] },
    kpis: {
      newEnquiries: newEnquiries(enquiries, window),
      conversion: leadToAdmissionConversion(
        leads.map((l) => ({
          receivedAt: l.receivedAt,
          merged: Boolean(l.merged),
          admittedAt: firstAdmitted.get(l.id) ?? null,
        })),
        cohort,
        conversionDays,
        now,
      ),
      counselling: pendingCounselling(sessions, now),
      upcomingDemos: upcomingDemos(demos, now, 7),
      decisions: pendingDecisions(admissionRows, now),
      handoff: handoffOutcomes(
        scopedRequests.map((e) => ({
          occurredAt: e.occurredAt,
          reply: REPLY_OUTCOME.get(replyOf.get(e.id) ?? '') ?? null,
          academicDelivery: deliveryOf.get(e.id) ?? null,
        })),
        window,
      ),
      overdueFollowUps: overdueFollowUps(followUps, now),
    },
    bySource: leadsBySource(enquiries, window).map((s) => ({
      ...s,
      label: sourceLabel.get(s.sourceCode) ?? s.sourceCode,
    })),
    byStatus: admissionsByStatus(admissionRows),
    closures: closuresByReason(closures, window).map((c) => ({
      ...c,
      label:
        c.reasonCode === 'not_coded'
          ? 'Not coded (closed with a free-text reason only)'
          : (closureLabels.get(c.reasonCode) ?? c.reasonCode),
    })),
  };
}

// --- funnel, demo conversion, student summary (owner brief §15; A-REP-1 … A-REP-3) -------------

/**
 * Admissions funnel for leads first received in the period; demo conversion for demos with a
 * class in the period (the demo list's date-filter rule, so report links show the same demos),
 * grouped by programme, counsellor and — with `ops:lead_attribution:read` — source/campaign;
 * student counts right now. Own scope as in `buildAdmissionsReport`. Persisted rows only.
 */
export async function buildAdmissionsFunnel(
  db: Database,
  actor: Actor,
  options: AdmissionsReportOptions = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const now = options.now ?? new Date();
  const week = istWeekContaining(istToday(now));
  const window = { from: options.from ?? week.from, to: options.to ?? week.to };
  const inWindow = (d: Date) => istToday(d) >= window.from && istToday(d) <= window.to;
  const own = access.scope === 'own' ? new Set((await ownSets(db, access.staffId)).leadIds) : null;
  const ownLead = (id: string) => !own || own.has(id);
  const attribution = can(actor, 'ops:lead_attribution:read');

  const [leads, demos, sessions, admissions, enquiries, programmeRows, staff] = await Promise.all([
    db
      .select({ id: opsLeads.id, at: opsLeads.firstReceivedAt, programmeId: opsLeads.programmeId })
      .from(opsLeads)
      .where(isNull(opsLeads.mergedIntoLeadId)),
    db.select().from(opsDemos),
    db
      .select({
        demoId: opsDemoSessions.demoId,
        dayNumber: opsDemoSessions.dayNumber,
        startsAt: opsDemoSessions.startsAt,
        attendance: opsDemoSessions.attendance,
      })
      .from(opsDemoSessions),
    db
      .select({
        id: opsAdmissions.id,
        status: opsAdmissions.status,
        heldFromStatus: opsAdmissions.heldFromStatus,
        admittedAt: opsAdmissions.admittedAt,
        enrolledAt: opsAdmissions.enrolledAt,
        studentId: opsAdmissions.studentId,
        leadId: opsAdmissions.leadId,
      })
      .from(opsAdmissions),
    db
      .select({
        leadId: opsEnquiries.leadId,
        receivedAt: opsEnquiries.receivedAt,
        sourceCode: opsEnquiries.sourceCode,
        campaignRef: opsEnquiries.campaignRef,
      })
      .from(opsEnquiries)
      .orderBy(asc(opsEnquiries.receivedAt)),
    db.select({ id: programmes.id, code: programmes.code, name: programmes.name }).from(programmes),
    db.select({ id: staffMembers.id, name: staffMembers.fullName }).from(staffMembers),
  ]);

  const admissionById = new Map(admissions.map((a) => [a.id as string, a]));
  const sessionsOf = new Map<string, typeof sessions>();
  for (const s of sessions) sessionsOf.set(s.demoId, [...(sessionsOf.get(s.demoId) ?? []), s]);
  const demosOf = new Map<string, typeof demos>();
  for (const d of demos) demosOf.set(d.leadId, [...(demosOf.get(d.leadId) ?? []), d]);
  // D-1: completed = every planned demo DAY attended (not a count of classes).
  const progress = (d: (typeof demos)[number]) =>
    demoProgress(sessionsOf.get(d.id) ?? [], d.plannedDayCount);

  const cohort = leads.filter((l) => ownLead(l.id) && inWindow(l.at));
  const funnel = admissionsFunnel(
    cohort.map((l) => {
      const ds = demosOf.get(l.id) ?? [];
      const converted = ds.filter((d) => d.outcome === 'converted');
      return {
        demoBooked: ds.length > 0,
        attended: ds.some((d) => progress(d).sessionsAttended > 0),
        completed: ds.some((d) => progress(d).attended >= d.plannedDayCount),
        converted: converted.length > 0,
        enrolled: converted.some((d) =>
          Boolean(admissionById.get(d.convertedAdmissionId as string)?.enrolledAt),
        ),
      };
    }),
  );

  const leadById = new Map(leads.map((l) => [l.id as string, l]));
  const firstEnquiry = new Map<string, (typeof enquiries)[number]>();
  for (const e of enquiries) if (!firstEnquiry.has(e.leadId)) firstEnquiry.set(e.leadId, e);
  const programmeOf = new Map(programmeRows.map((p) => [p.id as string, p]));
  const staffName = new Map(staff.map((s) => [s.id as string, s.name]));
  const heldDemos = demos
    .filter(
      (d) => ownLead(d.leadId) && (sessionsOf.get(d.id) ?? []).some((s) => inWindow(s.startsAt)),
    )
    .map((d) => {
      const programme = programmeOf.get(
        (d.programmeId ?? leadById.get(d.leadId)?.programmeId ?? '') as string,
      );
      const enquiry = firstEnquiry.get(d.leadId);
      return {
        outcome: d.outcome,
        programme: programme?.name ?? 'Programme not set',
        programmeCode: programme?.code ?? null,
        counsellor: d.counsellorStaffId
          ? (staffName.get(d.counsellorStaffId) ?? 'Unknown staff')
          : 'No counsellor',
        counsellorId: d.counsellorStaffId,
        source: enquiry
          ? `${enquiry.sourceCode}${enquiry.campaignRef ? ` · ${enquiry.campaignRef}` : ''}`
          : 'No enquiry recorded',
      };
    });
  const linkKey = <K extends 'programmeCode' | 'counsellorId'>(
    k: K,
    group: string,
    by: 'programme' | 'counsellor',
  ) => heldDemos.find((h) => h[by] === group)?.[k] ?? null;

  const studentRows = admissions
    .filter((a) => a.studentId && ownLead(a.leadId))
    .map((a) => ({
      studentId: a.studentId as string,
      population: studentPopulation({
        status: a.status,
        heldFromStatus: a.heldFromStatus,
        admittedAt: a.admittedAt,
      }),
    }));

  return {
    asOf: now.toISOString(),
    window,
    scope: access.scope,
    funnel,
    demoConversion: {
      total: heldDemos.length,
      byProgramme: conversionBy(heldDemos, (h) => h.programme).map((g) => ({
        ...g,
        programmeCode: linkKey('programmeCode', g.group, 'programme'),
      })),
      byCounsellor: conversionBy(heldDemos, (h) => h.counsellor).map((g) => ({
        ...g,
        counsellorId: linkKey('counsellorId', g.group, 'counsellor'),
      })),
      bySource: attribution ? conversionBy(heldDemos, (h) => h.source) : null,
      /** Demos per outcome code (`demos`; the rate is meaningless here). */
      byOutcome: conversionBy(heldDemos, (h) => h.outcome),
    },
    students: studentSummary(studentRows),
  };
}
