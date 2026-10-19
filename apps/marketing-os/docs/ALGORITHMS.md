# Marketing OS — algorithms and business rules

Format per `docs/BUILD_PLAN.md`: 1 Purpose · 2 Inputs · 3 Output · 4 Preconditions · 5 Rules and constraints · 6 Steps · 7 Errors and edge cases · 8 Permissions · 9 Tests · 10 Known limitations. Unit tests live in `tests/unit/`, integration tests in `tests/integration/`.

## §1 Idea-code allocation (MKT-003, D-009)
1. **Purpose:** give every idea a unique, never-reused code `<PREFIX>-<NNN>`.
2. **Inputs:** course prefix (`CLAT`, `IPMAT`, `CUET`, `COM`, `GEN`); the transaction.
3. **Output:** a code such as `CLAT-029` (at least 3 digits).
4. **Preconditions:** inside the creating transaction (`server/ideas.ts createIdea`).
5. **Rules:** the floor is the highest number used **or reserved** for the prefix: live codes, legacy codes held in quarantine (`legacy_code`) and proposed renumberings (`proposed_code`, OD-003). `marketing.code_counters.last_number` only grows. Archiving never frees a number.
6. **Steps:** (a) `reservedFloor` reads the codes and takes the max per prefix (`highestReservedNumber`, pure); (b) `INSERT … ON CONFLICT (scope) DO UPDATE SET last_number = GREATEST(last_number, floor) + 1 RETURNING last_number` — the counter row lock serialises concurrent creators; (c) insert the idea; the unique index `ideas_code_key` is the backstop; (d) on a unique violation of `ideas_code_key` the attempt (a savepoint) is rolled back and retried, up to 5 times.
7. **Edge cases:** a stale or foreign allocator returning a taken code → retry; 5 failures → 409 `CONFLICT`; after the legacy import the counters are bumped so `CLAT-028` (proposed) is never issued — the next CLAT idea is `CLAT-029`.
8. **Permissions:** `marketing:ideas:write`.
9. **Tests:** `unit/codes-duplicates.test.ts` (“idea codes”); `integration/accounts-ideas.test.ts` (“creates ideas with sequential …”, “never collides under concurrency”, “retries when an allocated code is already taken …”); `integration/legacy-metrics-summary.test.ts` (“never reissues legacy or proposed numbers”).
10. **Limitations:** tests run on PGlite (one connection), so true parallel lock contention is exercised only on real PostgreSQL; the logic relies on standard `ON CONFLICT DO UPDATE` row locking.

## §2 Duplicate-idea detection (MKT-003)
1. **Purpose:** warn about likely duplicate ideas; refuse only an exact duplicate.
2. **Inputs:** candidate `{title, coursePrefix}`; existing ideas `{id, code, title, coursePrefix, status}`; thresholds (policy `ideas.duplicate_thresholds`, proposed: same course 0.5, other course 0.75); `limit` 5; optional `excludeId`.
3. **Output:** `{decision: 'block'|'warn'|'clear', normalizedTitle, candidates[{kind, score, sharedTokens, reason}]}`.
4. **Preconditions:** none (pure, `domain/duplicates.ts`).
5. **Rules:** normalise (NFKD, strip accents, lower-case, `&`→`and`, non-alphanumerics → space, collapse); tokenise (drop a fixed English + Hinglish stop-word list, strip a plural `s` from words > 3 letters); score = Jaccard of token sets. Kinds: `exact_same_course` (identical normalised title, same course → **block**), `exact_other_course` (warn), `similar_same_course` (score ≥ 0.5, warn), `similar_other_course` (score ≥ 0.75, warn). All statuses count (archived and rejected ideas still own their titles).
6. **Steps:** normalise and tokenise the candidate → score each existing idea → classify → sort by kind priority, score desc, code asc, id → cap at `limit` → decision.
7. **Edge cases:** empty title after normalisation → `clear`; invalid thresholds throw; ties are broken deterministically. The unique index `ideas_course_title_key (course_prefix, normalized_title)` makes the block concurrency-safe (two simultaneous creates of the same title: one gets 409).
8. **Permissions:** creating needs `marketing:ideas:write`; the preview `POST /ideas/duplicate-check` needs `marketing:ideas:read`.
9. **Tests:** `unit/codes-duplicates.test.ts` (“duplicate detection”, “title normalisation”); `integration/accounts-ideas.test.ts` (“blocks an exact normalised duplicate …”).
10. **Limitations:** lexical only (no synonyms or transliteration: “ratta” vs “rote” are different words); Hinglish stop words are a short fixed list.

