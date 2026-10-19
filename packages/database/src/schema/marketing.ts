/**
 * OWNER: Marketing OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Tables of the `marketing` schema: social accounts, ideas, content items,
 * versions, placements, publishing records, marketing metrics, campaigns (D-010).
 * Entity documentation: apps/marketing-os/docs/DOMAIN_MODEL.md.
 *
 * Rules (D-005, D-009):
 * - Declare every table with `marketing.table(...)` so it lands in the `marketing` schema.
 * - Prefix every export with `marketing` (e.g. `marketingIdeas`) — export names must be
 *   unique across all four schema files because they are merged into one Drizzle schema.
 * - Primary keys: `uuid('id').primaryKey().defaultRandom()`. Human codes (CLAT-028) are
 *   separate unique columns.
 * - Foreign keys may point INTO `core` (import tables from './core'); never into
 *   `academic` or `ops` — store the other module's UUID and validate it via a contract.
 * - Only `import type` from workspace packages (drizzle-kit loads this file directly).
 * - Do not run `drizzle-kit generate`; tests build the schema with `createTestDb()`.
 *
 * The literal vocabularies below are mirrored in apps/marketing-os/src/domain/vocabulary.ts;
 * a unit test (tests/unit/vocabulary.test.ts) fails if they drift apart.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  ApprovalId,
  Brand,
  CampaignId,
  ContentItemId,
  IdeaId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';
import { approvals, staffMembers, users } from './core';

export const marketing = pgSchema('marketing');

// --- branded ids for marketing rows (IdeaId, ContentItemId, CampaignId live in shared-types) ---
export type MarketingSocialAccountId = Brand<string, 'MarketingSocialAccountId'>;
export type MarketingContentVersionId = Brand<string, 'MarketingContentVersionId'>;
export type MarketingContentAssetId = Brand<string, 'MarketingContentAssetId'>;
export type MarketingContentReviewId = Brand<string, 'MarketingContentReviewId'>;
export type MarketingContentCommentId = Brand<string, 'MarketingContentCommentId'>;
export type MarketingContentAssignmentId = Brand<string, 'MarketingContentAssignmentId'>;
export type MarketingPlacementId = Brand<string, 'MarketingPlacementId'>;
export type MarketingPlacementGroupId = Brand<string, 'MarketingPlacementGroupId'>;
export type MarketingPublishingRecordId = Brand<string, 'MarketingPublishingRecordId'>;
export type MarketingPublishingAttemptId = Brand<string, 'MarketingPublishingAttemptId'>;
export type MarketingMetricImportId = Brand<string, 'MarketingMetricImportId'>;
export type MarketingMetricSnapshotId = Brand<string, 'MarketingMetricSnapshotId'>;
export type MarketingContentRuleId = Brand<string, 'MarketingContentRuleId'>;
export type MarketingPolicySettingId = Brand<string, 'MarketingPolicySettingId'>;
export type MarketingLegacyConflictId = Brand<string, 'MarketingLegacyConflictId'>;

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** `col IN ('a', 'b')` for a literal list (values are compile-time constants, never user input). */
const inList = (values: readonly string[]) =>
  sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);

