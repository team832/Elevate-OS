# Task tracker, teacher operations and EOD: implementation

What was built for owner brief 2 (21 Oct 2026), where it lives and what is still open. Status words follow D-013: services with passing tests are **Tested**, screens are **Implemented** (no automated browser test), nothing is Deployed. Migration `0009_academic_teacher_workspace_tasks` is generated and **not applied** (the owner runs `npm run db:migrate`).

Related: what the old tracker holds and how each field maps → [task-tracker-source-map.md](task-tracker-source-map.md) · tables, events and contracts → [task-tracker-data-contracts.md](task-tracker-data-contracts.md) · importing backups → [task-tracker-import-guide.md](task-tracker-import-guide.md) · the 19 required checks and their tests → [task-tracker-verification.md](task-tracker-verification.md). Routes: `apps/business-ops-os/docs/API.md`; rules: `apps/business-ops-os/docs/ALGORITHMS.md` A-TSK-1 … A-TSK-8, A-MTG-4, A-MTG-5.

## Decisions this rests on
D-052 (tasks and EOD in Elevate OS, no tracker code copied) · D-058 (teacher reviews written in Academic OS; Ops reads and acknowledges) · D-059 (dark theme kept) · D-060 (demo attendance by the teacher in Academic) · D-061 (12 sample teachers) · D-066 (linked demo attendance; fail-closed only for classes Ops knows are linked) · D-067 (withdrawn source review and reports) · D-068 (imported event dated at commit) · D-069 (review-gate and cancel authority) · D-071 (shared CSV helper). Coordinator rulings R1–R3: keep the D-052 statuses and add `in_review` and `cancelled`; no HR module, so HR attendance is always "HR attendance unavailable"; a manager is anyone up the `core.staff_members.manager_id` chain.

## Where the code is (`apps/business-ops-os/`)
| Area | Domain (pure) | Server | Screens |
|---|---|---|---|
| Task lifecycle, dependencies, work time | `src/domain/task-lifecycle.ts`, `staff-tasks.ts` | `src/server/staff-tasks.ts`, `task-actions.ts`, `task-store.ts` (scope: `canSee`, `mayReassign`), `task-updates.ts`, `task-detail.ts`, `pdf/task-report.ts` | `/ops/tasks` (My day, Tracker), `/ops/tasks/{id}` |
| End-of-day reports | `src/domain/eod.ts` | `src/server/eod-facts.ts`, `eod-reports.ts`, `eod-review.ts`, `eod-export.ts`, `task-period-report.ts` | `/ops/tasks?tab=eod`, `/ops/tasks/inbox`, `/ops/tasks/reports` |
| Tracker import | `src/domain/task-import.ts` | `src/server/task-import.ts` | `/ops/tasks/imports` |
| Teacher operations | — | `src/server/teacher-ops.ts`, `academic-summary.ts` (activity, demo marks) | `/ops/teachers`, `/ops/teachers/{id}` |
| Reviews from Academic | `src/domain/feedback.ts` (`matchDemoReviews`) | `src/server/academic-reviews.ts`, `review-acks.ts`, `student-report.ts` (D-067) | student profile Feedback tab, teacher profile, demo record |
| Samples | — | `seed/sample-staff.ts`, `seed/sample-work.ts`, `seed/clear-samples.ts` | SAMPLE DATA badge |

Shared: `packages/database/src/schema/ops-tasks.ts`, `ops-eod.ts`, `ops-task-imports.ts`, `ops-review-acks.ts`; `packages/authorization/src/permissions/ops.ts`; `packages/shared-contracts/src/summaries.ts`; `packages/server-kit/src/csv.ts`.

## The walkthrough (brief 2 §19)
1. A manager logs a task for a report (`POST /staff-tasks` with `staffId`); source becomes `manager`, the manager is recorded as assigner, the task is unacknowledged.
2. The teacher acknowledges (or asks for clarification), starts it and logs work updates with an IST work date.
3. With a review step the teacher submits for review; the reviewer approves or requests changes. Without one the owner marks it done (setting `tasks.completion_without_reviewer`, proposed).
4. The teacher opens End-of-day report: facts are built from that day's events and updates; they add a summary, tomorrow's plan and notes, and submit. Every open task due by that day needs a reason.
5. The report goes to the active manager's inbox (in-app notice). The manager views, comments, asks for clarification or a revision (the teacher resubmits version 2) or acknowledges, and can create a follow-up task.
6. Nothing leaves Elevate OS: "Copy summary", PDF and CSV only ("External delivery not configured").

## Not built or still open
- Bulk task changes; a calendar or board view; removing a dependency link.
- External delivery of EOD reports (no provider; `eod.external_delivery` proposed, not editable) and a submission deadline (`eod.submission_deadline` open).
- Real HR attendance or leave (no HR module; OD-026). Academic "unavailability" is an Academic availability record, not HR leave.
- Protected file storage for evidence (text or links only).
- Tracker parity: no real backup files received; the HTML holds no records.
- The prototype (`Elevate.html`) does not show this work.
- Owner questions are listed in `HANDOFF.md` "Decisions waiting for you".
