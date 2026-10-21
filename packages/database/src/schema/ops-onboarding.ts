/**
 * OWNER: Business Ops OS — admissions slice "onboarding checklist and materials" (owner brief
 * 21 Oct 2026 §8). Part of the `ops` Postgres schema, split across ops*.ts (D-029). Same rules
 * and naming as ops.ts (D-036).
 *
 * Rules:
 * - templates are versioned (`code` + `version`); a checklist copies the items of the template
 *   version it was built from, so a later template change never rewrites it;
 * - item status is append-only (`onboarding_item_events`, latest event per item wins);
 * - biometrics: status and an external reference only, never biometric data;
 * - materials are issue / return / replacement rows, never one "kit issued" flag.
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
import type { AdmissionId, Brand } from '@elevate/shared-types';
import { ops, opsAdmissions, OPS_STUDENT_STAGES } from './ops';
import { createdAt, inList, instant, isoDate, staffRef, userRef } from './ops-columns';

export type OpsOnboardingTemplateId = Brand<string, 'OpsOnboardingTemplateId'>;
export type OpsOnboardingItemId = Brand<string, 'OpsOnboardingItemId'>;
export type OpsMaterialIssueId = Brand<string, 'OpsMaterialIssueId'>;

export const OPS_ONBOARDING_ITEM_KINDS = ['check', 'biometric', 'material'] as const;
export const OPS_ONBOARDING_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;
export const OPS_ONBOARDING_TEMPLATE_STATUSES = ['draft', 'active', 'retired'] as const;
export const OPS_MATERIAL_ISSUE_KINDS = ['issue', 'return', 'replacement'] as const;

/** One item of a template version. `catalogueCode` names the material for kind `material`. */
export type OpsOnboardingTemplateItem = {
  key: string;
  label: string;
  kind: (typeof OPS_ONBOARDING_ITEM_KINDS)[number];
  catalogueCode?: string;
  dueDays?: number;
};

const admissionRef = () =>
  uuid('admission_id')
    .notNull()
    .references(() => opsAdmissions.id, { onDelete: 'restrict' })
    .$type<AdmissionId>();
const keyFormat = (c: unknown) => sql`${c} ~ '^[a-z][a-z0-9_]{1,59}$'`;

/** A versioned onboarding checklist template for programme codes and, optionally, a class/category. */
export const opsOnboardingTemplates = ops.table(
  'onboarding_templates',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsOnboardingTemplateId>(),
    /** Template code, e.g. class_12_clat. */
    code: text('code').notNull(),
    /** 1, 2, … per code; a change is a new version. */
    version: integer('version').notNull(),
    /** core.programmes codes it applies to, e.g. {CLASS_12,CLAT}. */
    programmeCodes: text('programme_codes').array().notNull(),
    /** Class/category it applies to (ops.leads.current_stage); null = any. */
    classCategory: text('class_category'),
    items: jsonb('items').$type<OpsOnboardingTemplateItem[]>().notNull(),
    /** Only `active` versions are used for new checklists. */
    status: text('status')
      .$type<(typeof OPS_ONBOARDING_TEMPLATE_STATUSES)[number]>()
      .notNull()
      .default('draft'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('onboarding_templates_code_version_key').on(t.code, t.version),
    check('onboarding_templates_code_format', keyFormat(t.code)),
    check('onboarding_templates_version_check', sql`${t.version} >= 1`),
    check('onboarding_templates_codes_check', sql`cardinality(${t.programmeCodes}) >= 1`),
    check(
      'onboarding_templates_category_check',
      sql`${t.classCategory} IS NULL OR ${t.classCategory} IN ${inList(OPS_STUDENT_STAGES)}`,
    ),
    check(
      'onboarding_templates_status_check',
      sql`${t.status} IN ${inList(OPS_ONBOARDING_TEMPLATE_STATUSES)}`,
    ),
  ],
);