// --- vocabularies (mirrored in apps/marketing-os/src/domain/vocabulary.ts) ---------------
export const MARKETING_PLATFORMS = ['instagram', 'youtube', 'linkedin', 'other'] as const;
export const MARKETING_ACCOUNT_STATUSES = ['live', 'starting', 'later', 'retired'] as const;
export const MARKETING_ACCOUNT_SCOPES = ['exam', 'local', 'company', 'founder'] as const;
export const MARKETING_INTEGRATION_STATUSES = [
  'not_configured',
  'sandbox',
  'connected',
  'error',
] as const;
export const MARKETING_CADENCE_ENFORCEMENT = ['warn', 'block'] as const;
export const MARKETING_COURSE_PREFIXES = ['CLAT', 'IPMAT', 'CUET', 'COM', 'GEN'] as const;
export const MARKETING_IDEA_STATUSES = [
  'idea',
  'in_development',
  'ready',
  'held',
  'rejected',
  'archived',
] as const;
export const MARKETING_IDEA_SCOPES = [
  'single_exam',
  'cross_exam',
  'founder',
  'local_sikar',
  'general',
] as const;
export const MARKETING_QUARANTINE_STATES = ['none', 'quarantined', 'resolved'] as const;
export const MARKETING_CONTENT_FORMATS = [
  'script',
  'caption',
  'carousel',
  'video_brief',
  'image',
  'post',
] as const;
export const MARKETING_CONTENT_STATES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;
export const MARKETING_ASSIGNEE_ROLES = ['writer', 'designer', 'editor', 'presenter'] as const;
export const MARKETING_RIGHTS_STATES = [
  'own',
  'third_party_cleared',
  'third_party_pending',
] as const;
export const MARKETING_PLACEMENT_STATUSES = [
  'planned',
  'scheduled',
  'published',
  'cancelled',
] as const;
export const MARKETING_PLACEMENT_VARIANTS = ['short', 'long'] as const;
export const MARKETING_PUBLICATION_MODES = [
  'sandbox',
  'adapter',
  'manual',
  'legacy_reported',
] as const;
export const MARKETING_PUBLISHING_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const MARKETING_RULE_KINDS = [
  'banned_phrase',
  'channel_rule',
  'requires_approval',
  'consent',
] as const;
export const MARKETING_RULE_STATUSES = ['approved', 'documented', 'proposed', 'retired'] as const;
export const MARKETING_METRIC_KEYS = [
  'views',
  'reach',
  'impressions',
  'likes',
  'comments',
  'shares',
  'saves',
  'watch_hours',
  'ctr_pct',
] as const;
export const MARKETING_METRIC_STATES = [
  'reported',
  'estimated',
  'missing',
  'not_applicable',
] as const;
export const MARKETING_SNAPSHOT_SOURCES = ['csv_import', 'manual_audit', 'adapter'] as const;
export const MARKETING_MATCH_STATUSES = [
  'matched_link',
  'suggested_title_date',
  'unmatched',
  'historical',
] as const;
export const MARKETING_SETTING_STATUSES = ['proposed', 'approved'] as const;
export const MARKETING_CAMPAIGN_STATUSES = ['draft', 'active', 'ended', 'cancelled'] as const;

// --- configuration and owner decisions ------------------------------------------------------

/**
 * Configurable business policies. Unapproved owner decisions (OD-xxx) live here with
 * status `proposed` instead of being hard-coded as fact.
 */
