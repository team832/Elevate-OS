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
