/**
 * Admissions dashboard (OPS-078): loads plain rows and hands them to the pure
 * KPI functions in domain/admissions-kpis.ts and domain/kpis.ts (cohort
 * conversion reused). Definitions: docs/parts/admissions.md → "KPI definitions".
 *
 * Permission `ops:admissions:read`. With scope `own` (counsellor) every row is
 * limited to the counsellor's leads and admissions and the page says so.
 * Missing is never zero: rates with no denominator are `missing`.
 */
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import {
  approvals,
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsAdmissionTransitions,
  opsCounsellingSessions,
  opsDemos,
  opsEnquiries,
  opsFollowUps,
  opsLeads,
  opsLeadSources,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  istToday,
  istWeekContaining,
  latestElapsedCohortWeek,
  leadToAdmissionConversion,
  type AdmissionStatus,
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
import { ACADEMIC_INTAKE_CONSUMER } from '../admissions';
import { feeArrangementPolicy } from '../approval-policies';
import { accessScope, type Actor } from '../context';
import { loadSettings } from '../settings';

export interface AdmissionsReportOptions {
  from?: string;
  to?: string;
  now?: Date;
}

/** Ids of the leads and admissions an `own` scope covers (owner or counsellor). */
async function ownSets(db: Database, staffId: StaffMemberId | null) {
  if (!staffId) return { leadIds: [] as string[], admissionIds: [] as string[] };
  const rows = await db
    .select({ admissionId: opsAdmissions.id, leadId: opsAdmissions.leadId })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(or(eq(opsAdmissions.counsellorStaffId, staffId), eq(opsLeads.ownerStaffId, staffId)));
  const owned = await db
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.ownerStaffId, staffId));
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
  const own = access.scope === 'own' ? await ownSets(db, access.staffId) : null;
  const leadFilter = (col: typeof opsLeads.id | typeof opsEnquiries.leadId): SQL | undefined =>
    own
      ? own.leadIds.length
        ? inArray(col, own.leadIds as never[])
        : eq(col, null as never)
      : undefined;
  const admissionFilter = (col: typeof opsAdmissions.id): SQL | undefined =>
    own
      ? own.admissionIds.length
        ? inArray(col, own.admissionIds as never[])
        : eq(col, null as never)
      : undefined;

  const settings = await loadSettings(db);
  const conversionDays = settings['kpi.conversion'].value.windowDays;
  const cohort = latestElapsedCohortWeek(now, conversionDays);

  const [enquiries, sources, leads, admittedTransitions, admissions, sessions, demos, followUps] =
    await Promise.all([
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
          status: opsCounsellingSessions.status,
          scheduledAt: opsCounsellingSessions.scheduledAt,
        })
        .from(opsCounsellingSessions)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsCounsellingSessions.admissionId))
        .where(admissionFilter(opsAdmissions.id)),
      db
        .select({ status: opsDemos.status, dayDates: opsDemos.dayDates })
        .from(opsDemos)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
        .where(admissionFilter(opsAdmissions.id)),
      db
        .select({ status: opsFollowUps.status, dueDate: opsFollowUps.dueDate })
        .from(opsFollowUps)
        .where(
          own
            ? access.scope === 'own' && access.staffId
              ? eq(opsFollowUps.ownerStaffId, access.staffId)
              : eq(opsFollowUps.ownerStaffId, null as never)
            : undefined,
        ),
    ]);

  // Latest fee-arrangement approval per admission.
  const approvalRows = admissions.length
    ? await db
        .select({ subjectId: approvals.subjectId, status: approvals.status })
        .from(approvals)
        .where(
          and(
            eq(approvals.policy, feeArrangementPolicy.key),
            inArray(
              approvals.subjectId,
              admissions.map((a) => a.id as string),
            ),
          ),
        )
        .orderBy(desc(approvals.requestedAt), desc(approvals.id))
    : [];
  const feeState = new Map<string, FeeApprovalState>();
  for (const r of approvalRows)
    if (!feeState.has(r.subjectId)) feeState.set(r.subjectId, r.status as FeeApprovalState);

  // Handoff attempts: every request event Ops published, its reply and Academic's delivery.
  const requestEvents = await db
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
    );
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

  const closures = await db
    .select({ at: opsAdmissionTransitions.at, reasonCode: opsAdmissionTransitions.reasonCode })
    .from(opsAdmissionTransitions)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAdmissionTransitions.admissionId))
    .where(and(eq(opsAdmissionTransitions.toStatus, 'lost'), admissionFilter(opsAdmissions.id)));

  const firstAdmitted = new Map<string, Date>();
  for (const t of admittedTransitions) {
    const prev = firstAdmitted.get(t.leadId);
    if (!prev || t.at < prev) firstAdmitted.set(t.leadId, t.at);
  }
  const admissionRows = admissions.map((a) => ({
    status: a.status as AdmissionStatus,
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
        scopedRequests.map((e) => {
          const reply = replyOf.get(e.id);
          return {
            occurredAt: e.occurredAt,
            reply:
              reply === 'academic.enrolment.confirmed'
                ? ('confirmed' as const)
                : reply === 'academic.enrolment.rejected'
                  ? ('rejected' as const)
                  : null,
            academicDelivery: deliveryOf.get(e.id) ?? null,
          };
        }),
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
