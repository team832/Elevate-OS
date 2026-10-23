/**
 * OWNER: Marketing OS team.
 *
 * The literal vocabularies of the `marketing` schema (each has a CHECK on its column),
 * re-exported by marketing.ts. Mirrored in apps/marketing-os/src/domain/vocabulary.ts; a unit
 * test (tests/unit/metrics-legacy.test.ts) fails if they drift apart. Not a schema file: it
 * exports no tables and is never listed in SCHEMA_MODULES or drizzle.config.ts.
 */
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
  // Review (brief §13, 0016): an approved idea may become a calendar item and a task.
  'submitted',
  'approved',
  'changes_requested',
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
export const MARKETING_CAMPAIGN_MEMBER_ROLES = ['owner', 'member'] as const;

// --- brief 23 Oct 2026 §12–§15 (migration 0016) ---------------------------------------------
export const MARKETING_CHANNELS = [
  'instagram',
  'youtube',
  'linkedin',
  'website',
  'email',
  'whatsapp',
  'online_event',
  'in_person',
  'other',
] as const;
export const MARKETING_CALENDAR_ITEM_TYPES = [
  'social_post',
  'short_video',
  'article',
  'webinar',
  'seminar',
  'admission_campaign',
  'email_draft',
  'landing_page_update',
] as const;
/** Idea → Planned → In Production → Submitted → Approved → Scheduled → Published (+ two side states). */
export const MARKETING_CALENDAR_STATUSES = [
  'idea',
  'planned',
  'in_production',
  'submitted',
  'approved',
  'scheduled',
  'published',
  'changes_requested',
  'cancelled',
] as const;
export const MARKETING_EFFORT_SIZES = ['s', 'm', 'l'] as const;
export const MARKETING_REVIEW_STATES = [
  'draft',
  'submitted',
  'approved',
  'changes_requested',
] as const;
export const MARKETING_OBSERVATION_SOURCES = ['manual', 'connected'] as const;
export const MARKETING_TARGET_SCOPES = ['employee', 'team', 'campaign'] as const;
export const MARKETING_TARGET_METRIC_KEYS = [
  'qualified_leads',
  'follow_ups_completed',
  'demo_bookings',
  'verified_admissions',
  'approved_content',
  'published_content',
  'campaign_deliverables',
] as const;
