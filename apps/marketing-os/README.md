# Marketing OS (`@elevate/marketing-os`, `/marketing`, port 3001)

Runs Elevate’s social content from idea to measured post under the brand rules, with an explicit, version-bound approval before anything is scheduled or published. Built in wave 2 by the Marketing team. **Status: Implemented and Tested in the repository; nothing is Deployed. No real platform is connected — publishing is a mock that says so.**

## 1. Scope and boundaries
- **Owns (D-010):** social accounts, ideas, content items, versions, assets (metadata), reviews, comments, assignments, placements, collab groups, publishing records/attempts, metric imports/snapshots/values, campaigns, brand rules, policy settings — all in the `marketing` schema.
- **Does not own:** leads/enquiries (Business Ops), students/consent records (Academic/platform), users and roles (platform). No imports of other modules; output to others is `MarketingSummaryV1` only.
- **Out of scope:** AI content generation, media storage/uploads (file metadata only), video editing, posting to any real platform (D-014, D-015).

## 2. Business rules enforced
| Rule | Where |
|---|---|
| Nothing is scheduled or published without an explicit approval of the **current version** (AP-001) | `approvalValidity`, `checkPublishEligibility`; scheduling `NOT_APPROVED` is a hard block |
| Approvers: `marketing:content:approve` **and** a role in policy `approval.approver_roles` (OD-002, proposed: marketing_manager, director); the requester and the version’s author can never approve (PLT-004) | `decideContent` + server-kit |
| Brand rules (45, from `content-rules.json`): block-action matches block approval; review-action matches and manual checks form a checklist the approver must confirm | `domain/rules.ts`, ALGORITHMS §4 |
| Students on camera need a consent reference (CO-001, OD-008 proposed hard block); third-party rights pending block | `SYS-CONSENT`, `SYS-RIGHTS` |
| Approved versions are immutable; editing creates a new version, voids the approval, unschedules placements, reopens review | `addVersion` |
| Idea codes `COURSE-NNN` are unique and never reused, also across quarantined and proposed codes | `server/codes.ts`, ALGORITHMS §1 |
| Exact duplicate idea title in the same course is refused; similar titles warn with reasons | ALGORITHMS §2 |
| Placement code `<IDEA>-<ACCOUNT>[S|L]`, one per idea and account; exam pages stay pure | `buildPlacementCode`, `checkPlacementScope` |
| Collab across every exam page involved for comparisons/“every path” content (BR-MKT-4) | placement groups, ALGORITHMS §7 |
| LinkedIn personal: at most 1 post/day, 4/week (hard); proposed cadence targets warn; slot collisions and same-day stagger warn | ALGORITHMS §5 |
| One publication per (placement, version); retries ≤ `publishing.max_attempts` (proposed 3); the mock never claims a post or a URL | ALGORITHMS §6 |
| Missing is never zero: metric values carry a state; aggregates carry coverage; sandbox publications are never counted | ALGORITHMS §8–§11 |
| Business dates are Asia/Kolkata days; weeks run Monday–Sunday | `domain/week.ts` |

Open owner decisions are visible on **Rules & settings** as `proposed`: OD-001 account model (conflict ACC-CONFLICT-001), OD-002 approvers, OD-003 duplicate legacy IDs, OD-005 IPMAT/CA comparison rule, OD-007 cadence/slot window, OD-008 consent. OD-006 (publishing tool) keeps every account `not_configured` or `sandbox`.

## 3. Permissions (least privilege, `packages/authorization/src/permissions/marketing.ts`)
| Permission | manager | contributor | director | auditor |
|---|:-:|:-:|:-:|:-:|
| module:access, ideas:read, content:read, metrics:read, accounts:read | ✓ | ✓ | ✓ | ✓ |
| ideas:write, content:write (drafts, versions, submit, comment, plan placements) | ✓ | ✓ | | |
| content:approve | ✓ | | ✓ | |
| schedule:manage (schedule, unschedule, collabs) | ✓ | | ✓ | |
| content:publish (adapter or manual record) | ✓ | | | |
| metrics:import | ✓ | ✓ | | |
| accounts:manage, campaigns:write | ✓ | | | |
| summary:read | ✓ | | ✓ | ✓ |

teacher, admissions_counsellor, academic_coordinator, operations_manager and platform_admin have no marketing access (academic fact-checking by teachers is Proposed). Every route checks on the server (`defineRoute`); every mutating service re-checks (`assertCan`); screens use `requirePageAccess`.

