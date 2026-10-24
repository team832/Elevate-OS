# Marketing OS — API

All browser routes live under `/marketing/api/v1/…` and are built with `defineRoute` (D-012): success `{ "data": … }`, failure `{ "error": { code, message, details?, requestId } }`. Check order (22 Oct 2026, D-072): 403 for a `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` is neither this origin nor a configured app origin → 401 `UNAUTHENTICATED` → 403 "Your roles do not include this workspace." without `marketing:module:access` → 403 `FORBIDDEN` (before validation) → 400 `VALIDATION_FAILED` (`details: [{location, path, message}]`) → handler. Bodies are JSON with the media type `application/json` exactly (`text/plain;application/json` is 400). A PG unique violation is 409 `CONFLICT`; illegal state changes are 409 `INVALID_STATE_TRANSITION`. `:id` is a UUID. Every mutating service also re-checks its permission (`assertCan`) and writes `core.audit_events` in the same transaction.

Screens use server actions (`src/app/actions/*.ts`) that call the same services; the session is read on the server and the service enforces the permission.

## Accounts
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/accounts` | `marketing:accounts:read` | — | `{accounts[], conflicts[]}` (conflict ACC-CONFLICT-001 / OD-001) |
| GET | `/accounts/:id` | `marketing:accounts:read` | — | account; 404 |
| PATCH | `/accounts/:id` | `marketing:accounts:manage` | any of `displayName`, `handle` (confirmed only), `ownerStaffId`, `status`, `cadenceMaxPerDay`, `cadenceMaxPerWeek`, `cadenceEnforcement`, `contentRules` (strict: `integrationStatus` is rejected) | account; 400; 404 |
| POST | `/accounts/:id/verify-connection` | `marketing:accounts:manage` | — | account with the adapter’s honest status (mock → `sandbox`, never `connected`) |

## Ideas
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/ideas` | `marketing:ideas:read` | `?q&course&status&quarantined=true|false&limit≤500` | idea rows |
| POST | `/ideas` | `marketing:ideas:write` (+ optional `Idempotency-Key`) | `{coursePrefix, title, pillar?, series?, objective?, audience?, brief?, source?, masterAsset?, notes?, scope?, scopePrefixes?}` | 201 `{idea, duplicates{decision, candidates}}`; 409 exact same-course duplicate (`details.duplicates`); 400 |
| POST | `/ideas/duplicate-check` | `marketing:ideas:read` | `{title, coursePrefix, excludeId?}` | `{decision, normalizedTitle, candidates}` (writes nothing) |
| GET | `/ideas/quarantine` | `marketing:ideas:read` | — | groups `{legacyCode, ideas[], ambiguousPlacements[]}` (OD-003) |
| GET | `/ideas/:id` | `marketing:ideas:read` | — | `{idea, contentItems, placements, duplicates}`; 404 |
| PATCH | `/ideas/:id` | `marketing:ideas:write` | idea fields (partial) | `{idea, duplicates}`; 409 duplicate; 409 archived |
| POST | `/ideas/:id/status` | `marketing:ideas:write` | `{status, reason?}` (reason required for held/rejected) | idea; 409 `INVALID_STATE_TRANSITION` |
| POST | `/ideas/:id/content-items` | `marketing:content:write` | `{title, format, initialVersion?}` | 201 item; 409 quarantined/archived idea |

