# data/legacy — structured extracts of the legacy Elevate planning material

Owner: Legacy Data (wave 1c, `docs/BUILD_PLAN.md`). Extraction date: **2026-10-17**. The legacy sources are read-only (D-001) and were never modified.

These files are inputs for module seeds and importers. They carry **business planning data with its status label** (D-016). Nothing here is evidence that work was delivered: every lesson, test, question count and placement is a plan unless its status says otherwise, and no record uses `delivered` because the sources contain no verified delivery.

## How to rebuild

```
python -I data/legacy/_extract/extract_legacy.py      # writes all JSON + _extract/sources_read.json (hashes, zip cross-check)
python -I data/legacy/_extract/verify.py              # re-parses everything, checks totals, privacy and provenance; exit 1 on failure
python -I data/legacy/_extract/build_manifest.py      # writes MANIFEST.json (run last)
```

Optional flags for the extractor: `--content-os DIR`, `--handover DIR`, `--out DIR`. Requires `openpyxl`.

## Source roots (used in every `source.path`)

| Prefix | Location |
|---|---|
| `content-os/` | `C:\OPENBOT\OLD\01-original-elevate-os\` (the content operating system) |
| `handover/` | `Elevate-Education/` inside `content-os/Elevate-Education-Agent-Handover-2026-10-15.zip`. Read from an extracted copy; `_extract/sources_read.json` records that every file's SHA-256 equals its zip member. |

Workbooks were opened twice with openpyxl: `data_only=False` (formulas) and `data_only=True` (cached values). Formulas are copied verbatim next to their cached values.

## File shape

Every JSON file is `{ "meta": { source_files, extracted_at, extractor, record_arrays, notes }, ...named arrays }`. `meta.record_arrays` lists the arrays (dotted paths) whose items are records; every record has `source` (`{path, locator}` where locator is `line N`, `lines …` or `sheet 'Name'!A5:F5`) and `status`.

## Files

| File | Records | What it is | Sources (path + range) |
|---|---|---|---|
| `marketing/accounts.json` | 10 accounts + 1 conflict | The 9 approved accounts + the later founder Instagram (codes LI, LIP, IGC, YTC, IGU, YTU, IGI, YTI, IGS, IGN): platform, display name, handle (null unless confirmed; suggestions in `proposed_handle`), audience/job, cadence, rules, status, Metricool brand, proposed team-plan cadence | `content-os/CLAUDE.md` L36-51; `accounts/*/README.md` L1-6; `accounts/instagram-clat/PROFILE.md`; `HANDOFF.md` §8 table; `plans/team-and-volume-oct-dec-2026.md` table; conflict from `handover/Claude.md` L171 + Marketing-Easy `Content!B6:B205` dropdown |
| `marketing/ideas.json` | 59 ideas, 4 duplicate groups | Every row/column of `tracker/ideas.csv` (CSV `source` column renamed `origin`), duplicate flags and proposed codes for second occurrences (`proposed_renumbering`, not applied) | `content-os/tracker/ideas.csv` L1-60; `CLAUDE.md` L36 |
| `marketing/placements.json` | 36 | `tracker/versions.csv` normalised: account code/variant from the version suffix, parsed date/time, parsed 24 h results, `ambiguous` for reused idea IDs | `content-os/tracker/versions.csv` L1-37 |
| `marketing/post-audit.json` | 60 | CLAT Instagram 60-post audit (7 Oct 2026): metrics as reported, boosted flag, verdict actions; summary counts | `content-os/accounts/instagram-clat/post-audit.csv` L1-61; README L49-52 |
| `marketing/content-rules.json` | 45 | Approval-workflow rules: 22 banned phrases/claims, 6 approvals, 10 channel rules, 7 consent rules; regex/literal matcher or `manual_check`; exact source line (names redacted) | `brand/BRAND.md`, `CLAUDE.md`, `HANDOFF.md`, account READMEs, `PROFILE.md`, `library/_broll/README.md`, CLAT calendar, `post-audit.csv`; handover marketing SOP `SOP Register!G8`, coordinator SOP docx |
| `marketing/metrics-csv-formats.json` | 2 | Instagram (Meta Business Suite) and YouTube Studio CSV formats that `import-metrics.mjs` accepts: detection, header synonyms, transforms, output columns | `content-os/tools/import-metrics.mjs` L8-9, 21, 24-56, 73-117, 124 |
| `academic/programmes.json` | 7 (+4 IPMAT variants) | Programme catalogue with mode / class length (null when not stated) and status | `BRAND.md` course table L17-24; `handover/Claude.md` §4-6, §9; `IPMAT_LOCKED_BASELINES.md`; `ACADEMIC_PLANNING_DECISIONS.md`; `IPMAT_REFERENCE_NOTES.md` |
| `academic/ipmat-baseline.json` | 20 Quant blocks (+subtopics), 11 higher-maths, 6+46 Verbal, 19 LR, 8 DI, 27-step sequence, 14 Verbal test groups, mocks, budget rows | Locked 253-class baseline, programme practice (360), Class 12 override (305) with supersession lineage, assessments (70 chapter tests, sectionals, 50/70 mocks), provisional calendar with the unverified IIMB date | `handover/elevate-education-operations/IPMAT_LOCKED_BASELINES.md` (all tables), `CLASS12_ACCELERATED_BASELINE.md`, `outputs/Verbal-Teaching-Estimates-v2.md`, `Class-12-Course-Planner.xlsx` `Overview!A4:G9`, `Assessment budget!A5:F19`, `Claude.md` L83-95 |
| `academic/class12-plan.json` | 305 lessons, 104 chapters, 70 tests, 33 weekends, 7 exclusions, 13 month rows, 8 homework items, 4 conflicts | IPMAT Class 12 planner: lessons, chapter sequence, capacity math with cell formulas, exclusions, monthly allocation, chapter tests, weekend map + rules, known conflicts | `Class-12-Course-Planner.xlsx`: `Lesson planner!A5:Q309`, `Overview!A4:G47`, `Monthly allocation!A4:R17`, `Assessment budget!A27:F54`, `Chapter tests!A4:P74`, `Weekend map!A4:J49`; `work/class12-weekend-map.json`; `work/class12-accelerated-summary.json` (superseded 313 version) |
| `academic/concept-books.json` | 6 books (133 chapters + 1 opening unit), 3 ID changes | Six chapter indices with subtopics; CR question bank per chapter (planned counts, written = 0); unrecoverable Quant/Higher-Maths model | `Elevate-Concept-Book-Indices.xlsx` all sheets (`Overview!A4:E20`, book sheets A4:G/K); `Claude.md` L97-149 |
| `academic/ca-foundation-accountancy.json` | 11 chapters / 46 topics | CA Foundation Accountancy v0.2 (provisional) with tests, cross-checked against the Operations workbook; v0.1 superseded; other subjects' reference budgets; calendar rules | `outputs/CA-Foundation-Accountancy-Full-Plan.md`; `CA_FOUNDATION_ACCOUNTANCY_DRAFT.md`; `Elevate-Operations.xlsx` `Accountancy Plan!A5:P50`, `Test Tracker!A5:M15`, `Decisions!A16:D24` |
| `academic/online-class12-accountancy.json` | 14 chapters, 6 build-up steps, 5 subjects | 226-hour online Accountancy plan (60-min classes; provisional); four subjects not started | `handover/Claude.md` L163-167 (only source) |
| `academic/combined-iim-syllabus.json` | 4 areas / 32 modules, 5 exam layers, 17 Quant evidence rows, 9 exam sources | Combined syllabus modules (all apply to all 5 exams), exam application layer, Quant topic-to-exam evidence matrix (N/L/B/S/U/X) | `outputs/Combined-IIM-Entrance-Syllabus.md`; `Quant-Exam-Index-Comparison.xlsx` `Topic comparison!A4:K21`, `Exam sources!A4:G13` |
| `academic/assessment-patterns.json` | 12 exams + 5 internal formats | Exam patterns as documented (CLAT; IIMB; Indore; Rohtak; JIPMAT; Kozhikode; NPAT/SET/CHRIST/GAT scope; CUET; CA) with verification status; unknowns null | `courses/clat/facts.md`, CLAT strategy L9, CLAT-008 script L56; `IPMAT_WEB_REFERENCE_REVIEW.md` L5-11; Quant comparison `Exam sources`; planner/ops workbooks |
| `ops/departments.json` | 13 departments + status standard (7), escalation (4), common records (8), leadership layer (6), governance (5) | 13-department starting model | `handover/elevate-education-operations/SYSTEM_ARCHITECTURE.md`; `PROJECT_CHARTER.md` §Governance |
| `ops/operations-workbook.json` | 10 sheets | Every sheet of `Elevate-Operations.xlsx`: headers, rows, per-column formula templates, dropdowns, Dashboard formulas; `status_vocabularies` | `outputs/elevate-operations/Elevate-Operations.xlsx` all sheets |
| `ops/workflows.json` | 10 workflows, 20 online rules | Offline student flow, demo, admission, attendance, online absence checkpoint, tests, office hours, webinars, monthly report, marketing rhythm; online operating rules; lead sources and CRM stages | `handover/Claude.md` §4, §10-11; `Elevate-Operations.xlsx` `Work Inventory`, `Decisions`; `Elevate-Online-Easy.xlsx` `Rules!A4:C24`, `Routine`; Marketing-Easy `Start Here`, `CRM Import` dropdowns; coordinator SOP docx |
| `ops/sops.json` | 1 SOP + 3 registers | SOP template sections, register template, operations/online/marketing SOP registers, online coordinator SOP (draft) as 11 sections of steps | `templates/sop_template.md`, `templates/sop_register.csv`; `SOP Register` sheets of 3 workbooks; `outputs/online-operations/Elevate-Online-Coordinator-SOP.docx` |
| `ops/roles.json` | 12 online roles (+10 marketing, 16 offline, 6 content-team) | Role labels and their work; labels are not hires | `Elevate-Online-Easy.xlsx` `Roles!A4:F18`; Marketing-Easy `Content!I6` dropdown + `SOP Register`; Operations `Work Inventory!E5:E29`; `plans/team-and-volume-oct-dec-2026.md` |
| `ops/trackers.json` | 4 workbooks, 2 templates | Structures of the marketing/online Easy and Operations workbooks: sheets, visibility, columns, dropdowns, formulas, row capacity, rows when < 300 (reserved-ID rows summarised) | the 4 workbooks under `outputs/marketing-operations/` and `outputs/online-operations/`; `templates/master_tracker.csv`, `department_intake.md` |
| `_extract/*` | — | `extract_legacy.py`, `verify.py`, `build_manifest.py`, `sources_read.json` (source hashes) | — |
| `_private/README.md` | — | Explains that a person-to-role mapping exists in the legacy source; contains no names | — |
| `MANIFEST.json` | — | SHA-256 of every output and every source read | — |

## Status vocabulary

Core labels (D-016): `locked` (user explicitly locked for planning), `approved` (source says Confirmed/approved), `proposed`, `provisional` (accepted as a working estimate), `planned` (scheduled intent; not done), `delivered` (not used: no source proves delivery), `unverified` (stated but not checked against an official/real source).

Also used where the source requires it: `documented` (described or user-reported, no decision label; e.g. 'Discussed', 'User confirmed' platform capabilities), `open` (explicitly unresolved), `draft`, `superseded`, `not_started`, `rejected`, `offered`/`paused` (programme level), `unrecoverable` (Quant mapping). Marketing ideas/placements keep the tracker's own pipeline words (`idea`, `scripted`, `ready`, `scheduled`, `published`, `held`, `parked`, …) as `status`, with the raw word in `legacy_status`. Wherever a source word was mapped, the verbatim word is kept (`source_status`, `legacy_status`, `*_in_source`).

## Privacy handling

- Real people are replaced by role labels (`[founder]`, `[faculty:current_affairs]`, `[faculty:logical_reasoning]`, `[faculty:english_verbal]`, `[faculty:quant]`, `[staff:former_presenter]`, `[student]`, `[guest expert]`); folder slugs that contain the founder's first name appear as `{founder}`. Personal handles/profile URLs are replaced by markers. See `_private/README.md`.
- Not extracted: phone numbers, emails, student records or names, staff names, the founder's credentials and story details, the template's placeholder person list, and the third-party faculty names embedded in a reference URL (path redacted).
- Brand/company handles (e.g. `@elevate.clat`, `@elevateeducation_sikar`), public figures in news-topic titles, idea titles, planned counts and post metrics are kept.
- `verify.py` check P1 scans every `.json`/`.md` under `data/legacy` for known names, Indian mobile numbers and emails.
- Third-party OCR/reference material in the handover (`source-references/Part_1.md`, `Part_2.md`, `THE IIM GUIDE (just after 12th).md`, `IMS-test-timetable-reference.txt`) was **not read or copied**. The handover marks it third-party/copyrighted, for private continuity only (`PACKAGE_NOTES.md`); only its existence and the book-chapter mapping notes in `Claude.md` §8 are acknowledged.

## Conflicts and discrepancies found in the sources

1. **Account models disagree.** Content OS (approved 6 Oct 2026): 9 accounts, no "Elevate main". Operations handover: Instagram Elevate CA / CLAT / Sikar / Online + 3 YouTube. "Elevate CA" and "Elevate Online" also clash with the brand rules (no CA marketing, no "online" label). Recorded as `ACC-CONFLICT-001` (unreconciled).
2. **Duplicate idea IDs** CLAT-027, GEN-012, CUET-002, COM-005. Proposed codes for the second occurrences: CLAT-028, GEN-014, CUET-006, COM-006 (none appears anywhere in the content OS). `library/GEN-012-big4-scoreboards/` belongs to the second GEN-012. Placements CLAT-027-IGC and GEN-012-IGS are ambiguous; the 11 Oct plan suggests both mean the first occurrence.
3. **Class 12 counts.** Latest workbook = 305 classes; `IPMAT_LOCKED_BASELINES.md` header and `work/class12-accelerated-summary.json` still say 313 (marked superseded).
4. **Full mocks.** `Claude.md` says 20 non-IIM mocks were excluded (50 active); the planner still lists 70 annual allocations. Both recorded.
5. **Quant practice rows** sum to 36, not the stated 38 (the source's own correction: 2 topic-pending classes keep the 53 budget).
6. **CA Foundation start.** `Claude.md`/`IPMAT_REFERENCE_NOTES.md` say 1 March 2027 selected/confirmed; `ACADEMIC_PLANNING_DECISIONS.md` and Operations `Decisions!D-016` keep March/April open.
7. **Online office hours.** The Online Easy `Rules` sheet marks them `Locked`; `Claude.md` says the SOP's service timings still need management approval.
8. **Marketing weekly rhythm.** `Claude.md`: brief Wed / shoot Thu / approve Fri; MKT-01: plan Wed / briefs Thu / production Fri / approve-schedule Sat.
9. **LinkedIn no-hashtag/no-poll rule** is written only for the founder's personal profile (LI); the company page (LIP) README does not state it.
10. **Quant evidence matrix** ("Our location") uses an older 32-chapter Quant index, not the locked 38-chapter Book 2; IPMAT Rohtak is not in that comparison.
11. **Lead system naming.** Work Inventory still says "Academy"; the handover rule is to call it CRM.

## Verification notes (numbers checked against `C:\OPENBOT\OLD\03-early-analysis\ELEVATE-OS-COMPLETE-EXTRACTION.md`)

| Number in the extraction doc | Found | Match |
|---|---|---|
| 9 accounts / 6 Metricool brands; codes LI…IGN; `@elevate.clat` only confirmed handle | 9 (+IGN later) / 6; same codes; only `@elevate.clat` | yes |
| ideas.csv "about 56" rows | **59** rows | **no** (doc is approximate and low) |
| 4 duplicate IDs (CLAT-027, GEN-012, CUET-002, COM-005) | same 4 | yes |
| 60 posts: 34 keep (2 pin), 25 archive, 2 unpin | 34 (2) / 25 archive-only (+1 "UNPIN + ARCHIVE") / 2 | yes |
| 13 boosted reels, ~2.9M views, ~250 likes | 13; 2,964,600; 253 | yes |
| CLAT 120 Q, 2 h, −0.25, 6 Dec 2026 2–4 PM, registration to 31 Oct | same (section question counts not in any source) | yes |
| 253 = Quant 151 (114 + 37) + Verbal 57 + LR 32 + DI 13 | same; Quant subtopics sum to every block | yes |
| Class 12 override 305 / 381.25 h (178 / 70 / 39 / 18), replaces 313 and 360 | same (305 lesson rows) | yes |
| Capacity 345 gross − 28 exclusions = 317 net vs 305 | B30 = 345, E51 = 28, B52 = 317; headroom 12 (B35) | yes |
| 70 chapter tests (25 / 28 / 11 / 6), 85.75 h | same | yes |
| 50 IIM-focused full mocks | 50 active; workbook still lists 70 | partly (see conflict 4) |
| Last Verbal paper clashes with the 14 Nov provisional date; 12 papers overlap mock phase | VT14-B 13–14 Nov 2027; 12 tests after 15 Oct | yes |
| IIMB ~14 Nov 2027 unverified | flagged `unverified` | yes |
| Concept books 18 / 38 (+Foundations) / 11 / 26 / 17 / 23 = 133 | same | yes |
| CR bank 1,150 = 220 + 575 + 355 | same; 7 × 50 + 10 × 80 | yes |
| Quant 4,470 / Higher Maths 1,220 mapping not recoverable | recorded, mapping null | yes |
| CA Accountancy 11 chapters, 46 blocks, 98 + 52 h | same; tests 12 h + discussions 13 h; 175 h; matches the Operations workbook | yes |
| CA "1 March 2027 start was confirmed" | sources conflict (conflict 6) | **partly** |
| Online Accountancy 226 h, 60-min classes; four subjects not started | 226 (chapters sum 118); 4 not started | yes |
| Demo 2 days, ₹1,000 adjusted; absence call ~15 min | Confirmed (D-003, D-006) | yes |
| Online timings, 15-min checkpoint, 5th-working-day report are proposals | checkpoint and report `Proposed`; office hours `Locked` in Rules sheet | **partly** (conflict 7) |
| 13 departments; Elevate-Operations 10 sheets | 13; same 10 sheets | yes |
| 12 role labels; 200 online action rows | 12; 200 prepared rows, only 10 populated (ON-001…ON-010, all Not started) | yes (detail added) |
| Marketing: 4 IG pages (CA, CLAT, Sikar, Online) + 3 YouTube | present in handover, but conflicts with the 9-account model | yes as stated; conflict not flagged in doc |

### `verify.py` output (2026-10-17 run)

<!-- verify:start -->
```
ID   Check                                                                                        | Doc/expected                             | Actual                                         | Result
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
S1   20 JSON files parse and have meta{source_files,extracted_at=2026-10-17,notes} + record array | 0 problems                               | 0 problems []                                  | PASS
S2   every record in declared record arrays has source + status (1233 records)                    | 0 missing                                | 0 missing []                                   | PASS
P1   no personal names, phone numbers or emails in any data/legacy .json/.md (incl. _private)     | 0                                        | 0 []                                           | PASS
A1   Quant base teaching = 114 (sum of 20 blocks)                                                 | 114                                      | 114                                            | PASS
A2   Quant higher maths = 37 (sum of 11 topics)                                                   | 37                                       | 37                                             | PASS
A3   Quant teaching = 151                                                                         | 151                                      | 151                                            | PASS
A4   Verbal teaching = 57 (6 blocks; 46 topic rows)                                               | 57                                       | 57 / 57                                        | PASS
A5   LR teaching = 32 / DI teaching = 13                                                          | 32 / 13                                  | 32 / 13                                        | PASS
A6   Locked teaching baseline = 253                                                               | 253                                      | 253                                            | PASS
A7   Quant subtopic allocations sum to block counts                                               | 20/20                                    | 20/20                                          | PASS
A8   Programme allocation 360 = 253 + 53 Quant + 28 Verbal + 18 LR + 8 DI practice                | 360                                      | 360                                            | PASS
A9   Quant base practice rows: stated 38, actual sum 36 (source's own correction)                 | 38 stated / 36 actual                    | 38 / 36                                        | PASS
A10  Full mocks: 50 IIM-focused (Indore 15, Rohtak 10, JIPMAT 10, IIMB 8, IIMK 7); workbook still | 50 (of 70)                               | 50 (of 70)                                     | PASS
A11  Chapter tests 70 = Quant 25 + Verbal 28 + LR 11 + DI 6                                       | 70                                       | 70                                             | PASS
A12  IIMB exam date flagged unverified                                                            | unverified                               | unverified                                     | PASS
B1   Class 12 lessons = 305 (253 teaching + 52 practice)                                          | 305 (253+52)                             | 305 (253+52)                                   | PASS
B2   Class 12 by subject Quant 178 / Verbal 70 / LR 39 / DI 18                                    | 178/70/39/18                             | 178/70/39/18                                   | PASS
B3   Class 12 hours = 305 x 75 / 60 = 381.25                                                      | 381.25                                   | 381.25                                         | PASS
B4   ipmat-baseline Class 12 override totals match lesson rows                                    | match                                    | match                                          | PASS
B5   Gross pre-IIMB slots 345 = 157 days x 2 + 31 third classes (B30)                             | 345                                      | 345                                            | PASS
B6   Exclusions 28 slots (5 holiday + 5 school-exam days)                                         | 28 (5+5)                                 | 28 (5+5)                                       | PASS
B7   Net slots 317 = 345 - 28 (B52)                                                               | 317                                      | 317                                            | PASS
B8   Headroom after exclusions 12 = 317 - 305 (B35)                                               | 12                                       | 12                                             | PASS
B9   Monthly allocation total slots = 305 and third-class slots = 31                              | 305 / 31                                 | 305 / 31                                       | PASS
B10  Chapter tests 70: Quant 25 / Verbal 28 / LR 11 / DI 6                                        | 70: 25/28/11/6                           | 70: 25/28/11/6                                 | PASS
B11  Chapter test + discussion hours = 85.75                                                      | 85.75                                    | 85.75                                          | PASS
B12  Tests after the 15 Oct teaching target (overlap mock phase) = 12                             | 12                                       | 12                                             | PASS
B13  Tests done by 15 Oct = 58; by 10 Nov = 69                                                    | 58 / 69                                  | 58 / 69                                        | PASS
B14  Last paper VT14-B on Sat 13 Nov, discussion Sun 14 Nov 2027 (= provisional IIMB date)        | VT14-B 2027-11-13/14                     | VT14-B 2027-11-13/14                           | PASS
B15  No weekend exceeds the 210-minute cap (33 weekends)                                          | 0 over cap                               | 0 over cap / 33 weekends                       | PASS
B16  Every lesson status is 'planned' and has no actual delivery data                             | 305 planned                              | 305                                            | PASS
C1   Concept books 133 = B1 18 + B2 38 + B3 11 + B4 26 + B5 17 + B6 23 (+ B2 Foundations opening  | 133: 18/38/11/26/17/23 +1                | 133: 18/38/11/26/17/23 +1                      | PASS
C2   CR bank 1,150 = 220 concept + 575 practice + 355 Ranker's Zone                               | 1150 = 220+575+355                       | 1150 = 220+575+355                             | PASS
C3   CR chapters: 7 x 50 + 10 x 80 (row sums equal 1,150)                                         | 7x50 + 10x80                             | 7x50 + 10x80 = 1150                            | PASS
C4   Every CR count tagged planned, written = 0                                                   | 17/17                                    | 17/17                                          | PASS
C5   Quant/Higher Maths mapping flagged unrecoverable (4,470 + 1,220 = 5,690; mapping null)       | unrecoverable, 5690                      | unrecoverable, 5690                            | PASS
D1   CA Accountancy: 11 chapters / 46 blocks                                                      | 11 / 46                                  | 11 / 46                                        | PASS
D2   CA hours 98 explanation + 52 practice = 150                                                  | 98+52=150                                | 98+52=150                                      | PASS
D3   CA tests 12 h + discussions 13 h; first-pass student hours 175                               | 12 + 13; 175                             | 12 + 13; 175                                   | PASS
D4   CA plan .md matches Operations workbook topic + test hours                                   | 0 mismatches                             | 0 topic / 0 test                               | PASS
E1   Online Accountancy CBSE chapter hours sum = 118 (14 chapters)                                | 118 (14)                                 | 118 (14)                                       | PASS
E2   Online Accountancy build-up 118+4+40+30+13+21 = 226 h (60-min classes)                       | 226                                      | 226                                            | PASS
E3   Four other online subjects not started                                                       | 4                                        | 4                                              | PASS
M1   Account codes match CLAUDE.md (10 codes; 9 approved + IGN later)                             | LI LIP IGC YTC IGU YTU IGI YTI IGS IGN   | IGC IGI IGN IGS IGU LI LIP YTC YTI YTU         | PASS
M2   Metricool brands = 6                                                                         | 6                                        | 6                                              | PASS
M3   Only confirmed handle is @elevate.clat (others null, never invented)                         | @elevate.clat                            | @elevate.clat                                  | PASS
M4   ideas.json holds every ideas.csv row (doc says 'about 56')                                   | about 56 (CSV: 59)                       | 59                                             | PASS
M5   Duplicate legacy IDs = CLAT-027, COM-005, CUET-002, GEN-012                                  | CLAT-027 COM-005 CUET-002 GEN-012        | CLAT-027 COM-005 CUET-002 GEN-012              | PASS
M6   Proposed codes unique, not colliding with legacy IDs, status proposed_renumbering            | 4 unique                                 | 4 unique: ['CLAT-028', 'GEN-014', 'CUET-006',  | PASS
M7   Placements: 36 rows, all idea IDs exist, codes match account slugs                           | 36 / all / all                           | 36 / 36 / 36                                   | PASS
M8   Ambiguous placements (point at duplicated IDs)                                               | CLAT-027-IGC, GEN-012-IGS                | CLAT-027-IGC, GEN-012-IGS                      | PASS
M9   Post audit: 60 posts; 34 keep (2 pin) / 25 archive / 2 unpin                                 | 60; 34(2)/25/2                           | 60; 34(2)/25/2                                 | PASS
M10  Boosted reels 13, ~2.9M views, ~250 likes                                                    | 13; ~2.9M; ~250                          | 13; 2,964,600; 253                             | PASS
M11  Content rules: all 4 kinds present, regexes compile, manual_check where matcher null         | 4 kinds, 0 bad                           | 4 kinds (45 rules), 0 bad                      | PASS
M12  Banned-phrase regexes fire on known-bad samples                                              | 5/5                                      | 5/5                                            | PASS
M13  Metrics CSV formats: instagram + youtube                                                     | instagram, youtube                       | instagram, youtube                             | PASS
O1   13-department architecture                                                                   | 13                                       | 13                                             | PASS
O2   Operations workbook: 10 sheets                                                               | Dashboard, Work Inventory, Decisions, Ba | Dashboard, Work Inventory, Decisions, Batch Re | PASS
O3   Ops Dashboard cached: processes 25, open decisions 8, baseline h 150, topics 46, student h 1 | 25/8/150/46/175                          | 25/8/150/46/175                                | PASS
O4   Work Inventory 25 rows; Decisions 24 rows (8 Open); Accountancy Plan 46 rows                 | 25 / 24 (8) / 46                         | 25 / 24 (8) / 46                               | PASS
O5   Teaching Log / Catch-up Log hold no delivery rows                                            | 0 / 0                                    | 0 / 0                                          | PASS
O6   12 online role labels (labels != hires)                                                      | 12                                       | 12                                             | PASS
O7   Online Easy Actions: 200 prepared rows, 10 populated setup actions                           | 200 / 10                                 | 200 / 10                                       | PASS
O8   Marketing Easy Content: 200 reserved IDs EE-001..EE-200, no posts                            | 200 EE-001..EE-200                       | 200 EE-001..EE-200                             | PASS
O9   Demo: 2 days, INR 1,000 adjusted on joining (approved)                                       | 2 / 1000 / approved                      | 2 / 1000 / approved                            | PASS
O10  Absence call 15 min: offline approved, online proposed; monthly report proposed              | approved / proposed / proposed           | approved / proposed / proposed                 | PASS
O11  Coordinator SOP is a draft with null owner/backup                                            | draft, null, null                        | draft, None, None                              | PASS

67/67 checks passed
```
<!-- verify:end -->

## Not extracted / limits

- Founder LinkedIn strategy/plan/log/voice, the Remotion studio and all media: 38–90-byte stubs pointing to a Mac; content not in the source.
- `tracker/metrics.csv` and any real platform exports do not exist; metrics formats come from the script only.
- External links (Claude Docs master plan, Google Sheets) are not snapshots and were not fetched.
- CLAT section-wise question counts; IIMB/Indore/Rohtak/JIPMAT marking schemes; CA Foundation exam pattern: not in any source (null).
- Per-topic exam mapping for Verbal/LR/DI does not exist in the sources; only Quant has evidence.
- Competitor channel lists, weekly report numbers, CLAT calendar/strategy narrative, PNG previews and inspection logs were out of scope.
