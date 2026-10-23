/**
 * OWNER: Business Ops OS — requests staff send through HR (owner brief 23 Oct 2026 §6), the only
 * staff-to-staff channel. HR reviews, forwards, resolves or declines; the sender's original
 * subject and message never change after submit (service rule). HR's notes, what the recipient
 * is shown, the recipient's answer and what HR relays back are separate rows of
 * `hr_request_events`. Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, text, uuid } from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import {
  createdAt,
  filled,
  inList,
  instant,
  ops,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsStaffTasks, type OpsStaffTaskId } from './ops-tasks';

export type OpsHrRequestId = Brand<string, 'OpsHrRequestId'>;

/** draft → submitted → reviewed → forwarded | resolved | declined (forwarded ends resolved). */
export const OPS_HR_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'reviewed',
  'forwarded',
  'resolved',
  'declined',
] as const;
export const OPS_HR_REQUEST_URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;
/** What the request is about; `none` = nothing linked. Ids are other modules' UUIDs (no FK). */
export const OPS_HR_REQUEST_RELATED_KINDS = [
  'task',
  'batch',
  'campaign',
  'student',
  'test',
  'none',
] as const;
export const OPS_HR_REQUEST_EVENT_KINDS = [
  'submitted',
  'reviewed',
  'forwarded',
  'resolved',
  'declined',
  'recipient_responded',
  'response_relayed',
  'note',
  'task_created',
] as const;

/**
 * One request. The intended recipient is a staff member, or a configured recipient key (e.g.
 * `schar`, setting `hr.request_recipients`) that HR resolves when forwarding; neither = a
 * question for HR itself. An unresolved key keeps the request in HR's queue.
 */
export const opsHrRequests = ops.table(
  'hr_requests',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsHrRequestId>(),
    senderStaffId: staffRefRestrict('sender_staff_id').notNull(),
    recipientStaffId: staffRefRestrict('recipient_staff_id'),
    recipientKey: text('recipient_key'),
    category: text('category').notNull(),
    subject: text('subject').notNull(),
    /** The sender's words; fixed once submitted. */
    message: text('message').notNull(),
    relatedKind: text('related_kind', { enum: OPS_HR_REQUEST_RELATED_KINDS })
      .notNull()
      .default('none'),
    relatedId: uuid('related_id'),
    urgency: text('urgency', { enum: OPS_HR_REQUEST_URGENCIES }).notNull().default('normal'),
    status: text('status', { enum: OPS_HR_REQUEST_STATUSES }).notNull().default('draft'),
    submittedAt: instant('submitted_at'),
    /** When HR resolved or declined it. */
    decidedAt: instant('decided_at'),
    /** Task HR created from this request. */
    linkedTaskId: uuid('linked_task_id')
      .references(() => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    createdBy: userRef('created_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('hr_requests_queue_idx').on(t.status, t.submittedAt),
    index('hr_requests_sender_idx').on(t.senderStaffId, t.createdAt),
    index('hr_requests_recipient_idx')
      .on(t.recipientStaffId)
      .where(sql`${t.recipientStaffId} IS NOT NULL`),
    check('hr_requests_status_check', sql`${t.status} IN ${inList(OPS_HR_REQUEST_STATUSES)}`),
    check('hr_requests_urgency_check', sql`${t.urgency} IN ${inList(OPS_HR_REQUEST_URGENCIES)}`),
    check(
      'hr_requests_related_kind_check',
      sql`${t.relatedKind} IN ${inList(OPS_HR_REQUEST_RELATED_KINDS)}`,
    ),
    check('hr_requests_related_check', sql`(${t.relatedKind} = 'none') = (${t.relatedId} IS NULL)`),
    check(
      'hr_requests_recipient_check',
      sql`num_nonnulls(${t.recipientStaffId}, ${t.recipientKey}) <= 1 AND (${t.recipientKey} IS NULL OR ${t.recipientKey} ~ '^[a-z][a-z0-9_]{1,39}$')`,
    ),
    check(
      'hr_requests_text_check',
      sql`${t.status} = 'draft' OR (${filled(t.category)} AND ${filled(t.subject)} AND ${filled(t.message)})`,
    ),
    check('hr_requests_submitted_check', sql`(${t.status} = 'draft') = (${t.submittedAt} IS NULL)`),
    check(
      'hr_requests_decided_check',
      sql`(${t.status} IN ('resolved', 'declined')) = (${t.decidedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Append-only routing log. `body` is the event's message (what the recipient is shown when
 * forwarded, their answer, the answer relayed to the sender, the reason given to the sender);
 * `hr_note` is HR's own note and is never shown to sender or recipient. A recipient sees only
 * events with `visible_to_recipient`.
 */
export const opsHrRequestEvents = ops.table(
  'hr_request_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => opsHrRequests.id, { onDelete: 'restrict' })
      .$type<OpsHrRequestId>(),
    kind: text('kind', { enum: OPS_HR_REQUEST_EVENT_KINDS }).notNull(),
    actorUserId: userRef('actor_user_id').notNull(),
    hrNote: text('hr_note'),
    forwardedToStaffId: staffRefRestrict('forwarded_to_staff_id'),
    visibleToRecipient: boolean('visible_to_recipient').notNull().default(false),
    body: text('body'),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_request_events_request_idx').on(t.requestId, t.createdAt),
    index('hr_request_events_forwarded_idx')
      .on(t.forwardedToStaffId, t.createdAt)
      .where(sql`${t.forwardedToStaffId} IS NOT NULL`),
    check('hr_request_events_kind_check', sql`${t.kind} IN ${inList(OPS_HR_REQUEST_EVENT_KINDS)}`),
    check(
      'hr_request_events_forwarded_check',
      sql`(${t.kind} = 'forwarded') = (${t.forwardedToStaffId} IS NOT NULL)`,
    ),
    check(
      'hr_request_events_body_check',
      sql`${t.kind} NOT IN ('forwarded', 'declined', 'recipient_responded', 'response_relayed') OR ${filled(t.body)}`,
    ),
    check(
      'hr_request_events_note_check',
      sql`${t.kind} <> 'note' OR ${filled(t.hrNote)} OR ${filled(t.body)}`,
    ),
  ],
);
