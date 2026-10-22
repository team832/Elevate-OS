# Task tracker, teacher operations and EOD: verification

Owner brief 2 §18 lists 19 required checks. This file maps each to the automated tests that cover it and says what is not automated. Test paths are relative to `apps/business-ops-os/tests/` unless they start with `apps/` or `packages/`. Build overview: [task-tracker-implementation.md](task-tracker-implementation.md). Import steps: [task-tracker-import-guide.md](task-tracker-import-guide.md); tracker source and field map: [task-tracker-source-map.md](task-tracker-source-map.md).

| # | Check (brief 2 §18) | Tests |
|---|---|---|
| 1 | Receive, acknowledge, log, update, review, close with persistent history | integration `task-lifecycle.test.ts` "test 1: receive → acknowledge → update → review → close, with history"; unit `task-lifecycle.test.ts` "A-TSK-5 task lifecycle" |
| 2 | Unauthorised users cannot reassign, close, read or export | integration `task-lifecycle.test.ts` "test 2 …", "R18: gate and cancel authority come from who logged the task", "naming someone as requester does not let them read or export the task"; `staff-tasks.test.ts` "access and own scope" |
| 3 | Dependency cycles rejected; reopen and reassign keep history | integration `task-lifecycle.test.ts` "test 3: dependencies, reopen and reassign keep history"; unit "A-TSK-6 dependencies" |
| 4 | EOD picks the right events for the local date, incl. late entries and midnight | unit `eod.test.ts` "test 4: start/stop work across midnight is split at the IST day boundary; late entries keep their day" |
| 5 | A future completion never appears in an earlier EOD | unit `eod.test.ts` "test 5 …"; integration `eod-reports.test.ts` "test 5 + 6 …" |
| 6 | A missing source stays unknown | unit `eod.test.ts` "test 6: HR attendance is always unavailable and a failed Academic call says so"; integration `eod-reports.test.ts` "test 5 + 6 …"; `academic-reviews.test.ts` "Academic down is \"source unavailable\", never an empty list", "directory: Academic down is per teacher \"unavailable\", never zero" |
| 7 | Linked class and task time not double counted | unit `eod.test.ts` "test 7 …"; integration `eod-reports.test.ts` "test 7: Academic activity for the day is read from the teacher activity contract" |
| 8 | EOD snapshots unchanged after source edits | integration `eod-reports.test.ts` "test 8: a later source edit never changes the submitted version; the report flags it" |
| 9 | Revision = new version; submission and retry idempotent | integration `eod-reports.test.ts` "test 9 …" (two cases), "two submits at once make one version" |
| 10 | Manager resolved; a missing manager blocks only submission | integration `eod-reports.test.ts` "test 10: submit goes to the reporting manager …", "blocks only submission until the employee chooses an EOD reviewer; the reporting line is not changed", "an inactive manager is not a recipient" |
| 11 | Submission, delivery and acknowledgement are distinct | integration `eod-reports.test.ts` "test 11: review actions — viewed once, revision needs text, acknowledgement is separate from tasks" |
| 12 | No connector → no fake success; retries never duplicate sends | integration `eod-reports.test.ts` "there is no simulated share route; nothing claims to be sent"; nothing is sent anywhere (no provider) |
| 13 | Teacher reviews keep author, version and access, and update downstream | `apps/academic-os/tests/integration/reviews.test.ts`; integration `academic-reviews.test.ts` (reading, withdrawn hidden, acknowledgements, review grid); `feedback.test.ts` (old Ops rows read-only); `academic-reports.test.ts` (reports; withdrawn source review, D-067) |
| 14 | 12 distinct linked fictional teachers, rerunnable, never send | integration `seeds.test.ts` "holds 12 distinct linked sample teachers with their sample work, sending nothing (brief 2 test 14)"; `apps/academic-os/tests/integration/sample-teaching-seed.test.ts` |
| 15 | Import preview shows errors; re-import idempotent; no resends | integration `task-import.test.ts` "previews without importing, then commits once, writing no notifications", "re-uploading the same file …", "two uploads of the same new file at once …", "a newer export reports changed records …"; unit `task-import.test.ts` |
| 16 | HTML without storage data is not treated as a full export | unit and integration `task-import.test.ts` (the tracker HTML is refused with "This is the tracker program, not a data export") |
| 17 | PDF and CSV accurate, readable, permission checked | integration `eod-reports.test.ts` "test 17: PDF and CSV …"; `task-reports.test.ts` "test 17: CSV and PDF downloads keep the scope and are audited"; `task-lifecycle.test.ts` "CSV: a corrected entry is marked superseded with no minutes"; `packages/server-kit/tests/csv.test.ts` |
| 18 | Admissions and Academic regressions pass | the whole suite (`npm run validate`) |
| 19 | Mobile forms, search and filters, concurrent edits | concurrency: `task-lifecycle.test.ts` "a stale expectedVersion is refused with 409", `eod-reports.test.ts` "a stale editor version is refused", `task-import.test.ts` concurrent upload. Mobile layout and keyboard use: browser check only (not automated) |

Not automated: a browser pass of the new screens at phone width with keyboard and axe; reading the generated PDFs by eye; parity with real tracker data (no backup files received yet).

## Results (22 Oct 2026, coordinator)

| Command | Result |
|---|---|
| `npm run validate` | exit 0 — typecheck + lint 0 warnings + `Test Files 158 passed (158)`, `Tests 2069 passed (2069)`, secret scan OK (1,166 files) |
| Live check over HTTP (fresh dev servers, sample data) | manager assigns a reviewed task → teacher acknowledges, starts, logs 45 min, submits for review → owner's attempt to drop the review step refused (403) and to close without review refused (409) → EOD draft, submit, double submit returns the same version → manager inbox lists it, viewed / comment / acknowledged → task still in review (acknowledging an EOD closes nothing) → reviewer approves; counsellor refused (404); EOD PDF and task-report PDF downloaded, 2 pages each, looked at (fixed: arrows printed as "?", an orphaned Chronology heading, "No recorded activity" wording) |
| Browser pass with the Chrome extension | done 22 Oct at 1440 px: manager assigns → teacher acknowledges, logs 30 min, submits → EOD shows the recipient before submit → manager inbox comment + acknowledge → approve; findings fixed (false "Source changed" banner = jsonb key order; comment box now clears; "Decisions or help requested" lists only clarification requests). 390 px not checked |
| `npm run build` | exit 0 for platform, marketing-os, academic-os, business-ops-os |
| Browser check (screens at 1440 and 390 px) | not done — needs migration 0009 applied locally first |
| PDF check by eye (EOD, task report, period report) | not done |
