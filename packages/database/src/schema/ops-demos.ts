/**
 * OWNER: Business Ops OS — admissions slice "demos: sessions, corrections, checklist" (owner brief 20 Oct 2026).
 * Part of the `ops` Postgres schema, split across ops*.ts (D-029). Same rules as ops.ts:
 * `ops.table(...)`, exports prefixed `ops`, UUID PKs, FKs only within ops or into core,
 * only `import type` from workspace packages; naming conventions in ops.ts (D-036).
 *
 * Rules (apps/business-ops-os/docs/parts/admissions-demos.md):
 * - a demo has N demo days (N = setting `admissions.demo.day_count` at booking, D-038), each
 *   with one or more sessions (classes);
 * - attendance changes after the first recording append to `demo_session_changes`;
 * - checklist entries are append-only, latest entry per item wins.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AdmissionId, Brand, LeadId, ProgrammeId } from '@elevate/shared-types';
import { programmes } from './core';
import { opsAdmissions, opsLeads } from './ops';
import {
  createdAt,
  inList,
  instant,
  ops,
  staffRef,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export type OpsDemoId = Brand<string, 'OpsDemoId'>;
export type OpsDemoSessionId = Brand<string, 'OpsDemoSessionId'>;
export type OpsDemoSessionChangeId = Brand<string, 'OpsDemoSessionChangeId'>;
export type OpsChecklistEntryId = Brand<string, 'OpsChecklistEntryId'>;

/** Demo outcome (owner brief 20 Oct 2026 §4.2/§5). `converted` is set only by the conversion. */
export const OPS_DEMO_OUTCOMES = [
  'open',
  'converted',
  'declined',
  'withdrawn',
  'not_converted',
  'cancelled',
  'no_show',
] as const;
/** Legacy demo-fee flag; the demo charge itself is a ledger row (`fee_records.charge_category = 'demo'`). */
export const OPS_DEMO_FEE_STATUSES = [
  'not_paid',
  'paid_verified',
  'adjusted_against_fees',
  'retained_non_refundable',
] as const;

/**
 * A demo: N demo days of separate trial classes for one admission case (OPS-009, BR-OPS-2), never
 * main-batch sessions. Dates, subjects, teachers and attendance live in
 * `ops.demo_sessions` (below), one row per class. The demo fee and its terms are
 * copied from the `demo.fee` setting at booking, with that setting's decision state.
 * Sample or real follows the lead (`ops.leads.is_sample`).
 */
