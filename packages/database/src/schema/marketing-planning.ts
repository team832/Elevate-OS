/**
 * OWNER: Marketing OS team.
 *
 * Planning tables of the `marketing` schema (brief 23 Oct 2026 §12–§15): campaigns and who works
 * them, the marketing calendar, SEO/AIO/GEO work and marketing targets. Re-exported by
 * marketing.ts (`export *`), so it is NOT listed in SCHEMA_MODULES or drizzle.config.ts (a table
 * exported by two listed files would be generated twice). Top-level code here may use only
 * ./marketing-columns, ./marketing-vocabulary and ./core; tables of ./marketing only inside FK
 * callbacks (the two files import each other).
 *
 * Sample rows carry `is_sample` (D-036): the SAMPLE DATA badge and db:clear-samples use it.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  Brand,
  CampaignId,
  ContentItemId,
  IdeaId,
  ProgrammeId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';
import { programmes, staffMembers, users } from './core';
import { createdAt, inList, marketing, updatedAt } from './marketing-columns';
import {
  MARKETING_CALENDAR_ITEM_TYPES,
  MARKETING_CALENDAR_STATUSES,
  MARKETING_CAMPAIGN_MEMBER_ROLES,
  MARKETING_CAMPAIGN_STATUSES,
  MARKETING_CHANNELS,
  MARKETING_OBSERVATION_SOURCES,
  MARKETING_REVIEW_STATES,
  MARKETING_TARGET_METRIC_KEYS,
  MARKETING_TARGET_SCOPES,
} from './marketing-vocabulary';
import {
  marketingContentItems,
  marketingIdeas,
  marketingPlacements,
  type MarketingPlacementId,
} from './marketing';

export type MarketingCalendarItemId = Brand<string, 'MarketingCalendarItemId'>;
export type MarketingOptimisationItemId = Brand<string, 'MarketingOptimisationItemId'>;
export type MarketingTargetId = Brand<string, 'MarketingTargetId'>;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

const sample = () => boolean('is_sample').notNull().default(false);
const programmeRef = () =>
  uuid('programme_id')
    .references(() => programmes.id, { onDelete: 'restrict' })
    .$type<ProgrammeId>();
const ownerRef = () =>
  uuid('owner_staff_id')
    .references(() => staffMembers.id, { onDelete: 'set null' })
    .$type<StaffMemberId>();
const userRef = (name: string) =>
  uuid(name)
    .references(() => users.id, { onDelete: 'restrict' })
    .$type<UserId>();
const filled = (column: AnyPgColumn) => sql`length(trim(coalesce(${column}, ''))) > 0`;

export const marketingCampaigns = marketing.table(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<CampaignId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    objective: text('objective'),
    kind: text('kind', { enum: ['organic'] })
      .notNull()
      .default('organic'),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    status: text('status', { enum: MARKETING_CAMPAIGN_STATUSES }).notNull().default('draft'),
    // Brief §12/§16 (0016). The owner is the open campaign_members row with role 'owner'.
    /** Course (core.programmes); null = several or all courses. */
    programmeId: programmeRef(),
    audience: text('audience'),
    channels: text('channels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`)
      .$type<MarketingChannel[]>(),
    isSample: sample(),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('campaigns_code_key').on(t.code),
    check('campaigns_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'`),
    check('campaigns_status_check', sql`${t.status} IN ${inList(MARKETING_CAMPAIGN_STATUSES)}`),
    check('campaigns_kind_check', sql`${t.kind} IN ('organic')`),
    check(
      'campaigns_dates_order',
      sql`${t.startsOn} IS NULL OR ${t.endsOn} IS NULL OR ${t.startsOn} <= ${t.endsOn}`,
    ),
    check(
      'campaigns_channels_check',
      sql`${t.channels} <@ ${sql.raw(`ARRAY[${MARKETING_CHANNELS.map((v) => `'${v}'`).join(', ')}]::text[]`)}`,
    ),
  ],
);

/**
 * Who works a campaign, over time (brief 23 Oct 2026 §16): a marketing employee's "Assigned
 * campaigns". The open row (to_date null) is current; one open row per person and campaign.
 */
export const marketingCampaignMembers = marketing.table(
  'campaign_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => marketingCampaigns.id, { onDelete: 'restrict' })
      .$type<CampaignId>(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    role: text('role', { enum: MARKETING_CAMPAIGN_MEMBER_ROLES }).notNull().default('member'),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('campaign_members_active_key')
      .on(t.campaignId, t.staffId)
      .where(sql`${t.toDate} IS NULL`),
    index('campaign_members_staff_idx')
      .on(t.staffId)
      .where(sql`${t.toDate} IS NULL`),
    check(
      'campaign_members_role_check',
      sql`${t.role} IN ${inList(MARKETING_CAMPAIGN_MEMBER_ROLES)}`,
    ),
    check('campaign_members_dates_order', sql`${t.toDate} IS NULL OR ${t.toDate} >= ${t.fromDate}`),
  ],
);

/**
 * One entry of the marketing calendar (§12): any planned piece of work, not only social posts.
 * It LINKS to the history it builds on instead of copying it: `idea_id` (where it came from),
 * `content_item_id` (the reviewed copy and its versions/approvals) and `placement_id` (the social
 * post and its publishing records). `related_task_id` is the Ops task (ops.staff_tasks) — another
 * module, so a plain uuid. Approval and publication are separate actions with their own actor
 * and time. A reschedule changes `planned_at` (audited); `original_planned_at` never changes.
 */
export const marketingCalendarItems = marketing.table(
  'calendar_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingCalendarItemId>(),
    title: text('title').notNull(),
    itemType: text('item_type', { enum: MARKETING_CALENDAR_ITEM_TYPES }).notNull(),
    status: text('status', { enum: MARKETING_CALENDAR_STATUSES }).notNull().default('planned'),
    programmeId: programmeRef(),
    audience: text('audience'),
    channel: text('channel', { enum: MARKETING_CHANNELS }),
    campaignId: uuid('campaign_id')
      .references(() => marketingCampaigns.id, { onDelete: 'set null' })
      .$type<CampaignId>(),
    ownerStaffId: ownerRef(),
    plannedAt: timestamp('planned_at', { withTimezone: true }),
    originalPlannedAt: timestamp('original_planned_at', { withTimezone: true }),
    brief: text('brief'),
    assetLinks: text('asset_links')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    relatedTaskId: uuid('related_task_id'),
    ideaId: uuid('idea_id')
      .references(() => marketingIdeas.id, { onDelete: 'restrict' })
      .$type<IdeaId>(),
    contentItemId: uuid('content_item_id')
      .references(() => marketingContentItems.id, { onDelete: 'restrict' })
      .$type<ContentItemId>(),
    placementId: uuid('placement_id')
      .references(() => marketingPlacements.id, { onDelete: 'restrict' })
      .$type<MarketingPlacementId>(),
    /** Reviewer's reason when changes are requested. */
    reviewNote: text('review_note'),
    approvedBy: userRef('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedUrl: text('published_url'),
    /** What proves a manual publication when there is no URL or no publishing integration. */
    publicationEvidence: text('publication_evidence'),
    publishedBy: userRef('published_by'),
    cancelledReason: text('cancelled_reason'),
    isSample: sample(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('calendar_items_planned_idx').on(t.plannedAt),
    index('calendar_items_owner_planned_idx').on(t.ownerStaffId, t.plannedAt),
    index('calendar_items_campaign_idx').on(t.campaignId),
    index('calendar_items_content_item_idx').on(t.contentItemId),
    uniqueIndex('calendar_items_placement_key').on(t.placementId),
    check(
      'calendar_items_type_check',
      sql`${t.itemType} IN ${inList(MARKETING_CALENDAR_ITEM_TYPES)}`,
    ),
    check(
      'calendar_items_status_check',
      sql`${t.status} IN ${inList(MARKETING_CALENDAR_STATUSES)}`,
    ),
    check(
      'calendar_items_channel_check',
      sql`${t.channel} IS NULL OR ${t.channel} IN ${inList(MARKETING_CHANNELS)}`,
    ),
    check('calendar_items_title_check', filled(t.title)),
    check(
      'calendar_items_planned_check',
      sql`(${t.status} IN ('idea', 'cancelled') OR ${t.plannedAt} IS NOT NULL) AND (${t.plannedAt} IS NULL OR ${t.originalPlannedAt} IS NOT NULL)`,
    ),
    check(
      'calendar_items_approved_check',
      sql`(${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL) AND (${t.status} NOT IN ('approved', 'scheduled', 'published') OR ${t.approvedAt} IS NOT NULL)`,
    ),
    check(
      'calendar_items_published_check',
      sql`(${t.status} = 'published') = (${t.publishedAt} IS NOT NULL) AND (${t.publishedAt} IS NULL OR (${t.publishedBy} IS NOT NULL AND (${t.publishedUrl} IS NOT NULL OR ${filled(t.publicationEvidence)})))`,
    ),
    check(
      'calendar_items_url_check',
      sql`${t.publishedUrl} IS NULL OR ${t.publishedUrl} ~ '^https?://'`,
    ),
    check(
      'calendar_items_reason_check',
      sql`(${t.status} <> 'cancelled' OR ${filled(t.cancelledReason)}) AND (${t.status} <> 'changes_requested' OR ${filled(t.reviewNote)})`,
    ),
    check('calendar_items_assets_check', sql`cardinality(${t.assetLinks}) <= 20`),
  ],
);

/** Configurable SEO/AIO/GEO work categories (§14); `meaning` is shown in the UI. */
export const marketingOptimisationCategories = marketing.table(
  'optimisation_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique constraint (not an index) so optimisation_items can reference it. */
    key: text('key').notNull().unique('optimisation_categories_key_key'),
    label: text('label').notNull(),
    meaning: text('meaning').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('optimisation_categories_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,30}$'`),
    check('optimisation_categories_text_check', sql`${filled(t.label)} AND ${filled(t.meaning)}`),
  ],
);