## §3 Content state machine (MKT-009, MKT-010)
1. **Purpose:** the only legal life cycle of a content item.
2. **Inputs:** current state, action (`submit`, `withdraw`, `request_changes`, `approve`, `revise`, `schedule`, `unschedule`, `publish`, `archive`).
3. **Output:** `{ok:true, to}` or `{ok:false, reason}` → the service throws `INVALID_STATE_TRANSITION` (409).
4. **Preconditions:** pure function `transitionContent` in `domain/content-state.ts`.
5. **Rules:** draft →submit→ in_review →approve→ approved →schedule→ scheduled →publish→ published →archive→ archived; in_review →request_changes→ changes_requested →submit→ in_review; in_review →withdraw→ draft; approved/scheduled →revise (new version)→ in_review; scheduled →unschedule (last scheduled placement)→ approved; archive from draft, changes_requested, approved, scheduled, published. Edits: draft/changes_requested = new version; approved/scheduled = new version + approval voided + placements unscheduled + new review; in_review/published/archived = refused.
6. **Steps:** look up the transition table; on miss, report the states the action is allowed from.
7. **Edge cases:** scheduling a second placement keeps `scheduled`; publishing another placement of a published item keeps `published`; legacy items imported as `in_review` have no approval request — deciding them returns 409 with “withdraw and submit again”.
8. **Permissions:** submit/withdraw/archive/edit `marketing:content:write`; approve/request changes `marketing:content:approve`; schedule `marketing:schedule:manage`; publish `marketing:content:publish`.
9. **Tests:** `unit/content-state-rules.test.ts` (“content state machine”); `integration/content-workflow.test.ts` (“runs draft → … → approved”, “rejects illegal transitions”, “keeps approved versions immutable”).
10. **Limitations:** the `hold` flag is imported from legacy but there is no API to set or clear it yet.

## §4 Brand-rule checker and approval eligibility (MKT-011, MKT-012, MKT-022, CO-001)
1. **Purpose:** decide whether a version may be approved.
2. **Inputs:** version title, body, assets (shows students, rights), consent reference, format, target account codes (the item’s non-cancelled placements); rules from `marketing.content_rules` (seeded from `content-rules.json`, 45 rules); policy `approval.consent_required_for_students` (OD-008, proposed `true`); approver acknowledgements.
3. **Output:** `{blocking[], review[], checklist[], skipped[], accountsChecked, assumedAllAccounts}`; eligibility `{eligible, blocking, missingAcknowledgements}`.
4. **Preconditions:** a current version exists.
5. **Rules:** a rule applies when its `applies_to` intersects the accounts checked (no placements → every account any rule names: strictest). `action_on_match: block` → blocking flag (e.g. CR-006 results/toppers, CR-005 Sikar outside IGS, CH-001 hashtags on LI). `flag_for_review` and `flag_if_no_match` → review flag **and** a checklist item. `manual_check` / no matcher → checklist item (e.g. AP-001, CO-001). `schedule_limit` rules (CH-005) are skipped here and enforced by §5. Students on camera (version or asset flag) without a consent reference → `SYS-CONSENT` (block by default). Any asset with `third_party_pending` rights → `SYS-RIGHTS` (block). Retired rules are ignored. Eligible = no blocking flag and every checklist code acknowledged.
6. **Steps:** for each active rule (sorted by code): skip if not applicable → manual → checklist; schedule limit → skipped; regex/literal match on the rule’s field (`text` = title + body, `title`, `format`) → classify; then the consent and rights checks.
7. **Edge cases:** an invalid pattern is reported in `skipped`, never crashes; up to three matched excerpts are kept. Approval is refused with 409 `INVALID_STATE_TRANSITION` (`details.reason = BRAND_RULE_BLOCK`) when blocked and 400 `VALIDATION_FAILED` (`CHECKLIST_NOT_ACKNOWLEDGED`) when acknowledgements are missing. The check is re-run at approval time (rules or placements may have changed since submission) and again per account at scheduling.
8. **Permissions:** reading results `marketing:content:read`; deciding `marketing:content:approve` + an approver role from policy `approval.approver_roles` (OD-002, proposed: marketing_manager, director). Self-approval is refused twice: by server-kit (requester ≠ decider) and by the module (the version’s author cannot approve it, PLT-004).
9. **Tests:** `unit/content-state-rules.test.ts` (“brand-rule checker”); `integration/content-workflow.test.ts` (“blocks approval when a banned phrase matches”, “requires every checklist item …”, “blocks content showing students …”, “returns 403 when a contributor tries to approve”, “refuses self-approval …”).
10. **Limitations:** the brief asked that banned-phrase matches block; the legacy rule file deliberately marks broad patterns (e.g. CR-004 “online”, CR-001 “after 12th”) `flag_for_review` because they have legitimate uses. We honour the file: block-action rules block, review-action matches must be explicitly acknowledged by the approver. Overriding a block with a written reason (MKT-012) is not built. Fees/offers “director only” approval (MKT-011) is not built.

