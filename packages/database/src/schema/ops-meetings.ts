/**
 * OWNER: Business Ops OS — counselling & meetings: appointments, teacher subject
 * capabilities and the two feedback directions (owner brief 20 Oct 2026 §11–12).
 * Part of the `ops` Postgres schema, split across ops*.ts (D-029). Same rules and
 * naming as ops.ts (`ops.table(...)`, exports prefixed `ops`, UUID PKs, FKs only within
 * ops or into core, only `import type` from workspace packages).
 *
 * The two feedback tables point in OPPOSITE directions and are never merged:
 * teacher → student (`teacher_student_feedback`, versioned, on the student profile) and
 * student/guardian → teacher (`student_teacher_feedback`, moderated, on the teacher profile;
 * the teacher can never edit it).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { AdmissionId, Brand, EnrolmentId, LeadId, ProgrammeId } from '@elevate/shared-types';
import { programmes } from './core';
import { ops, opsAdmissions, opsLeads } from './ops';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  staffRef,
  staffRefRestrict,
  studentRef,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsDemoSessions, opsDemos, type OpsDemoId, type OpsDemoSessionId } from './ops-demos';
import { opsGuardians, type OpsGuardianId } from './ops-students';

export type OpsAppointmentId = Brand<string, 'OpsAppointmentId'>;
export type OpsTeacherStudentFeedbackId = Brand<string, 'OpsTeacherStudentFeedbackId'>;
export type OpsStudentTeacherFeedbackId = Brand<string, 'OpsStudentTeacherFeedbackId'>;
export type OpsEventMessageId = Brand<string, 'OpsEventMessageId'>;

export const OPS_FEEDBACK_STATUSES = ['draft', 'final'] as const;
export const OPS_MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export const OPS_VERIFICATION_STATUSES = ['unverified', 'confirmed'] as const;
/** What a teacher review is about: a demo class, an Academic enrolment, or neither. */
export const OPS_FEEDBACK_SCOPES = ['demo_session', 'enrolment', 'general'] as const;
/** `internal` = authorised staff only; `shareable` = may feed a reviewed guardian/student report. */
export const OPS_FEEDBACK_VISIBILITY = ['internal', 'shareable'] as const;

const at = () => instant('at').notNull().defaultNow();
const appointmentRef = () =>
  uuid('appointment_id')
    .notNull()
    .references(() => opsAppointments.id, { onDelete: 'restrict' })
    .$type<OpsAppointmentId>();

// Appointment vocabulary (brief §11; mirrored in apps/business-ops-os/src/domain/appointments.ts).
export const OPS_APPOINTMENT_TYPES = [
  'student_counselling',
  'guardian_counselling',
  'teacher_academic',
  'parent_teacher_meeting',
  'admission_follow_up',
  'demo_review',
  'event',
  'webinar',
] as const;
/** Types for a cohort or audience rather than one person (no student/lead/admission needed). */
const GROUP_TYPES = ['event', 'webinar'] as const;
export const OPS_PARTICIPANT_ADDED_VIA = ['audience_snapshot', 'manual'] as const;
export const OPS_PARTICIPANT_REGISTRATION = ['invited', 'registered', 'declined'] as const;
export const OPS_PARTICIPANT_ATTENDANCE = ['not_recorded', 'present', 'absent'] as const;
export const OPS_MESSAGE_CHANNELS = ['email', 'sms', 'whatsapp', 'in_app'] as const;
/** `simulated` = the mock adapter ran and nothing was sent; `sent` needs a provider reference. */
export const OPS_MESSAGE_STATUSES = ['draft', 'simulated', 'sent'] as const;
export const OPS_APPOINTMENT_STATUSES = [
  'proposed',
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
] as const;
/** Online, or offline at the Sikar centre (owner, 20 Oct 2026). */
export const OPS_APPOINTMENT_MODES = ['offline', 'online'] as const;
/** `simulated` = an email/SMS/WhatsApp reminder that was NOT sent (mock adapter, D-014). */
export const OPS_REMINDER_STATUSES = [
  'pending',
  'sent_in_app',
  'simulated',
  'not_applicable',
] as const;

