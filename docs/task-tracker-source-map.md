# Task tracker source map

What the old task tracker holds, where, and what Elevate does with each piece (owner brief 2 §2, §13). Status words follow D-013.

## The source

| Item | Value |
|---|---|
| File | `C:\OPENBOT\elevate-data\Task Tracker.html` (a purchased tool, "Daily Task & EOD Report Tool") |
| Size | 108,033 bytes, 1,453 lines |
| SHA-256 | `2977ed2bc585c105314d2fba4aec38a35234e0e65b528ec51e55764a4efeb2ee` |
| Version or date inside the file | None. No version string, no build date |
| Date known | Copy's file time 21 Oct 2026 15:04 IST. That is when the copy was made, not when the tool was written |
| Other variants | None found. One file is the authoritative copy |
| Guide | `Guide to use task tracker.pdf` beside it (SHA-256 starts `12d21877`) |
| Records in the HTML | **None.** The tool keeps everything in the browser's `localStorage` (key `deskday_employee_blank_v1`, line 551). Its built-in starting state is empty (lines 575–583) |
| Licence | Purchased tool. No code is copied into Elevate (D-052); the HTML was read as text only, never run |

Because the records live only in each person's browser, they reach Elevate only through each person's **backup file** (`Task-EOD-backup-YYYY-MM-DD.json`, written by "Backup → Export backup", line 1392). Uploading the HTML is refused with "This is the tracker program, not a data export" (test 16). Until backup files arrive, import and parity are **pending source data**.

## Backup file shape (what the importer reads)

`{ customTemplates[], setupDone, profile{…}, clients[], tasks[], reports[] }` — the tool's whole state, saved with `JSON.stringify` (line 1392). Parser: `apps/business-ops-os/src/domain/task-import.ts` (parses with `JSON.parse`, never runs anything; checks each record on its own, so one bad record does not stop the file).

## Feature and field map