## Content items
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/content-items` | `marketing:content:read` | `?state` | `{item, ideaCode, ideaTitle}[]` (archived excluded unless `state=archived`) |
| GET | `/content-items/:id` | `marketing:content:read` | — | detail: item, idea, versions (+assets), live rule check, approvals (history), reviews, comments, assignments, placements (+publishing records), allowed actions |
| POST | `/content-items/:id/versions` | `marketing:content:write` | `{title?, body, assets[{fileName, mimeType, sizeBytes?, externalUrl?, showsStudents, rightsState}], showsStudents, consentReference?, changeNote?}` | 201 `{item, version, approvalVoided, ruleCheck}`; 409 in review / published / archived |
| POST | `/content-items/:id/submit` | `marketing:content:write` | `{comment?}` | `{item, ruleCheck}`; 409; 400 no version |
| POST | `/content-items/:id/withdraw` | `marketing:content:write` | — | item; 403 not the requester; 409 |
| POST | `/content-items/:id/decision` | `marketing:content:approve` + approver role (OD-002) | `{decision: approve|request_changes, comment?, acknowledgedRuleCodes[]}` | `{item, approval, ruleCheck}`; 403 requester/author/role; 409 `BRAND_RULE_BLOCK`; 400 `CHECKLIST_NOT_ACKNOWLEDGED` or missing comment |
| POST | `/content-items/:id/archive` | `marketing:content:write` | `{reason}` | item (open placements cancelled) |
| PUT | `/content-items/:id/assignments` | `marketing:content:write` | `{role: writer|designer|editor|presenter, userId?, staffMemberId?}` (none = clear) | assignment or null |
| POST | `/content-items/:id/comments` | `marketing:content:write` or `marketing:content:approve` | `{body, versionId?}` | 201 comment |
| POST | `/content-items/:id/placements` | `marketing:content:write` | `{accountCode, variant?: short|long}` | 201 `{placement, warnings}`; 409 code exists; 400 scope rule / variant off YouTube; 409 account `later` |

## Placements, collabs, campaigns
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/placements` | `marketing:content:read` | `?from&to` (IST dates, ≤ 62 days) `&account` | scheduled/published placements with `conflicts{hard, warnings}` |
| POST | `/placements/:id/schedule` | `marketing:schedule:manage` | `{publishAt}` (ISO with offset) | `{placement, warnings}`; 409 with `details.hard` |
| POST | `/placements/:id/unschedule` | `marketing:schedule:manage` | — | placement |
| POST | `/placements/:id/cancel` | content:write (planned) / schedule:manage (scheduled) | `{reason}` | placement |
| POST | `/placements/:id/publish` | `marketing:content:publish` | — | `{outcome, duplicate, record, message, attemptsLeft?}`; 409 not eligible / `MAX_ATTEMPTS` / running |
| POST | `/placements/:id/publication` | `marketing:content:publish` | `{publishedAt, url}` (both required) | 201 `{placement, record}`; 400; 409 |
| PUT | `/placements/:id/campaign` | `marketing:campaigns:write` | `{campaignId \| null}` | placement |
| POST | `/placement-groups` | `marketing:schedule:manage` | `{ideaId, platform: instagram|youtube, placementIds[2..10]}` | 201 `{group, validation}`; 400 with `details.errors` |
| GET | `/placement-groups/:id` | `marketing:content:read` | — | `{group, members, validation}` |
| GET | `/campaigns` | `marketing:content:read` | — | campaigns |
| POST | `/campaigns` | `marketing:campaigns:write` | `{code, name, objective?, startsOn?, endsOn?, status?}` | 201; 409 code exists |

## Metrics, reports, settings
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/metrics/imports` | `marketing:metrics:read` | — | recent imports with rejected rows |
| POST | `/metrics/imports` | `marketing:metrics:import` | `{accountCode, fileName, csv, dateFormat, capturedAt?, dryRun?}` | 201 stored; 200 dry run or `duplicate: true`; 400 unknown format / wrong platform / future capture |
| GET | `/metrics/weekly` | `marketing:metrics:read` | `?week=YYYY-MM-DD&groupBy=account|campaign` | `{window, asOf, aggregation, accounts[], accountsWithNoData[]}` |
| GET | `/rules` | `marketing:content:read` | — | brand rules |
| GET | `/settings` | `marketing:module:access` | — | `{policies[], conflicts[]}` |
| GET | `/dashboard` | `marketing:content:read` | — | counts (items by state, awaiting approval, upcoming, overdue, accounts by integration, quarantine); since 22 Oct 2026 also `metricImports[]`: `{ accountCode, lastImportedAt, lastCapturedAt }` per Instagram/YouTube account (`null` when never imported) |

## Internal (server-to-server)
| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/marketing/api/internal/v1/summary?from&to` | `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` + `X-Elevate-Caller: ops|platform` (401 / 403 otherwise) | `MarketingSummaryV1` (missing ≠ zero; ALGORITHMS §11) |

## Unchanged from the skeleton
`GET /marketing/api/v1/health` (public), `POST /marketing/api/v1/auth/login|logout`.

