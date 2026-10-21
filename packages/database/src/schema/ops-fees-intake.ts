/**
 * OWNER: Business Ops OS — admissions slice "fee structure, fee ledger, fee plans/instalments, Marketing lead
 * handoff" (owner brief 20 Oct 2026). Part of the `ops` Postgres schema, split across ops*.ts
 * (D-029). Same rules as ops.ts: `ops.table(...)`, exports prefixed `ops`, UUID PKs, FKs only
 * within ops or into core, only `import type` from workspace packages; naming conventions in
 * ops.ts (D-036).
 *
 * The fee LEDGER is `ops.fee_records`, with `discount` / `waiver` kinds and `plan_id` /
 * `instalment_id` references (FKs since 0007; the service checks both belong together).
 * Rules: apps/business-ops-os/src/domain/fee-plans.ts and

 * docs/parts/admissions-fees-intake.md.
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AdmissionId,
  ApprovalId,
  Brand,
  IntegrationEventId,
  LeadId,
} from '@elevate/shared-types';
import { approvals, integrationEvents } from './core';
import { ops, opsAdmissions, opsLeads } from './ops';
import { createdAt, inList, instant, isoDate, studentRef, updatedAt, userRef } from './ops-columns';
import { opsDemos, type OpsDemoId } from './ops-demos';

export type OpsFeeRecordId = Brand<string, 'OpsFeeRecordId'>;
export type OpsFeePlanId = Brand<string, 'OpsFeePlanId'>;
export type OpsFeeInstalmentId = Brand<string, 'OpsFeeInstalmentId'>;
export type OpsLeadHandoffReceiptId = Brand<string, 'OpsLeadHandoffReceiptId'>;

// Admissions administration (OPS-070…, D-028)
/** `received` is the payment kind; `discount` / `waiver` are separate ledger rows (fee plans, owner brief 20 Oct 2026). */
export const OPS_FEE_RECORD_KINDS = [
  'due',
  'received',
  'refund',
  'adjustment',
  'discount',
  'waiver',
] as const;
export const OPS_FEE_RECORD_STATUSES = ['recorded', 'verified', 'voided'] as const;
/** What a ledger row is for: annual tuition (the 50/25/25 split), registration, or the demo (D-039). */
export const OPS_FEE_CHARGE_CATEGORIES = ['tuition', 'registration', 'demo'] as const;
export const OPS_FEE_METHODS = [
  'cash',
  'upi',
  'bank_transfer',
  'cheque',
  'card_terminal',
  'other',
] as const;
export const OPS_FEE_PLAN_STATUSES = ['draft', 'active', 'closed'] as const;
export const OPS_LEAD_HANDOFF_STATUSES = [
  'received',
  'duplicate_review',
  'accepted',
  'failed',
] as const;

/**
 * Manually recorded administrative fee records per admission (OPS-072). NOT a
 * payment system: no gateway, no card data, never a verified transaction. The
 * accounts system stays the record (OD-013); these rows are what an authorised
 * staff member typed in, optionally checked by a second, different person.
 * Amounts are integer paise in INR (no floats). Rows are never deleted: a
 * mistake is voided with a reason. Summary rules: domain/fees.ts.
 */
