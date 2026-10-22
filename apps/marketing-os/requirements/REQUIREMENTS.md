# Marketing OS — requirements and status

IDs and wording come from `docs/PRODUCT_REQUIREMENTS.md` §2 (MKT-001 … MKT-037). Status per D-013: **Proposed → Approved → Implemented → Tested → Deployed**. *Tested* = a passing automated test (listed; evidence in `IMPLEMENTATION_STATUS.md`). Nothing is Deployed. “(partial)” means the listed part is done and the rest stays Proposed. Rule approvals recorded in the legacy sources (BR-MKT-1, -3, -4) are business rules, not software sign-off.

| ID | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| MKT-001 | Social account registry | **Tested** | `social_accounts`; 10 legacy rows, handles null unless confirmed (`@elevate.clat` only), owner staff ref, cadence, rules, integration status; OD-001 conflict surfaced (`legacy_conflicts`, accounts screen). `accounts-ideas.test.ts`. Account model stays `proposed` (OD-001). |
| MKT-002 | Placement code = registered account; YouTube S/L; one per idea and code | **Tested** | unique `placements.code`; `buildPlacementCode`; `codes-duplicates.test.ts`, `placements-publishing.test.ts` |
| MKT-003 | Idea creation; code max+1 under lock/unique, never reused | **Tested** | `server/codes.ts` (counter + unique + savepoint retry); concurrency and retry tests; duplicate detection (ALGORITHMS §2) |
| MKT-004 | Idea lifecycle separate from content; legacy mapping | **Tested** | `ideas.status`, `changeIdeaStatus`, `mapLegacyIdeaStatus` |
| MKT-005 | Idea inbox | Proposed | not built |
| MKT-006 | Configurable pillars and series | Proposed (partial) | pillar/series stored as free text on ideas; lists and series cadence not built (OD-004) |
| MKT-007 | Brief with objective, CTA, audience, hook, facts | Proposed (partial) | objective, audience, brief fields on ideas (Tested via PATCH); fact list / `[CONFIRM]` not built |
| MKT-008 | Content item/placement fields, original publish time immutable | **Tested** (partial) | `original_publish_at` kept on reschedule (test), current time, campaign, collab group; owner / next deadline not built |
| MKT-009 | State machine enforced on the server; audited | **Tested** | `domain/content-state.ts`; INVALID_STATE_TRANSITION; audit events checked |
| MKT-010 | Immutable versions; edit after approval voids approval | **Tested** | `content_versions` (hash, author); revise → in_review, placements unscheduled |
| MKT-011 | Explicit approval gate (version-bound, not sole author, checks cleared) | **Tested** (partial) | core approvals + `content_reviews`; approver roles policy (OD-002 proposed); 403 contributor; self/author refusal; director-only for fees/offers not built |
| MKT-012 | Claims check from configurable rules | **Tested** (partial) | 45 rules as data; block vs review vs manual checklist; written override of a block not built |
| MKT-013 | Fact register | Proposed | not built |
| MKT-014 | Collab rule check | **Tested** | `validateCollabGroup`, `checkPlacementScope`, placement groups |
| MKT-015 | LinkedIn checks | **Tested** | CH-005 cadence block at scheduling; CH-001/002/003 hashtag/poll/“comment X” rules; CH-004 manual check |
| MKT-016 | Stagger warning | **Tested** | `STAGGER_SAME_DAY` (collab exception); reel/Short mirror exception not modelled |
| MKT-017 | Calendars with cadence | **Tested** (partial) | calendar screen/API by IST date and account with conflicts; weekly planned vs published; month view and calendar moments not built |
| MKT-018 | Organic and paid campaigns | **Tested** (partial) | organic campaigns, placement assignment, weekly report by campaign; paid campaigns, budgets, launch checks Proposed |
| MKT-019 | Repurposing | Proposed | not built (placements can be added per account by hand) |
| MKT-020 | Placement history view | **Implemented** (partial) | content screen: versions, approvals, publishing records/attempts; single chronological view not built |
| MKT-021 | Production assets | **Implemented** (partial) | asset metadata per version (type via MIME, URL, rights, shows students); asset library not built |
| MKT-022 | Consent and rights gate | **Tested** | SYS-CONSENT (OD-008 proposed hard block) and SYS-RIGHTS block approval; consent records (PLT-018) not built — a consent *reference* is stored |
| MKT-023 | Assignment and handoff | **Tested** (partial) | writer/designer/editor/presenter assignees; deadlines, overdue flags, recording sessions Proposed |
| MKT-024 | Publishing adapter, mock by default | **Tested** | `MockPublishingAdapter` (sandbox, no URL), `DisabledPublishingAdapter`; real adapters wait for OD-006 |
| MKT-025 | Manual publication record with time + live link | **Tested** | `POST /placements/:id/publication` |
| MKT-026 | Duplicate-publication prevention | **Tested** (partial) | idempotency key (placement+version), one active record per placement, retries ≤ max; republish-with-reason and copy-duplicate warning Proposed |
| MKT-027 | Lead time / at risk / overdue | Proposed (partial) | dashboard lists scheduled placements past their time; lead-time flags not built |
| MKT-028 | Analytics CSV import | **Tested** | TS port with audit defects fixed; dry run; rejected rows; idempotent per file |
| MKT-029 | Metric semantics (missing ≠ 0, coverage) | **Tested** | `metric_values` CHECK; aggregation statuses and coverage |
| MKT-030 | Match rows to placements | **Tested** (partial) | link match; same-day suggestion stored, confirmation UI Proposed; unmatched kept |
| MKT-031 | Post-performance review | Proposed | not built |
| MKT-032 | Weekly report | **Tested** (partial) | per account/campaign totals with coverage, IG save+share rate, median, best post, “pattern not reliable” < 6, accounts with no data; LinkedIn/YouTube rates, notes, monthly, Markdown export Proposed |
| MKT-033 | Competitor tracking | Proposed | not built |
| MKT-034 | Legacy import with quarantine | **Tested** | 10 accounts, 45 rules, 59 ideas (8 quarantined, proposed codes reserved, not applied), 36 placements (2 ambiguous), idempotent |
| MKT-035 | Post-audit import | **Tested** | 60 historical snapshots labelled manual audit; blanks missing; verdicts as tags |
| MKT-036 | Enquiry handoff to Ops | Proposed | not built (see INTEGRATION_REQUESTS IR-MKT-05) |
| MKT-037 | Marketing summary contract | **Tested** (partial) | `GET /marketing/api/internal/v1/summary` → MarketingSummaryV1; per-week on-time/overdue figures are not in the v1 contract |