export const marketingPolicySettings = marketing.table(
  'policy_settings',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingPolicySettingId>(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    status: text('status', { enum: MARKETING_SETTING_STATUSES }).notNull().default('proposed'),
    ownerDecision: text('owner_decision'),
    description: text('description').notNull(),
    source: text('source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('policy_settings_key_key').on(t.key),
    check(
      'policy_settings_status_check',
      sql`${t.status} IN ${inList(MARKETING_SETTING_STATUSES)}`,
    ),
  ],
);

/** Conflicts found in the legacy sources that need an owner decision (e.g. ACC-CONFLICT-001 / OD-001). */
export const marketingLegacyConflicts = marketing.table(
  'legacy_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingLegacyConflictId>(),
    code: text('code').notNull(),
    ownerDecision: text('owner_decision'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status', { enum: ['unreconciled', 'resolved'] })
      .notNull()
      .default('unreconciled'),
    details: jsonb('details'),
    provenance: jsonb('provenance'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('legacy_conflicts_code_key').on(t.code),
    check('legacy_conflicts_status_check', sql`${t.status} IN ('unreconciled', 'resolved')`),
  ],
);

// --- social accounts ------------------------------------------------------------------------

export const marketingSocialAccounts = marketing.table(
  'social_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingSocialAccountId>(),
    /** BR-MKT-1 code: IGC, YTC, LI, LIP … */
    code: text('code').notNull(),
    platform: text('platform', { enum: MARKETING_PLATFORMS }).notNull(),
    /** Null until confirmed (never invented); suggestions live in proposed_display_name. */
    displayName: text('display_name'),
    proposedDisplayName: text('proposed_display_name'),
    /** Null until confirmed live (never invented); suggestions live in proposed_handle. */
    handle: text('handle'),
    proposedHandle: text('proposed_handle'),
    handleStatus: text('handle_status').notNull().default('tbd'),
    scope: text('scope', { enum: MARKETING_ACCOUNT_SCOPES }).notNull(),
    /** Course prefixes this account serves (exam pages only), e.g. {CLAT} or {CUET,COM}. */
    examPrefixes: text('exam_prefixes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    audience: text('audience'),
    job: text('job'),
    status: text('status', { enum: MARKETING_ACCOUNT_STATUSES }).notNull(),
    legacyStatus: text('legacy_status'),
    ownerStaffId: uuid('owner_staff_id')
      .references(() => staffMembers.id, { onDelete: 'set null' })
      .$type<StaffMemberId>(),
    /** Cadence as written in the legacy source. */
    cadenceText: text('cadence_text'),
    cadenceMaxPerDay: integer('cadence_max_per_day'),
    cadenceMaxPerWeek: integer('cadence_max_per_week'),
    cadenceEnforcement: text('cadence_enforcement', { enum: MARKETING_CADENCE_ENFORCEMENT })
      .notNull()
      .default('warn'),
    cadenceStatus: text('cadence_status', { enum: MARKETING_SETTING_STATUSES })
      .notNull()
      .default('proposed'),
    contentRules: text('content_rules')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    publishingToolBrand: text('publishing_tool_brand'),
    integrationStatus: text('integration_status', { enum: MARKETING_INTEGRATION_STATUSES })
      .notNull()
      .default('not_configured'),
    integrationCheckedAt: timestamp('integration_checked_at', { withTimezone: true }),
    integrationNote: text('integration_note'),
    notes: text('notes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    provenance: jsonb('provenance'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('social_accounts_code_key').on(t.code),
    check('social_accounts_code_format', sql`${t.code} ~ '^[A-Z]{2,5}$'`),
    check('social_accounts_platform_check', sql`${t.platform} IN ${inList(MARKETING_PLATFORMS)}`),
    check(
      'social_accounts_status_check',
      sql`${t.status} IN ${inList(MARKETING_ACCOUNT_STATUSES)}`,
    ),
    check('social_accounts_scope_check', sql`${t.scope} IN ${inList(MARKETING_ACCOUNT_SCOPES)}`),
    check(
      'social_accounts_integration_check',
      sql`${t.integrationStatus} IN ${inList(MARKETING_INTEGRATION_STATUSES)}`,
    ),
    check(
      'social_accounts_cadence_positive',
      sql`(${t.cadenceMaxPerDay} IS NULL OR ${t.cadenceMaxPerDay} > 0) AND (${t.cadenceMaxPerWeek} IS NULL OR ${t.cadenceMaxPerWeek} > 0)`,
    ),
    check(
      'social_accounts_cadence_enforcement_check',
      sql`${t.cadenceEnforcement} IN ${inList(MARKETING_CADENCE_ENFORCEMENT)}`,
    ),
    check(
      'social_accounts_cadence_status_check',
      sql`${t.cadenceStatus} IN ${inList(MARKETING_SETTING_STATUSES)}`,
    ),
  ],
);

// --- brand / content rules (data, so they can be added or retired without a deploy) -----------

export const marketingContentRules = marketing.table(
  'content_rules',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentRuleId>(),
    /** CR-001, AP-003, CH-005, CO-001 … */
    code: text('code').notNull(),
    kind: text('kind', { enum: MARKETING_RULE_KINDS }).notNull(),
    description: text('description').notNull(),
    /** `{ type: 'regex'|'literal'|'schedule_limit', pattern?, flags?, field, ... }` or null (manual check). */
    matcher: jsonb('matcher'),
    manualCheck: boolean('manual_check').notNull(),
    /** block | flag_for_review | flag_if_no_match | null */
    actionOnMatch: text('action_on_match'),
    appliesTo: text('applies_to')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status', { enum: MARKETING_RULE_STATUSES }).notNull(),
    sourceText: text('source_text'),
    notes: text('notes'),
    provenance: jsonb('provenance'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('content_rules_code_key').on(t.code),
    check('content_rules_kind_check', sql`${t.kind} IN ${inList(MARKETING_RULE_KINDS)}`),
    check('content_rules_status_check', sql`${t.status} IN ${inList(MARKETING_RULE_STATUSES)}`),
  ],
);

// --- business-code counters (D-009: codes are never reused) -----------------------------------

/**
 * One row per code scope (an idea course prefix such as `CLAT`). `last_number` only
 * grows; allocation takes the row lock (INSERT … ON CONFLICT DO UPDATE), so concurrent
 * creators are serialised and a released or archived number is never handed out again.
 */
export const marketingCodeCounters = marketing.table(
  'code_counters',
  {
    scope: text('scope').primaryKey(),
    lastNumber: integer('last_number').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check('code_counters_non_negative', sql`${t.lastNumber} >= 0`)],
);

// --- campaigns ---------------------------------------------------------------------------------

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
  ],
);

// --- ideas -------------------------------------------------------------------------------------

export const marketingIdeas = marketing.table(
  'ideas',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<IdeaId>(),
    /** `<PREFIX>-<NNN>`; null only while a legacy row is quarantined (duplicate legacy ID, OD-003). */
    code: text('code'),
    coursePrefix: text('course_prefix', { enum: MARKETING_COURSE_PREFIXES }).notNull(),
    title: text('title').notNull(),
    /** Deterministic normalised title (domain/text.ts) used for exact-duplicate checks. */
    normalizedTitle: text('normalized_title').notNull(),
    pillar: text('pillar'),
    series: text('series'),
    objective: text('objective'),
    audience: text('audience'),
    brief: text('brief'),
    /** Where the idea came from (the legacy CSV column `source`). */
    origin: text('origin'),
    masterAsset: text('master_asset'),
    scope: text('scope', { enum: MARKETING_IDEA_SCOPES }).notNull(),
    scopePrefixes: text('scope_prefixes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status', { enum: MARKETING_IDEA_STATUSES }).notNull().default('idea'),
    statusReason: text('status_reason'),
    notes: text('notes'),
    // Legacy import / quarantine (MKT-034).
    legacyCode: text('legacy_code'),
    legacyStatus: text('legacy_status'),
    /** Natural key of an imported row, e.g. `content-os/tracker/ideas.csv#L49`. */
    legacyRef: text('legacy_ref'),
    quarantineState: text('quarantine_state', { enum: MARKETING_QUARANTINE_STATES })
      .notNull()
      .default('none'),
    quarantineReason: text('quarantine_reason'),
    /** Proposed renumbering for the second occurrence of a duplicate legacy ID — NOT applied. */
    proposedCode: text('proposed_code'),
    proposedCodeStatus: text('proposed_code_status'),
    provenance: jsonb('provenance'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ideas_code_key').on(t.code),
    uniqueIndex('ideas_legacy_ref_key').on(t.legacyRef),
    index('ideas_course_status_idx').on(t.coursePrefix, t.status),
    index('ideas_normalized_title_idx').on(t.normalizedTitle),
    // Exact normalised duplicates in one course are refused (concurrency-safe backstop for
    // the duplicate check; similar titles only warn).
    uniqueIndex('ideas_course_title_key').on(t.coursePrefix, t.normalizedTitle),
    check(
      'ideas_code_format',
      sql`${t.code} IS NULL OR ${t.code} ~ '^(CLAT|IPMAT|CUET|COM|GEN)-[0-9]{3,}$'`,
    ),
    check(
      'ideas_code_matches_prefix',
      sql`${t.code} IS NULL OR ${t.code} LIKE ${t.coursePrefix} || '-%'`,
    ),
    check(
      'ideas_course_prefix_check',
      sql`${t.coursePrefix} IN ${inList(MARKETING_COURSE_PREFIXES)}`,
    ),
    check('ideas_status_check', sql`${t.status} IN ${inList(MARKETING_IDEA_STATUSES)}`),
    check('ideas_scope_check', sql`${t.scope} IN ${inList(MARKETING_IDEA_SCOPES)}`),
    check(
      'ideas_quarantine_check',
      sql`${t.quarantineState} IN ${inList(MARKETING_QUARANTINE_STATES)}`,
    ),
    // A code may be missing only while the row is quarantined.
    check(
      'ideas_code_or_quarantine',
      sql`${t.code} IS NOT NULL OR ${t.quarantineState} = 'quarantined'`,
    ),
  ],
);

// --- content items, versions, assets, assignments, comments, reviews ------------------------------

export const marketingContentItems = marketing.table(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<ContentItemId>(),
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => marketingIdeas.id, { onDelete: 'restrict' })
      .$type<IdeaId>(),
    title: text('title').notNull(),
    format: text('format', { enum: MARKETING_CONTENT_FORMATS }).notNull(),
    state: text('state', { enum: MARKETING_CONTENT_STATES }).notNull().default('draft'),
    currentVersionId: uuid('current_version_id')
      .references((): AnyPgColumn => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    /** The version an approval decision covers; cleared when a new version is created. */
    approvedVersionId: uuid('approved_version_id')
      .references((): AnyPgColumn => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    approvalId: uuid('approval_id')
      .references(() => approvals.id, { onDelete: 'restrict' })
      .$type<ApprovalId>(),
    /** Hold flag (pauses work without changing state). */
    holdReason: text('hold_reason'),
    holdSince: timestamp('hold_since', { withTimezone: true }),
    archivedReason: text('archived_reason'),
    legacyStatus: text('legacy_status'),
    legacyFormat: text('legacy_format'),
    legacyRef: text('legacy_ref'),
    provenance: jsonb('provenance'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('content_items_idea_idx').on(t.ideaId),
    index('content_items_state_idx').on(t.state, t.updatedAt),
    uniqueIndex('content_items_legacy_ref_key').on(t.legacyRef),
    check('content_items_format_check', sql`${t.format} IN ${inList(MARKETING_CONTENT_FORMATS)}`),
    check('content_items_state_check', sql`${t.state} IN ${inList(MARKETING_CONTENT_STATES)}`),
    check(
      'content_items_approved_needs_approval',
      sql`${t.approvedVersionId} IS NULL OR ${t.approvalId} IS NOT NULL`,
    ),
  ],
);

/** Immutable: rows are inserted, never updated (an edit is a new version). */
export const marketingContentVersions = marketing.table(
  'content_versions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentVersionId>(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => marketingContentItems.id, { onDelete: 'restrict' })
      .$type<ContentItemId>(),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** SHA-256 of the canonical version content (title, body, assets, consent). */
    contentHash: text('content_hash').notNull(),
    showsStudents: boolean('shows_students').notNull().default(false),
    /** Reference to consent evidence (OD-008), e.g. a form number. Never personal data. */
    consentReference: text('consent_reference'),
    changeNote: text('change_note'),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('content_versions_item_number_key').on(t.contentItemId, t.versionNumber),
    check('content_versions_number_positive', sql`${t.versionNumber} >= 1`),
  ],
);

/** File metadata only — binary media is never stored (MKT scope). */
export const marketingContentAssets = marketing.table(
  'content_assets',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentAssetId>(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes'),
    externalUrl: text('external_url'),
    showsStudents: boolean('shows_students').notNull().default(false),
    rightsState: text('rights_state', { enum: MARKETING_RIGHTS_STATES }).notNull().default('own'),
    createdAt: createdAt(),
  },
  (t) => [
    index('content_assets_version_idx').on(t.versionId),
    check(
      'content_assets_rights_check',
      sql`${t.rightsState} IN ${inList(MARKETING_RIGHTS_STATES)}`,
    ),
    check('content_assets_size_non_negative', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
  ],
);

export const marketingContentAssignments = marketing.table(
  'content_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentAssignmentId>(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => marketingContentItems.id, { onDelete: 'cascade' })
      .$type<ContentItemId>(),
    role: text('role', { enum: MARKETING_ASSIGNEE_ROLES }).notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    staffMemberId: uuid('staff_member_id')
      .references(() => staffMembers.id, { onDelete: 'set null' })
      .$type<StaffMemberId>(),
    assignedBy: uuid('assigned_by')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('content_assignments_item_role_key').on(t.contentItemId, t.role),
    check('content_assignments_role_check', sql`${t.role} IN ${inList(MARKETING_ASSIGNEE_ROLES)}`),
    check(
      'content_assignments_has_assignee',
      sql`${t.userId} IS NOT NULL OR ${t.staffMemberId} IS NOT NULL`,
    ),
  ],
);

/** Append-only discussion on a content item. */
export const marketingContentComments = marketing.table(
  'content_comments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentCommentId>(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => marketingContentItems.id, { onDelete: 'restrict' })
      .$type<ContentItemId>(),
    versionId: uuid('version_id')
      .references(() => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('content_comments_item_idx').on(t.contentItemId, t.createdAt)],
);

/**
 * Binds one core approval request to the exact version (and hash) under review, with the
 * rule-check snapshot taken at submission and the approver's checklist acknowledgements.
 */
export const marketingContentReviews = marketing.table(
  'content_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingContentReviewId>(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => marketingContentItems.id, { onDelete: 'restrict' })
      .$type<ContentItemId>(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    versionHash: text('version_hash').notNull(),
    approvalId: uuid('approval_id')
      .notNull()
      .references(() => approvals.id, { onDelete: 'restrict' })
      .$type<ApprovalId>(),
    ruleCheck: jsonb('rule_check').notNull(),
    acknowledgedRuleCodes: text('acknowledged_rule_codes').array(),
    outcome: text('outcome', {
      enum: ['pending', 'approved', 'changes_requested', 'withdrawn', 'voided'],
    })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('content_reviews_approval_key').on(t.approvalId),
    index('content_reviews_item_idx').on(t.contentItemId),
    check(
      'content_reviews_outcome_check',
      sql`${t.outcome} IN ('pending', 'approved', 'changes_requested', 'withdrawn', 'voided')`,
    ),
  ],
);

// --- placements and collab groups -----------------------------------------------------------------

/** A collab (BR-MKT-4 / CH-006): one post shared across several accounts on one platform. */
export const marketingPlacementGroups = marketing.table(
  'placement_groups',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingPlacementGroupId>(),
    code: text('code').notNull(),
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => marketingIdeas.id, { onDelete: 'restrict' })
      .$type<IdeaId>(),
    kind: text('kind', { enum: ['collab'] })
      .notNull()
      .default('collab'),
    platform: text('platform', { enum: MARKETING_PLATFORMS }).notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('placement_groups_code_key').on(t.code),
    check('placement_groups_kind_check', sql`${t.kind} IN ('collab')`),
    check('placement_groups_platform_check', sql`${t.platform} IN ('instagram', 'youtube')`),
  ],
);

