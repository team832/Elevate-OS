# Business Ops OS: conversion, admission numbers, students, lifecycle, guardians, student report (part for merging)

> **Renamed on 21 Oct 2026 by migration `0005_clear_names` (D-036):** this note describes the 20 Oct build. `ops.counselling_sessions` is now `ops.appointments` (`starts_at`, `staff_id`; `attendees` dropped), the legacy demo columns `subjects`/`day_dates`/`status`/`is_sample` and `ops.demo_teachers` are gone, `student_identity_id` is `student_id`, `admissions.student_id` is `academic_student_id`, `guardian_ref` is `guardian_id`, `staff_ref` is `staff_code`. Current columns: [../DATA_DICTIONARY.md](../DATA_DICTIONARY.md).

> **Merged on 21 Oct 2026.** Kept as a detailed appendix. Final ids: OPS-089 … OPS-100; rules A-STU-1 … A-STU-6 and the lifecycle edges are now A-65 … A-72. Canonical docs: `../../README.md`, `../../requirements/REQUIREMENTS.md`, `../DATA_MODEL.md`, `../WORKFLOWS.md`, `../API.md`, `../PERMISSIONS.md`, `../ALGORITHMS.md`, `../TEST_PLAN.md`, `../INTEGRATION_REQUESTS.md`. The migration it asks for exists: `packages/database/migrations/0003_admissions_workspace.sql`. Where this file and the canonical docs differ, the canonical docs win.

Owner brief of 20 Oct 2026, chunks 3–4 and the report part of 5 (§4, §6.1, §6.2, §7, §8 A–D, F, G, I, J, §9, §14, §15, §19). Built by build agent B on branch `feature/business-ops-hr-admissions`. The coordinator merges this file into `README.md`, `requirements/REQUIREMENTS.md`, `docs/{DATA_MODEL,API,API_SPECIFICATION,ALGORITHMS,WORKFLOWS,PERMISSIONS,TEST_PLAN,INTEGRATION_REQUESTS}.md`. Status words follow D-013; nothing is Deployed. Requirement IDs are provisional (`ADM-STU-xx`).

## 1. Requirements

| ID | Title | Status | Evidence |
|---|---|---|---|
| ADM-STU-01 | Convert to admission: one transaction (identity, programmes, case advanced, number, demo `converted` + link, optional approval request and enrolment request, audit); idempotent; a second conversion is 409 | **Tested** | `tests/integration/conversion.test.ts` → "converts once in one transaction…" |
| ADM-STU-02 | Admission numbers from a counter row locked `FOR UPDATE`; format = setting `admissions.number.format` (proposed) | **Tested** | "10 parallel conversions get 10 unique, consecutive numbers"; `tests/unit/admission-numbers.test.ts` |
| ADM-STU-03 | Manual number: `ops:admission_number:override`, reason ≥ 10, change row; collision → 409 with nothing written; later correction route | **Tested** | "manual number: permission + reason ≥ 10 + change row…" |
| ADM-STU-04 | Canonical student: same lead links; shared phone/email → review 409 with candidates, never merged; person chooses or confirms new | **Tested** | "a shared contact means review…"; unit "identity decision" |
| ADM-STU-05 | Programme combinations from `src/domain/catalog.ts`; the extra programme opens its own case for the same student | **Tested** | "a cohort + entrance combination opens a second case…" |
| ADM-STU-06 | Lifecycle after enrolment: on hold (reason + review date), resume, exit (withdrawn / completed / transferred / other_inactive; cancelled_before_enrolment from admitted) with exit record, reactivation (permission, record allows it, a different approver) | **Tested** | `tests/integration/students-profile.test.ts` → "lifecycle"; unit "student lifecycle transitions" |
| ADM-STU-07 | Lists: Active (enrolled only), Past / on hold (tabs On hold / Former / Past demos), counts from the same query, URL filters, `?open=` drawer, pager | **Tested** (API) · **Implemented** (screens, not browser-checked) | "active lists enrolled only…" |
| ADM-STU-08 | Search: name, admission number; phone/email of student or guardian only with `ops:student_private:read`, normalised, partial (≥ 4 digits), audited with a masked value; phones masked in lists | **Tested** | "search by name and admission number; contact search…" |
| ADM-STU-09 | Profile `/ops/students/<canonical id>` (older admission-id links still open): overview, programmes/cases + history, Academic results/attendance (contract → "Source unavailable"), fees (agent D section), guardians (restricted), upcoming, feedback (agent C section), handoff, activity timeline from audit | **Implemented** (API **Tested**) | profile assertions in `students-profile.test.ts` |
| ADM-STU-10 | Guardians: several per student, normalised contacts, consent, archive (no delete), restricted, contacts never in audit | **Tested** | "guardians (restricted)" |
| ADM-STU-11 | Student report: period, field groups by permission (fees `ops:fees:read`, guardians private access), export row + audit, reference code, print page (browser print, no PDF library), nothing emailed | **Tested** (API) · **Implemented** (page) | "student report"; unit "report groups" |
| ADM-STU-12 | Fixtures: converted demo with number; admitted + enrolment requested; cancelled before enrolment with exit record (SAMPLE DATA) | **Implemented** (runs in `seeds.test.ts`) | `seed/admissions-conversion-fixtures.ts` |

