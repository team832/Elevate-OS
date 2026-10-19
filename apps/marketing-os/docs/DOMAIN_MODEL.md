# Marketing OS — domain model

Schema: `packages/database/src/schema/marketing.ts` (PostgreSQL schema `marketing`). Every primary key is a UUID; business codes are separate unique columns (D-009). Foreign keys go only into `marketing` or `core` (D-005). Status columns have CHECK constraints mirrored in `src/domain/vocabulary.ts` (a unit test keeps them identical).

```
core.users ─┬─< ideas.created_by, content_versions.author_user_id, comments, publishing_records …
core.staff_members ─< social_accounts.owner_staff_id, content_assignments.staff_member_id
core.approvals ─< content_reviews.approval_id, content_items.approval_id

social_accounts ─< placements >─ ideas ─< content_items ─< content_versions ─< content_assets
                       │               │        │   ├─< content_reviews (approval ↔ version + hash)
                       │               │        │   ├─< content_comments
                       │               │        │   └─< content_assignments (writer/designer/editor/presenter)
                       │               │        └── current_version_id / approved_version_id → content_versions
                       ├─ placement_groups (collab) ─┘
                       ├─ campaigns
                       └─< publishing_records ─< publishing_attempts
social_accounts ─< metric_imports ─< metric_snapshots ─< metric_values
                                     metric_snapshots.placement_id → placements (when matched)
code_counters (per course prefix)   content_rules   policy_settings   legacy_conflicts
```

## Entities
| Table | Purpose | Key fields and constraints |
|---|---|---|
| `social_accounts` | Account registry (MKT-001) | unique `code` (`^[A-Z]{2,5}$`); `platform` instagram/youtube/linkedin/other; `display_name`, `handle` nullable (never invented) + `proposed_*`; `handle_status`; `scope` exam/local/company/founder; `exam_prefixes[]`; `status` live/starting/later/retired (+ `legacy_status`); `owner_staff_id` → core.staff_members; cadence text + `cadence_max_per_day/week`, `cadence_enforcement` warn/block, `cadence_status` proposed/approved; `content_rules[]`; `integration_status` not_configured/sandbox/connected/error + checked at + note |
| `legacy_conflicts` | Source conflicts awaiting an owner decision | unique `code` (ACC-CONFLICT-001), `owner_decision` (OD-001), status unreconciled/resolved |
| `policy_settings` | Configurable policies; open OD-xxx as `proposed` | unique `key`, jsonb `value`, status proposed/approved, `owner_decision` |
| `content_rules` | Brand/claims/channel/consent rules (MKT-012) | unique `code`; `kind`; jsonb `matcher` (regex/literal/schedule_limit or null); `manual_check`; `action_on_match`; `applies_to[]`; status approved/documented/proposed/retired |
| `code_counters` | Monotonic counter per course prefix | PK `scope`; `last_number ≥ 0` |
| `ideas` | Idea tracker (MKT-003/004) | unique `code` `^(CLAT|IPMAT|CUET|COM|GEN)-\d{3,}$` matching `course_prefix` (null only while quarantined); unique (`course_prefix`, `normalized_title`); pillar, series, objective, audience, brief, `origin` (source), master asset; `scope` + `scope_prefixes[]`; status idea/in_development/ready/held/rejected/archived + reason; legacy: `legacy_code`, `legacy_status`, unique `legacy_ref`, `quarantine_state` none/quarantined/resolved, `proposed_code` + `proposed_code_status` |
| `content_items` | One piece of content under an idea | `format` script/caption/carousel/video_brief/image/post; `state` draft/in_review/changes_requested/approved/scheduled/published/archived; `current_version_id`, `approved_version_id`, `approval_id` (approved version requires an approval); hold reason/since; archived reason; legacy status/format/ref |
| `content_versions` | Immutable versions (MKT-010) | unique (item, `version_number`); title, body, `content_hash` (SHA-256), `shows_students`, `consent_reference`, change note, author. No update API exists. |
| `content_assets` | File metadata only (no binaries) | file name, MIME type, size, external URL, shows students, `rights_state` own/third_party_cleared/third_party_pending |
| `content_assignments` | Assignee per role | unique (item, role); user and/or staff member (at least one) |
| `content_comments` | Append-only discussion | item, optional version, author, body |
| `content_reviews` | Binds a core approval to a version | unique `approval_id`; version + `version_hash`; jsonb `rule_check` snapshot; `acknowledged_rule_codes[]`; outcome pending/approved/changes_requested/withdrawn/voided |
| `placement_groups` | Collab across accounts (BR-MKT-4) | unique `code` (`<IDEA>-COLLAB-IG|YT`); idea; platform instagram/youtube |
| `placements` | Item → account (MKT-002/008) | unique `code` `<IDEA>-<ACCOUNT>[S|L]`; idea, content item (both null only when `ambiguous`); account; variant short/long; group; campaign; status planned/scheduled/published/cancelled (scheduled needs a time); `original_publish_at` (never overwritten), `scheduled_at`, `published_at`, `published_url`, `publication_mode` sandbox/adapter/manual/legacy_reported; legacy raw fields + unique `legacy_ref`, ambiguity reason |
| `publishing_records` | One per (placement, version) | unique `idempotency_key`; partial unique: one pending/succeeded per placement; adapter, status pending/succeeded/failed, attempts ≤ max, `is_sandbox` (sandbox ⇒ no URL), external id, URL, last response/error |
| `publishing_attempts` | Every adapter call | unique (record, attempt number); outcome; response; error |
| `campaigns` | Organic campaigns (MKT-018 subset) | unique `code`; dates ordered; status draft/active/ended/cancelled |
| `metric_imports` | One CSV import | unique (account, `file_sha256`); format; declared `date_format`; `captured_at`; row counts; jsonb `rejected` |
| `metric_snapshots` | One post’s numbers at one capture | unique (account, `post_key`, `captured_at`, `source`); source csv_import/manual_audit/adapter + label; placement (matched) / suggested placement; `match_status` matched_link/suggested_title_date/unmatched/historical; published date; format (+ estimated flag); `captured_precision` instant/date; window; tags |
| `metric_values` | One metric of a snapshot | unique (snapshot, metric); `state` reported/estimated/missing/not_applicable; CHECK: value non-null and ≥ 0 exactly when reported/estimated — **missing is never 0** |

## States
- **Content item:** see ALGORITHMS §3 (`domain/content-state.ts`).
- **Idea:** idea ⇄ in_development ⇄ ready; held and rejected (reason required); archived is terminal (`server/ideas.ts`).
- **Placement:** planned → scheduled ⇄ planned (unschedule) → published; planned/scheduled → cancelled.
- **Publishing record:** pending → succeeded | failed → (retry) pending … until `max_attempts`.
- **Approval (core):** pending → approved | rejected (shown as “changes requested”) | withdrawn.

## Cross-module references
None to other module schemas. Marketing reads `core.users`, `core.user_roles` (notification recipients), `core.staff_members` (owner names) and writes `core.approvals` / `core.audit_events` / `core.notifications` only through server-kit and notifications.
