# Marketing OS (`@elevate/marketing-os`, `/marketing`, port 3002)

Since 22 Oct 2026 this is the **Marketing workspace** at http://localhost:3002/marketing (D-072; guide: `docs/WORKSPACES.md` at the repo root): campaigns, content and metric imports, plus the lead and follow-up screens and each person's own tasks and EOD reports, mounted from Business Ops' shared entries (D-073). Runs Elevate’s social content from idea to measured post under the brand rules, with an explicit, version-bound approval before anything is scheduled or published. Built in wave 2 by the Marketing team. **Status: Implemented and Tested in the repository; nothing is Deployed. No real platform is connected — publishing is a mock that says so.**

## 1. Scope and boundaries
- **Owns (D-010):** social accounts, ideas, content items, versions, assets (metadata), reviews, comments, assignments, placements, collab groups, publishing records/attempts, metric imports/snapshots/values, campaigns, brand rules, policy settings — all in the `marketing` schema.
- **Does not own:** leads/enquiries (Business Ops), students/consent records (Academic/platform), users and roles (platform). Output to others is `MarketingSummaryV1`. Since 22 Oct 2026 Marketing imports exactly two Business Ops entries, `@elevate/business-ops-os/work` and `@elevate/business-ops-os/leads` (ESLint `SHARED_ENTRIES`, D-073), to show the one lead record, follow-ups and own tasks in this workspace; the records stay in the `ops` schema.
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
| campaigns:read (23 Oct 2026, **Proposed**) | all | own: campaigns with a current membership | all | all |

Business Ops permissions used inside Marketing OS (22 Oct 2026, **Proposed**, D-073): marketing manager `ops:leads:read`, `ops:leads:write`, `ops:leads:assign`, `ops:lead_contacts:read` (all leads) and own `ops:tasks:read/write`; marketing contributor the same leads and lead-contact permissions with **own** scope (leads they own) and own tasks. No student-private, KYC, fee, admission or review permission: a lead opened here shows contact fields but no date of birth, address, emergency contact or KYC history, and no admission details. Marketing roles do not hold `ops:module:access`, so Business Operations stays closed to them.

teacher, admissions_counsellor, academic_coordinator, operations_manager and platform_admin have no marketing access (academic fact-checking by teachers is Proposed). Every route checks on the server (`defineRoute`); every mutating service re-checks (`assertCan`); screens use `requirePageAccess`.

**Marketing employees (23 Oct 2026, D-093, grants Proposed):** the role `marketing_contributor` is labelled "Marketing employee". `marketing.campaign_members` (owner or member, with dates, never deleted) decides what an employee sees: campaigns they are a current member of and content that is theirs or placed in those campaigns; out of scope reads as 404 (`src/server/scope.ts`, `campaign-members.ts`). Only a marketing manager adds members (no future dates) and assigns people to content. Account-level weekly metrics stay visible to employees (Proposed). New pages: `/marketing/my-campaigns`, `/marketing/deliverables`, and from Business Operations `/marketing/my-attendance`, `/marketing/my-reports`, `/marketing/notifications`. Campaign and event links on HR tasks are not offered yet (Marketing has no list route for them). Tests: `tests/integration/campaign-scope.test.ts`, `marketing-staff.test.tsx`, `tests/unit/deliverables.test.ts`.

## 4. Commands
```bash
npm run dev:marketing                       # http://localhost:3002/marketing (/ redirects there); starts or reuses the local database, which must be migrated
npm run typecheck -w @elevate/marketing-os
npx eslint apps/marketing-os packages/database/src/schema/marketing.ts packages/authorization/src/permissions/marketing.ts packages/shared-contracts/src/modules/marketing.ts --max-warnings=0
npx vitest run apps/marketing-os            # 15 test files on 22 Oct 2026 (in-memory PGlite)
npm run build -w @elevate/marketing-os
npm run db:seed                             # runs seed `marketing.legacy` after the core seeds (idempotent)
```
Environment: root `.env`; `MARKETING_PUBLISHING_ADAPTER=mock|disabled`. The dev database needs the wave-3 baseline migration (IR-MKT-02) before `db:seed`.

