# Existing project audit

**Prepared:** 2026-10-17 by the Audit agent (Build Plan wave 1b).
**Scope:** the legacy material that Elevate OS replaces or imports from. Nothing in the legacy folders was modified.
**Companion document:** `docs/PRODUCT_REQUIREMENTS.md` (requirements derived from this audit). Owner decisions are numbered `OD-001…` in section 9 and cross-referenced there.

Path shorthand used throughout:

| Shorthand | Meaning |
|---|---|
| `A/` | `C:\OPENBOT\OLD\01-original-elevate-os\` (the content-OS folder tree, "Project A") |
| `B/` | `Elevate-Education/` inside `A/Elevate-Education-Agent-Handover-2026-10-15.zip` (the operations and academic-planning handover, "Project B"). For this audit it was read from a read-only extracted copy in the session scratchpad. That copy is temporary, so importers must read from the zip. |
| `EXTRACTION` | `C:\OPENBOT\OLD\03-early-analysis\ELEVATE-OS-COMPLETE-EXTRACTION.md` (an earlier summary, used as a guide only) |

---

## Key findings (summary)

1. **There is no application to preserve.** The only code is two dependency-free Node scripts in `A/tools/` and sixteen spreadsheet and document builder scripts in `B/work/`. The builders cannot run as they stand. The business logic lives in Markdown decisions and in Excel formulas, and this audit locates and checks them (section 3.5).
2. **Two projects, two account models.** Project A's approved structure (6 Oct 2026) has 9 social accounts with no "Elevate main" page. Project B's marketing stream and workbook list Instagram pages named "Elevate CA" and "Elevate Online". That conflicts with A's rules ("CA is not promoted as a course", "never 'online' as a label"). See OD-001.
3. **The idea tracker has 4 duplicate IDs** (8 rows). It holds 59 rows with 55 unique IDs, not "about 56" as EXTRACTION says. Two `versions.csv` rows point at duplicated IDs. See section 6, DI-01 and DI-02.
4. **The Class 12 (IPMAT) capacity math checks out.** The workbook gives 157 regular days × 2 + 31 third-class slots = 345 gross, minus 28 reserved slots = 317 net, against 305 planned classes, leaving 12 slots of headroom. I recomputed the 157 days and 31 extra slots independently from the stated calendar rules and got the same result. The capacity figures do **not** prove that a dated schedule is feasible. Public holidays are not deducted, and assessments are not fitted.
5. **Several "approved" items conflict across files.** CA Foundation's start date and session length are an example (DI-18). So is the full-mock count, 70 or 50 (DI-16). EXTRACTION reports the CA start as confirmed and the mocks as 50; both are contested in the sources.
6. **35 files in Project A are dead symlink stubs.** Four of them are *relative* links whose targets exist in the tree, so their content is recoverable. The other 31 point into `/Users/sushant/...` and the content is absent. None of the stubs are in the zip.
7. **Nothing proves delivery.** No class, test, publication after 11 Oct, lead or admission is evidenced as *completed* in any file. All planned counts must be imported as planned (D-016).

---

## 1. Scope and method

### 1.1 What was read
- **Project A, in full:** every text file (`CLAUDE.md`, `HANDOFF.md`, `Claude1.md`, `brand/BRAND.md`, all `accounts/**`, `courses/**`, `tracker/*.csv`, `ideas/inbox.md`, `library/**` text files, `plans/**`, `reports/**`, `tools/*` and `tools/README.md`, all eight `.claude/skills/*/SKILL.md`, `.env.example`). Every file under 100 bytes was dumped to identify symlink stubs.
- **Project B:**
  - all Markdown in `elevate-education-operations/` (including `templates/`) and `outputs/`;
  - `Claude.md`, `PACKAGE_NOTES.md` and `MANIFEST.json`;
  - every `.mjs` and `.py` in `work/` (headers, imports, paths, save targets and modes; `build_class12.mjs` capacity logic in detail);
  - `work/artifact.md`, `work/class12-accelerated-summary.json` and `work/class12-weekend-map.json`.
- **All 8 workbooks** were opened with `openpyxl`, both formulas and cached values: sheet list, visibility, data validations and table names, with the key sheets dumped cell by cell. The SOP `.docx` was read through `word/document.xml`.
- **EXTRACTION** was read in full and spot-checked claim by claim (section 6.2).

### 1.2 What was not read
- `B/source-references/Part_1.md` (0.84 MB) and `Part_2.md` (1.04 MB) were read for their headers only, to establish provenance (section 10). The same applies to `THE IIM GUIDE (just after 12th).md` and `IMS-test-timetable-reference.txt`.
- The 105 PNG previews in `B/work/` and the two NDJSON inspection logs (2.3 MB and 1.0 MB) were not opened. They are historical render snapshots, and the handover itself says they are "not proof of current state".
- The external material referenced by the files was not reachable from this machine:
  - two Google Sheets;
  - the Claude Docs "master plan" artifact;
  - `~/.claude/scheduled-tasks/`, `~/.claude/linkedin/` and `~/Video Studio Official`;
  - Metricool and Taplio.

### 1.3 How claims were verified
- **Counts** (ideas, versions, duplicates, statuses, lessons, tests, chapters) were recomputed with Python from the files, not taken from prose.
- **Formulas** were read as formulas, and their cached values were compared with the Markdown claims.
- **Capacity:** the Class 12 gross capacity (157 days, 31 extra slots) was recomputed independently from the calendar rules in `build_class12.mjs` and `CLASS12_ACCELERATED_BASELINE.md`.
- **Arithmetic:** the locked IPMAT baselines and the CA, Online-Accountancy and CR allocations were re-added by hand. Each matches its stated total, except the documented 36-vs-38 Quant practice slip (DI-17).
- **Integrity:** `MANIFEST.json` was checked against the extracted files. All 167 SHA-256 hashes match, and no file is missing. `A/Claude1.md` is byte-identical to `B/Claude.md`.
- **Limit:** nothing outside the two sources was verified, including exam dates, competitor numbers and platform capabilities. Any external fact here is quoted, not endorsed.

---

## 2. Inventory

### 2.1 Project A: content operating system (`A/`, 107 files)

Made in Claude Code sessions, 5 to 13 Oct 2026, for CA Nikunj Bindal (Co-Founder). The files contain macOS paths under `/Users/sushant/`.

| Folder | Files | What it holds | Real content? |
|---|---:|---|---|
| root | 6 | `CLAUDE.md` (operating manual and rules), `HANDOFF.md` (state as of 6 to 7 Oct), `Claude1.md` (an identical copy of `B/Claude.md`), `.env.example` (`YT_API_KEY=`), `studio` (stub), the 11 MB handover zip | 5 real, 1 stub |
| `.claude/skills/` | 8 | Procedures for `/idea`, `/weekly-plan`, `/write-post`, `/video-script`, `/make-image`, `/repurpose`, `/competitor-scan`, `/weekly-report` | Real (procedures, not code) |
| `accounts/` | 24 | One folder per social account: README with job, cadence and rules. CLAT also has `PROFILE.md`, a strategy, a calendar and `post-audit.csv` (60 historical posts with metrics). | 14 real files (10 READMEs, `PROFILE.md`, strategy, calendar, `post-audit.csv`). 7 stubs (4 `linkedin-nikunj/*`, 3 `youtube-clat/*`). 3 `youtube-*/channels.json` hold only the placeholder `@REPLACE-WITH-OUR-HANDLE`. |
| `brand/` | 3 | `BRAND.md` (facts, claims rules, faculty, the founder's story bank) | 1 real, 2 stubs |
| `courses/` | 25 | Per course (`clat`, `ipmat`, `cuet`, `commerce`): `facts.md`, `competitors.md`, `intel.md`, `questions.md`, `worked.md`, `channels.json`, plus one scan (`cuet/scans/2026-10-12.md`) | All 4 `worked.md` and 2 `questions.md` (commerce, cuet) are one-line placeholders |
| `ideas/` | 1 | `inbox.md`: raw ideas, some marked "filed as <ID>" | Real |
| `library/` | 31 | `<ID>-<slug>/` asset folders, `_brand/`, `_broll/` | 6 real text files: `library/README.md`, `_broll/README.md`, `_broll/CATALOG.md` (an empty table), `GEN-011-…/README.md`, and two scripts (`CLAT-008-…/script.md`, `GEN-012-…/script.md`). **25 stubs.** Folders `CLAT-001-…`, `COM-001-…`, `CUET-001-…`, `IPMAT-002-…` and four `_broll/*` subfolders are empty. |
| `plans/` | 1 | Team and volume plan, Oct to Dec 2026 (marked PROPOSED) | Real |
| `reports/` | 3 | Weekly report (4 to 11 Oct), next-week plan (12 to 18 Oct, DRAFT), `inbox/README.md`. Eight empty `inbox/<account>/` folders. | Real |
| `tools/` | 3 | `yt-scan.mjs`, `import-metrics.mjs`, `README.md` | Real |
| `tracker/` | 2 | `ideas.csv` (59 rows), `versions.csv` (36 rows). `metrics.csv` does not exist. | Real (with defects, section 6) |

### 2.2 Project B: operations and academic-planning handover (zip, 169 files)

Packaged 15 Oct 2026. Script paths show `/Users/sushant/Documents/Codex/2026-09-10/i-m` and `/Users/sushant/.codex/...`, which indicates a Codex-based agent working from September to October 2026. The zip has no `__MACOSX` entries and no symlink stubs.

| Folder | Files | What it holds |
|---|---:|---|
| root | 3 | `Claude.md` (reconstructed handover and rules), `MANIFEST.json` (167 SHA-256 entries), `PACKAGE_NOTES.md` (exclusions, rights caveat) |
| `elevate-education-operations/` | 10 + 4 | Charter, 13-department architecture, 12-week roadmap, README, IPMAT locked baselines, Class 12 accelerated baseline, academic planning decisions, CA Accountancy draft v0.1, IPMAT reference notes, IPMAT web-reference review. `templates/`: SOP template, SOP register CSV, master tracker CSV, department intake form. |
| `outputs/` | 5 md | CA Accountancy full plan v0.2 (46 topics), Combined IIM entrance syllabus v1.0 (draft), Quant class estimates v0.1, Quant teaching estimates v2, Verbal teaching estimates v2 |
| `outputs/elevate-education-operations/` | 8 | Byte-identical copies of the README, charter, architecture, roadmap and 4 templates (verified with `cmp`) |
| `outputs/*/` | 8 xlsx + 1 docx | `class12-planner/Class-12-Course-Planner.xlsx`, `concept-books/Elevate-Concept-Book-Indices.xlsx`, `concept-books/Quant-Exam-Index-Comparison.xlsx`, `elevate-operations/Elevate-Operations.xlsx`, `marketing-operations/Elevate-Marketing-{Easy,Operations}.xlsx`, `online-operations/Elevate-Online-{Easy,Operations}.xlsx`, `online-operations/Elevate-Online-Coordinator-SOP.docx` |
| `source-references/` | 4 | `Part_1.md`, `Part_2.md` (OCR of a reasoning textbook), `THE IIM GUIDE (just after 12th).md`, `IMS-test-timetable-reference.txt` |
| `work/` | 83 + 43 in subfolders | 13 `.mjs` and 3 `.py` builders; 105 PNG previews; 2 NDJSON logs; 2 JSON summaries; `artifact.md` |

**Workbook contents (verified):**

| Workbook | Sheets (hidden in brackets) | Data state |
|---|---|---|
| Class-12-Course-Planner | Overview, Monthly allocation, Lesson planner (table `LessonPlan`), Assessment budget, Chapter tests (table `ChapterTests`), Weekend map | 305 dated lesson rows (1 Apr to 15 Oct 2027) and 70 chapter tests (last on 13 Nov 2027). All delivery fields are blank and every status is `Not started`. |
| Elevate-Concept-Book-Indices | Overview, 6 book tabs | 133 numbered chapters plus 1 opening unit. CR question counts are filled. The content columns are empty. |
| Quant-Exam-Index-Comparison | Read first, Exam sources (S1–S9), Our Quant index, Topic comparison, Index decisions | Evidence tables only |
| Elevate-Operations | Dashboard, Work Inventory, Decisions, Batch Register, Accountancy Plan, Teaching Log, Test Tracker, Catch-up Log, SOP Register, Guide | 25 processes, 24 decisions, 1 batch (`CAF-SEP27-REG`), 46 Accountancy topics, 11 tests. The logs are empty (200 and 60 prepared rows). |
| Elevate-Marketing-Easy | Home, Content, Tasks, (Project Plan, Dashboard, Start Here, Post Performance, Campaigns, Spend, Outreach, SOP Register, CRM Import, Cohorts) | Empty templates. IDs `EE-001…EE-200` and `TASK-001…TASK-200` are preallocated, all with account "Elevate Sikar" and no titles. 9 SOP summaries (MKT-01…09). |
| Elevate-Marketing-Operations | The same tabs, all visible | An earlier full version, not synchronised with Easy (stated in the Easy Home sheet) |
| Elevate-Online-Easy | Home, Actions, (Routine, SOP Register, Rules), Roles | 10 populated actions (ON-001…ON-010), 16 SOP scopes (ON-01…16), 20 rules with decision states, 12 roles |
| Elevate-Online-Operations | Home, Actions, Routine, SOP Register, Rules | An earlier version without Roles |

### 2.3 Relationship between the two projects
- They are separate efforts made with different agents, and neither imports the other's data.
- They overlap in scope: marketing operations (B) against the content OS (A), and lead handling (B's CRM rules) against A's lead CTAs. They also overlap in time: B's marketing workbook carries cached `TODAY()` values of 7 to 11 Sep 2026, while A's account decision is dated 6 Oct 2026.
- Both carry paths for the same macOS user account (`sushant`). The files do not establish whose machine that is.

---

## 3. Existing functionality and reusable code

### 3.1 `A/tools/yt-scan.mjs` (211 lines, Node ESM, no dependencies; uses the global `fetch`, so Node 18 or later)

| Aspect | Detail |
|---|---|
| Invocation | `node tools/yt-scan.mjs <course> [--days=30] [--fixture=<file.json>]` or `--account=<accounts folder>` |
| Input | `courses/<course>/channels.json` or `accounts/<account>/channels.json`: an array of `{name, id \| handle \| search}`. Reads `YT_API_KEY` from the environment or `A/.env`. |
| External API | YouTube Data API v3: `channels` (by id or `forHandle`), `search` (100 units), `playlistItems` (up to 6 pages × 50) and `videos`. The quota is noted in the header. |
| Output | `<dir>/scans/<YYYY-MM-DD>.csv` with columns `channel,title,published,format,minutes,views,likes,comments,views_per_day,outlier_score,url`, sorted by outlier, plus `<date>.md` (a channel summary, a median outlier score per format, and the top 15 videos) |
| Algorithm | `age = max(1, days since publish)`; `vpd = views/age`; `outlier = vpd / median(vpd of that channel in the window)`. Format buckets: live, `≤180 s` short, `≥1800 s` long, otherwise video. |
| Defects found | (1) Live detection reads `v.liveStreamingDetails`, but the request asks only for `part=snippet,statistics,contentDetails`, so past live streams are never detected as live and are bucketed by duration. (2) The date stamp is local time, so it depends on the machine's timezone. (3) The header comment's example `--account=youtube-elevate` names a folder that does not exist. (4) A failed channel is recorded as an error row, and the run continues, which is the correct behaviour. |
| Evidence of use | **None against the live API.** No `.env` exists. Own-channel `channels.json` files are placeholders. The `clat` and `ipmat` `scans/` folders are empty. The only scan file (`cuet/scans/2026-10-12.md`) states it was done "in the browser… judged by eye (not the yt-scan median formula)". `HANDOFF.md` says the tool was "tested on sample data", but no fixture file is present, so this cannot be verified. |
| Reuse verdict | **Port the algorithm, not the file.** The outlier-score function and format buckets are reusable as a pure function in Marketing OS (competitor analytics, P2), behind a YouTube adapter interface (D-014) with a mock default. Fix defect (1) by requesting `liveStreamingDetails`. |

### 3.2 `A/tools/import-metrics.mjs` (154 lines, Node ESM, no dependencies)

| Aspect | Detail |
|---|---|
| Input | Every `*.csv` in `A/reports/inbox/<account>/`, where the folder name is the account. The format is auto-detected from headers: YouTube if a header contains `video title` or `watch time`; Instagram if it contains `permalink`, `reach` or `post type`. |
| Parsing | Its own RFC 4180 parser handles quotes, embedded newlines and a BOM. Headers are matched case-insensitively, exact first and then by substring. |
| Output | `A/tracker/metrics.csv` with columns `account,platform,published,title,link,format,views,reach,likes,comments,shares,saves,watch_hours,impressions,ctr_pct,imported_on`. The key is `account|link`, or `account|title|published` when there is no link, and newer imports overwrite in place. Processed files move to `reports/inbox/processed/<date>/<account>/`. |
| Good rule to keep | `num()` returns blank for a missing or empty cell: "a missing column stays blank, never a fake 0". This is the legacy precedent for the missing-versus-zero requirement. |
| Defects found | (1) Instagram `views` falls back to `plays`, then `impressions`, so different metrics can land in one column without a marker. (2) `day()` uses `Date.parse`, which reads `10/12/2026` month-first (US style). That may be right for Meta exports but has not been verified. (3) YouTube format is inferred from duration (`≤180 s` = short), which is an estimate rather than a platform flag. (4) There is no snapshot window: lifetime-to-date numbers at export time are stored without a capture timestamp other than `imported_on`. (5) The header comments name `instagram-elevate/` and `youtube-elevate/` folders that do not exist (the code itself handles any folder name). (6) Re-importing the same filename on the same day overwrites the earlier processed copy. |
| Evidence of use | **Never run.** `tracker/metrics.csv` is absent and the 11 Oct report says the inbox was empty. |
| Reuse verdict | **Reusable as an importer specification.** Port it to a TypeScript importer in Marketing OS: header map, detection and keying. Add explicit date formats, per-metric state (reported, missing, estimated), capture time, provenance (file hash and row) and a dry-run report. |

### 3.3 Claude Code skills (`A/.claude/skills/*/SKILL.md`)
These are written procedures, not code. Generating content with AI is out of scope (D-015), but the skills encode workflow rules that the requirements reuse:
- `/idea`: the ID rule "next = highest existing + 1".
- `/weekly-plan`: one LinkedIn post a day; no student tips on LinkedIn; the same idea is staggered across accounts; "schedule nothing until Nikunj says yes".
- `/write-post`: a fact-check pass and a never-list.
- `/repurpose`: one `versions.csv` row per placement, staggered dates, and an evergreen re-use flag after 60 to 90 days.
- `/weekly-report`: KPI formulas, and the rule "with fewer than ~6 posts, say the pattern is not reliable yet".

### 3.4 `B/work/` builders (16 scripts)

| Script | Computes or produces | Why it cannot run here |
|---|---|---|
| `build_class12.mjs` (430 lines; modes `--accelerate`, `--exclusions`, `--trim-practice`, `--map-tests`, `--preview-only`) | Generates lesson rows, monthly allocation, calendar-day capacity, a weekend chapter-test map with a 210-minute cap, and `work/class12-*.json` summaries | Imports `@oai/artifact-tool`, which is not in the archive. I did not check whether it is publicly obtainable. Root is hard-coded to `/Users/sushant/Documents/Codex/2026-09-10/i-m`. The default mode **writes `Class-12-Course-Planner.xlsx` from scratch**, so it would wipe the later 305-class edits. |
| `build_concept_index.mjs` | The six-book index workbook | The same library and path. `Claude.md` §12 says it represents the **older structure** and "can undo later chapter changes". |
| `add_cr_counts.mjs`, `merge_lr.mjs`, `move_conversation.mjs`, `move_vocab.mjs` | One-shot edits to the concept-book workbook (CR counts; merge B4-10/11; move B1-25 to B5-07; move B1-12…17 to B6-18…23). Without `--edit` they only render previews. | The same library and path, and they are **not idempotent**: each assumes the pre-migration layout. |
| `build_marketing.mjs`, `simplify_marketing.mjs` | The 12-tab marketing workbook, then the Easy variant (hides tabs by editing XML with `jszip`) | Also loads a template `.xlsx` from `~/.codex/plugins/cache/.../reference.xlsx`, which is not bundled. Overwrites outputs. |
| `build_online.mjs`, `simplify_online.mjs`, `roles_online.mjs` | The online workbook, its Easy variant and the Roles tab | The same library and absolute paths. Overwrites outputs. |
| `build_operations.mjs` | `Elevate-Operations.xlsx` (relative path `outputs/elevate-operations`) | The same library. Recreating the file would drop later edits. |
| `build_quant_evidence.mjs` | `Quant-Exam-Index-Comparison.xlsx` | The same library and path |
| `add_navigation.py` | 18 internal hyperlinks in `Elevate-Operations.xlsx`, by editing XML | Relative path. Runnable in principle, but it mutates a workbook in place. |
| `build_staff_sop.py` | The coordinator SOP `.docx`, cloned from a reference template (`lxml`) | The template lives at `~/.codex/plugins/.../reference.docx`, which is not bundled. The output is absolute. |
| `package_handover.py` | The handover zip and `MANIFEST.json` | Reads from `/Users/sushant/Downloads` and `~/.codex/attachments/...` |

**Verdict:** none of the builders are to be migrated or run. Their **logic** (capacity rules, test readiness, weekend cap) is captured as requirements and algorithms. The workbooks they produced are the authoritative data, and `Claude.md` §12 says so too: "existing output files take precedence".

### 3.5 Spreadsheet formulas that encode business logic (located and checked)

**`Class-12-Course-Planner.xlsx`**

| Location | Logic | Verified value |
|---|---|---|
| Overview `B5:C8` | `COUNTIFS(Lesson planner subject, session type)` | Teaching 151/57/32/13 = 253; practice 27/13/7/5 = 52 |
| Overview `E5:E9` | Hours = classes × `B13` (75 minutes) / 60 | 381.25 h |
| Overview `F`,`G` | Completed = `COUNTIFS(status="Complete")`. Actual hours stay **blank** (`""`) when no actual minutes exist, so missing is not zero. | 0 and blank |
| Lesson planner `M` | Variance = actual − planned minutes, blank if there are no actuals | All blank |
| Monthly allocation `D` | Net slots = scheduled days × classes per day + third-class slots − excluded slots (`'Assessment budget'!E44:E50`) | April 42 … October 50; whole year 605 |
| Monthly allocation `M` | Slots before assessment use = net − assigned | August 0, September 0 (after the practice trim) |
| Assessment budget `B30` | Gross pre-IIMB slots = 157 regular days × 2 + 31 third classes | **345** (independently recomputed: Mon–Fri 1 Apr–30 Jun and Mon–Sat 1 Jul–15 Oct 2027 give 157 days; Tue/Thu from 1 Jul give 31) |
| `B31`, `B32` | Planned = `Overview!D9` (305); headroom = 345 − 305 | 305; 40 |
| `E44:E50`, `E51` | Excluded slots = (holiday days + school-exam days) × slots per day, by month | 2+0+2+0+3+15+6 = **28** |
| `B52` | Net pre-IIMB slots = `B30 − E51` | **317** |
| `B35` | Headroom after losses = `B32 − B34` | **12** (317 − 305) |
| `B53` | Relocation needed = `MAX(0,−M_Aug) + MAX(0,−M_Sep)` | 0 |
| `E5:E19`, `E20` | Assessment hours = (test + discussion minutes) / 60. Full-mock test minutes are blank, and `F20` says "blank duration inputs are not zero-duration tests". | 328.25 h known (without full-mock test time) |
| `E24` | `MAX(0, known programme hours − whole-year gross hours)` | 0. This is an annual lower bound, not proof of feasibility. |
| Chapter tests `E` | Planned topic completion = `MAX(planned dates of prerequisite lessons)` | |
| Chapter tests `L` | `IF(test date > completion, "After planned completion", "Move test: topic unfinished")` | All 70 rows are "After planned completion" |
| Weekend map `E:I` | Saturday test and Sunday discussion minutes; remaining = 210 cap − total | Maximum weekend use is 210 (verified) |

Data checks run on the planner:
- 305 unique lesson IDs, with no duplicates.
- At most 3 classes on any day; 26 days have only 1 class (where practice was removed).
- No lesson is dated after 15 Oct 2027.
- 70 tests (Quant 25, Verbal 28, LR 11, DI 6) totalling 2,865 test minutes and 2,280 discussion minutes, which is 85.75 h.
- 12 tests fall after 15 Oct and 1 after 10 Nov.

**`Elevate-Operations.xlsx`**
- **Accountancy Plan `H` (actual hours):** `SUMIFS(Teaching Log minutes)` where the batch and topic match, activity = `Main teaching/practice`, status = `Completed` or `Partial`, `Verified by` is non-blank and `Verified at` > 0, divided by 60. **Only verified sessions count.**
- **`J` (forecast variance):** `IF(forecast remaining="", "", actual + forecast remaining − baseline)`.
- **Dashboard:** open decisions = `COUNTIF(Decisions!D, "Open")` = 8; first-pass student hours = baseline 150 + test 12 + discussion 13 = 175.

**`Elevate-Marketing-Easy.xlsx`** (the content approval gate and lead-reporting rules)
- **Content `AC` (publish flag):**
  - `Missing plan details` if the original publish time, owner, next worker or status is blank;
  - `Missing reschedule approval` if a revised time exists with no reschedule approver;
  - `Missing approval` if the status is Approved, Scheduled or Published but the approver, approved-version link or approval date is blank, or the checks are not `Cleared`/`Not required`;
  - `Missing publication proof` if Published without an actual time and live link;
  - otherwise `Overdue publication`, `At risk: not scheduled` (within the 24 h lead time) or `Planned`.
- **Content `AD`:** on time = actual ≤ *original* publish time. **`AE`:** review due = publish date + 7 days. **`AF`:** duplicate post-ID check.
- **Campaigns `X`:** `Ready to launch` only if the budget, dates, approver, approval record, owner and receiving owner are set and all five checks = `Yes`. `AD` cost per lead and `AE` spend per admission are blank on zero or missing.
- **CRM Import:** `V` duplicate lead ID; `W` received-week Monday; `X` follow-up flag (`Closed`, `Missing next action/date`, `Overdue`, `Upcoming`); `Y` ownership flag (`Unassigned`, `Handoff pending`, `Accepted`).
- **Dashboard CRM figures are blank unless** `Start Here!B14 = "Ready"`, which requires mapping validated = Yes, an extract date, and zero duplicate lead IDs.
- **Cohorts:** cohorts by lead-received week. The 7-, 14- and 30-day admission counts are shown **only once the extract date covers the window** (`Start Here!B7 ≥ week end + N`).

**`Elevate-Online-Easy.xlsx`**
- **Actions `J`:** `Add closure evidence` if `Done` without a completion note; then `Assign owner`, `Set due date`, `Overdue`, `Due today` or `Upcoming`.

**`Elevate-Concept-Book-Indices.xlsx`**
- **`5 CR!K`:** chapter total = concept + practice + Ranker. Totals are 220 + 575 + 355 = **1,150** (7 × 50 + 10 × 80, verified).

---

## 4. Existing documentation and approved business decisions

Status key:
- **Approved:** the file records the owner's explicit approval, lock or confirmation.
- **Proposed:** written as a proposal, draft or agent recommendation.
- **Unconfirmed:** recorded as open, or contradicted elsewhere.

Dates are as written in the source; "undated" means none is given.

| # | Decision | Source | Date | Status | Binds |
|---|---|---|---|---|---|
| 1 | 9 social accounts and 6 Metricool brands; no "Elevate main" page; Nikunj's personal IG later | `A/HANDOFF.md` §5; `A/CLAUDE.md` "Accounts (final…)" | 6 Oct 2026 | Approved | MKT |
| 2 | Exam pages stay pure (solo); comparisons and "every path" content go out as an IG or YT Collab across the pages involved | `A/HANDOFF.md` §5; account READMEs | 6 Oct 2026 | Approved | MKT |
| 3 | Nikunj is not the face of every course; each exam page gets its own teacher-face, still to be decided | `A/HANDOFF.md` §5, §6 | 6 Oct 2026 | Approved (faces Unconfirmed) | MKT |
| 4 | Nothing is scheduled or published without Nikunj's explicit yes | `A/CLAUDE.md` Non-negotiables; `/weekly-plan`, `/repurpose` | undated (by 6 Oct) | Approved (standing rule) | MKT, PLT |
| 5 | No student results, toppers, ranks or testimonials in year one; enrolment "100+" may be said | `A/brand/BRAND.md` §1, §2, §6 | 5 Oct 2026 | Approved | MKT |
| 6 | No location and no mode in public content (no Sikar, offline or "online" label), except the Elevate Sikar page | `BRAND.md` §1b | 5 Oct 2026 | Approved | MKT |
| 7 | Never mention RP Mody & Co; never mention NLSIU or the MBL | `BRAND.md` §1b | 5 Oct; 6 Oct 2026 | Approved | MKT |
| 8 | CA is not marketed as a course; CA Inter and Final are never implied | `BRAND.md` §1, §1b | 5 Oct 2026 | Approved | MKT |
| 9 | No CA vs CLAT comparisons (`CLAT-003` rejected) | `A/tracker/ideas.csv`; CLAT strategy | 6 Oct 2026 | Approved. Extension to IPMAT is Unconfirmed (`IPMAT-003` "on hold: ask Nikunj"). | MKT |
| 10 | Never "after 12th" as join framing; the logo is the "elevate" wordmark only; Commerce and CUET are equal | `BRAND.md` §1b; `HANDOFF.md` §8 | 5 to 6 Oct 2026 | Approved | MKT |
| 11 | Usable facts: 15 to 20 teachers (never rounded up), 100+ students; credential line "CA Nikunj Bindal · Ex-Deloitte · NMIMS Rank 3"; title is Co-Founder | `BRAND.md` §2, §3 | 5 to 7 Oct 2026 | Approved | MKT |
| 12 | CLAT faculty: goal is presence, not a launch; availability order Soma, Nikunj, Saumya, Tushar, Satish; on screen, name and subject only | `BRAND.md` §3 | 7 Oct 2026 | Approved | MKT |
| 13 | CLAT handle `@elevate.clat`, name "Elevate Law School \| CLAT Prep", and bio | `HANDOFF.md` §8; `accounts/instagram-clat/PROFILE.md` | 7 Oct 2026 | Approved. Other handles are Proposed ("suggested"). | MKT |
| 14 | Metricool replaces Taplio after 15 Oct; Cloudinary as the media bridge; PostEverywhere as plan B | `HANDOFF.md` §4 | 6 Oct 2026 | Proposed (Metricool not created; `HANDOFF.md` §6) | MKT |
| 15 | Idea ID `<COURSE>-<n>` and version ID `<idea>-<account code>` (+S/L) | `CLAUDE.md` "Idea IDs" | undated | Proposed (agent convention, in use) | MKT |
| 16 | Students on camera only with the student's and a parent's OK; otherwise blur, or hands and papers only | `library/_broll/README.md`; CLAT calendar v3 rule 1 | 6 to 7 Oct 2026 | Proposed (agent rule) | MKT, PLT |
| 17 | CLAT 2-month strategy, 10-week calendar, 15-day calendar v3, team and volume plan | `accounts/instagram-clat/strategy-…`, `calendar-…`; `plans/team-and-volume-…` | 6 to 7 Oct 2026 | Proposed ("waiting on Nikunj's yes") | MKT |
| 18 | CLAT 2027 offer: "Final Sprint" (A) or skip to the CLAT 2028 batch (B) | CLAT strategy, "Offer question" | 6 Oct 2026 | Unconfirmed (undecided; time-sensitive) | OPS, ACD, MKT |
| 19 | Work one stream at a time; use roles, not names; call the lead system "CRM" and the LMS "Vacademy"; never claim integrations | `B/Claude.md` §2 | 15 Oct 2026 (as recorded) | Approved (user working rules) | PLT, OPS |
| 20 | Offline flow: marketing → CRM lead → academic counselling → separate demo → admission and fees → onboarding → classes, attendance, tests and parent reporting | `B/Claude.md` §4 | undated | Approved (described as the institute's workflow) | OPS, ACD |
| 21 | Demo: **two days, ₹1,000**, non-refundable if not joining, adjusted against fees on joining; separate demo classes, never inserted into the main batch; the earlier 3-day plan is superseded | `B/Claude.md` §4; `Elevate-Operations.xlsx` Decisions D-003, D-004 ("Confirmed"); Work Inventory OP-005, OP-006 | undated | **Approved** | OPS |
| 22 | Demo limits: consecutive days, subject cap, missed-day treatment | Decisions D-005 | undated | Unconfirmed (Open) | OPS |
| 23 | Follow-ups: WhatsApp next-day feedback and calls within 1 to 2 days | Work Inventory OP-007 | undated | Proposed | OPS |
| 24 | Fee agreement needs two verifications and an authorised signed approval; documents (form, Aadhaar, marksheet) verified and retained | OP-010, OP-008 | undated | Approved ("Confirmed") | OPS |
| 25 | Call the parent or guardian after 15 minutes of unexplained class absence (offline) | Decisions D-006; OP-014 | undated | Approved | ACD |
| 26 | Departure notification required; arrival notification not confirmed | Decisions D-007 | undated | Unconfirmed (Open) | ACD |
| 27 | Lunch-exit and emergency-exit permissions; two shared test notebooks; digital checked script, marksheet and report | Decisions D-008 to D-011 | undated | Approved | ACD (mostly out of system scope) |
| 28 | CA calendar: Mar–Apr weekday teaching, Saturday tests, Sunday holiday; May–Jun Saturday teaching and Sunday tests; June-end coverage, July revision, August revision and mocks; one main batch with temporary catch-up groups | Decisions D-012 to D-015; `ACADEMIC_PLANNING_DECISIONS.md` | undated | Approved | ACD |
| 29 | CA start date (1 March vs March/April) and session length (75 minutes) | D-016 "Open"; `ACADEMIC_PLANNING_DECISIONS.md` "unresolved" against `IPMAT_REFERENCE_NOTES.md` "1 March 2027 confirmed; 75-minute flexible standard confirmed" | undated | **Unconfirmed (contradictory)** | ACD |
| 30 | CA Accountancy 150 h (98 explanation + 52 practice); tests 12 h; discussions 13 h; Law 120 h, QA 150 h, Economics 100 h | D-018 to D-020; `outputs/CA-Foundation-Accountancy-Full-Plan.md` | undated | Proposed ("Provisional") | ACD |
| 31 | IPMAT Quant teaching 114 classes (Foundations buffer removed) + 37 higher maths = 151; 75-minute classes | `IPMAT_LOCKED_BASELINES.md` | 10 Sep 2026 | Approved (locked) | ACD |
| 32 | Verbal teaching 57; LR/DI sequence (27 topics); LR 32 and DI 13 teaching | same | 10 Sep 2026 | Approved (locked) | ACD |
| 33 | Full-year practice: Quant 53, Verbal 28, LR 18, DI 8 (360 classes / 450 h) | same | 10 Sep 2026 | Approved (locked), later overridden for Class 12 | ACD |
| 34 | Verbal chapter assessment: 28 papers (VT01–VT14, A and B rounds) | same | undated (Sep 2026) | Approved (locked) | ACD |
| 35 | Class 12 weekly timetable: two 75-minute classes a day; 5 days a week Apr–Jun, 6 from July; no separate revision or catch-up blocks | same | undated | Approved (locked) | ACD |
| 36 | Class 12 accelerated: 313-class plan, DI from June, higher maths from July, 15 Oct teaching target, Tue/Thu third class Jul–15 Oct | `CLASS12_ACCELERATED_BASELINE.md` ("Lock it") | undated | Approved; the cycle and dates are provisional | ACD |
| 37 | 28-slot exclusion allowance (5 holiday + 5 school-exam days) | same ("done lock it") | undated | Approved; dates provisional | ACD |
| 38 | Class 12 latest: remove 8 practice classes, giving 253 + 52 = **305 / 381.25 h**; removed sets become homework | same, "Latest revision"; workbook `Overview!B28` "User-approved practice removal" | undated | Approved | ACD |
| 39 | Chapter tests Quant 25, Verbal 28, LR 11, DI 6 = 70 | `Assessment budget!F5:F8` ("Accepted grouping"/"Locked") | undated | Approved | ACD |
| 40 | Weekend chapter-test map: 70 papers, 85.75 h, 210-minute weekend cap | `CLASS12_ACCELERATED_BASELINE.md` "draft, not locked"; Weekend map | undated | Proposed | ACD |
| 41 | Full mocks: 70 (Indore 15, Rohtak 10, JIPMAT 10, IIMB 8, IIMK 7, NPAT 10, other 10) **or** 50 IIM-focused | `Assessment budget!A13:B19` (70) against `B/Claude.md` §6 (50) | undated | **Unconfirmed (contradictory)** | ACD |
| 42 | Sectionals Quant 10, Verbal 10, LR 6, DI 4 | `Assessment budget!A9:B12`; `B/Claude.md` §6 "historical LR6/DI4… check" | undated | Unconfirmed | ACD |
| 43 | Six concept-book indices locked: 18 / 38 + Foundations / 11 / 26 / 17 / 23 = 133 + 1; content deliberately empty | `Elevate-Concept-Book-Indices.xlsx` Overview | undated | Approved | ACD |
| 44 | CR practice bank: 1,150 planned questions (10/25/15 and 15/40/25 splits) | `5 CR!H27` | 16 Sep 2026 | Approved | ACD |
| 45 | Quant and Higher Maths practice bank 4,470 and 1,220 | `B/Claude.md` §7 | undated | Unconfirmed (the chapter mapping is lost) | ACD |
| 46 | Online Class 12 boards + CUET: 60-minute classes; intakes Mar, Jul, Sep + Jan revision; Accountancy 226 h | `B/Claude.md` §9 | undated | Proposed (stream paused; a "conversation baseline") | ACD |
| 47 | Online office Mon–Sat 11:00–18:00 IST; Sunday event coverage by an assigned team | `Elevate-Online-Easy.xlsx` Rules | through 14 Sep 2026 | Approved ("Locked") | OPS |
| 48 | Online rules marked Locked: team-arranged homework reminders; two flexible test windows a week across subjects; app reports verified and sent privately; registered guardian for under-18s; full payment or instalments with a 3-day grace then automatic restriction; access expires on the target exam date; late joiners join live immediately | same | through 14 Sep 2026 | Approved (the instalment restriction is "Locked / verify setup") | OPS, ACD |
| 49 | Online rules marked Proposed: monthly report by the 5th working day; 23:59 IST expiry; feedback within 2 working days and first doubt response the next working day; attendance ≥ 45 of 60 minutes; 15-minute online absence check | same; SOP docx | 14 to 18 Sep 2026 | Proposed | ACD, OPS |
| 50 | Online Class Coordinator SOP | `outputs/online-operations/Elevate-Online-Coordinator-SOP.docx` | 18 Sep 2026 | Proposed (unsigned; owner, backup and approval blank) | OPS |
| 51 | Marketing procedures MKT-01 to MKT-09 (planning rhythm, 1-working-day turnarounds, "no sole self-approval", schedule 24 h ahead, enquiry reply within 1 operating hour, campaign launch checks) | `Elevate-Marketing-Easy.xlsx` SOP Register | undated (Sep 2026) | Proposed (version 1.0, but "Approved by" is blank) | MKT, OPS |
| 52 | Reporting definitions: confirmed admission = approved fee arrangement + documents + verified down payment (a demo fee alone is not admission); "contacted" = first successful two-way contact; one primary source, with Unknown kept as Unknown; no weekly admissions ÷ new-leads ratio | Marketing-Easy `Start Here!A31:C33`; `SOP Register!G14` | undated | Proposed ("agreed operating workflow"; no approver named) | OPS, MKT |
| 53 | Instagram pages: Elevate CA, CLAT, Sikar, Online; YouTube: IPMAT, Commerce & CUET, CLAT | `B/Claude.md` §10; Marketing-Easy `Content!B` dropdown | undated (around Sep 2026) | **Unconfirmed (conflicts with #1)** | MKT |
| 54 | Project charter, 13 suggested departments, work-status standard, escalation levels L1–L4 | `B/elevate-education-operations/*` | undated | Proposed ("starting model") | OPS, PLT |

---

## 5. Missing assets and broken paths

### 5.1 Symlink stubs in Project A (35 files, 26–86 bytes, each holding a path)

**Relative links whose targets exist in `A/` (4: content recoverable)**

| Stub | Points to | Resolves to |
|---|---|---|
| `accounts/youtube-clat/PROFILE.md` | `../instagram-clat/PROFILE.md` | exists |
| `accounts/youtube-clat/calendar-oct-dec-2026.md` | `../instagram-clat/calendar-oct-dec-2026.md` | exists |
| `accounts/youtube-clat/strategy-oct-dec-2026.md` | `../instagram-clat/strategy-oct-dec-2026.md` | exists |
| `library/_broll/ca-result-viral` | `../GEN-011-ca-result-viral` | the folder exists but holds only a README |

**Absolute macOS links, absent (31). In this table, `VSO` = `/Users/sushant/Video Studio Official`.**

| Stub | Points to |
|---|---|
| `studio` | `VSO` (the Remotion studio) |
| `brand/STYLE-video-look.md` | `VSO/STYLE.md` |
| `brand/post-design-references` | `VSO/references/post-designs` |
| `accounts/linkedin-nikunj/log.md` | `/Users/sushant/.claude/linkedin/log.md` |
| `accounts/linkedin-nikunj/plan.md` | `/Users/sushant/.claude/linkedin/plan.md` |
| `accounts/linkedin-nikunj/strategy.md` | `/Users/sushant/.claude/linkedin/strategy.md` |
| `accounts/linkedin-nikunj/voice.md` | `/Users/sushant/.claude/linkedin/voice.md` |
| `library/video-scripts-oct-2026.md` | `VSO/content/LinkedIn-video-scripts.md` |
| `library/_brand/elevate-logo.png` | `VSO/assets/logos/elevate-logo.png` |
| `library/_brand/nikunj-photo-01.jpg` | `VSO/assets/people/nikunj-01.jpg` |
| `library/_brand/linkedin-banner.png` | `VSO/out/linkedin/banner.png` |
| `library/_brand/highlight-covers/clat-{current-affairs,english,legal,logical,parents,quant,start-here}.png` (7) | `VSO/out/highlights/<same name>.png` |
| `library/_brand/profile-pictures/elevate-{clat,commerce-cuet,ipmat,sikar}.png` (4) | `VSO/out/profile/<same name>.png` |
| `library/_brand/youtube-banners/elevate-{clat,commerce-cuet,ipmat}-banner.png` (3) | `VSO/out/youtube/<same name>.png` |
| `library/CLAT-023-at-a-glance/final` | `VSO/out/clat-at-a-glance` |
| `library/COM-002-bst-ratta-reel/master-recording.mp4` | `VSO/assets/projects/bst-boards/footage/bst-boards.mp4` |
| `library/COM-002-bst-ratta-reel/reel-draft-1.mp4` | `VSO/out/bst-boards/bst-boards-draft-1.mp4` |
| `library/COM-002-bst-ratta-reel/SFX-CUES.txt` | `VSO/out/bst-boards/SFX-CUES.txt` |
| `library/COM-003-bst-carousel/slides` | `VSO/out/bst-boards/carousel` |
| `library/GEN-003-two-coachings/linkedin-image.png` | `VSO/out/linkedin/post-two-coachings.png` |

**Consequences:**
- Every image, video and brand asset is absent.
- The founder's LinkedIn strategy, plan, log and voice rules cannot be read, although `/write-post` depends on `voice.md`.
- `ideas.csv` and `versions.csv` notes refer to `studio/out/...` paths that do not resolve.

### 5.2 Placeholders that are real files, not stubs
- `courses/{clat,commerce,cuet,ipmat}/worked.md`: header lines only.
- `courses/{commerce,cuet}/questions.md`: header lines only.
- `accounts/youtube-{clat,cuet12,ipmat}/channels.json`: `@REPLACE-WITH-OUR-HANDLE`.

### 5.3 Referenced but absent (not stubs)

| Reference | Where referenced | State |
|---|---|---|
| `studio/CLAUDE.md` | `/make-image` skill, `CLAUDE.md` map | Absent (the studio is not in the folder) |
| `tools/ffprobe` ("Local fix… Apple Silicon") | `HANDOFF.md` §2 | Absent; `tools/` holds 3 files |
| `tracker/metrics.csv` | `import-metrics.mjs`, `/weekly-report` | Never created |
| `.env` (YouTube key) | `tools/README.md` | Absent (correctly not committed). The key was never provided. |
| `accounts/youtube-elevate/channels.json` | `CLAUDE.md` line 86 | The folder does not exist; the accounts were split by exam |
| `reports/inbox/instagram-elevate/`, `youtube-elevate/` | `import-metrics.mjs` header | Do not exist; the actual folders are per exam |
| Scan reports "scan clat 2026-10-06" and "scan ipmat 2026-10-06" | `ideas.csv` sources (7 ideas) | `courses/clat/scans/` and `courses/ipmat/scans/` are empty |
| Master plan doc (Claude artifact `1798a9a0-…`) | `CLAUDE.md`, skills | External, not exported |
| Scheduled-task prompts `~/.claude/scheduled-tasks/*` | `CLAUDE.md` "Automations" | External |
| `~/Downloads/Elevate CLAT profile kit`, profile pictures, banners | `PROFILE.md`, `HANDOFF.md` §8 | External |
| B-roll (`_broll/students-mock-tests/` and the others), the GEN-011 viral clip and press screenshots | `_broll/README.md`, `GEN-011/README.md` | The folders are empty; the assets were never supplied |
| Two Google Sheets (operations sheet, IPMAT "Year Long Syllabus") | `B/Claude.md` §14 | Links only; "not exported live-sheet snapshots" |
| `@oai/artifact-tool`; template files under `~/.codex/plugins/cache/...` | all `B/work` builders | Not bundled |
| `outputs/Elevate-Education-Operations-Starter.zip`, `*.inspect.ndjson`, `.DS_Store` | `B/PACKAGE_NOTES.md` | Deliberately excluded from the zip |

---

## 6. Inconsistencies and data-integrity defects

### 6.1 Defects verified against the files

**DI-01. Duplicate idea IDs in `A/tracker/ideas.csv`.** There are 59 data rows and 55 unique IDs. The CSV is well-formed: all rows have 8 fields. Line numbers below are file lines, with the header on line 1.

| ID | First row | Second row |
|---|---|---|
| `CUET-002` | L49: "CUET 2027: kya confirmed hai, kya sirf afwaah (myth vs fact)", status `idea` | L59: "DU colleges for Commerce & Eco: tier list Part 1 (S: SSCBS SRCC · A: LSR Stephens · B: Hindu Hansraj)", status `ready` |
| `COM-005` | L53: "Class 12 Accounts: chapters heavy in boards AND CUET", status `idea` | L60: "Private colleges for Commerce & Eco: tier list Part 2 (S MU · A NMIMS · B FLAME · C Christ Symbiosis)", status `ready` |
| `CLAT-027` | L54: "Student voice: 50 din pehle meri CLAT prep (proof)", status `idea` | L57: "Nobel Prize 2026 Economic Sciences: Woodford & Hall (CLAT current affairs)", status `ready` |
| `GEN-012` | L55: "Mock test day at Elevate (classroom proof)", status `idea` | L58: "What Big 4 does not tell you (two scoreboards)", status `scripted` |

The highest number per prefix is GEN 13, CLAT 27, CUET 5, COM 5, IPMAT 5. The rule "next = highest + 1" was broken at least four times. The tier-list pair is also split across two prefixes (CUET and COM) for "Part 1" and "Part 2" of one series.

**DI-02. Ambiguous placement references.** In `versions.csv`, `CLAT-027-IGC` (L31: "student + parent OK; fallback Is Class 11 too early") and `GEN-012-IGS` (L32: "needs helper footage; consent for faces") point at duplicated IDs. Their notes match the *first* rows (student voice; mock-test day). `library/GEN-012-big4-scoreboards/` belongs to the *second* `GEN-012`. Apart from those two, all 36 version IDs are unique, every idea ID resolves, and every version ID starts with its idea ID.

**DI-03. Stale idea counts.**
- `HANDOFF.md` §2 says "tracker (24 ideas…)".
- `plans/team-and-volume-oct-dec-2026.md` says "Idea bank… 42 rows, 1 rejected".
- The actual figure is 59 rows and 55 unique IDs. EXTRACTION's "about 56" is also wrong.

**DI-04. Corrupted line in `HANDOFF.md` (line 84).** Two edits are spliced together:
> `…(7-21 Oct, rebuilt on the 60-post audit; Nikunj replaces Sushant on camera)** in accounts/instagram-clat/calendar-oct-dec-2026.md: approve; recording Thu 8 Oct; Claude writes the scriptsnal: presence not launch; faces Soma > Nikunj > Saumya > Tushar > Satish)** in accounts/instagram-clat/calendar-oct-dec-2026.md: approve; …`

**DI-05.** The `HANDOFF.md` header says "saved 6 Oct 2026", but the body includes 7 Oct decisions (§8 and the CLAT handle).

**DI-06. Status vocabularies are inconsistent.**
- `ideas.csv` uses 10 values: `idea` 35, `ready` 7, `scripted` 6, `published` 3, `scheduled` 2, `edited` 2, `held`, `parked`, `on hold`, `rejected`.
- `versions.csv` uses 8: `planned` 23, `published` 3, `todo` 3, `scheduled` 2, `needs recording` 2, `held`, `parked`, and the free text "ready to post (needs Nikunj yes)".
- `/write-post` sets `drafted`, which never appears.
- The Marketing-Easy workbook uses 11 different values.

**DI-07. Pillars.** `BRAND.md` §4 defines 4 pillars. `ideas.csv` uses 11 free-text values: Exam strategy 19, Paths 16, Founder story 6, Parents 5, Subject 3, Current affairs 3, Selling point 2, Proof 2, Positioning, Opinion, Building Elevate.

**DI-08. `collab_with` is empty in all 36 placements,** although `HANDOFF.md` §7 says the column was added to apply the Collab rule.

**DI-09. Publication state is unknown since 7 Oct.**
- Rows dated in the past are still `planned` or `todo`, for example `IPMAT-001-LIP` (`todo`, 2026-10-08).
- `CLAT-023-IGC` notes "posted? not verified".
- The 11 Oct report could not confirm whether CLAT-023 to CLAT-026 were posted.
- `ideas.csv` marks GEN-003 and GEN-004 `scheduled` for 14 and 15 Oct, with no later record.

**DI-10. The social-account model conflicts between projects.**
- Project A (approved 6 Oct) has the 9 accounts in decision #1.
- `B/Claude.md` §10 says "Instagram has **four**, not three: Elevate CA, Elevate CLAT, Elevate Sikar, Elevate Online".
- The Marketing-Easy `Content!B` dropdown offers "Elevate Sikar, Elevate CA, Elevate CLAT, Elevate Online, Elevate IPMAT, Elevate Commerce & CUET".
- "Elevate CA" conflicts with "CA is not promoted as a course", and "Elevate Online" conflicts with "never 'online' as a label".
- See OD-001.

**DI-11. Stale names.**
- "youtube-elevate" (`CLAUDE.md` line 86; `yt-scan.mjs` header).
- "instagram-elevate" and "youtube-elevate" (`import-metrics.mjs` header).
- "CUET folded into Elevate main" (`courses/cuet/competitors.md`), which contradicts "There is no general 'Elevate main'".

**DI-12. Seven ideas cite scans that do not exist.** IPMAT-003 to IPMAT-005, CLAT-003 to CLAT-005 and GEN-010 cite "scan clat/ipmat 2026-10-06", but no scan file exists. The 11 Oct report says "The only scan so far is `courses/cuet/scans/2026-10-12.md`". `courses/clat/intel.md` says view counts "couldn't be read in this pass (unverified)".

**DI-13. Post-audit verdict counts.** `accounts/instagram-clat/README.md` says "34 keep (2 to pin) · 25 archive · unpin 2". The CSV holds KEEP 31 + "KEEP + PIN" 2 + "KEEP, UNPIN" 1 = 34 keep, and ARCHIVE 25 + "UNPIN + ARCHIVE" 1 = **26 archive**, with 2 unpin actions. Some view and comment cells are blank: they must be imported as missing, not zero.

**DI-14.** The header of `B/IPMAT_LOCKED_BASELINES.md` still says "Current Class 12 plan is 253 teaching + 60 practice = 313 classes / 391.25 hours". That is superseded by 305 / 381.25 in `CLASS12_ACCELERATED_BASELINE.md` and the workbook.

**DI-15.** In `CLASS12_ACCELERATED_BASELINE.md`, the "Approved quantities" table (313) and "Month allocation" (Aug 60, Sep 52) still sit below the newer 305 revision (Aug 58, Sep 46). `work/class12-accelerated-summary.json` is the 313-stage output (`classCount: 313`, `headroom: 32`), so it is stale.

**DI-16. Full mocks: 70 or 50.** The workbook budgets **70** (including NPAT 10 and 10 unnamed non-IIM mocks). Its Weekend map says "The 30 sectionals and 70 full mocks are not scheduled here". `B/Claude.md` §6 says the user "excluded 20 non-IIM mocks… leaving 50". See OD-016.

**DI-17. Locked Quant practice arithmetic.** The rows listed under "Existing Quant practice allocation" sum to **36**, while the table states 38. The source documents this itself, keeping a 53-class budget with "two topic-allocation-pending classes". In the 313-class revision those two unassigned slots were removed. Verified.

**DI-18. CA start date and session length contradict each other.**
- `IPMAT_REFERENCE_NOTES.md`: "start 1 March 2027 confirmed; 75-minute flexible standard confirmed; four daily classes in March–April weekdays confirmed".
- `ACADEMIC_PLANNING_DECISIONS.md`: "Exact batch start date remains unresolved (March or April)… Do not present the earlier four 70-minute sessions as an agreed timetable".
- `Elevate-Operations.xlsx` D-016: "Open".
- `CA_FOUNDATION_ACCOUNTANCY_DRAFT.md`: "Actual class durations/start date remain unresolved".
- `B/Claude.md` §5: "subsequently 1 March and 75-minute teaching classes selected… older notes still show unresolved… should be reconciled".
- See OD-019.

**DI-19.** `Quant-Exam-Index-Comparison.xlsx` (`Read first!B13`) uses "32 numbered chapters plus Foundations" for the Quant index. The locked book has **38** (`2 Quants`). The comparison predates the final index (checked 11 Sep 2026).

**DI-20.** `Elevate-Operations.xlsx` Work Inventory OP-002 and OP-003 call the lead system "Academy" ("Calls/SMS entered in Academy; Meta integration already operating", status "Confirmed"). `B/Claude.md` §2.5 says call it CRM and treat capabilities as reported, not verified.

**DI-21. Legacy ID namespaces collide with the new repo's IDs.**
- `Elevate-Operations` Decisions `D-001…D-024` against `docs/DECISIONS.md` `D-001…D-016`.
- `templates/master_tracker.csv` `OPS-001`/`OPS-002` (tasks) against requirement IDs `OPS-xxx`.
- `MKT-01…09` (SOPs) against `MKT-xxx`.
- `SOP-001` means "Weekly operating review" in `templates/sop_register.csv` but "Lead generation" in `Elevate-Operations.xlsx`.
- Online SOPs `ON-01…16` sit beside online actions `ON-001…ON-010`.
- Importers must namespace legacy codes, for example `LEGACY-OPSWB-D-003`.

**DI-22. The weekly production cycle is defined three ways.**
- `B/Claude.md` §10: brief Wednesday, shoot Thursday, approve Friday, schedule Saturday.
- MKT-01: plan Wednesday, briefs Thursday, production Friday, approve and schedule Saturday.
- CLAT calendar: scripts Wednesday, fact-check Thursday, record Saturday, Nikunj approves Sunday.

**DI-23. Sikar cadence.** The Marketing-Easy weekly feed-post target is 4 (`Home!E4`); the team plan says 2 to 3 a week.

**DI-24. Volatile cached values.** `TODAY()` and `NOW()` formulas hold cached values from September 2026 (`Home!B4` = 2026-09-07, `Dashboard!E4` = 2026-09-11). These are not data and must not be imported as dates.

**DI-25. "Easy" and full workbooks are not synchronised** (marketing and online). The Easy files are the daily-use versions; the full files are earlier versions (`B/Claude.md` §3).

**DI-26. A misleading zero.** `Assessment budget!E24` shows 0 "minimum additional hours" (709.5 h known against 756.25 h whole-year gross). That is an annual bound that excludes full-mock test time, holidays and board exclusions. The older Markdown figure (an 88.25 h gap in `IPMAT_LOCKED_BASELINES.md`) comes from a different model (a four-week month). Neither proves feasibility.

### 6.2 Where EXTRACTION is wrong or incomplete

| # | EXTRACTION says | The files say |
|---|---|---|
| EX-1 | Idea register "about 56 rows"; "4 duplicate IDs" | 59 rows, 55 unique IDs, 4 duplicated IDs covering 8 rows. The four pairs are listed correctly. |
| EX-2 | "About 30 files are text stubs… 28–90 bytes" | **35** stubs, 26–86 bytes. Four are relative links whose targets exist in the tree, so `youtube-clat` PROFILE, calendar and strategy are **not** missing. |
| EX-3 | Section 4.1 is headed "the zip was made on a Mac and extracted on Windows" | The stubs are in the **folder tree**, not the zip. The zip has 169 regular files, no symlinks and no `__MACOSX`, and `PACKAGE_NOTES.md` says symlinks were excluded. |
| EX-4 | Post audit: "34 keep (2 to pin), 25 archive and 2 to unpin" | The CSV gives 34 keep and **26** archive (one row is "UNPIN + ARCHIVE"). EXTRACTION repeated the README's count. |
| EX-5 | CA: "A 1 March 2027 start was confirmed, with 75-minute classes" | Contested: D-016 is "Open" and two other handover files say unresolved (DI-18). |
| EX-6 | Assessments: "70 chapter tests… and 50 IIM-focused full mocks" | The workbook still budgets **70** full mocks; 50 appears only in `Claude.md` narrative. The conflict is not flagged (DI-16). |
| EX-7 | Marketing: "4 Instagram pages (CA, CLAT, Sikar, Online)", reported as fact | This conflicts with the approved 9-account model and two brand rules (DI-10). Not flagged. |
| EX-8 | "about 17 scripts" in `work/` | **16**: 13 `.mjs` and 3 `.py`. |
| EX-9 | Project A was made "from the founder's Mac (`/Users/sushant/...`)"; the two projects "share a name, a founder and nothing else" | Both projects carry paths for the same macOS user `sushant`. That this is the founder's machine is not established, and the founder is Nikunj. |
| EX-10 | "The 12–18 Oct weekly plan scheduled about 20 placements" | The plan is titled "DRAFT, nothing scheduled". It *proposes* 22 rows. |
| EX-11 | "Never mention Sikar" conflicts with `BRAND.md` section 1 | No conflict: §1 is internal fact, and §1b states the public rule with an explicit Sikar-page exception. |
| EX-12 | Tools "written and tested on sample data" | Unverifiable: no fixture or sample file exists in the folder. |
| EX-13 | `THE IIM GUIDE` is third-party | The file says "Compiled by Sushant Bindal". Its authorship and the rights in its contents are unconfirmed; it should not be assumed to be either third-party or Elevate-owned (section 10). |
| EX-14 | Omissions | Not mentioned: the stale header in `IPMAT_LOCKED_BASELINES.md` (DI-14); the missing 6 Oct scan files (DI-12); the ID-namespace collisions (DI-21); the absent `tools/ffprobe`; the `yt-scan` live-detection defect (section 3.1); the 32-vs-38 Quant index (DI-19); "Academy" vs CRM (DI-20). |

Verified as **correct** in EXTRACTION:
- the four duplicate pairs;
- the corrupted HANDOFF line;
- 345 − 28 = 317 against 305;
- 133 chapters and 1,150 CR questions;
- the demo terms;
- online office hours;
- `Claude1.md` being identical to the zip's `Claude.md`;
- empty `worked.md` and `CATALOG.md`;
- the empty IPMAT-002, CUET-001 and COM-001 library folders;
- `studio/CLAUDE.md` absent.

---

## 7. Languages, frameworks, dependencies and data stores found

| Project | Item | Detail |
|---|---|---|
| A | Node.js ESM scripts | 2 `.mjs`, built-ins only (`node:fs`, `node:path`, `node:url`, global `fetch`). No `package.json`, lockfile or tests. |
| A | Claude Code skills | 8 Markdown procedures (`.claude/skills`) |
| A | Remotion studio (React/TypeScript, `npm run check`, `npx remotion still`, ffmpeg/ffprobe) | Referenced only; absent |
| A | Data stores | Markdown, CSV (`ideas.csv`, `versions.csv`, `post-audit.csv`), JSON (`channels.json`) |
| A | External services | YouTube Data API v3 (key never set); Taplio (LinkedIn scheduling and analytics, used until 15 Oct); Metricool (planned, not connected); Cloudinary and PostEverywhere (planned); Meta Business Suite and YouTube Studio CSV exports (planned); Claude Docs master plan |
| B | Node.js ESM builders | 13 `.mjs` using `@oai/artifact-tool` (unavailable) and `jszip` |
| B | Python 3 | 3 scripts: `zipfile`, `xml.etree`, `lxml`, `hashlib`, `json` |
| B | Data stores | 8 `.xlsx` (with Excel tables, data validations, formulas, hidden sheets), 1 `.docx`, Markdown, CSV templates, JSON, NDJSON, PNG |
| B | External systems (reported, **not verified**) | CRM (unnamed; "Meta leads reportedly enter CRM automatically"); Vacademy LMS (live classes, recordings, attendance, reports); Tally (invoices and receipts); WhatsApp; biometric entry and exit; Google Sheets |
| Both | Database, server, auth, CI | **None** |

---

## 8. Implemented vs merely planned, by feature area

"Implemented" here means a working artefact exists in the legacy files: a tool, formula or populated register. Nothing is deployed as a system.

| Feature area | Legacy state | Evidence | Target |
|---|---|---|---|
| Social account registry | Documented; only 1 handle confirmed | Account READMEs; `HANDOFF.md` §8 | MKT |
| Idea tracker with IDs | Implemented manually (CSV); integrity defects | `tracker/ideas.csv` | MKT |
| Placements and version history | Implemented manually (CSV); no change history; `collab_with` unused | `tracker/versions.csv` | MKT |
| Content workflow and approval gate | Designed as workbook formulas; template unused (0 rows) | Marketing-Easy `Content!AC` | MKT |
| Brand and claims rules | Documented, enforced by human review only | `BRAND.md`, `CLAUDE.md` | MKT |
| Publishing | LinkedIn via Taplio (external; used until 15 Oct). Others posted by hand or unknown. Metricool not connected. | `HANDOFF.md` §3–4; 11 Oct report | MKT |
| Analytics import | Script written, never run | `tools/import-metrics.mjs` | MKT |
| Competitor scans | Script written, never run against the API; one manual browser scan | `tools/yt-scan.mjs`; `courses/cuet/scans/` | MKT |
| Weekly reporting | One manual report (LinkedIn only) | `reports/2026-10-11-week.md` | MKT |
| Asset library | Folder convention; assets absent | `library/` | MKT |
| Paid campaigns, spend, outreach | Workbook templates, empty | Marketing-Easy hidden tabs | MKT (campaigns); OPS (outreach events as lead sources) |
| Lead capture and CRM | External CRM (unverified); import template empty | `B/Claude.md` §4, §11; `CRM Import` tab | OPS |
| Counselling, demo, admission | Process and decisions documented; no records | Work Inventory, Decisions | OPS |
| Onboarding and enrolment handoff | Documented steps; no system | OP-012; SOP docx | OPS → ACD |
| Staff, departments, roles, backups | Role lists only; names deferred | Online `Roles`; architecture | OPS / core |
| Tasks and actions | Templates; 10 online actions populated | Online-Easy `Actions` | OPS |
| SOP register | Three registers (25 + 9 + 16 entries); 1 SOP drafted (docx) | `Elevate-Operations` SOP Register; Marketing `SOP Register`; Online `SOP Register` | OPS |
| Decision log | 24 decisions in a workbook | `Elevate-Operations` Decisions | OPS |
| Risks and issues | Named in the architecture only | `SYSTEM_ARCHITECTURE.md` | OPS |
| Projects and milestones | A Gantt template (marketing setup) | Marketing `Project Plan` | OPS |
| Management dashboards | Workbook dashboards (formulas) | Three workbooks | OPS / platform |
| Curriculum baselines | Locked IPMAT baselines; provisional CA and Online Accountancy | Markdown and workbooks | ACD |
| Timetable and capacity | Draft dated Class 12 lesson plan; capacity formulas | Class 12 planner | ACD |
| Holiday calendar | An allowance only (28 undated slots) | `Assessment budget` | ACD |
| Teaching log and verification | Template with verification formulas; empty | `Elevate-Operations` | ACD |
| Attendance | External (biometric, Vacademy); rules documented | Decisions; Online Rules | ACD (biometric excluded) |
| Assessments and scoring | Chapter-test mapping and weekend map (draft); no scoring or results | Class 12 planner; Test Tracker | ACD |
| Catch-up and interventions | A catch-up log template; interventions not designed | `Elevate-Operations` | ACD |
| Concept books | Indices locked; content empty | Concept-book workbook | ACD |
| Identity, RBAC, audit, approvals, notifications | None | — | PLT |

---

## 9. Owner decisions required

OD-029 to OD-048 were added on 19 Oct 2026 for the Business Ops HR, admissions and operations work (D-028); the full options, who decides and the reasoning are in `docs/BUSINESS_OPERATIONS_AUDIT.md` section 9.2. Their defaults are proposals, never enforced as policy.

Each decision lists what happens if it stays undecided and which module it blocks. The PRD refers to these numbers.

| OD | Decision needed | Consequence if undecided | Blocks |
|---|---|---|---|
| OD-001 | **Social account model.** The approved 9 accounts (A, 6 Oct), or B's "Elevate CA" and "Elevate Online" Instagram pages? Do those pages exist, and are they still active? | The wrong accounts get seeded; content may breach "CA not a course" and "no 'online' label" | MKT account registry (MKT-001) |
| OD-002 | **Content approval authority.** Only Nikunj (A's rule), or the matrix in B's MKT-03 (Marketing Lead approval, academic check, Institute Authority for fees, offers and sensitive claims)? Who approves when Nikunj is unavailable? | The approval gate cannot be configured; either everything waits on one person or the rule is silently weakened | MKT approval (MKT-011), PLT approvals |
| OD-003 | **Duplicate idea IDs.** For each of CUET-002, COM-005, CLAT-027 and GEN-012, which row keeps the ID and which is re-coded? | The legacy import must hold 4 rows in quarantine; two placements stay ambiguous | MKT legacy import (MKT-034) |
| OD-004 | **Pillar taxonomy.** BRAND.md's 4 pillars, or the 11 values used in the tracker? | Pillar validation and reporting by pillar cannot be fixed | MKT (MKT-006) |
| OD-005 | Does the "no CA comparisons" rule also cover IPMAT? `IPMAT-003` is on hold. | The claims rule set is incomplete | MKT claims check (MKT-012) |
| OD-006 | **Publishing tool and media host.** Confirm Metricool + Cloudinary (or an alternative), create the accounts and grant credentials | Publishing stays mock or manual only | MKT live adapters (MKT-024 phase 2) |
| OD-007 | Approve or reject the **proposed plans**: CLAT strategy, calendars, team and volume plan, per-account cadence targets (Sikar 4 vs 2–3 a week), and which of the three weekly production cycles applies | Calendar targets are seeded as "proposed"; on-time and cadence KPIs have no agreed target | MKT calendar (MKT-017) |
| OD-008 | **Consent evidence for minors** (on camera, names, testimonials). What counts as consent (an enrolment-form clause or a separate note), who records it, how long it lasts, and whether publishing is hard-blocked without it | The asset gate cannot be enforced, which is a legal and reputational risk | MKT (MKT-022), PLT (PLT-018), OPS admission form |
| OD-009 | **Staff to roles.** Named owners and backups per role, per D-008 and the Online `Roles` sheet | RBAC can only run with test users; ownership and backup reports are empty | PLT RBAC go-live, OPS responsibilities |
| OD-010 | **Lead system of record.** Does Elevate OS replace the existing CRM, or import from it? Is Meta's automatic lead feed to be kept, and where? | Duplicate or conflicting lead data in two systems | OPS lead model (OPS-001, OPS-027) |
| OD-011 | **Enquiry service hours and SLAs**: reply within 1 operating hour, CRM entry within 30 minutes, follow-up within 1 to 2 days, handoff acceptance within 1 hour (all proposed) | SLA timers and escalations run on defaults marked "proposed" | OPS (OPS-007, OPS-017) |
| OD-012 | **Demo limits** (D-005): consecutive days, subject cap, missed-day handling | The demo flow cannot validate eligibility | OPS (OPS-009) |
| OD-013 | **Fee data scope.** Does Elevate OS record fee amounts and instalments, or only the status of verification against Tally? What are the refund, waiver and exception authority limits (ON-005)? | Admission confirmation can check status only; exception approvals cannot be routed | OPS (OPS-010) |
| OD-014 | **Identity documents** (Aadhaar, marksheets): store them in Elevate OS, or keep only a checklist plus an external reference? | Default is checklist only; document upload stays unavailable | OPS (OPS-011) |
| OD-015 | **IPMAT Class 12 cycle and official dates.** The April 2027–March 2028 cycle is provisional and IIMB "about 14 Nov 2027" is unverified, while the IIMB 2027 admissions test is listed as 15 Nov 2026 | The dated plan cannot be locked; the capacity and test map may be for the wrong year | ACD timetable (ACD-011, ACD-024) |
| OD-016 | **Full mocks**: 70 or 50 IIM-focused? Also confirm the sectional counts (LR 6 / DI 4) | The assessment budget is imported with a conflict flag | ACD assessments (ACD-015) |
| OD-017 | **Weekend chapter-test map**: approve the draft or rebalance? 12 tests fall after 15 Oct, and the last Verbal paper clashes with the provisional exam date | The test calendar stays "draft"; there is no lock | ACD (ACD-027) |
| OD-018 | **Holiday and closure calendar** for the Sikar centre and school-exam days: dated closures for the 28 reserved slots, and post-15-Oct and board exclusions | Conflict detection cannot use real holidays | ACD (ACD-009, ACD-012) |
| OD-019 | **CA Foundation parameters**: start date (1 March or March/April), session length, daily class count, weekly subject split, the Law, QA and Economics budgets, and the late-entry cut-off | The CA batch stays a provisional skeleton | ACD (ACD-002, ACD-005) |
| OD-020 | **Online Class 12 boards + CUET**: confirm the programme, 60-minute classes, intakes and the 226 h Accountancy baseline; resume the other subjects | The online batch cannot be planned | ACD |
| OD-021 | **Programme and batch catalogue for 2026–27**: which batches actually run (a CLAT 2027 batch is evidenced on IG; the ACE batch; Class 11 and 12 Commerce CBSE/RBSE; dropper; fast-track)? | The `core.programmes` and batch seeds would be guesses | ACD, OPS, MKT (course codes) |
| OD-022 | **Attendance rules**: the online absence check, the ≥ 45/60-minute threshold, arrival notification (D-007), and whether attendance is entered manually or imported from Vacademy | Attendance runs with proposed defaults | ACD (ACD-014) |
| OD-023 | **Parent and progress report cadence**: weekly or monthly (D-024); online monthly by the 5th working day (proposed) | Report reminders are not scheduled | ACD, OPS |
| OD-024 | **Quant and Higher Maths practice-bank mapping** (4,470 / 1,220): approve a reconstruction or redo it | Question-bank counts stay blank for Books 2 and 3 | ACD (ACD-022) |
| OD-025 | **CLAT 2027 offer**: Final Sprint (A) or skip to the CLAT 2028 batch (B)? Needed by about 20 Oct 2026. | No CLAT 2027 programme, batch or campaign can be set up | OPS, ACD, MKT |
| OD-026 | Is **staff leave and availability** in scope (D-015 leaves it pending)? | Timetable conflict checks cannot account for teacher leave | OPS, ACD |
| OD-027 | **Management KPI targets and rhythm**: the charter's "≥ 95% of active work has an owner and due date"; the leadership meeting day; review frequency | KPIs show values with no target band | OPS dashboard (OPS-024) |
| OD-028 | **Approve the drafted procedures**: the online coordinator SOP (owner, backup, timings) and marketing SOPs MKT-01 to 09 | They are seeded as `draft` and cannot be "effective" | OPS SOP register (OPS-019) |
| OD-029 | **Staff attendance rules**: grace minutes, late and early-leave thresholds, minimum hours for a full day, half-day rule, multiple sessions per day, handling of a missing clock-out. | Not decided. The code runs a proposed default that is not policy: Multiple sessions allowed and summed; missing clock-out flagged for correction, never auto-filled; grace/late/early values `open` (null) until the owner supplies them. | Late/early flags, timesheet totals, attendance KPIs |
| OD-030 | **Shift timings and working days per location** (Sikar, online, any other), weekly offs, split shifts for teachers. | Not decided. The code runs a proposed default that is not policy: Templates per location with effective dates; no template pre-filled as approved. | Shift assignment, expected hours, lateness |
| OD-031 | **Company holiday calendar** for staff, separate from the academic closure calendar (OD-018). Who maintains it; whether centre and online differ. | Not decided. The code runs a proposed default that is not policy: Per-location calendar, entered by `hr_manager`, state `open` until supplied. | Working-day count, leave deductions, absence flags |
| OD-032 | **Leave types and annual entitlements** (casual, sick, earned, unpaid, comp-off, maternity/paternity, other). | Not decided. The code runs a proposed default that is not policy: Types defined as configuration with all entitlement values `open`; visiting/contract default "no entitlement" only if the owner confirms. | Leave requests, balances |
| OD-033 | **Accrual, carry-forward and encashment.** Encashment touches pay: keep as a record only, no payroll (D-028). | Not decided. The code runs a proposed default that is not policy: Accrual and carry-forward `open`; encashment recorded as a request note only, never calculated. | Balance maths, year-end rollover |
| OD-034 | **Who approves leave and attendance corrections**, delegation when the manager is absent, whether HR can override, self-approval prevention. | Not decided. The code runs a proposed default that is not policy: Reporting-line manager first, `hr_manager` as fallback; nobody approves their own; the chain's top person (no manager) goes to the director or `hr_manager`. | Approval flows and the "my approvals" screen |
| OD-035 | **Retention of employee documents and records** after separation (and what is deleted vs archived). | Not decided. The code runs a proposed default that is not policy: No automatic deletion; retention periods `open`; a flag "retention review due" only. | Document lifecycle, export/erasure requests |
| OD-036 | **Retention and consent for unsuccessful candidates** (CVs, interview notes). | Not decided. The code runs a proposed default that is not policy: Keep for a review period `open`; candidate consent captured as a field; interview feedback visible only to recruiter, panel and HR. | Candidate storage, talent pool |
| OD-037 | **Compensation records: scope and viewers.** What a record contains (components, effective dates, currency, reason) and who may view or export. Records only, no payroll, no statutory calculation. | Not decided. The code runs a proposed default that is not policy: Keep as coded; nobody else sees salary until the owner names them; export audited. | Compensation screens, exports |
| OD-038 | **Access revocation on separation**: timing (last working day end, immediately on approval, on notice), what is disabled (login, sessions, roles, assets). | Not decided. The code runs a proposed default that is not policy: Disable login and revoke sessions at the end of the last working day, with an immediate manual override; roles removed by platform admin. | Offboarding case, security of ex-staff |
| OD-039 | **Employee ID format.** | Not decided. The code runs a proposed default that is not policy: Keep `EMP-####`; if the owner wants another format, change before first migration. | Baseline migration (the CHECK is part of it) |
| OD-040 | **Should `operations_manager` see private HR data** (private fields, documents, compensation)? And may they approve leave and recruitment for everyone? | Not decided. The code runs a proposed default that is not policy: Keep sensitive sets excluded; review the broad approve/export grants. | Role narrowing, HR reports export |
| OD-041 | **Interview panel rules**: minimum panel size, conflict of interest, who may see other panelists' feedback, who makes the final selection, offer approval limit. | Not decided. The code runs a proposed default that is not policy: Panel of at least two for staff roles, feedback hidden until submitted, final decision by `hr_manager`, not the recruiter, with director approval for the offer; all `open`. | Recruitment workflow and permissions |
| OD-042 | **Should a teacher also hold `employee`** (self-service attendance, leave, documents) and see the Ops module; same for admissions counsellors and coordinators. | Not decided. The code runs a proposed default that is not policy: Every staff member with a login gets `employee`; teacher module-switcher fix needs the Foundation test change. | Staff-wide attendance and leave; module switcher |
| OD-043 | **Attendance data source**: manual entry, validated CSV import, or a provider; the CSV column format, time zone and duplicate handling; who may import. | Not decided. The code runs a proposed default that is not policy: Manual + validated CSV (D-028) with the provider adapter as a mock; no biometric integration. | Import format, adapter design |
| OD-044 | **Student identity matching rule**: when two admissions are the same student (name + DOB + guardian phone?), who merges, and which module owns the canonical id. Whether Ops must collect DOB. | Not decided. The code runs a proposed default that is not policy: Add DOB (optional, minors collected with guardian) in Ops; Academic keeps ownership; a probable-duplicate warning, never an automatic merge. | Student administration, second-programme enrolment |
| OD-045 | **Onboarding and offboarding checklists and final approval**: standard items, asset return mandatory, notice period, who gives final sign-off, exit documents. | Not decided. The code runs a proposed default that is not policy: Reuse the 5 items plus asset assignment/return; final approval by `hr_manager`; notice period `open`. | Lifecycle cases and approvals |
| OD-046 | **Admissions closure reason codes** (formerly OD-ADM-1). Confirm the 11 proposed codes in setting `admissions.closure_reasons` and whether a code is mandatory when closing a case. | Not decided. Codes are optional (`requireCode: false`, state `proposed`); uncoded closures are reported as "not coded". | Admissions closure report (K-ADM-11) |
| OD-047 | **Who may check fee records** (formerly OD-ADM-2). | Not decided. Any holder of `ops:fees:record` other than the recorder (operations manager, finance officer). | Fee verification (OPS-072) |
| OD-048 | **Whether the director or auditor may read student and guardian contacts** (formerly OD-ADM-3). | Not decided. No (D-028): only `ops:student_private:read` holders (counsellor own, operations manager). | Student administration (OPS-077) |

---

## 10. Privacy and rights notes

1. **Minors.**
   - Most students are minors (`_broll/README.md`).
   - The CLAT post audit flags posts that "list minors' names" (scholarship-test rankers) for archiving.
   - `accounts/instagram-clat/README.md` names a student from a testimonial. A Class 9–12 event ("Startup Tank") appears in the audit.
   - Elevate OS must never seed or display real student data. Any asset showing students needs a consent record (OD-008).
2. **Real staff and family names.** The legacy files name the co-founder, teachers (Soma, Saumya, Tushar Bhagtay, Satish), a former on-camera presenter (Sushant Bindal), and the founder's brother (the source of the viral clip).
   - Under D-016 all **seeds and test fixtures must be fictional**.
   - Business planning data with no personal content (chapter lists, planned counts, idea titles) may be imported.
   - Idea titles and notes that name teachers should keep a role label or be redacted on import (for example "Soma Ma'am records" becomes "CA/GK teacher records").
3. **Founder's personal data.** `BRAND.md` §3 and §3b hold a story bank and career details, and `reports/` holds LinkedIn analytics. Treat these as restricted marketing reference, visible to marketing roles only, never as seed data.
4. **Contact details.** A phone number appears in `accounts/instagram-clat/README.md` (quoted from captions). Do not import it.
5. **Identity documents and payments.** The legacy rules say no Aadhaar, passwords, payment credentials or sensitive complaint detail in working files (Online `Rules!C23`; Marketing `Start Here!C34`). Elevate OS should follow the same rule unless OD-014 decides otherwise.
6. **Third-party material.**
   - `Part_1.md` and `Part_2.md` are OCR of a published reasoning textbook (publisher not identified; broken symbols and interleaved answers). `PACKAGE_NOTES.md`: "inclusion is for private project continuity, not permission to reproduce or redistribute". **Do not import.** Do not use them as question-bank content without rights clearance, independent solving and OCR repair (`B/Claude.md` rule 10).
   - `THE IIM GUIDE (just after 12th).md` says "Compiled by Sushant Bindal". It may contain past-paper or sample questions, and its ownership is unconfirmed. **Do not import.**
   - `IMS-test-timetable-reference.txt` is a competitor's schedule, which the handover "later set aside". **Do not import.**
   - The viral CA-result clip (GEN-011) belongs to the founder's brother's account. Reuse needs the original file, his OK and a credit.
   - Competitor channel data is public but approximate. Store it as `estimated`.
7. **Credentials.** None were found: no `.env`, and `PACKAGE_NOTES.md` states that none are included. Adapter credentials must live only in environment configuration (D-014).

---

## 11. Legacy artefact mapping

Targets:
- **MKT, ACD, OPS** = the owning module.
- **core** = shared schema.
- **import** = structured import by the Legacy data agent into `data/legacy/` and then the module seed.
- **reference** = informs requirements or docs; no data import.
- **not migrated** = left in place, with the reason given.

### Project A

| Artefact | Target | Treatment and reason |
|---|---|---|
| `CLAUDE.md` | MKT reference | Rules go into the PRD (account codes, ID scheme, non-negotiables) |
| `HANDOFF.md` | MKT reference; OPS decision log (import) | Approved decisions (section 4, #1–#18) are imported as legacy decisions with their status. The corrupted line is not imported. |
| `Claude1.md` | not migrated | Duplicate of `B/Claude.md` |
| `.env.example` | not migrated | The new repo has its own; `YT_API_KEY` becomes adapter config |
| `studio`, `brand/STYLE-video-look.md`, `brand/post-design-references` | not migrated | Stubs; the content is absent |
| `brand/BRAND.md` | MKT import (claims rules, usable facts); reference | Restricted claims and facts seed the claims-check config. The story bank stays restricted reference. |
| `.claude/skills/*` (8) | MKT reference | Workflow rules only. AI content generation is out of scope (D-015). |
| `accounts/*/README.md` (11 READMEs including `PROFILE.md`) | MKT import → social accounts | Name, platform, code, status, handle (null unless confirmed), proposed cadence |
| `accounts/instagram-clat/strategy-…`, `calendar-…` | MKT reference (optional import as `proposed` calendar entries, P2) | Proposed, awaiting approval |
| `accounts/instagram-clat/post-audit.csv` | MKT import → historical posts and metric snapshots | 60 posts; metrics captured 7 Oct; blanks stay missing; verdicts kept as tags |
| `accounts/linkedin-nikunj/{log,plan,strategy,voice}.md` | not migrated | Stubs; absent |
| `accounts/youtube-*/channels.json` | not migrated | Placeholders only |
| `accounts/youtube-clat/{PROFILE,calendar,strategy}` | not migrated | Relative links to the `instagram-clat` files, which are imported once |
| `courses/*/facts.md` | MKT import → fact register (P2) | Each fact keeps its source and date; verification status defaults to "unverified" unless the source is official |
| `courses/*/competitors.md`, `intel.md`, `questions.md` | MKT reference | Research notes; questions can be logged as idea-inbox sources |
| `courses/*/channels.json` (4 competitor lists) | MKT import → competitor channels (P2) | Input for the YouTube adapter |
| `courses/*/worked.md`, `courses/README.md` | not migrated | Empty or convention text |
| `courses/cuet/scans/2026-10-12.md` | MKT reference | Its numbers are `estimated` (judged by eye) |
| `tracker/ideas.csv` | MKT import → ideas | 59 rows. The 4 duplicate pairs are quarantined pending OD-003. Legacy status is mapped (PRD MKT-004). |
| `tracker/versions.csv` | MKT import → placements and publishing records | 36 rows. Status is mapped. The 3 `published` rows get a `result_24h` note as an unstructured legacy note. |
| `ideas/inbox.md` | MKT import → idea inbox (P2) | Struck-through and "filed as" entries are linked to ideas |
| `library/README.md`, `_broll/README.md`, `_broll/CATALOG.md` | MKT reference | Asset conventions and consent rules; the catalog is empty |
| `library/CLAT-008-8-week-plan/script.md`, `library/GEN-012-big4-scoreboards/script.md` | MKT import → asset records (script documents) | Linked to ideas. GEN-012 needs OD-003. |
| `library/GEN-011-ca-result-viral/README.md` | MKT import → asset placeholder with a rights flag | Third-party rights pending |
| `library/_brand/*`, other library stubs (25) | not migrated | Absent; recorded as "missing asset" references |
| Empty library and `_broll` subfolders | not migrated | Empty |
| `plans/team-and-volume-oct-dec-2026.md` | MKT reference | Proposed |
| `reports/2026-10-11-week.md` | MKT reference (optional import of LinkedIn snapshots, P2) | Historical; its numbers came from Taplio |
| `reports/2026-10-11-next-week-plan.md` | MKT reference | Draft; nothing scheduled |
| `reports/inbox/README.md`, empty inbox folders | MKT reference | Export instructions for the CSV importer |
| `tools/import-metrics.mjs` | MKT: port to a TypeScript importer (P1) | Section 3.2 |
| `tools/yt-scan.mjs` | MKT: port the algorithm to the YouTube adapter (P2) | Section 3.1 |
| `tools/README.md` | reference | Setup steps for the API key |
| `Elevate-Education-Agent-Handover-2026-10-15.zip` | Source for Project B | Read-only canonical source; importers read from it |

### Project B (paths relative to `B/`)

| Artefact | Target | Treatment and reason |
|---|---|---|
| `Claude.md` | reference; OPS decision log (import) | Decisions in section 4 (#19–#54) are imported with their status |
| `MANIFEST.json`, `PACKAGE_NOTES.md` | core import provenance | SHA-256 per source file is recorded on import |
| `elevate-education-operations/README.md`, `PROJECT_CHARTER.md`, `SYSTEM_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md` | OPS reference; core departments (import as `proposed`) | 13 suggested departments, status standard, escalation levels |
| `elevate-education-operations/ACADEMIC_PLANNING_DECISIONS.md` | ACD reference | Reusable workbook model, CA decisions |
| `elevate-education-operations/CA_FOUNDATION_ACCOUNTANCY_DRAFT.md` | not migrated | Superseded by the v0.2 full plan |
| `elevate-education-operations/IPMAT_LOCKED_BASELINES.md` | ACD import → curriculum baseline v1 (`locked`, full-year) | Subtopic allocations, VT01–VT14 test durations, LR/DI sequence. The header line is stale (DI-14). |
| `elevate-education-operations/CLASS12_ACCELERATED_BASELINE.md` | ACD import → Class 12 override version metadata | Lock history; 305 is current |
| `elevate-education-operations/IPMAT_REFERENCE_NOTES.md`, `IPMAT_WEB_REFERENCE_REVIEW.md` | ACD reference (exam-pattern and scoring configs, P2) | External facts dated 10 Sep 2026; must be re-verified each cycle |
| `elevate-education-operations/templates/*` and the identical copies in `outputs/elevate-education-operations/` | OPS reference (SOP template, register schema, task tracker schema, department intake) | The copies are duplicates; only one is used |
| `outputs/CA-Foundation-Accountancy-Full-Plan.md` | ACD import (provisional) | 46 topics `ACC-01-01…`, 11 tests |
| `outputs/Combined-IIM-Entrance-Syllabus.md` | ACD reference | Draft v1.0 syllabus inventory (Q01–Q17, V01…) |
| `outputs/Quant-Class-Estimates.md`, `outputs/Quant-Teaching-Estimates-v2.md` | not migrated | Superseded by the locked baselines |
| `outputs/Verbal-Teaching-Estimates-v2.md` | ACD import → Verbal subtopic codes G1…Q8 | Codes and class counts, as locked |
| `outputs/class12-planner/Class-12-Course-Planner.xlsx` | ACD import (P0) | 305 lessons (`provisional` dates, counts `locked`), 70 chapter tests (`draft` dates), assessment budget (full mocks flagged per OD-016), 28-slot exclusion allowance, 8 homework items. Cached volatile values are ignored. |
| `outputs/concept-books/Elevate-Concept-Book-Indices.xlsx` | ACD import (P0) | 6 books, 133 + 1 chapters with stable IDs; retired and moved IDs as aliases; CR counts |
| `outputs/concept-books/Quant-Exam-Index-Comparison.xlsx` | ACD reference (exam sources S1–S9, P2) | Evidence tags N/L/B/S/U/X; the "32 chapters" index is stale |
| `outputs/elevate-operations/Elevate-Operations.xlsx` | Split import: **ACD** (Batch Register, Accountancy Plan, Test Tracker; the Teaching Log and Catch-up Log schemas); **OPS** (Work Inventory as processes, Decisions as decisions, SOP Register as SOPs with status `not_drafted`) | Legacy IDs are namespaced (DI-21); dashboard values are not imported |
| `outputs/marketing-operations/Elevate-Marketing-Easy.xlsx` | MKT and OPS reference (rules, status lists, role lists, source lists, KPI formulas); OPS import of SOP summaries MKT-01 to 09 as `draft` | The 200 preallocated IDs are **not** imported: "IDs are preallocated placeholders, not completed posts" |
| `outputs/marketing-operations/Elevate-Marketing-Operations.xlsx` | not migrated | Earlier version of Easy |
| `outputs/online-operations/Elevate-Online-Easy.xlsx` | OPS import: SOP scopes ON-01…16 (`draft`), Rules (with decision states, as policies), Roles (as role definitions), Routine (as routine templates), Actions ON-001…010 (as tasks) | Names and backups are blank, so none are imported |
| `outputs/online-operations/Elevate-Online-Operations.xlsx` | not migrated | Earlier version |
| `outputs/online-operations/Elevate-Online-Coordinator-SOP.docx` | OPS import → an SOP record (`draft`, version 0.x, dated 18 Sep 2026) with the document attached as a reference | Unsigned |
| `source-references/Part_1.md`, `Part_2.md`, `THE IIM GUIDE (just after 12th).md`, `IMS-test-timetable-reference.txt` | not migrated | Third-party or unconfirmed rights (section 10) |
| `work/*.mjs`, `work/*.py` (16) | not migrated | Not runnable and would overwrite; logic captured in the requirements |
| `work/*.png` (105), `work/**/*.ndjson` (2) | not migrated | Historical previews and inspection logs |
| `work/class12-accelerated-summary.json`, `work/class12-weekend-map.json` | not migrated | 313-stage or draft snapshots; the workbook is authoritative |
| `work/artifact.md` | not migrated | Notes on the docx template for the SOP builder |