## §5 Schedule-conflict detection (MKT-015, MKT-016, MKT-017, AP-001)
1. **Purpose:** decide whether a placement may be scheduled at a time, and what to warn about.
2. **Inputs:** candidate `{placement, account, idea, group, at, approval validity}`; other scheduled placements within ±8 days; the account cadence `{maxPerDay, maxPerWeek, enforcement warn|block, status}`; policy `schedule.slot_window_minutes` (proposed 60), `schedule.stagger_warning` (proposed on); now.
3. **Output:** `{hard[], warnings[]}`, each `{code, severity, message, accountCode, relatedPlacementIds}`.
4. **Preconditions:** placement is `planned` or `scheduled`; linked to a content item.
5. **Rules — hard (scheduling refused, 409 with `details.hard`):** `NOT_APPROVED` (no valid approval: item not approved/scheduled/published, no approval record, approved version ≠ current version, or core approval not `approved`); a block-action brand rule matching the approved version **on this account** (reported as `NOT_APPROVED` with the rule code); `IN_PAST`; `CADENCE_DAY` / `CADENCE_WEEK` when the account’s enforcement is `block` (seeded only for LI from rule CH-005: 1/day, 4/week, approved). **Warnings (scheduling proceeds):** `SLOT_COLLISION` (same account, |Δt| < window; identical times always collide); cadence over a `warn` target (proposed targets parsed from the legacy cadence text, OD-007); `STAGGER_SAME_DAY` (same idea, other account, same IST day, not in one collab).
6. **Steps:** approval check → past check → collisions on the same account → day count (IST date) and week count (IST Monday–Sunday) including the candidate → stagger. Rescheduling keeps `original_publish_at` (MKT-008).
7. **Edge cases:** a collision exactly `window` minutes away is not a collision; window 0 → only identical times; a new IST week resets the weekly count; invalid times throw. The calendar view (`calendarConflicts`) counts only earlier posts for cadence so only the posts over the limit are flagged.
8. **Permissions:** `marketing:schedule:manage` (manager, director); the calendar needs `marketing:content:read`.
9. **Tests:** `unit/schedule-collab-publishing.test.ts` (“schedule-conflict detection”, “IST week helpers”); `integration/placements-publishing.test.ts` (“hard-blocks scheduling before approval …”, “… warns on slot collisions …”, “hard-blocks a second LI post …”, “rejects a time in the past”).
10. **Limitations:** the Instagram reel + YouTube Short mirror exception to the stagger rule (MKT-016) is not modelled; cadence targets are proposals until OD-007; at-risk/overdue scheduling flags (MKT-027) are only shown as “overdue scheduled” on the dashboard.