| Legacy feature / field | Source (HTML lines) | What it means in the tool | Destination in Elevate | Transformation | Decision |
|---|---|---|---|---|---|
| Storage | 551–554 | Whole state in one `localStorage` key; a failure falls back to memory | `ops.task_import_batches.raw` (protected copy, `ops:tasks:import` only) | Kept as uploaded (parsed JSON) | Preserved |
| Backup export | 349, 440–452, 1390–1392 | Downloads the state as `Task-EOD-backup-<UTC day>.json` | Upload on `/ops/tasks/imports` | File name date kept as `source_version` "Exported YYYY-MM-DD (from the file name)" | Preserved |
| Backup import | 450–452, 1393 | Replaces the whole state with a file (no merge) | — | Not reproduced: Elevate previews and adds records, never replaces | Intentional change (data-loss risk) |
| Clear all / reset | 454, 1434–1436 | Wipes tasks or everything | — | Not reproduced | Intentional change |
| Profile | 476–497, 579, 1408–1428 | name, firm, designation, empId, department, reportingTo, phone, email, logo, avatar | Staff mapping on upload | Email and employee ID only **suggest** a staff member, by exact match to a staff email or staff code; never by name. Phone, logo and avatar stay only in the raw copy | Mapping reviewed by a person |
| `tasks[].id` | 1358 (`Date.now()`) | Task identity (milliseconds number) | `staff_tasks.legacy_ref` = `deskday_backup_json:<staffId>:<id>` | Unique key; re-import never duplicates | Preserved |
| `title` | 1343–1345 | Required in the tool | `title` | Trimmed; empty → unresolved | Preserved |
| `details` | 1345 | Free text | `details` | Trimmed | Preserved |
| `by` | 1325, 1346 | Who gave the task (free text, defaults to "Reporting to") | `requester_note` "Given by …" | Text only; never matched to a person | Preserved as text |
| `client` + `clients[]` | 930–979, 1310–1311, 1346 | Client name (the tool was made for a CA firm) | `requester_note` "Client: …"; list kept in raw | No client entity in Elevate | Preserved as text |
| `prio` | 564, 1327 | High / Medium / Low | `priority` high / medium / low | Case-insensitive; anything else → unresolved | Preserved |
| `deadlineDate`, `deadlineTime` | 1328–1329, 1346 | Due day (may be empty: "No deadline") and HH:MM (default 18:00) | `due_on`, `due_time` | A task with no deadline is **unresolved** (Elevate needs a due day; none is invented) | Preserved; gap reported |
| `status` | 557–563, 589, 1330 | Not started / In progress / Done / Blocked / On-hold (older copies: "Not Started", "In Progress", "On-Hold") | `status` | Not started→`pending`, In progress→`in_progress`, Done→`done`, Blocked→`blocked`, On-hold→`on_hold`; unknown → unresolved | Preserved (D-052 vocabulary) |
| "Overdue" | 571, 606 | Shown, not stored: not Done and past deadline (default 23:59) | Derived by Elevate (A-TSK-2) | Not imported | Derived again |
| `prog` | 1347, 1378 | Self-reported 0–100; Done forces 100; un-ticking Done drops 100 to 90 | `progress_percent` | Outside 0–100 → unresolved; Done → 100 | Preserved, labelled self-reported |
| `reason` | 623, 1347 | Free-text note, shown for Blocked/On-hold | `reason` | Blocked/On-hold without one get "Not recorded in the old tracker" (the database needs a reason); noted on the row | Preserved |
| `recur` | 422–429, 1348, 1383–1386 | '' / daily / weekly / monthly; finishing a task adds the next one as a new task | `recurrence` | Each occurrence the tool created is already its own task and imports as one | Preserved |
| `createdAt` | 1358 | Day only (UTC day, see below) | `received_at` = 00:00 IST that day; the legacy day is in the `imported` event | Missing → import time, noted | Preserved as a day |
| `completedAt` | 1355–1356, 1380 | Day only; cleared when not Done | `completed_at` = 00:00 IST that day | Done without it → unresolved | Preserved as a day |
| Task history | — | The tool keeps none (edits overwrite) | One `imported` event per task, dated at the commit (R17), legacy dates in `data.legacy` | **No history is synthesised**; imported tasks do not appear in replays of earlier days | Legacy snapshot only |
| `reports[]` | 1041–1050, 1175–1180 | One saved EOD per day `{id, reportDate, generatedAt, meta, data, text}`; at most 150 kept; regenerating a day overwrites it | `ops.eod_reports` (status submitted, version 1) + one `eod_report_versions` row; snapshot `kind: "legacy_tracker_report"` | Logo removed from the copy shown (kept in raw). Never notified or sent. A day that already has an Elevate EOD is **skipped** | Historical record, marked imported |
| EOD review step | 991–1043 | Before generating, ticking boxes changes task status (done ↔ in progress) and reasons | — | Not reproduced: an EOD in Elevate never edits tasks (brief §9) | Intentional change |
| EOD categories | 1055–1069 | done / in progress / on-hold / pending / carried / tomorrow, from **current** status | Elevate EOD built from dated events (O2) | Legacy `data` kept as it was | Legacy bug not reproduced (brief §9: not from current status) |
| Late report | 1087–1088 | "Late" when generated on another day | Submission time kept (`submitted_at` = `generatedAt`) | — | Preserved as a time |
| Print / PDF | 1078, 1169, 1225 | Browser print | Elevate PDF exports | — | Replaced |
| Send to boss | 1081, 1171, 1227, 1267–1281 | Instructs the user to send the PDF or WhatsApp text by hand | In-app submission to the resolved manager | Nothing is sent on import | Replaced |
| Range report | 1184–1260 | Totals by day and client over dates, by deadline day | Elevate period reports (O2) | Not imported (computed) | Replaced |
| Views: Today, All tasks, Calendar, Clients, EOD | 593, 682, 795, 866, 928, 989 | Screens | Elevate task screens | — | Replaced |
| Task templates | 565, 1303–1311 | Title shortcuts (GST/ITR names) + `customTemplates[]` | — | Kept in raw only | Not imported (no Elevate equivalent) |
| `setupDone` | 578, 1428, 1443 | First-run flag | — | Ignored | Not needed |

## Known legacy bug: the UTC day

`todayStr()` (line 568) takes the day from `toISOString()`, which is UTC. Between 00:00 and 05:29 IST the tool stamps **the previous day** on `createdAt`, `completedAt`, `reportDate` and the backup file name. Elevate imports the dates exactly as written and shows this note on every import; it does not guess a correction.

## Repair and rollback

- Re-uploading the same file for the same person imports nothing: imported records show "Already imported", unresolved and unreadable ones keep their outcome. Committing a batch twice, or two uploads of one file at once, is refused (409).
- A newer export marks edited records "Changed" and keeps Elevate's values (never overwrites newer app data).
- Unresolved rows are fixed in the tracker by the person (add a deadline, a reason, a known status) and exported again; the next import picks them up.
- To undo a committed import before the tasks are used: the batch id is on every imported task (`import_batch_id`) and event. There is no one-click undo; an operations manager removes them with a reviewed database change (back up first, D-024).
