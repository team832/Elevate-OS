# Marketing OS — test plan

Run: `npx vitest run apps/marketing-os` (or `npx vitest run --project marketing-os`). Integration tests use `setupTestDatabase()` (fresh in-memory PGlite with the full live schema per file) and call the real route handlers with fictional users from `createTestUser`. Fixtures: `tests/helpers.ts` (seeds policies, rules and accounts from `data/legacy/marketing`; unique titles; route caller).

Last run (2026-10-18): **11 files, 105 tests, all passing** (62 unit, 43 integration).

## Unit (`tests/unit`) — pure domain
| File | Tests | Covers (normal · boundary · missing · invalid · conflicting) |
|---|---:|---|
| `domain.test.ts` | 2 | basePath, module paths |
| `codes-duplicates.test.ts` | 16 | idea code format/parse/reserved floor; placement codes and S/L variants; title normalisation, tokens, Jaccard; duplicate kinds (exact same course → block, exact other course, similar), threshold boundary, empty title, excludeId, limit 0, invalid thresholds |
| `content-state-rules.test.ts` | 15 | every legal transition, withdraw/unschedule/revise, illegal transitions with reasons, terminal archived, edit effects; rule checker on the real 45 rules: block vs review vs checklist, account-specific rules (Sikar on IGS), strictest with no placements, flag-if-no-match, schedule rules skipped, consent (configurable) and pending rights, retired/broken rules, eligibility (missing/unexpected acknowledgements), matcher parsing |
| `schedule-collab-publishing.test.ts` | 15 | IST dates and Monday weeks; clean slot; not approved / past (hard); collision window boundary; cadence block vs warn, next-week reset; stagger and collab exception; invalid input; calendar cadence flags only over-limit posts; collab: valid comparison, missing/unrelated exam pages, Sikar, mixed platforms, solo content, too few, LinkedIn, duplicates, founder and Sikar scopes; placement scope checks; publish eligibility, attempt decisions, idempotency key, manual publication validation |
| `metrics-legacy.test.ts` | 14 | CSV parser (quotes, newlines, BOM, blanks); format detection; declared date formats incl. invalid/impossible dates; missing vs 0 vs invalid numbers; impressions never stored as views; YouTube totals, links, estimated format, not-applicable metrics; rejected rows with reasons and duplicates; file-level errors; aggregation (latest snapshot, partial/missing/ok/estimated/not-applicable, as-of, campaign grouping); legacy status/format/scope/cadence/date mappings; vocabulary mirrors the schema |

## Integration (`tests/integration`) — services + routes on PGlite
| File | Tests | Covers |
|---|---:|---|
| `routes.test.ts` | 3 | health, standalone login cookie, seed list |
| `accounts-ideas.test.ts` | 10 | registry (10 accounts, only `@elevate.clat` handle, LI cadence, OD-001 conflict); 401/403 (teacher); verify → sandbox, `connected` rejected (400), contributor 403; sequential codes; 400/403; exact duplicate 409, other-course warning, preview endpoint; **12 concurrent creates never collide**; **retry after a taken code; archived numbers never reused**; Idempotency-Key replay; edit, lifecycle, INVALID_STATE_TRANSITION |
| `content-workflow.test.ts` | 9 | full loop draft → changes requested → approved with approval history and audit; **403 contributor approving**; **self-approval refused** (requester and author), another approver succeeds; **banned phrase blocks approval** (409 BRAND_RULE_BLOCK); checklist acknowledgements required (400); consent for students blocks; **approved version immutable**, edit voids approval and returns to review; illegal transitions; comments/assignments with 401/403 for auditor/teacher/anonymous and 400 bad role |
| `placements-publishing.test.ts` | 11 | placement codes unique (409); scope rule and variant errors; scheduling 403 for contributors and **hard block before approval**; collision warning, original time kept, calendar; LI second post same day blocked; past time blocked; publish only when approved + scheduled, mock = sandbox with no URL, contributor 403; **duplicate publish prevented** (adapter called once, one record); retries up to max then 409 MAX_ATTEMPTS with 3 attempt rows; manual publication needs link + time and blocks a later publish; collab valid and SOLO_CONTENT rejected |
| `campaigns.test.ts` | 2 | campaigns: contributor 403, create 201, duplicate code 409, date order 400, list, attach placement, unknown campaign 404; settings expose OD-002/OD-003 as proposed, teacher 403; 45 rules listed |
| `legacy-metrics-summary.test.ts` | 8 | **legacy import counts and idempotency** (second run inserts nothing); quarantine of 4 groups with proposed (unapplied) codes and the ambiguous placement; next codes skip legacy and proposed numbers (CLAT-029, GEN-015); audit blanks stay missing and are labelled manual audit; **CSV import keeps missing distinct from zero**, rejects bad rows with row numbers, dry run writes nothing, re-import is a no-op, auditor 403; weekly aggregation with coverage (partial, not summed as zero); internal summary 401 without token, 403 for an unlisted caller, valid MarketingSummaryV1 with missing/estimated statuses; dashboard counts |

## Manual verification
Production build (`npm run build -w @elevate/marketing-os`) served with `next start` against a PGlite directory seeded with the core + marketing seeds (smoke test, 2026-10-18): health 200; all screens 200 for the manager; signed-out `/marketing/ideas` → 307 to `/marketing/login`; teacher sees “No access”; API flow create idea (CLAT-029) → item → placement → submit → approve → schedule → publish returned “SANDBOX: nothing was posted … no URL”, second publish `duplicate=true`; content screen shows “sandbox — nothing posted”; internal summary returned the v1 contract. Server stopped afterwards.

## Not covered (yet)
Browser E2E (Playwright deferred, D-007); real PostgreSQL lock contention (PGlite is single-connection); screen rendering unit tests.
