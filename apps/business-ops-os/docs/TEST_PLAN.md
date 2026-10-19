# Business Ops OS — test plan

Run: `npx vitest run apps/business-ops-os` (or `npx vitest run --project business-ops-os`). Unit tests are pure; integration tests use `setupTestDatabase()` (fresh in-memory PGlite with the live schema per file, D-025) and call the real route handlers with `authedRequest` / `callRoute`. All people and contacts are fictional; secret-like values use `test-only-`.

## Unit tests (`tests/unit/`)
| File | Algorithm / rule | Cases (normal · boundary · missing · invalid · conflicting) |
|---|---|---|
| `contacts.test.ts` | A-01, A-02 | 13 Indian formats incl. `+91 (0)`, `0091`, `091`, trunk 0; landline; international; missing/blank/null; letters, extensions, `+` in the middle; 9/11-digit boundaries; leading-zero national number; idempotence; email trim/case, no Gmail rewriting; name normalisation; Jaro-Winkler; sibling surnames not similar; exact/possible/none classification, weak name signal ignored, missing data, self-match, deterministic order |
| `pipeline.test.ts` | A-03 | happy path; table integrity; terminal states; BR-OPS-4 guard; illegal jumps; NO_CHANGE; demo-skip proposal on/off + reason; readiness guard; handoff-only transition; system-only replies; lost/on-hold reasons; resume to held status only; cannot lose while awaiting Academic |
| `admission-followups.test.ts` | A-04, A-05, A-06 | readiness normal / all missing / same-person verifications / pending approval / configurable parts / not-applicable; verifier separation; IST date at 18:29:59Z vs 18:30Z; Mon–Sun weeks; closed-weekday shift; due rules incl. Sunday 00:10 IST; **overdue timezone boundary**; upcoming/later/closed; flags; reminder selection once per day, unreachable owners |
| `tasks-escalation.test.ts` | A-07, A-08, A-09 | **3-node dependency cycle** with path; self and 2-node cycles; DAG; shortest path; loop-safe chain; completion evidence/owner; open blocker vs override; cancel/block/reopen reasons; IST flags; escalation threshold boundary; late evaluation raises L2–L4 once; blocked rule; closed/no-due tasks; recipient resolution incl. top-of-chain, no manager, no owner, loop |
| `kpis.test.ts` | A-12, A-14 | new leads IST boundary and merged exclusion, real 0; cohort conversion normal, boundary N days, **denominator zero → missing (not 0 %)**, window not elapsed; latest elapsed cohort; follow-up compliance incl. on-time at 23:50 IST and denominator zero; task completion; overdue work; blockers; workload sorted by name |
| `sops-staff-policies.test.ts` | A-10, A-11, settings, A-16 | SOP approval rules (owner cannot approve, reviewer required/different/must recommend, content changed, not in review); submission rules; status machine; proposed vs approved; version labels; reporting loops; responsibility gaps; settings defaults (demo fee not approved, limits open), stored override, invalid stored → default, change validation stays proposed; code formats; risk severity/flags; incident rules |
| `legacy.test.ts` | A-13 | namespacing; 24 decisions (8 open, 3 provisional), unknown status throws; 25 work items; SOP registers 25 + 16 + 9 + coordinator, none approved, unique codes; coordinator SOP draft 0.1 dated 2026-09-18 without blank form lines; 12 roles |
| `domain.test.ts` | module paths | basePath |