export const opsDemos = ops.table(
  'demos',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDemoId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** State of the demo fee (never a verified payment unless paid_verified). */
    feeStatus: text('fee_status', { enum: OPS_DEMO_FEE_STATUSES }).notNull().default('not_paid'),
    /** Demo fee at booking in integer paise (setting `demo.fee`); null = no fee. */
    feeAmountPaise: bigint('fee_amount_paise', { mode: 'number' }),
    /** Decision state of the demo-terms fee when booked (e.g. `approved`, recorded from legacy D-003). */
    feeTermsState: text('fee_terms_state').notNull(),
    /** Receipt or accounts reference for the demo fee. */
    feeReference: text('fee_reference'),
    notes: text('notes'),
    /** When every session had a final attendance recorded (the demo is "completed"; outcome stays open). */
    completedAt: instant('completed_at'),
    /** Demo-level programme (sessions may name their own). */
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    /** Counsellor responsible for the demo. */
    counsellorStaffId: staffRef('counsellor_staff_id'),
    /** Classes (sessions) booked across all demo days. */
    plannedSessionCount: integer('planned_session_count').notNull(),
    /** Setting `admissions.demo.day_count` at booking (later changes do not rewrite it, D-038). */
    plannedDayCount: integer('planned_day_count').notNull().default(3),
    /** `open` until decided; `converted` only through Convert to admission. */
    outcome: text('outcome').notNull().default('open'),
    /** Why it was declined, withdrawn, not converted or cancelled. */
    outcomeReason: text('outcome_reason'),
    /** When the outcome was recorded. */
    outcomeAt: instant('outcome_at'),
    outcomeBy: userRef('outcome_by'),
    /** Admission created/advanced by the conversion (set with outcome `converted`). */
    convertedAdmissionId: uuid('converted_admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('demos_admission_idx').on(t.admissionId),
    index('demos_outcome_idx').on(t.outcome),
    index('demos_counsellor_idx').on(t.counsellorStaffId),
    uniqueIndex('demos_one_open_per_admission')
      .on(t.admissionId)
      .where(sql`${t.outcome} = 'open'`),
    check('demos_outcome_check', sql`${t.outcome} IN ${inList(OPS_DEMO_OUTCOMES)}`),
    check('demos_planned_sessions_check', sql`${t.plannedSessionCount} BETWEEN 1 AND 30`),
    check('demos_planned_days_check', sql`${t.plannedDayCount} BETWEEN 1 AND 10`),
    check('demos_outcome_recorded', sql`(${t.outcome} = 'open') = (${t.outcomeAt} IS NULL)`),
    check(
      'demos_outcome_reason',
      sql`${t.outcome} IN ('open', 'converted') OR length(trim(coalesce(${t.outcomeReason}, ''))) > 0`,
    ),
    check(
      'demos_converted_link',
      sql`(${t.outcome} = 'converted') = (${t.convertedAdmissionId} IS NOT NULL)`,
    ),
    check('demos_fee_positive', sql`${t.feeAmountPaise} IS NULL OR ${t.feeAmountPaise} >= 0`),
    check('demos_fee_status_check', sql`${t.feeStatus} IN ${inList(OPS_DEMO_FEE_STATUSES)}`),
  ],
);

export const OPS_DEMO_ATTENDANCE = [
  'scheduled',
  'present',
  'absent',
  'rescheduled',
  'cancelled',
  'not_recorded',
  'late',
  'excused',
] as const;
/** Attendance values that are a recorded fact (need recorder and time). */
const RECORDED_ATTENDANCE = ['present', 'absent', 'late', 'excused'] as const;
export const OPS_DEMO_MOCK_STATUSES = [
  'not_required',
  'pending',
  'prepared',
  'scheduled',
  'completed',
] as const;
export const OPS_DEMO_SESSION_FIELDS = ['attendance', 'schedule', 'mock', 'teacher'] as const;
export const OPS_CHECKLIST_SUBJECTS = ['demo', 'admission'] as const;
export const OPS_CHECKLIST_STATUSES = ['complete', 'pending', 'waived', 'not_applicable'] as const;