## Sign-in and workspace chooser (changed and added 22 Oct 2026, D-072)
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| POST | `/marketing/api/v1/auth/login` (changed) | public | form `email`, `password`, `next?` (relative path; control characters and backslashes refused) | form post: 303 to the landing: stay in Marketing OS (at `next`) if you belong here; else your remembered workspace; else your only one; else `/marketing/workspaces`; 403 cross-site `Origin`; 401 wrong email or password |
| POST | `/marketing/api/v1/auth/logout` (changed) | session | — | 303 to sign-in; the session ends on every port; 403 cross-site `Origin` |
| POST | `/marketing/api/v1/auth/workspace` (new) | signed in | form `workspace` (`ops` \| `academic` \| `marketing`), `remember=yes` (optional) | 303 to that workspace's home; `remember=yes` stores `core.users.preferred_workspace`, audited `user.workspace_preference_set`; 303 to sign-in when signed out; 403 a workspace you do not belong to; 403 cross-site `Origin` |

## Leads, follow-ups, tasks and EOD reports mounted from Business Ops (22 Oct 2026, D-073)
31 route files under `/marketing/api/v1/` re-export Business Ops' handlers (`leadsRoutes` from `@elevate/business-ops-os/leads`, `workRoutes` from `@elevate/business-ops-os/work`):
- **Leads (14):** `leads`, `leads/:id`, `leads/:id/accept`, `…/activities`, `…/assign`, `…/enquiries`, `…/history`, `…/merge`, `leads/check-duplicates`, `leads/duplicates`, `leads/duplicates/:id`, `lead-sources`, `follow-ups`, `follow-ups/:id`. (`leads/handoffs` and `leads/handoffs/:id/retry` were removed on 22 Oct 2026 with the retired handoff flow, D-075.)
- **Tasks and EOD (15):** `staff-tasks`, `staff-tasks/:id`, `staff-tasks/:id/:action`, `…/dependencies`, `…/reassign`, `…/report`, `…/updates`, `eod-reports`, `eod-reports/:id`, `…/csv`, `…/follow-up`, `…/pdf`, `…/review`, `…/submit`, `task-reports`.

Permissions, requests, responses and errors are those in `apps/business-ops-os/docs/API.md`; the workspace check here is `marketing:module:access`. Marketing roles hold (Proposed, D-073): manager `ops:leads:read/write/assign` and `ops:lead_contacts:read` on every lead, contributor the same on own leads only, both own `ops:tasks:read/write`. Routes that need other permissions (merge needs `ops:leads:merge`) answer 403 to marketing roles. A lead read here returns contact fields but no KYC fields, no KYC history and only `{ id, code, status, createdAt, programmeCode }` for admission cases. Tests: `tests/integration/shared-entries.test.ts`; `apps/business-ops-os/tests/integration/shared-entries.test.tsx`, `lead-kyc-masking.test.ts`.

## Added on 23 Oct 2026 (campaign membership and staff pages, D-091 … D-093; grants Proposed)
| Method | Path | Permission | Request | Response / notes |
|---|---|---|---|---|
| GET | `/campaigns` | `marketing:campaigns:read` | — | All campaigns (managers, director, auditor) or, at own scope, only those the marketing employee is a current member of |
| GET | `/campaigns/:id/members` | `marketing:campaigns:read` | — | Current and past members; 404 out of scope |
| POST | `/campaigns/:id/members` | `marketing:campaigns:write` | `{ staffId, role?: owner or member (default member), fromDate? (default today IST) }` | Adds a membership (marketing manager); a date in the future (IST) → 400 |
| PATCH | `/campaigns/:id/members/:memberId` | `marketing:campaigns:write` | `{ toDate? (default today IST, never in the future) }` | Ends a membership; rows are never deleted |
| PUT | `/content-items/:id/assignments` | `marketing:content:write` | `assignmentBody` | Only a marketing manager assigns people to content (others → 403) |

Out-of-scope campaigns and content read as 404, never 403. Mounted from Business Operations (same handlers): `/marketing/api/v1/attendance`, `…/attendance/corrections`, `…/ai/report-draft`, `…/attachments`, `…/notifications`, `…/staff-tasks/{id}/checklist`. Pages: `/marketing/my-campaigns`, `/marketing/deliverables`, `/marketing/my-attendance`, `/marketing/my-reports`, `/marketing/notifications`.

