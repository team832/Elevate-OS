"""Re-parse every data/legacy output, check shape, provenance, privacy and key totals.

    python -I data/legacy/_extract/verify.py

Prints a pass/fail table and exits 1 if any check fails. 'Doc' is the value stated in
C:/OPENBOT/OLD/03-early-analysis/ELEVATE-OS-COMPLETE-EXTRACTION.md (or the task brief) where one exists.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent  # data/legacy
RESULTS: list[tuple[str, str, str, str, bool]] = []


def check(cid: str, what: str, doc, actual, ok: bool | None = None):
    if ok is None:
        ok = doc == actual
    RESULTS.append((cid, what, "" if doc is None else str(doc), str(actual), bool(ok)))


def J(rel: str):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def resolve(doc, dotted):
    o = doc
    for p in dotted.split("."):
        o = o[p]
    return o


# ---------------------------------------------------------------- structure + provenance
files = sorted(p for p in ROOT.rglob("*.json") if "_extract" not in p.parts and p.name != "MANIFEST.json")
bad_shape, missing_prov, n_records = [], [], 0
for p in files:
    rel = p.relative_to(ROOT).as_posix()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        bad_shape.append(f"{rel}: invalid JSON ({e})")
        continue
    m = d.get("meta", {})
    if not (isinstance(m.get("source_files"), list) and m["source_files"] and m.get("extracted_at") == "2026-10-17" and isinstance(m.get("notes"), list)):
        bad_shape.append(f"{rel}: meta incomplete")
    ras = m.get("record_arrays") or []
    if not ras:
        bad_shape.append(f"{rel}: no record arrays")
    for ra in ras:
        arr = resolve(d, ra)
        if not isinstance(arr, list):
            bad_shape.append(f"{rel}:{ra} not a list")
            continue
        for i, rec in enumerate(arr):
            n_records += 1
            if not (isinstance(rec, dict) and rec.get("source") and rec.get("status")):
                missing_prov.append(f"{rel}:{ra}[{i}]")
check("S1", f"{len(files)} JSON files parse and have meta{{source_files,extracted_at=2026-10-17,notes}} + record arrays", "0 problems", f"{len(bad_shape)} problems {bad_shape[:3]}", not bad_shape)
check("S2", f"every record in declared record arrays has source + status ({n_records} records)", "0 missing", f"{len(missing_prov)} missing {missing_prov[:3]}", not missing_prov)

# ---------------------------------------------------------------- privacy
NAMES = re.compile(r"nikunj|bindal|sushant|\bsoma\b|saumya|tushar|satish|\bsaty\b|geetanjali|varun soni|maya chen|lena ortiz|aman khedia|parag gupta|amol jain", re.I)
PHONE = re.compile(r"(?<![\w/.-])(?:\+91[\s-]?)?[6-9]\d{9}(?![\w/.-])")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.(?:com|in|org|net|edu|co)\b", re.I)
leaks = []
for p in ROOT.rglob("*"):
    if p.is_file() and p.suffix in {".json", ".md"}:
        t = p.read_text(encoding="utf-8")
        for rx, kind in ((NAMES, "name"), (PHONE, "phone"), (EMAIL, "email")):
            for m in rx.finditer(t):
                leaks.append(f"{p.relative_to(ROOT).as_posix()}: {kind} '{m.group(0)}'")
check("P1", "no personal names, phone numbers or emails in any data/legacy .json/.md (incl. _private)", "0", f"{len(leaks)} {leaks[:5]}", not leaks)

# ---------------------------------------------------------------- IPMAT baseline
ib = J("academic/ipmat-baseline.json")
qb = sum(b["teaching_classes"] for b in ib["quant_teaching_blocks"])
hm = sum(b["teaching_classes"] for b in ib["quant_higher_maths"])
vb = sum(b["teaching_classes"] for b in ib["verbal_teaching_blocks"])
vt = sum(b["teaching_classes"] for b in ib["verbal_teaching_topics"])
lr = sum(b["teaching_classes"] for b in ib["lr_teaching_topics"])
di = sum(b["teaching_classes"] for b in ib["di_teaching_topics"])
check("A1", "Quant base teaching = 114 (sum of 20 blocks)", 114, qb)
check("A2", "Quant higher maths = 37 (sum of 11 topics)", 37, hm)
check("A3", "Quant teaching = 151", 151, qb + hm)
check("A4", "Verbal teaching = 57 (6 blocks; 46 topic rows)", 57, f"{vb} / {vt}", vb == vt == 57)
check("A5", "LR teaching = 32 / DI teaching = 13", "32 / 13", f"{lr} / {di}", (lr, di) == (32, 13))
check("A6", "Locked teaching baseline = 253", 253, qb + hm + vb + lr + di)
check("A7", "Quant subtopic allocations sum to block counts", "20/20", f"{sum(b['subtopics_sum_matches'] for b in ib['quant_teaching_blocks'])}/20",
      all(b["subtopics_sum_matches"] for b in ib["quant_teaching_blocks"]))
pa = ib["practice_allocations_programme_level"]
lrp = sum(x["practice_classes"] or 0 for x in pa["lr_practice"])
dip = sum(x["practice_classes"] for x in pa["di_practice"])
check("A8", "Programme allocation 360 = 253 + 53 Quant + 28 Verbal + 18 LR + 8 DI practice", 360, 253 + 53 + pa["verbal_practice"] + lrp + dip)
check("A9", "Quant base practice rows: stated 38, actual sum 36 (source's own correction)", "38 stated / 36 actual",
      f"{pa['quant_practice_base_rows_stated_total']} / {pa['quant_practice_base_rows_actual_sum']}",
      (pa["quant_practice_base_rows_stated_total"], pa["quant_practice_base_rows_actual_sum"]) == (38, 36))
fm = ib["assessments"]["full_mocks"]
check("A10", "Full mocks: 50 IIM-focused (Indore 15, Rohtak 10, JIPMAT 10, IIMB 8, IIMK 7); workbook still lists 70", "50 (of 70)",
      f"{fm['active_iim_focused_total']} (of {fm['workbook_total']})", (fm["active_iim_focused_total"], fm["workbook_total"]) == (50, 70))
ct = ib["assessments"]["chapter_tests"]
check("A11", "Chapter tests 70 = Quant 25 + Verbal 28 + LR 11 + DI 6", 70, ct["quant"] + ct["verbal"] + ct["lr"] + ct["di"])
check("A12", "IIMB exam date flagged unverified", "unverified", ib["calendar"]["iimb_exam_date_status"])

# ---------------------------------------------------------------- Class 12 plan
c = J("academic/class12-plan.json")
L = c["lessons"]
bysub = {s: sum(l["subject"] == s for l in L) for s in ("Quant", "Verbal", "LR", "DI")}
teach = sum(l["session"] == "teaching" for l in L)
check("B1", "Class 12 lessons = 305 (253 teaching + 52 practice)", "305 (253+52)", f"{len(L)} ({teach}+{len(L) - teach})", (len(L), teach) == (305, 253))
check("B2", "Class 12 by subject Quant 178 / Verbal 70 / LR 39 / DI 18", "178/70/39/18", "/".join(str(bysub[s]) for s in bysub),
      [bysub[s] for s in bysub] == [178, 70, 39, 18])
check("B3", "Class 12 hours = 305 x 75 / 60 = 381.25", 381.25, sum(l["planned_minutes"] for l in L) / 60)
o = ib["class12_override"]["totals"]
check("B4", "ipmat-baseline Class 12 override totals match lesson rows", "match", "match" if (o["quant"]["total"], o["verbal"]["total"], o["lr"]["total"], o["di"]["total"], o["total"]["total"]) == (178, 70, 39, 18, len(L)) else "mismatch")
cells = {x["cell"]: x for x in c["capacity_math"]["cells"]}
g = cells["'Assessment budget'!B30"]["value"]
check("B5", "Gross pre-IIMB slots 345 = 157 days x 2 + 31 third classes (B30)", 345, g, g == 345 == cells["'Assessment budget'!B28"]["value"] * 2 + cells["'Assessment budget'!B29"]["value"])
ex = sum(x["excluded_slots"] for x in c["exclusions"])
check("B6", "Exclusions 28 slots (5 holiday + 5 school-exam days)", "28 (5+5)", f"{ex} ({sum(x['holiday_days'] for x in c['exclusions'])}+{sum(x['school_exam_days'] for x in c['exclusions'])})", ex == 28)
net = cells["'Assessment budget'!B52"]["value"]
check("B7", "Net slots 317 = 345 - 28 (B52)", 317, net, net == g - ex == 317)
check("B8", "Headroom after exclusions 12 = 317 - 305 (B35)", 12, cells["'Assessment budget'!B35"]["value"], cells["'Assessment budget'!B35"]["value"] == net - len(L) == 12)
mtot = [m for m in c["monthly_allocation"] if m["Month"] == "Total"][0]
check("B9", "Monthly allocation total slots = 305 and third-class slots = 31", "305 / 31", f"{mtot['Total slots']} / {mtot['Third-class slots']}", (mtot["Total slots"], mtot["Third-class slots"]) == (305, 31))
T = c["chapter_tests"]
tsub = {s: sum(t["subject"] == s for t in T) for s in ("Quant", "Verbal", "LR", "DI")}
check("B10", "Chapter tests 70: Quant 25 / Verbal 28 / LR 11 / DI 6", "70: 25/28/11/6", f"{len(T)}: " + "/".join(str(v) for v in tsub.values()), (len(T), list(tsub.values())) == (70, [25, 28, 11, 6]))
th = sum(t["test_minutes"] + t["discussion_minutes"] for t in T) / 60
check("B11", "Chapter test + discussion hours = 85.75", 85.75, th)
after15 = sorted(t["test_id"] for t in T if t["saturday_test_date"] > "2027-10-15")
by_nov10 = sum(t["saturday_test_date"] <= "2027-11-10" for t in T)
check("B12", "Tests after the 15 Oct teaching target (overlap mock phase) = 12", 12, len(after15))
check("B13", "Tests done by 15 Oct = 58; by 10 Nov = 69", "58 / 69", f"{len(T) - len(after15)} / {by_nov10}", (len(T) - len(after15), by_nov10) == (58, 69))
last = max(T, key=lambda t: t["saturday_test_date"])
check("B14", "Last paper VT14-B on Sat 13 Nov, discussion Sun 14 Nov 2027 (= provisional IIMB date)", "VT14-B 2027-11-13/14",
      f"{last['test_id']} {last['saturday_test_date']}/{last['sunday_discussion_date'][-2:]}", (last["test_id"], last["sunday_discussion_date"]) == ("VT14-B", "2027-11-14"))
wk = c["weekend_map"]
over = [w for w in wk if w["total_minutes"] > w["weekend_cap_minutes"]]
check("B15", "No weekend exceeds the 210-minute cap (33 weekends)", "0 over cap", f"{len(over)} over cap / {len(wk)} weekends", not over and len(wk) == 33)
check("B16", "Every lesson status is 'planned' and has no actual delivery data", "305 planned", sum(l["status"] == "planned" and l["actual_minutes"] is None and l["actual_date"] is None for l in L), sum(l["status"] == "planned" and l["actual_minutes"] is None and l["actual_date"] is None for l in L) == 305)

# ---------------------------------------------------------------- concept books
cb = J("academic/concept-books.json")
counts = {b["book_id"]: b["chapter_count"] for b in cb["records"]}
check("C1", "Concept books 133 = B1 18 + B2 38 + B3 11 + B4 26 + B5 17 + B6 23 (+ B2 Foundations opening unit)", "133: 18/38/11/26/17/23 +1",
      f"{sum(counts.values())}: " + "/".join(str(v) for v in counts.values()) + f" +{sum(1 for b in cb['records'] if b['opening_unit'])}",
      (sum(counts.values()), list(counts.values())) == (133, [18, 38, 11, 26, 17, 23]))
cr = cb["cr_question_bank"]
b5 = [b for b in cb["records"] if b["book_id"] == "B5"][0]["chapters"]
sizes = sorted(ch["planned_questions"]["total"] for ch in b5)
check("C2", "CR bank 1,150 = 220 concept + 575 practice + 355 Ranker's Zone", "1150 = 220+575+355", f"{cr['total']} = {cr['concept_building']}+{cr['practice_application']}+{cr['rankers_zone']}",
      cr["total"] == 1150 == cr["concept_building"] + cr["practice_application"] + cr["rankers_zone"] and (cr["concept_building"], cr["practice_application"], cr["rankers_zone"]) == (220, 575, 355))
check("C3", "CR chapters: 7 x 50 + 10 x 80 (row sums equal 1,150)", "7x50 + 10x80", f"{sizes.count(50)}x50 + {sizes.count(80)}x80 = {sum(sizes)}", (sizes.count(50), sizes.count(80), sum(sizes)) == (7, 10, 1150))
check("C4", "Every CR count tagged planned, written = 0", "17/17", f"{sum(ch['planned_questions']['count_status'] == 'planned' and ch['planned_questions']['written'] == 0 for ch in b5)}/17",
      all(ch["planned_questions"]["count_status"] == "planned" and ch["planned_questions"]["written"] == 0 for ch in b5))
qm = cb["quant_higher_maths_question_model"]
check("C5", "Quant/Higher Maths mapping flagged unrecoverable (4,470 + 1,220 = 5,690; mapping null)", "unrecoverable, 5690",
      f"{qm['mapping_status']}, {qm['quants_total'] + qm['higher_maths_total']}", qm["mapping_status"] == "unrecoverable" and qm["chapter_to_category_mapping"] is None and qm["combined_total"] == 5690)

# ---------------------------------------------------------------- CA Foundation
ca = J("academic/ca-foundation-accountancy.json")
s = ca["summary"]
check("D1", "CA Accountancy: 11 chapters / 46 blocks", "11 / 46", f"{s['chapters']} / {s['topic_blocks']}", (s["chapters"], s["topic_blocks"]) == (11, 46))
check("D2", "CA hours 98 explanation + 52 practice = 150", "98+52=150", f"{s['teaching_hours']}+{s['practice_hours']}={s['teaching_plus_practice_hours']}",
      (s["teaching_hours"], s["practice_hours"], s["teaching_plus_practice_hours"]) == (98, 52, 150))
check("D3", "CA tests 12 h + discussions 13 h; first-pass student hours 175", "12 + 13; 175", f"{s['chapter_test_hours']:g} + {s['discussion_hours']:g}; {s['teaching_plus_practice_hours'] + s['chapter_test_hours'] + s['discussion_hours']:g}",
      (s["chapter_test_hours"], s["discussion_hours"], s["teaching_plus_practice_hours"] + s["chapter_test_hours"] + s["discussion_hours"]) == (12, 13, 175))
check("D4", "CA plan .md matches Operations workbook topic + test hours", "0 mismatches",
      f"{len(s['workbook_cross_check']['topic_hour_mismatches'])} topic / {len(s['workbook_cross_check']['test_hour_mismatches'])} test",
      not s["workbook_cross_check"]["topic_hour_mismatches"] and not s["workbook_cross_check"]["test_hour_mismatches"])

# ---------------------------------------------------------------- online accountancy
oa = J("academic/online-class12-accountancy.json")
check("E1", "Online Accountancy CBSE chapter hours sum = 118 (14 chapters)", "118 (14)", f"{sum(r['cbse_teaching_hours'] for r in oa['records'])} ({len(oa['records'])})",
      sum(r["cbse_teaching_hours"] for r in oa["records"]) == 118)
bu = oa["build_up"]
check("E2", "Online Accountancy build-up 118+4+40+30+13+21 = 226 h (60-min classes)", 226, sum(x["add_hours"] for x in bu), sum(x["add_hours"] for x in bu) == bu[-1]["running_total"] == 226)
check("E3", "Four other online subjects not started", 4, sum(x["status"] == "not_started" for x in oa["subjects"]))

# ---------------------------------------------------------------- marketing
ac = J("marketing/accounts.json")
codes = [r["code"] for r in ac["records"]]
check("M1", "Account codes match CLAUDE.md (10 codes; 9 approved + IGN later)", "LI LIP IGC YTC IGU YTU IGI YTI IGS IGN", " ".join(sorted(codes)),
      sorted(codes) == sorted(["LI", "LIP", "IGC", "YTC", "IGU", "YTU", "IGI", "YTI", "IGS", "IGN"]) and len(ac["summary"]["approved_structure_codes"]) == 9)
check("M2", "Metricool brands = 6", 6, len(ac["summary"]["metricool_brands"]))
check("M3", "Only confirmed handle is @elevate.clat (others null, never invented)", "@elevate.clat", ", ".join(r["handle"] for r in ac["records"] if r["handle"]))
idea = J("marketing/ideas.json")
check("M4", "ideas.json holds every ideas.csv row (doc says 'about 56')", "about 56 (CSV: 59)", len(idea["records"]), len(idea["records"]) == 59)
dg = sorted(g["legacy_id"] for g in idea["duplicate_groups"])
check("M5", "Duplicate legacy IDs = CLAT-027, COM-005, CUET-002, GEN-012", "CLAT-027 COM-005 CUET-002 GEN-012", " ".join(dg), dg == ["CLAT-027", "COM-005", "CUET-002", "GEN-012"])
props = [r["proposed_code"] for r in idea["records"] if r["proposed_code"]]
legacy = {r["legacy_id"] for r in idea["records"]}
check("M6", "Proposed codes unique, not colliding with legacy IDs, status proposed_renumbering", "4 unique", f"{len(set(props))} unique: {props}",
      len(set(props)) == 4 and not set(props) & legacy and all(r["proposed_code_status"] == "proposed_renumbering" for r in idea["records"] if r["proposed_code"]))
pl = J("marketing/placements.json")
check("M7", "Placements: 36 rows, all idea IDs exist, codes match account slugs", "36 / all / all",
      f"{len(pl['records'])} / {sum(r['idea_exists'] for r in pl['records'])} / {sum(r['account_code_matches_slug'] for r in pl['records'])}",
      len(pl["records"]) == 36 and all(r["idea_exists"] and r["account_code_matches_slug"] for r in pl["records"]))
amb = sorted(r["version_id"] for r in pl["records"] if r["ambiguous"])
check("M8", "Ambiguous placements (point at duplicated IDs)", "CLAT-027-IGC, GEN-012-IGS", ", ".join(amb), amb == ["CLAT-027-IGC", "GEN-012-IGS"])
pa_ = J("marketing/post-audit.json")
vc = pa_["summary"]["verdict_counts"]
check("M9", "Post audit: 60 posts; 34 keep (2 pin) / 25 archive / 2 unpin", "60; 34(2)/25/2", f"{pa_['summary']['posts']}; {vc['keep']}({vc['keep_and_pin']})/{vc['archive_only']}/{vc['unpin']}",
      (pa_["summary"]["posts"], vc["keep"], vc["keep_and_pin"], vc["archive_only"], vc["unpin"]) == (60, 34, 2, 25, 2))
check("M10", "Boosted reels 13, ~2.9M views, ~250 likes", "13; ~2.9M; ~250",
      f"{pa_['summary']['likely_boosted_posts']}; {pa_['summary']['likely_boosted_views_total']:,}; {pa_['summary']['likely_boosted_likes_total']}",
      pa_["summary"]["likely_boosted_posts"] == 13 and 2_850_000 <= pa_["summary"]["likely_boosted_views_total"] <= 2_999_999 and 240 <= pa_["summary"]["likely_boosted_likes_total"] <= 260)
rules = J("marketing/content-rules.json")["records"]
bad_rx = []
for r in rules:
    m = r["matcher"]
    if m and m["type"] == "regex":
        try:
            re.compile(m["pattern"], re.I)
        except re.error as e:
            bad_rx.append(f"{r['id']}: {e}")
kinds = sorted({r["kind"] for r in rules})
check("M11", "Content rules: all 4 kinds present, regexes compile, manual_check where matcher null", "4 kinds, 0 bad",
      f"{len(kinds)} kinds ({len(rules)} rules), {len(bad_rx)} bad",
      kinds == ["banned_phrase", "channel_rule", "consent", "requires_approval"] and not bad_rx and all((r["matcher"] is None) == r["manual_check"] for r in rules))
probe = {"CR-002": "Ex-Deloitte, ex RP Mody & Co", "CR-009": "CA vs CLAT: which is better?", "CH-001": "Great day #parenting", "CR-012": "NMIMS Rank 2", "CR-014": "44 lakh commerce students"}
hits = sum(bool(re.search([r for r in rules if r["id"] == k][0]["matcher"]["pattern"], v, re.I)) for k, v in probe.items())
check("M12", "Banned-phrase regexes fire on known-bad samples", f"{len(probe)}/{len(probe)}", f"{hits}/{len(probe)}", hits == len(probe))
mf = J("marketing/metrics-csv-formats.json")
check("M13", "Metrics CSV formats: instagram + youtube", "instagram, youtube", ", ".join(r["platform"] for r in mf["records"]))

# ---------------------------------------------------------------- ops
dp = J("ops/departments.json")
check("O1", "13-department architecture", 13, len(dp["records"]))
ow = J("ops/operations-workbook.json")
sh = {s["sheet"]: s for s in ow["records"]}
check("O2", "Operations workbook: 10 sheets", "Dashboard, Work Inventory, Decisions, Batch Register, Accountancy Plan, Teaching Log, Test Tracker, Catch-up Log, SOP Register, Guide",
      ", ".join(sh), list(sh) == ["Dashboard", "Work Inventory", "Decisions", "Batch Register", "Accountancy Plan", "Teaching Log", "Test Tracker", "Catch-up Log", "SOP Register", "Guide"])
dash = {x["cell"]: x for x in sh["Dashboard"]["cells"]}
check("O3", "Ops Dashboard cached: processes 25, open decisions 8, baseline h 150, topics 46, student h 175", "25/8/150/46/175",
      "/".join(str(dash[k]["value"]) for k in ("B5", "B6", "B7", "B10", "B16")), [dash[k]["value"] for k in ("B5", "B6", "B7", "B10", "B16")] == [25, 8, 150, 46, 175])
check("O4", "Work Inventory 25 rows; Decisions 24 rows (8 Open); Accountancy Plan 46 rows", "25 / 24 (8) / 46",
      f"{len(sh['Work Inventory']['rows'])} / {len(sh['Decisions']['rows'])} ({sum(r['Status'] == 'Open' for r in sh['Decisions']['rows'])}) / {len(sh['Accountancy Plan']['rows'])}",
      (len(sh["Work Inventory"]["rows"]), len(sh["Decisions"]["rows"]), sum(r["Status"] == "Open" for r in sh["Decisions"]["rows"]), len(sh["Accountancy Plan"]["rows"])) == (25, 24, 8, 46))
check("O5", "Teaching Log / Catch-up Log hold no delivery rows", "0 / 0", f"{len(sh['Teaching Log']['rows'])} / {len(sh['Catch-up Log']['rows'])}",
      not sh["Teaching Log"]["rows"] and not sh["Catch-up Log"]["rows"])
ro = J("ops/roles.json")
check("O6", "12 online role labels (labels != hires)", 12, len(ro["records"]))
tr = J("ops/trackers.json")
onl = [w for w in tr["records"] if w["workbook"].endswith("Elevate-Online-Easy.xlsx")][0]
act = [s for s in onl["sheets"] if s["sheet"] == "Actions"][0]
check("O7", "Online Easy Actions: 200 prepared rows, 10 populated setup actions", "200 / 10", f"{act['data_rows_prepared']} / {len(act['rows'])}", (act["data_rows_prepared"], len(act["rows"])) == (200, 10))
me = [w for w in tr["records"] if w["workbook"].endswith("Elevate-Marketing-Easy.xlsx")][0]
cont = [s for s in me["sheets"] if s["sheet"] == "Content"][0]
check("O8", "Marketing Easy Content: 200 reserved IDs EE-001..EE-200, no posts", "200 EE-001..EE-200",
      f"{cont['placeholder_rows']['count']} {cont['placeholder_rows']['id_first']}..{cont['placeholder_rows']['id_last']}", cont["placeholder_rows"]["count"] == 200)
wf = {r["id"]: r for r in J("ops/workflows.json")["records"]}
d = wf["WF-DEMO"]["terms"]
check("O9", "Demo: 2 days, INR 1,000 adjusted on joining (approved)", "2 / 1000 / approved", f"{d['days']} / {d['fee_inr']} / {wf['WF-DEMO']['status']}",
      (d["days"], d["fee_inr"], d["adjusted_against_fees_on_joining"], wf["WF-DEMO"]["status"]) == (2, 1000, True, "approved"))
check("O10", "Absence call 15 min: offline approved, online proposed; monthly report proposed", "approved / proposed / proposed",
      f"{wf['WF-ATTENDANCE-OFFLINE']['status']} / {wf['WF-ABSENCE-ONLINE']['status']} / {wf['WF-MONTHLY-REPORT']['status']}",
      (wf["WF-ATTENDANCE-OFFLINE"]["status"], wf["WF-ABSENCE-ONLINE"]["status"], wf["WF-MONTHLY-REPORT"]["status"]) == ("approved", "proposed", "proposed"))
sop = J("ops/sops.json")["records"][0]
check("O11", "Coordinator SOP is a draft with null owner/backup", "draft, null, null", f"{sop['status']}, {sop['owner']}, {sop['backup']}", (sop["status"], sop["owner"], sop["backup"]) == ("draft", None, None))

# ---------------------------------------------------------------- report
w = [max(len(r[i]) for r in RESULTS) for i in range(4)]
w = [min(x, m) for x, m in zip(w, (4, 92, 40, 46))]
print(f"{'ID':<4} {'Check':<{w[1]}} | {'Doc/expected':<{w[2]}} | {'Actual':<{w[3]}} | Result")
print("-" * (sum(w) + 25))
for cid, what, doc, act, ok in RESULTS:
    print(f"{cid:<4} {what[:w[1]]:<{w[1]}} | {doc[:w[2]]:<{w[2]}} | {act[:w[3]]:<{w[3]}} | {'PASS' if ok else 'FAIL'}")
fails = [r for r in RESULTS if not r[4]]
print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} checks passed")
for f in fails:
    print("FAIL", f[0], f[1], "| doc:", f[2], "| actual:", f[3])
sys.exit(1 if fails else 0)
