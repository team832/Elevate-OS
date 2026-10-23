/** Admissions board and detail (OPS-005, OPS-010): what staff read on the pipeline screens. */
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  integrationEvents,
  opsAdmissions,
  opsAppointments,
  opsDemos,
  opsDemoSessions,
  opsFeeRecords,
  opsFollowUps,
  opsLeads,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { listApprovalHistory } from '@elevate/server-kit';
import {
  ADMISSION_CHECK_LABELS,
  allowedUserTargets,
  SYSTEM_CLOSURE_REASONS,
  READINESS_GAP_LABELS,
  type AdmissionCheckItem,
  type AdmissionStatus,
} from '../domain';
import { demoAttendanceStatus, demoDaysAndSubjects } from '../domain/demos';
import { summariseFees, type FeeRecordLike } from '../domain/fees';
import { deriveHandoffView, retryDecision } from '../domain/students';
import { academicDemoMarks, withMarks } from './academic-summary';
import {
  academicDeliveryOf,
  admissionRow,
  assertAdmissionAccess,
  attemptsOf,
  handoffInputOf,
  namesOf,
  programmeRef,
  readinessOf,
  staffRef,
  transitionsOf,
} from './admissions-lookups';
import { accessScope, type Actor } from './context';

export async function listAdmissions(
  db: Database,
  actor: Actor,
  filters: { status?: AdmissionStatus; handoff?: string } = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const conditions: SQL[] = [];
  if (access.scope === 'own') {
    if (!access.staffId) return [];
    conditions.push(eq(opsAdmissions.counsellorStaffId, access.staffId));
  }
  if (filters.status) conditions.push(eq(opsAdmissions.status, filters.status));
  if (filters.handoff) conditions.push(eq(opsAdmissions.handoffStatus, filters.handoff));
  const rows = await db
    .select({
      a: opsAdmissions,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      programmeCode: programmes.code,
      counsellorName: staffMembers.fullName,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsAdmissions.counsellorStaffId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(opsAdmissions.statusChangedAt))
    .limit(1000);
  return rows.map(({ a, ...r }) => ({
    id: a.id,
    code: a.code,
    leadId: a.leadId,
    leadCode: r.leadCode,
    studentName: r.studentName,
    programmeCode: r.programmeCode,
    counsellorStaffId: a.counsellorStaffId,
    counsellorName: r.counsellorName,
    status: a.status,
    statusReason: a.statusReason,
    statusChangedAt: a.statusChangedAt,
    handoffStatus: a.handoffStatus,
    rejectionReason: a.rejectionReason,
    demoSkipped: a.demoSkipped,
  }));
}

export async function getAdmission(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, id);
  await assertAdmissionAccess(db, access, admission);
  const [lead] = await db
    .select({
      id: opsLeads.id,
      code: opsLeads.code,
      studentName: opsLeads.studentName,
      ownerStaffId: opsLeads.ownerStaffId,
      firstSuccessfulContactAt: opsLeads.firstSuccessfulContactAt,
    })
    .from(opsLeads)
    .where(eq(opsLeads.id, admission.leadId));
  const { gaps, checks, fee, settings } = await readinessOf(db, admission);
  const recorderName = await namesOf(
    db,
    checks.map((c) => c.recordedBy),
  );
  const sessions = await db
    .select({ s: opsAppointments, counsellorName: staffMembers.fullName })
    .from(opsAppointments)
    .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
    .where(eq(opsAppointments.admissionId, admission.id))
    .orderBy(desc(opsAppointments.startsAt));
  const demos = await db
    .select()
    .from(opsDemos)
    .where(eq(opsDemos.admissionId, admission.id))
    .orderBy(desc(opsDemos.createdAt));
  const plainSessions = demos.length
    ? await db
        .select({
          id: opsDemoSessions.id,
          demoId: opsDemoSessions.demoId,
          startsAt: opsDemoSessions.startsAt,
          subject: opsDemoSessions.subject,
          attendance: opsDemoSessions.attendance,
          teacherName: staffMembers.fullName,
        })
        .from(opsDemoSessions)
        .leftJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId))
        .where(
          inArray(
            opsDemoSessions.demoId,
            demos.map((d) => d.id),
          ),
        )
        .orderBy(asc(opsDemoSessions.sessionNumber))
    : [];
  // R15: a linked class shows Academic's mark and actual teachers.
  const demoSessions = withMarks(
    plainSessions,
    await academicDemoMarks(
      db,
      plainSessions.map((x) => x.id),
    ),
  ).map((x) => ({ ...x, teacherName: x.academic?.teacherNames.join(', ') || x.teacherName }));
  const [event] = admission.lastRequestEventId
    ? await db
        .select({ id: integrationEvents.id, occurredAt: integrationEvents.occurredAt })
        .from(integrationEvents)
        .where(eq(integrationEvents.id, admission.lastRequestEventId))
    : [];
  const handoff = event
    ? {
        eventId: event.id as string,
        attempt: admission.enrolmentAttempt,
        occurredAt: event.occurredAt,
        academicDelivery: await academicDeliveryOf(db, admission.lastRequestEventId),
      }
    : null;
  const status = admission.status;
  const handoffInput = handoffInputOf(admission, handoff?.academicDelivery ?? null);
  const feeRecords = can(actor, 'ops:fees:read')
    ? await db
        .select({
          kind: opsFeeRecords.kind,
          direction: opsFeeRecords.direction,
          amountPaise: opsFeeRecords.amountPaise,
          status: opsFeeRecords.status,
        })
        .from(opsFeeRecords)
        .where(eq(opsFeeRecords.admissionId, admission.id))
    : null;
  const closure = settings['admissions.closure_reasons'];
  return {
    admission,
    lead: lead ?? null,
    programme: await programmeRef(db, admission.programmeId),
    counsellor: await staffRef(db, admission.counsellorStaffId),
    checks: checks.map((c) => ({
      ...c,
      label: ADMISSION_CHECK_LABELS[c.itemKey as AdmissionCheckItem],
      recordedByName: recorderName.get(c.recordedBy) ?? null,
    })),
    readiness: {
      ready: gaps.length === 0,
      gaps: gaps.map((g) => ({ key: g, label: READINESS_GAP_LABELS[g] })),
    },
    feeApproval: {
      ...fee,
      history: await listApprovalHistory(db, {
        module: 'ops',
        subjectType: 'admission',
        subjectId: admission.id,
      }),
    },
    transitions: await transitionsOf(db, admission.id),
    counselling: sessions.map((s) => ({ ...s.s, counsellorName: s.counsellorName })),
    demos: demos.map((d) => {
      const sessions = demoSessions.filter((x) => x.demoId === d.id);
      return {
        ...d,
        ...demoDaysAndSubjects(sessions),
        status: demoAttendanceStatus(d.outcome, sessions),
        teachers: [...new Set(sessions.flatMap((x) => (x.teacherName ? [x.teacherName] : [])))],
      };
    }),
    followUps: await db
      .select()
      .from(opsFollowUps)
      .where(eq(opsFollowUps.admissionId, admission.id))
      .orderBy(desc(opsFollowUps.dueDate)),
    handoff,
    allowedTargets: allowedUserTargets(status, {
      heldFromStatus: admission.heldFromStatus as AdmissionStatus | null,
      demoSkipAllowed: settings['pipeline.demo_skip'].value.allowed,
    }).filter((t) => t !== 'enrolment_requested'),
    canRequestEnrolment: status === 'admitted',
    handoffView: deriveHandoffView(handoffInput),
    retry: retryDecision(handoffInput),
    attempts: await attemptsOf(db, admission.id),
    /** null = the caller may not read fee records. */
    feeSummary: feeRecords ? summariseFees(feeRecords as FeeRecordLike[]) : null,
    closureReasons: closure.value.codes.filter((c) => !SYSTEM_CLOSURE_REASONS.includes(c.code)),
    closureReasonLabels: Object.fromEntries(closure.value.codes.map((c) => [c.code, c.label])),
    settings: {
      closureReasons: closure,
      demoSkip: settings['pipeline.demo_skip'],
      confirmation: settings['admission.confirmation'],
    },
  };
}
