# Business Ops OS

Elevate Education's operations module (`@elevate/business-ops-os`, Next.js, basePath `/ops`, port 3003). It runs admissions: leads, demo students and their classes, applications with a password-confirmed final approval that gives the admission number, active and past students (KYC, onboarding, exits, readmission), guardians, counselling, parent-teacher meetings, events and webinars, teachers and feedback, annual fee agreements and manual fee records, progress reports, staff daily tasks and end-of-day reports, one search box, the Marketing lead handoff, the enrolment handoff to Academic OS, and the admissions reports. It is also steward of `core.staff_members`, `core.departments` and the canonical student `core.students` (D-033). Student flow: **lead → counselling → demo (3 demo days, D-038) → application (form, signatures) → final confirmation (number, D-040/D-041) → enrolment in Academic OS**. The student's identity is created at demo booking and reused from then on.

**HR and Operations were removed by the owner on 20 Oct 2026 (D-032):** employee records, recruitment, onboarding/offboarding, staff attendance, shifts, leave, compensation, assets, tasks, escalations, SOPs, the policies register, incidents, decisions, risks, projects, milestones, responsibilities, the work inventory and the operations/HR reports, with their tables (migration `0002_remove_hr_operations`), permissions, roles and seeds. Everything is recoverable from git: the last commit that contains it is `63da4e4` (branch `feature/business-ops-hr-admissions`), e.g. `git checkout 63da4e4 -- apps/business-ops-os/src/server/hr`.

Status (D-013): services and domain rules are **Tested** where a test is named in `requirements/REQUIREMENTS.md`; screens are **Implemented** (redesigned 21 Oct 2026 and looked at in a browser by the build agents, but no automated browser test); nothing is Deployed. Migrations `0000`–`0008` exist and are applied to the owner's local database only (`0007_admissions_lifecycle`, `0008_staff_tasks`). Test count and whole-suite result: see `IMPLEMENTATION_STATUS.md`.

## Run
| What | Command |
|---|---|
| Dev server alone | `npm run dev:ops` → http://localhost:3003/ops (needs `npm run db:start`, `npm run db:migrate`, `npm run db:seed`) |
| Typecheck | `npm run typecheck -w @elevate/business-ops-os` |
| Lint (Ops-owned files) | `npx eslint apps/business-ops-os packages/database/src/schema/ops*.ts packages/authorization/src/permissions/ops.ts packages/shared-contracts/src/modules/ops.ts --max-warnings=0` |
| Tests | `npx vitest run apps/business-ops-os` (whole repo: `npm test`) |
| Build | `npm run build -w @elevate/business-ops-os` |