/**
 * One counselling session, meeting, event or webinar (OPS-008, brief §11–§12) with one
 * assigned staff member (`staff_id`, the owner). A one-to-one type concerns a student, a lead
 * or an admission case (at least one); an event or webinar targets an audience whose matching
 * people are snapshotted into `appointment_participants`. Overlap rule: domain/appointments.ts
 * (A-MTG-1). Every change is kept in `ops.appointment_changes`. Scheduling never sends messages.
 */
export const opsAppointments = ops.table(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAppointmentId>(),
    type: text('type', { enum: OPS_APPOINTMENT_TYPES }).notNull().default('student_counselling'),
    admissionId: uuid('admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    studentId: studentRef(),
    /** Demo this meeting reviews (type `demo_review`). */
    demoId: uuid('demo_id')
      .references(() => opsDemos.id, { onDelete: 'restrict' })
      .$type<OpsDemoId>(),
    /** Staff member who booked it, when different from the assigned one. */
    organiserStaffId: staffRef('organiser_staff_id'),
    startsAt: instant('starts_at').notNull(),
    endsAt: instant('ends_at').notNull(),
    /** How the instants are shown (always Asia/Kolkata today). */
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    /** Assigned counsellor or teacher (overlaps are checked for this person). */
    staffId: staffRefRestrict('staff_id').notNull(),
    mode: text('mode', { enum: OPS_APPOINTMENT_MODES }).notNull(),
    /** Where (offline) or how (e.g. "Phone call"); null = Sikar centre or video link. */
    location: text('location'),
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    subject: text('subject'),
    purpose: text('purpose'),
    /** Event or webinar title. */
    title: text('title'),
    /** Video or webinar link (online). */
    onlineLink: text('online_link'),
    /** Maximum participants; null = no limit. */
    capacity: integer('capacity'),
    /** Audience filters used to pick participants (programmes, class/category, batches, lifecycle). */
    audience: jsonb('audience').$type<Record<string, unknown>>(),
    status: text('status', { enum: OPS_APPOINTMENT_STATUSES }).notNull().default('scheduled'),
    reminderStatus: text('reminder_status', { enum: OPS_REMINDER_STATUSES })
      .notNull()
      .default('pending'),
    /** Programme the counsellor recommended when completing it. */
    recommendedProgrammeId: uuid('recommended_programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    /** Concerns the family raised (counselling). */
    objections: text('objections'),
    outcome: text('outcome'),
    /** Agreed next step and its IST due day. */
    nextStep: text('next_step'),
    followUpOn: isoDate('follow_up_on'),
    /** Required when cancelled (a no-show is a cancellation with reason "No-show: …"). */
    cancelReason: text('cancel_reason'),
    completedAt: instant('completed_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('appointments_starts_idx').on(t.startsAt),
    index('appointments_admission_idx').on(t.admissionId),
    index('appointments_staff_time_idx').on(t.staffId, t.startsAt),
    index('appointments_student_idx').on(t.studentId),
    check('appointments_type_check', sql`${t.type} IN ${inList(OPS_APPOINTMENT_TYPES)}`),
    check('appointments_status_check', sql`${t.status} IN ${inList(OPS_APPOINTMENT_STATUSES)}`),
    check('appointments_mode_check', sql`${t.mode} IN ${inList(OPS_APPOINTMENT_MODES)}`),
    check(
      'appointments_reminder_check',
      sql`${t.reminderStatus} IN ${inList(OPS_REMINDER_STATUSES)}`,
    ),
    check('appointments_ends_after_start', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'appointments_has_person',
      sql`${t.type} IN ${inList(GROUP_TYPES)} OR ${t.studentId} IS NOT NULL OR ${t.leadId} IS NOT NULL OR ${t.admissionId} IS NOT NULL`,
    ),
    check(
      'appointments_group_title',
      sql`${t.type} NOT IN ${inList(GROUP_TYPES)} OR ${t.title} IS NOT NULL`,
    ),
    check('appointments_capacity_check', sql`${t.capacity} IS NULL OR ${t.capacity} >= 1`),
    check(
      'appointments_cancel_reason',
      sql`${t.status} <> 'cancelled' OR ${t.cancelReason} IS NOT NULL`,
    ),
  ],
);

/** Who takes part in an appointment besides the assigned staff member. */
export const opsAppointmentParticipants = ops.table(
  'appointment_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: appointmentRef(),
    /** Staff member, guardian or student. */
    kind: text('kind', { enum: ['staff', 'guardian', 'student'] }).notNull(),
    staffId: staffRefRestrict('staff_id'),
    guardianId: uuid('guardian_id')
      .references(() => opsGuardians.id, { onDelete: 'restrict' })
      .$type<OpsGuardianId>(),
    studentId: studentRef(),
    /** e.g. teacher, counsellor, organiser, mother. */
    role: text('role'),
    /** Name when added (later renames do not rewrite the participant list). */
    nameSnapshot: text('name_snapshot'),
    /** From the audience snapshot, or added by hand afterwards. */
    addedVia: text('added_via')
      .$type<(typeof OPS_PARTICIPANT_ADDED_VIA)[number]>()
      .notNull()
      .default('manual'),
    addedBy: userRef('added_by'),
    addedAt: instant('added_at').notNull().defaultNow(),
    /** Removed participants stay listed with who removed them and why. */
    removedAt: instant('removed_at'),
    removedBy: userRef('removed_by'),
    removedReason: text('removed_reason'),
    /** Events: invited, registered or declined; null for one-to-one meetings. */
    registrationStatus:
      text('registration_status').$type<(typeof OPS_PARTICIPANT_REGISTRATION)[number]>(),
    attendance: text('attendance')
      .$type<(typeof OPS_PARTICIPANT_ATTENDANCE)[number]>()
      .notNull()
      .default('not_recorded'),
  },
  (t) => [
    index('appointment_participants_appointment_idx').on(t.appointmentId),
    index('appointment_participants_staff_idx').on(t.staffId),
    check(
      'appointment_participants_added_via_check',
      sql`${t.addedVia} IN ${inList(OPS_PARTICIPANT_ADDED_VIA)}`,
    ),
    check(
      'appointment_participants_registration_check',
      sql`${t.registrationStatus} IS NULL OR ${t.registrationStatus} IN ${inList(OPS_PARTICIPANT_REGISTRATION)}`,
    ),
    check(
      'appointment_participants_attendance_check',
      sql`${t.attendance} IN ${inList(OPS_PARTICIPANT_ATTENDANCE)}`,
    ),
    check(
      'appointment_participants_removed_check',
      sql`(${t.removedAt} IS NULL) = (${t.removedBy} IS NULL) AND (${t.removedAt} IS NULL) = (${t.removedReason} IS NULL)`,
    ),
    check(
      'appointment_participants_ref_matches_kind',
      sql`(${t.kind} = 'staff' AND ${t.staffId} IS NOT NULL) OR (${t.kind} = 'guardian' AND ${t.guardianId} IS NOT NULL) OR (${t.kind} = 'student' AND ${t.studentId} IS NOT NULL)`,
    ),
  ],
);

/** Append-only history of appointment changes (reschedule, status, outcome). */
export const opsAppointmentChanges = ops.table(
  'appointment_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: appointmentRef(),
    /** What changed, e.g. status or starts_at. */
    field: text('field').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    /** Why (required for reschedule and cancel). */
    reason: text('reason'),
    actorUserId: userRef('actor_user_id'),
    at: at(),
  },
  (t) => [index('appointment_changes_appointment_idx').on(t.appointmentId, t.at)],
);

