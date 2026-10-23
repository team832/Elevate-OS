/**
 * Student profile (owner brief §8 A–J): a canonical student id (or, for older
 * links, an admission id) resolved to its admission cases, with history,
 * handoff, private data (only with `ops:student_private:read`), fees (only with
 * `ops:fees:read`) and the lifecycle actions the caller may take. Plus the
 * proposed Academic read contract for results and attendance (IR-OPS-STU-1). The reads it
 * combines are in ./student-profile-sources.
 */
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissionNumberChanges,
  opsApplications,
  opsAppointments,
  opsDemos,
  opsEnquiries,
  opsExitRecords,
  opsFollowUps,
  opsLeadSources,
  programmes,
  staffMembers,
  students,
  users,
  type Database,
} from '@elevate/database';
import { ForbiddenError, NotFoundError } from '@elevate/shared-contracts';
import {
  academicStudentPath,
  deriveHandoffView,
  redactStudentPrivate,
  retryDecision,
} from '../domain/students';
import { BLOCKING_STATUSES } from '../domain/appointments';
import {
  caseState,
  hasStudentRecord,
  lifecycleOptions,
  maskPhone,
} from '../domain/student-lifecycle';
import {
  academicDeliveryOf,
  attemptsOf,
  handoffInputOf,
  programmeRef,
  staffRef,
  transitionsOf,
} from './admissions';
import { accessScope, scopeCovers, type Actor } from './context';
import { demoFeeStates } from './demos-read';
import { feeSummaryFor } from './fees';
import { privateDataOf } from './guardians';
import { loadSettings } from './settings';
import {
  primaryGuardianOf,
  programmesOf,
  repliesOf,
  resolveStudent,
  timelineOf,
} from './student-profile-sources';