## 2. Data model (no `drizzle-kit generate` was run)

- `ops.admissions` (extended, `ops.ts`): `admission_number` (text, unique, CHECK `^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$`, null until conversion and on extra programme cases), `student_identity_id` (FK `core.students`, indexed), `hold_review_date` (date). Status vocabulary + CHECK gain `withdrawn, completed, transferred, cancelled_before_enrolment, other_inactive`. `admissions_one_open_per_programme` now also excludes the exit statuses.
- `ops.admission_number_counters` (`ops-students.ts`): `scope_key` PK (`all` or `Y2026`), `next_value ≥ 1`.
- `ops.admission_number_changes` (append-only): admission, previous, new, `kind auto|manual`, reason (CHECK ≥ 10 chars for manual), actor, at.
- `ops.exit_records` (append-only; reactivation fills `reactivated_by/at` once): admission, exit status, exit date, reason, exit feedback, guardian feedback, fee/refund reference text, `reactivation_allowed`; CHECKs on status, reason, reactivated pair, reactivation only when allowed.
- `ops.guardians` (restricted): student identity FK, lead FK nullable, name, relationship, phone E.164, email lower-case, preferred contact, consent (`given|refused|withdrawn|not_recorded`) + recorded at, notes, `archived_at`, created/updated by.
- `ops.report_exports`: student identity FK, requested by, period from/to (CHECK from ≤ to), `fields_included` jsonb, `reference_code` unique (`SR-` + 10 chars), at.

Migration notes: add columns/tables; widen the two status CHECKs; recreate `admissions_one_open_per_programme` with the new WHERE; existing admitted cases get a `core.students` row when they next reach `admitted` (backfill optional: one identity per lead with an admitted case).

## 3. Rules (ALGORITHMS)

- **A-STU-1 Admission number.** Inputs: format setting, IST year. Inside the conversion transaction: upsert the counter row, `SELECT … FOR UPDATE`, skip values already used by a manual number, write `next+1`. Format `[prefix][sep][year][sep]seq` zero-padded to `width` (default sequence only, width 5: `00001`). Manual: permission, pattern, reason ≥ 10; unique violation → `ConflictError`, transaction rolled back. Tests: unit table, 10 parallel conversions, collision.
- **A-STU-2 Populations.** active = `enrolled`; on hold = `on_hold` held from `enrolled`; former = exit status or `lost` after admission; otherwise still in admission. Past demos (never converted) are A's demo records, listed separately.
- **A-STU-3 Results/attendance.** Averages only within the same exam type and maximum; unscored rows count in the shown denominator ("2 of 3 scored"), never as 0; attendance = present of recorded classes; no data → "No results recorded", Academic down → "Source unavailable (checked …)".
- **A-STU-4 Privacy.** Phones masked `+91 •••• ••12 34`, and only in a contact search; contact search needs `ops:student_private:read` and writes `student.contact_search` with a masked value; guardian contacts never enter audit rows.
- **A-STU-5 Report fields.** Groups `overview, programmes, results, attendance, feedback` always; `fees` with `ops:fees:read`; `guardians` with private access. Re-opening a reference shows the intersection with the reader's current permissions.
- **A-STU-6 Identity.** Same lead (or merged lead) identity → link; else contact matches (lead student/guardian phones and emails, `ops.guardians`) → review unless the person picks a candidate or confirms a new student. A case admitted without a conversion gets the lead's identity or a new one (`applyTransition` side effect).
- **Lifecycle edges** (in `src/domain/pipeline.ts`, guarded so only the lifecycle service applies them): enrolled → on_hold; on_hold → enrolled (resume to held status); enrolled/on_hold(enrolled) → withdrawn, completed, transferred, other_inactive (proposed); admitted/on_hold(admitted) → cancelled_before_enrolment; every exit status → admitted (reactivation; enrolment requested again). All require a reason and are audited.