## 4. Commands
```bash
npm run dev:marketing                       # http://localhost:3001/marketing (needs a database with the schema)
npm run typecheck -w @elevate/marketing-os
npx eslint apps/marketing-os packages/database/src/schema/marketing.ts packages/authorization/src/permissions/marketing.ts packages/shared-contracts/src/modules/marketing.ts --max-warnings=0
npx vitest run apps/marketing-os            # 11 files, 105 tests (in-memory PGlite)
npm run build -w @elevate/marketing-os
npm run db:seed                             # runs seed `marketing.legacy` after the core seeds (idempotent)
```
Environment: root `.env`; `MARKETING_PUBLISHING_ADAPTER=mock|disabled`. The dev database needs the wave-3 baseline migration (IR-MKT-02) before `db:seed`.

## 5. Screens (`AppShell`, loading / empty / error / success states)
| Path | Permission | Shows |
|---|---|---|
| `/marketing` | module:access | items by state (legacy share), accounts by integration status, quarantine count, awaiting approval (flags imported items without a request), next 7 days, overdue scheduled, OD-001 alert |
| `/marketing/accounts` | accounts:read | registry, unconfirmed names/handles labelled, cadence + status, integration badge, “Check adapter” (manage) |
| `/marketing/ideas`, `/ideas/new`, `/ideas/:id` | ideas:read / ideas:write | filters, quarantine groups with proposed codes; create form; detail with live duplicate candidates, content items, placements, status change |
| `/marketing/content/:id` | content:read | versions + assets, brand-rule check, approver checklist and decision, workflow actions, placements with schedule/publish/manual record/cancel, publishing records, approval history, assignees, comments |
| `/marketing/calendar` | content:read | scheduled/published by IST date and account with hard/warning conflicts; planned (not counted) |
| `/marketing/metrics/import` | metrics:read (import: metrics:import) | CSV upload/paste, declared date format, capture time, dry run; recent imports with rejected rows |
| `/marketing/metrics/weekly` | metrics:read | week by account/campaign with coverage, planned vs published (real / legacy-reported / sandbox), accounts with no data |
| `/marketing/campaigns`, `/marketing/settings` | content:read / module:access | campaigns; policies (proposed) and brand rules |

## 6. Routes
All in `docs/API.md` (38 route files — 35 added in wave 2 plus health, login, logout: accounts, ideas, content items, placements, collab groups, campaigns, metrics, rules, settings, dashboard, plus `GET /marketing/api/internal/v1/summary`).

## 7. Data model
20 tables — `docs/DOMAIN_MODEL.md`. Algorithms — `docs/ALGORITHMS.md` (11, in the 10-point format). Layers — `docs/ARCHITECTURE.md`. Tests — `docs/TEST_PLAN.md`.

## 8. Dependencies
Workspace packages only (no new npm dependencies): `@elevate/server-kit` (routes, transactions, audit, approvals, internal routes), `@elevate/database`, `@elevate/authorization`, `@elevate/authentication`, `@elevate/notifications` (in-app review notifications), `@elevate/shared-contracts` (MarketingSummaryV1, metric builders), `@elevate/shared-types`, `@elevate/shared-ui`. Seed input: `data/legacy/marketing/*.json` (read-only).

## 9. Seeds
`marketing.legacy` (depends on core.users, core.staff_members): 9 proposed policy settings, 45 rules, 10 accounts + ACC-CONFLICT-001, 59 ideas (8 quarantined in 4 groups, proposed codes CLAT-028/GEN-014/CUET-006/COM-006 reserved, not applied), 34 content items + 36 placements (2 ambiguous) with legacy statuses preserved, 60 manual-audit snapshots. No people, no invented content, metrics or results. Re-running inserts nothing.

## 10. Status and outstanding work
Requirement-level status: `requirements/REQUIREMENTS.md`. Not built (Proposed): idea inbox (MKT-005), pillar/series lists (006), fact register (013), repurposing (019), lead-time flags (027), post reviews (031), competitor scans (033), enquiry handoff event (036), paid campaigns, block override with reason, director-only approval for fees/offers, republish with reason, hold flag API, match confirmation UI, real publishing/metrics adapters (OD-006), browser E2E tests. Requests to other owners: `docs/INTEGRATION_REQUESTS.md`.