/**
 * A message to an event's participants. Written as a draft; sent only by an explicit,
 * authorised action through the messaging adapter. Never `sent` without a provider reference.
 */
export const opsEventMessages = ops.table(
  'event_messages',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEventMessageId>(),
    appointmentId: appointmentRef(),
    channel: text('channel').$type<(typeof OPS_MESSAGE_CHANNELS)[number]>().notNull(),
    body: text('body').notNull(),
    status: text('status')
      .$type<(typeof OPS_MESSAGE_STATUSES)[number]>()
      .notNull()
      .default('draft'),
    /** Provider message/batch id (status `sent` only). */
    providerRef: text('provider_ref'),
    /** Recipients at send time (contact preferences applied). */
    recipientCount: integer('recipient_count'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    sentBy: userRef('sent_by'),
    sentAt: instant('sent_at'),
  },
  (t) => [
    index('event_messages_appointment_idx').on(t.appointmentId),
    check('event_messages_channel_check', sql`${t.channel} IN ${inList(OPS_MESSAGE_CHANNELS)}`),
    check('event_messages_status_check', sql`${t.status} IN ${inList(OPS_MESSAGE_STATUSES)}`),
    check(
      'event_messages_sent_check',
      sql`(${t.status} = 'draft') = (${t.sentBy} IS NULL AND ${t.sentAt} IS NULL) AND (${t.status} <> 'sent' OR length(trim(coalesce(${t.providerRef}, ''))) > 0)`,
    ),
    check(
      'event_messages_recipients_check',
      sql`${t.recipientCount} IS NULL OR ${t.recipientCount} >= 0`,
    ),
  ],
);