export const marketingPlacements = marketing.table(
  'placements',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingPlacementId>(),
    /** `<IDEA>-<ACCOUNT>[S|L]`, e.g. CLAT-028-IGC, CLAT-005-YTCL. Null only for ambiguous legacy rows. */
    code: text('code'),
    /** Null only for ambiguous legacy rows whose idea is quarantined (OD-003). */
    ideaId: uuid('idea_id')
      .references(() => marketingIdeas.id, { onDelete: 'restrict' })
      .$type<IdeaId>(),
    /** The master content item placed on the account (null only for ambiguous legacy rows). */
    contentItemId: uuid('content_item_id')
      .references(() => marketingContentItems.id, { onDelete: 'restrict' })
      .$type<ContentItemId>(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketingSocialAccounts.id, { onDelete: 'restrict' })
      .$type<MarketingSocialAccountId>(),
    variant: text('variant', { enum: MARKETING_PLACEMENT_VARIANTS }),
    placementGroupId: uuid('placement_group_id')
      .references(() => marketingPlacementGroups.id, { onDelete: 'set null' })
      .$type<MarketingPlacementGroupId>(),
    campaignId: uuid('campaign_id')
      .references(() => marketingCampaigns.id, { onDelete: 'set null' })
      .$type<CampaignId>(),
    status: text('status', { enum: MARKETING_PLACEMENT_STATUSES }).notNull().default('planned'),
    /** First scheduled time; never overwritten once set (MKT-008, preserve baselines). */
    originalPublishAt: timestamp('original_publish_at', { withTimezone: true }),
    /** Current scheduled time (a reschedule changes this, not the original). */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Live link; null for sandbox publications (the mock never claims a URL). */
    publishedUrl: text('published_url'),
    publicationMode: text('publication_mode', { enum: MARKETING_PUBLICATION_MODES }),
    cancelledReason: text('cancelled_reason'),
    // Legacy import (MKT-034).
    legacyCode: text('legacy_code'),
    legacyIdeaCode: text('legacy_idea_code'),
    legacyStatus: text('legacy_status'),
    legacyFormat: text('legacy_format'),
    legacyDateRaw: text('legacy_date_raw'),
    legacyDatePrecision: text('legacy_date_precision'),
    legacyLinkOrFile: text('legacy_link_or_file'),
    legacyResult24h: text('legacy_result_24h'),
    legacyNotes: text('legacy_notes'),
    legacyRef: text('legacy_ref'),
    ambiguous: boolean('ambiguous').notNull().default(false),
    ambiguityReason: text('ambiguity_reason'),
    provenance: jsonb('provenance'),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('placements_code_key').on(t.code),
    uniqueIndex('placements_legacy_ref_key').on(t.legacyRef),
    index('placements_account_schedule_idx').on(t.accountId, t.scheduledAt),
    index('placements_status_schedule_idx').on(t.status, t.scheduledAt),
    index('placements_content_item_idx').on(t.contentItemId),
    index('placements_published_url_idx').on(t.publishedUrl),
    check('placements_status_check', sql`${t.status} IN ${inList(MARKETING_PLACEMENT_STATUSES)}`),
    check(
      'placements_variant_check',
      sql`${t.variant} IS NULL OR ${t.variant} IN ${inList(MARKETING_PLACEMENT_VARIANTS)}`,
    ),
    check(
      'placements_publication_mode_check',
      sql`${t.publicationMode} IS NULL OR ${t.publicationMode} IN ${inList(MARKETING_PUBLICATION_MODES)}`,
    ),
    check(
      'placements_linked_unless_ambiguous',
      sql`${t.ambiguous} OR (${t.ideaId} IS NOT NULL AND ${t.contentItemId} IS NOT NULL AND ${t.code} IS NOT NULL)`,
    ),
    check(
      'placements_scheduled_has_time',
      sql`${t.status} <> 'scheduled' OR ${t.scheduledAt} IS NOT NULL`,
    ),
  ],
);

