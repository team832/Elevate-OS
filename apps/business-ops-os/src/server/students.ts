/**
 * Student administration (OPS-073…077). Ops keeps NO student master: Academic
 * OS owns `academic.students`. An Ops "student" is an admission that reached
 * `admitted` (domain/students.ts → directoryState), linked to Academic's record
 * by the studentId/enrolmentId returned in `academic.enrolment.confirmed`.
 *
 * Permissions: `ops:students:read` (counsellor: own scope = admission counsellor
 * or lead owner). Contact, guardian and consent data additionally need
 * `ops:student_private:read` (same scope rule) — students may be minors; the
 * directory list never carries private fields at all.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import {
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsAdmissionTransitions,
  opsContactPreferences,
  opsCounsellingSessions,
  opsDemos,
  opsEnquiries,
  opsEnrolmentAttempts,
  opsLeads,
  opsLeadSources,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ForbiddenError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { AdmissionId, IntegrationEventId } from '@elevate/shared-types';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../domain';
import {
  academicStudentPath,
  deriveHandoffView,
  directoryState,
  DIRECTORY_STATE_LABELS,
  redactStudentPrivate,
  retryDecision,
  type DirectoryState,
} from '../domain/students';
import type { ContactPreferencesInput, StudentListQuery } from './admissions-schemas';
import { ACADEMIC_INTAKE_CONSUMER } from './admissions';
import { accessScope, clean, staffIdForUser, type AccessScope, type Actor } from './context';
import { feeSummaryFor } from './fees';
import { ENROLMENT_REPLIES_CONSUMER } from './enrolment';
import { loadSettings } from './settings';

const NONE = '00000000-0000-0000-0000-000000000000';

/** SQL: the admission is a student (admitted / awaiting / enrolled, or withdrawn after admission). */
const isStudent = or(
  inArray(opsAdmissions.status, ['admitted', 'enrolment_requested', 'enrolled']),
  and(eq(opsAdmissions.status, 'lost'), isNotNull(opsAdmissions.admittedAt)),
) as SQL;

function ownFilter(access: AccessScope): SQL | undefined {
  if (access.scope === 'all') return undefined;
  const staffId = access.staffId ?? (NONE as never);
  return or(
    eq(opsAdmissions.counsellorStaffId, staffId),
    eq(opsLeads.ownerStaffId, staffId),
  ) as SQL;
}

const STATE_FILTER: Record<DirectoryState, SQL> = {
  admitted: eq(opsAdmissions.status, 'admitted'),
  awaiting_enrolment: eq(opsAdmissions.status, 'enrolment_requested'),
  enrolled: eq(opsAdmissions.status, 'enrolled'),
  withdrawn: and(eq(opsAdmissions.status, 'lost'), isNotNull(opsAdmissions.admittedAt)) as SQL,
};

async function deliveriesFor(db: Database, eventIds: readonly (string | null)[]) {
  const ids = [...new Set(eventIds.filter((e): e is string => Boolean(e)))] as IntegrationEventId[];
  if (!ids.length)
    return new Map<string, { status: string; attempts: number; lastError: string | null }>();
  const rows = await db
    .select({
      eventId: eventDeliveries.eventId,
      status: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
      lastError: eventDeliveries.lastError,
    })
    .from(eventDeliveries)
    .where(
      and(
        inArray(eventDeliveries.eventId, ids),
        eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
      ),
    );
  return new Map(rows.map((r) => [r.eventId as string, r]));
}