## Integration tests (`tests/integration/`, PGlite)
| File | Covers |
|---|---|
| `leads.test.ts` | 401 / 403 (auditor, teacher) / 400 (bad phone with path, no contact); 201 with normalised contacts, owner, admission, first-contact follow-up; exact duplicate → 409 with matches, acknowledged → 201 + flag, never merged; possible duplicate saved with warning; preview hides inaccessible names; **own scope** (counsellor list and 403 on another's lead); assignment 403 for counsellor, handoff pending → accept; BR-OPS-4 contact logging; second enquiry opens a second case; merge 403 for counsellor, merge by manager keeps enquiries, closes source case, history |
| `admissions.test.ts` | full pipeline through routes (contact → counselling → demo with 2-day terms and ₹1,000 `pending_verification` fee → attended → admission pending); confirmation gate 409 with missing items; same-person verification 409; fee approval: counsellor 403, requester self-approval 403, director approves; demo fee adjusted on admission; illegal/forbidden transitions; **outbox handoff: one event per request, double submit → one event, Idempotency-Key replay, failing payload rolls back; reply processed twice → one transition; rejected → admitted with reason, attempt 2 with new key, stale reply ignored**; job route 403 for counsellor |
| `tasks.test.ts` | auditor read-only; teacher sees/updates only own tasks; counsellor creates only own; owner ≠ backup; cycle 409 with codes; completion blocked by open blocker, override, evidence; escalation to manager then director, idempotent, owner kept, notification, acknowledge/resolve permissions; unowned task routed |
| `sops.test.ts` | counsellor read-only; full lifecycle (reviewer required, reviewer ≠ owner, review missing 409, non-reviewer 403, owner approval 403, counsellor 403, director approves); new draft keeps approved version; changes requested → withdraw by requester only; auditor 403; legacy import of 51 SOPs, none approved, coordinator draft |
| `organisation-planning.test.ts` | staff admin permissions; reporting loop 409; onboarding checklist idempotent; responsibility gaps; 24 legacy decisions; decision rules (confirmed needs date, superseded needs link); risk flags, director cannot write risks; milestone cycles and completion order; work inventory; incidents; settings stay proposed, legacy-approved read-only, auditor 403 |
| `dashboard.test.ts` | **stubbed fetch**: HTTP 503, network error, wrong shape → "unavailable"; valid → available; documented URLs; rendered panel shows "Source unavailable" and "Missing"; dashboard 403 for counsellor; empty rates missing, counts 0; workload alphabetical; reminder job idempotent and manager-only |
| `seeds.test.ts` | core + Ops seeds twice: idempotent counts (12 sources, 24 decisions, 25 work items, 51 SOPs none approved, 12 responsibilities without holders, 4 fictional leads with no phones, 3 tasks, 10 fictional staff) |
| `routes.test.ts` | health, standalone login, seed export |

## Not automated
Browser E2E (Playwright deferred, D-007); page rendering of every screen (pages are covered by `npm run build` type-checking plus the panel render test). The cross-module handoff is now tested: see the platform tests below.


---

# Added on 19 Oct 2026 (admissions, HR, operations)

**Result at commit ce7589c** (whole repository, `npm test`): Test Files 86 passed, Tests 896 passed, 1 todo (the `it.todo` for Academic reusing `existingStudentId`, IR-OPS-ADM-1). Typecheck, lint and the secret scan (912 files) passed. "it blocks" below are counted from the source and are a guide, not the runner's count.

Fixtures per area: `admissions-fixtures.ts`, `hr-records-fixtures.ts`, `hr-lifecycle-fixtures.ts`, `hr-time-fixtures.ts`, `operations-fixtures.ts`. Each integration file builds a fresh PGlite database (D-025), uses fictional people only, and calls the real route handlers or services. Every HR and fee route has 401 and 403 cases; field-level protection is tested per role.

## Unit tests (`tests/unit/`)
| File (it blocks) | Algorithms | Covers |
|---|---|---|
| `admissions-fees.test.ts` (15) | A-17 | Rupee text to paise without floats; amount limits; direction only on adjustments; receipt reference setting; refund cap; demo credit once and capped; summary with voided rows; balance `null` when no due entry; state labels |
| `admissions-students-kpis.test.ts` (14) | A-18, A-20 | Directory state mapping; private-key redaction (also deep, in audit payloads); closure reason codes; enquiries count; pipeline snapshot; counselling and demos; handoff success rate and view; retry decision; overdue follow-ups; IST boundary |
| `hr-records-domain.test.ts` (20) | A-21…A-28 | Field tiers and projection; status transitions; history diff; org tree and head succession; document actions; compensation validation, approval planning, effective dating, CSV formula neutralising; assets; metrics |
| `hr-lifecycle-domain.test.ts` (14) | A-29…A-38 | Requisition, application and offer edge tables; self-approval; interview feedback rule; onboarding and offboarding checklists; item rules; gating |
| `hr-time-domain.test.ts` (35) | A-39…A-45 | Calendar and time zones; attendance hours; late/early with grace; missing clock-out; overlap of sessions, assignments (incl. overnight) and leave; working-day counting; balance ledger; RFC 4180 CSV parser and row validation; corrections and leave decision checks; availability grid; timesheet summary |
| `operations-domain.test.ts` (23) | A-46…A-56 | Comment hiding; task review decision; reminders (10 cases incl. late UTC evening = next IST day); activity lines; SOP publication and review-due flags; acknowledgement audience and status; policy status and proposal checks; incident targets; blocked projects; operations KPIs (missing is not zero) |

## Integration tests (`tests/integration/`, PGlite)
| File (it blocks) | Covers |
|---|---|
| `admissions-fees.test.ts` (5) | 401 without a session; recording needs `ops:fees:record`; reads follow own scope; due, received, refund and credit entries with computed balance, audited and labelled manual; refund cannot exceed what was received; finance list paginated by code |
| `admissions-students.test.ts` (6) | Directory lists admitted students only; profile 404 before admission and 403 outside scope; reason-coded closure (withdrawal); handoff retry after a dead delivery (refused while Academic retries; superseded attempt's late reply flagged); lead contact masking; consent and preferences |
| `admissions-report.test.ts` (3), `admissions-seed.test.ts` (1) | Report per role and own scope; missing is not 0; sample admissions and fee seed runs twice without duplicates |
| `hr-records-employees.test.ts` (15) | Create (401/403/400/201, four concurrent creates give four codes, email normalised and 409 on duplicate, archived department and inactive manager refused, audit without private fields); directory search, filter, sort and pagination on the server; self-management and loops refused; head history; org chart; history row per tracked change incl. the staff screen; status transitions; field tiers |
| `hr-records-private-documents.test.ts` (9) | Private fields: self only, HR manager all, department manager never; emergency contacts max 5; identity last four; documents: 503 on stored upload and download, 409 reference-only, fake connected adapter issues a 300 s URL, identity documents hidden from the HR contributor, deletion by a second person |
| `hr-records-compensation-assets.test.ts` (7) | Draft, approval by a different person, never one's own pay, supersede, forward-in-time rule, export with reference and audit; assets assign, return, one open assignment |
| `hr-records-metrics.test.ts` (2), `hr-records-seed.test.ts` (1) | K-HR missing before any record, counts, department manager scope; seed idempotent |
| `hr-lifecycle-recruitment.test.ts` (12) | Requisition opening needs a decider who is not the requester; recruiter sees own requisitions only; candidate contacts normalised, duplicates refused, never in lists, auditor and director see none; application table allowed and everything else refused; interviewers see only their applications; feedback notes masked; offers never approved by the preparer; conversion idempotent (two calls, one employee, one case); anonymisation |
| `hr-lifecycle-cases.test.ts` (7) | Onboarding gated on required items and an approver who is not the employee; department manager reads own reporting chain only; overdue reminders once per IST day; offboarding asset returns and transfers; last working day before start refused; approval puts the employee on notice and separation publishes one event; no-login employee completes access revocation, jobs route guarded; retraction before it applies |
| `hr-lifecycle-employee-journey.test.ts` (1), `hr-lifecycle-metrics.test.ts` (4) | Requisition to separation end to end (the attendance and leave step is a marked TODO); K-HRL missing and values |
| `hr-time-attendance.test.ts` (14) | Clock in, break, clock out; second clock-in the same day refused; manual entries need a reason, are audited, late/early against the shift; day without a shift not measured; missing clock-out job flags once; corrections never overwrite (3 cases); CSV import (3 cases: preview, commit, repeat file); provider reports `not_configured`; monthly summary, colleague forbidden |
| `hr-time-leave.test.ts` (15) | Shift templates and assignments (4 cases), holidays; leave requests (7 cases: working-day counting with Sunday and a Sikar holiday excluded, half days, overlap, never self-approval, cancellation rules); balances (not configured until an allocation, then a ledger; cancellation reversal); team availability; timesheets, export, metrics |
| `hr-time-jobs-seed.test.ts` (2) | Missing clock-out job needs `ops:jobs:run`; seed idempotent |
| `operations-tasks.test.ts` (9) | 401/403/400/201 and own scope; comments (hide by author or manager only, body withheld from own-scope readers); references (label and location only, unsafe links rejected, removal needs a reason); completion needs evidence; supervisor review (accept, return reopens, cycle 2); activity history; filters and page meta; reminder job once per task and due date |
| `operations-sops.test.ts` (5) | Schedule only after approval, published once the effective date is reached, history kept; archive only after retirement; required acknowledgements by department and by role (once per person, outsiders and auditors cannot, report counts); coordinator SOP stays draft |
| `operations-registers.test.ts` (8) | Policies and compliance register (draft, proposed, approved by another person, new versions, retired stays readable; rejection needs a comment; auditor and director read-only, invalid keys and dates rejected); risk mitigations (add, progress, drop with outcome; director cannot write); blocked projects; incident resolution target flags; operations report (403 for a counsellor, rates missing without data, integration errors counted) |
| `operations-approvals.test.ts` (4) | Inbox sources, permission filtering, no self-approval items, unavailable source |

## Platform and cross-module tests
| File | Covers |
|---|---|
| `apps/platform/tests/integration/enrolment-handoff.test.ts` (6 cases + 1 `it.todo`) | Ops `requestEnrolment` → Academic consumer `academic.enrolment-intake` → reply → Ops `processEnrolmentReplies`: success with references; repeated request and redelivery never create a second enrolment or student; invalid batch rejected with a reason, corrected re-request (attempt 2) enrols once; recoverable failure retried automatically; dead delivery then audited retry (attempt 2) gives one enrolment; second programme for the same person (Ops sends `existingStudentId`). Closes IR-OPS-03. The todo is the Academic side (IR-OPS-ADM-1). |
| `apps/platform/tests/integration/access-revocation.test.ts` (3) | `platform.access-revocation` consumer disables the login and deletes sessions once per event; a rerun is a no-op |

## Not automated
Browser E2E (Playwright deferred, D-007). The new screens are type-checked but were not built or rendered at ce7589c; the wiring step builds them. A real storage provider and attendance provider (not configured, D-014). A scheduler (none exists). Dedicated tests for `ops:compensation:approve`, `ops:policies:approve` and `ops:sops:acknowledge` follow when those permissions are final.