// --- publishing records -----------------------------------------------------------------------------

/**
 * One record per (placement, version) — the idempotency key — so the same approved version
 * can never be published twice. Retries reuse the record and add attempts.
 */
export const marketingPublishingRecords = marketing.table(
  'publishing_records',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingPublishingRecordId>(),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => marketingPlacements.id, { onDelete: 'restrict' })
      .$type<MarketingPlacementId>(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => marketingContentVersions.id, { onDelete: 'restrict' })
      .$type<MarketingContentVersionId>(),
    /** `placement:<placementId>:version:<versionId>` */
    idempotencyKey: text('idempotency_key').notNull(),
    adapter: text('adapter').notNull(),
    status: text('status', { enum: MARKETING_PUBLISHING_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    isSandbox: boolean('is_sandbox').notNull(),
    externalPostId: text('external_post_id'),
    /** Null for the mock adapter — it never claims a real post. */
    publishedUrl: text('published_url'),
    lastResponse: jsonb('last_response'),
    lastError: text('last_error'),
    requestedBy: uuid('requested_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publishing_records_idempotency_key').on(t.idempotencyKey),
    // At most one live (pending or succeeded) record per placement (MKT-026).
    uniqueIndex('publishing_records_one_active_per_placement')
      .on(t.placementId)
      .where(sql`${t.status} IN ('pending', 'succeeded')`),
    check(
      'publishing_records_status_check',
      sql`${t.status} IN ${inList(MARKETING_PUBLISHING_STATUSES)}`,
    ),
    check(
      'publishing_records_attempts_range',
      sql`${t.attempts} >= 0 AND ${t.maxAttempts} >= 1 AND ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      'publishing_records_sandbox_no_url',
      sql`NOT ${t.isSandbox} OR ${t.publishedUrl} IS NULL`,
    ),
  ],
);

/** Every adapter call, in order (append-only). */
export const marketingPublishingAttempts = marketing.table(
  'publishing_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingPublishingAttemptId>(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => marketingPublishingRecords.id, { onDelete: 'restrict' })
      .$type<MarketingPublishingRecordId>(),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: text('outcome', { enum: ['succeeded', 'failed'] }).notNull(),
    response: jsonb('response'),
    error: text('error'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    attemptedBy: uuid('attempted_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
  },
  (t) => [
    uniqueIndex('publishing_attempts_record_number_key').on(t.recordId, t.attemptNumber),
    check('publishing_attempts_outcome_check', sql`${t.outcome} IN ('succeeded', 'failed')`),
  ],
);

// --- metrics ---------------------------------------------------------------------------------------

export const marketingMetricImports = marketing.table(
  'metric_imports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingMetricImportId>(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketingSocialAccounts.id, { onDelete: 'restrict' })
      .$type<MarketingSocialAccountId>(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    format: text('format').notNull(),
    /** Declared by the importer, never guessed (fixes the legacy US-date defect). */
    dateFormat: text('date_format').notNull(),
    /** When the export was taken: lifetime numbers are "as of" this instant. */
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    rowsTotal: integer('rows_total').notNull(),
    rowsAccepted: integer('rows_accepted').notNull(),
    rowsRejected: integer('rows_rejected').notNull(),
    rowsSkipped: integer('rows_skipped').notNull().default(0),
    rejected: jsonb('rejected').notNull(),
    importedBy: uuid('imported_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('metric_imports_file_account_key').on(t.accountId, t.fileSha256),
    check(
      'metric_imports_counts',
      sql`${t.rowsTotal} >= 0 AND ${t.rowsAccepted} >= 0 AND ${t.rowsRejected} >= 0`,
    ),
  ],
);

/** One post's numbers as captured at one instant (lifetime-to-date unless window says otherwise). */
export const marketingMetricSnapshots = marketing.table(
  'metric_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MarketingMetricSnapshotId>(),
    importId: uuid('import_id')
      .references(() => marketingMetricImports.id, { onDelete: 'restrict' })
      .$type<MarketingMetricImportId>(),
    source: text('source', { enum: MARKETING_SNAPSHOT_SOURCES }).notNull(),
    sourceLabel: text('source_label').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketingSocialAccounts.id, { onDelete: 'restrict' })
      .$type<MarketingSocialAccountId>(),
    placementId: uuid('placement_id')
      .references(() => marketingPlacements.id, { onDelete: 'set null' })
      .$type<MarketingPlacementId>(),
    suggestedPlacementId: uuid('suggested_placement_id')
      .references(() => marketingPlacements.id, { onDelete: 'set null' })
      .$type<MarketingPlacementId>(),
    matchStatus: text('match_status', { enum: MARKETING_MATCH_STATUSES }).notNull(),
    /** link, or `title|YYYY-MM-DD` when there is no link (legacy key). */
    postKey: text('post_key').notNull(),
    postLink: text('post_link'),
    postTitle: text('post_title'),
    publishedOn: date('published_on'),
    platformFormat: text('platform_format'),
    formatEstimated: boolean('format_estimated').notNull().default(false),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    capturedPrecision: text('captured_precision', { enum: ['instant', 'date'] })
      .notNull()
      .default('instant'),
    window: text('window', { enum: ['lifetime_at_capture', '24h', '7d'] })
      .notNull()
      .default('lifetime_at_capture'),
    sourceRow: integer('source_row'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('metric_snapshots_capture_key').on(t.accountId, t.postKey, t.capturedAt, t.source),
    index('metric_snapshots_placement_idx').on(t.placementId),
    index('metric_snapshots_account_published_idx').on(t.accountId, t.publishedOn),
    check(
      'metric_snapshots_source_check',
      sql`${t.source} IN ${inList(MARKETING_SNAPSHOT_SOURCES)}`,
    ),
    check(
      'metric_snapshots_match_check',
      sql`${t.matchStatus} IN ${inList(MARKETING_MATCH_STATUSES)}`,
    ),
    check(
      'metric_snapshots_window_check',
      sql`${t.window} IN ('lifetime_at_capture', '24h', '7d')`,
    ),
  ],
);

/**
 * One metric of one snapshot. MISSING IS NOT ZERO: `value` is null exactly when the state is
 * `missing` or `not_applicable`; a reported 0 is stored as 0 with state `reported`.
 */
export const marketingMetricValues = marketing.table(
  'metric_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => marketingMetricSnapshots.id, { onDelete: 'cascade' })
      .$type<MarketingMetricSnapshotId>(),
    metric: text('metric', { enum: MARKETING_METRIC_KEYS }).notNull(),
    value: doublePrecision('value'),
    state: text('state', { enum: MARKETING_METRIC_STATES }).notNull(),
    /** Source column, or how an estimate was made. */
    basis: text('basis'),
  },
  (t) => [
    uniqueIndex('metric_values_snapshot_metric_key').on(t.snapshotId, t.metric),
    check('metric_values_metric_check', sql`${t.metric} IN ${inList(MARKETING_METRIC_KEYS)}`),
    check('metric_values_state_check', sql`${t.state} IN ${inList(MARKETING_METRIC_STATES)}`),
    check(
      'metric_values_value_matches_state',
      sql`(${t.state} IN ('reported', 'estimated') AND ${t.value} IS NOT NULL AND ${t.value} >= 0)
        OR (${t.state} IN ('missing', 'not_applicable') AND ${t.value} IS NULL)`,
    ),
  ],
);