## §6 Publishing: eligibility, idempotency and retries (MKT-024, MKT-025, MKT-026)
1. **Purpose:** publish exactly once per approved version, honestly.
2. **Inputs:** placement, content item, approval validity, existing publishing record for the key, adapter, policy `publishing.max_attempts` (proposed 3).
3. **Output:** `{outcome: published|failed|already_published, duplicate, record, message, attemptsLeft}`.
4. **Preconditions:** `marketing:content:publish`.
5. **Rules:** only a `scheduled` placement of an item in `scheduled`/`published` with a valid approval whose approved version is the current version can publish (`checkPublishEligibility`). Idempotency key = `placement:<placementId>:version:<versionId>` (unique). An existing `succeeded` record → `already_published`, no adapter call. `failed` → retry on the same record while `attempts < max_attempts`, then 409 (`MAX_ATTEMPTS`). A `pending` record → 409 unless older than 10 minutes (treated as failed). At most one pending/succeeded record per placement (partial unique index). The mock adapter returns `sandbox: true`, an id `sandbox-<hash>` and **no URL**; the placement becomes `published` with `publication_mode = sandbox`, and sandbox publications are never counted as published anywhere. A manual publication (MKT-025) requires the actual time (not in the future) and an http(s) live link; it uses the same key, so it also blocks a later adapter publish.
6. **Steps:** transaction A (lock placement, check, create/reuse the record as `pending`) → adapter call outside the transaction → transaction B (append an attempt row, update the record, on success mark the placement published and move the item to `published`, audit).
7. **Edge cases:** adapter throws → recorded as a failed attempt; disabled adapter (`MARKETING_PUBLISHING_ADAPTER=disabled`) → non-retryable failure; DB check `publishing_records_sandbox_no_url` forbids a URL on a sandbox record.
8. **Permissions:** `marketing:content:publish` (marketing_manager only).
9. **Tests:** `unit/schedule-collab-publishing.test.ts` (“publishing rules”); `integration/placements-publishing.test.ts` (“only publishes approved, scheduled placements …”, “prevents duplicate publication”, “retries failures … then refuses”, “records a manual publication …”).
10. **Limitations:** no real adapter exists (OD-006); “republish with a reason” and the duplicate-copy warning across placements (MKT-026) are not built.

## §7 Collab rule (BR-MKT-4, CH-006, CH-007, MKT-014)
1. **Purpose:** keep exam pages pure and place comparisons / “every path” content as a collab.
2. **Inputs:** idea `{scope, scopePrefixes}`; group platform; member accounts `{code, platform, scope exam|local|company|founder, examPrefixes}`.
3. **Output:** `{valid, errors[], warnings[]}` with codes.
4. **Preconditions:** members are placements of the same idea, not cancelled/published, not already grouped.
5. **Rules:** Instagram/YouTube only; ≥ 2 members; one platform; no duplicate account; no company page; Sikar (IGS) only for `local_sikar` ideas. `single_exam` → error `SOLO_CONTENT`. `cross_exam` → every exam in `scopePrefixes` covered by a member’s exam page (`MISSING_EXAM_PAGE`) and no exam page for an uninvolved exam (`UNRELATED_EXAM_PAGE`); fewer than 2 exams → warning. `founder` → must include the founder account; exam pages → “confirm relevance” warning. `local_sikar` → must include IGS. `general` → warning (set a scope). Single placements (`checkPlacementScope`, at creation): single-exam content on another exam’s page → error; Sikar content off IGS → error; non-Sikar content on IGS → warning; cross-exam content on an exam page outside a collab → warning.
6. **Steps:** structural checks → scope-specific checks.
7. **Edge cases:** legacy GEN ideas default to `general` (or `founder` for the “Founder story” pillar) — a proposed mapping, editable per idea.
8. **Permissions:** groups `marketing:schedule:manage`; placements `marketing:content:write`.
9. **Tests:** `unit/schedule-collab-publishing.test.ts` (“collab rule”); `integration/placements-publishing.test.ts` (“collab groups”, “refuses pure exam content on another exam page …”).
10. **Limitations:** a group is per platform (an Instagram collab and a YouTube collab are two groups); scheduling does not yet require every member of a group to share one time.

