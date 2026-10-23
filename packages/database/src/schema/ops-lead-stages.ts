/**
 * OWNER: Business Ops OS — configurable lead stages (owner brief 23 Oct 2026 §11). A stage is
 * found by its `key`, which never changes: renaming the label or deactivating a stage never
 * rewrites history, and reports read `lead_stage_history` by key. System stages (seeded) cannot
 * be removed. The admissions pipeline (ops.admissions.status) is separate and stays authoritative
 * for conversion. Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, text, uuid } from 'drizzle-orm/pg-core';
import type { LeadId } from '@elevate/shared-types';
import { createdAt, filled, inList, instant, ops, updatedAt, userRef } from './ops-columns';
// Cycle on purpose (ops.leads.stage_key → lead_stages.key): lazy FK callbacks only.
import { opsLeads } from './ops';

/** won = converted; parked = nurture / duplicate / do not contact; lost needs a reason. */
export const OPS_LEAD_STAGE_KINDS = ['open', 'won', 'lost', 'parked'] as const;
/** Seeded later as system stages, in this order. */
export const OPS_SYSTEM_LEAD_STAGES = [
  'new',
  'assigned',
  'contacted',
  'qualified',
  'demo_booked',
  'demo_attended',
  'admission_in_progress',
  'converted',
  'nurture',
  'lost',
  'duplicate',
  'do_not_contact',
] as const;

export const opsLeadStages = ops.table(
  'lead_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique constraint (not just an index) because leads and history reference it. */
    key: text('key').notNull().unique('lead_stages_key_key'),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    kind: text('kind', { enum: OPS_LEAD_STAGE_KINDS }).notNull().default('open'),
    /** Moving a lead into this stage needs a reason (e.g. lost). */
    requiresReason: boolean('requires_reason').notNull().default(false),
    /** Inactive stages stay on old leads and history but cannot be chosen. */
    active: boolean('active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('lead_stages_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('lead_stages_label_check', filled(t.label)),
    check('lead_stages_kind_check', sql`${t.kind} IN ${inList(OPS_LEAD_STAGE_KINDS)}`),
  ],
);

/** Every stage change of a lead, by key (append-only). */
export const opsLeadStageHistory = ops.table(
  'lead_stage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    /** Null for the first stage a lead is given. */
    fromKey: text('from_key').references(() => opsLeadStages.key, { onDelete: 'restrict' }),
    toKey: text('to_key')
      .notNull()
      .references(() => opsLeadStages.key, { onDelete: 'restrict' }),
    reason: text('reason'),
    actorUserId: userRef('actor_user_id').notNull(),
    changedAt: instant('changed_at').notNull().defaultNow(),
  },
  (t) => [
    index('lead_stage_history_lead_idx').on(t.leadId, t.changedAt),
    index('lead_stage_history_to_idx').on(t.toKey, t.changedAt),
    check('lead_stage_history_changed_check', sql`${t.fromKey} IS DISTINCT FROM ${t.toKey}`),
    check('lead_stage_history_reason_check', sql`${t.reason} IS NULL OR ${filled(t.reason)}`),
  ],
);