/** One checklist item of an admission (copied from a template version, or added by hand). */
export const opsOnboardingItems = ops.table(
  'onboarding_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsOnboardingItemId>(),
    admissionId: admissionRef(),
    /** Template it was copied from; null when added by hand. */
    templateId: uuid('template_id')
      .references(() => opsOnboardingTemplates.id, { onDelete: 'restrict' })
      .$type<OpsOnboardingTemplateId>(),
    templateVersion: integer('template_version'),
    /** Item key, unique per admission, e.g. biometric_registration. */
    itemKey: text('item_key').notNull(),
    label: text('label').notNull(),
    /** Plain check, biometric registration (status + external reference only) or material. */
    kind: text('kind').$type<(typeof OPS_ONBOARDING_ITEM_KINDS)[number]>().notNull(),
    /** Staff member responsible. */
    ownerStaffId: staffRef('owner_staff_id'),
    /** IST due day. */
    dueDate: isoDate('due_date'),
    /** True when added by hand, not from the template. */
    addedExplicitly: boolean('added_explicitly').notNull().default(false),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('onboarding_items_admission_key').on(t.admissionId, t.itemKey),
    index('onboarding_items_owner_idx').on(t.ownerStaffId, t.dueDate),
    index('onboarding_items_template_idx').on(t.templateId),
    check('onboarding_items_key_format', keyFormat(t.itemKey)),
    check('onboarding_items_kind_check', sql`${t.kind} IN ${inList(OPS_ONBOARDING_ITEM_KINDS)}`),
    check(
      'onboarding_items_template_check',
      sql`(${t.templateId} IS NULL) = (${t.templateVersion} IS NULL) AND (${t.templateId} IS NULL) = ${t.addedExplicitly}`,
    ),
  ],
);

/** Append-only status history of an onboarding item; the latest row is the current status. */
export const opsOnboardingItemEvents = ops.table(
  'onboarding_item_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => opsOnboardingItems.id, { onDelete: 'restrict' })
      .$type<OpsOnboardingItemId>(),
    status: text('status').$type<(typeof OPS_ONBOARDING_STATUSES)[number]>().notNull(),
    /** Why (required when blocked). */
    note: text('note'),
    /** Evidence reference, e.g. a biometric system enrolment id or receipt number. */
    evidenceRef: text('evidence_ref'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('onboarding_item_events_item_idx').on(t.itemId, t.at),
    check(
      'onboarding_item_events_status_check',
      sql`${t.status} IN ${inList(OPS_ONBOARDING_STATUSES)}`,
    ),
    check(
      'onboarding_item_events_blocked_note',
      sql`${t.status} <> 'blocked' OR length(trim(coalesce(${t.note}, ''))) > 0`,
    ),
  ],
);

/** Books and materials issued, returned or replaced (several sets for multi-programme students). */
export const opsMaterialIssues = ops.table(
  'material_issues',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsMaterialIssueId>(),
    admissionId: admissionRef(),
    /** Onboarding item it fulfils, when any. */
    itemId: uuid('item_id')
      .references(() => opsOnboardingItems.id, { onDelete: 'restrict' })
      .$type<OpsOnboardingItemId>(),
    /** Material code from the template item, e.g. clat_legal_reasoning_book. */
    catalogueCode: text('catalogue_code').notNull(),
    title: text('title').notNull(),
    edition: text('edition'),
    quantity: integer('quantity').notNull(),
    /** Issue, return or replacement. */
    kind: text('kind').$type<(typeof OPS_MATERIAL_ISSUE_KINDS)[number]>().notNull(),
    /** IST day handed over or returned. */
    issuedOn: isoDate('issued_on').notNull(),
    note: text('note'),
    actorUserId: userRef('actor_user_id').notNull(),
    at: instant('at').notNull().defaultNow(),
  },
  (t) => [
    index('material_issues_admission_idx').on(t.admissionId, t.issuedOn),
    index('material_issues_item_idx').on(t.itemId),
    check('material_issues_code_format', keyFormat(t.catalogueCode)),
    check('material_issues_quantity_check', sql`${t.quantity} >= 1`),
    check('material_issues_kind_check', sql`${t.kind} IN ${inList(OPS_MATERIAL_ISSUE_KINDS)}`),
  ],
);