## 4. API (all `defineRoute`; 401 → 403 → 400 → handler)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/ops/api/v1/demos/{id}/convert` | `ops:admissions:convert` | wizard preview; writes nothing |
| POST | `/ops/api/v1/demos/{id}/convert` | `ops:admissions:convert` (own) | Idempotency-Key honoured; 409 already converted / identity review / number taken |
| POST | `/ops/api/v1/admissions/{id}/admission-number` | `ops:admission_number:override` | `{admissionNumber, reason}` |
| POST | `/ops/api/v1/admissions/{id}/lifecycle` | `ops:students:lifecycle` (reactivate: `ops:students:reactivate`) | `{action: hold|resume|exit|reactivate, …}` |
| GET | `/ops/api/v1/students` | `ops:students:read` | `view=directory|active|on_hold|former`, `q`, `contact`, `programme`, `sort`, `limit`, `cursor`; `meta.total` |
| GET | `/ops/api/v1/students/{id}` | `ops:students:read` | canonical id or admission id |
| POST / PATCH | `/ops/api/v1/students/{id}/guardians[/{guardianId}]` | `ops:guardians:write` + private access | archive via `{archived: true}` |
| POST / GET | `/ops/api/v1/students/{id}/report` | `ops:student_reports:generate` | POST `{from,to}` → export; GET `?ref=SR-…` |

Screens: `/ops/admissions/demos/{id}/convert`, `/ops/students`, `/ops/students/past?tab=on_hold|former|demos`, `/ops/students/{id}`, `/ops/students/{id}/report[?export=…]`; admission detail shows the number and links (old demo booking form replaced by links to agent A's records).

## 5. Permissions and settings

New keys: `ops:admissions:convert`, `ops:students:lifecycle`, `ops:guardians:write`, `ops:student_reports:generate` (operations_manager all; admissions_counsellor own); `ops:admission_number:override`, `ops:students:reactivate` (operations_manager only). Matrix doc needs `npm run docs:permissions`; prototype `permissions.json` needs the same keys.
New setting: `admissions.number.format` (proposed; default `{prefix:'', separator:'-', includeYear:false, width:5}`). Conversion respects A's `admissions.demo.checklist_required` (proposed, off).

## 6. Integration requests and open questions

- **IR-OPS-STU-1 (Academic):** per-student read contract `GET /academic/api/internal/v1/students/{academicStudentId}/summary` → `{results:[{subject, examType, date, score|null, maxScore}], attendance:{present, recorded, asOf}}` (shape in `src/server/students.ts`, proposed). Until served, results/attendance show "Source unavailable"; teachers / latest assessment are not listed.
- IR-OPS-ADM-1 still applies: Academic should honour `existingStudentId`; Ops now also sends it when another case of the same canonical student was enrolled.
- Owner: approve the admission number format (prefix, year, width); confirm whether a combination (e.g. Class 12 + CLAT) should carry one admission number (current: one per conversion, on the primary case) and one shared confirmation checklist (current: each programme case passes the gate itself); whether `other_inactive` is wanted; whether reactivation needs a second person (current: yes).

## 7. Checks run

See the build agent report (scoped typecheck, lint, Vitest, `npm run build -w @elevate/business-ops-os`). No browser check was done (dev servers were not to be started).