## 5. Screens (`AppShell` on the shared light system since 22 Oct 2026, D-074 — `marketing.css` holds only the overview panels, facts lists and the calendar grid; loading / empty / error / success states)
| Path | Permission | Shows |
|---|---|---|
| `/marketing` | module:access | Overview dashboard (22 Oct 2026): KPI tiles — content due this week, awaiting approval, campaigns running, ideas (quarantined in the note), follow-ups due today and overdue, own open tasks and the EOD state (from the Business Ops summaries; "Not available" with the reason when a summary fails or no staff record is linked) — then content items by state as bars (legacy counts in the note), accounts by integration as a donut (sandbox = mock only), campaigns running (verified results only), metric imports (last import per Instagram/YouTube account, "no data imported yet"), the content-due and awaiting-approval lists and the OD-001 alert |
| `/marketing/leads`, `/marketing/leads/:id` | `ops:leads:read` | Business Ops' lead list, pop-up and full lead (`LeadsBody`, `LeadBody`); contact fields only, no KYC |
| `/marketing/follow-ups` | `ops:leads:read` | Follow-ups list (`FollowUpsBody`; new — Ops has no page of its own) |
| `/marketing/campaigns/:id` | content:read | Campaign detail: placements and results from imported numbers only (missing stays missing); since 24 Oct also leads, demos and admissions whose enquiry campaign text equals the campaign code (exact match only; `campaignLeadOutcomes`) |
| `/marketing/tasks` (`?tab=eod`), `/tasks/:id`, `/tasks/inbox`, `/tasks/reports` | `ops:tasks:read` (own) | Own tasks and EOD report, mounted from Business Ops; report inbox only for EOD recipients and reviewers |
| `/marketing/workspaces` | signed in | Workspace chooser (D-072) |

**Sidebar (22 Oct 2026, `src/ui/shell.tsx`; every item filtered by permission — before this, everyone saw every item):** Overview, Leads, Follow-ups, Campaigns (tab Accounts), Content Calendar (tab Ideas), Tasks, EOD Reports, Reports (tabs Weekly report, Metrics import); Rules & settings at the foot. A lone tab is hidden. **Events and Webinars** is not shown: it needs a new events-only permission (`ops:appointments:*` also covers private counselling; owner decision).
| `/marketing/accounts` | accounts:read | registry, unconfirmed names/handles labelled, cadence + status, integration badge, “Check adapter” (manage) |
| `/marketing/ideas`, `/ideas/new`, `/ideas/:id` | ideas:read / ideas:write | filters, quarantine groups with proposed codes; create form; detail with live duplicate candidates, content items, placements, status change |
| `/marketing/content/:id` | content:read | versions + assets, brand-rule check, approver checklist and decision, workflow actions, placements with schedule/publish/manual record/cancel, publishing records, approval history, assignees, comments |
| `/marketing/calendar` | content:read | a day-by-day grid (one well per IST day, as many 10rem wells as fit from 720px, a 7-column week from 1440px, today marked) with each placement's time, account, state in words and clash/warning counts; conflicts listed under the grid; planned placements (not counted) |
| `/marketing/metrics/import` | metrics:read (import: metrics:import) | CSV upload/paste, declared date format, capture time, dry run; recent imports with rejected rows |
| `/marketing/metrics/weekly` | metrics:read | week by account/campaign with coverage, planned vs published (real / legacy-reported / sandbox), accounts with no data |
| `/marketing/campaigns`, `/marketing/settings` | content:read / module:access | campaigns; policies (proposed) and brand rules |

## 6. Routes
All in `docs/API.md`. 22 Oct 2026: 29 route files mounting Business Ops' task, EOD, lead, lead-source and follow-up handlers (31 until the two lead-handoff re-exports were removed, D-075), plus `POST auth/workspace`; `GET dashboard` adds `metricImports[]`. Before that, 38 route files (35 added in wave 2 plus health, login, logout: accounts, ideas, content items, placements, collab groups, campaigns, metrics, rules, settings, dashboard, plus `GET /marketing/api/internal/v1/summary`).

## 7. Data model
20 tables — `docs/DOMAIN_MODEL.md`. Algorithms — `docs/ALGORITHMS.md` (11, in the 10-point format). Layers — `docs/ARCHITECTURE.md`. Tests — `docs/TEST_PLAN.md`.

