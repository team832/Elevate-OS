/**
 * Admissions funnel, demo conversion and student summary (owner brief §15; A-REP-1 … A-REP-3),
 * shown beside the admissions dashboard (./admissions.ts). Own scope as there.
 */
import { asc, isNull } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsEnquiries,
  opsLeads,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { istToday, istWeekContaining } from '../../domain';
import { admissionsFunnel, conversionBy, studentSummary } from '../../domain/admissions-funnel';
import { demoProgress } from '../../domain/demos';
import { studentPopulation } from '../../domain/student-lifecycle';
import { accessScope, type Actor } from '../context';
import { ownSets, type AdmissionsReportOptions } from './admissions';

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
