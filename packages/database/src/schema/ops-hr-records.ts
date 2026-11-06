/**
 * OWNER: Business Ops OS — HR office records (wave 4, 6 Nov 2026): staff joining / leaving
 * checklists (F4-09), the staff asset register (F4-09) and approval cover while away (F4-10).
 * Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts. Checklists copy
 * the items of the template version they were built from, like student onboarding.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  filled,
  inList,
  instant,
  isoDate,
  keyFormat,
  ops,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';
import { OPS_ONBOARDING_TEMPLATE_STATUSES, type OpsOnboardingTemplateItem } from './ops-onboarding';

export const OPS_STAFF_CHECKLIST_EVENTS = ['joining', 'leaving'] as const;
export const OPS_STAFF_CHECKLIST_ITEM_STATUSES = ['pending', 'done', 'not_applicable'] as const;

/** A versioned joining or leaving checklist template; one `active` version per event. */
export const opsStaffChecklistTemplates = ops.table(
  'staff_checklist_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    event: text('event', { enum: OPS_STAFF_CHECKLIST_EVENTS }).notNull(),
    version: integer('version').notNull(),
    items: jsonb('items').$type<Pick<OpsOnboardingTemplateItem, 'key' | 'label'>[]>().notNull(),
    status: text('status', { enum: OPS_ONBOARDING_TEMPLATE_STATUSES }).notNull().default('draft'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_checklist_templates_version_key').on(t.event, t.version),
    uniqueIndex('staff_checklist_templates_one_active_key')
      .on(t.event)
      .where(sql`${t.status} = 'active'`),
    check(
      'staff_checklist_templates_event_check',
      sql`${t.event} IN ${inList(OPS_STAFF_CHECKLIST_EVENTS)}`,
    ),
    check('staff_checklist_templates_version_check', sql`${t.version} >= 1`),
    check('staff_checklist_templates_items_check', sql`jsonb_typeof(${t.items}) = 'array'`),
    check(
      'staff_checklist_templates_status_check',
      sql`${t.status} IN ${inList(OPS_ONBOARDING_TEMPLATE_STATUSES)}`,
    ),
  ],
);

/** One staff member's joining or leaving checklist (one per staff per event). */
export const opsStaffChecklists = ops.table(
  'staff_checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    event: text('event', { enum: OPS_STAFF_CHECKLIST_EVENTS }).notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => opsStaffChecklistTemplates.id, { onDelete: 'restrict' }),
    createdBy: userRef('created_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_checklists_staff_event_key').on(t.staffId, t.event),
    index('staff_checklists_template_idx').on(t.templateId),
    check('staff_checklists_event_check', sql`${t.event} IN ${inList(OPS_STAFF_CHECKLIST_EVENTS)}`),
  ],
);

/** An item of a staff checklist (copied from the template); done / not applicable carry who and when. */
export const opsStaffChecklistItems = ops.table(
  'staff_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => opsStaffChecklists.id, { onDelete: 'restrict' }),
    itemKey: text('item_key').notNull(),
    label: text('label').notNull(),
    status: text('status', { enum: OPS_STAFF_CHECKLIST_ITEM_STATUSES })
      .notNull()
      .default('pending'),
    doneBy: userRef('done_by'),
    doneAt: instant('done_at'),
    note: text('note'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('staff_checklist_items_key').on(t.checklistId, t.itemKey),
    check('staff_checklist_items_key_format', keyFormat(t.itemKey)),
    check('staff_checklist_items_label_check', filled(t.label)),
    check(
      'staff_checklist_items_status_check',
      sql`${t.status} IN ${inList(OPS_STAFF_CHECKLIST_ITEM_STATUSES)}`,
    ),
    check(
      'staff_checklist_items_done_check',
      sql`(${t.status} = 'pending') = (${t.doneAt} IS NULL) AND (${t.doneAt} IS NULL) = (${t.doneBy} IS NULL)`,
    ),
  ],
);

/**
 * Something the institute hands to a staff member (ID card, keys, laptop …): issued and, later,
 * returned with who and when. A tag / serial is out with at most one person at a time.
 */
export const opsStaffAssets = ops.table(
  'staff_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetType: text('asset_type').notNull(),
    /** Tag or serial number, when it has one. */
    tag: text('tag'),
    description: text('description'),
    staffId: staffRefRestrict('staff_id').notNull(),
    issuedOn: isoDate('issued_on').notNull(),
    issuedBy: userRef('issued_by').notNull(),
    returnedOn: isoDate('returned_on'),
    returnedBy: userRef('returned_by'),
    conditionNote: text('condition_note'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_assets_staff_idx').on(t.staffId, t.returnedOn),
    uniqueIndex('staff_assets_tag_out_key')
      .on(t.tag)
      .where(sql`${t.tag} IS NOT NULL AND ${t.returnedOn} IS NULL`),
    check(
      'staff_assets_text_check',
      sql`${filled(t.assetType)} AND (${t.tag} IS NULL OR ${filled(t.tag)})`,
    ),
    check(
      'staff_assets_returned_check',
      sql`(${t.returnedOn} IS NULL) = (${t.returnedBy} IS NULL) AND (${t.returnedOn} IS NULL OR ${t.returnedOn} >= ${t.issuedOn})`,
    ),
  ],
);

/**
 * Approval cover while away (F4-10): from `from_date` to `to_date` (IST days) `cover_user_id` may
 * see and decide what `approver_user_id` may approve, recorded "on behalf of" the approver
 * (`on_behalf_of` on the decision row). Revoked, never deleted. Overlaps are refused by the service.
 */
export const opsApprovalDelegations = ops.table(
  'approval_delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    approverUserId: userRef('approver_user_id').notNull(),
    coverUserId: userRef('cover_user_id').notNull(),
    fromDate: isoDate('from_date').notNull(),
    toDate: isoDate('to_date').notNull(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    revokedAt: instant('revoked_at'),
    revokedBy: userRef('revoked_by'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('approval_delegations_cover_idx').on(t.coverUserId, t.toDate),
    index('approval_delegations_approver_idx').on(t.approverUserId, t.toDate),
    check('approval_delegations_not_self', sql`${t.approverUserId} <> ${t.coverUserId}`),
    check('approval_delegations_dates_check', sql`${t.toDate} >= ${t.fromDate}`),
    check(
      'approval_delegations_revoked_check',
      sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`,
    ),
  ],
);