## §8 Metrics CSV import (MKT-028, MKT-029, MKT-030)
1. **Purpose:** turn a Meta Business Suite or YouTube Studio export into per-post snapshots without inventing numbers.
2. **Inputs:** account code, file name, CSV text, **declared** date format (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`, `MMM D, YYYY`), capture time (default now; never in the future), dry-run flag.
3. **Output:** report `{format, headerMap, rowsTotal/Accepted/Rejected/Skipped, rejected[{rowNumber, reasons}], matchCounts, duplicate, importId}`.
4. **Preconditions:** the account is Instagram or YouTube (the expected format is checked).
5. **Rules (port of `tools/import-metrics.mjs`, defects fixed):** RFC 4180 parser with BOM handling; detection order YouTube (`video title`/`watch time`) then Instagram (`permalink`/`reach`/`post type`); headers matched exact-then-contains. **Fixes:** Instagram views come only from `views`/`plays` and impressions are stored as impressions (defect 1); dates parse only in the declared format and must be real dates (defect 2); every value has a state and the import records a capture instant (defect 4); re-importing the same file (SHA-256 per account) is a no-op instead of overwriting (defect 6). Values: blank or a “no data” marker (`-`, `--`, `n/a`) → `missing` (null); `0` → reported 0; text or negative → row rejected; metrics the platform does not report → `not_applicable`. YouTube Short/video from duration ≤ 180 s is marked `format_estimated`. Rows need a valid date and a link or title; duplicates within a file are rejected; YouTube `Total` rows are skipped.
6. **Steps:** parse → validate → match (live link = placement `published_url` → `matched_link`; else exactly one published placement on that account the same IST day → `suggested_title_date` (not linked); else `unmatched`) → (dry run stops here) → insert the import row → upsert snapshot by (account, post key, captured_at, source) → replace its values → audit.
7. **Edge cases:** empty file, unknown headers or wrong platform → 400; a re-run with a different capture time creates a new snapshot (history is kept).
8. **Permissions:** import `marketing:metrics:import` (manager, contributor); read `marketing:metrics:read`.
9. **Tests:** `unit/metrics-legacy.test.ts` (“CSV parsing”); `integration/legacy-metrics-summary.test.ts` (“validates, rejects bad rows … keeps missing distinct from zero”).
10. **Limitations:** suggested matches cannot yet be confirmed in the UI; LinkedIn/Taplio exports are not supported; files are not archived (nothing is stored but the numbers).

## §9 Weekly aggregation (MKT-029, MKT-032)
1. **Purpose:** weekly numbers per account or campaign that never treat missing as zero.
2. **Inputs:** snapshots with values and states; week (any day → IST Monday–Sunday); group by account|campaign; as-of instant.
3. **Output:** per group: posts, per-metric `{status ok|estimated|partial|missing|not_applicable, value, withData, applicable}`, IG (saves + shares) ÷ reach over posts reporting all three, median views, best post, `patternReliable` (≥ 6 posts), sources, latest capture.
4. **Preconditions:** none (pure, `domain/metrics-aggregate.ts`).
5. **Rules:** latest snapshot per (account, post) captured ≤ as-of (ties: csv_import > adapter > manual_audit, then id); posts are in the week by their publish date; sum only reported/estimated values; status `partial` when some applicable posts have no value (the sum is a lower bound), `missing` with value null when none do.
6. **Steps:** filter → dedupe → group → aggregate each metric → rates and medians.
7. **Edge cases:** no posts → no group (the screen lists accounts with no data by name); a reported 0 counts as data.
8. **Permissions:** `marketing:metrics:read`.
9. **Tests:** `unit/metrics-legacy.test.ts` (“weekly aggregation”); `integration/legacy-metrics-summary.test.ts` (“aggregates weekly with coverage …”).
10. **Limitations:** LinkedIn engagement and YouTube CTR formulas of MKT-032 are not computed; no Markdown export; monthly view not built.

## §10 Legacy import (MKT-034, MKT-035, PLT-011)
1. **Purpose:** seed Marketing OS from `data/legacy/marketing/*.json` without changing meaning.
2. **Inputs:** accounts (10 + conflict ACC-CONFLICT-001), content rules (45), ideas (59, 4 duplicate groups), placements (36), post audit (60).
3. **Output:** counts per step; rows carry `legacy_ref` (source path + line) and the raw legacy status.
4. **Preconditions:** none; runs inside one transaction (`importLegacyMarketing`).
5. **Rules:** idempotent (insert-if-absent by code or `legacy_ref`; existing rows are never overwritten). Handles only when the source says “confirmed live” (only `@elevate.clat`). Both rows of each duplicate legacy ID are **quarantined** (no code); the proposed renumbering is stored with status `proposed` and reserved, never applied (OD-003). The two placements pointing at duplicated IDs (CLAT-027-IGC, GEN-012-IGS) are imported as ambiguous, linked to the quarantine by legacy ID. Each other placement becomes one content item (title = the legacy idea title, state mapped per PRD §2.5, hold for held/parked) and one placement (status planned/scheduled/published; published → `legacy_reported`). Imported items have no approval record, so nothing imported can be scheduled or published without a fresh approval. The post audit becomes historical snapshots labelled “manual audit … not a platform export”, captured 7 Oct 2026 (date precision), blanks missing.
6. **Steps:** policies → rules → accounts + conflict → ideas → bump code counters → placements/content items → post audit.
7. **Edge cases:** a legacy “scheduled” row without a time stays planned (raw status kept); unknown account or idea → the import fails (the extract is verified).
8. **Permissions:** seed / server code only (`npm run db:seed`, seed `marketing.legacy`).
9. **Tests:** `integration/legacy-metrics-summary.test.ts` (“imports everything once and is idempotent”, “quarantines the 4 duplicate-ID groups …”, “keeps blank audit cells missing …”); `unit/metrics-legacy.test.ts` (“legacy mappings”).
10. **Limitations:** the 24-hour results in `versions.csv` are kept as raw text only (no metric snapshot); cadence numbers are the upper bound of the legacy text (proposed, OD-007).

## §11 MarketingSummaryV1 (MKT-037, PLT-009)
1. **Purpose:** read-only marketing summary for Business Ops and the platform.
2. **Inputs:** window `from`/`to` (IST dates, default last 7 days, max one year).
3. **Output:** `MarketingSummaryV1` (validated against `marketingSummaryV1Schema` before returning).
4. **Preconditions:** bearer `INTERNAL_SERVICE_TOKEN` and caller `ops` or `platform`.
5. **Rules:** ideasCaptured = ideas created in Elevate OS (legacy excluded), ok; contentApproved = approval decisions in window, ok; postsScheduled = scheduled placements with a time in the window, ok; postsPublished = live-link publications (manual/adapter), `estimated` when legacy-reported publications are included, sandbox never counted; totalReach = §9 reach (missing / estimated lower bound / ok); engagementRate, followerGrowth, leadsAttributed = `missing` with reasons; per account the same rules; data sources list the mock adapter (`sandbox`), Metricool (`not_configured`) and CSV import (`not_configured`, last import time).
6. **Steps:** query → build metrics with `metric.ok|estimated|missing` → schema parse.
7. **Edge cases:** no data → missing, never 0 for measured quantities; counts of Elevate OS records are real zeros.
8. **Permissions:** internal route (token + caller); `marketing:summary:read` exists for a future browser view.
9. **Tests:** `integration/legacy-metrics-summary.test.ts` (“requires the service token and returns a valid contract …”).
10. **Limitations:** MKT-037’s per-week “on time to original” and “overdue” are not in the v1 contract.