/** GET /students — directory (search, state/programme/handoff filters, sort, offset cursor). */
export async function listStudents(db: Database, actor: Actor, query: StudentListQuery) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const conditions: SQL[] = [isStudent];
  const own = ownFilter(access);
  if (own) conditions.push(own);
  if (query.state) conditions.push(STATE_FILTER[query.state]);
  if (query.handoff) conditions.push(eq(opsAdmissions.handoffStatus, query.handoff));
  if (query.programme) conditions.push(eq(programmes.code, query.programme));
  if (query.q) {
    const q = `%${query.q.replace(/[%_\\]/g, '')}%`;
    conditions.push(
      or(
        ilike(opsLeads.studentName, q),
        ilike(opsAdmissions.code, q),
        ilike(opsLeads.code, q),
      ) as SQL,
    );
  }
  const order =
    query.sort === 'name'
      ? [asc(opsLeads.studentName), asc(opsAdmissions.code)]
      : query.sort === 'oldest'
        ? [asc(opsAdmissions.admittedAt), asc(opsAdmissions.code)]
        : [desc(opsAdmissions.admittedAt), desc(opsAdmissions.code)];
  const offset = query.cursor ? Number(query.cursor) : 0;
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
    .where(and(...conditions))
    .orderBy(...order)
    .limit(query.limit + 1)
    .offset(offset);
  const page = rows.slice(0, query.limit);
  const deliveries = await deliveriesFor(
    db,
    page.map((r) => r.a.lastRequestEventId),
  );
  return {
    items: page.map((r) => {
      const a = r.a;
      const view = deriveHandoffView({
        status: a.status as AdmissionStatus,
        handoffStatus: a.handoffStatus,
        enrolmentAttempt: a.enrolmentAttempt,
        academicDelivery: a.lastRequestEventId
          ? (deliveries.get(a.lastRequestEventId) ?? null)
          : null,
        rejectionCode: a.rejectionCode,
        rejectionReason: a.rejectionReason,
      });
      const state = directoryState({
        status: a.status as AdmissionStatus,
        admittedAt: a.admittedAt,
      });
      return {
        id: a.id,
        code: a.code,
        leadId: a.leadId,
        leadCode: r.leadCode,
        studentName: r.studentName,
        programmeCode: r.programmeCode,
        counsellorName: r.counsellorName,
        status: a.status as AdmissionStatus,
        state,
        stateLabel: state ? DIRECTORY_STATE_LABELS[state] : null,
        admissionDate: a.admissionDate,
        admittedAt: a.admittedAt,
        enrolledAt: a.enrolledAt,
        handoff: view,
        studentId: a.studentId,
        academicPath: academicStudentPath(a.studentId),
      };
    }),
    nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
  };
}

async function canSeePrivate(db: Database, actor: Actor, owners: (string | null)[]) {
  const scope = scopeFor(actor, 'ops:student_private:read');
  if (scope === 'all') return true;
  if (scope !== 'own') return false;
  const staffId = await staffIdForUser(db, actor.id);
  return Boolean(staffId && owners.includes(staffId));
}

async function studentRow(db: Database, access: AccessScope, admissionId: string) {
  const [row] = await db
    .select({ a: opsAdmissions, lead: opsLeads })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsAdmissions.id, admissionId as AdmissionId))
    .limit(1);
  if (!row) throw new NotFoundError('Student not found.');
  const state = directoryState({
    status: row.a.status as AdmissionStatus,
    admittedAt: row.a.admittedAt,
  });
  if (!state)
    throw new NotFoundError(
      'This admission has not been admitted, so there is no student record yet.',
    );
  if (
    access.scope === 'own' &&
    (!access.staffId ||
      (row.a.counsellorStaffId !== access.staffId && row.lead.ownerStaffId !== access.staffId))
  )
    throw new ForbiddenError('You can only open students whose admission is assigned to you.');
  return { ...row, state };
}

