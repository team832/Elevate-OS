/**
 * Marketing OS vocabularies. Mirrors the literal lists in
 * packages/database/src/schema/marketing.ts (checked by tests/unit/vocabulary.test.ts).
 */
export const PLATFORMS = ['instagram', 'youtube', 'linkedin', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ACCOUNT_STATUSES = ['live', 'starting', 'later', 'retired'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** exam = an exam page (pure exam content); local = Sikar; company = LinkedIn page; founder = personal. */
export const ACCOUNT_SCOPES = ['exam', 'local', 'company', 'founder'] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

/** D-014: `connected` only after a real verification call — no live adapter exists yet. */
export const INTEGRATION_STATUSES = ['not_configured', 'sandbox', 'connected', 'error'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const CADENCE_ENFORCEMENT = ['warn', 'block'] as const;
export type CadenceEnforcement = (typeof CADENCE_ENFORCEMENT)[number];

/** BR-MKT-2 idea prefixes. */
export const COURSE_PREFIXES = ['CLAT', 'IPMAT', 'CUET', 'COM', 'GEN'] as const;
export type CoursePrefix = (typeof COURSE_PREFIXES)[number];
/** Prefixes that are exams (GEN is not tied to one exam). */
export const EXAM_PREFIXES = ['CLAT', 'IPMAT', 'CUET', 'COM'] as const;

export const IDEA_STATUSES = [
  'idea',
  'in_development',
  'ready',
  'held',
  'rejected',
  'archived',
  'submitted',
  'approved',
  'changes_requested',
] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** MKT-014 idea scope, used by the collab rule. */
export const IDEA_SCOPES = [
  'single_exam',
  'cross_exam',
  'founder',
  'local_sikar',
  'general',
] as const;
export type IdeaScope = (typeof IDEA_SCOPES)[number];

export const QUARANTINE_STATES = ['none', 'quarantined', 'resolved'] as const;
export type QuarantineState = (typeof QUARANTINE_STATES)[number];

export const CONTENT_FORMATS = [
  'script',
  'caption',
  'carousel',
  'video_brief',
  'image',
  'post',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_STATES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export const ASSIGNEE_ROLES = ['writer', 'designer', 'editor', 'presenter'] as const;
export type AssigneeRole = (typeof ASSIGNEE_ROLES)[number];

export const RIGHTS_STATES = ['own', 'third_party_cleared', 'third_party_pending'] as const;
export type RightsState = (typeof RIGHTS_STATES)[number];

export const PLACEMENT_STATUSES = ['planned', 'scheduled', 'published', 'cancelled'] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];

export const PLACEMENT_VARIANTS = ['short', 'long'] as const;
export type PlacementVariant = (typeof PLACEMENT_VARIANTS)[number];

/** sandbox = mock adapter (nothing posted); manual = a person recorded the live link; legacy_reported = the old tracker said so. */
export const PUBLICATION_MODES = ['sandbox', 'adapter', 'manual', 'legacy_reported'] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const PUBLISHING_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type PublishingStatus = (typeof PUBLISHING_STATUSES)[number];

export const RULE_KINDS = [
  'banned_phrase',
  'channel_rule',
  'requires_approval',
  'consent',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const RULE_STATUSES = ['approved', 'documented', 'proposed', 'retired'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const METRIC_KEYS = [
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
export type MetricKey = (typeof METRIC_KEYS)[number];

/** MKT-029. `missing` and `not_applicable` always have value null — never 0. */
export const METRIC_STATES = ['reported', 'estimated', 'missing', 'not_applicable'] as const;
export type MetricState = (typeof METRIC_STATES)[number];

export const SNAPSHOT_SOURCES = ['csv_import', 'manual_audit', 'adapter'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const MATCH_STATUSES = [
  'matched_link',
  'suggested_title_date',
  'unmatched',
  'historical',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const SETTING_STATUSES = ['proposed', 'approved'] as const;
export type SettingStatus = (typeof SETTING_STATUSES)[number];

export const CAMPAIGN_STATUSES = ['draft', 'active', 'ended', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