/** GET /students/{id} — canonical student id, or an admission id (older links). */
export async function getStudent(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const { primary, cases } = await resolveStudent(db, id);
  const { a, lead } = primary;
  const { status, statusLabel, population, state, stateLabel } = caseState(a);
  if (!hasStudentRecord(a))
    throw new NotFoundError(
      'This admission has not been admitted, so there is no student record yet.',
    );
  const owners = cases.flatMap((c) => [c.a.counsellorStaffId, c.lead.ownerStaffId]);
  if (!scopeCovers(access, owners))
    throw new ForbiddenError('You can only open students whose admission is assigned to you.');
  const caseIds = cases.map((c) => c.a.id);
  const identityId = a.studentId;
  const [
    settings,
    transitions,
    enquiries,
    sessions,
    demos,
    attempts,
    identity,
    exitRecords,
    numberChanges,
    timeline,
    academicDelivery,
    replies,
    privateData,
    programmeById,
    owner,
    programme,
    followUps,
    fees,
    primaryGuardian,
    application,
  ] = await Promise.all([
    loadSettings(db),
    transitionsOf(db, a.id),
    db
      .select({
        receivedAt: opsEnquiries.receivedAt,
        sourceCode: opsEnquiries.sourceCode,
        sourceLabel: opsLeadSources.label,
        channel: opsEnquiries.channel,
        programmeCode: programmes.code,
      })
      .from(opsEnquiries)
      .innerJoin(opsLeadSources, eq(opsLeadSources.code, opsEnquiries.sourceCode))
      .leftJoin(programmes, eq(programmes.id, opsEnquiries.programmeId))
      .where(eq(opsEnquiries.leadId, lead.id))
      .orderBy(desc(opsEnquiries.receivedAt)),
    db
      .select({
        id: opsAppointments.id,
        scheduledAt: opsAppointments.startsAt,
        status: opsAppointments.status,
        mode: opsAppointments.mode,
        type: opsAppointments.type,
        outcome: opsAppointments.outcome,
        counsellorName: staffMembers.fullName,
      })
      .from(opsAppointments)
      .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
      .where(
        or(
          inArray(opsAppointments.admissionId, caseIds),
          identityId ? eq(opsAppointments.studentId, identityId) : undefined,
        ),
      )
      .orderBy(desc(opsAppointments.startsAt)),
    db
      .select({
        id: opsDemos.id,
        admissionId: opsDemos.admissionId,
        outcome: opsDemos.outcome,
        outcomeAt: opsDemos.outcomeAt,
        convertedAdmissionId: opsDemos.convertedAdmissionId,
        feeTermsState: opsDemos.feeTermsState,
      })
      .from(opsDemos)
      .where(inArray(opsDemos.admissionId, caseIds))
      .orderBy(desc(opsDemos.createdAt)),
    attemptsOf(db, a.id),
    identityId
      ? db
          .select()
          .from(students)
          .where(eq(students.id, identityId))
          .then((r) => r[0] ?? null)
      : null,
    db
      .select({ e: opsExitRecords, recordedByName: users.displayName })
      .from(opsExitRecords)
      .innerJoin(users, eq(users.id, opsExitRecords.recordedBy))
      .where(inArray(opsExitRecords.admissionId, caseIds))
      .orderBy(desc(opsExitRecords.recordedAt)),
    db
      .select({ c: opsAdmissionNumberChanges, actorName: users.displayName })
      .from(opsAdmissionNumberChanges)
      .innerJoin(users, eq(users.id, opsAdmissionNumberChanges.actorUserId))
      .where(inArray(opsAdmissionNumberChanges.admissionId, caseIds))
      .orderBy(desc(opsAdmissionNumberChanges.at)),
    timelineOf(db, identityId, caseIds),
    academicDeliveryOf(db, a.lastRequestEventId),
    repliesOf(db, a.lastRequestEventId),
    privateDataOf(db, actor, owners, lead.id, identityId),
    programmesOf(
      db,
      cases.map((c) => c.a.programmeId),
    ),
    staffRef(db, a.counsellorStaffId),
    programmeRef(db, a.programmeId),
    /** Open follow-ups of the student's cases, earliest first (G Upcoming). */
    db
      .select({
        id: opsFollowUps.id,
        admissionId: opsFollowUps.admissionId,
        title: opsFollowUps.title,
        dueDate: opsFollowUps.dueDate,
      })
      .from(opsFollowUps)
      .where(and(inArray(opsFollowUps.admissionId, caseIds), eq(opsFollowUps.status, 'open')))
      .orderBy(asc(opsFollowUps.dueDate)),
    /** null = the caller may not read fee records. */
    can(actor, 'ops:fees:read') ? feeSummaryFor(db, a.id) : null,
    identityId ? primaryGuardianOf(db, identityId) : null,
    db
      .select({ academicYear: opsApplications.academicYear })
      .from(opsApplications)
      .where(eq(opsApplications.admissionId, a.id))
      .then((r) => r[0] ?? null),
  ]);
  const reasonLabels = new Map(
    settings['admissions.closure_reasons'].value.codes.map((c) => [c.code, c.label]),
  );
  const handoffInput = handoffInputOf(a, academicDelivery);
  const { prefs } = privateData;
  const person = redactStudentPrivate(
    {
      leadId: lead.id,
      leadCode: lead.code,
      fullName: lead.studentName,
      preferredName: lead.preferredName,
      currentStage: lead.currentStage,
      schoolBoard: lead.schoolBoard,
      interestMode: lead.interestMode,
      studentPhone: lead.studentPhone,
      studentEmail: lead.studentEmail,
      guardianName: lead.guardianName,
      guardianRelationship: lead.guardianRelationship,
      guardianPhone: lead.guardianPhone,
      guardianEmail: lead.guardianEmail,
      city: lead.city,
      previousSchool: lead.previousSchool,
      consent: prefs
        ? {
            status: prefs.consentStatus,
            by: prefs.consentBy,
            allowedChannels: prefs.allowedChannels,
            preferredContact: prefs.preferredContact,
            note: prefs.note,
            recordedAt: prefs.recordedAt,
          }
        : null,
    },
    privateData.visible,
  );
  // Header contact: primary guardian, else the enquiry's guardian, else the student; masked
  // (no name) unless the caller may see private details.
  const contact = primaryGuardian
    ? {
        who: `${primaryGuardian.fullName} (${primaryGuardian.relationship})`,
        role: 'Primary guardian',
        phone: primaryGuardian.phone,
      }
    : lead.guardianPhone
      ? {
          who: lead.guardianName ?? 'Guardian',
          role: 'Guardian on the enquiry',
          phone: lead.guardianPhone,
        }
      : lead.studentPhone
        ? { who: 'Student', role: 'Student', phone: lead.studentPhone }
        : null;
  const primaryContact = contact && {
    label: privateData.visible ? contact.who : contact.role,
    phone: privateData.visible ? contact.phone : maskPhone(contact.phone),
    masked: !privateData.visible,
  };
  const openExit = exitRecords.find((r) => r.e.admissionId === a.id && !r.e.reactivatedAt);
  const options = lifecycleOptions(a);
  const demoFees = can(actor, 'ops:fees:read')
    ? await demoFeeStates(
        db,
        demos.map((x) => x.id),
      )
    : null;
  const canLifecycle = can(actor, 'ops:students:lifecycle');
  return {
    identity: identity
      ? { id: identity.id, fullName: identity.fullName, isSample: identity.isSample }
      : null,
    population,
    admission: {
      id: a.id,
      code: a.code,
      admissionNumber:
        a.admissionNumber ?? cases.find((c) => c.a.admissionNumber)?.a.admissionNumber ?? null,
      status,
      statusLabel,
      statusReason: a.statusReason,
      statusReasonCode: a.statusReasonCode,
      statusReasonLabel: a.statusReasonCode ? (reasonLabels.get(a.statusReasonCode) ?? null) : null,
      heldFromStatus: a.heldFromStatus,
      holdReviewDate: a.holdReviewDate,
      state,
      stateLabel: stateLabel ?? statusLabel,
      admissionDate: a.admissionDate,
      admittedAt: a.admittedAt,
      deliveryMode: a.deliveryMode,
      intendedStartDate: a.intendedStartDate,
      intendedCourseId: a.intendedCourseId,
      intendedBatchId: a.intendedBatchId,
      academicYear: application?.academicYear ?? null,
      /** Brief §14: a migrated record whose evidence is not yet reconciled. */
      legacyVerificationRequired: cases.some((c) => c.a.legacyVerification === 'required'),
    },
    primaryContact,
    /** Every admission case of the student (one per programme), with its population. */
    cases: cases.map(({ a: c }) => {
      const s = caseState(c);
      return {
        id: c.id,
        code: c.code,
        admissionNumber: c.admissionNumber,
        programme: c.programmeId ? (programmeById.get(c.programmeId) ?? null) : null,
        status: s.status,
        statusLabel: s.statusLabel,
        population: s.population,
        admissionDate: c.admissionDate,
        intendedBatchId: c.intendedBatchId,
        enrolmentId: c.enrolmentId,
        enrolledBatchId: c.enrolledBatchId,
        enrolledCourseId: c.enrolledCourseId,
        enrolledAt: c.enrolledAt,
      };
    }),
    owner,
    programme,
    person,
    academic: {
      studentId: a.academicStudentId,
      enrolmentId: a.enrolmentId,
      existingStudent: a.academicExistingStudent,
      enrolledCourseId: a.enrolledCourseId,
      enrolledBatchId: a.enrolledBatchId,
      enrolledAt: a.enrolledAt,
      path: academicStudentPath(a.academicStudentId),
    },
    handoff: {
      view: deriveHandoffView(handoffInput),
      retry: retryDecision(handoffInput),
      attempt: a.enrolmentAttempt,
      requestedAt: a.enrolmentRequestedAt,
      academicDelivery,
      replies,
      rejection: a.rejectionCode
        ? { code: a.rejectionCode, reason: a.rejectionReason, at: a.rejectedAt }
        : null,
      attempts,
    },
    history: transitions.map((t) => ({
      ...t,
      reasonLabel: t.reasonCode ? (reasonLabels.get(t.reasonCode) ?? t.reasonCode) : null,
    })),
    enquiries,
    counselling: sessions,
    upcomingCounselling: sessions
      .filter((x) => BLOCKING_STATUSES.includes(x.status) && x.scheduledAt.getTime() >= Date.now())
      .reverse(), // soonest first
    /** Demo fee state from the ledger (null without ops:fees:read); never a stored flag. */
    demos: demos.map((x) => ({ ...x, feeState: demoFees?.get(x.id) ?? null })),
    otherAdmissions: cases
      .filter((c) => c.a.id !== a.id)
      .map((c) => ({ id: c.a.id, code: c.a.code, status: c.a.status })),
    exitRecords: exitRecords.map(({ e, recordedByName }) => ({
      ...e,
      recordedByName,
      reasonLabel: e.reasonCode ? (reasonLabels.get(e.reasonCode) ?? e.reasonCode) : null,
      /** undefined = the caller may not read fees; null = not known (never 0). */
      balancePaise: can(actor, 'ops:fees:read') ? e.balancePaise : undefined,
    })),
    /** Reason codes offered on the exit form (setting admissions.closure_reasons). */
    closureReasons: settings['admissions.closure_reasons'].value.codes,
    numberChanges: numberChanges.map((r) => ({ ...r.c, actorName: r.actorName })),
    /** 'hidden' = the caller may not see guardians (restricted, students may be minors). */
    guardians: privateData.guardians,
    timeline,
    followUps,
    actions: {
      hold: options.hold && canLifecycle,
      resume: options.resume && canLifecycle,
      /** Exit statuses offered (empty = no exit possible or not permitted). */
      exitStatuses: canLifecycle ? options.exitStatuses : [],
      reactivate:
        options.reactivate &&
        Boolean(openExit?.e.reactivationAllowed) &&
        can(actor, 'ops:students:reactivate'),
      editGuardians:
        privateData.visible && Boolean(identityId) && can(actor, 'ops:guardians:write'),
      report: Boolean(identityId) && can(actor, 'ops:student_reports:generate'),
      overrideNumber: can(actor, 'ops:admission_number:override'),
    },
    fees,
  };
}

// Academic read contract: moved to ./academic-summary (F-ACADEMIC); re-exported for existing importers.
export { academicStudentSummarySchema, fetchAcademicStudentSummary } from './academic-summary';