/** One class of a demo, on one of its demo days. Instants are UTC; `timezone` is how they are shown. */
export const opsDemoSessions = ops.table(
  'demo_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDemoSessionId>(),
    demoId: uuid('demo_id')
      .notNull()
      .references(() => opsDemos.id, { onDelete: 'restrict' })
      .$type<OpsDemoId>(),
    /** Class number 1..N within the demo (unique across its days). */
    sessionNumber: integer('session_number').notNull(),
    /** Demo day 1..N it belongs to (several classes may share a day). */
    dayNumber: integer('day_number').notNull(),
    startsAt: instant('starts_at').notNull(),
    /** Null only for sessions migrated from the legacy day-only demo. */
    endsAt: instant('ends_at'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    programmeId: uuid('programme_id')
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    /** Subject of the class, e.g. Legal Reasoning. */
    subject: text('subject'),
    /** Teacher who taught the class (a sample teacher in sample data). */
    teacherStaffId: staffRefRestrict('teacher_staff_id'),
    /** The teacher was a substitute for the planned one. */
    isSubstitute: boolean('is_substitute').notNull().default(false),
    /** Academic OS class session it was held in (plain id, no FK across modules). */
    academicSessionRef: text('academic_session_ref'),
    /** Attendance (day rule: domain/demos.ts). */
    attendance: text('attendance').notNull().default('scheduled'),
    /** When attendance was last recorded. */
    recordedAt: instant('recorded_at'),
    /** User who recorded attendance. */
    recordedBy: userRef('recorded_by'),
    /** Topics covered or notes. */
    notes: text('notes'),
    /** Mock test stage for this class. */
    mockStatus: text('mock_status').notNull().default('not_required'),
    /** Reference to a real assessment attempt (Academic OS); plain id, no FK across modules. */
    mockAttemptRef: text('mock_attempt_ref'),
    /** Why the class was cancelled, rescheduled or not recorded. */
    exceptionReason: text('exception_reason'),
    /** When the teacher was notified in-app. */
    teacherNotifiedAt: instant('teacher_notified_at'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('demo_sessions_number_key').on(t.demoId, t.sessionNumber),
    index('demo_sessions_starts_idx').on(t.startsAt),
    index('demo_sessions_teacher_idx').on(t.teacherStaffId, t.startsAt),
    check('demo_sessions_number_check', sql`${t.sessionNumber} BETWEEN 1 AND 30`),
    check('demo_sessions_day_check', sql`${t.dayNumber} BETWEEN 1 AND 10`),
    check('demo_sessions_attendance_check', sql`${t.attendance} IN ${inList(OPS_DEMO_ATTENDANCE)}`),
    check('demo_sessions_mock_check', sql`${t.mockStatus} IN ${inList(OPS_DEMO_MOCK_STATUSES)}`),
    check(
      'demo_sessions_ends_after_start',
      sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
    check(
      'demo_sessions_recorded_has_actor',
      sql`${t.attendance} NOT IN ${inList(RECORDED_ATTENDANCE)} OR (${t.recordedAt} IS NOT NULL AND ${t.recordedBy} IS NOT NULL)`,
    ),
  ],
);

/** Append-only history of session changes (attendance corrections, reschedules, mock, teacher). */
export const opsDemoSessionChanges = ops.table(
  'demo_session_changes',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsDemoSessionChangeId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => opsDemoSessions.id, { onDelete: 'restrict' })
      .$type<OpsDemoSessionId>(),
    /** What changed: attendance, schedule, mock or teacher. */
    field: text('field').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    /** Why (required to change a recorded attendance). */
    reason: text('reason'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('demo_session_changes_session_idx').on(t.sessionId, t.at),
    check(
      'demo_session_changes_field_check',
      sql`${t.field} IN ${inList(OPS_DEMO_SESSION_FIELDS)}`,
    ),
  ],
);

/** Append-only checklist entries for a demo or an admission; the latest entry per item wins. */
export const opsChecklistEntries = ops.table(
  'checklist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsChecklistEntryId>(),
    /** Whether `subject_id` is a demo or an admission. */
    subjectType: text('subject_type').notNull(),
    /** Demo or admission id (which one is given by subject_type; no FK, one table for both). */
    subjectId: uuid('subject_id').notNull(),
    /** Checklist item, e.g. fee_structure_explained. */
    itemKey: text('item_key').notNull(),
    /** Complete, pending, waived (reason required) or not applicable. */
    status: text('status').notNull(),
    /** Why (required when waived). */
    reason: text('reason'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('checklist_entries_subject_idx').on(t.subjectType, t.subjectId, t.itemKey, t.at),
    check(
      'checklist_entries_subject_check',
      sql`${t.subjectType} IN ${inList(OPS_CHECKLIST_SUBJECTS)}`,
    ),
    check('checklist_entries_status_check', sql`${t.status} IN ${inList(OPS_CHECKLIST_STATUSES)}`),
    check('checklist_entries_item_format', sql`${t.itemKey} ~ '^[a-z][a-z0-9_]{1,59}$'`),
    check(
      'checklist_entries_waive_reason',
      sql`${t.status} <> 'waived' OR length(trim(coalesce(${t.reason}, ''))) > 0`,
    ),
  ],
);