export const opsFeeRecords = ops.table(
  'fee_records',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsFeeRecordId>(),
    /** FEE-000001 (never reused). */
    code: text('code').notNull(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** Ledger entry type: what is due, money received, a refund, a discount, a waiver or an adjustment. */
    kind: text('kind').$type<(typeof OPS_FEE_RECORD_KINDS)[number]>().notNull(),
    /** Tuition, registration or demo charge (separate balances; only tuition is split into instalments). */
    chargeCategory: text('charge_category')
      .$type<(typeof OPS_FEE_CHARGE_CATEGORIES)[number]>()
      .notNull()
      .default('tuition'),
    /** The ledger row this one reverses or refunds (linked entry; nothing is deleted). */
    reversesRecordId: uuid('reverses_record_id')
      .references((): AnyPgColumn => opsFeeRecords.id, { onDelete: 'restrict' })
      .$type<OpsFeeRecordId>(),
    /** For `adjustment`: `credit` lowers the balance due (e.g. demo fee adjusted), `debit` raises it. */
    direction: text('direction').$type<'credit' | 'debit'>(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    /** Free-text reference to the fee schedule used (no fee schedule is approved in Elevate OS). */
    pricingReference: text('pricing_reference'),
    /** Receipt or transaction reference in the accounts system / bank statement. */
    receiptReference: text('receipt_reference'),
    /** How the money moved (received / refund). */
    method: text('method'),
    /** Asia/Kolkata date the money moved (received/refund) or the date it is due (due). */
    paymentDate: isoDate('payment_date'),
    dueDate: isoDate('due_date'),
    /** Demo whose fee this adjustment carries over (demo terms: adjusted against fees). */
    demoId: uuid('demo_id')
      .references(() => opsDemos.id, { onDelete: 'restrict' })
      .$type<OpsDemoId>(),
    /** Fee plan this ledger row belongs to (the service checks the instalment is in this plan). */
    planId: uuid('plan_id').references((): AnyPgColumn => opsFeePlans.id, { onDelete: 'restrict' }),
    /** Instalment it is applied to, when one was named. */
    instalmentId: uuid('instalment_id').references((): AnyPgColumn => opsFeeInstalments.id, {
      onDelete: 'restrict',
    }),
    /** `recorded` by one person, `verified` by a different person, or `voided` with a reason. */
    status: text('status')
      .$type<(typeof OPS_FEE_RECORD_STATUSES)[number]>()
      .notNull()
      .default('recorded'),
    notes: text('notes'),
    recordedBy: userRef('recorded_by').notNull(),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
    verifiedBy: userRef('verified_by'),
    verifiedAt: instant('verified_at'),
    /** Note from the second person who verified it. */
    verificationNote: text('verification_note'),
    voidedBy: userRef('voided_by'),
    voidedAt: instant('voided_at'),
    /** Why the record was voided (required). */
    voidReason: text('void_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fee_records_code_key').on(t.code),
    index('fee_records_admission_idx').on(t.admissionId, t.recordedAt),
    index('fee_records_status_idx').on(t.status),
    index('fee_records_plan_idx').on(t.planId),
    index('fee_records_instalment_idx').on(t.instalmentId),
    index('fee_records_reverses_idx').on(t.reversesRecordId),
    check(
      'fee_records_category_check',
      sql`${t.chargeCategory} IN ${inList(OPS_FEE_CHARGE_CATEGORIES)}`,
    ),
    check('fee_records_demo_link', sql`${t.chargeCategory} <> 'demo' OR ${t.demoId} IS NOT NULL`),
    check(
      'fee_records_not_self_reversal',
      sql`${t.reversesRecordId} IS NULL OR ${t.reversesRecordId} <> ${t.id}`,
    ),
    check('fee_records_code_format', sql`${t.code} ~ '^FEE-[0-9]{6}$'`),
    check('fee_records_kind_check', sql`${t.kind} IN ${inList(OPS_FEE_RECORD_KINDS)}`),
    check('fee_records_status_check', sql`${t.status} IN ${inList(OPS_FEE_RECORD_STATUSES)}`),
    check(
      'fee_records_method_check',
      sql`${t.method} IS NULL OR ${t.method} IN ${inList(OPS_FEE_METHODS)}`,
    ),
    check('fee_records_amount_positive', sql`${t.amountPaise} > 0`),
    check('fee_records_currency_inr', sql`${t.currency} = 'INR'`),
    check(
      'fee_records_direction_check',
      sql`(${t.kind} = 'adjustment') = (${t.direction} IS NOT NULL) AND (${t.direction} IS NULL OR ${t.direction} IN ('credit', 'debit'))`,
    ),
    check(
      'fee_records_verified_check',
      sql`(${t.status} <> 'verified' OR (${t.verifiedBy} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL)) AND (${t.verifiedBy} IS NULL OR ${t.verifiedBy} <> ${t.recordedBy})`,
    ),
    check(
      'fee_records_voided_check',
      sql`${t.status} <> 'voided' OR (${t.voidedBy} IS NOT NULL AND ${t.voidReason} IS NOT NULL)`,
    ),
  ],
);

/**
 * A student's annual fee agreement for one admission and academic year: the agreed tuition
 * (integer paise, INR) and an instalment schedule. `draft` until the admission's fee-arrangement
 * approval (core approvals, no self-approval) is `approved`; activation copies that approval's
 * decider and time. At most one non-closed plan per admission. Never deleted: a changed
 * agreement is a new version that `supersedes_plan_id` the old one (closed), with a reason.
 */
export const opsFeePlans = ops.table(
  'fee_plans',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsFeePlanId>(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    studentId: studentRef().notNull(),
    /** Plan name, e.g. "Class 12 Commerce + CLAT, three instalments". */
    label: text('label').notNull(),
    /** Free-text reference to the approved pricing (no fee schedule is approved, OD-013). */
    pricingReference: text('pricing_reference'),
    /** Agreed total in integer paise (= sum of the instalments). */
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    /** `draft` until the fee arrangement is approved, then `active`; `closed` with a reason. */
    status: text('status').notNull().default('draft'),
    /** The fee-arrangement approval (core.approvals) that allowed activation. */
    approvalId: uuid('approval_id')
      .references(() => approvals.id, { onDelete: 'restrict' })
      .$type<ApprovalId>(),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    closedBy: userRef('closed_by'),
    closedAt: instant('closed_at'),
    /** Why the plan was closed. */
    closeReason: text('close_reason'),
    /** Academic year of the agreement, e.g. 2026-27. */
    academicYear: text('academic_year'),
    /** 1 for the first agreement; +1 for each adjustment. */
    version: integer('version').notNull().default(1),
    /** The earlier version this one replaces. */
    supersedesPlanId: uuid('supersedes_plan_id')
      .references((): AnyPgColumn => opsFeePlans.id, { onDelete: 'restrict' })
      .$type<OpsFeePlanId>(),
    /** Why the accepted agreement was changed (required from version 2). */
    adjustmentReason: text('adjustment_reason'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('fee_plans_student_idx').on(t.studentId),
    uniqueIndex('fee_plans_one_open_per_admission')
      .on(t.admissionId)
      .where(sql`${t.status} <> 'closed'`),
    check('fee_plans_status_check', sql`${t.status} IN ${inList(OPS_FEE_PLAN_STATUSES)}`),
    uniqueIndex('fee_plans_supersedes_key')
      .on(t.supersedesPlanId)
      .where(sql`${t.supersedesPlanId} IS NOT NULL`),
    check(
      'fee_plans_version_check',
      sql`${t.version} >= 1 AND (${t.version} = 1) = (${t.supersedesPlanId} IS NULL) AND (${t.version} = 1 OR length(trim(coalesce(${t.adjustmentReason}, ''))) > 0)`,
    ),
    check(
      'fee_plans_year_format',
      sql`${t.academicYear} IS NULL OR ${t.academicYear} ~ '^[0-9]{4}-[0-9]{2}$'`,
    ),

    check('fee_plans_total_positive', sql`${t.totalPaise} > 0`),
    check('fee_plans_currency_inr', sql`${t.currency} = 'INR'`),
    check(
      'fee_plans_approved_check',
      sql`${t.status} <> 'active' OR (${t.approvalId} IS NOT NULL AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
    check(
      'fee_plans_closed_check',
      sql`${t.status} <> 'closed' OR (${t.closedBy} IS NOT NULL AND ${t.closeReason} IS NOT NULL)`,
    ),
  ],
);

/** Instalments of a plan: sequence 1..n, an IST due date and an amount (sum = plan total). */
export const opsFeeInstalments = ops.table(
  'fee_instalments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsFeeInstalmentId>(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => opsFeePlans.id, { onDelete: 'restrict' })
      .$type<OpsFeePlanId>(),
    /** Instalment number 1..n. */
    sequence: integer('sequence').notNull(),
    /** Due day (IST). */
    dueDate: isoDate('due_date').notNull(),
    /** Amount due in integer paise. */
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('fee_instalments_plan_sequence_key').on(t.planId, t.sequence),
    check('fee_instalments_sequence_positive', sql`${t.sequence} >= 1`),
    check('fee_instalments_amount_positive', sql`${t.amountPaise} > 0`),
  ],
);

export const OPS_FEE_STRUCTURE_MODES = ['online', 'offline_sikar', 'both'] as const;
export const OPS_FEE_STRUCTURE_SOURCES = ['sample', 'website_stated', 'owner_approved'] as const;
export const OPS_FEE_STRUCTURE_STATUSES = ['draft', 'approved'] as const;
export const OPS_FEE_BILLING_PERIODS = ['course_total', 'per_month'] as const;
export type OpsFeeStructureId = Brand<string, 'OpsFeeStructureId'>;

/**
 * The fee structure: one row per programme combination and mode (owner, 21 Oct 2026: "give me the
 * total fee structure"). No real fee is approved yet (OD-013): rows are `sample` (development
 * figures, `is_sample`, removed by db:clear-samples), `website_stated` (a price quoted on
 * elevateeducation.in, kept as a draft) or `owner_approved` (only that source can be `approved`).
 * Codes are core.programmes codes in catalog order. Edited through PATCH /fee-structures/{id}.
 */
export const opsFeeStructures = ops.table(
  'fee_structures',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsFeeStructureId>(),
    /** core.programmes codes of the combination, e.g. {CLASS_12,CLAT}. */
    programmeCodes: text('programme_codes').array().notNull(),
    label: text('label').notNull(),
    /** Online, offline at the Sikar centre, or both. */
    mode: text('mode').$type<(typeof OPS_FEE_STRUCTURE_MODES)[number]>().notNull(),
    /** Integer paise, INR; per `billing_period`. */
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    /** Whole course total, or per month (as the website states its prices). */
    billingPeriod: text('billing_period')
      .$type<(typeof OPS_FEE_BILLING_PERIODS)[number]>()
      .notNull()
      .default('course_total'),
    /** Instalment template: how many instalments, and when (free text). */
    instalmentCount: integer('instalment_count'),
    instalmentNote: text('instalment_note'),
    billingNote: text('billing_note'),
    /** Where the figure comes from: sample, the public website, or the owner. */
    source: text('source').$type<(typeof OPS_FEE_STRUCTURE_SOURCES)[number]>().notNull(),
    /** Evidence for the figure (page and date for website prices). */
    sourceNote: text('source_note'),
    /** Only an owner-approved figure can be `approved`. */
    status: text('status')
      .$type<(typeof OPS_FEE_STRUCTURE_STATUSES)[number]>()
      .notNull()
      .default('draft'),
    isSample: boolean('is_sample').notNull().default(false),
    updatedBy: userRef('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fee_structures_combination_mode_key').on(t.programmeCodes, t.mode),
    check('fee_structures_codes_check', sql`cardinality(${t.programmeCodes}) BETWEEN 1 AND 3`),
    check('fee_structures_mode_check', sql`${t.mode} IN ${inList(OPS_FEE_STRUCTURE_MODES)}`),
    check(
      'fee_structures_period_check',
      sql`${t.billingPeriod} IN ${inList(OPS_FEE_BILLING_PERIODS)}`,
    ),
    check('fee_structures_source_check', sql`${t.source} IN ${inList(OPS_FEE_STRUCTURE_SOURCES)}`),
    check('fee_structures_status_check', sql`${t.status} IN ${inList(OPS_FEE_STRUCTURE_STATUSES)}`),
    check('fee_structures_amount_positive', sql`${t.amountPaise} > 0`),
    check(
      'fee_structures_instalments_check',
      sql`${t.instalmentCount} IS NULL OR ${t.instalmentCount} BETWEEN 1 AND 24`,
    ),
    check('fee_structures_sample_check', sql`${t.isSample} = (${t.source} = 'sample')`),
    check(
      'fee_structures_approved_check',
      sql`${t.status} <> 'approved' OR ${t.source} = 'owner_approved'`,
    ),
  ],
);

/**
 * One receipt per Marketing lead handed off (`marketing.lead.handed_off` v1, consumer
 * `ops.lead-intake`). The unique Marketing lead id makes the intake idempotent: a second
 * event for the same lead never creates a second Ops lead. Failed processing is kept
 * here (last error, attempts) and retried by the `lead-intake` job or by hand.
 */
export const opsLeadHandoffReceipts = ops.table(
  'lead_handoff_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeadHandoffReceiptId>(),
    /** Marketing's stable lead id (plain UUID: another module, no FK). */
    marketingLeadId: uuid('marketing_lead_id').notNull(),
    /** The event whose payload was (or will be) processed. */
    eventId: uuid('event_id')
      .notNull()
      .references(() => integrationEvents.id, { onDelete: 'restrict' })
      .$type<IntegrationEventId>(),
    /** Received, accepted, sent to duplicate review, or failed (retried). */
    status: text('status').notNull().default('received'),
    /** How many times processing was tried. */
    attempts: integer('attempts').notNull().default(0),
    /** Later events for a lead already handed off (ignored, counted). */
    duplicateDeliveries: integer('duplicate_deliveries').notNull().default(0),
    /** Last processing error, if any. */
    lastError: text('last_error'),
    /** Ops lead created or matched for it. */
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    receivedAt: instant('received_at').notNull().defaultNow(),
    processedAt: instant('processed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lead_handoff_receipts_marketing_lead_key').on(t.marketingLeadId),
    index('lead_handoff_receipts_status_idx').on(t.status),
    check(
      'lead_handoff_receipts_status_check',
      sql`${t.status} IN ${inList(OPS_LEAD_HANDOFF_STATUSES)}`,
    ),
    check(
      'lead_handoff_receipts_lead_check',
      sql`${t.status} NOT IN ('accepted', 'duplicate_review') OR ${t.leadId} IS NOT NULL`,
    ),
  ],
);