## Added on 23–24 Oct 2026 (milestone: content calendar, SEO/AIO/GEO, targets, monthly report, personal settings; grants Proposed)
Paths are under `/marketing/api/v1` unless shown in full. Every new grant is marked `PROPOSED-GRANTS-2026-10-23b`. Nothing is Deployed.

### Content calendar (Implemented, Tested: `tests/integration/calendar.test.ts`, `ideas-plan.test.ts`, `calendar-screens.test.tsx`, `tests/unit/calendar.test.ts`)
Schemas: `src/server/calendar.ts`, `calendar-plan.ts`. Statuses: idea, planned, in_production, submitted, approved, scheduled, published, changes_requested, cancelled. Times are entered in IST.
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/calendar-items` | `marketing:calendar:read` | `?from&to` (ISO with offset; `[from, to)`), `owner`, `status`, `campaign` | items with owner, campaign and course names; every calendar reader sees every item (only writes are limited to own items) |
| POST | `/calendar-items` | `marketing:calendar:write` (`Idempotency-Key` optional) | `{ title, itemType: social_post\|short_video\|article\|webinar\|seminar\|admission_campaign\|email_draft\|landing_page_update, programmeId?, audience?, channel?, campaignId?, ownerStaffId?, brief?, assetLinks[≤20]?, plannedAt? }` (strict) | 201; starts Planned with `plannedAt`, else Idea. 403 a marketing employee naming another owner or none; 400 owner not active Marketing & Growth staff, course or campaign gone |
| GET | `/calendar-items/:id` | `marketing:calendar:read` | — | item; 404 |
| PATCH | `/calendar-items/:id` | `marketing:calendar:write` | the fields above (partial, at least one) | item. 403 not an item you own or created (managers excepted); 409 after submission unless changes were requested |
| POST | `/calendar-items/:id/:action` | the action's own permission: `plan`, `start`, `submit`, `cancel` → `marketing:calendar:write`; `approve`, `request-changes` → `marketing:content:approve`; `schedule` → `marketing:schedule:manage`; `publish` → `marketing:content:publish`; `move` → `marketing:schedule:manage` | `{ plannedAt?, note?, reason?, publishedAt?, url?, evidence? }` (strict) | item. 400: `plan` / `move` without a date, `request-changes` without a note, `publish` without a link or evidence or with a future time, `cancel` without a reason. 403 approving an item you own or created. 409 `INVALID_STATE_TRANSITION` (e.g. moving a published item). Publishing records what staff did; nothing is posted |
| POST | `/calendar-items/:id/task` | `marketing:calendar:write` | — | 201 `{ taskId, created: true }` (an Ops task for the item's owner, created once); then 200 with the same id; 409 cancelled or published item |
| POST | `/ideas/:id/plan` | `marketing:calendar:write` | `{ plannedAt?, itemType? (needed when the idea has no format), createTask? }` (strict) | 201 `{ item, created, taskId }`; 200 with the same item when the idea was already planned; 409 idea not approved |

### SEO / AIO / GEO work (Implemented, Tested: `tests/integration/optimisation.test.ts`, `perf-screens.test.tsx`)
Schemas: `src/server/optimisation.ts`. Observations are typed in by staff; no analytics tool is connected.
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/optimisation` | `marketing:optimisation:read` | `?category&state` | work items (all of Marketing reads them) |
| GET | `/optimisation/categories` | `marketing:optimisation:read` | — | configured categories and their meanings |
| POST | `/optimisation` | `marketing:optimisation:write` (`Idempotency-Key` optional) | `{ pageUrl, topic, targetQuery?, categoryKey, baselineObservation?, requiredChange?, ownerStaffId?, dueOn?, measurementSource?, observationOn?, checks[] }` (strict) | 201. 400 unknown category, owner not active Marketing & Growth staff; 403 a marketing employee giving work to someone else |
| GET | `/optimisation/:id` | `marketing:optimisation:read` | — | item, checklist, evidence, review and observations; 404 |
| PATCH | `/optimisation/:id` | `marketing:optimisation:write` | the fields above, `evidence?`, `done[]` (ticked checks); partial | item. 403 not your own (employees); 409 not a draft or an item sent back |
| POST | `/optimisation/:id/submit` | `marketing:optimisation:write` | — | item; 400 no evidence; 409 not a draft or sent back |
| POST | `/optimisation/:id/review` | `marketing:optimisation:review` | `{ decision: approved\|changes_requested, note? }` | item; 403 your own work; 400 changes without a note; 409 not submitted |
| POST | `/optimisation/:id/observations` | `marketing:optimisation:write` (`Idempotency-Key` optional) | `{ platform, query, observedOn (not in the future), result, note? }` | 201; append-only |