/**
 * Subjects / programmes a staff member teaches. A row with no staff member is a
 * catalogue subject with no teacher assigned (e.g. Accountancy / CA).
 */
export const opsStaffSubjectCapabilities = ops.table(
  'staff_subject_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Teacher; null = a subject with no teacher assigned. */
    staffId: staffRefRestrict('staff_id'),
    /** Subject the teacher teaches. */
    subject: text('subject').notNull(),
    /** Programme the subject is for, when limited to one. */
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    verificationStatus: text('verification_status', { enum: OPS_VERIFICATION_STATUSES })
      .notNull()
      .default('unverified'),
    sourceNote: text('source_note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_subject_capabilities_staff_subject_key')
      .on(t.staffId, t.subject)
      .where(sql`${t.staffId} IS NOT NULL`),
    uniqueIndex('staff_subject_capabilities_unassigned_key')
      .on(t.subject)
      .where(sql`${t.staffId} IS NULL`),
    check(
      'staff_subject_capabilities_verification_check',
      sql`${t.verificationStatus} IN ${inList(OPS_VERIFICATION_STATUSES)}`,
    ),
  ],
);

/**
 * Teacher → student feedback: the ONE store of teacher reviews (demo classes included). A final
 * row is never edited: an edit inserts a new version that `supersedes_id` the previous one (each
 * version superseded once). No row = "No review submitted" (pending), never a negative.
 */
