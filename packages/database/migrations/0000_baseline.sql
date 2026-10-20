CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "marketing";
--> statement-breakpoint
CREATE SCHEMA "academic";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "core"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_module" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"policy" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_comment" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "approvals_subject_module_check" CHECK ("core"."approvals"."subject_module" IN ('platform', 'marketing', 'academic', 'ops')),
	CONSTRAINT "approvals_status_check" CHECK ("core"."approvals"."status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "approvals_decision_consistency" CHECK (("core"."approvals"."status" = 'pending' AND "core"."approvals"."decided_at" IS NULL AND "core"."approvals"."decided_by" IS NULL)
        OR ("core"."approvals"."status" IN ('approved', 'rejected') AND "core"."approvals"."decided_at" IS NOT NULL AND "core"."approvals"."decided_by" IS NOT NULL)
        OR ("core"."approvals"."status" = 'withdrawn' AND "core"."approvals"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "core"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"metadata" jsonb,
	CONSTRAINT "audit_events_module_check" CHECK ("core"."audit_events"."module" IN ('platform', 'marketing', 'academic', 'ops')),
	CONSTRAINT "audit_events_actor_type_check" CHECK ("core"."audit_events"."actor_type" IN ('user', 'system', 'service')),
	CONSTRAINT "audit_events_user_actor_has_id" CHECK ("core"."audit_events"."actor_type" <> 'user' OR "core"."audit_events"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "core"."departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'provisional' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_status_check" CHECK ("core"."departments"."status" IN ('active', 'provisional', 'archived')),
	CONSTRAINT "departments_code_format" CHECK ("core"."departments"."code" ~ '^[A-Z][A-Z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "core"."event_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deliveries_status_check" CHECK ("core"."event_deliveries"."status" IN ('processed', 'failed', 'dead')),
	CONSTRAINT "event_deliveries_attempts_positive" CHECK ("core"."event_deliveries"."attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid,
	"request_hash" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_user_key" UNIQUE NULLS NOT DISTINCT("scope","key","user_id")
);
--> statement-breakpoint
CREATE TABLE "core"."integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"producer" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid,
	"causation_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_events_producer_check" CHECK ("core"."integration_events"."producer" IN ('platform', 'marketing', 'academic', 'ops')),
	CONSTRAINT "integration_events_version_positive" CHECK ("core"."integration_events"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_module_check" CHECK ("core"."notifications"."module" IN ('platform', 'marketing', 'academic', 'ops')),
	CONSTRAINT "notifications_link_relative" CHECK ("core"."notifications"."link" IS NULL OR "core"."notifications"."link" LIKE '/%')
);
--> statement-breakpoint
CREATE TABLE "core"."programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programmes_status_check" CHECK ("core"."programmes"."status" IN ('active', 'planned', 'paused', 'retired')),
	CONSTRAINT "programmes_code_format" CHECK ("core"."programmes"."code" ~ '^[A-Z][A-Z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "core"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_expiry_after_creation" CHECK ("core"."sessions"."expires_at" > "core"."sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "core"."staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"department_id" uuid,
	"title" text,
	"manager_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_members_status_check" CHECK ("core"."staff_members"."status" IN ('active', 'on_leave', 'inactive')),
	CONSTRAINT "staff_members_not_own_manager" CHECK ("core"."staff_members"."manager_id" IS NULL OR "core"."staff_members"."manager_id" <> "core"."staff_members"."id")
);
--> statement-breakpoint
CREATE TABLE "core"."user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_pkey" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "core"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("core"."users"."email" = lower("core"."users"."email")),
	CONSTRAINT "users_status_check" CHECK ("core"."users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"kind" text DEFAULT 'organic' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_code_format" CHECK ("marketing"."campaigns"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
	CONSTRAINT "campaigns_status_check" CHECK ("marketing"."campaigns"."status" IN ('draft', 'active', 'ended', 'cancelled')),
	CONSTRAINT "campaigns_kind_check" CHECK ("marketing"."campaigns"."kind" IN ('organic')),
	CONSTRAINT "campaigns_dates_order" CHECK ("marketing"."campaigns"."starts_on" IS NULL OR "marketing"."campaigns"."ends_on" IS NULL OR "marketing"."campaigns"."starts_on" <= "marketing"."campaigns"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "marketing"."code_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_counters_non_negative" CHECK ("marketing"."code_counters"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"external_url" text,
	"shows_students" boolean DEFAULT false NOT NULL,
	"rights_state" text DEFAULT 'own' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_assets_rights_check" CHECK ("marketing"."content_assets"."rights_state" IN ('own', 'third_party_cleared', 'third_party_pending')),
	CONSTRAINT "content_assets_size_non_negative" CHECK ("marketing"."content_assets"."size_bytes" IS NULL OR "marketing"."content_assets"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"role" text NOT NULL,
	"user_id" uuid,
	"staff_member_id" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_assignments_role_check" CHECK ("marketing"."content_assignments"."role" IN ('writer', 'designer', 'editor', 'presenter')),
	CONSTRAINT "content_assignments_has_assignee" CHECK ("marketing"."content_assignments"."user_id" IS NOT NULL OR "marketing"."content_assignments"."staff_member_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_id" uuid,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"approval_id" uuid,
	"hold_reason" text,
	"hold_since" timestamp with time zone,
	"archived_reason" text,
	"legacy_status" text,
	"legacy_format" text,
	"legacy_ref" text,
	"provenance" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_format_check" CHECK ("marketing"."content_items"."format" IN ('script', 'caption', 'carousel', 'video_brief', 'image', 'post')),
	CONSTRAINT "content_items_state_check" CHECK ("marketing"."content_items"."state" IN ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived')),
	CONSTRAINT "content_items_approved_needs_approval" CHECK ("marketing"."content_items"."approved_version_id" IS NULL OR "marketing"."content_items"."approval_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version_hash" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"rule_check" jsonb NOT NULL,
	"acknowledged_rule_codes" text[],
	"outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reviews_outcome_check" CHECK ("marketing"."content_reviews"."outcome" IN ('pending', 'approved', 'changes_requested', 'withdrawn', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"matcher" jsonb,
	"manual_check" boolean NOT NULL,
	"action_on_match" text,
	"applies_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"source_text" text,
	"notes" text,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_rules_kind_check" CHECK ("marketing"."content_rules"."kind" IN ('banned_phrase', 'channel_rule', 'requires_approval', 'consent')),
	CONSTRAINT "content_rules_status_check" CHECK ("marketing"."content_rules"."status" IN ('approved', 'documented', 'proposed', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"shows_students" boolean DEFAULT false NOT NULL,
	"consent_reference" text,
	"change_note" text,
	"author_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_versions_number_positive" CHECK ("marketing"."content_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "marketing"."ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"course_prefix" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"pillar" text,
	"series" text,
	"objective" text,
	"audience" text,
	"brief" text,
	"origin" text,
	"master_asset" text,
	"scope" text NOT NULL,
	"scope_prefixes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"status_reason" text,
	"notes" text,
	"legacy_code" text,
	"legacy_status" text,
	"legacy_ref" text,
	"quarantine_state" text DEFAULT 'none' NOT NULL,
	"quarantine_reason" text,
	"proposed_code" text,
	"proposed_code_status" text,
	"provenance" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_code_format" CHECK ("marketing"."ideas"."code" IS NULL OR "marketing"."ideas"."code" ~ '^(CLAT|IPMAT|CUET|COM|GEN)-[0-9]{3,}$'),
	CONSTRAINT "ideas_code_matches_prefix" CHECK ("marketing"."ideas"."code" IS NULL OR "marketing"."ideas"."code" LIKE "marketing"."ideas"."course_prefix" || '-%'),
	CONSTRAINT "ideas_course_prefix_check" CHECK ("marketing"."ideas"."course_prefix" IN ('CLAT', 'IPMAT', 'CUET', 'COM', 'GEN')),
	CONSTRAINT "ideas_status_check" CHECK ("marketing"."ideas"."status" IN ('idea', 'in_development', 'ready', 'held', 'rejected', 'archived')),
	CONSTRAINT "ideas_scope_check" CHECK ("marketing"."ideas"."scope" IN ('single_exam', 'cross_exam', 'founder', 'local_sikar', 'general')),
	CONSTRAINT "ideas_quarantine_check" CHECK ("marketing"."ideas"."quarantine_state" IN ('none', 'quarantined', 'resolved')),
	CONSTRAINT "ideas_code_or_quarantine" CHECK ("marketing"."ideas"."code" IS NOT NULL OR "marketing"."ideas"."quarantine_state" = 'quarantined')
);
--> statement-breakpoint
CREATE TABLE "marketing"."legacy_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"owner_decision" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'unreconciled' NOT NULL,
	"details" jsonb,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_conflicts_status_check" CHECK ("marketing"."legacy_conflicts"."status" IN ('unreconciled', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."metric_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"format" text NOT NULL,
	"date_format" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"rows_total" integer NOT NULL,
	"rows_accepted" integer NOT NULL,
	"rows_rejected" integer NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rejected" jsonb NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_imports_counts" CHECK ("marketing"."metric_imports"."rows_total" >= 0 AND "marketing"."metric_imports"."rows_accepted" >= 0 AND "marketing"."metric_imports"."rows_rejected" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marketing"."metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid,
	"source" text NOT NULL,
	"source_label" text NOT NULL,
	"account_id" uuid NOT NULL,
	"placement_id" uuid,
	"suggested_placement_id" uuid,
	"match_status" text NOT NULL,
	"post_key" text NOT NULL,
	"post_link" text,
	"post_title" text,
	"published_on" date,
	"platform_format" text,
	"format_estimated" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_precision" text DEFAULT 'instant' NOT NULL,
	"window" text DEFAULT 'lifetime_at_capture' NOT NULL,
	"source_row" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_source_check" CHECK ("marketing"."metric_snapshots"."source" IN ('csv_import', 'manual_audit', 'adapter')),
	CONSTRAINT "metric_snapshots_match_check" CHECK ("marketing"."metric_snapshots"."match_status" IN ('matched_link', 'suggested_title_date', 'unmatched', 'historical')),
	CONSTRAINT "metric_snapshots_window_check" CHECK ("marketing"."metric_snapshots"."window" IN ('lifetime_at_capture', '24h', '7d'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."metric_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" double precision,
	"state" text NOT NULL,
	"basis" text,
	CONSTRAINT "metric_values_metric_check" CHECK ("marketing"."metric_values"."metric" IN ('views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'watch_hours', 'ctr_pct')),
	CONSTRAINT "metric_values_state_check" CHECK ("marketing"."metric_values"."state" IN ('reported', 'estimated', 'missing', 'not_applicable')),
	CONSTRAINT "metric_values_value_matches_state" CHECK (("marketing"."metric_values"."state" IN ('reported', 'estimated') AND "marketing"."metric_values"."value" IS NOT NULL AND "marketing"."metric_values"."value" >= 0)
        OR ("marketing"."metric_values"."state" IN ('missing', 'not_applicable') AND "marketing"."metric_values"."value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "marketing"."placement_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"idea_id" uuid NOT NULL,
	"kind" text DEFAULT 'collab' NOT NULL,
	"platform" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placement_groups_kind_check" CHECK ("marketing"."placement_groups"."kind" IN ('collab')),
	CONSTRAINT "placement_groups_platform_check" CHECK ("marketing"."placement_groups"."platform" IN ('instagram', 'youtube'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"idea_id" uuid,
	"content_item_id" uuid,
	"account_id" uuid NOT NULL,
	"variant" text,
	"placement_group_id" uuid,
	"campaign_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"original_publish_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_url" text,
	"publication_mode" text,
	"cancelled_reason" text,
	"legacy_code" text,
	"legacy_idea_code" text,
	"legacy_status" text,
	"legacy_format" text,
	"legacy_date_raw" text,
	"legacy_date_precision" text,
	"legacy_link_or_file" text,
	"legacy_result_24h" text,
	"legacy_notes" text,
	"legacy_ref" text,
	"ambiguous" boolean DEFAULT false NOT NULL,
	"ambiguity_reason" text,
	"provenance" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_status_check" CHECK ("marketing"."placements"."status" IN ('planned', 'scheduled', 'published', 'cancelled')),
	CONSTRAINT "placements_variant_check" CHECK ("marketing"."placements"."variant" IS NULL OR "marketing"."placements"."variant" IN ('short', 'long')),
	CONSTRAINT "placements_publication_mode_check" CHECK ("marketing"."placements"."publication_mode" IS NULL OR "marketing"."placements"."publication_mode" IN ('sandbox', 'adapter', 'manual', 'legacy_reported')),
	CONSTRAINT "placements_linked_unless_ambiguous" CHECK ("marketing"."placements"."ambiguous" OR ("marketing"."placements"."idea_id" IS NOT NULL AND "marketing"."placements"."content_item_id" IS NOT NULL AND "marketing"."placements"."code" IS NOT NULL)),
	CONSTRAINT "placements_scheduled_has_time" CHECK ("marketing"."placements"."status" <> 'scheduled' OR "marketing"."placements"."scheduled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "marketing"."policy_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"owner_decision" text,
	"description" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_settings_status_check" CHECK ("marketing"."policy_settings"."status" IN ('proposed', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."publishing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"response" jsonb,
	"error" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_by" uuid,
	CONSTRAINT "publishing_attempts_outcome_check" CHECK ("marketing"."publishing_attempts"."outcome" IN ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "marketing"."publishing_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"adapter" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"is_sandbox" boolean NOT NULL,
	"external_post_id" text,
	"published_url" text,
	"last_response" jsonb,
	"last_error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_records_status_check" CHECK ("marketing"."publishing_records"."status" IN ('pending', 'succeeded', 'failed')),
	CONSTRAINT "publishing_records_attempts_range" CHECK ("marketing"."publishing_records"."attempts" >= 0 AND "marketing"."publishing_records"."max_attempts" >= 1 AND "marketing"."publishing_records"."attempts" <= "marketing"."publishing_records"."max_attempts"),
	CONSTRAINT "publishing_records_sandbox_no_url" CHECK (NOT "marketing"."publishing_records"."is_sandbox" OR "marketing"."publishing_records"."published_url" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "marketing"."social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"platform" text NOT NULL,
	"display_name" text,
	"proposed_display_name" text,
	"handle" text,
	"proposed_handle" text,
	"handle_status" text DEFAULT 'tbd' NOT NULL,
	"scope" text NOT NULL,
	"exam_prefixes" text[] DEFAULT '{}'::text[] NOT NULL,
	"audience" text,
	"job" text,
	"status" text NOT NULL,
	"legacy_status" text,
	"owner_staff_id" uuid,
	"cadence_text" text,
	"cadence_max_per_day" integer,
	"cadence_max_per_week" integer,
	"cadence_enforcement" text DEFAULT 'warn' NOT NULL,
	"cadence_status" text DEFAULT 'proposed' NOT NULL,
	"content_rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"publishing_tool_brand" text,
	"integration_status" text DEFAULT 'not_configured' NOT NULL,
	"integration_checked_at" timestamp with time zone,
	"integration_note" text,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_code_format" CHECK ("marketing"."social_accounts"."code" ~ '^[A-Z]{2,5}$'),
	CONSTRAINT "social_accounts_platform_check" CHECK ("marketing"."social_accounts"."platform" IN ('instagram', 'youtube', 'linkedin', 'other')),
	CONSTRAINT "social_accounts_status_check" CHECK ("marketing"."social_accounts"."status" IN ('live', 'starting', 'later', 'retired')),
	CONSTRAINT "social_accounts_scope_check" CHECK ("marketing"."social_accounts"."scope" IN ('exam', 'local', 'company', 'founder')),
	CONSTRAINT "social_accounts_integration_check" CHECK ("marketing"."social_accounts"."integration_status" IN ('not_configured', 'sandbox', 'connected', 'error')),
	CONSTRAINT "social_accounts_cadence_positive" CHECK (("marketing"."social_accounts"."cadence_max_per_day" IS NULL OR "marketing"."social_accounts"."cadence_max_per_day" > 0) AND ("marketing"."social_accounts"."cadence_max_per_week" IS NULL OR "marketing"."social_accounts"."cadence_max_per_week" > 0)),
	CONSTRAINT "social_accounts_cadence_enforcement_check" CHECK ("marketing"."social_accounts"."cadence_enforcement" IN ('warn', 'block')),
	CONSTRAINT "social_accounts_cadence_status_check" CHECK ("marketing"."social_accounts"."cadence_status" IN ('proposed', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "academic"."answer_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_keys_version_positive" CHECK ("academic"."answer_keys"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "academic"."assessment_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"question_count" integer NOT NULL,
	"answer_format" text DEFAULT 'choice' NOT NULL,
	"options" text[] DEFAULT '{A,B,C,D}'::text[] NOT NULL,
	"time_limit_minutes" integer,
	"marks_per_correct" numeric(10, 4),
	"marks_per_wrong" numeric(10, 4),
	"marks_unattempted" numeric(10, 4),
	"cap_marks" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_sections_questions_range" CHECK ("academic"."assessment_sections"."question_count" BETWEEN 1 AND 500),
	CONSTRAINT "assessment_sections_format_check" CHECK ("academic"."assessment_sections"."answer_format" IN ('choice', 'numeric'))
);
--> statement-breakpoint
CREATE TABLE "academic"."assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid,
	"chapter_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"scheduled_date" date,
	"start_time" text,
	"duration_minutes" integer,
	"discussion_minutes" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"pattern_ref" text,
	"marks_per_correct" numeric(10, 4),
	"marks_per_wrong" numeric(10, 4),
	"marks_unattempted" numeric(10, 4),
	"source_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_kind_check" CHECK ("academic"."assessments"."kind" IN ('chapter_test', 'sectional', 'full_mock', 'practice')),
	CONSTRAINT "assessments_status_check" CHECK ("academic"."assessments"."status" IN ('draft', 'scheduled', 'conducted', 'finalised', 'cancelled')),
	CONSTRAINT "assessments_minutes_positive" CHECK (("academic"."assessments"."duration_minutes" IS NULL OR "academic"."assessments"."duration_minutes" > 0) AND ("academic"."assessments"."discussion_minutes" IS NULL OR "academic"."assessments"."discussion_minutes" >= 0)),
	CONSTRAINT "assessments_start_time_format" CHECK ("academic"."assessments"."start_time" IS NULL OR "academic"."assessments"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "academic"."attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text NOT NULL,
	"responses" jsonb,
	"key_version" integer,
	"entered_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempts_status_check" CHECK ("academic"."attempts"."status" IN ('submitted', 'absent')),
	CONSTRAINT "attempts_shape" CHECK (("academic"."attempts"."status" = 'absent' AND "academic"."attempts"."responses" IS NULL) OR ("academic"."attempts"."status" = 'submitted' AND "academic"."attempts"."responses" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text NOT NULL,
	"minutes_present" integer,
	"note" text,
	"recorded_by_user_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_status_check" CHECK ("academic"."attendance"."status" IN ('present', 'partial', 'late', 'absent', 'excused')),
	CONSTRAINT "attendance_minutes_range" CHECK ("academic"."attendance"."minutes_present" IS NULL OR ("academic"."attendance"."minutes_present" BETWEEN 0 AND 600))
);
--> statement-breakpoint
CREATE TABLE "academic"."batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"course_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"route" text,
	"mode" text,
	"start_date" date,
	"end_date" date,
	"class_minutes_override" integer,
	"capacity" integer,
	"target_exam" text,
	"target_exam_date" date,
	"target_exam_date_status" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_status_check" CHECK ("academic"."batches"."status" IN ('planning', 'active', 'completed', 'cancelled')),
	CONSTRAINT "batches_route_check" CHECK ("academic"."batches"."route" IS NULL OR "academic"."batches"."route" IN ('regular', 'dropper', 'class11_two_year', 'fast_track')),
	CONSTRAINT "batches_mode_check" CHECK ("academic"."batches"."mode" IS NULL OR "academic"."batches"."mode" IN ('offline', 'online', 'hybrid')),
	CONSTRAINT "batches_dates_order" CHECK ("academic"."batches"."start_date" IS NULL OR "academic"."batches"."end_date" IS NULL OR "academic"."batches"."start_date" <= "academic"."batches"."end_date"),
	CONSTRAINT "batches_capacity_positive" CHECK ("academic"."batches"."capacity" IS NULL OR "academic"."batches"."capacity" >= 1),
	CONSTRAINT "batches_exam_date_status_check" CHECK ("academic"."batches"."target_exam_date_status" IS NULL OR "academic"."batches"."target_exam_date_status" IN ('official', 'tentative', 'assumed', 'unverified'))
);
--> statement-breakpoint
CREATE TABLE "academic"."calendar_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"date" date,
	"period_start" date,
	"period_end" date,
	"days" integer,
	"slots_per_day" integer,
	"status" text DEFAULT 'provisional' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_exclusions_kind_check" CHECK ("academic"."calendar_exclusions"."kind" IN ('holiday', 'school_exam', 'exam_blackout', 'other')),
	CONSTRAINT "calendar_exclusions_status_check" CHECK ("academic"."calendar_exclusions"."status" IN ('provisional', 'confirmed', 'locked', 'unverified')),
	CONSTRAINT "calendar_exclusions_shape" CHECK (("academic"."calendar_exclusions"."date" IS NOT NULL AND "academic"."calendar_exclusions"."period_start" IS NULL AND "academic"."calendar_exclusions"."days" IS NULL) OR ("academic"."calendar_exclusions"."date" IS NULL AND "academic"."calendar_exclusions"."period_start" IS NOT NULL AND "academic"."calendar_exclusions"."period_end" IS NOT NULL AND "academic"."calendar_exclusions"."period_start" <= "academic"."calendar_exclusions"."period_end" AND "academic"."calendar_exclusions"."days" >= 0 AND "academic"."calendar_exclusions"."slots_per_day" >= 0))
);
--> statement-breakpoint
CREATE TABLE "academic"."calendar_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"weekdays" integer[] NOT NULL,
	"slots_per_day" integer NOT NULL,
	"kind" text DEFAULT 'regular' NOT NULL,
	"status" text DEFAULT 'provisional' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_rules_period_order" CHECK ("academic"."calendar_rules"."period_start" <= "academic"."calendar_rules"."period_end"),
	CONSTRAINT "calendar_rules_slots_positive" CHECK ("academic"."calendar_rules"."slots_per_day" >= 1),
	CONSTRAINT "calendar_rules_kind_check" CHECK ("academic"."calendar_rules"."kind" IN ('regular', 'extra'))
);
--> statement-breakpoint
CREATE TABLE "academic"."catchup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"chapter_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_staff_id" uuid,
	"due_date" date,
	"note" text,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catchup_tasks_reason_check" CHECK ("academic"."catchup_tasks"."reason" IN ('absent', 'excused', 'late_joiner')),
	CONSTRAINT "catchup_tasks_status_check" CHECK ("academic"."catchup_tasks"."status" IN ('open', 'in_progress', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "academic"."chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"alias_of_chapter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_status_check" CHECK ("academic"."chapters"."status" IN ('active', 'retired', 'moved')),
	CONSTRAINT "chapters_weight_range" CHECK ("academic"."chapters"."weight" BETWEEN 1 AND 10),
	CONSTRAINT "chapters_alias_rule" CHECK (("academic"."chapters"."status" = 'active' AND "academic"."chapters"."alias_of_chapter_id" IS NULL) OR "academic"."chapters"."status" <> 'active')
);
--> statement-breakpoint
CREATE TABLE "academic"."class_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"teacher_staff_id" uuid NOT NULL,
	"activity" text DEFAULT 'main' NOT NULL,
	"completion" text NOT NULL,
	"actual_minutes" integer NOT NULL,
	"notes" text,
	"evidence" text,
	"state" text DEFAULT 'submitted' NOT NULL,
	"corrects_record_id" uuid,
	"correction_reason" text,
	"recorded_by_user_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "class_records_state_check" CHECK ("academic"."class_records"."state" IN ('submitted', 'verified', 'superseded')),
	CONSTRAINT "class_records_minutes_range" CHECK ("academic"."class_records"."actual_minutes" BETWEEN 1 AND 600),
	CONSTRAINT "class_records_activity_check" CHECK ("academic"."class_records"."activity" IN ('main', 'practice', 'catch_up', 'test', 'discussion')),
	CONSTRAINT "class_records_completion_check" CHECK ("academic"."class_records"."completion" IN ('completed', 'partial')),
	CONSTRAINT "class_records_verification_pair" CHECK (("academic"."class_records"."verified_by_user_id" IS NULL) = ("academic"."class_records"."verified_at" IS NULL)),
	CONSTRAINT "class_records_correction_reason" CHECK ("academic"."class_records"."corrects_record_id" IS NULL OR "academic"."class_records"."correction_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid,
	"planned_chapter_id" uuid,
	"teacher_staff_id" uuid,
	"room_id" uuid,
	"session_type" text DEFAULT 'teaching' NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"status_reason" text,
	"rescheduled_from_session_id" uuid,
	"online_link" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_type_check" CHECK ("academic"."class_sessions"."session_type" IN ('teaching', 'practice', 'catch_up', 'test', 'discussion')),
	CONSTRAINT "class_sessions_status_check" CHECK ("academic"."class_sessions"."status" IN ('scheduled', 'held', 'cancelled', 'rescheduled')),
	CONSTRAINT "class_sessions_start_time_format" CHECK ("academic"."class_sessions"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "class_sessions_duration_range" CHECK ("academic"."class_sessions"."duration_minutes" BETWEEN 5 AND 600),
	CONSTRAINT "class_sessions_reason_required" CHECK ("academic"."class_sessions"."status" NOT IN ('cancelled', 'rescheduled') OR "academic"."class_sessions"."status_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."concept_book_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_code" text NOT NULL,
	"book_title" text NOT NULL,
	"chapter_code" text NOT NULL,
	"chapter_number" integer,
	"section" text,
	"title" text NOT NULL,
	"subtopics" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"alias_of_code" text,
	"index_status" text DEFAULT 'locked' NOT NULL,
	"content_status" text DEFAULT 'not_started' NOT NULL,
	"planned_concept_questions" integer,
	"planned_practice_questions" integer,
	"planned_ranker_questions" integer,
	"question_count_status" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_book_chapters_status_check" CHECK ("academic"."concept_book_chapters"."status" IN ('active', 'retired', 'moved', 'opening_unit')),
	CONSTRAINT "concept_book_chapters_count_label" CHECK ("academic"."concept_book_chapters"."question_count_status" IS NULL OR "academic"."concept_book_chapters"."question_count_status" = 'planned')
);
--> statement-breakpoint
CREATE TABLE "academic"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"code" text NOT NULL,
	"family_code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"mode" text,
	"class_minutes" integer,
	"class_minutes_status" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_version_positive" CHECK ("academic"."courses"."version" >= 1),
	CONSTRAINT "courses_class_minutes_range" CHECK ("academic"."courses"."class_minutes" IS NULL OR ("academic"."courses"."class_minutes" BETWEEN 15 AND 300)),
	CONSTRAINT "courses_mode_check" CHECK ("academic"."courses"."mode" IS NULL OR "academic"."courses"."mode" IN ('offline', 'online', 'hybrid')),
	CONSTRAINT "courses_class_minutes_status_check" CHECK ("academic"."courses"."class_minutes_status" IN ('locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown')),
	CONSTRAINT "courses_status_check" CHECK ("academic"."courses"."status" IN ('draft', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "academic"."curriculum_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"counts_status" text DEFAULT 'proposed' NOT NULL,
	"dates_status" text DEFAULT 'unknown' NOT NULL,
	"supersedes_plan_id" uuid,
	"pending_target_status" text,
	"class_minutes" integer,
	"scope_note" text,
	"change_log" text,
	"source_ref" text,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"legacy_approved_on" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculum_plans_status_check" CHECK ("academic"."curriculum_plans"."status" IN ('locked', 'provisional', 'proposed', 'superseded')),
	CONSTRAINT "curriculum_plans_label_check" CHECK ("academic"."curriculum_plans"."counts_status" IN ('locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown') AND "academic"."curriculum_plans"."dates_status" IN ('locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown')),
	CONSTRAINT "curriculum_plans_version_positive" CHECK ("academic"."curriculum_plans"."version" >= 1),
	CONSTRAINT "curriculum_plans_not_self_superseding" CHECK ("academic"."curriculum_plans"."supersedes_plan_id" IS NULL OR "academic"."curriculum_plans"."supersedes_plan_id" <> "academic"."curriculum_plans"."id"),
	CONSTRAINT "curriculum_plans_pending_target_check" CHECK ("academic"."curriculum_plans"."pending_target_status" IS NULL OR "academic"."curriculum_plans"."pending_target_status" IN ('locked', 'provisional'))
);
--> statement-breakpoint
CREATE TABLE "academic"."enrolment_intake_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_event_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"programme_code" text NOT NULL,
	"student_name" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"reason" text,
	"student_id" uuid,
	"enrolment_id" uuid,
	"existing_student" boolean,
	"reply_event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrolment_intake_log_outcome_check" CHECK ("academic"."enrolment_intake_log"."outcome" IN ('confirmed', 'rejected')),
	CONSTRAINT "enrolment_intake_log_outcome_shape" CHECK (("academic"."enrolment_intake_log"."outcome" = 'confirmed' AND "academic"."enrolment_intake_log"."enrolment_id" IS NOT NULL AND "academic"."enrolment_intake_log"."student_id" IS NOT NULL) OR ("academic"."enrolment_intake_log"."outcome" = 'rejected' AND "academic"."enrolment_intake_log"."reason_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"course_id" uuid,
	"batch_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"late_joiner" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"manual_reason" text,
	"source_admission_id" uuid,
	"source_lead_id" uuid,
	"request_event_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrolments_status_check" CHECK ("academic"."enrolments"."status" IN ('active', 'paused', 'withdrawn', 'completed')),
	CONSTRAINT "enrolments_source_check" CHECK ("academic"."enrolments"."source" IN ('admission_event', 'manual')),
	CONSTRAINT "enrolments_manual_reason" CHECK ("academic"."enrolments"."source" <> 'manual' OR "academic"."enrolments"."manual_reason" IS NOT NULL),
	CONSTRAINT "enrolments_event_has_request" CHECK ("academic"."enrolments"."source" <> 'admission_event' OR "academic"."enrolments"."request_event_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid,
	"trigger" text NOT NULL,
	"description" text NOT NULL,
	"responsible_staff_id" uuid NOT NULL,
	"action" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"parent_contact_status" text DEFAULT 'not_contacted' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "interventions_status_check" CHECK ("academic"."interventions"."status" IN ('open', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "interventions_outcome_on_resolve" CHECK ("academic"."interventions"."status" NOT IN ('resolved', 'closed') OR "academic"."interventions"."outcome" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"lesson_code" text NOT NULL,
	"session_type" text NOT NULL,
	"planned_classes" integer DEFAULT 1 NOT NULL,
	"planned_minutes" integer NOT NULL,
	"planned_date" date,
	"coverage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_session_type_check" CHECK ("academic"."plan_items"."session_type" IN ('teaching', 'practice')),
	CONSTRAINT "plan_items_counts_positive" CHECK ("academic"."plan_items"."planned_classes" >= 1 AND "academic"."plan_items"."planned_minutes" >= 1)
);
--> statement-breakpoint
CREATE TABLE "academic"."result_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"answer_key_id" uuid NOT NULL,
	"status" text NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"reason" text,
	"students_scored" integer NOT NULL,
	"students_absent" integer NOT NULL,
	"finalised_by_user_id" uuid NOT NULL,
	"finalised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "result_runs_status_check" CHECK ("academic"."result_runs"."status" IN ('final', 'superseded')),
	CONSTRAINT "result_runs_rescore_reason" CHECK ("academic"."result_runs"."version" = 1 OR "academic"."result_runs"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "academic"."results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"total_score" numeric(10, 4),
	"max_score" numeric(10, 4) NOT NULL,
	"percentile" numeric(7, 4),
	"rank" integer,
	"section_scores" jsonb NOT NULL,
	"absent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_absent_shape" CHECK (("academic"."results"."absent" AND "academic"."results"."total_score" IS NULL) OR (NOT "academic"."results"."absent" AND "academic"."results"."total_score" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_status_check" CHECK ("academic"."rooms"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "academic"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"description" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_status_check" CHECK ("academic"."settings"."status" IN ('proposed', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "academic"."students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date,
	"current_stage" text,
	"school_board" text,
	"email" text,
	"phone" text,
	"city" text,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_email" text,
	"guardian_phone" text,
	"source_admission_id" uuid,
	"source_lead_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_status_check" CHECK ("academic"."students"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "academic"."subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic"."teacher_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"employment_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_assignments_status_check" CHECK ("academic"."teacher_assignments"."status" IN ('active', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "ops"."admission_checks" (
	"admission_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"status" text NOT NULL,
	"reference" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_checks_pkey" PRIMARY KEY("admission_id","item_key"),
	CONSTRAINT "admission_checks_item_check" CHECK ("ops"."admission_checks"."item_key" IN ('admission_form', 'documents_verified', 'fee_verification_1', 'fee_verification_2', 'down_payment_verified', 'kit_issued', 'communication_group_added', 'timetable_communicated', 'school_coordination', 'hostel_coordination')),
	CONSTRAINT "admission_checks_status_check" CHECK ("ops"."admission_checks"."status" IN ('done', 'not_done', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "ops"."admission_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"reason_code" text,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"event_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_transitions_to_check" CHECK ("ops"."admission_transitions"."to_status" IN ('new', 'contacted', 'counselling_scheduled', 'counselled', 'demo_scheduled', 'demo_attended', 'admission_pending', 'admitted', 'enrolment_requested', 'enrolled', 'lost', 'on_hold')),
	CONSTRAINT "admission_transitions_user_has_id" CHECK ("ops"."admission_transitions"."actor_type" <> 'user' OR "ops"."admission_transitions"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"programme_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"status_reason" text,
	"held_from_status" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counsellor_staff_id" uuid,
	"delivery_mode" text,
	"intended_start_date" date,
	"intended_course_id" uuid,
	"intended_batch_id" uuid,
	"demo_skipped" boolean DEFAULT false NOT NULL,
	"admitted_at" timestamp with time zone,
	"enrolment_attempt" integer DEFAULT 0 NOT NULL,
	"handoff_status" text DEFAULT 'not_requested' NOT NULL,
	"last_request_event_id" uuid,
	"enrolment_requested_at" timestamp with time zone,
	"enrolment_id" uuid,
	"student_id" uuid,
	"enrolled_at" timestamp with time zone,
	"rejection_code" text,
	"rejection_reason" text,
	"rejected_at" timestamp with time zone,
	"status_reason_code" text,
	"admission_date" date,
	"academic_existing_student" boolean,
	"enrolled_course_id" uuid,
	"enrolled_batch_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_code_format" CHECK ("ops"."admissions"."code" ~ '^ADM-[0-9]{6}$'),
	CONSTRAINT "admissions_status_check" CHECK ("ops"."admissions"."status" IN ('new', 'contacted', 'counselling_scheduled', 'counselled', 'demo_scheduled', 'demo_attended', 'admission_pending', 'admitted', 'enrolment_requested', 'enrolled', 'lost', 'on_hold')),
	CONSTRAINT "admissions_held_from_check" CHECK (("ops"."admissions"."status" = 'on_hold') = ("ops"."admissions"."held_from_status" IS NOT NULL)),
	CONSTRAINT "admissions_handoff_check" CHECK ("ops"."admissions"."handoff_status" IN ('not_requested', 'pending', 'enrolled', 'rejected')),
	CONSTRAINT "admissions_attempt_check" CHECK ("ops"."admissions"."enrolment_attempt" >= 0),
	CONSTRAINT "admissions_reason_code_format" CHECK ("ops"."admissions"."status_reason_code" IS NULL OR "ops"."admissions"."status_reason_code" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "admissions_enrolled_has_ids" CHECK ("ops"."admissions"."status" <> 'enrolled' OR ("ops"."admissions"."enrolment_id" IS NOT NULL AND "ops"."admissions"."student_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."contact_preferences" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"consent_status" text NOT NULL,
	"consent_by" text NOT NULL,
	"allowed_channels" text[] NOT NULL,
	"preferred_contact" text,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_preferences_status_check" CHECK ("ops"."contact_preferences"."consent_status" IN ('given', 'refused', 'withdrawn')),
	CONSTRAINT "contact_preferences_by_check" CHECK ("ops"."contact_preferences"."consent_by" IN ('student', 'guardian', 'both')),
	CONSTRAINT "contact_preferences_channels_check" CHECK ("ops"."contact_preferences"."allowed_channels" <@ ARRAY['call', 'whatsapp', 'sms', 'email']::text[]),
	CONSTRAINT "contact_preferences_refused_no_channels" CHECK ("ops"."contact_preferences"."consent_status" = 'given' OR cardinality("ops"."contact_preferences"."allowed_channels") = 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."counselling_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"counsellor_staff_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"attendees" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"recommended_programme_id" uuid,
	"objections" text,
	"outcome" text,
	"next_step" text,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counselling_sessions_status_check" CHECK ("ops"."counselling_sessions"."status" IN ('scheduled', 'completed', 'no_show', 'cancelled')),
	CONSTRAINT "counselling_sessions_mode_check" CHECK ("ops"."counselling_sessions"."mode" IN ('in_person', 'phone', 'video'))
);
--> statement-breakpoint
CREATE TABLE "ops"."decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"area" text NOT NULL,
	"statement" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"decided_by_staff_id" uuid,
	"decided_on" date,
	"source" text,
	"owner_decision_ref" text,
	"superseded_by_id" uuid,
	"legacy_status" text,
	"legacy_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_code_format" CHECK ("ops"."decisions"."code" ~ '^(DEC-[0-9]{4}|LEGACY-[A-Z0-9-]+)$'),
	CONSTRAINT "decisions_state_check" CHECK ("ops"."decisions"."state" IN ('open', 'proposed', 'confirmed', 'provisional', 'superseded')),
	CONSTRAINT "decisions_superseded_link" CHECK ("ops"."decisions"."state" <> 'superseded' OR "ops"."decisions"."superseded_by_id" IS NOT NULL),
	CONSTRAINT "decisions_not_self" CHECK ("ops"."decisions"."superseded_by_id" IS NULL OR "ops"."decisions"."superseded_by_id" <> "ops"."decisions"."id")
);
--> statement-breakpoint
CREATE TABLE "ops"."demo_teachers" (
	"demo_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "demo_teachers_pkey" PRIMARY KEY("demo_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."demos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"subjects" text[] NOT NULL,
	"day_dates" date[] NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"fee_status" text DEFAULT 'not_paid' NOT NULL,
	"fee_amount_inr" numeric(12, 2),
	"fee_terms_state" text NOT NULL,
	"fee_reference" text,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demos_status_check" CHECK ("ops"."demos"."status" IN ('scheduled', 'attended', 'missed', 'cancelled')),
	CONSTRAINT "demos_fee_status_check" CHECK ("ops"."demos"."fee_status" IN ('not_paid', 'paid_verified', 'adjusted_against_fees', 'retained_non_refundable')),
	CONSTRAINT "demos_has_subjects" CHECK (cardinality("ops"."demos"."subjects") >= 1),
	CONSTRAINT "demos_has_days" CHECK (cardinality("ops"."demos"."day_dates") >= 1)
);
--> statement-breakpoint
CREATE TABLE "ops"."duplicate_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"matched_lead_id" uuid NOT NULL,
	"level" text NOT NULL,
	"signals" text[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledgement" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_flags_not_self" CHECK ("ops"."duplicate_flags"."lead_id" <> "ops"."duplicate_flags"."matched_lead_id"),
	CONSTRAINT "duplicate_flags_level_check" CHECK ("ops"."duplicate_flags"."level" IN ('exact', 'possible')),
	CONSTRAINT "duplicate_flags_status_check" CHECK ("ops"."duplicate_flags"."status" IN ('open', 'dismissed', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "ops"."enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"source_code" text NOT NULL,
	"channel" text,
	"discovery_source" text,
	"campaign_ref" text,
	"content_ref" text,
	"programme_id" uuid,
	"interest_mode" text DEFAULT 'undecided' NOT NULL,
	"notes" text,
	"merged_from_lead_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_interest_mode_check" CHECK ("ops"."enquiries"."interest_mode" IN ('offline', 'online', 'undecided'))
);
--> statement-breakpoint
CREATE TABLE "ops"."enrolment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"request_event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"outcome_at" timestamp with time zone,
	"reply_event_id" uuid,
	"rejection_code" text,
	"rejection_reason" text,
	"note" text,
	CONSTRAINT "enrolment_attempts_attempt_check" CHECK ("ops"."enrolment_attempts"."attempt" >= 1),
	CONSTRAINT "enrolment_attempts_kind_check" CHECK ("ops"."enrolment_attempts"."kind" IN ('initial', 'after_rejection', 'after_failure')),
	CONSTRAINT "enrolment_attempts_outcome_check" CHECK ("ops"."enrolment_attempts"."outcome" IN ('pending', 'confirmed', 'rejected', 'superseded')),
	CONSTRAINT "enrolment_attempts_failure_reason" CHECK ("ops"."enrolment_attempts"."kind" <> 'after_failure' OR "ops"."enrolment_attempts"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"trigger" text NOT NULL,
	"reason" text NOT NULL,
	"days_overdue" integer,
	"threshold_days" integer,
	"recipient_staff_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"respond_by" date,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raised_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	CONSTRAINT "escalations_level_check" CHECK ("ops"."escalations"."level" BETWEEN 2 AND 4),
	CONSTRAINT "escalations_status_check" CHECK ("ops"."escalations"."status" IN ('open', 'acknowledged', 'resolved')),
	CONSTRAINT "escalations_trigger_check" CHECK ("ops"."escalations"."trigger" IN ('overdue', 'blocked', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "ops"."fee_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"direction" text,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"pricing_reference" text,
	"receipt_reference" text,
	"method" text,
	"payment_date" date,
	"due_date" date,
	"demo_id" uuid,
	"status" text DEFAULT 'recorded' NOT NULL,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_records_code_format" CHECK ("ops"."fee_records"."code" ~ '^FEE-[0-9]{6}$'),
	CONSTRAINT "fee_records_kind_check" CHECK ("ops"."fee_records"."kind" IN ('due', 'received', 'refund', 'adjustment')),
	CONSTRAINT "fee_records_status_check" CHECK ("ops"."fee_records"."status" IN ('recorded', 'verified', 'voided')),
	CONSTRAINT "fee_records_method_check" CHECK ("ops"."fee_records"."method" IS NULL OR "ops"."fee_records"."method" IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card_terminal', 'other')),
	CONSTRAINT "fee_records_amount_positive" CHECK ("ops"."fee_records"."amount_paise" > 0),
	CONSTRAINT "fee_records_currency_inr" CHECK ("ops"."fee_records"."currency" = 'INR'),
	CONSTRAINT "fee_records_direction_check" CHECK (("ops"."fee_records"."kind" = 'adjustment') = ("ops"."fee_records"."direction" IS NOT NULL) AND ("ops"."fee_records"."direction" IS NULL OR "ops"."fee_records"."direction" IN ('credit', 'debit'))),
	CONSTRAINT "fee_records_verified_check" CHECK (("ops"."fee_records"."status" <> 'verified' OR ("ops"."fee_records"."verified_by" IS NOT NULL AND "ops"."fee_records"."verified_at" IS NOT NULL)) AND ("ops"."fee_records"."verified_by" IS NULL OR "ops"."fee_records"."verified_by" <> "ops"."fee_records"."recorded_by")),
	CONSTRAINT "fee_records_voided_check" CHECK ("ops"."fee_records"."status" <> 'voided' OR ("ops"."fee_records"."voided_by" IS NOT NULL AND "ops"."fee_records"."void_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"admission_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"owner_staff_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"last_reminder_on" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_kind_check" CHECK ("ops"."follow_ups"."kind" IN ('first_contact', 'counselling_followup', 'demo_followup', 'general')),
	CONSTRAINT "follow_ups_status_check" CHECK ("ops"."follow_ups"."status" IN ('open', 'done', 'cancelled')),
	CONSTRAINT "follow_ups_done_has_time" CHECK ("ops"."follow_ups"."status" <> 'done' OR "ops"."follow_ups"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_staff_id" uuid,
	"department_id" uuid,
	"sop_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"needs_authorised_approval" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_code_format" CHECK ("ops"."incidents"."code" ~ '^INC-[0-9]{5}$'),
	CONSTRAINT "incidents_kind_check" CHECK ("ops"."incidents"."kind" IN ('exception', 'incident')),
	CONSTRAINT "incidents_severity_check" CHECK ("ops"."incidents"."severity" IN ('low', 'medium', 'high')),
	CONSTRAINT "incidents_status_check" CHECK ("ops"."incidents"."status" IN ('open', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "incidents_resolved_has_resolution" CHECK ("ops"."incidents"."status" NOT IN ('resolved', 'closed') OR "ops"."incidents"."resolution" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"staff_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_activities_kind_check" CHECK ("ops"."lead_activities"."kind" IN ('call', 'whatsapp', 'sms', 'email', 'visit', 'note')),
	CONSTRAINT "lead_activities_outcome_check" CHECK ("ops"."lead_activities"."outcome" IN ('connected_two_way', 'replied', 'visited', 'no_answer', 'busy', 'wrong_number', 'message_sent', 'other'))
);
--> statement-breakpoint
CREATE TABLE "ops"."lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_code_key" UNIQUE("code"),
	CONSTRAINT "lead_sources_code_format" CHECK ("ops"."lead_sources"."code" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
	CONSTRAINT "lead_sources_status_check" CHECK ("ops"."lead_sources"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"student_name" text NOT NULL,
	"preferred_name" text,
	"student_phone" text,
	"student_email" text,
	"current_stage" text,
	"school_board" text,
	"previous_school" text,
	"city" text,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_phone" text,
	"guardian_email" text,
	"programme_id" uuid,
	"interest_mode" text DEFAULT 'undecided' NOT NULL,
	"first_received_at" timestamp with time zone NOT NULL,
	"owner_staff_id" uuid,
	"owner_assigned_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"first_successful_contact_at" timestamp with time zone,
	"merged_into_lead_id" uuid,
	"merged_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_code_format" CHECK ("ops"."leads"."code" ~ '^LEAD-[0-9]{6}$'),
	CONSTRAINT "leads_has_contact" CHECK ("ops"."leads"."student_phone" IS NOT NULL OR "ops"."leads"."student_email" IS NOT NULL OR "ops"."leads"."guardian_phone" IS NOT NULL OR "ops"."leads"."guardian_email" IS NOT NULL),
	CONSTRAINT "leads_phone_e164" CHECK (("ops"."leads"."student_phone" IS NULL OR "ops"."leads"."student_phone" ~ '^\+[1-9][0-9]{7,14}$') AND ("ops"."leads"."guardian_phone" IS NULL OR "ops"."leads"."guardian_phone" ~ '^\+[1-9][0-9]{7,14}$')),
	CONSTRAINT "leads_email_lowercase" CHECK (("ops"."leads"."student_email" IS NULL OR "ops"."leads"."student_email" = lower("ops"."leads"."student_email")) AND ("ops"."leads"."guardian_email" IS NULL OR "ops"."leads"."guardian_email" = lower("ops"."leads"."guardian_email"))),
	CONSTRAINT "leads_interest_mode_check" CHECK ("ops"."leads"."interest_mode" IN ('offline', 'online', 'undecided')),
	CONSTRAINT "leads_stage_check" CHECK ("ops"."leads"."current_stage" IS NULL OR "ops"."leads"."current_stage" IN ('class_9', 'class_10', 'class_11', 'class_12', 'gap_year', 'graduate', 'other')),
	CONSTRAINT "leads_relationship_check" CHECK ("ops"."leads"."guardian_relationship" IS NULL OR "ops"."leads"."guardian_relationship" IN ('mother', 'father', 'guardian', 'other')),
	CONSTRAINT "leads_not_merged_into_self" CHECK ("ops"."leads"."merged_into_lead_id" IS NULL OR "ops"."leads"."merged_into_lead_id" <> "ops"."leads"."id")
);
--> statement-breakpoint
CREATE TABLE "ops"."milestone_dependencies" (
	"milestone_id" uuid NOT NULL,
	"depends_on_milestone_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_dependencies_pkey" PRIMARY KEY("milestone_id","depends_on_milestone_id"),
	CONSTRAINT "milestone_dependencies_not_self" CHECK ("ops"."milestone_dependencies"."milestone_id" <> "ops"."milestone_dependencies"."depends_on_milestone_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"owner_staff_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_status_check" CHECK ("ops"."milestones"."status" IN ('planned', 'done', 'missed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ops"."onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"title" text NOT NULL,
	"document_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_items_status_check" CHECK ("ops"."onboarding_items"."status" IN ('pending', 'done', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "ops"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"workstream" text,
	"description" text,
	"owner_staff_id" uuid,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_format" CHECK ("ops"."projects"."code" ~ '^PRJ-[0-9]{4}$'),
	CONSTRAINT "projects_status_check" CHECK ("ops"."projects"."status" IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
	CONSTRAINT "projects_dates_order" CHECK ("ops"."projects"."start_date" IS NULL OR "ops"."projects"."end_date" IS NULL OR "ops"."projects"."end_date" >= "ops"."projects"."start_date")
);
--> statement-breakpoint
CREATE TABLE "ops"."responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"department_id" uuid,
	"accountable_role" text,
	"holder_staff_id" uuid,
	"backup_staff_id" uuid,
	"hand_over_to_role" text,
	"critical" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text,
	"legacy_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responsibilities_status_check" CHECK ("ops"."responsibilities"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"likelihood" text,
	"impact" text,
	"owner_staff_id" uuid,
	"mitigation" text,
	"review_date" date,
	"target_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risks_code_format" CHECK ("ops"."risks"."code" ~ '^RSK-[0-9]{4}$'),
	CONSTRAINT "risks_kind_check" CHECK ("ops"."risks"."kind" IN ('risk', 'issue', 'blocker')),
	CONSTRAINT "risks_status_check" CHECK ("ops"."risks"."status" IN ('open', 'mitigating', 'resolved', 'closed', 'accepted')),
	CONSTRAINT "risks_likelihood_check" CHECK ("ops"."risks"."likelihood" IS NULL OR "ops"."risks"."likelihood" IN ('low', 'medium', 'high')),
	CONSTRAINT "risks_impact_check" CHECK ("ops"."risks"."impact" IS NULL OR "ops"."risks"."impact" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "ops"."settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"decision_state" text DEFAULT 'proposed' NOT NULL,
	"source" text,
	"owner_decision" text,
	"note" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_decision_state_check" CHECK ("ops"."settings"."decision_state" IN ('proposed', 'approved', 'locked', 'open', 'pending_verification', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sop_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"version_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"change_note" text,
	"document_ref" text,
	"content_hash" text,
	"approval_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_outcome" text,
	"review_note" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"source_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_versions_status_check" CHECK ("ops"."sop_versions"."status" IN ('draft', 'in_review', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "sop_versions_number_positive" CHECK ("ops"."sop_versions"."version_number" >= 1),
	CONSTRAINT "sop_versions_approved_consistency" CHECK ("ops"."sop_versions"."status" <> 'approved' OR ("ops"."sop_versions"."approved_by" IS NOT NULL AND "ops"."sop_versions"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"process" text,
	"department_id" uuid,
	"owner_staff_id" uuid,
	"reviewer_staff_id" uuid,
	"backup_staff_id" uuid,
	"owner_role" text,
	"risk_level" text,
	"priority" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"next_review_date" date,
	"legacy_source" text,
	"legacy_status" text,
	"legacy_ref" text,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sops_code_format" CHECK ("ops"."sops"."code" ~ '^(SOP-[0-9]{4}|LEGACY-[A-Z0-9-]+)$'),
	CONSTRAINT "sops_status_check" CHECK ("ops"."sops"."status" IN ('not_drafted', 'draft', 'in_review', 'approved', 'retired')),
	CONSTRAINT "sops_risk_check" CHECK ("ops"."sops"."risk_level" IS NULL OR "ops"."sops"."risk_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "sops_legacy_code_has_source" CHECK ("ops"."sops"."code" NOT LIKE 'LEGACY-%' OR "ops"."sops"."legacy_source" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."staff_profiles" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"employment_type" text DEFAULT 'not_recorded' NOT NULL,
	"role_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_employment_check" CHECK ("ops"."staff_profiles"."employment_type" IN ('full_time', 'part_time', 'contract', 'visiting', 'not_recorded'))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_dependencies" (
	"task_id" uuid NOT NULL,
	"blocked_by_task_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_pkey" PRIMARY KEY("task_id","blocked_by_task_id"),
	CONSTRAINT "task_dependencies_not_self" CHECK ("ops"."task_dependencies"."task_id" <> "ops"."task_dependencies"."blocked_by_task_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"department_id" uuid,
	"owner_staff_id" uuid,
	"accountable_staff_id" uuid,
	"backup_staff_id" uuid,
	"due_date" date,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_since" timestamp with time zone,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"completion_note" text,
	"evidence_link" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"blocker_override_reason" text,
	"lead_id" uuid,
	"admission_id" uuid,
	"sop_id" uuid,
	"decision_id" uuid,
	"project_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_code_format" CHECK ("ops"."tasks"."code" ~ '^(TSK-[0-9]{5}|LEGACY-[A-Z0-9-]+)$'),
	CONSTRAINT "tasks_status_check" CHECK ("ops"."tasks"."status" IN ('not_started', 'in_progress', 'waiting', 'at_risk', 'blocked', 'completed', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK ("ops"."tasks"."priority" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "tasks_escalation_level_check" CHECK ("ops"."tasks"."escalation_level" BETWEEN 1 AND 4),
	CONSTRAINT "tasks_completed_needs_evidence" CHECK ("ops"."tasks"."status" <> 'completed' OR ("ops"."tasks"."completed_at" IS NOT NULL AND ("ops"."tasks"."completion_note" IS NOT NULL OR "ops"."tasks"."evidence_link" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "ops"."work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"function" text NOT NULL,
	"process" text NOT NULL,
	"scope" text,
	"proposed_role" text,
	"status" text NOT NULL,
	"legacy_status" text,
	"legacy_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_status_check" CHECK ("ops"."work_items"."status" IN ('approved', 'documented', 'planned', 'proposed', 'open'))
);
--> statement-breakpoint
CREATE TABLE "ops"."asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"assigned_on" date NOT NULL,
	"expected_return_on" date,
	"returned_at" timestamp with time zone,
	"condition_on_return" text,
	"notes" text,
	"assigned_by" uuid NOT NULL,
	"returned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_assignments_return_consistent" CHECK (("ops"."asset_assignments"."returned_at" IS NULL) = ("ops"."asset_assignments"."returned_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"serial_number" text,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_code_format" CHECK ("ops"."assets"."code" ~ '^AST-[0-9]{5}$'),
	CONSTRAINT "assets_status_check" CHECK ("ops"."assets"."status" IN ('available', 'assigned', 'in_repair', 'retired', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "ops"."compensation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_records_status_check" CHECK ("ops"."compensation_records"."status" IN ('draft', 'approved', 'superseded', 'cancelled')),
	CONSTRAINT "compensation_records_basis_check" CHECK ("ops"."compensation_records"."basis" IN ('monthly', 'annual', 'hourly')),
	CONSTRAINT "compensation_records_currency_check" CHECK ("ops"."compensation_records"."currency" = 'INR'),
	CONSTRAINT "compensation_records_amount_check" CHECK ("ops"."compensation_records"."amount_paise" >= 0),
	CONSTRAINT "compensation_records_dates_order" CHECK ("ops"."compensation_records"."effective_to" IS NULL OR "ops"."compensation_records"."effective_to" >= "ops"."compensation_records"."effective_from"),
	CONSTRAINT "compensation_records_approval_consistent" CHECK (("ops"."compensation_records"."status" IN ('draft', 'cancelled')) = ("ops"."compensation_records"."approved_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."department_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text,
	"assigned_by" uuid NOT NULL,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_heads_dates_order" CHECK ("ops"."department_heads"."ends_on" IS NULL OR "ops"."department_heads"."ends_on" >= "ops"."department_heads"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "ops"."emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"storage_kind" text NOT NULL,
	"storage_key" text,
	"external_reference" text,
	"content_type" text,
	"size_bytes" integer,
	"sha256" text,
	"retention_class" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_on" date,
	"superseded_by_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"deletion_requested_by" uuid,
	"deletion_requested_at" timestamp with time zone,
	"deletion_reason" text,
	"deletion_decided_by" uuid,
	"deletion_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_documents_kind_check" CHECK ("ops"."employee_documents"."kind" IN ('agreement', 'identification_reference', 'qualification', 'certificate', 'policy_acknowledgement', 'onboarding', 'training', 'performance_review', 'other')),
	CONSTRAINT "employee_documents_status_check" CHECK ("ops"."employee_documents"."status" IN ('active', 'superseded', 'retention_hold', 'deletion_requested', 'deleted')),
	CONSTRAINT "employee_documents_retention_check" CHECK ("ops"."employee_documents"."retention_class" IN ('employment_record', 'identity', 'training', 'general')),
	CONSTRAINT "employee_documents_storage_check" CHECK (("ops"."employee_documents"."storage_kind" = 'reference' AND "ops"."employee_documents"."external_reference" IS NOT NULL AND "ops"."employee_documents"."storage_key" IS NULL) OR ("ops"."employee_documents"."storage_kind" = 'stored' AND "ops"."employee_documents"."storage_key" IS NOT NULL AND "ops"."employee_documents"."sha256" IS NOT NULL)),
	CONSTRAINT "employee_documents_sha256_format" CHECK ("ops"."employee_documents"."sha256" IS NULL OR "ops"."employee_documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "employee_documents_size_check" CHECK ("ops"."employee_documents"."size_bytes" IS NULL OR "ops"."employee_documents"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."employee_identity_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last4" text,
	"document_id" uuid,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_identity_references_kind_check" CHECK ("ops"."employee_identity_references"."kind" IN ('aadhaar', 'pan', 'passport', 'voter_id', 'driving_licence', 'other')),
	CONSTRAINT "employee_identity_references_last4_format" CHECK ("ops"."employee_identity_references"."last4" IS NULL OR "ops"."employee_identity_references"."last4" ~ '^[A-Z0-9]{1,4}$'),
	CONSTRAINT "employee_identity_references_status_check" CHECK ("ops"."employee_identity_references"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."employee_private_details" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"personal_email" text,
	"personal_phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."employee_records" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"legal_name" text,
	"work_email" text,
	"work_phone" text,
	"work_location" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"employment_status" text DEFAULT 'onboarding' NOT NULL,
	"employment_start_date" date,
	"employment_end_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_records_code_format" CHECK ("ops"."employee_records"."employee_code" ~ '^EMP-[0-9]{4}$'),
	CONSTRAINT "employee_records_work_email_lowercase" CHECK ("ops"."employee_records"."work_email" IS NULL OR "ops"."employee_records"."work_email" = lower("ops"."employee_records"."work_email")),
	CONSTRAINT "employee_records_status_check" CHECK ("ops"."employee_records"."employment_status" IN ('onboarding', 'active', 'on_notice', 'separated')),
	CONSTRAINT "employee_records_dates_order" CHECK ("ops"."employee_records"."employment_end_date" IS NULL OR "ops"."employee_records"."employment_start_date" IS NULL OR "ops"."employee_records"."employment_end_date" >= "ops"."employee_records"."employment_start_date")
);
--> statement-breakpoint
CREATE TABLE "ops"."employment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"effective_on" date NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_history_field_check" CHECK ("ops"."employment_history"."field" IN ('department', 'title', 'manager', 'employment_type', 'employment_status'))
);
--> statement-breakpoint
CREATE TABLE "ops"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"source" text NOT NULL,
	"source_detail" text,
	"recruiter_staff_id" uuid,
	"privacy_notice_at" timestamp with time zone,
	"consent_note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"anonymised_at" timestamp with time zone,
	"anonymised_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_code_format" CHECK ("ops"."candidates"."code" ~ '^CAND-[0-9]{5}$'),
	CONSTRAINT "candidates_source_check" CHECK ("ops"."candidates"."source" IN ('referral', 'job_portal', 'website', 'walk_in', 'social_media', 'agency', 'campus', 'internal', 'other')),
	CONSTRAINT "candidates_status_check" CHECK ("ops"."candidates"."status" IN ('active', 'anonymised')),
	CONSTRAINT "candidates_email_lowercase" CHECK ("ops"."candidates"."email" IS NULL OR "ops"."candidates"."email" = lower("ops"."candidates"."email")),
	CONSTRAINT "candidates_anonymised_consistent" CHECK (("ops"."candidates"."status" = 'anonymised') = ("ops"."candidates"."anonymised_at" IS NOT NULL)),
	CONSTRAINT "candidates_anonymised_no_contacts" CHECK ("ops"."candidates"."status" <> 'anonymised' OR ("ops"."candidates"."email" IS NULL AND "ops"."candidates"."phone" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."interview_panelists" (
	"interview_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"recommendation" text,
	"feedback_notes" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_panelists_pkey" PRIMARY KEY("interview_id","staff_id"),
	CONSTRAINT "interview_panelists_recommendation_check" CHECK ("ops"."interview_panelists"."recommendation" IS NULL OR "ops"."interview_panelists"."recommendation" IN ('strong_hire', 'hire', 'no_hire', 'strong_no_hire')),
	CONSTRAINT "interview_panelists_feedback_consistent" CHECK (("ops"."interview_panelists"."submitted_at" IS NULL) = ("ops"."interview_panelists"."recommendation" IS NULL) AND ("ops"."interview_panelists"."submitted_at" IS NULL) = ("ops"."interview_panelists"."submitted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"mode" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interviews_mode_check" CHECK ("ops"."interviews"."mode" IN ('in_person', 'video', 'phone')),
	CONSTRAINT "interviews_status_check" CHECK ("ops"."interviews"."status" IN ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "interviews_duration_check" CHECK ("ops"."interviews"."duration_minutes" BETWEEN 5 AND 480)
);
--> statement-breakpoint
CREATE TABLE "ops"."job_application_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_application_stages_to_check" CHECK ("ops"."job_application_stages"."to_stage" IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "ops"."job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"requisition_id" uuid NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"stage_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"employee_staff_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_stage_check" CHECK ("ops"."job_applications"."stage" IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
	CONSTRAINT "job_applications_closed_consistent" CHECK (("ops"."job_applications"."stage" IN ('hired', 'rejected', 'withdrawn')) = ("ops"."job_applications"."closed_at" IS NOT NULL)),
	CONSTRAINT "job_applications_hired_has_employee" CHECK ("ops"."job_applications"."stage" <> 'hired' OR "ops"."job_applications"."employee_staff_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"offered_title" text NOT NULL,
	"proposed_start_date" date,
	"valid_until" date,
	"compensation_reference" text,
	"notes" text,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"extended_by" uuid,
	"extended_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offers_status_check" CHECK ("ops"."job_offers"."status" IN ('draft', 'approved', 'extended', 'accepted', 'declined', 'withdrawn', 'expired')),
	CONSTRAINT "job_offers_not_self_approved" CHECK ("ops"."job_offers"."approved_by" IS NULL OR "ops"."job_offers"."approved_by" <> "ops"."job_offers"."prepared_by"),
	CONSTRAINT "job_offers_approved_consistent" CHECK (("ops"."job_offers"."approved_by" IS NULL) = ("ops"."job_offers"."approved_at" IS NULL)),
	CONSTRAINT "job_offers_approved_before_extended" CHECK ("ops"."job_offers"."status" NOT IN ('approved', 'extended', 'accepted', 'declined') OR "ops"."job_offers"."approved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."lifecycle_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_reason" text,
	"application_id" uuid,
	"separation_type" text,
	"notice_date" date,
	"last_working_day" date,
	"separation_reason" text,
	"settlement_reference" text,
	"opened_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_comment" text,
	"completed_at" timestamp with time zone,
	"separated_at" timestamp with time zone,
	"separation_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_cases_code_format" CHECK ("ops"."lifecycle_cases"."code" ~ '^HRC-[0-9]{5}$'),
	CONSTRAINT "lifecycle_cases_kind_check" CHECK ("ops"."lifecycle_cases"."kind" IN ('onboarding', 'offboarding')),
	CONSTRAINT "lifecycle_cases_status_check" CHECK ("ops"."lifecycle_cases"."status" IN ('open', 'approved', 'completed', 'cancelled')),
	CONSTRAINT "lifecycle_cases_separation_type_check" CHECK ("ops"."lifecycle_cases"."separation_type" IS NULL OR "ops"."lifecycle_cases"."separation_type" IN ('resignation', 'termination', 'contract_end', 'retirement', 'other')),
	CONSTRAINT "lifecycle_cases_offboarding_fields" CHECK ("ops"."lifecycle_cases"."kind" <> 'offboarding' OR ("ops"."lifecycle_cases"."separation_type" IS NOT NULL AND "ops"."lifecycle_cases"."last_working_day" IS NOT NULL)),
	CONSTRAINT "lifecycle_cases_onboarding_fields" CHECK ("ops"."lifecycle_cases"."kind" <> 'onboarding' OR ("ops"."lifecycle_cases"."separation_type" IS NULL AND "ops"."lifecycle_cases"."last_working_day" IS NULL AND "ops"."lifecycle_cases"."separation_reason" IS NULL)),
	CONSTRAINT "lifecycle_cases_notice_before_lwd" CHECK ("ops"."lifecycle_cases"."notice_date" IS NULL OR "ops"."lifecycle_cases"."last_working_day" IS NULL OR "ops"."lifecycle_cases"."notice_date" <= "ops"."lifecycle_cases"."last_working_day"),
	CONSTRAINT "lifecycle_cases_approved_consistent" CHECK (("ops"."lifecycle_cases"."approved_by" IS NULL) = ("ops"."lifecycle_cases"."approved_at" IS NULL)),
	CONSTRAINT "lifecycle_cases_onboarding_only_open_completed" CHECK ("ops"."lifecycle_cases"."kind" <> 'onboarding' OR "ops"."lifecycle_cases"."status" <> 'approved')
);
--> statement-breakpoint
CREATE TABLE "ops"."lifecycle_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"assignee_staff_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" text,
	"notes" text,
	"asset_assignment_id" uuid,
	"transfer_entity_type" text,
	"transfer_entity_id" uuid,
	"transfer_target_staff_id" uuid,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"last_reminded_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_items_kind_check" CHECK ("ops"."lifecycle_items"."kind" IN ('document', 'policy_ack', 'org_confirmation', 'asset_assignment', 'access_request', 'induction', 'asset_return', 'access_revocation', 'ownership_transfer', 'final_settlement', 'exit_interview', 'custom')),
	CONSTRAINT "lifecycle_items_status_check" CHECK ("ops"."lifecycle_items"."status" IN ('pending', 'done', 'not_applicable', 'blocked')),
	CONSTRAINT "lifecycle_items_transfer_type_check" CHECK ("ops"."lifecycle_items"."transfer_entity_type" IS NULL OR "ops"."lifecycle_items"."transfer_entity_type" IN ('task', 'lead', 'admission', 'responsibility')),
	CONSTRAINT "lifecycle_items_transfer_consistent" CHECK (("ops"."lifecycle_items"."transfer_entity_type" IS NULL) = ("ops"."lifecycle_items"."transfer_entity_id" IS NULL)),
	CONSTRAINT "lifecycle_items_done_has_completion" CHECK ("ops"."lifecycle_items"."status" <> 'done' OR "ops"."lifecycle_items"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"role_description" text,
	"openings" integer DEFAULT 1 NOT NULL,
	"employment_type" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recruiter_staff_id" uuid,
	"hiring_manager_staff_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requisitions_code_format" CHECK ("ops"."requisitions"."code" ~ '^REQ-[0-9]{4}$'),
	CONSTRAINT "requisitions_status_check" CHECK ("ops"."requisitions"."status" IN ('draft', 'open', 'on_hold', 'filled', 'cancelled')),
	CONSTRAINT "requisitions_employment_type_check" CHECK ("ops"."requisitions"."employment_type" IN ('full_time', 'part_time', 'contract', 'visiting')),
	CONSTRAINT "requisitions_openings_check" CHECK ("ops"."requisitions"."openings" BETWEEN 1 AND 500),
	CONSTRAINT "requisitions_approved_consistent" CHECK (("ops"."requisitions"."approved_by" IS NULL) = ("ops"."requisitions"."approved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_breaks_order" CHECK ("ops"."attendance_breaks"."end_at" IS NULL OR "ops"."attendance_breaks"."end_at" > "ops"."attendance_breaks"."start_at")
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"session_id" uuid,
	"work_date" date NOT NULL,
	"proposed_clock_in_at" timestamp with time zone NOT NULL,
	"proposed_clock_out_at" timestamp with time zone NOT NULL,
	"proposed_break_minutes" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"resulting_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_code_format" CHECK ("ops"."attendance_corrections"."code" ~ '^ATC-[0-9]{6}$'),
	CONSTRAINT "attendance_corrections_order" CHECK ("ops"."attendance_corrections"."proposed_clock_out_at" > "ops"."attendance_corrections"."proposed_clock_in_at"),
	CONSTRAINT "attendance_corrections_status_check" CHECK ("ops"."attendance_corrections"."status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "attendance_corrections_decided_consistent" CHECK (("ops"."attendance_corrections"."status" IN ('approved', 'rejected')) = ("ops"."attendance_corrections"."decided_by" IS NOT NULL)),
	CONSTRAINT "attendance_corrections_result_consistent" CHECK (("ops"."attendance_corrections"."status" = 'approved') = ("ops"."attendance_corrections"."resulting_session_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_sha256" text NOT NULL,
	"file_name" text,
	"total_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"invalid_rows" integer NOT NULL,
	"created_sessions" integer NOT NULL,
	"row_errors" jsonb NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_imports_sha_format" CHECK ("ops"."attendance_imports"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "attendance_imports_counts" CHECK ("ops"."attendance_imports"."valid_rows" + "ops"."attendance_imports"."invalid_rows" = "ops"."attendance_imports"."total_rows" AND "ops"."attendance_imports"."created_sessions" <= "ops"."attendance_imports"."valid_rows")
);
--> statement-breakpoint
CREATE TABLE "ops"."attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"shift_template_id" uuid,
	"late_minutes" integer,
	"early_departure_minutes" integer,
	"missing_clock_out_flagged_at" timestamp with time zone,
	"reason" text,
	"import_id" uuid,
	"correction_id" uuid,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_order" CHECK ("ops"."attendance_sessions"."clock_out_at" IS NULL OR "ops"."attendance_sessions"."clock_out_at" > "ops"."attendance_sessions"."clock_in_at"),
	CONSTRAINT "attendance_sessions_open_consistent" CHECK (("ops"."attendance_sessions"."status" = 'open') = ("ops"."attendance_sessions"."clock_out_at" IS NULL) OR "ops"."attendance_sessions"."status" = 'superseded'),
	CONSTRAINT "attendance_sessions_superseded_consistent" CHECK (("ops"."attendance_sessions"."status" = 'superseded') = ("ops"."attendance_sessions"."superseded_at" IS NOT NULL)),
	CONSTRAINT "attendance_sessions_break_range" CHECK ("ops"."attendance_sessions"."break_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "attendance_sessions_source_check" CHECK ("ops"."attendance_sessions"."source" IN ('self', 'manual', 'csv_import', 'provider', 'correction')),
	CONSTRAINT "attendance_sessions_status_check" CHECK ("ops"."attendance_sessions"."status" IN ('open', 'closed', 'superseded')),
	CONSTRAINT "attendance_sessions_manual_reason" CHECK ("ops"."attendance_sessions"."source" <> 'manual' OR length(trim(coalesce("ops"."attendance_sessions"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_status_check" CHECK ("ops"."holidays"."status" IN ('proposed', 'approved', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"period_label" text,
	"effective_date" date NOT NULL,
	"leave_request_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_type_check" CHECK ("ops"."leave_ledger_entries"."entry_type" IN ('allocation', 'adjustment', 'usage', 'reversal')),
	CONSTRAINT "leave_ledger_sign" CHECK (("ops"."leave_ledger_entries"."entry_type" = 'usage' AND "ops"."leave_ledger_entries"."days" <= 0) OR ("ops"."leave_ledger_entries"."entry_type" IN ('allocation', 'reversal') AND "ops"."leave_ledger_entries"."days" >= 0) OR "ops"."leave_ledger_entries"."entry_type" = 'adjustment'),
	CONSTRAINT "leave_ledger_request_link" CHECK ("ops"."leave_ledger_entries"."entry_type" NOT IN ('usage', 'reversal') OR "ops"."leave_ledger_entries"."leave_request_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_part" text DEFAULT 'full' NOT NULL,
	"end_part" text DEFAULT 'full' NOT NULL,
	"working_days" numeric(6, 1) NOT NULL,
	"reason" text,
	"document_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_code_format" CHECK ("ops"."leave_requests"."code" ~ '^LVR-[0-9]{6}$'),
	CONSTRAINT "leave_requests_dates_order" CHECK ("ops"."leave_requests"."end_date" >= "ops"."leave_requests"."start_date"),
	CONSTRAINT "leave_requests_status_check" CHECK ("ops"."leave_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_start_part_check" CHECK ("ops"."leave_requests"."start_part" IN ('full', 'first_half', 'second_half')),
	CONSTRAINT "leave_requests_end_part_check" CHECK ("ops"."leave_requests"."end_part" IN ('full', 'first_half', 'second_half')),
	CONSTRAINT "leave_requests_parts_consistent" CHECK (("ops"."leave_requests"."start_date" = "ops"."leave_requests"."end_date" AND "ops"."leave_requests"."start_part" = "ops"."leave_requests"."end_part") OR ("ops"."leave_requests"."start_date" < "ops"."leave_requests"."end_date" AND "ops"."leave_requests"."start_part" IN ('full', 'second_half') AND "ops"."leave_requests"."end_part" IN ('full', 'first_half'))),
	CONSTRAINT "leave_requests_days_nonneg" CHECK ("ops"."leave_requests"."working_days" >= 0),
	CONSTRAINT "leave_requests_cancel_consistent" CHECK (("ops"."leave_requests"."status" = 'cancelled') = ("ops"."leave_requests"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean NOT NULL,
	"half_day_allowed" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"description" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_code_format" CHECK ("ops"."leave_types"."code" ~ '^[A-Z][A-Z0-9_]{1,15}$'),
	CONSTRAINT "leave_types_status_check" CHECK ("ops"."leave_types"."status" IN ('proposed', 'approved', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"shift_template_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_dates_order" CHECK ("ops"."shift_assignments"."to_date" IS NULL OR "ops"."shift_assignments"."to_date" >= "ops"."shift_assignments"."from_date"),
	CONSTRAINT "shift_assignments_status_check" CHECK ("ops"."shift_assignments"."status" IN ('active', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ops"."shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"unpaid_break_minutes" integer DEFAULT 0 NOT NULL,
	"working_weekdays" jsonb NOT NULL,
	"location" text,
	"department_id" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_code_format" CHECK ("ops"."shift_templates"."code" ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
	CONSTRAINT "shift_templates_start_format" CHECK ("ops"."shift_templates"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_templates_end_format" CHECK ("ops"."shift_templates"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_templates_midnight_consistent" CHECK (("ops"."shift_templates"."crosses_midnight" AND "ops"."shift_templates"."end_time" <= "ops"."shift_templates"."start_time") OR (NOT "ops"."shift_templates"."crosses_midnight" AND "ops"."shift_templates"."end_time" > "ops"."shift_templates"."start_time")),
	CONSTRAINT "shift_templates_break_range" CHECK ("ops"."shift_templates"."unpaid_break_minutes" BETWEEN 0 AND 600),
	CONSTRAINT "shift_templates_status_check" CHECK ("ops"."shift_templates"."status" IN ('proposed', 'approved', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "ops"."policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"area" text NOT NULL,
	"summary" text,
	"accountable_staff_id" uuid,
	"owner_decision_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"retired_at" timestamp with time zone,
	"retired_by" uuid,
	"retired_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_code_format" CHECK ("ops"."policies"."code" ~ '^POL-[0-9]{4}$'),
	CONSTRAINT "policies_area_check" CHECK ("ops"."policies"."area" IN ('attendance', 'working_hours', 'shifts', 'leave', 'holidays', 'compensation', 'recruitment', 'onboarding_offboarding', 'employee_records', 'data_protection', 'document_retention', 'admissions_students', 'fees_refunds', 'health_safety', 'other')),
	CONSTRAINT "policies_status_check" CHECK ("ops"."policies"."status" IN ('draft', 'proposed', 'approved', 'retired')),
	CONSTRAINT "policies_owner_decision_format" CHECK ("ops"."policies"."owner_decision_ref" IS NULL OR "ops"."policies"."owner_decision_ref" ~ '^OD-[0-9]{3}$'),
	CONSTRAINT "policies_retired_consistency" CHECK (("ops"."policies"."status" = 'retired') = ("ops"."policies"."retired_at" IS NOT NULL AND "ops"."policies"."retired_by" IS NOT NULL AND "ops"."policies"."retired_reason" IS NOT NULL)),
	CONSTRAINT "policies_approved_has_version" CHECK ("ops"."policies"."status" <> 'approved' OR "ops"."policies"."approved_version_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ops"."policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requirement_text" text DEFAULT '' NOT NULL,
	"source_reference" text,
	"linked_setting_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"effective_date" date,
	"next_review_date" date,
	"change_note" text,
	"approval_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "policy_versions_number_positive" CHECK ("ops"."policy_versions"."version_number" >= 1),
	CONSTRAINT "policy_versions_status_check" CHECK ("ops"."policy_versions"."status" IN ('draft', 'proposed', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "policy_versions_review_after_effective" CHECK ("ops"."policy_versions"."next_review_date" IS NULL OR "ops"."policy_versions"."effective_date" IS NULL OR "ops"."policy_versions"."next_review_date" >= "ops"."policy_versions"."effective_date"),
	CONSTRAINT "policy_versions_proposed_consistency" CHECK ("ops"."policy_versions"."status" = 'draft' OR ("ops"."policy_versions"."proposed_by" IS NOT NULL AND "ops"."policy_versions"."proposed_at" IS NOT NULL)),
	CONSTRAINT "policy_versions_decided_consistency" CHECK ("ops"."policy_versions"."status" NOT IN ('approved', 'rejected') OR ("ops"."policy_versions"."decided_by" IS NOT NULL AND "ops"."policy_versions"."decided_at" IS NOT NULL)),
	CONSTRAINT "policy_versions_no_self_approval" CHECK ("ops"."policy_versions"."decided_by" IS NULL OR "ops"."policy_versions"."proposed_by" IS NULL OR "ops"."policy_versions"."decided_by" <> "ops"."policy_versions"."proposed_by")
);
--> statement-breakpoint
CREATE TABLE "ops"."risk_mitigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"action" text NOT NULL,
	"owner_staff_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"outcome" text,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_mitigations_status_check" CHECK ("ops"."risk_mitigations"."status" IN ('planned', 'in_progress', 'done', 'dropped')),
	CONSTRAINT "risk_mitigations_done_has_date" CHECK ("ops"."risk_mitigations"."status" <> 'done' OR "ops"."risk_mitigations"."completed_at" IS NOT NULL),
	CONSTRAINT "risk_mitigations_dropped_has_outcome" CHECK ("ops"."risk_mitigations"."status" <> 'dropped' OR length(btrim(coalesce("ops"."risk_mitigations"."outcome", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_ack_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"audience_type" text NOT NULL,
	"department_id" uuid,
	"role" text,
	"due_date" date,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_reason" text,
	CONSTRAINT "sop_ack_requirements_audience_check" CHECK ("ops"."sop_ack_requirements"."audience_type" IN ('department', 'role')),
	CONSTRAINT "sop_ack_requirements_audience_target" CHECK (("ops"."sop_ack_requirements"."audience_type" = 'department' AND "ops"."sop_ack_requirements"."department_id" IS NOT NULL AND "ops"."sop_ack_requirements"."role" IS NULL) OR ("ops"."sop_ack_requirements"."audience_type" = 'role' AND "ops"."sop_ack_requirements"."role" IS NOT NULL AND "ops"."sop_ack_requirements"."department_id" IS NULL)),
	CONSTRAINT "sop_ack_requirements_withdrawn_consistency" CHECK (("ops"."sop_ack_requirements"."withdrawn_at" IS NULL AND "ops"."sop_ack_requirements"."withdrawn_by" IS NULL AND "ops"."sop_ack_requirements"."withdrawn_reason" IS NULL) OR ("ops"."sop_ack_requirements"."withdrawn_at" IS NOT NULL AND "ops"."sop_ack_requirements"."withdrawn_by" IS NOT NULL AND "ops"."sop_ack_requirements"."withdrawn_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"staff_id" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_archives" (
	"sop_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"archived_by" uuid NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."sop_version_schedules" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"effective_date" date NOT NULL,
	"next_review_date" date,
	"set_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_version_schedules_review_after_effective" CHECK ("ops"."sop_version_schedules"."next_review_date" IS NULL OR "ops"."sop_version_schedules"."next_review_date" >= "ops"."sop_version_schedules"."effective_date")
);
--> statement-breakpoint
CREATE TABLE "ops"."task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	CONSTRAINT "task_comments_body_not_blank" CHECK (length(btrim("ops"."task_comments"."body")) > 0),
	CONSTRAINT "task_comments_hidden_consistency" CHECK (("ops"."task_comments"."hidden_at" IS NULL AND "ops"."task_comments"."hidden_by" IS NULL AND "ops"."task_comments"."hidden_reason" IS NULL) OR ("ops"."task_comments"."hidden_at" IS NOT NULL AND "ops"."task_comments"."hidden_by" IS NOT NULL AND length(btrim("ops"."task_comments"."hidden_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text DEFAULT 'document' NOT NULL,
	"label" text NOT NULL,
	"location" text NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_reason" text,
	CONSTRAINT "task_references_kind_check" CHECK ("ops"."task_references"."kind" IN ('document', 'evidence', 'other')),
	CONSTRAINT "task_references_removed_consistency" CHECK (("ops"."task_references"."removed_at" IS NULL AND "ops"."task_references"."removed_by" IS NULL AND "ops"."task_references"."removed_reason" IS NULL) OR ("ops"."task_references"."removed_at" IS NOT NULL AND "ops"."task_references"."removed_by" IS NOT NULL AND "ops"."task_references"."removed_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ops"."task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_date" date NOT NULL,
	"recipient_count" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminders_kind_check" CHECK ("ops"."task_reminders"."kind" IN ('due_soon', 'overdue')),
	CONSTRAINT "task_reminders_recipients_check" CHECK ("ops"."task_reminders"."recipient_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."task_review_requirements" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"reviewer_staff_id" uuid,
	"note" text,
	"required_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewer_staff_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "task_reviews_status_check" CHECK ("ops"."task_reviews"."status" IN ('pending', 'accepted', 'returned')),
	CONSTRAINT "task_reviews_cycle_positive" CHECK ("ops"."task_reviews"."cycle" >= 1),
	CONSTRAINT "task_reviews_decision_consistency" CHECK (("ops"."task_reviews"."status" = 'pending' AND "ops"."task_reviews"."decided_by" IS NULL AND "ops"."task_reviews"."decided_at" IS NULL) OR ("ops"."task_reviews"."status" <> 'pending' AND "ops"."task_reviews"."decided_by" IS NOT NULL AND "ops"."task_reviews"."decided_at" IS NOT NULL)),
	CONSTRAINT "task_reviews_returned_has_note" CHECK ("ops"."task_reviews"."status" <> 'returned' OR length(btrim(coalesce("ops"."task_reviews"."decision_note", ''))) > 0),
	CONSTRAINT "task_reviews_no_self_review" CHECK ("ops"."task_reviews"."decided_by" IS NULL OR "ops"."task_reviews"."decided_by" <> "ops"."task_reviews"."submitted_by")
);
--> statement-breakpoint
ALTER TABLE "core"."approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."integration_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."staff_members" ADD CONSTRAINT "staff_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."staff_members" ADD CONSTRAINT "staff_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."staff_members" ADD CONSTRAINT "staff_members_manager_id_staff_members_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_assets" ADD CONSTRAINT "content_assets_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_assignments" ADD CONSTRAINT "content_assignments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_assignments" ADD CONSTRAINT "content_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_assignments" ADD CONSTRAINT "content_assignments_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_assignments" ADD CONSTRAINT "content_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_comments" ADD CONSTRAINT "content_comments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_comments" ADD CONSTRAINT "content_comments_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_comments" ADD CONSTRAINT "content_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_items" ADD CONSTRAINT "content_items_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "marketing"."ideas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_items" ADD CONSTRAINT "content_items_current_version_id_content_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_items" ADD CONSTRAINT "content_items_approved_version_id_content_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_items" ADD CONSTRAINT "content_items_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "core"."approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_items" ADD CONSTRAINT "content_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_reviews" ADD CONSTRAINT "content_reviews_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_reviews" ADD CONSTRAINT "content_reviews_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_reviews" ADD CONSTRAINT "content_reviews_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "core"."approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_versions" ADD CONSTRAINT "content_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."content_versions" ADD CONSTRAINT "content_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_imports" ADD CONSTRAINT "metric_imports_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "marketing"."social_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_imports" ADD CONSTRAINT "metric_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_snapshots" ADD CONSTRAINT "metric_snapshots_import_id_metric_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "marketing"."metric_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_snapshots" ADD CONSTRAINT "metric_snapshots_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "marketing"."social_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_snapshots" ADD CONSTRAINT "metric_snapshots_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "marketing"."placements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_snapshots" ADD CONSTRAINT "metric_snapshots_suggested_placement_id_placements_id_fk" FOREIGN KEY ("suggested_placement_id") REFERENCES "marketing"."placements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."metric_values" ADD CONSTRAINT "metric_values_snapshot_id_metric_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "marketing"."metric_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placement_groups" ADD CONSTRAINT "placement_groups_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "marketing"."ideas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placement_groups" ADD CONSTRAINT "placement_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "marketing"."ideas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "marketing"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "marketing"."social_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_placement_group_id_placement_groups_id_fk" FOREIGN KEY ("placement_group_id") REFERENCES "marketing"."placement_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "marketing"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."placements" ADD CONSTRAINT "placements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."publishing_attempts" ADD CONSTRAINT "publishing_attempts_record_id_publishing_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "marketing"."publishing_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."publishing_attempts" ADD CONSTRAINT "publishing_attempts_attempted_by_users_id_fk" FOREIGN KEY ("attempted_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."publishing_records" ADD CONSTRAINT "publishing_records_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "marketing"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."publishing_records" ADD CONSTRAINT "publishing_records_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "marketing"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."publishing_records" ADD CONSTRAINT "publishing_records_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."social_accounts" ADD CONSTRAINT "social_accounts_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."answer_keys" ADD CONSTRAINT "answer_keys_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."answer_keys" ADD CONSTRAINT "answer_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessment_sections" ADD CONSTRAINT "assessment_sections_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."assessments" ADD CONSTRAINT "assessments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attempts" ADD CONSTRAINT "attempts_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance" ADD CONSTRAINT "attendance_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance" ADD CONSTRAINT "attendance_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD CONSTRAINT "batches_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."batches" ADD CONSTRAINT "batches_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."calendar_exclusions" ADD CONSTRAINT "calendar_exclusions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."calendar_rules" ADD CONSTRAINT "calendar_rules_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "academic"."enrolments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_assigned_staff_id_staff_members_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."catchup_tasks" ADD CONSTRAINT "catchup_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."chapters" ADD CONSTRAINT "chapters_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."chapters" ADD CONSTRAINT "chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."chapters" ADD CONSTRAINT "chapters_alias_of_chapter_id_chapters_id_fk" FOREIGN KEY ("alias_of_chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_corrects_record_id_class_records_id_fk" FOREIGN KEY ("corrects_record_id") REFERENCES "academic"."class_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_records" ADD CONSTRAINT "class_records_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_planned_chapter_id_chapters_id_fk" FOREIGN KEY ("planned_chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_teacher_staff_id_staff_members_id_fk" FOREIGN KEY ("teacher_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "academic"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_rescheduled_from_session_id_class_sessions_id_fk" FOREIGN KEY ("rescheduled_from_session_id") REFERENCES "academic"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_sessions" ADD CONSTRAINT "class_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."courses" ADD CONSTRAINT "courses_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."curriculum_plans" ADD CONSTRAINT "curriculum_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."curriculum_plans" ADD CONSTRAINT "curriculum_plans_supersedes_plan_id_curriculum_plans_id_fk" FOREIGN KEY ("supersedes_plan_id") REFERENCES "academic"."curriculum_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."curriculum_plans" ADD CONSTRAINT "curriculum_plans_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."curriculum_plans" ADD CONSTRAINT "curriculum_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolment_intake_log" ADD CONSTRAINT "enrolment_intake_log_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolment_intake_log" ADD CONSTRAINT "enrolment_intake_log_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "academic"."enrolments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD CONSTRAINT "enrolments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD CONSTRAINT "enrolments_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD CONSTRAINT "enrolments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD CONSTRAINT "enrolments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."enrolments" ADD CONSTRAINT "enrolments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD CONSTRAINT "interventions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD CONSTRAINT "interventions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD CONSTRAINT "interventions_responsible_staff_id_staff_members_id_fk" FOREIGN KEY ("responsible_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."interventions" ADD CONSTRAINT "interventions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."plan_items" ADD CONSTRAINT "plan_items_plan_id_curriculum_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "academic"."curriculum_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."plan_items" ADD CONSTRAINT "plan_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "academic"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_runs" ADD CONSTRAINT "result_runs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_runs" ADD CONSTRAINT "result_runs_answer_key_id_answer_keys_id_fk" FOREIGN KEY ("answer_key_id") REFERENCES "academic"."answer_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."result_runs" ADD CONSTRAINT "result_runs_finalised_by_user_id_users_id_fk" FOREIGN KEY ("finalised_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_run_id_result_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "academic"."result_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "academic"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "academic"."attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."results" ADD CONSTRAINT "results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "academic"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."subjects" ADD CONSTRAINT "subjects_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "academic"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "academic"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "academic"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignments" ADD CONSTRAINT "teacher_assignments_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_checks" ADD CONSTRAINT "admission_checks_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_checks" ADD CONSTRAINT "admission_checks_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_transitions" ADD CONSTRAINT "admission_transitions_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_transitions" ADD CONSTRAINT "admission_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admission_transitions" ADD CONSTRAINT "admission_transitions_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."integration_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_counsellor_staff_id_staff_members_id_fk" FOREIGN KEY ("counsellor_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_last_request_event_id_integration_events_id_fk" FOREIGN KEY ("last_request_event_id") REFERENCES "core"."integration_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admissions" ADD CONSTRAINT "admissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."contact_preferences" ADD CONSTRAINT "contact_preferences_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."contact_preferences" ADD CONSTRAINT "contact_preferences_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_counsellor_staff_id_staff_members_id_fk" FOREIGN KEY ("counsellor_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_recommended_programme_id_programmes_id_fk" FOREIGN KEY ("recommended_programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."counselling_sessions" ADD CONSTRAINT "counselling_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."decisions" ADD CONSTRAINT "decisions_decided_by_staff_id_staff_members_id_fk" FOREIGN KEY ("decided_by_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."decisions" ADD CONSTRAINT "decisions_superseded_by_id_decisions_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ops"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."decisions" ADD CONSTRAINT "decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_teachers" ADD CONSTRAINT "demo_teachers_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "ops"."demos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demo_teachers" ADD CONSTRAINT "demo_teachers_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."demos" ADD CONSTRAINT "demos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."duplicate_flags" ADD CONSTRAINT "duplicate_flags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."duplicate_flags" ADD CONSTRAINT "duplicate_flags_matched_lead_id_leads_id_fk" FOREIGN KEY ("matched_lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."duplicate_flags" ADD CONSTRAINT "duplicate_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD CONSTRAINT "enquiries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD CONSTRAINT "enquiries_source_code_lead_sources_code_fk" FOREIGN KEY ("source_code") REFERENCES "ops"."lead_sources"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD CONSTRAINT "enquiries_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enquiries" ADD CONSTRAINT "enquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enrolment_attempts" ADD CONSTRAINT "enrolment_attempts_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enrolment_attempts" ADD CONSTRAINT "enrolment_attempts_request_event_id_integration_events_id_fk" FOREIGN KEY ("request_event_id") REFERENCES "core"."integration_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enrolment_attempts" ADD CONSTRAINT "enrolment_attempts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."enrolment_attempts" ADD CONSTRAINT "enrolment_attempts_reply_event_id_integration_events_id_fk" FOREIGN KEY ("reply_event_id") REFERENCES "core"."integration_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."escalations" ADD CONSTRAINT "escalations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."escalations" ADD CONSTRAINT "escalations_recipient_staff_id_staff_members_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."escalations" ADD CONSTRAINT "escalations_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."escalations" ADD CONSTRAINT "escalations_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."escalations" ADD CONSTRAINT "escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "ops"."demos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."fee_records" ADD CONSTRAINT "fee_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."follow_ups" ADD CONSTRAINT "follow_ups_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."follow_ups" ADD CONSTRAINT "follow_ups_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."follow_ups" ADD CONSTRAINT "follow_ups_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."follow_ups" ADD CONSTRAINT "follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."incidents" ADD CONSTRAINT "incidents_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."incidents" ADD CONSTRAINT "incidents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."incidents" ADD CONSTRAINT "incidents_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "ops"."sops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."incidents" ADD CONSTRAINT "incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD CONSTRAINT "lead_activities_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lead_activities" ADD CONSTRAINT "lead_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "core"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_merged_into_lead_id_leads_id_fk" FOREIGN KEY ("merged_into_lead_id") REFERENCES "ops"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."milestone_dependencies" ADD CONSTRAINT "milestone_dependencies_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "ops"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."milestone_dependencies" ADD CONSTRAINT "milestone_dependencies_depends_on_milestone_id_milestones_id_fk" FOREIGN KEY ("depends_on_milestone_id") REFERENCES "ops"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ops"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."milestones" ADD CONSTRAINT "milestones_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."onboarding_items" ADD CONSTRAINT "onboarding_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."projects" ADD CONSTRAINT "projects_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."responsibilities" ADD CONSTRAINT "responsibilities_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."responsibilities" ADD CONSTRAINT "responsibilities_holder_staff_id_staff_members_id_fk" FOREIGN KEY ("holder_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."responsibilities" ADD CONSTRAINT "responsibilities_backup_staff_id_staff_members_id_fk" FOREIGN KEY ("backup_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risks" ADD CONSTRAINT "risks_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risks" ADD CONSTRAINT "risks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risks" ADD CONSTRAINT "risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ops"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risks" ADD CONSTRAINT "risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_checklist_items" ADD CONSTRAINT "sop_checklist_items_version_id_sop_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_versions" ADD CONSTRAINT "sop_versions_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "ops"."sops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_versions" ADD CONSTRAINT "sop_versions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "core"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_versions" ADD CONSTRAINT "sop_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_versions" ADD CONSTRAINT "sop_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_versions" ADD CONSTRAINT "sop_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_reviewer_staff_id_staff_members_id_fk" FOREIGN KEY ("reviewer_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_backup_staff_id_staff_members_id_fk" FOREIGN KEY ("backup_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_current_version_id_sop_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_approved_version_id_sop_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sops" ADD CONSTRAINT "sops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."staff_profiles" ADD CONSTRAINT "staff_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_by_task_id_tasks_id_fk" FOREIGN KEY ("blocked_by_task_id") REFERENCES "ops"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_accountable_staff_id_staff_members_id_fk" FOREIGN KEY ("accountable_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_backup_staff_id_staff_members_id_fk" FOREIGN KEY ("backup_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "ops"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "ops"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "ops"."sops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "ops"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ops"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "ops"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."asset_assignments" ADD CONSTRAINT "asset_assignments_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."asset_assignments" ADD CONSTRAINT "asset_assignments_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."compensation_records" ADD CONSTRAINT "compensation_records_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."compensation_records" ADD CONSTRAINT "compensation_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."compensation_records" ADD CONSTRAINT "compensation_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."compensation_records" ADD CONSTRAINT "compensation_records_superseded_by_id_compensation_records_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ops"."compensation_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."department_heads" ADD CONSTRAINT "department_heads_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."department_heads" ADD CONSTRAINT "department_heads_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."department_heads" ADD CONSTRAINT "department_heads_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."department_heads" ADD CONSTRAINT "department_heads_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_documents" ADD CONSTRAINT "employee_documents_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_documents" ADD CONSTRAINT "employee_documents_superseded_by_id_employee_documents_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ops"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_documents" ADD CONSTRAINT "employee_documents_deletion_requested_by_users_id_fk" FOREIGN KEY ("deletion_requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_documents" ADD CONSTRAINT "employee_documents_deletion_decided_by_users_id_fk" FOREIGN KEY ("deletion_decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_identity_references" ADD CONSTRAINT "employee_identity_references_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_identity_references" ADD CONSTRAINT "employee_identity_references_document_id_employee_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "ops"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_identity_references" ADD CONSTRAINT "employee_identity_references_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_private_details" ADD CONSTRAINT "employee_private_details_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_private_details" ADD CONSTRAINT "employee_private_details_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_records" ADD CONSTRAINT "employee_records_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employee_records" ADD CONSTRAINT "employee_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employment_history" ADD CONSTRAINT "employment_history_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."employment_history" ADD CONSTRAINT "employment_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."candidates" ADD CONSTRAINT "candidates_recruiter_staff_id_staff_members_id_fk" FOREIGN KEY ("recruiter_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."candidates" ADD CONSTRAINT "candidates_anonymised_by_users_id_fk" FOREIGN KEY ("anonymised_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."candidates" ADD CONSTRAINT "candidates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."interview_panelists" ADD CONSTRAINT "interview_panelists_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "ops"."interviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."interview_panelists" ADD CONSTRAINT "interview_panelists_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."interview_panelists" ADD CONSTRAINT "interview_panelists_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."interviews" ADD CONSTRAINT "interviews_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."job_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."interviews" ADD CONSTRAINT "interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_application_stages" ADD CONSTRAINT "job_application_stages_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."job_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_application_stages" ADD CONSTRAINT "job_application_stages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_applications" ADD CONSTRAINT "job_applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "ops"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_applications" ADD CONSTRAINT "job_applications_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "ops"."requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_applications" ADD CONSTRAINT "job_applications_employee_staff_id_employee_records_staff_id_fk" FOREIGN KEY ("employee_staff_id") REFERENCES "ops"."employee_records"("staff_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_applications" ADD CONSTRAINT "job_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_offers" ADD CONSTRAINT "job_offers_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."job_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_offers" ADD CONSTRAINT "job_offers_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_offers" ADD CONSTRAINT "job_offers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."job_offers" ADD CONSTRAINT "job_offers_extended_by_users_id_fk" FOREIGN KEY ("extended_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_staff_id_employee_records_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "ops"."employee_records"("staff_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "ops"."job_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_cases" ADD CONSTRAINT "lifecycle_cases_separation_event_id_integration_events_id_fk" FOREIGN KEY ("separation_event_id") REFERENCES "core"."integration_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_items" ADD CONSTRAINT "lifecycle_items_case_id_lifecycle_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "ops"."lifecycle_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_items" ADD CONSTRAINT "lifecycle_items_assignee_staff_id_staff_members_id_fk" FOREIGN KEY ("assignee_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_items" ADD CONSTRAINT "lifecycle_items_asset_assignment_id_asset_assignments_id_fk" FOREIGN KEY ("asset_assignment_id") REFERENCES "ops"."asset_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_items" ADD CONSTRAINT "lifecycle_items_transfer_target_staff_id_staff_members_id_fk" FOREIGN KEY ("transfer_target_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lifecycle_items" ADD CONSTRAINT "lifecycle_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."requisitions" ADD CONSTRAINT "requisitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."requisitions" ADD CONSTRAINT "requisitions_recruiter_staff_id_staff_members_id_fk" FOREIGN KEY ("recruiter_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."requisitions" ADD CONSTRAINT "requisitions_hiring_manager_staff_id_staff_members_id_fk" FOREIGN KEY ("hiring_manager_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."requisitions" ADD CONSTRAINT "requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."requisitions" ADD CONSTRAINT "requisitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_breaks" ADD CONSTRAINT "attendance_breaks_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "ops"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_breaks" ADD CONSTRAINT "attendance_breaks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "ops"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_corrections" ADD CONSTRAINT "attendance_corrections_resulting_session_id_attendance_sessions_id_fk" FOREIGN KEY ("resulting_session_id") REFERENCES "ops"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_imports" ADD CONSTRAINT "attendance_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "ops"."shift_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_import_id_attendance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ops"."attendance_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_superseded_by_id_attendance_sessions_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ops"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."holidays" ADD CONSTRAINT "holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "ops"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "ops"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_requests" ADD CONSTRAINT "leave_requests_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "ops"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_requests" ADD CONSTRAINT "leave_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."leave_types" ADD CONSTRAINT "leave_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."shift_assignments" ADD CONSTRAINT "shift_assignments_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."shift_assignments" ADD CONSTRAINT "shift_assignments_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "ops"."shift_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."shift_assignments" ADD CONSTRAINT "shift_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."shift_templates" ADD CONSTRAINT "shift_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."shift_templates" ADD CONSTRAINT "shift_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policies" ADD CONSTRAINT "policies_accountable_staff_id_staff_members_id_fk" FOREIGN KEY ("accountable_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policies" ADD CONSTRAINT "policies_current_version_id_policy_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "ops"."policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policies" ADD CONSTRAINT "policies_approved_version_id_policy_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "ops"."policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policies" ADD CONSTRAINT "policies_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policies" ADD CONSTRAINT "policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "ops"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policy_versions" ADD CONSTRAINT "policy_versions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "core"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policy_versions" ADD CONSTRAINT "policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policy_versions" ADD CONSTRAINT "policy_versions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."policy_versions" ADD CONSTRAINT "policy_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risk_mitigations" ADD CONSTRAINT "risk_mitigations_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "ops"."risks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risk_mitigations" ADD CONSTRAINT "risk_mitigations_owner_staff_id_staff_members_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."risk_mitigations" ADD CONSTRAINT "risk_mitigations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_ack_requirements" ADD CONSTRAINT "sop_ack_requirements_version_id_sop_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_ack_requirements" ADD CONSTRAINT "sop_ack_requirements_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_ack_requirements" ADD CONSTRAINT "sop_ack_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_ack_requirements" ADD CONSTRAINT "sop_ack_requirements_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_acknowledgements" ADD CONSTRAINT "sop_acknowledgements_version_id_sop_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_acknowledgements" ADD CONSTRAINT "sop_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_acknowledgements" ADD CONSTRAINT "sop_acknowledgements_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_archives" ADD CONSTRAINT "sop_archives_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "ops"."sops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_archives" ADD CONSTRAINT "sop_archives_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_version_schedules" ADD CONSTRAINT "sop_version_schedules_version_id_sop_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ops"."sop_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sop_version_schedules" ADD CONSTRAINT "sop_version_schedules_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_comments" ADD CONSTRAINT "task_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_comments" ADD CONSTRAINT "task_comments_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_references" ADD CONSTRAINT "task_references_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_references" ADD CONSTRAINT "task_references_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_references" ADD CONSTRAINT "task_references_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_review_requirements" ADD CONSTRAINT "task_review_requirements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_review_requirements" ADD CONSTRAINT "task_review_requirements_reviewer_staff_id_staff_members_id_fk" FOREIGN KEY ("reviewer_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_review_requirements" ADD CONSTRAINT "task_review_requirements_required_by_users_id_fk" FOREIGN KEY ("required_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ops"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_reviewer_staff_id_staff_members_id_fk" FOREIGN KEY ("reviewer_staff_id") REFERENCES "core"."staff_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."task_reviews" ADD CONSTRAINT "task_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_subject_idx" ON "core"."approvals" USING btree ("subject_module","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "core"."approvals" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_subject" ON "core"."approvals" USING btree ("subject_module","subject_type","subject_id","policy") WHERE "core"."approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "core"."audit_events" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_module_at_idx" ON "core"."audit_events" USING btree ("module","at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "core"."audit_events" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_key" ON "core"."departments" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "event_deliveries_event_consumer_key" ON "core"."event_deliveries" USING btree ("event_id","consumer");--> statement-breakpoint
CREATE INDEX "event_deliveries_consumer_status_idx" ON "core"."event_deliveries" USING btree ("consumer","status");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "core"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_producer_key" ON "core"."integration_events" USING btree ("producer","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_events_type_idx" ON "core"."integration_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "integration_events_correlation_idx" ON "core"."integration_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "core"."notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "programmes_code_key" ON "core"."programmes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "core"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "core"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "core"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_user_id_key" ON "core"."staff_members" USING btree ("user_id") WHERE "core"."staff_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_members_department_idx" ON "core"."staff_members" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "staff_members_manager_idx" ON "core"."staff_members" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "core"."user_roles" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "core"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_code_key" ON "marketing"."campaigns" USING btree ("code");--> statement-breakpoint
CREATE INDEX "content_assets_version_idx" ON "marketing"."content_assets" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assignments_item_role_key" ON "marketing"."content_assignments" USING btree ("content_item_id","role");--> statement-breakpoint
CREATE INDEX "content_comments_item_idx" ON "marketing"."content_comments" USING btree ("content_item_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_idea_idx" ON "marketing"."content_items" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "content_items_state_idx" ON "marketing"."content_items" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_legacy_ref_key" ON "marketing"."content_items" USING btree ("legacy_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "content_reviews_approval_key" ON "marketing"."content_reviews" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "content_reviews_item_idx" ON "marketing"."content_reviews" USING btree ("content_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_rules_code_key" ON "marketing"."content_rules" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_item_number_key" ON "marketing"."content_versions" USING btree ("content_item_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ideas_code_key" ON "marketing"."ideas" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ideas_legacy_ref_key" ON "marketing"."ideas" USING btree ("legacy_ref");--> statement-breakpoint
CREATE INDEX "ideas_course_status_idx" ON "marketing"."ideas" USING btree ("course_prefix","status");--> statement-breakpoint
CREATE INDEX "ideas_normalized_title_idx" ON "marketing"."ideas" USING btree ("normalized_title");--> statement-breakpoint
CREATE UNIQUE INDEX "ideas_course_title_key" ON "marketing"."ideas" USING btree ("course_prefix","normalized_title");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_conflicts_code_key" ON "marketing"."legacy_conflicts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_imports_file_account_key" ON "marketing"."metric_imports" USING btree ("account_id","file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_capture_key" ON "marketing"."metric_snapshots" USING btree ("account_id","post_key","captured_at","source");--> statement-breakpoint
CREATE INDEX "metric_snapshots_placement_idx" ON "marketing"."metric_snapshots" USING btree ("placement_id");--> statement-breakpoint
CREATE INDEX "metric_snapshots_account_published_idx" ON "marketing"."metric_snapshots" USING btree ("account_id","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_values_snapshot_metric_key" ON "marketing"."metric_values" USING btree ("snapshot_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "placement_groups_code_key" ON "marketing"."placement_groups" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_code_key" ON "marketing"."placements" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_legacy_ref_key" ON "marketing"."placements" USING btree ("legacy_ref");--> statement-breakpoint
CREATE INDEX "placements_account_schedule_idx" ON "marketing"."placements" USING btree ("account_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "placements_status_schedule_idx" ON "marketing"."placements" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "placements_content_item_idx" ON "marketing"."placements" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "placements_published_url_idx" ON "marketing"."placements" USING btree ("published_url");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_settings_key_key" ON "marketing"."policy_settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_attempts_record_number_key" ON "marketing"."publishing_attempts" USING btree ("record_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_records_idempotency_key" ON "marketing"."publishing_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_records_one_active_per_placement" ON "marketing"."publishing_records" USING btree ("placement_id") WHERE "marketing"."publishing_records"."status" IN ('pending', 'succeeded');--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_code_key" ON "marketing"."social_accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_keys_version_key" ON "academic"."answer_keys" USING btree ("assessment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_sections_code_key" ON "academic"."assessment_sections" USING btree ("assessment_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_code_key" ON "academic"."assessments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "assessments_batch_date_idx" ON "academic"."assessments" USING btree ("batch_id","scheduled_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_assessment_student_key" ON "academic"."attempts" USING btree ("assessment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_session_student_key" ON "academic"."attendance" USING btree ("session_id","student_id");--> statement-breakpoint
CREATE INDEX "attendance_student_idx" ON "academic"."attendance" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_code_key" ON "academic"."batches" USING btree ("code");--> statement-breakpoint
CREATE INDEX "batches_course_idx" ON "academic"."batches" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "batches_programme_status_idx" ON "academic"."batches" USING btree ("programme_id","status");--> statement-breakpoint
CREATE INDEX "calendar_exclusions_batch_date_idx" ON "academic"."calendar_exclusions" USING btree ("batch_id","date");--> statement-breakpoint
CREATE INDEX "calendar_rules_batch_idx" ON "academic"."calendar_rules" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catchup_tasks_enrolment_session_key" ON "academic"."catchup_tasks" USING btree ("enrolment_id","session_id");--> statement-breakpoint
CREATE INDEX "catchup_tasks_batch_status_idx" ON "academic"."catchup_tasks" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_course_code_key" ON "academic"."chapters" USING btree ("course_id","code");--> statement-breakpoint
CREATE INDEX "chapters_subject_idx" ON "academic"."chapters" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_records_current_key" ON "academic"."class_records" USING btree ("session_id","chapter_id") WHERE "academic"."class_records"."state" <> 'superseded';--> statement-breakpoint
CREATE INDEX "class_records_batch_idx" ON "academic"."class_records" USING btree ("batch_id","state");--> statement-breakpoint
CREATE INDEX "class_records_teacher_idx" ON "academic"."class_records" USING btree ("teacher_staff_id");--> statement-breakpoint
CREATE INDEX "class_sessions_batch_date_idx" ON "academic"."class_sessions" USING btree ("batch_id","date");--> statement-breakpoint
CREATE INDEX "class_sessions_teacher_date_idx" ON "academic"."class_sessions" USING btree ("teacher_staff_id","date");--> statement-breakpoint
CREATE INDEX "class_sessions_room_date_idx" ON "academic"."class_sessions" USING btree ("room_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_book_chapters_code_key" ON "academic"."concept_book_chapters" USING btree ("chapter_code");--> statement-breakpoint
CREATE INDEX "concept_book_chapters_book_idx" ON "academic"."concept_book_chapters" USING btree ("book_code");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_code_key" ON "academic"."courses" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_family_version_key" ON "academic"."courses" USING btree ("family_code","version");--> statement-breakpoint
CREATE INDEX "courses_programme_idx" ON "academic"."courses" USING btree ("programme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_plans_code_key" ON "academic"."curriculum_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "curriculum_plans_course_idx" ON "academic"."curriculum_plans" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "curriculum_plans_batch_idx" ON "academic"."curriculum_plans" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_intake_log_request_key" ON "academic"."enrolment_intake_log" USING btree ("request_event_id");--> statement-breakpoint
CREATE INDEX "enrolment_intake_log_processed_idx" ON "academic"."enrolment_intake_log" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_request_event_key" ON "academic"."enrolments" USING btree ("request_event_id") WHERE "academic"."enrolments"."request_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_active_student_batch_key" ON "academic"."enrolments" USING btree ("student_id","batch_id") WHERE "academic"."enrolments"."status" = 'active' AND "academic"."enrolments"."batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "enrolments_batch_status_idx" ON "academic"."enrolments" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "enrolments_student_idx" ON "academic"."enrolments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "interventions_student_idx" ON "academic"."interventions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "interventions_staff_status_idx" ON "academic"."interventions" USING btree ("responsible_staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_plan_sequence_key" ON "academic"."plan_items" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_plan_lesson_key" ON "academic"."plan_items" USING btree ("plan_id","lesson_code");--> statement-breakpoint
CREATE INDEX "plan_items_chapter_idx" ON "academic"."plan_items" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_runs_version_key" ON "academic"."result_runs" USING btree ("assessment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "result_runs_one_final_key" ON "academic"."result_runs" USING btree ("assessment_id") WHERE "academic"."result_runs"."status" = 'final';--> statement-breakpoint
CREATE UNIQUE INDEX "results_run_attempt_key" ON "academic"."results" USING btree ("run_id","attempt_id");--> statement-breakpoint
CREATE INDEX "results_student_idx" ON "academic"."results" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_code_key" ON "academic"."rooms" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "students_code_key" ON "academic"."students" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "students_source_admission_key" ON "academic"."students" USING btree ("source_admission_id") WHERE "academic"."students"."source_admission_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_course_code_key" ON "academic"."subjects" USING btree ("course_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_assignments_active_key" ON "academic"."teacher_assignments" USING btree ("batch_id","subject_id","staff_member_id") WHERE "academic"."teacher_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "teacher_assignments_staff_idx" ON "academic"."teacher_assignments" USING btree ("staff_member_id","status");--> statement-breakpoint
CREATE INDEX "admission_transitions_admission_idx" ON "ops"."admission_transitions" USING btree ("admission_id","at");--> statement-breakpoint
CREATE INDEX "admission_transitions_to_idx" ON "ops"."admission_transitions" USING btree ("to_status","at");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_code_key" ON "ops"."admissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_one_open_per_programme" ON "ops"."admissions" USING btree ("lead_id","programme_id") WHERE "ops"."admissions"."status" NOT IN ('enrolled', 'lost');--> statement-breakpoint
CREATE INDEX "admissions_status_idx" ON "ops"."admissions" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "admissions_lead_idx" ON "ops"."admissions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "admissions_counsellor_idx" ON "ops"."admissions" USING btree ("counsellor_staff_id");--> statement-breakpoint
CREATE INDEX "counselling_sessions_scheduled_idx" ON "ops"."counselling_sessions" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "counselling_sessions_admission_idx" ON "ops"."counselling_sessions" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_code_key" ON "ops"."decisions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "decisions_state_idx" ON "ops"."decisions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "demos_admission_idx" ON "ops"."demos" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_flags_pair_key" ON "ops"."duplicate_flags" USING btree ("lead_id","matched_lead_id");--> statement-breakpoint
CREATE INDEX "duplicate_flags_status_idx" ON "ops"."duplicate_flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "enquiries_lead_idx" ON "ops"."enquiries" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "enquiries_received_idx" ON "ops"."enquiries" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_attempts_admission_attempt_key" ON "ops"."enrolment_attempts" USING btree ("admission_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_attempts_request_event_key" ON "ops"."enrolment_attempts" USING btree ("request_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_task_level_key" ON "ops"."escalations" USING btree ("task_id","level");--> statement-breakpoint
CREATE INDEX "escalations_status_idx" ON "ops"."escalations" USING btree ("status","raised_at");--> statement-breakpoint
CREATE INDEX "escalations_recipient_idx" ON "ops"."escalations" USING btree ("recipient_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_records_code_key" ON "ops"."fee_records" USING btree ("code");--> statement-breakpoint
CREATE INDEX "fee_records_admission_idx" ON "ops"."fee_records" USING btree ("admission_id","recorded_at");--> statement-breakpoint
CREATE INDEX "fee_records_status_idx" ON "ops"."fee_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "ops"."follow_ups" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "follow_ups_owner_idx" ON "ops"."follow_ups" USING btree ("owner_staff_id","status");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "ops"."follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_code_key" ON "ops"."incidents" USING btree ("code");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "ops"."incidents" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "ops"."lead_activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_code_key" ON "ops"."leads" USING btree ("code");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "ops"."leads" USING btree ("owner_staff_id");--> statement-breakpoint
CREATE INDEX "leads_student_phone_idx" ON "ops"."leads" USING btree ("student_phone");--> statement-breakpoint
CREATE INDEX "leads_student_email_idx" ON "ops"."leads" USING btree ("student_email");--> statement-breakpoint
CREATE INDEX "leads_guardian_phone_idx" ON "ops"."leads" USING btree ("guardian_phone");--> statement-breakpoint
CREATE INDEX "leads_guardian_email_idx" ON "ops"."leads" USING btree ("guardian_email");--> statement-breakpoint
CREATE INDEX "leads_received_idx" ON "ops"."leads" USING btree ("first_received_at");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "ops"."milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_items_staff_title_key" ON "ops"."onboarding_items" USING btree ("staff_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_key" ON "ops"."projects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "responsibilities_code_key" ON "ops"."responsibilities" USING btree ("code");--> statement-breakpoint
CREATE INDEX "responsibilities_holder_idx" ON "ops"."responsibilities" USING btree ("holder_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risks_code_key" ON "ops"."risks" USING btree ("code");--> statement-breakpoint
CREATE INDEX "risks_status_idx" ON "ops"."risks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_key" ON "ops"."settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_checklist_items_seq_key" ON "ops"."sop_checklist_items" USING btree ("version_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_versions_number_key" ON "ops"."sop_versions" USING btree ("sop_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sops_code_key" ON "ops"."sops" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sops_status_idx" ON "ops"."sops" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_by_idx" ON "ops"."task_dependencies" USING btree ("blocked_by_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_code_key" ON "ops"."tasks" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tasks_status_due_idx" ON "ops"."tasks" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "ops"."tasks" USING btree ("owner_staff_id");--> statement-breakpoint
CREATE INDEX "tasks_accountable_idx" ON "ops"."tasks" USING btree ("accountable_staff_id");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "ops"."tasks" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_code_key" ON "ops"."work_items" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_assignments_one_open_key" ON "ops"."asset_assignments" USING btree ("asset_id") WHERE "ops"."asset_assignments"."returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_assignments_staff_idx" ON "ops"."asset_assignments" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_code_key" ON "ops"."assets" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_serial_key" ON "ops"."assets" USING btree ("serial_number") WHERE "ops"."assets"."serial_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "compensation_records_staff_idx" ON "ops"."compensation_records" USING btree ("staff_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_records_one_approved_key" ON "ops"."compensation_records" USING btree ("staff_id") WHERE "ops"."compensation_records"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "department_heads_one_current_key" ON "ops"."department_heads" USING btree ("department_id") WHERE "ops"."department_heads"."ends_on" IS NULL;--> statement-breakpoint
CREATE INDEX "department_heads_staff_idx" ON "ops"."department_heads" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "emergency_contacts_staff_idx" ON "ops"."emergency_contacts" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_contacts_one_primary_key" ON "ops"."emergency_contacts" USING btree ("staff_id") WHERE "ops"."emergency_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "employee_documents_staff_idx" ON "ops"."employee_documents" USING btree ("staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_documents_storage_key" ON "ops"."employee_documents" USING btree ("storage_key") WHERE "ops"."employee_documents"."storage_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_identity_references_staff_idx" ON "ops"."employee_identity_references" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_records_code_key" ON "ops"."employee_records" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_records_work_email_key" ON "ops"."employee_records" USING btree ("work_email") WHERE "ops"."employee_records"."work_email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_records_status_idx" ON "ops"."employee_records" USING btree ("employment_status");--> statement-breakpoint
CREATE INDEX "employment_history_staff_idx" ON "ops"."employment_history" USING btree ("staff_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_code_key" ON "ops"."candidates" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_email_key" ON "ops"."candidates" USING btree ("email") WHERE "ops"."candidates"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_phone_key" ON "ops"."candidates" USING btree ("phone") WHERE "ops"."candidates"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "candidates_recruiter_idx" ON "ops"."candidates" USING btree ("recruiter_staff_id");--> statement-breakpoint
CREATE INDEX "interview_panelists_staff_idx" ON "ops"."interview_panelists" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "interviews_application_idx" ON "ops"."interviews" USING btree ("application_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_application_stages_application_idx" ON "ops"."job_application_stages" USING btree ("application_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_candidate_requisition_key" ON "ops"."job_applications" USING btree ("candidate_id","requisition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_employee_key" ON "ops"."job_applications" USING btree ("employee_staff_id") WHERE "ops"."job_applications"."employee_staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "job_applications_requisition_idx" ON "ops"."job_applications" USING btree ("requisition_id","stage");--> statement-breakpoint
CREATE INDEX "job_applications_stage_idx" ON "ops"."job_applications" USING btree ("stage","stage_changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_offers_one_live_key" ON "ops"."job_offers" USING btree ("application_id") WHERE "ops"."job_offers"."status" IN ('draft', 'approved', 'extended', 'accepted');--> statement-breakpoint
CREATE INDEX "job_offers_status_idx" ON "ops"."job_offers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_cases_code_key" ON "ops"."lifecycle_cases" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_cases_one_live_key" ON "ops"."lifecycle_cases" USING btree ("staff_id","kind") WHERE "ops"."lifecycle_cases"."status" IN ('open', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_cases_application_key" ON "ops"."lifecycle_cases" USING btree ("application_id") WHERE "ops"."lifecycle_cases"."application_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lifecycle_cases_status_idx" ON "ops"."lifecycle_cases" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "lifecycle_cases_lwd_idx" ON "ops"."lifecycle_cases" USING btree ("last_working_day");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_items_case_key" ON "ops"."lifecycle_items" USING btree ("case_id","item_key");--> statement-breakpoint
CREATE INDEX "lifecycle_items_case_idx" ON "ops"."lifecycle_items" USING btree ("case_id","seq");--> statement-breakpoint
CREATE INDEX "lifecycle_items_due_idx" ON "ops"."lifecycle_items" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "requisitions_code_key" ON "ops"."requisitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "requisitions_status_idx" ON "ops"."requisitions" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "requisitions_recruiter_idx" ON "ops"."requisitions" USING btree ("recruiter_staff_id");--> statement-breakpoint
CREATE INDEX "attendance_breaks_session_idx" ON "ops"."attendance_breaks" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_breaks_one_open_key" ON "ops"."attendance_breaks" USING btree ("session_id") WHERE "ops"."attendance_breaks"."end_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_corrections_code_key" ON "ops"."attendance_corrections" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_corrections_one_pending_key" ON "ops"."attendance_corrections" USING btree ("session_id") WHERE "ops"."attendance_corrections"."status" = 'pending' AND "ops"."attendance_corrections"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attendance_corrections_staff_idx" ON "ops"."attendance_corrections" USING btree ("staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_imports_sha_key" ON "ops"."attendance_imports" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "attendance_sessions_staff_date_idx" ON "ops"."attendance_sessions" USING btree ("staff_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_sessions_status_idx" ON "ops"."attendance_sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_one_open_key" ON "ops"."attendance_sessions" USING btree ("staff_id") WHERE "ops"."attendance_sessions"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_location_key" ON "ops"."holidays" USING btree ("holiday_date",coalesce(lower("location"), '')) WHERE "ops"."holidays"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "leave_ledger_staff_type_idx" ON "ops"."leave_ledger_entries" USING btree ("staff_id","leave_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_request_entry_key" ON "ops"."leave_ledger_entries" USING btree ("leave_request_id","entry_type") WHERE "ops"."leave_ledger_entries"."leave_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_requests_code_key" ON "ops"."leave_requests" USING btree ("code");--> statement-breakpoint
CREATE INDEX "leave_requests_staff_dates_idx" ON "ops"."leave_requests" USING btree ("staff_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "ops"."leave_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_key" ON "ops"."leave_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "shift_assignments_staff_idx" ON "ops"."shift_assignments" USING btree ("staff_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_code_key" ON "ops"."shift_templates" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_code_key" ON "ops"."policies" USING btree ("code");--> statement-breakpoint
CREATE INDEX "policies_area_status_idx" ON "ops"."policies" USING btree ("area","status");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_number_key" ON "ops"."policy_versions" USING btree ("policy_id","version_number");--> statement-breakpoint
CREATE INDEX "risk_mitigations_risk_idx" ON "ops"."risk_mitigations" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "sop_ack_requirements_version_idx" ON "ops"."sop_ack_requirements" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_ack_requirements_active_department" ON "ops"."sop_ack_requirements" USING btree ("version_id","department_id") WHERE "ops"."sop_ack_requirements"."audience_type" = 'department' AND "ops"."sop_ack_requirements"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sop_ack_requirements_active_role" ON "ops"."sop_ack_requirements" USING btree ("version_id","role") WHERE "ops"."sop_ack_requirements"."audience_type" = 'role' AND "ops"."sop_ack_requirements"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sop_acknowledgements_once_key" ON "ops"."sop_acknowledgements" USING btree ("version_id","user_id");--> statement-breakpoint
CREATE INDEX "sop_acknowledgements_user_idx" ON "ops"."sop_acknowledgements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "ops"."task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_references_task_idx" ON "ops"."task_references" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_once_key" ON "ops"."task_reminders" USING btree ("task_id","kind","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reviews_cycle_key" ON "ops"."task_reviews" USING btree ("task_id","cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reviews_one_pending" ON "ops"."task_reviews" USING btree ("task_id") WHERE "ops"."task_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "task_reviews_status_idx" ON "ops"."task_reviews" USING btree ("status","submitted_at");