/** GET /students/{admissionId} — the student profile (reference, not a master record). */
export async function getStudent(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const { a, lead, state } = await studentRow(db, access, admissionId);
  const settings = await loadSettings(db);
  const reasonLabels = new Map(
    settings['admissions.closure_reasons'].value.codes.map((c) => [c.code, c.label]),
  );
  const [programme] = a.programmeId
    ? await db
        .select({ code: programmes.code, name: programmes.name })
        .from(programmes)
        .where(eq(programmes.id, a.programmeId))
    : [];
  const [counsellor] = a.counsellorStaffId
    ? await db
        .select({ id: staffMembers.id, fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, a.counsellorStaffId))
    : [];
  const [transitions, enquiries, sessions, demos, attempts, otherAdmissions] = await Promise.all([
    db
      .select({ t: opsAdmissionTransitions, actorName: users.displayName })
      .from(opsAdmissionTransitions)
      .leftJoin(users, eq(users.id, opsAdmissionTransitions.actorUserId))
      .where(eq(opsAdmissionTransitions.admissionId, a.id))
      .orderBy(asc(opsAdmissionTransitions.at), asc(opsAdmissionTransitions.id)),
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
        id: opsCounsellingSessions.id,
        scheduledAt: opsCounsellingSessions.scheduledAt,
        status: opsCounsellingSessions.status,
        mode: opsCounsellingSessions.mode,
        outcome: opsCounsellingSessions.outcome,
        counsellorName: staffMembers.fullName,
      })
      .from(opsCounsellingSessions)
      .innerJoin(staffMembers, eq(staffMembers.id, opsCounsellingSessions.counsellorStaffId))
      .where(eq(opsCounsellingSessions.admissionId, a.id))
      .orderBy(desc(opsCounsellingSessions.scheduledAt)),
    db
      .select({
        id: opsDemos.id,
        dayDates: opsDemos.dayDates,
        subjects: opsDemos.subjects,
        status: opsDemos.status,
        feeStatus: opsDemos.feeStatus,
        feeTermsState: opsDemos.feeTermsState,
      })
      .from(opsDemos)
      .where(eq(opsDemos.admissionId, a.id))
      .orderBy(desc(opsDemos.createdAt)),
    db
      .select({ x: opsEnrolmentAttempts, requestedByName: users.displayName })
      .from(opsEnrolmentAttempts)
      .leftJoin(users, eq(users.id, opsEnrolmentAttempts.requestedBy))
      .where(eq(opsEnrolmentAttempts.admissionId, a.id))
      .orderBy(asc(opsEnrolmentAttempts.attempt)),
    db
      .select({ id: opsAdmissions.id, code: opsAdmissions.code, status: opsAdmissions.status })
      .from(opsAdmissions)
      .where(and(eq(opsAdmissions.leadId, lead.id))),
  ]);
  const academicDelivery = a.lastRequestEventId
    ? ((await deliveriesFor(db, [a.lastRequestEventId])).get(a.lastRequestEventId) ?? null)
    : null;
  // Replies Academic sent for the current request, and whether Ops applied them.
  const replies = a.lastRequestEventId
    ? await db
        .select({
          id: integrationEvents.id,
          type: integrationEvents.type,
          occurredAt: integrationEvents.occurredAt,
          opsStatus: eventDeliveries.status,
          opsError: eventDeliveries.lastError,
        })
        .from(integrationEvents)
        .leftJoin(
          eventDeliveries,
          and(
            eq(eventDeliveries.eventId, integrationEvents.id),
            eq(eventDeliveries.consumer, ENROLMENT_REPLIES_CONSUMER),
          ),
        )
        .where(
          and(
            eq(integrationEvents.correlationId, a.lastRequestEventId),
            inArray(integrationEvents.type, [
              'academic.enrolment.confirmed',
              'academic.enrolment.rejected',
            ]),
          ),
        )
    : [];
  const handoffInput = {
    status: a.status as AdmissionStatus,
    handoffStatus: a.handoffStatus,
    enrolmentAttempt: a.enrolmentAttempt,
    academicDelivery,
    rejectionCode: a.rejectionCode,
    rejectionReason: a.rejectionReason,
  };
  const privateVisible = await canSeePrivate(db, actor, [a.counsellorStaffId, lead.ownerStaffId]);
  const [prefs] = privateVisible
    ? await db.select().from(opsContactPreferences).where(eq(opsContactPreferences.leadId, lead.id))
    : [];
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
    privateVisible,
  );
  return {
    admission: {
      id: a.id,
      code: a.code,
      status: a.status as AdmissionStatus,
      statusLabel: ADMISSION_STATUS_LABELS[a.status as AdmissionStatus],
      statusReason: a.statusReason,
      statusReasonCode: a.statusReasonCode,
      statusReasonLabel: a.statusReasonCode ? (reasonLabels.get(a.statusReasonCode) ?? null) : null,
      state,
      stateLabel: DIRECTORY_STATE_LABELS[state],
      admissionDate: a.admissionDate,
      admittedAt: a.admittedAt,
      deliveryMode: a.deliveryMode,
      intendedStartDate: a.intendedStartDate,
      intendedCourseId: a.intendedCourseId,
      intendedBatchId: a.intendedBatchId,
    },
    owner: counsellor ?? null,
    programme: programme ?? null,
    person,
    academic: {
      studentId: a.studentId,
      enrolmentId: a.enrolmentId,
      existingStudent: a.academicExistingStudent,
      enrolledCourseId: a.enrolledCourseId,
      enrolledBatchId: a.enrolledBatchId,
      enrolledAt: a.enrolledAt,
      path: academicStudentPath(a.studentId),
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
      attempts: attempts.map((x) => ({ ...x.x, requestedByName: x.requestedByName })),
    },
    history: transitions.map((t) => ({
      ...t.t,
      actorName: t.actorName,
      reasonLabel: t.t.reasonCode ? (reasonLabels.get(t.t.reasonCode) ?? t.t.reasonCode) : null,
    })),
    enquiries,
    counselling: sessions,
    demos,
    otherAdmissions: otherAdmissions.filter((o) => o.id !== a.id),
    /** null = the caller may not read fee records. */
    fees: can(actor, 'ops:fees:read') ? await feeSummaryFor(db, a.id) : null,
  };
}