Platform requirements used: PLT-002 (server-side permissions), PLT-004 (no sole self-approval), PLT-005 (audit), PLT-006 (approval bound to version hash), PLT-009 (summary), PLT-013 (IST, Monday weeks), PLT-017 (honest adapter status; mock → sandbox).


## Role workspaces (owner brief 22 Oct 2026; D-072, D-073)
| ID | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| MKT-WS-1 | Marketing OS is the Marketing workspace (`:3002/marketing`); non-members are sent to their own workspace; `/marketing/api` refuses non-members with 403 | **Tested** | `packages/server-kit/tests/define-route.test.ts`, `packages/authorization/tests/workspaces.test.ts`, `packages/authentication/tests/workspace-login.test.ts` |
| MKT-WS-2 | Sidebar filtered by permission, in work order (Overview, Leads, Follow-ups, Campaigns, Content Calendar, Tasks, EOD Reports, Reports; Rules & settings at the foot); tabs per permission, a lone tab hidden; no Events and Webinars | **Tested** (navigation) · Implemented (screens) | `tests/unit/navigation.test.ts` |
| MKT-WS-3 | Overview "Today": own tasks, EOD status, follow-ups due today / overdue / upcoming as links with an as-of time; content due this week; awaiting approval; campaigns running; last metric import per account | **Tested** (follow-ups block, metric imports) · Implemented (page) | `tests/integration/overview-today.test.tsx`, `campaigns.test.ts` → "overview shows when numbers were last imported" |
| MKT-WS-4 | Leads, lead detail and follow-ups inside Marketing (Business Ops `./leads` entry, same handlers): managers see every lead, contributors only their own; contact fields, never KYC, fees, admissions or reviews | **Tested** | `tests/integration/shared-entries.test.ts`; `apps/business-ops-os/tests/integration/shared-entries.test.tsx`, `lead-kyc-masking.test.ts` |
| MKT-WS-5 | Own tasks and EOD reports inside Marketing (Business Ops `./work` entry) | **Tested** | `tests/integration/shared-entries.test.ts` → "task routes answer with the same permission checks" |
| MKT-WS-6 | Campaign results from imported metrics only, with a campaign detail page `/marketing/campaigns/:id`; missing stays missing | **Tested** (results) · Implemented (detail page) | `tests/integration/campaigns.test.ts` → "campaign results (verified data only)" |
| MKT-WS-7 | Marketing grants on leads, lead contacts and own tasks | **Proposed** (owner to confirm, D-073); in the code and tested | `packages/authorization/tests/workspaces.test.ts` |
| MKT-WS-8 | Conversion outcomes (leads → demos → admissions) by campaign | Proposed — not built | enquiries carry only a free-text `campaignRef`; owner decision to make it a reference |
| MKT-WS-9 | Events and Webinars in Marketing | Proposed — not built | needs a new events-only permission (owner decision) |