## 8. Dependencies
Workspace packages only (no new npm dependencies): `@elevate/server-kit` (routes, transactions, audit, approvals, internal routes), `@elevate/database`, `@elevate/authorization`, `@elevate/authentication`, `@elevate/notifications` (in-app review notifications), `@elevate/shared-contracts` (MarketingSummaryV1, metric builders), `@elevate/shared-types`, `@elevate/shared-ui`. Seed input: `data/legacy/marketing/*.json` (read-only).

## 9. Seeds
`marketing.legacy` (depends on core.users, core.staff_members): 9 proposed policy settings, 45 rules, 10 accounts + ACC-CONFLICT-001, 59 ideas (8 quarantined in 4 groups, proposed codes CLAT-028/GEN-014/CUET-006/COM-006 reserved, not applied), 34 content items + 36 placements (2 ambiguous) with legacy statuses preserved, 60 manual-audit snapshots. No people, no invented content, metrics or results. Re-running inserts nothing.

## 10. Status and outstanding work
Requirement-level status: `requirements/REQUIREMENTS.md`. Not built (Proposed): idea inbox (MKT-005), pillar/series lists (006), fact register (013), repurposing (019), lead-time flags (027), post reviews (031), competitor scans (033), enquiry handoff event (036; retired on 22 Oct 2026, D-075 — Marketing works the shared lead list and no other system sends leads yet), paid campaigns, block override with reason, director-only approval for fees/offers, republish with reason, hold flag API, match confirmation UI, real publishing/metrics adapters (OD-006), browser E2E tests. Requests to other owners: `docs/INTEGRATION_REQUESTS.md`.

## 11. Milestone of 23–24 Oct 2026 (D-094 … D-109; new grants Proposed, marker `PROPOSED-GRANTS-2026-10-23b`; migration `0016` applied on the owner computer)
- **Screens added:** My Day `/marketing/my-day`; Sales Calls and Follow-ups (tabs Leads, Lead stages `/marketing/leads/stages`, Sales calls `/marketing/sales-calls`, Follow-ups; mounted from Business Ops); Marketing Calendar `/marketing/calendar`, `/calendar/new`, `/calendar/:id` (item types, brief, owner, linked task, drag or "Move to…"); idea review and planning into the calendar on `/marketing/ideas/:id`; SEO / AIO / GEO `/marketing/optimisation`, `/optimisation/:id` (work items and hand-typed observations); Targets `/marketing/targets`, `/targets/:id`; Monthly report `/marketing/reports/monthly`; HR Requests `/marketing/hr-requests`; Personal Settings `/marketing/settings/personal`; notifications open through `/marketing/notifications/:id/open`; a campaign edit form on `/marketing/campaigns/:id`, which now also counts leads, demos and admissions whose enquiry campaign text equals the campaign code (§5 updated).
- **Permissions** (`marketing:calendar:*`, `marketing:optimisation:*`, `marketing:targets:*`, `marketing:reports:read`): employees write their own records, managers all; calendar approval, rescheduling and publication reuse `content:approve`, `schedule:manage` and `content:publish`. All Proposed.
- **Rules:** every Overview tile applies each filter or says "Not filtered by …", and its drill-down link carries exactly the applied filters (D-107); the monthly report stores frozen marketing facts (aggregates only) in the Business Ops monthly work report and goes to the reporting manager (D-109); admission credit for targets follows `marketing.targets.admission_attribution` (Proposed `lead_owner_at_confirmation`). Nothing is published anywhere and no analytics is connected ("Not connected").
- **Seeds:** `seed/samples.ts` (sample campaigns with owner and members, six sample ideas, calendar items in every state, one SEO, one AIO and one GEO item with hand-typed observations, targets); all `is_sample`, removed by `npm run db:clear-samples`.
- **Tests:** `tests/integration/calendar.test.ts`, `calendar-screens.test.tsx`, `ideas-plan.test.ts`, `optimisation.test.ts`, `targets.test.ts`, `perf-screens.test.tsx`, `shell-overview.test.tsx`, `seeds-samples.test.ts`, `routes.test.ts`, `overview-today.test.tsx`; `tests/unit/calendar.test.ts`, `navigation.test.ts`, `screens.test.tsx`; `packages/database/tests/constraints/marketing-0016.test.ts`.
- **Open owner questions:** register `MKT-NW-054` (monthly report routing), `MKT-NW-055` (admission credit), `MKT-NW-056` (rescheduling and cancelling own calendar items), `MKT-NW-057` (analytics not connected).