/** PUT /admissions/{id}/contact-preferences — consent and communication preferences (private). */
export async function recordContactPreferences(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: ContactPreferencesInput,
  requestId?: string,
) {
  const write = await accessScope(db, actor, 'ops:admissions:write');
  await accessScope(db, actor, 'ops:student_private:read');
  if (input.consentStatus !== 'given' && input.allowedChannels.length > 0)
    throw new ValidationError('Without consent no contact channel can be allowed.', {
      details: [
        {
          location: 'body',
          path: ['allowedChannels'],
          message: 'Must be empty unless consent is given',
        },
      ],
    });
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ a: opsAdmissions, ownerStaffId: opsLeads.ownerStaffId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.id, admissionId as AdmissionId))
      .limit(1);
    if (!row) throw new NotFoundError('Admission not found.');
    const owners = [row.a.counsellorStaffId, row.ownerStaffId];
    if (write.scope === 'own' && !(write.staffId && owners.includes(write.staffId)))
      throw new ForbiddenError('You can only work on admissions assigned to you.');
    if (!(await canSeePrivate(tx, actor, owners)))
      throw new ForbiddenError('You may not record private details for this student.');
    const [before] = await tx
      .select()
      .from(opsContactPreferences)
      .where(eq(opsContactPreferences.leadId, row.a.leadId));
    const values = {
      leadId: row.a.leadId,
      consentStatus: input.consentStatus,
      consentBy: input.consentBy,
      allowedChannels: [...new Set(input.allowedChannels)],
      preferredContact: input.preferredContact ?? null,
      note: clean(input.note),
      recordedBy: actor.id,
      recordedAt: new Date(),
    };
    const [after] = await tx
      .insert(opsContactPreferences)
      .values(values)
      .onConflictDoUpdate({ target: opsContactPreferences.leadId, set: values })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'contact_preferences.recorded',
      entityType: 'lead',
      entityId: row.a.leadId,
      // Consent facts only — never contact details.
      before: before
        ? { consentStatus: before.consentStatus, allowedChannels: before.allowedChannels }
        : null,
      after: { consentStatus: values.consentStatus, allowedChannels: values.allowedChannels },
      requestId,
      metadata: { leadId: row.a.leadId, admissionId: row.a.id },
    });
    return after;
  });
}