export const opsTeacherStudentFeedback = ops.table(
  'teacher_student_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTeacherStudentFeedbackId>(),
    /** Teacher who wrote it. */
    teacherStaffId: staffRefRestrict('teacher_staff_id').notNull(),
    studentId: studentRef().notNull(),
    /** Subject it is about. */
    subject: text('subject').notNull(),
    /** IST calendar day the observation refers to. */
    observedOn: isoDate('observed_on').notNull(),
    /** Related class / assessment reference (Academic ids are plain text, no FK). */
    relatedRef: text('related_ref'),
    /** What the review is about: a demo class, an enrolment, or general. */
    scope: text('scope').$type<(typeof OPS_FEEDBACK_SCOPES)[number]>().notNull().default('general'),
    /** Demo class reviewed (scope `demo_session`). */
    demoSessionId: uuid('demo_session_id')
      .references(() => opsDemoSessions.id, { onDelete: 'restrict' })
      .$type<OpsDemoSessionId>(),
    /** Academic OS enrolment reviewed (scope `enrolment`; plain id, no FK across modules). */
    enrolmentId: uuid('enrolment_id').$type<EnrolmentId>(),
    /** `internal` (default) or `shareable` with a reviewed guardian/student report. */
    visibility: text('visibility')
      .$type<(typeof OPS_FEEDBACK_VISIBILITY)[number]>()
      .notNull()
      .default('internal'),
    /** What the teacher observed. */
    observations: text('observations').notNull(),
    /** Strengths noticed. */
    strengths: text('strengths'),
    /** Areas to improve. */
    areasToImprove: text('areas_to_improve'),
    /** Agreed next steps. */
    actionPlan: text('action_plan'),
    /** `draft` (editable by its teacher) or `final`. */
    status: text('status', { enum: OPS_FEEDBACK_STATUSES }).notNull().default('draft'),
    /** Version number; an edit of a final row adds version + 1. */
    version: integer('version').notNull().default(1),
    /** The earlier version this one replaces. */
    supersedesId: uuid('supersedes_id')
      .references((): AnyPgColumn => opsTeacherStudentFeedback.id, { onDelete: 'restrict' })
      .$type<OpsTeacherStudentFeedbackId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('teacher_student_feedback_student_idx').on(t.studentId),
    index('teacher_student_feedback_teacher_idx').on(t.teacherStaffId),
    index('teacher_student_feedback_demo_session_idx').on(t.demoSessionId),
    index('teacher_student_feedback_enrolment_idx').on(t.enrolmentId),
    check(
      'teacher_student_feedback_scope_check',
      sql`${t.scope} IN ${inList(OPS_FEEDBACK_SCOPES)}`,
    ),
    check(
      'teacher_student_feedback_scope_ref',
      sql`(${t.scope} = 'demo_session') = (${t.demoSessionId} IS NOT NULL) AND (${t.scope} = 'enrolment') = (${t.enrolmentId} IS NOT NULL)`,
    ),
    check(
      'teacher_student_feedback_visibility_check',
      sql`${t.visibility} IN ${inList(OPS_FEEDBACK_VISIBILITY)}`,
    ),

    uniqueIndex('teacher_student_feedback_supersedes_key')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} IS NOT NULL`),
    check(
      'teacher_student_feedback_status_check',
      sql`${t.status} IN ${inList(OPS_FEEDBACK_STATUSES)}`,
    ),
    check('teacher_student_feedback_version_check', sql`${t.version} >= 1`),
  ],
);

/** Student / guardian → teacher feedback, recorded by staff on their behalf and moderated. */
export const opsStudentTeacherFeedback = ops.table(
  'student_teacher_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsStudentTeacherFeedbackId>(),
    /** Teacher the feedback is about. */
    teacherStaffId: staffRefRestrict('teacher_staff_id').notNull(),
    studentId: studentRef(),
    /** Given by the student or a guardian (staff record it). */
    submittedByKind: text('submitted_by_kind', { enum: ['student', 'guardian'] }).notNull(),
    /** Subject or batch the feedback is about (free text; batches are Academic-owned). */
    subjectRef: text('subject_ref'),
    feedbackOn: isoDate('feedback_on').notNull(),
    /** 1–5 when given (scale is a proposed setting); null = no rating. */
    rating: integer('rating'),
    /** The feedback in their words. */
    comment: text('comment').notNull(),
    /** Moderation state; only `approved` can be shown. */
    moderationStatus: text('moderation_status', { enum: OPS_MODERATION_STATUSES })
      .notNull()
      .default('pending'),
    /** Moderator note. */
    moderationNote: text('moderation_note'),
    moderatedBy: userRef('moderated_by'),
    moderatedAt: instant('moderated_at'),
    /** Who may read it once approved. */
    visibility: text('visibility', { enum: ['staff_only', 'teacher_and_staff'] })
      .notNull()
      .default('staff_only'),
    recordedBy: userRef('recorded_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('student_teacher_feedback_teacher_idx').on(t.teacherStaffId, t.moderationStatus),
    check(
      'student_teacher_feedback_moderation_check',
      sql`${t.moderationStatus} IN ${inList(OPS_MODERATION_STATUSES)}`,
    ),
    check(
      'student_teacher_feedback_rating_check',
      sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`,
    ),
    check(
      'student_teacher_feedback_visibility_check',
      sql`${t.visibility} IN ('staff_only', 'teacher_and_staff')`,
    ),
  ],
);