/**
 * One concrete optimisation task on one page (§14). Tracks the work and its evidence, never a
 * claimed ranking: an item cannot be approved without evidence.
 */
export const marketingOptimisationItems = marketing.table(
  'optimisation_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingOptimisationItemId>(),
    pageUrl: text('page_url').notNull(),
    topic: text('topic').notNull(),
    targetQuery: text('target_query'),
    categoryKey: text('category_key')
      .notNull()
      .references(() => marketingOptimisationCategories.key, { onDelete: 'restrict' }),
    baselineObservation: text('baseline_observation'),
    requiredChange: text('required_change'),
    ownerStaffId: ownerRef(),
    dueOn: date('due_on', { mode: 'string' }),
    evidence: text('evidence'),
    reviewState: text('review_state', { enum: MARKETING_REVIEW_STATES }).notNull().default('draft'),
    reviewNote: text('review_note'),
    measurementSource: text('measurement_source'),
    observationOn: date('observation_on', { mode: 'string' }),
    /** `[{ key, label, done }]` — e.g. title and description, crawlability, internal links. */
    checklist: jsonb('checklist')
      .$type<{ key: string; label: string; done: boolean }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isSample: sample(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('optimisation_items_owner_due_idx').on(t.ownerStaffId, t.dueOn),
    index('optimisation_items_category_state_idx').on(t.categoryKey, t.reviewState),
    check(
      'optimisation_items_review_state_check',
      sql`${t.reviewState} IN ${inList(MARKETING_REVIEW_STATES)}`,
    ),
    check('optimisation_items_url_check', sql`${t.pageUrl} ~ '^https?://'`),
    check('optimisation_items_topic_check', filled(t.topic)),
    check('optimisation_items_checklist_check', sql`jsonb_typeof(${t.checklist}) = 'array'`),
    check(
      'optimisation_items_review_check',
      sql`(${t.reviewState} <> 'approved' OR ${filled(t.evidence)}) AND (${t.reviewState} <> 'changes_requested' OR ${filled(t.reviewNote)})`,
    ),
  ],
);

