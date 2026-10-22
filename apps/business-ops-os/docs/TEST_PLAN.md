# Business Ops OS — test plan

HR and Operations were removed by the owner on 2026-10-20 (D-032); their tests (HR records/lifecycle/time, tasks, SOPs, operations, legacy import, access revocation) were deleted and are recoverable from commit 63da4e4.

Run: `npx vitest run apps/business-ops-os` (or `npx vitest run --project business-ops-os`). Unit tests are pure; integration tests use `setupTestDatabase()` (fresh in-memory PGlite with the live schema per file, D-025) and call the real route handlers with `authedRequest` / `callRoute`. All people and contacts are fictional; secret-like values use `test-only-`.

## Unit tests (`tests/unit/`)
| File | Algorithm / rule | Cases (normal · boundary · missing · invalid · conflicting) |
|---|---|---|
| `contacts.test.ts` | A-01, A-02 | 13 Indian formats incl. `+91 (0)`, `0091`, `091`, trunk 0; landline; international; missing/blank/null; letters, extensions, `+` in the middle; 9/11-digit boundaries; leading-zero national number; idempotence; email trim/case, no Gmail rewriting; name normalisation; Jaro-Winkler; sibling surnames not similar; exact/possible/none classification, weak name signal ignored, missing data, self-match, deterministic order |
| `pipeline.test.ts` | A-03 | happy path; table integrity; terminal states; BR-OPS-4 guard; illegal jumps; NO_CHANGE; demo-skip proposal on/off + reason; readiness guard; handoff-only transition; system-only replies; lost/on-hold reasons; resume to held status only; cannot lose while awaiting Academic |
| `admission-followups.test.ts` | A-04, A-05, A-06 | readiness normal / all missing / same-person verifications / pending approval / configurable parts / not-applicable; verifier separation; IST date at 18:29:59Z vs 18:30Z; Mon–Sun weeks; closed-weekday shift; due rules incl. Sunday 00:10 IST; **overdue timezone boundary**; upcoming/later/closed; flags; reminder selection once per day, unreachable owners |
| `kpis.test.ts` | A-12, A-14 | new leads IST boundary and merged exclusion, real 0; cohort conversion normal, boundary N days, **denominator zero → missing (not 0 %)**, window not elapsed; latest elapsed cohort; follow-up compliance incl. on-time at 23:50 IST and denominator zero; overdue follow-ups; workload (follow-ups + admissions) sorted by name |
| `staff-settings.test.ts` | A-10, settings, A-16 | reporting loops; settings defaults (demo fee not approved, limits open), stored override, invalid stored → default, change validation stays proposed; business code formats (lead, admission, fee) |
| `domain.test.ts` | module paths | basePath |