## Admissions slices (owner brief, 20 Oct 2026; OPS-080 … OPS-121)
| Slice | What it does | Status |
|---|---|---|
| Demo students | Each demo has 3 demo days (setting `admissions.demo.day_count`, approved, D-038), each with one or more classes (teacher, subject, time, attendance incl. late and excused, substitute flag). Progress counts days attended ("2 of 3 days attended"); a 4th day only through the `admissions.demo.extension` setting (proposed, off). Booking creates the student identity. Corrections keep the old value, actor and reason. Tabs Current / Upcoming / Previous by IST calendar day; checklist of 11 items (latest entry wins, waiver needs a reason); close as declined, withdrawn, not converted or cancelled with a reason. | Tested (API, rules); landing and drawer Implemented |
| Conversion and applications | Convert to admission on its own page: reuse the student identity (a shared contact goes to review, never merged), programmes from the allowed combinations (D-034), demo marked converted and kept; it opens an application (`APP-nnnnnn`, versioned). Direct admissions and readmissions open one too. The application prints the owner's admission form (PDF per version), records signatures and lists what is still missing. | Tested |
| Final confirmation and admission numbers | `ops:admissions:confirm` + the approver's own password in the same request (D-041). Every gap must be closed (KYC, documents, approved fee agreement, declaration v2, signatures of this version, payment gate). The number (001, 002 …, D-037) is given in the same transaction and never changes or is reused (D-040). Acknowledgement and ID card PDFs. Google-only accounts cannot confirm yet (owner decision). Older admissions show "Legacy — verification required" until checked. | Tested |
| Active and past students | Active = enrolled (Academic confirmed). Past / on hold: tabs On hold, Former, Past demos. On hold needs a reason and review date; exits (withdrawn, completed, transferred, cancelled before enrolment, other inactive) write an exit record; reactivation needs its own permission and a second person. Search by name or admission number; phone/email search only with private access, masked and audited. | Tested (API); screens Implemented |
| Student profile and report | Ten tabs (`?tab=`): overview, KYC, enrolments, onboarding, fees, attendance, assessments, feedback, reports, timeline. Academic results and attendance come from Academic's per-student summary (IR-OPS-STU-1, done). Progress report: draft → reviewed → final (reviewer ≠ writer), snapshot fixed at draft, PDF download audited; nothing is emailed. | API Tested; pages Implemented |
| KYC and onboarding | Several guardians with one primary; identity documents as masked references only, verified by `ops:kyc:verify`; sibling links never merge; versioned onboarding templates (items proposed) with material issue / return. | Tested |
| Exits and readmission | Exit record per case (reason, materials, closing notes, balance); a student stays active while another programme runs; readmission opens a new application for the same person and keeps the old number. | Tested |
| Events and webinars | Audience snapshot, explicit additions and removals, capacity, attendance; messages previewed and marked "simulated" (no messaging provider). | Tested |
| Guardians | Several per student, normalised contacts, consent, archive instead of delete; contacts never in audit rows. | Tested |
| Counselling & meetings | Six appointment types, statuses proposed → completed/cancelled, participants, change history, list and week calendar. Double booking refused (also against the teacher's demo classes). The teacher gets an in-app notification; email/SMS are labelled "simulated — not sent". | Tested (API); screens Implemented; demo-class clash untested |
| Teachers and feedback | Teacher directory and profile on `core.staff_members` + `ops.staff_profiles` + subject capabilities. Teacher → student feedback is versioned and only the author edits it; student/guardian → teacher feedback is recorded by staff, moderated, and the teacher can never edit or moderate it. | Tested |
| Fee agreements and ledger | One annual agreement per student and year, split 50 / 25 / 25 (D-039); registration ₹5,000 once (D-044) and demo ₹1,000 (D-045) are separate charges; each agreement version activates only with its own approval by someone other than its maker; refunds and reversals are linked rows; payments, discounts, waivers, refunds and adjustments are separate rows, all "manually recorded, not a verified payment". Instalment status and list fee status (`paid / due / overdue / not configured`); donut only when plan and ledger reconcile. | Tested (rules, API); profile section Implemented |
| Marketing lead handoff | Consumer for `marketing.lead.handed_off` v1: one receipt per Marketing lead, attribution kept (shown only with `ops:lead_attribution:read`), duplicates to review, failures retried. Marketing does not publish the event yet: tests and seeds use a mock, and `/ops/leads?view=marketing` says "Live sync with Marketing OS: not configured". | Tested with mock events; live sync Proposed |
| Daily tasks and EOD | Every staff role logs its own tasks (My day, All tasks) and sends one end-of-day report a day to the reporting manager; reviewers see Team reports; PDF; "share" is simulated. Weekly / monthly range report not built. | Tested (API); screens Implemented |
| Search and overview | `/ops/search?q=` across leads, demo students, applications and students (own scope; phone only with private access, audited). Admissions overview with figure filters. | Tested (API); screens Implemented |
| Reports | Admissions funnel, demo conversion and student summary on `/ops/reports/admissions`, built from stored rows with denominators; "Not enough data" instead of 0 %. The earlier 11-KPI admissions report stays. | Tested (API, rules); screen Implemented |

Earlier slices still in place: leads with normalised contacts and duplicate review (OPS-001…007), the admission pipeline state machine and confirmation gate (A-03, A-04), the enrolment handoff with audited retry (A-15, A-19), manual admission fee records (A-17), the staff directory (OPS-014), settings with decision states (OPS-022), the management dashboard (OPS-024) and the approvals inbox for fee arrangements.

Not built from the brief: an "Enrolment Handoffs" list screen (OPS-120; the Applications list now exists) and Academic columns on the Active students list (OPS-121; the profile has them).

## Screens (`/ops/...`)
| Screen | URL | Permission |
|---|---|---|
| Today (dashboard) | `/ops` | `ops:module:access` |
| My day, All tasks, End-of-day report, Team reports | `/ops/tasks?tab=day\|all\|eod\|team` | `ops:tasks:read` (Team reports: `ops:eod:review`) |
| Admissions overview | `/ops/admissions/overview` | `ops:admissions:read` |
| Applications | `/ops/admissions/applications`, `/ops/admissions/applications/{id}` | `ops:admissions:read` (confirm: `ops:admissions:confirm`) |
| Search | `/ops/search?q=` | read access to at least one group |
| Fee structure | `/ops/fees` | `ops:fees:read` |
| Demo students (tabs, KPI tiles, drawer `?open=`, booking `?new=1`) | `/ops/admissions` | `ops:leads:read` |
| Demo record | `/ops/admissions/demos/{id}` | `ops:leads:read` |
| Convert to admission | `/ops/admissions/demos/{id}/convert` | `ops:admissions:convert` |
| Admission case | `/ops/admissions/{id}` | `ops:admissions:read` |
| Active students | `/ops/students` | `ops:students:read` |
| Past / on hold | `/ops/students/past?tab=on_hold\|former\|demos` | `ops:students:read` |
| Student profile, report | `/ops/students/{id}`, `/ops/students/{id}/report` | `ops:students:read`, `ops:student_reports:generate` |
| Leads, From Marketing | `/ops/leads`, `/ops/leads?view=marketing`, `/ops/leads/{id}` | `ops:leads:read` |
| Counselling & meetings | `/ops/meetings` (`?view=week`), `/ops/meetings/{id}`; `/ops/schedule` redirects here | `ops:appointments:read` |
| Teachers | `/ops/teachers`, `/ops/teachers/{id}` | `ops:teachers:read` |
| Staff directory | `/ops/staff`, `/ops/staff/{id}` | `ops:organisation:read` |
| Reports | `/ops/reports`, `/ops/reports/admissions` (`#funnel`, `#demo-conversion`, `#students`) | `ops:module:access`, `ops:admissions:read` |
| Approvals | `/ops/operations/approvals` | `ops:module:access` |
| Settings | `/ops/settings` | `ops:settings:read` |
Sidebar groups: Today, Admissions, Students, Money, People, Reports; Settings at the bottom. Every screen checks its permission on the server and has empty and error states. Sample records show the shared "Sample data" badge. Routes and bodies: `docs/API.md`.

## Permissions (`packages/authorization/src/permissions/ops.ts`)
42 keys. Full matrix, own-scope and field-level rules: `docs/PERMISSIONS.md`. Keys added on 21 Oct 2026 (holders **proposed**, owner to confirm):

| Key | Who holds it |
|---|---|
| `ops:admissions:confirm` | director, operations manager |
| `ops:kyc:verify`, `ops:student_reports:review`, `ops:event_messages:send` | operations manager |
| `ops:tasks:read`, `ops:tasks:write` | every staff role that opens Ops, own scope; operations manager, director and auditor read everyone's |
| `ops:eod:review` | operations manager, director |

Keys added on 20 Oct 2026:

| Key | Who holds it |
|---|---|
| `ops:admissions:convert`, `ops:students:lifecycle`, `ops:guardians:write`, `ops:student_reports:generate` | operations manager; counsellor (own) |
| `ops:admission_number:override`, `ops:students:reactivate`, `ops:lead_handoffs:manage`, `ops:teachers:manage`, `ops:feedback:manage`, `ops:feedback:moderate` | operations manager |
| `ops:lead_attribution:read` | operations manager; director and auditor (read baseline) |
| `ops:appointments:read` | operations manager, director, auditor; counsellor and teacher (own) |
| `ops:appointments:manage` | operations manager; counsellor (own) |
| `ops:teachers:read` | operations manager, director, auditor, counsellor, academic coordinator; teacher (own) |
| `ops:feedback:read` | operations manager, director, auditor, academic coordinator; teacher (own) |
| `ops:feedback:write` | operations manager; teacher (own: students they met) |
| `ops:feedback:record` | operations manager, counsellor |

Roles in short: `operations_manager` holds every key; `admissions_counsellor` works own leads, demos, admissions and students incl. student contacts; `director` reads everything except student contacts and approves fee arrangements; `auditor` reads only; `academic_coordinator` reads students, teachers and feedback; `finance_officer` reads and records fees; `teacher` sees own appointments and profile and writes feedback about students they met.

## Settings
Approved by the owner: `admissions.demo.day_count` (3, D-038), `admissions.number.format` (001 …, D-037), `fees.tuition_split` (50/25/25, D-039), `fees.registration` (₹5,000, D-044), `demo.fee` (₹1,000, D-045), `admissions.declarations` (version 2, the owner's form, D-046), `admissions.confirm.reauth` (password, D-041). Still `proposed`: `admissions.demo.extension` (off), `admissions.demo.checklist_required` (off), `admission.payment_gate` (none), `admissions.kyc.id_document_types`, `events.eligibility`, `reports.audiences` (student audience off), `appointments.scheduling` (no buffer, 60 min). `fees.demo_credit` is on, but a credit is always posted by hand, never automatically. The due window in `fees.allocation` is no longer used.

## Integration
- Produces `ops.admission.enrolment_requested` v1 (with optional `existingStudentId`); consumes `academic.enrolment.confirmed` / `.rejected` v1 (`ops.enrolment-replies`) and `marketing.lead.handed_off` v1 (`ops.lead-intake`, producer not built: IR-MKT-OPS-HANDOFF).
- Reads `GET /academic/api/internal/v1/summary`, `GET /academic/api/internal/v1/students/{id}/summary` (`AcademicStudentSummaryV1`, IR-OPS-STU-1 done) and `GET /marketing/api/internal/v1/summary`.
- Open: `ops.enrolment.closed` v1 so Academic stops attendance after an exit (IR-OPS-EXIT-1); Academic batch end dates (IR-OPS-EXIT-2).
- Jobs, run by hand until a scheduler exists (IR-OPS-02, IR-OPS-PLT-2): follow-up reminders, enrolment replies, lead intake.
- Open requests to other owners: `docs/INTEGRATION_REQUESTS.md`.

## Seeds (`seed/`, run by `npm run db:seed`; idempotent)
| Seed | Content |
|---|---|
| `ops.lead-sources` | The 12 lead sources from the legacy CRM dropdown (Unknown kept as its own source) |
| `ops.staff` | SAMPLE staff (D-036): one sample teacher per demo subject without a login — Sample English / Legal Reasoning / Logical Reasoning / Current Affairs / Economics / Accountancy Teacher — plus sample profiles for the core sample logins ("Sample Counsellor", "Sample Maths Teacher" …) |
| `ops.teachers` | The 7 teachers the owner supplied, with names and subjects confirmed on 20 Oct 2026 and **no contact data, logins, photos or permissions**: Nikunj Bindal (Head of Business Operations, no subject), Satish Raghuvanshi (Mathematics; spelling from the public site, the owner also wrote "Raghuanshi"), Sushant Bindal (Economics; role note "CEO / director of coaching"), Olivia Ma'am (English), Tushar Bhakte (IPM / IIM Bangalore-oriented programmes; alumni claim kept as an internal unverified note), Sobha (Commerce / special mathematics), Soma Tiwari (Current Affairs). Nikunj Bindal also teaches Class 11/12 Accountancy, CA Foundation Paper 1 and CUET Accountancy (D-047). |
| `ops.onboarding-templates` | The proposed onboarding template `proposed_standard` v1 (checks, biometric reference, ID card, one book set per programme); every item says "(proposed)" |
| `ops.sample-placeholders` | A "Sample — replace" fee-schedule reference (proposed, OD-013) |
| `ops.fee-structures` | The fee structure (owner, 21 Oct 2026): one SAMPLE row per allowed combination (sum of sample amounts per programme, "sample figure, replace with your real fee") + the two prices the public website states (Commerce + CUET ₹10,000/month, ACE Batch ₹12,000/month; `website_stated`, draft, not sample). Existing rows are never overwritten. |
| `ops.samples` | THE sample set (D-036; `seed/samples.ts`), every row flagged `is_sample`, `@example.test`, no phones, real services so history and audit are genuine: **Tanisha Demo Student** (CLAT; class 1 and 2 present, class 3 scheduled; mock not scheduled; fee structure, admission details and feedback pending) · Aarav (IPMAT, all three attended) · Meera (CUET, one absence) · Kabir (CLAT, class 1 rescheduled) · Riya (IPMAT, completed, not converted) · Dev (CLAT, declined) · Ishaan (CUET, withdrawn) · Zoya (converted to Class 12 Commerce + CLAT, admission number, enrolment requested, active fee agreement with a payment, a scheduled parent-teacher meeting and a cancelled teacher meeting) · Sana (converted to Dropper + IPMAT, then cancelled before enrolment) · Naina (new lead from a mock Marketing handoff) · Mira (mock handoff sharing Meera's parent email → duplicate review). Added 21 Oct 2026 so every list has rows: **active** Arjun (Class 11 + CLAT), Diya (Class 12 + IPMAT), Kavya (Class 12 + CA Foundation), Rohan (Dropper + CUET), Anaya (Class 11 alone), Vihaan (Class 12 + CUET) — each with a guardian, an active fee plan (paid / due / overdue mix), Arjun and Diya with teacher feedback; **on hold** Myra (review in 14 days); **former** Aditya (withdrawn), Ira (completed), Reyansh (transferred), with exit records; Saanvi (converted, fee discount waiting for approval); Parth (upcoming demo). Meetings of every type (counselling, guardian counselling, PTM, demo review; past and upcoming), follow-ups due today and overdue, leads spread over the last 30 days. Each demo class has the sample teacher of its subject; the owner-supplied teachers never get sample events. Sample admissions are admitted by a seed-only path with no approval or password check and show "Legacy — verification required"; their numbers come from the real counter. Idempotent per case and per meeting/follow-up, so new cases reach a seeded database. |
| `platform.sample-enrolments` (apps/platform/seed) | Runs the real enrolment handoff for the sample admissions — Academic's intake consumer, then Ops's `ops.enrolment-replies` — and then the sample hold and exits that need an enrolled student. Skipped while a real enrolment request waits. Attendance and results stay "Source unavailable": no Academic sample data is created for them. |

Remove all sample rows before real use: `npm run db:clear-samples` (local databases only; one transaction; prints rows deleted per table; keeps real rows, the sample logins, audit and outbox history). It also removes the sample fee-structure rows (website and owner-approved rows stay), the Academic student/enrolment created for each sample admission, and closes unfinished enrolment handoff events of sample admissions so a consumer never acts on a removed sample.

## Documentation
`docs/REQUIREMENTS.md` (points to `requirements/REQUIREMENTS.md`) · `docs/DATA_MODEL.md` (ER diagram, naming, migration history) · `docs/DATA_DICTIONARY.md` (every table and column in plain words, generated by `npm run docs:data-dictionary`) · `docs/DOMAIN_MODEL.md` · `docs/WORKFLOWS.md` (state diagrams) · `docs/API.md` (`docs/API_SPECIFICATION.md` points to it) · `docs/PERMISSIONS.md` · `docs/ALGORITHMS.md` (A-57 … A-84 for admissions; removed A-xx are marked) · `docs/KPI_DEFINITIONS.md` · `docs/TEST_PLAN.md` (brief §19 mapping) · `docs/INTEGRATION_REQUESTS.md` · `docs/BUSINESS_OPERATIONS_AUDIT.md` (starting state, 20 Oct 2026) · `docs/PUBLIC_COURSE_CATALOG_RESEARCH.md` · slice appendices `docs/parts/admissions-*.md`.

## Owner decisions this module depends on
Recorded: D-032 (HR/Operations removed), D-033 (canonical student), D-034 (programme combinations, SSRN out of scope, teacher names), D-037 (Commerce cohorts, dropper, CA running, numbers 001 …), D-038 (3 demo days), D-039 (50/25/25), D-040 (number at final confirmation), D-041 (password re-check), D-042 (PDFs), D-043 (lifecycle schema), D-044 (registration ₹5,000), D-045 (demo ₹1,000), D-046 (declaration v2), D-047 (Nikunj teaches Accounts), D-048 (address, GSTIN), D-049 (public email), and later entries in `docs/DECISIONS.md`. Open: Google re-authentication for confirmers; who holds the new proposed permissions; registration fee once per student or per academic year; whether a discount on an active agreement needs a second approver; automatic demo-fee credit; onboarding template items; whether the director may read private student data; whether the checklist must be complete before conversion; one number and one checklist per programme combination or per case; whether `other_inactive` is wanted and whether reactivation needs a second person; appointment buffer and default length; rating scale 1–5; instalment allocation order and due window; demo fee (legacy ₹1,000, OD-013); IIMB UG inside IPMAT, Class 11/12 Commerce only, dropper batch, CA Foundation start (`PUBLIC_COURSE_CATALOG_RESEARCH.md` §5); OD-009, OD-010, OD-011, OD-012, OD-021/OD-025, OD-027, OD-044 (identity matching), OD-046…OD-048, D-026.