/** One dated observation (§14). Append-only; one observation is never "stable visibility". */
export const marketingOptimisationObservations = marketing.table(
  'optimisation_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => marketingOptimisationItems.id, { onDelete: 'restrict' })
      .$type<MarketingOptimisationItemId>(),
    /** Search engine or AI assistant, e.g. "Google", "ChatGPT". */
    platform: text('platform').notNull(),
    query: text('query').notNull(),
    observedOn: date('observed_on', { mode: 'string' }).notNull(),
    result: text('result').notNull(),
    source: text('source', { enum: MARKETING_OBSERVATION_SOURCES }).notNull().default('manual'),
    note: text('note'),
    recordedBy: userRef('recorded_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('optimisation_observations_item_idx').on(t.itemId, t.observedOn),
    check(
      'optimisation_observations_source_check',
      sql`${t.source} IN ${inList(MARKETING_OBSERVATION_SOURCES)}`,
    ),
    check(
      'optimisation_observations_text_check',
      sql`${filled(t.platform)} AND ${filled(t.query)} AND ${filled(t.result)}`,
    ),
  ],
);

/**
 * A target for one employee, the whole marketing team or one campaign over a period (§15).
 * Actuals are never stored: they are counted from source records (metric definitions live in
 * the marketing domain).
 */
export const marketingTargets = marketing.table(
  'targets',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingTargetId>(),
    scope: text('scope', { enum: MARKETING_TARGET_SCOPES }).notNull(),
    staffId: uuid('staff_id')
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    campaignId: uuid('campaign_id')
      .references(() => marketingCampaigns.id, { onDelete: 'restrict' })
      .$type<CampaignId>(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    metricKey: text('metric_key', { enum: MARKETING_TARGET_METRIC_KEYS }).notNull(),
    targetValue: integer('target_value').notNull(),
    note: text('note'),
    isSample: sample(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('targets_identity_key')
      .on(t.scope, t.staffId, t.campaignId, t.metricKey, t.periodStart, t.periodEnd)
      .nullsNotDistinct(),
    index('targets_period_idx').on(t.periodStart, t.periodEnd),
    check('targets_scope_check', sql`${t.scope} IN ${inList(MARKETING_TARGET_SCOPES)}`),
    check('targets_metric_check', sql`${t.metricKey} IN ${inList(MARKETING_TARGET_METRIC_KEYS)}`),
    check(
      'targets_scope_ids_check',
      sql`CASE ${t.scope} WHEN 'employee' THEN ${t.staffId} IS NOT NULL AND ${t.campaignId} IS NULL WHEN 'campaign' THEN ${t.campaignId} IS NOT NULL AND ${t.staffId} IS NULL ELSE ${t.staffId} IS NULL AND ${t.campaignId} IS NULL END`,
    ),
    check('targets_period_check', sql`${t.periodStart} <= ${t.periodEnd}`),
    check('targets_value_check', sql`${t.targetValue} > 0`),
  ],
);