## Integration tests (`tests/integration/`, PGlite)
| File | Covers |
|---|---|
| `leads.test.ts` | 401 / 403 (auditor, teacher) / 400 (bad phone with path, no contact); 201 with normalised contacts, owner, admission, first-contact follow-up; exact duplicate → 409 with matches, acknowledged → 201 + flag, never merged; possible duplicate saved with warning; preview hides inaccessible names; **own scope** (counsellor list and 403 on another's lead); assignment 403 for counsellor, handoff pending → accept; BR-OPS-4 contact logging; second enquiry opens a second case; merge 403 for counsellor, merge by manager keeps enquiries, closes source case, history |
| `admissions.test.ts` | full pipeline through routes (contact → counselling → demo with 2-day terms and ₹1,000 `pending_verification` fee → attended → admission pending); confirmation gate 409 with missing items; same-person verification 409; fee approval: counsellor 403, requester self-approval 403, director approves; demo fee adjusted on admission; illegal/forbidden transitions; **outbox handoff: one event per request, double submit → one event, Idempotency-Key replay, failing payload rolls back; reply processed twice → one transition; rejected → admitted with reason, attempt 2 with new key, stale reply ignored**; job route 403 for counsellor |
| `organisation.test.ts` | staff admin permissions; reporting loop 409; settings stay proposed, legacy-approved read-only, auditor 403 |
| `sample-placeholders-seed.test.ts` | sample fee-schedule setting: idempotent, proposed, labelled "Sample — replace", nothing approved |
| `dashboard.test.ts` | **stubbed fetch**: HTTP 503, network error, wrong shape → "unavailable"; valid → available; documented URLs; rendered panel shows "Source unavailable" and "Missing"; dashboard 403 for counsellor; empty rates missing, counts 0; workload alphabetical; reminder job idempotent and manager-only |
| `seeds.test.ts` | core + Ops seeds twice: idempotent counts (12 sources, 6 fictional leads with no phones, 10 fictional staff, 3 fee records) |
| `routes.test.ts` | health, standalone login, seed export |

## Not automated
Browser E2E (Playwright deferred, D-007); page rendering of every screen (pages are covered by `npm run build` type-checking plus the panel render test). The cross-module handoff is now tested: see the platform tests below.


---

# Added on 19 Oct 2026 (admissions)

**Result at commit ce7589c** (whole repository, `npm test`): Test Files 86 passed, Tests 896 passed, 1 todo (the `it.todo` for Academic reusing `existingStudentId`, IR-OPS-ADM-1). Typecheck, lint and the secret scan (912 files) passed. "it blocks" below are counted from the source and are a guide, not the runner's count.

Fixtures: `fixtures.ts`, `admissions-fixtures.ts`. Each integration file builds a fresh PGlite database (D-025), uses fictional people only, and calls the real route handlers or services. Every fee route has 401 and 403 cases; field-level protection is tested per role.

## Unit tests (`tests/unit/`)
| File (it blocks) | Algorithms | Covers |
|---|---|---|
| `admissions-fees.test.ts` (15) | A-17 | Rupee text to paise without floats; amount limits; direction only on adjustments; receipt reference setting; refund cap; demo credit once and capped; summary with voided rows; balance `null` when no due entry; state labels |
| `admissions-students-kpis.test.ts` (14) | A-18, A-20 | Directory state mapping; private-key redaction (also deep, in audit payloads); closure reason codes; enquiries count; pipeline snapshot; counselling and demos; handoff success rate and view; retry decision; overdue follow-ups; IST boundary |

## Integration tests (`tests/integration/`, PGlite)
| File (it blocks) | Covers |
|---|---|
| `admissions-fees.test.ts` (5) | 401 without a session; recording needs `ops:fees:record`; reads follow own scope; due, received, refund and credit entries with computed balance, audited and labelled manual; refund cannot exceed what was received; finance list paginated by code |
| `admissions-students.test.ts` (6) | Directory lists admitted students only; profile 404 before admission and 403 outside scope; reason-coded closure (withdrawal); handoff retry after a dead delivery (refused while Academic retries; superseded attempt's late reply flagged); lead contact masking; consent and preferences |
| `admissions-report.test.ts` (3), `seeds.test.ts` (2) | Report per role and own scope; missing is not 0; the one sample set (D-036) runs twice without duplicates, every lead/student is flagged sample with a "Sample" name and no phone, real teachers get no sample event, each class has its subject's sample teacher; `db:clear-samples` removes every sample row and keeps the owner-supplied staff |

## Platform and cross-module tests
| File | Covers |
|---|---|
| `apps/platform/tests/integration/enrolment-handoff.test.ts` (6 cases + 1 `it.todo`) | Ops `requestEnrolment` → Academic consumer `academic.enrolment-intake` → reply → Ops `processEnrolmentReplies`: success with references; repeated request and redelivery never create a second enrolment or student; invalid batch rejected with a reason, corrected re-request (attempt 2) enrols once; recoverable failure retried automatically; dead delivery then audited retry (attempt 2) gives one enrolment; second programme for the same person (Ops sends `existingStudentId`). Closes IR-OPS-03. The todo is the Academic side (IR-OPS-ADM-1). |

## Not automated
Browser E2E (Playwright deferred, D-007). A scheduler (none exists).


---

# Added on 20 Oct 2026 (admissions workspace)

New files (unit in `tests/unit/`, integration in `tests/integration/`, PGlite per file, fictional people only): `demos.test.ts` (unit + integration), `admission-numbers.test.ts`, `student-lifecycle.test.ts`, `conversion.test.ts` (+ `conversion-fixtures.ts`), `students-profile.test.ts`, `appointments-feedback.test.ts`, `appointments.test.ts`, `feedback.test.ts`, `fee-plans.test.ts` (unit + integration), `fee-plans-seed.test.ts`, `lead-intake.test.ts`, `admissions-funnel.test.ts`, `admissions-report-funnel.test.ts`. Slice runs reported by the build agents on 20 Oct 2026: demos 2 files / 61 tests passed; meetings 3 files / 47 tests passed; the other slices were run inside each agent's report. The whole-suite result is in `IMPLEMENTATION_STATUS.md` ([TODO coordinator: validate numbers]).

## Owner brief §19 → test file and case
| Brief §19 test | Rule / requirement | File → case |
|---|---|---|
| 3 sessions for the fixture | OPS-080, OPS-088 | integration `demos.test.ts` → "creates Tanisha as described in the brief, labelled sample, idempotently"; "401 / 403 / 400 / 201 with N = 3 sessions…" |
| x/3 progress | A-57 | unit `demos.test.ts` → "D-1 progress counts only present" |
| Cancelled / scheduled not counted | A-57 | same unit case; integration "records, refuses before start… only present counts"; "reschedule… (still not attended)" |
| Current / upcoming / previous filtering | A-58 | unit "D-2 view at IST calendar boundaries"; integration "upcoming / current / previous filter correctly, counts come from the same query, own scope applies" |
| Checklist history | A-63 | unit "D-7 checklist" → "latest entry per item wins, history kept"; integration "checklist: waiver needs a reason, derived items are read-only, latest entry wins" |
| Conversion once + demo preserved | A-67 | `conversion.test.ts` → "converts once in one transaction: identity, number, demo preserved as converted, audit; a retry replays" |
| Admission numbers unique under concurrency | A-65 | `conversion.test.ts` → "10 parallel conversions get 10 unique, consecutive numbers"; unit `admission-numbers.test.ts` |
| Manual number needs permission + reason + audit | A-65 | `conversion.test.ts` → "manual number: permission + reason ≥ 10 + change row; a taken number is 409 with nothing written"; unit "manual admission number" |
| Duplicate contacts → review, not merge | A-66 | `conversion.test.ts` → "a shared contact means review (409 with candidates), never an automatic merge"; unit "identity decision (never auto-merge)"; `lead-intake.test.ts` → "uncertain match goes to duplicate review, never merged" |
| Search by name / admission no. / permitted phone | A-71 | `students-profile.test.ts` → "search by name and admission number; contact search only with private access, masked and audited" |
| Unauthorised can't see guardian / finance | A-71, A-80 | `students-profile.test.ts` → "guardians (restricted)"; `fee-plans.test.ts` → "own scope for counsellors, read-only roles, no access for the academic coordinator" |
| Multiple programme / batch | A-67, OPS-093 | `conversion.test.ts` → "a cohort + entrance combination opens a second case for the same student". Batches: **not tested** (Academic contract missing, OPS-121) |
| Missing marks / fees not zero | A-70, A-80 | unit `student-lifecycle.test.ts` → "no scores → null average, not 0"; `fee-plans.test.ts` → "feeStatusForStudents: missing plan is not_configured (never paid)"; `admissions-report-funnel.test.ts` → "no data: … never 0 %" |
| Averages comparable | A-70 | unit "groups by exam type and maximum, keeps unscored rows in the denominator only" |
| Fee chart totals = ledger | A-76, A-79 | unit `fee-plans.test.ts` → "A-FEE-1 totals equal the ledger…", "A-FEE-4 reconciliation gate"; integration "records a payment, a discount and a refund as separate manual rows" |
| Report fields by permission + export audited | A-72 | `students-profile.test.ts` → "generation writes an export row + audit with the permitted field groups; reference reopens it" (print page, not PDF) |
| Feedback directions distinct | A-75 | `feedback.test.ts` → "recorded by staff as pending; the teacher can neither record, edit nor moderate it (403)", "never appears among feedback about the student", "a moderator cannot moderate feedback about themselves" |
| Lead handoff idempotent + attribution + retry | A-81 | `lead-intake.test.ts` → "the same event twice gives one event, one delivery and one lead with source, campaign and consent", "records the failure, refuses unauthorised retries, then succeeds once", "manager and director see attribution; a counsellor sees own handoffs without it" |
| Counselling persists, teacher refs valid | A-74 | `appointments.test.ts` → "201: persists, adds participants…", "400 for bad input and unknown staff" |
| Conflicts detected | A-73 | unit "A-MTG-1 appointment overlap"; integration "409 on overlap naming the clash…", "concurrent overlapping bookings: exactly one succeeds". Demo-class clash: **not tested** |
| Reschedule / cancel history | A-74 | `appointments.test.ts` → "reschedule keeps history with reason and re-checks overlaps; cancel needs a reason" |
| Notifications labelled simulated | OPS-103 | `appointments.test.ts` → "…notifies the teacher in-app with the simulated label, audits" |

Also covered: 401 / 403 / 400 per new route (first case of each integration file), own scope (`demos.test.ts` detail, `appointments.test.ts` teacher scope, `fee-plans.test.ts`), lifecycle (`students-profile.test.ts` → "lifecycle"), funnel and conversion rates (`admissions-funnel.test.ts`, `admissions-report-funnel.test.ts`), teacher seed (`appointments.test.ts` → "teacher seed (owner-supplied, brief §12)").

## Not automated
Browser checks of every new screen (drawer focus trap, Escape, mobile sheet, KPI tiles, keyboard path, axe) at 360 / 768 / 1280 px; the demo-class clash path; closing a draft fee plan (the CHECK now applies to active agreements only, so the 20 Oct defect is gone; no test closes a draft); conversion fixtures beyond "the seed runs"; Academic results/attendance (contract missing).

---

# Added on 21 Oct 2026 (admissions lifecycle, annual fees, reports, tasks, UI redesign)

Run: `npx vitest run apps/business-ops-os` (whole module), or one file, e.g. `npx vitest run apps/business-ops-os/tests/integration/applications.test.ts`. Also `npx vitest run packages/authentication/tests/reauth.test.ts` (password re-check, 8 cases) and `npx vitest run packages/database` (constraint tests in `packages/database/tests/constraints/`). The whole-suite totals are in `IMPLEMENTATION_STATUS.md`. "it blocks" are counted from the source (an `it.each` counts once); they are a guide, not the runner's count.

## Unit tests (`tests/unit/`)
| File (it blocks) | Rules | Covers |
|---|---|---|
| `applications.test.ts` (14) | A-APP-1 … A-APP-3 | status machine, canonical JSON, signers at the 18 boundary, information / confirmation gap tables, payment gate table |
| `admission-form.test.ts` (6), `admission-documents.test.ts` (3) | A-APP-2 | paper-form sections and document checklist; form = 3 A4 pages with long names, ₹, missing values, no declaration; acknowledgement; CR80 ID card |
| `pdf-toolkit.test.ts` (3) | D-042 | 6-page A4 with wrapping, repeated table header, "Page n of N", Devanagari "?" + footer note, CR80 card, `pdfResponse` headers |
| `fee-agreements.test.ts` (11), `fee-plans.test.ts` (15), `admissions-fees.test.ts` (16) | A-FEE-1 … A-FEE-7 | 50/25/25 split in integer paise (seeded / exhaustive property tests), allocation with links and no due date, statuses, reconciliation, reversals and refunds, charge categories |
| `demos.test.ts` (26) | A-57 … A-64 | day states and day progress (present or late), extension, substitute, views at IST boundaries |
| `admissions-kpis-overview.test.ts` (11) | overview KPIs | days attended not classes, demo → admission conversion cohort and `waiting`, applications awaiting, confirmed, overdue onboarding, collections, outstanding (null = unknown) |
| `academic-evidence.test.ts` (10), `progress-report-pdf.test.ts` (3) | A-RPT-1 … A-RPT-5, A-MTG-4 | sections by audience and permission, workflow, attendance rate, cohort comparison, trends, constructive summary, IST period, demo review grid; report PDF |
| `onboarding.test.ts` (14) | A-ONB-1, A-KYC-1 | vocabulary = schema, template matching, union, latest wins, materials per programme and quantity, biometric evidence, overdue, masked references |
| `events.test.ts` (3) | A-EVT-2, A-EVT-3 | group types, reach with consent on every case, simulated vs sent |
| `staff-tasks.test.ts` (8) | A-TSK-1 … A-TSK-4 | vocabularies = schema, reason rules, overdue in IST, next occurrence incl. month-end clamp, EOD snapshot |
| `search.test.ts` (3), `student-contact-search.test.ts` (2) | A-SRCH-1 | contact-shaped queries (email, ≥ 4 digits); the student box sends 10+ digits or an email to the audited contact filter, a 3-digit admission number stays a name search |

## Integration tests (`tests/integration/`, PGlite)
| File (it blocks) | Covers |
|---|---|
| `applications.test.ts` (30) | acceptance 6–11, 18, 20, 21: conversion and direct admission create applications; versions and signature invalidation; form PDF per version; confirmation with password: wrong password audited, lock → 429, no-password account fails closed, retry and `Promise.all` give one approval and one number, gaps 409, stale version; acknowledgement and ID card only after confirmation; legacy verification; private form fields hidden without `ops:student_private:read` |
| `fee-plans.test.ts` (19) | agreement create / adjust / close / activate; "an approval binds one exact agreement version" (it.each of 10 reuse paths); discount / waiver / credit rule O2; registration once per student; refunds and reversals |
| `approvals-inbox.test.ts` (2) | 401; only roles that decide see a source; self-requested items dropped; a failing source shows as unavailable, not zero |
| `academic-reports.test.ts` (11) | teacher reviews of a demo (acceptance 4), report draft → reviewed → final, PDF audited, sections by permission, Academic unreachable fails closed |
| `student-kyc-onboarding.test.ts` (10) | masked-only documents, supersede, verify once, 403 for roles without private read, primary guardian, sibling links (404 cross-scope), onboarding union, materials, template v2, own scope it.each over 9 routes |
| `student-exit-readmission.test.ts` (6) | directory status per student (acceptance 14, 15), exit record fields, readmission keeps history, reactivation vs open readmission, lock order |
| `events.test.ts` (7) | event scheduling sends nothing, eligibility, own-scope audience, removed student's guardians, messages simulated |
| `staff-tasks.test.ts` | access and own scope, reasons, recurrence (EOD cases moved to `eod-reports.test.ts`; the share route is gone) |
| `search.test.ts` (3) | groups by permission and scope, contact search only with private access, audited |
| `admissions-overview.test.ts` (5), `dashboard-series.test.ts` (4) | overview: 403, missing never 0, days not classes, waiting approvals, confirmations, onboarding, fees; programme filter and own scope; no demo-list figures without `ops:leads:read` (the 50-application check cap is not tested); dashboard chart series |
| `demos.test.ts` (20), `conversion.test.ts` (5), `seeds.test.ts` (2), `admissions.test.ts` (8), `admissions-students.test.ts` (6), `students-profile.test.ts` (7) | updated for identity at booking, 3 demo days, conversion → application, the `admit()` fixture using the real confirmation path, the 21 Oct sample set |

## Added on 21 Oct 2026 (owner brief 2: tasks, EOD, imports, teacher operations, reviews from Academic)
Map of brief 2's 19 required checks to tests: `docs/task-tracker-verification.md` (repo root).

| File | Rules | Covers |
|---|---|---|
| unit `task-lifecycle.test.ts` | A-TSK-5 … A-TSK-7, R18 | action table by role and status, `closedBy` setting, cycles, work entries, time summary, report wording, self-logged fixed at creation |
| unit `eod.test.ts` | A-TSK-8 | events inside the IST day only, midnight split, late entries, overlaps, HR / Academic unavailable, same-activity flag, replayed backlog and due dates, `factsHash` |
| unit `task-import.test.ts` | tracker import | parser (HTML refused, BOM, status map, unreadable record), field map, record hash, staff suggestion by email or code only |
| unit `demo-review-match.test.ts` | A-MTG-4, A-MTG-5 | Academic marks on linked demo classes, review matching by demo class id or IST day + author |
| integration `task-lifecycle.test.ts` | A-TSK-5 … A-TSK-7 | brief 2 tests 1–3, concurrency (409), work updates, fix-round and R18 cases |
| integration `eod-reports.test.ts` | A-TSK-8 | brief 2 tests 5–12 and 17: draft, submit, versions, revision, inbox, follow-up, recipient, history setting, PDF/CSV, no share route |
| integration `task-reports.test.ts` | period report | scope, dated counts, PDF/CSV audited |
| integration `task-import.test.ts` | tracker import | tests 15–16: permission, preview, commit once, duplicates, concurrent upload, changed records |
| integration `academic-reviews.test.ts` (+ `academic-stub.ts`, `tests/setup-academic.ts`) | D-058, D-060, D-066 | reviews from Academic (permission before the call, withdrawn hidden, source unavailable), review acknowledgements, internal demo-sessions route, linked demo attendance, teacher directory and profile |
| integration `feedback.test.ts`, `seeds.test.ts` (changed) | A-75, D-061 | read-only history of Ops reviews; 12 sample teachers with sample work, nothing sent, clear-samples |

## Not automated (21 Oct 2026)
Full browser pass with axe on every redesigned screen (agents checked several at 1440 / 390 px); Google re-authentication (not built, D-041); real message delivery (mock adapter only); Devanagari in PDFs; a true concurrency proof of the demo booking lock under PGlite (single connection).


## Added on 22 Oct 2026 (role workspaces, D-072 / D-073)
| File | Rules | Covers |
|---|---|---|
| unit `overview.test.tsx` | OPS-143, OPS-144 | date range default, quick periods and fall-back; sidebar order with Settings at the foot; area tabs per permission; links into another workspace |
| integration `overview.test.tsx` | OPS-144, OPS-146 | blocks follow permissions; Academic, Marketing and reviews down → "Source unavailable"; reviews published in the range; > 92-day range explained; links keep the range; Collections and Outstanding paging, filters, own scope, 403 |
| integration `shared-entries.test.tsx` | OPS-147, OPS-148 | bodies render under `/academic` and `/marketing`; teacher sees own tasks/EOD only, no leads; marketing manager 200 on leads, 403 on students, KYC, fees, admissions and reviews; contributor sees own leads only; recipient links per workspace; `taskDaySummary` |
| integration `meetings-body.test.tsx` | OPS-147 | `MeetingsBody` under `/academic`: own meetings only, names only; a second teacher sees none and cannot open one by id; meeting notification links |
| integration `follow-up-summary.test.ts` | OPS-147 | `followUpDaySummary` counts; null for own scope without a staff record; refused without `ops:leads:read` |
| integration `lead-kyc-masking.test.ts` | OPS-148 | marketing sees contact fields but no KYC columns or KYC history; the operations manager sees everything |
| changed: integration `appointments.test.ts`, `eod-reports.test.ts`, `events.test.ts`, `feedback.test.ts`, `staff-tasks.test.ts`, `task-lifecycle.test.ts`, `task-reports.test.ts`; unit `screens.test.tsx`, `task-views.test.tsx` | — | updated for the new grants, the body components and workspace links |

Workspace rules shared by all apps are tested in the packages: `packages/authorization/tests/workspaces.test.ts`, `packages/authentication/tests/workspace-login.test.ts`, `packages/configuration/tests/workspaces.test.ts`, `packages/server-kit/tests/define-route.test.ts`, `packages/database/tests/demo-accounts.test.ts`, `packages/shared-contracts/tests/safe-path.test.ts`.