### Targets and the monthly report (Implemented, Tested: `tests/integration/targets.test.ts`, `perf-screens.test.tsx`; internal route also `apps/business-ops-os/tests/integration/work-report-marketing.test.ts`)
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | `/targets` | `marketing:targets:read` | `?from&to&scope=employee\|team\|campaign&staffId&campaignId` | targets with actual and remaining (own scope: yours) |
| POST | `/targets` | `marketing:targets:manage` (`Idempotency-Key` optional) | `{ scope, staffId? (employee only), campaignId? (campaign only), periodStart, periodEnd, metricKey: qualified_leads\|follow_ups_completed\|demo_bookings\|verified_admissions\|approved_content\|published_content\|campaign_deliverables, targetValue (1–100000), note? }` | 201; 400 period order or scope/id mismatch; 409 same target and period exists |
| GET | `/targets/:id` | `marketing:targets:read` | — | the records behind the actual and the remaining target; 404 |
| PATCH | `/targets/:id` | `marketing:targets:manage` | `{ periodStart?, periodEnd?, targetValue?, note? }` | target; 409 duplicate period |
| DELETE | `/targets/:id` | `marketing:targets:manage` | — | removed (audited with its last values) |
| GET | `/reports/monthly` | `marketing:reports:read` | `?month=YYYY-MM&staffId` (defaults: this month, you) | `{ staffId, month, snapshot }` of live marketing facts; at own scope someone else's report → 404; 404 login not linked to a staff record. Writing and submitting the report is the Business Ops monthly work report (`ops.eod_reports`, period month) |
| GET | `/marketing/api/internal/v1/reports/monthly` | internal, caller `ops` | `?staffId&month=YYYY-MM&cutoffAt?` | `MarketingMonthlySnapshotV1` (aggregates only), which Business Ops freezes into the monthly report version; 404 unknown staff or month |

### Campaigns, personal settings (changed and added)
| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| PATCH | `/campaigns/:id` (new method) | `marketing:campaigns:write` | any of `{ name, objective, startsOn, endsOn, status, programmeId, audience, channels[] }` (strict, at least one) | campaign (audited). 400 start after end, unknown or retired course; 409 status change not allowed from the current status. Tested: `integration/shell-overview.test.tsx`, "campaign edit and status change (marketing:campaigns:write)" (401/403/400/404, transitions, channel dedupe, audit) |
| GET | `/settings/personal` | `marketing:module:access` | — | your own settings `{ marketing: { dashboard, calendarView, workingHours, focusBlocks… }, notifications: { reminderIntervalHours, popUps } }` (defaults when none saved). Tested: `tests/integration/shell-overview.test.tsx` |
| PUT | `/settings/personal` | `marketing:module:access` | the whole object above (strict; no user id is accepted) | the saved settings. Personal choices only reduce optional notices, never mandatory ones |

### Mounted from Business Operations (same handlers and permissions as `apps/business-ops-os/docs/API.md`, "Routes added or changed on 23–24 Oct 2026")
- **Leads:** `leads/calls` (GET, POST), `leads/:id/stage` (POST), `lead-stages` (GET, POST), `lead-stages/:key` (PATCH, DELETE) — from `leadsRoutes`. Stage settings need `ops:leads:assign` (marketing manager); employees work stages on their own leads.
- **Requests through HR:** `hr-requests` (GET, POST), `hr-requests/:id` (GET, PATCH), `hr-requests/:id/:action` (POST) — from `workRoutes`.
- **Notifications:** `GET /marketing/notifications/:id/open` (page route; `notificationOpen`).

Pages: `/marketing/calendar` (+ `/new`, `/:id`), `/marketing/optimisation` (+ `/:id`), `/marketing/targets` (+ `/:id`), `/marketing/reports/monthly`, `/marketing/sales-calls`, `/marketing/leads/stages`, `/marketing/settings/personal`, `/marketing/hr-requests`.
