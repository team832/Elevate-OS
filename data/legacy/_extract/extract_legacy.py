"""Extract legacy Elevate planning material into provenance-tagged JSON.

Run (isolated mode, so nothing next to the sources can be imported):

    python -I data/legacy/_extract/extract_legacy.py [--content-os DIR] [--handover DIR] [--out DIR]

Defaults:
  --content-os  C:/OPENBOT/OLD/01-original-elevate-os        (read-only legacy content OS)
  --handover    C:/OPENBOT/OLD/02-operations-handover-extracted/Elevate-Education  (extracted from
                content-os/Elevate-Education-Agent-Handover-2026-10-15.zip, member prefix
                "Elevate-Education/")
  --out         the data/legacy folder that contains this script's parent folder

Never writes to the source folders. All personal names are redacted to role labels in a final
pass (see REDACTIONS) and verify.py re-checks the outputs for leaks.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

EXTRACTED_AT = "2026-10-17"
HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent
DEFAULT_CONTENT_OS = Path(r"C:/OPENBOT/OLD/01-original-elevate-os")
DEFAULT_HANDOVER = Path(
    r"C:/OPENBOT/OLD/02-operations-handover-extracted/Elevate-Education"
)

ap = argparse.ArgumentParser()
ap.add_argument("--content-os", default=str(DEFAULT_CONTENT_OS))
ap.add_argument("--handover", default=str(DEFAULT_HANDOVER))
ap.add_argument("--out", default=str(DEFAULT_OUT))
ARGS = ap.parse_args()
ROOTS = {"content-os": Path(ARGS.content_os), "handover": Path(ARGS.handover)}
OUT = Path(ARGS.out)

# --------------------------------------------------------------------------------------------
# Privacy: every string in every output passes through redact(). Order matters (longest first).
# Names are replaced by role labels; personal handles/URLs by a marker. The mapping itself is
# NOT stored anywhere in data/legacy (see _private/README.md).
# --------------------------------------------------------------------------------------------
REDACTIONS: list[tuple[str, str]] = [
    # folder slugs that embed the founder's first name (keep provenance resolvable)
    (r"linkedin-nikunj", "linkedin-{founder}"),
    (r"instagram-nikunj", "instagram-{founder}"),
    (r"nikunj-photo", "{founder}-photo"),
    # personal handles / profile URLs
    (r"@nikunjbindal99|@canikunjbindal|@nikunj\.bindal|@nikunjbindal\.ca", "[personal handle redacted]"),
    (r"linkedin\.com/in/nikunj-bindal", "[personal profile URL redacted]"),
    (r"@sushantbindal", "[personal handle redacted]"),
    (r"/Users/sushant", "/Users/[redacted]"),
    # names -> role labels
    (r"CA Nikunj Bindal", "[founder]"),
    (r"Nikunj Bindal", "[founder]"),
    (r"Nikunj['’]s", "[founder]'s"),
    (r"\bNikunj\b", "[founder]"),
    (r"Sushant Bindal", "[staff:former_presenter]"),
    (r"\bSushant\b", "[staff:former_presenter]"),
    (r"\bBindal\b", "[founder-family]"),
    (r"Soma Ma['’]am", "[faculty:current_affairs]"),
    (r"\bSoma\b", "[faculty:current_affairs]"),
    (r"Saumya Ma['’]am", "[faculty:logical_reasoning]"),
    (r"\bSaumya\b", "[faculty:logical_reasoning]"),
    (r"Tushar Bhagtay Sir|Tushar Sir|\bTushar\b", "[faculty:english_verbal]"),
    (r"Satish Sir|\bSatish\b|\bSaty\b", "[faculty:quant]"),
    (r"Geetanjali Bagaria", "[student]"),
    (r"Varun Soni", "[guest expert]"),
    # third-party faculty names embedded in a reference URL (Operations workbook Guide!B15)
    (r"https://web\.vsmartacademy\.com/\S+", "https://web.vsmartacademy.com/[URL path redacted: contains third-party faculty names]"),
]
_RED = [(re.compile(p), r) for p, r in REDACTIONS]
PHONE = re.compile(r"(?<![\w/.-])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\w/.-])")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def redact(s: str) -> str:
    for rx, rep in _RED:
        s = rx.sub(rep, s)
    s = PHONE.sub("[phone redacted]", s)
    s = EMAIL.sub("[email redacted]", s)
    return s


def redact_tree(o):
    if isinstance(o, str):
        return redact(o)
    if isinstance(o, list):
        return [redact_tree(x) for x in o]
    if isinstance(o, dict):
        return OrderedDict((redact(k) if isinstance(k, str) else k, redact_tree(v)) for k, v in o.items())
    return o


# --------------------------------------------------------------------------------------------
# Provenance helpers
# --------------------------------------------------------------------------------------------
CTX: set[str] = set()  # source files touched by the output currently being built
ALL_SOURCES: set[str] = set()
_TEXT: dict[str, list[str]] = {}


def touch(key: str, rel: str) -> str:
    p = f"{key}/{rel}"
    CTX.add(p)
    ALL_SOURCES.add(p)
    return p


def abspath(key: str, rel: str) -> Path:
    return ROOTS[key] / rel


def lines(key: str, rel: str) -> list[str]:
    p = touch(key, rel)
    if p not in _TEXT:
        _TEXT[p] = abspath(key, rel).read_text(encoding="utf-8").splitlines()
    return _TEXT[p]


def S(key: str, rel: str, locator: str | None = None) -> dict:
    return {"path": touch(key, rel), "locator": locator}


def L(key: str, rel: str, needle: str, nth: int = 1) -> dict:
    """Source pointer to the line containing `needle` (1-based). Raises if not found."""
    ls = lines(key, rel)
    hits = [i for i, t in enumerate(ls) if needle in t]
    if len(hits) < nth:
        raise KeyError(f"needle not found in {key}/{rel}: {needle!r}")
    i = hits[nth - 1]
    return {"path": f"{key}/{rel}", "locator": f"line {i + 1}"}


def LT(key: str, rel: str, needle: str, nth: int = 1) -> tuple[dict, str]:
    src = L(key, rel, needle, nth)
    n = int(src["locator"].split()[1])
    return src, lines(key, rel)[n - 1].strip()


def X(rel: str, sheet: str, rng: str, key: str = "handover") -> dict:
    return {"path": touch(key, rel), "locator": f"sheet '{sheet}'!{rng}"}


_WB: dict[tuple[str, bool], openpyxl.Workbook] = {}


def wb(rel: str, data_only: bool, key: str = "handover"):
    touch(key, rel)
    k = (rel, data_only)
    if k not in _WB:
        _WB[k] = openpyxl.load_workbook(abspath(key, rel), data_only=data_only)
    return _WB[k]


def jsonable(v):
    if isinstance(v, dt.datetime):
        if v.hour == v.minute == v.second == 0:
            return v.date().isoformat()
        return v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def write(rel_out: str, meta_notes: list[str], body: dict, record_arrays: list[str]):
    meta = OrderedDict(
        source_files=sorted(CTX),
        extracted_at=EXTRACTED_AT,
        extractor="data/legacy/_extract/extract_legacy.py",
        record_arrays=record_arrays,
        notes=meta_notes,
    )
    doc = OrderedDict(meta=meta)
    doc.update(body)
    doc = redact_tree(doc)
    p = OUT / rel_out
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    p.write_text(text, encoding="utf-8")
    json.loads(text)  # validate
    counts = {k: len(resolve(doc, k)) for k in record_arrays}
    print(f"wrote {rel_out}: {counts}")
    CTX.clear()


def resolve(doc, dotted: str):
    o = doc
    for part in dotted.split("."):
        o = o[part]
    if not isinstance(o, list):
        raise TypeError(f"record array {dotted} is not a list")
    return o


def md_tables(key: str, rel: str):
    """Parse pipe tables. Returns list of dicts: heading, heading_line, header, rows[(lineno, cells)]."""
    ls = lines(key, rel)
    out, heading, hline, i = [], None, None, 0
    while i < len(ls):
        t = ls[i]
        if t.startswith("#"):
            heading, hline = t.lstrip("#").strip(), i + 1
        if t.startswith("|"):
            header = [c.strip() for c in t.strip().strip("|").split("|")]
            rows = []
            j = i + 1
            if j < len(ls) and re.match(r"^\|[\s:|-]+\|?$", ls[j].strip()):
                j += 1
            while j < len(ls) and ls[j].startswith("|"):
                rows.append((j + 1, [c.strip() for c in ls[j].strip().strip("|").split("|")]))
                j += 1
            out.append({"heading": heading, "heading_line": hline, "start_line": i + 1, "header": header, "rows": rows})
            i = j
            continue
        i += 1
    return out


def num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").replace("*", "").strip()
    if s == "":
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


# Controlled vocabulary mapping for statuses written in the sources
SOURCE_STATUS_MAP = {
    "confirmed": "approved",
    "locked": "locked",
    "proposed": "proposed",
    "proposal": "proposed",
    "discussed": "documented",
    "planned": "planned",
    "planning": "planned",
    "open": "open",
    "provisional": "provisional",
    "user confirmed": "documented",
    "pending verification": "unverified",
    "locked / verify setup": "locked",
    "implementation detail": "proposed",
    "pending limits": "open",
    "operating control": "documented",
    "not drafted": "not_started",
    "to draft": "not_started",
    "not started": "not_started",
}


def norm_status(s: str | None) -> str | None:
    if s is None:
        return None
    return SOURCE_STATUS_MAP.get(str(s).strip().lower(), re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_"))


# ============================================================================================
# MARKETING
# ============================================================================================
ACCOUNT_SLUG_TO_CODE = {
    "linkedin-nikunj": "LI",
    "linkedin-elevate": "LIP",
    "instagram-clat": "IGC",
    "youtube-clat": "YTC",
    "instagram-cuet12": "IGU",
    "youtube-cuet12": "YTU",
    "instagram-ipmat": "IGI",
    "youtube-ipmat": "YTI",
    "instagram-sikar": "IGS",
    "instagram-nikunj": "IGN",
}
BASE_CODES = set(ACCOUNT_SLUG_TO_CODE.values())


def build_accounts():
    C = "content-os"
    rd = lambda slug: f"accounts/{slug}/README.md"
    claude_codes = L(C, "CLAUDE.md", "| `-LI` | LinkedIn")
    structure = L(C, "CLAUDE.md", "## Accounts (final, 6 Oct 2026) = 9 accounts, 6 Metricool brands")
    collab_src = L(C, "CLAUDE.md", "**Collab rule:**")
    plan = "plans/team-and-volume-oct-dec-2026.md"
    plan_status = L(C, plan, "PROPOSED 6 Oct 2026")
    handoff_names = L(C, "HANDOFF.md", "| Page | Handle (suggested) | Display name")

    def team(needle):
        src, line = LT(C, plan, needle)
        cells = [c.strip() for c in line.strip("|").split("|")]
        return {"posts_per_week": cells[1] or None, "formats": cells[2] or None, "on_camera": cells[3] or None,
                "status": "proposed", "source": src}

    recs = []

    def add(**k):
        k.setdefault("handle", None)
        k.setdefault("proposed_handle", None)
        k.setdefault("proposed_display_name", None)
        recs.append(OrderedDict(k))

    # IGC
    add(code="IGC", legacy_slug="instagram-clat", platform="instagram", exam_or_scope="CLAT",
        display_name="Elevate Law School | CLAT Prep", display_name_status="approved",
        handle="@elevate.clat", handle_status="confirmed_live",
        audience="Class 11-12 commerce students considering law, and their parents",
        job="own CLAT for commerce families",
        cadence="6 posts/week (one per CLAT section + strategy) + stories",
        content_rules=["Reels 20-45 s, hook on screen in the first second",
                       "No CA vs CLAT comparisons (rejected 6 Oct 2026)", "Countdown to 6 Dec 2026",
                       "Hinglish", "No result/topper claims (year one)",
                       "Pure exam content solo; comparisons/every-path content as Collab"],
        status="active", legacy_status="live", metricool_brand="Elevate CLAT", exam_page=True,
        team_plan=team("| Elevate CLAT · IG |"),
        source=[L(C, rd("instagram-clat"), "# Instagram: Elevate CLAT"),
                L(C, rd("instagram-clat"), "**Cadence:** 6 posts/week"),
                L(C, "accounts/instagram-clat/PROFILE.md", "| Username | **@elevate.clat**"),
                L(C, "accounts/instagram-clat/PROFILE.md", "| Name (30 characters, searchable)"), claude_codes])
    add(code="YTC", legacy_slug="youtube-clat", platform="youtube", exam_or_scope="CLAT",
        display_name=None, display_name_status="proposed",
        proposed_display_name="Elevate Law School | CLAT Prep",
        handle_status="tbd", proposed_handle="@elevate.clat (fallback @elevateclat)",
        audience=None, job="CLAT search + trust", cadence="1 long video + 3-4 Shorts a week",
        content_rules=["Long-form from courses/clat/intel.md '15 search titles'",
                       "No CA vs CLAT comparisons (rejected 6 Oct 2026)",
                       "Exam-day analysis live on 6 Dec 2026 within 1-2 h", "Titles: exam + year + intent"],
        status="active", legacy_status="live", metricool_brand="Elevate CLAT", exam_page=True,
        team_plan=team("| Elevate CLAT · YT |"),
        notes=["README says handle TBD; channels.json still holds the placeholder '@REPLACE-WITH-OUR-HANDLE'. "
               "PROFILE.md is a setup specification, not confirmation that the channel uses that handle."],
        source=[L(C, rd("youtube-clat"), "# YouTube: Elevate CLAT"),
                L(C, rd("youtube-clat"), "**Cadence:** 1 long video"),
                L(C, "accounts/instagram-clat/PROFILE.md", "| Handle | **@elevate.clat** (same as Instagram"),
                S(C, "accounts/youtube-clat/channels.json", "line 1"), claude_codes])
    add(code="IGU", legacy_slug="instagram-cuet12", platform="instagram", exam_or_scope="Class 11-12 Commerce + CUET",
        display_name=None, display_name_status="proposed", proposed_display_name="Elevate Commerce & CUET",
        handle_status="tbd", proposed_handle="@elevate.commerce",
        audience="commerce students, parents", job="Class 11-12 Commerce boards + CUET (same syllabus)",
        cadence="4-5 posts/week + stories",
        content_rules=["Subject reels, board strategy, CUET subject choice, carousels", "Hinglish",
                       "Commerce and CUET are equal domains"],
        status="active", legacy_status="live", metricool_brand="Elevate CUET + 12th", exam_page=True,
        team_plan=team("| Elevate Commerce & CUET · IG |"),
        source=[L(C, rd("instagram-cuet12"), "# Instagram: Elevate CUET + Class 12"),
                L(C, rd("instagram-cuet12"), "**Cadence:** 4-5 posts/week"),
                L(C, "HANDOFF.md", "| Commerce + CUET | @elevate.commerce"), claude_codes])
    add(code="YTU", legacy_slug="youtube-cuet12", platform="youtube", exam_or_scope="Class 11-12 Commerce + CUET",
        display_name=None, display_name_status="unknown", handle_status="tbd",
        audience=None, job="board + CUET search", cadence="1 long + 3-4 Shorts a week",
        content_rules=["Angle: boards + the right entrance together, explained honestly"],
        status="active", legacy_status="live", metricool_brand="Elevate CUET + 12th", exam_page=True,
        team_plan=team("| Elevate Commerce & CUET · YT |"),
        notes=["channels.json still holds the placeholder '@REPLACE-WITH-OUR-HANDLE'."],
        source=[L(C, rd("youtube-cuet12"), "# YouTube: Elevate CUET + Class 12"),
                S(C, "accounts/youtube-cuet12/channels.json", "line 1"), claude_codes])
    add(code="IGI", legacy_slug="instagram-ipmat", platform="instagram", exam_or_scope="IPMAT",
        display_name=None, display_name_status="proposed", proposed_display_name="Elevate IPMAT | IIM Entrance",
        handle_status="tbd", proposed_handle="@elevate.ipmat",
        audience=None, job="own IPMAT for commerce families", cadence="4-5 posts/week + stories",
        content_rules=["Honest takes beat coaching content (courses/ipmat/intel.md)"],
        status="planned", legacy_status="starting", metricool_brand="Elevate IPMAT", exam_page=True,
        team_plan=team("| Elevate IPMAT · IG |"),
        source=[L(C, rd("instagram-ipmat"), "# Instagram: Elevate IPMAT"),
                L(C, "HANDOFF.md", "| IPMAT | @elevate.ipmat"), claude_codes])
    add(code="YTI", legacy_slug="youtube-ipmat", platform="youtube", exam_or_scope="IPMAT",
        display_name=None, display_name_status="unknown", handle_status="tbd",
        audience=None, job=None, cadence="1 long + 3-4 Shorts a week",
        content_rules=["Parent explainers are an empty space in the market"],
        status="planned", legacy_status="starting", metricool_brand="Elevate IPMAT", exam_page=True,
        team_plan=team("| Elevate IPMAT · YT |"),
        notes=["channels.json still holds the placeholder '@REPLACE-WITH-OUR-HANDLE'."],
        source=[L(C, rd("youtube-ipmat"), "# YouTube: Elevate IPMAT"),
                S(C, "accounts/youtube-ipmat/channels.json", "line 1"), claude_codes])
    add(code="IGS", legacy_slug="instagram-sikar", platform="instagram", exam_or_scope="Sikar centre (local)",
        display_name=None, display_name_status="proposed", proposed_display_name="Elevate Education Sikar",
        handle_status="tbd", proposed_handle="@elevate.sikar",
        audience="Sikar families and students", job="local presence for the Sikar centre",
        cadence=None,
        content_rules=["The ONE account where Sikar and the offline centre are the point",
                       "Classroom life, teachers, local events, admissions for the centre; local Hinglish/Hindi",
                       "No result/topper claims (year one)"],
        status="active", legacy_status="live", metricool_brand="Elevate Sikar", exam_page=False,
        team_plan=team("| Elevate Sikar · IG |"),
        notes=["Sikar has no YouTube channel (HANDOFF section 8)."],
        source=[L(C, rd("instagram-sikar"), "# Instagram: Elevate Education Sikar"),
                L(C, "HANDOFF.md", "| Sikar | @elevate.sikar"), claude_codes])
    add(code="LIP", legacy_slug="linkedin-elevate", platform="linkedin", exam_or_scope="Company page",
        display_name="ElevateEducation", display_name_status="documented",
        proposed_display_name="Elevate Education", handle_status="not_recorded",
        audience="parents, young professionals and founders (LinkedIn rule)",
        job="amplify the founder; the brand home",
        cadence="Same-day repost within 1-2 h of founder posts; native posts the day after; own posts (hiring, admissions news)",
        content_rules=["No results claims", "Scheduled through Metricool (brand: Elevate Education) once connected; manual reposts until then"],
        status="active", legacy_status="live", metricool_brand="Elevate Education", exam_page=False,
        team_plan=team("| LinkedIn · Elevate page |"),
        notes=["Page currently shows 'ElevateEducation'; rename to 'Elevate Education' is an open owner task (HANDOFF section 6)."],
        source=[L(C, rd("linkedin-elevate"), "# LinkedIn: Elevate Education"),
                L(C, rd("linkedin-elevate"), "Same-day repost"),
                L(C, "HANDOFF.md", "Fix \"ElevateEducation\""), claude_codes])
    add(code="LI", legacy_slug="linkedin-nikunj", platform="linkedin", exam_or_scope="Founder (personal profile)",
        display_name="[founder] (personal)", display_name_status="documented",
        handle_status="withheld_personal_data",
        audience="parents of Class 10-12 commerce students, young professionals, educators/founders",
        job="trust in the founder and the message",
        cadence="4 posts/week, max 1 a day",
        content_rules=["Never student exam tips", "No polls, no 'comment X', no hashtags",
                       "Formula: his mistake or cost -> a framework the reader can use -> one specific question",
                       "Mix (Oct-Nov): 8 text+photo, 4 short videos, 2 carousels, 2 text-only per 4 weeks",
                       "Timing test until 1 Nov 2026: 8:30am / 1:00pm / 8:00pm IST rotation",
                       "Scheduling: Taplio until 15 Oct 2026, then Metricool; only after the founder's yes"],
        status="active", legacy_status="live", metricool_brand="[founder] (personal LinkedIn brand)", exam_page=False,
        team_plan=team("| LinkedIn · Nikunj |"),
        notes=["The personal profile URL exists in the legacy README but is personal data and is not extracted.",
               "strategy.md, plan.md, log.md and voice.md in this folder are 38-43 byte stubs pointing to a Mac path; their content is not in the source."],
        source=[L(C, rd("linkedin-nikunj"), "# LinkedIn:"), L(C, rd("linkedin-nikunj"), "**Cadence:** 4 posts/week"),
                L(C, rd("linkedin-nikunj"), "**Scheduling:**"), claude_codes])
    add(code="IGN", legacy_slug="instagram-nikunj", platform="instagram", exam_or_scope="Founder (personal)",
        display_name=None, display_name_status="unknown", handle_status="withheld_personal_data",
        audience="parents and students", job="the founder's face and story",
        cadence="3 reels/week + stories (when started)",
        content_rules=["Collab posts with the exam pages when relevant", "Reels 20-45 s, hook as on-screen text in the first second",
                       "Bio never mentions NLSIU"],
        status="planned", legacy_status="later", metricool_brand=None, exam_page=False,
        team_plan=team("| Nikunj's personal IG |"),
        notes=["An existing personal handle and a rename recommendation (awaiting the founder's yes) are recorded in the legacy README; personal data, not extracted.",
               "Not one of the 9 approved accounts; CLAUDE.md lists its code as '(later)'. No Metricool brand stated."],
        source=[L(C, rd("instagram-nikunj"), "# Instagram:"), claude_codes])

    for r in recs:
        r["collab_rule_applies"] = r["exam_page"]
        r.move_to_end("source")

    conflicts = [OrderedDict(
        id="ACC-CONFLICT-001",
        description="The operations/marketing handover (Project B, Sept 2026) uses a different account model: Instagram pages "
                    "Elevate CA, Elevate CLAT, Elevate Sikar, Elevate Online and YouTube channels Elevate IPMAT, Elevate Commerce & CUET, "
                    "Elevate CLAT. 'Elevate CA' and 'Elevate Online' do not exist in the Content OS model approved 6 Oct 2026 "
                    "(which also forbids marketing CA as a course and labelling Elevate 'online').",
        status="unreconciled",
        accounts_in_other_model=["Elevate Sikar", "Elevate CA", "Elevate CLAT", "Elevate Online", "Elevate IPMAT", "Elevate Commerce & CUET"],
        source=[L("handover", "Claude.md", "Instagram has **four**, not three"),
                X("outputs/marketing-operations/Elevate-Marketing-Easy.xlsx", "Content", "B6:B205 (data validation)")])]

    body = OrderedDict(
        summary=OrderedDict(
            approved_structure="9 accounts, 6 Metricool brands (approved by the founder 6 Oct 2026)",
            approved_structure_codes=["IGC", "YTC", "IGU", "YTU", "IGI", "YTI", "IGS", "LIP", "LI"],
            later_codes=["IGN"],
            metricool_brands=sorted({r["metricool_brand"] for r in recs if r["metricool_brand"]}),
            version_suffix_rule="Placement/version ID = idea ID + '-' + account code; add 'S' for a YouTube Short (-YTCS) and 'L' for a long video (-YTCL) when one idea gets both.",
            collab_rule="Exam pages stay pure (solo); comparisons and 'every path' content = Instagram/YouTube Collab across the exam pages involved.",
            status="approved",
            source=[structure, collab_src, L("content-os", "CLAUDE.md", "Add `S` for a YouTube Short")],
        ),
        records=recs,
        conflicts=conflicts,
    )
    write("marketing/accounts.json",
          ["Handles are null unless the source records them as confirmed; suggested handles are in proposed_handle.",
           "status: active = legacy 'live'; planned = legacy 'starting' or 'later' (legacy_status keeps the raw word).",
           "team_plan comes from plans/team-and-volume-oct-dec-2026.md, which is PROPOSED (not approved)."],
          body, ["records", "conflicts"])


def build_ideas_and_placements():
    C = "content-os"
    rel = "tracker/ideas.csv"
    ls = lines(C, rel)
    rows = list(csv.reader(io.StringIO("\n".join(ls) + "\n")))
    header = rows[0]
    # map each csv record to its physical line (no embedded newlines in this file; asserted)
    assert len(rows) == len(ls), "ideas.csv has multi-line cells; line mapping would be wrong"
    by_id = defaultdict(list)
    for i, r in enumerate(rows[1:], start=2):
        by_id[r[0]].append(i)
    maxnum = defaultdict(int)
    for r in rows[1:]:
        m = re.match(r"([A-Z]+)-(\d+)$", r[0])
        maxnum[m.group(1)] = max(maxnum[m.group(1)], int(m.group(2)))
    # also reserve numbers referenced anywhere else in the content OS (none found for the proposals, re-checked here)
    proposed_next = dict(maxnum)
    proposals = {}
    for lid, lns in sorted(by_id.items(), key=lambda kv: kv[1][0]):
        if len(lns) > 1:
            prefix = lid.split("-")[0]
            for ln in lns[1:]:
                proposed_next[prefix] += 1
                proposals[ln] = f"{prefix}-{proposed_next[prefix]:03d}"
    # make sure no proposed code appears anywhere in the legacy content OS text files
    for code in proposals.values():
        for p in ROOTS[C].rglob("*"):
            if p.is_file() and p.suffix in {".md", ".csv", ".json", ".mjs"} and p.stat().st_size < 2_000_000:
                if code in p.read_text(encoding="utf-8", errors="ignore"):
                    raise SystemExit(f"proposed code {code} already referenced in {p}")

    library_dirs = {p.name for p in (ROOTS[C] / "library").iterdir() if p.is_dir()}
    recs = []
    for ln, r in enumerate(rows[1:], start=2):
        d = dict(zip(header, r))
        dup = len(by_id[d["id"]]) > 1
        occ = by_id[d["id"]].index(ln) + 1
        rec = OrderedDict(
            legacy_id=d["id"],
            title=d["title"],
            course=d["course"],
            pillar=d["pillar"] or None,
            origin=d["source"] or None,
            master_asset=d["master_asset"] or None,
            legacy_status=d["status"],
            status=norm_status(d["status"]),
            notes=d["notes"] or None,
            duplicate_of_legacy_id_group=(d["id"] if dup else None),
            duplicate_occurrence=(occ if dup else None),
            proposed_code=None,
            proposed_code_status=None,
            library_folders=sorted(x for x in library_dirs if x.startswith(d["id"] + "-")),
            source=S(C, rel, f"line {ln}"),
        )
        if dup and occ > 1:
            rec["proposed_code"] = proposals[ln]
            rec["proposed_code_status"] = "proposed_renumbering"
        if dup:
            rec["library_folders_note"] = ("Library folder names use the legacy ID and cannot tell the two ideas apart; "
                                           "check folder content before renaming.")
        recs.append(rec)

    # duplicate groups with evidence
    groups = []
    hints = {
        "CLAT-027": ("first", "versions.csv CLAT-027-IGC notes 'student + parent OK' and reports/2026-10-11-next-week-plan.md line 35 describe the student-voice reel (first occurrence)."),
        "GEN-012": ("first", "versions.csv GEN-012-IGS (Sikar, 'consent for faces') matches the mock-test-day reel (first occurrence); library/GEN-012-big4-scoreboards/ holds the second occurrence's script."),
        "CUET-002": (None, "No placement row references CUET-002."),
        "COM-005": (None, "No placement row references COM-005."),
    }
    for lid, lns in by_id.items():
        if len(lns) > 1:
            groups.append(OrderedDict(
                legacy_id=lid,
                occurrences=[OrderedDict(line=ln, title=rows[ln - 1][1], proposed_code=proposals.get(ln)) for ln in lns],
                rule_broken="Next number = the highest in ideas.csv + 1 (CLAUDE.md)",
                status="proposed_renumbering",
                resolution_hint=hints.get(lid, (None, None))[1],
                source=[S(C, rel, f"lines {', '.join(map(str, lns))}"), L(C, "CLAUDE.md", "Next number = the highest in `ideas.csv` + 1")],
            ))
    write("marketing/ideas.json",
          ["Every row of tracker/ideas.csv, all columns kept. The CSV column 'source' (where the idea came from) is renamed 'origin' so it does not clash with provenance 'source'.",
           "Reused IDs are flagged in duplicate_of_legacy_id_group. The second occurrence gets a proposed non-colliding code (highest number for that prefix + 1, assigned in file order). "
           "Status 'proposed_renumbering': NOT applied; legacy_id is unchanged and remains the key used by versions.csv.",
           "Per D-009 the new system stores its own UUID plus a unique business code; codes are never reused.",
           f"Highest legacy number per prefix: {dict(sorted(maxnum.items()))}."],
          OrderedDict(columns_in_source=header, records=recs, duplicate_groups=groups), ["records", "duplicate_groups"])

    # ---------------- placements
    rel = "tracker/versions.csv"
    ls = lines(C, rel)
    rows = list(csv.reader(io.StringIO("\n".join(ls) + "\n")))
    assert len(rows) == len(ls)
    header = rows[0]
    idea_ids = set(by_id)
    dups = {k for k, v in by_id.items() if len(v) > 1}
    precs = []
    for ln, r in enumerate(rows[1:], start=2):
        d = dict(zip(header, r))
        suffix = d["version_id"][len(d["idea_id"]) + 1:] if d["version_id"].startswith(d["idea_id"] + "-") else None
        variant = None
        code = suffix
        if suffix and suffix not in BASE_CODES and suffix[:-1] in BASE_CODES and suffix[-1] in "SL":
            code, variant = suffix[:-1], {"S": "short", "L": "long"}[suffix[-1]]
        slug_code = ACCOUNT_SLUG_TO_CODE.get(d["account"])
        date_raw = d["date_ist"] or None
        date = time = None
        precision = None
        if date_raw:
            m = re.match(r"(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?(?:\s+(week))?$", date_raw)
            if m:
                date, time = m.group(1), m.group(2)
                precision = "week_of" if m.group(3) else ("datetime" if time else "date")
        metrics = None
        if d["result_24h"]:
            metrics = OrderedDict()
            for seg in d["result_24h"].split("·"):
                seg = seg.strip()
                mm = re.match(r"([\d,.]+)\s*(%?)\s*(imp|react|comm|repost|eng)\b", seg)
                if mm:
                    val = num(mm.group(1))
                    unit = mm.group(3)
                    key = {"imp": "impressions", "react": "reactions", "comm": "comments", "repost": "reposts",
                           "eng": "engagement_rate_pct" if mm.group(2) else "engagements"}[unit]
                    metrics[key] = val
        precs.append(OrderedDict(
            version_id=d["version_id"],
            idea_legacy_id=d["idea_id"],
            idea_exists=d["idea_id"] in idea_ids,
            account_slug=d["account"],
            account_code=code,
            account_code_matches_slug=(code == slug_code),
            variant=variant,
            collab_with=d["collab_with"] or None,
            format=d["format"] or None,
            legacy_status=d["status"],
            status=norm_status(d["status"]).replace("ready_to_post_needs_nikunj_yes", "ready_to_post_pending_approval"),
            date_ist_raw=date_raw,
            date_ist=date,
            time_ist=time,
            date_precision=precision,
            link_or_file=d["link_or_file"] or None,
            result_24h_raw=d["result_24h"] or None,
            result_24h=metrics or None,
            notes=d["notes"] or None,
            ambiguous=d["idea_id"] in dups,
            ambiguity_reason=("idea_id is a reused legacy ID; see ideas.json duplicate_groups" if d["idea_id"] in dups else None),
            source=S(C, rel, f"line {ln}"),
        ))
    write("marketing/placements.json",
          ["One record per row of tracker/versions.csv (a placement of an idea on an account).",
           "account_code is derived from the version_id suffix; variant 'short'/'long' from a trailing S/L (e.g. YTIS, YTCL).",
           "result_24h keeps the raw text; parsed numbers are as reported in the tracker (not verified against platform exports).",
           "Status values are the tracker's own pipeline words, normalised to snake_case; 'planned' here means scheduled intent, not done."],
          OrderedDict(columns_in_source=header, records=precs), ["records"])


def build_post_audit():
    C = "content-os"
    rel = "accounts/instagram-clat/post-audit.csv"
    ls = lines(C, rel)
    rows = list(csv.reader(io.StringIO("\n".join(ls) + "\n")))
    assert len(rows) == len(ls)
    header = rows[0]
    recs = []
    for ln, r in enumerate(rows[1:], start=2):
        d = dict(zip(header, r))
        v = d["verdict"].upper()
        actions = []
        for a in ("KEEP", "ARCHIVE", "UNPIN", "PIN"):
            if re.search(rf"(?<!UN){a}\b" if a == "PIN" else rf"\b{a}\b", v):
                actions.append(a.lower())
        owner = d["owner"]
        collab = None
        m = re.match(r"Collab owned by (@\S+)", owner)
        if m:
            collab = m.group(1)
        recs.append(OrderedDict(
            n=int(d["n"]),
            posted=d["posted"],
            type=d["type"],
            link=d["link"],
            topic=d["topic"],
            owner_raw=owner,
            ownership="collab" if collab else ("own_post" if owner == "own post" else owner),
            collab_owner_handle=collab,
            views=num(d["views"]),
            likes=num(d["likes"]),
            comments=num(d["comments"]),
            boosted_flag_raw=d["boosted?"] or None,
            likely_boosted=(d["boosted?"].strip() == "likely ad"),
            verdict_raw=d["verdict"],
            verdict_actions=actions,
            reason=d["reason"],
            status="documented",
            source=S(C, rel, f"line {ln}"),
        ))
    keep = sum("keep" in r["verdict_actions"] for r in recs)
    pin = sum("pin" in r["verdict_actions"] for r in recs)
    arch = sum("archive" in r["verdict_actions"] for r in recs)
    unpin = sum("unpin" in r["verdict_actions"] for r in recs)
    boosted = [r for r in recs if r["likely_boosted"]]
    summary = OrderedDict(
        audited_on="2026-10-07",
        account_code="IGC",
        posts=len(recs),
        verdict_counts=OrderedDict(keep=keep, keep_and_pin=pin, archive=arch,
                                   archive_only=sum(r["verdict_actions"] == ["archive"] for r in recs), unpin=unpin),
        likely_boosted_posts=len(boosted),
        likely_boosted_views_total=sum(r["views"] or 0 for r in boosted),
        likely_boosted_likes_total=sum(r["likes"] or 0 for r in boosted),
        readme_statement="34 keep (2 to pin) · 25 archive · unpin 2; 13 reels were boosted ads: about 2.9M views together, but only about 250 likes",
        notes=["Row 28 is 'UNPIN + ARCHIVE' (counted in archive and unpin); row 29 is 'KEEP, UNPIN' (counted in keep and unpin).",
               "Views are blank for photo posts and three recent reels have no likes/comments recorded; null, not zero."],
        status="documented",
        source=[L(C, "accounts/instagram-clat/README.md", "**Verdicts:**"), L(C, "accounts/instagram-clat/README.md", "**13 reels were boosted ads:**")],
    )
    write("marketing/post-audit.json",
          ["The 60-post audit of the CLAT Instagram page (logged-in, 7 Oct 2026). Metrics are as reported in the CSV, not re-measured.",
           "Personal handles and private names in topics are redacted; brand handles (e.g. @elevateeducation_sikar) are kept."],
          OrderedDict(columns_in_source=header, summary=summary, records=recs), ["records"])


ALL_ACCOUNTS = ["IGC", "YTC", "IGU", "YTU", "IGI", "YTI", "IGS", "LIP", "LI", "IGN"]
NON_SIKAR = [a for a in ALL_ACCOUNTS if a != "IGS"]


def build_content_rules():
    C = "content-os"
    B = "brand/BRAND.md"
    rules = []

    def rule(id, kind, description, needle_src, matcher=None, applies_to=None, action="flag_for_review",
             status="approved", notes=None, extra_sources=()):
        key, rel, needle = needle_src
        src, text = LT(key, rel, needle)
        srcs = [src] + [L(*e) for e in extra_sources]
        rules.append(OrderedDict(
            id=id, kind=kind, description=description,
            matcher=matcher, manual_check=(matcher is None),
            action_on_match=(action if matcher else None),
            applies_to=applies_to or ALL_ACCOUNTS,
            status=status,
            source_text=text,
            notes=notes,
            source=srcs,
        ))

    rx = lambda p, field="text": OrderedDict(type="regex", pattern=p, flags="i", field=field)
    lit = lambda p, field="text": OrderedDict(type="literal", pattern=p, case_sensitive=False, field=field)

    # ---- banned phrases / claims
    rule("CR-001", "banned_phrase", "Never use 'after 12th' as a framing for when students should join (they join in Class 10, 11 or 12).",
         (C, B, 'Never say "after 12th"'), rx(r"\bafter\s+(the\s+)?(12th|class\s*12|class\s*xii)\b"),
         notes="Exception in the same line: 'IIM straight after Class 12' describing the programme's admission is fine, so a match is flagged for review, not auto-blocked.",
         extra_sources=[(C, "HANDOFF.md", 'Never say "after 12th"')])
    rule("CR-002", "banned_phrase", "Never mention RP Mody & Co in public content (Deloitte is the brand to use).",
         (C, B, "Never mention RP Mody & Co"), rx(r"\bR\.?\s*P\.?\s*Mody\b"), action="block",
         extra_sources=[(C, "CLAUDE.md", "RP Mody &")])
    rule("CR-003", "banned_phrase", "Never mention NLSIU or the founder's MBL studies in public content.",
         (C, B, "Never mention NLSIU / the MBL"), rx(r"\bNLSIU\b|\bMBL\b|Master of Business Laws"),
         notes="Aimed at founder-credential mentions; an unrelated NLSIU reference (e.g. a guest speaker's institution) needs human review, hence flag.",
         extra_sources=[(C, "CLAUDE.md", "NLSIU/MBL")])
    rule("CR-004", "banned_phrase", "Do not label Elevate as 'online' (no mode in the message).",
         (C, B, "**No location, no mode.**"), rx(r"\bonline\b"),
         extra_sources=[(C, "CLAUDE.md", '"online" as a label')])
    rule("CR-005", "banned_phrase", "No Sikar / offline-centre mentions except on the Elevate Sikar Instagram page.",
         (C, B, "**No location, no mode.**"), rx(r"\bSikar\b|\boffline\s+(cent(re|er)|coaching|classes?)\b"),
         applies_to=NON_SIKAR, action="block",
         extra_sources=[(C, B, "**Exception: the Elevate Sikar Instagram page**"), (C, "CLAUDE.md", "the only place for Sikar/offline content")])
    rule("CR-006", "banned_phrase", "No student results, toppers, selections, ranks or '100% results' claims in year one.",
         (C, B, "**First year: no student results exist yet.**"),
         rx(r"\b(our\s+)?toppers?\b|\bAIR\s*\d+|\b\d+\+?\s*selections?\b|\b100\s*%\s*results?\b|\bselected\s+(in|at|for)\b"),
         action="block", extra_sources=[(C, "CLAUDE.md", "Never: student results/toppers (year one)"), (C, B, "Never invent results, ranks")])
    rule("CR-007", "banned_phrase", "Avoid AIR / topper / 'best faculty' claims.",
         (C, B, "Avoid AIR / topper"), rx(r"\bbest\s+(faculty|teachers?|coaching)\b|\bAIR\b"))
    rule("CR-008", "banned_phrase", "'Full marks' / '99%ile' only as a goal, never as a promise or past result.",
         (C, B, '"Full marks" / "99%ile" are fine as the *goal*'), rx(r"\bfull\s+marks\b|\b99\s*(%ile|percentile)\b|\bguarantee(d)?\b"),
         notes="Context decides goal vs promise; always human review.")
    rule("CR-009", "banned_phrase", "No CA vs CLAT comparisons (rejected by the founder on 6 Oct 2026).",
         (C, "accounts/instagram-clat/README.md", "No CA vs CLAT comparisons (rejected 6 Oct)"),
         rx(r"\bCA\s*(vs\.?|versus|or)\s*CLAT\b|\bCLAT\s*(vs\.?|versus|or)\s*CA\b"), action="block",
         extra_sources=[(C, "tracker/ideas.csv", "CLAT-003,CA vs CLAT")])
    rule("CR-010", "banned_phrase", "CA Foundation only: never imply CA Inter or Final are offered.",
         (C, B, "**Inter and Final are not offered yet**"), rx(r"\bCA\s+(Inter|Intermediate|Final)\b"), action="block")
    rule("CR-011", "banned_phrase", "The founder's Deloitte tenure is about 1 year: never say 'four years'.",
         (C, B, 'never say "four years"'), rx(r"Deloitte[^.\n]{0,80}\b(four|4)\s+years\b|\b(four|4)\s+years\b[^.\n]{0,80}Deloitte"), action="block")
    rule("CR-012", "banned_phrase", "Credential is NMIMS Rank 3 (the LinkedIn profile wrongly says Rank 2).",
         (C, B, "Rank 3 (his LinkedIn wrongly says Rank 2)"), rx(r"\bRank\s*(2|two)\b"), action="block")
    rule("CR-013", "banned_phrase", "The founder's title is Co-Founder, not Founder.",
         (C, B, "(title is Co-Founder, not Founder)"), rx(r"(?<!co-)(?<!co )\bfounder\b"),
         notes="Pattern catches 'Founder' not preceded by 'Co-'; generic uses ('founders' as an audience) need review.")
    rule("CR-014", "banned_phrase", "Do not use the unverified '44 lakh commerce students' or '78% unaware (CBSE 2024)' figures.",
         (C, B, 'Do NOT use: the "44 lakh commerce students"'), rx(r"\b44\s*lakh\b|\b78\s*%"), action="block")
    rule("CR-015", "banned_phrase", "Team size is '15-20 teachers'; never round it up.",
         (C, B, "Team size: **15"), rx(r"\b(2[1-9]|[3-9]\d|\d{3,})\+?\s+(expert\s+)?teachers\b|\b20\s*\+\s*(expert\s+)?teachers\b"), action="block")
    rule("CR-016", "banned_phrase", "Never use the chevron alone as the logo; the logo is the lowercase 'elevate' wordmark.",
         (C, B, "never use the chevron alone as the logo"), None,
         extra_sources=[(C, "HANDOFF.md", "The logo is the \"elevate\" wordmark")])
    rule("CR-017", "banned_phrase", "CA is not promoted as a course; no CA-course marketing or CA exam content (the founder's CA stays a personal credential).",
         (C, B, "**CA is not promoted as a course.**"), None,
         extra_sources=[(C, "CLAUDE.md", "CA marketed as a course")])
    rule("CR-018", "banned_phrase", "No invented anecdotes; stories only if the founder confirmed them.",
         (C, "CLAUDE.md", "Stories only if he confirmed them."), None)
    rule("CR-019", "banned_phrase", "Do not list what the founder personally teaches in bios or profiles.",
         (C, B, "personally teaches** in bios or profiles"), None)
    rule("CR-020", "channel_rule", "'Taught by [founder]' only for CA Foundation, CLAT Legal Reasoning and Class 11-12 BST; 'our faculty' for everything else.",
         (C, B, "personally teaches:** CA Foundation"), None,
         extra_sources=[(C, B, "Studies. Every other subject has its own dedicated teacher")])
    rule("CR-021", "channel_rule", "Founder's name and credentials only on the founder's own footage; ask other teachers for theirs.",
         (C, B, "credentials on Nikunj's own footage"), None)
    rule("CR-022", "channel_rule", "CLAT page goal is presence, not a course launch: no pitch, no 'join us', no 'meet the faculty' launch.",
         (C, B, "**Goal now = presence, not a course launch.**"),
         rx(r"\bjoin\s+us\b|\benrol+\s+now\b|\badmissions?\s+(are\s+)?open\b|\bbook\s+your\s+seat\b"),
         applies_to=["IGC", "YTC"], extra_sources=[(C, "accounts/instagram-clat/PROFILE.md", 'Goal = presence: no course, no "join"')])

    # ---- approvals
    rule("AP-001", "requires_approval", "Nothing is scheduled or published without the founder's explicit yes.",
         (C, "CLAUDE.md", "Nothing is scheduled or published without"), None,
         notes="Workflow gate: a placement cannot move to scheduled/published without an approval record from the approver role.")
    rule("AP-002", "requires_approval", "Facts only from BRAND.md, a course facts file with a source, or the founder.",
         (C, "CLAUDE.md", "Facts only from BRAND.md"), None,
         extra_sources=[(C, "courses/README.md", "Facts must carry a source and a date")])
    rule("AP-003", "requires_approval", "Items marked (confirm) must not go on screen until the founder confirms them.",
         (C, B, "marked **(confirm)**"), lit("(confirm)"), action="block")
    rule("AP-004", "requires_approval", "An example the speaker didn't say is flagged for approval; subject facts must match the syllabus.",
         (C, B, "When I add an example the speaker didn't say"), None)
    rule("AP-005", "requires_approval", "Market figures must be verified against the official source before use on screen.",
         (C, B, "## 1c. Market facts we can use"), None)
    rule("AP-006", "requires_approval", "Fees, offers and sensitive claims need Institute Authority approval; no sole self-approval (offline marketing SOP MKT-03).",
         ("handover", "Claude.md", "## 10. Marketing operations"), None, status="documented",
         notes="From the operations handover (Project B); agreed operating summary in the marketing workbooks, not a signed SOP.")
    rules[-1]["source"].append(X("outputs/marketing-operations/Elevate-Marketing-Easy.xlsx", "SOP Register", "G8"))

    # ---- channel rules
    li_src = (C, "accounts/linkedin-nikunj/README.md", "No polls, no \"comment X\", no hashtags.")
    rule("CH-001", "channel_rule", "LinkedIn (founder personal): no hashtags.", li_src, rx(r"(^|\s)#[A-Za-z0-9_]+"), applies_to=["LI"], action="block",
         notes="Stated in the personal LinkedIn README only; whether it also applies to the company page (LIP) is not stated.")
    rule("CH-002", "channel_rule", "LinkedIn (founder personal): no polls.", li_src, rx(r"\bpoll\b", field="format"), applies_to=["LI"], action="block")
    rule("CH-003", "channel_rule", "LinkedIn (founder personal): no 'comment X' calls to action.", li_src,
         rx(r"\bcomment\s+(karo\s+)?[\"“']?[A-Z]{2,}\b|\bcomment\s+[\"“'][^\"”']+[\"”']"), applies_to=["LI"], action="block")
    rule("CH-004", "channel_rule", "LinkedIn is for parents, young professionals and founders; never student exam tips there.",
         (C, "CLAUDE.md", "LinkedIn is for parents, young professionals and founders"), None, applies_to=["LI", "LIP"])
    rule("CH-005", "channel_rule", "LinkedIn (founder personal): at most 1 post a day and 4 a week.",
         (C, "accounts/linkedin-nikunj/README.md", "**Cadence:** 4 posts/week, max 1 a day."),
         OrderedDict(type="schedule_limit", max_per_day=1, max_per_week=4, field="date_ist"), applies_to=["LI"], action="block")
    rule("CH-006", "channel_rule", "Collab rule: pure exam content is posted solo on that exam's page; comparisons (e.g. CLAT vs IPMAT) and 'every path' content go out as an Instagram/YouTube Collab across the exam pages involved.",
         (C, "CLAUDE.md", "**Collab rule:**"), None, applies_to=["IGC", "YTC", "IGU", "YTU", "IGI", "YTI"],
         notes="Structural check: a placement on an exam page whose idea is cross-exam (course GEN or a comparison) should have collab_with set.",
         extra_sources=[(C, "HANDOFF.md", "| Comparisons (CLAT vs IPMAT, IPM vs CA)")])
    rule("CH-007", "channel_rule", "Exam pages stay pure: a decided student must not see mixed content.",
         (C, "HANDOFF.md", "Exam pages must stay PURE"), None, applies_to=["IGC", "YTC", "IGU", "YTU", "IGI", "YTI"])
    rule("CH-008", "channel_rule", "Commerce and CUET are equal domains on the Commerce + CUET page; neither is the main one.",
         (C, B, "**Commerce and CUET are equal domains**"), None, applies_to=["IGU", "YTU"])
    rule("CH-009", "channel_rule", "YouTube CLAT titles: exam + year + intent.",
         (C, "accounts/youtube-clat/README.md", "Titles: exam + year + intent."), rx(r"\bCLAT\b.*\b20\d\d\b", field="title"),
         applies_to=["YTC"], action="flag_if_no_match")
    rule("CH-010", "channel_rule", "CLAT Instagram contact button: email only; no WhatsApp or 'book a call' while not selling.",
         (C, "accounts/instagram-clat/PROFILE.md", "| Contact button | Email only"), None, applies_to=["IGC"])

    # ---- consent
    rule("CO-001", "consent", "Students on camera (mostly minors) only with the student's and a parent's OK; without consent, faces blurred or hands/desks/papers only.",
         (C, "library/_broll/README.md", "**Students on camera** are mostly minors."), None,
         extra_sources=[(C, "accounts/instagram-clat/calendar-oct-dec-2026.md", "Students on camera only with the student's and a parent's OK."),
                        (C, "tracker/ideas.csv", "Student + parent OK required")],
         notes="Workflow gate: content showing students needs a recorded student consent and a parent/guardian consent reference before approval.")
    rule("CO-002", "consent", "Do not publish minors' names (the audit archived scholarship-ranker posts that listed minors' names).",
         (C, "accounts/instagram-clat/post-audit.csv", "Scholarship test rankers (names)"), None, status="documented")
    rule("CO-003", "consent", "Testimonials only when real ones are given with permission.",
         (C, B, 'No "our toppers", "X selections"'), rx(r"\btestimonials?\b"))
    rule("CO-004", "consent", "In screenshots of comments/reposts/DMs, blur names, handles and profile photos of private people; DMs always blurred; names only for public publishers/creators.",
         (C, B, "**Rule:** blur the names, handles and profile photos of private people."), None)
    rule("CO-005", "consent", "Never edit or invent a comment; use real screenshots only.",
         (C, B, "Never edit or invent a comment"), None)
    rule("CO-006", "consent", "Third-party clip (the founder's viral CA-result reel on his brother's account): needs the original file and the brother's OK, and must credit the brother's account; never imply it is a student result.",
         (C, B, "To use the clip, we need the original file and his brother's OK"), None,
         extra_sources=[(C, B, "Never imply it's an Elevate student result.")])
    rule("CO-007", "consent", "Clip cutting (online coordinator SOP draft): remove private student information and unapproved student footage.",
         ("handover", "Claude.md", "## 11. Online operations"), None, status="proposed",
         notes="Source is the draft online coordinator SOP (docx), section 'Video clip cutting'.")
    rules[-1]["source"].append(S("handover", "outputs/online-operations/Elevate-Online-Coordinator-SOP.docx", "section 'Video clip cutting', paragraph 2"))

    kinds = Counter(r["kind"] for r in rules)
    write("marketing/content-rules.json",
          ["Machine-readable brand/claims rules for the approval workflow. matcher=null means not meaningfully checkable by text (manual_check=true).",
           "Regex matchers are deliberately broad and mostly 'flag_for_review'; 'block' only where a match is almost certainly a violation.",
           "matcher.field says what the matcher reads: text (caption/script/on-screen text), title, format, or date_ist (scheduling).",
           "source_text is the exact source line with personal names replaced by role labels.",
           f"Counts by kind: {dict(kinds)}."],
          OrderedDict(account_codes=ALL_ACCOUNTS, records=rules), ["records"])


def build_metrics_formats():
    C = "content-os"
    rel = "tools/import-metrics.mjs"
    s = lambda needle: L(C, rel, needle)
    body = OrderedDict(
        output_file=OrderedDict(
            path="tracker/metrics.csv",
            exists_in_source=abspath(C, "tracker/metrics.csv").exists(),
            columns=["account", "platform", "published", "title", "link", "format", "views", "reach", "likes", "comments",
                     "shares", "saves", "watch_hours", "impressions", "ctr_pct", "imported_on"],
            row_key="account + '|' + (link or title + '|' + published); a newer export updates numbers in place",
            missing_values="a missing column stays blank, never a fake 0",
            source=[s("const COLS = ["), s("const byKey = new Map();")],
        ),
        inbox=OrderedDict(
            convention="reports/inbox/<account>/*.csv; the folder name says whose numbers they are; imported files move to reports/inbox/processed/<date>/<account>/",
            header_matching="case-insensitive; first an exact header match for any listed name, then a 'contains' match, in the listed order",
            detection_order=["youtube if any header contains 'video title' or 'watch time'",
                             "instagram if any header contains 'permalink', 'reach' or 'post type'",
                             "otherwise skipped ('not an Instagram or YouTube export I recognise')"],
            parsing="RFC 4180 CSV; BOM stripped; blank rows dropped; numbers strip ',', '%' and spaces; dates parsed by Date.parse and written as YYYY-MM-DD",
            source=[s("Drop exports into reports/inbox/<account>/"), s("const detect = (header) =>"), s("const parseCsv = (text) =>"), s("const num = (v) =>")],
        ),
        records=[
            OrderedDict(
                id="instagram_meta_business_suite",
                platform="instagram",
                export_origin="Meta Business Suite > Insights > Content > Export (CSV)",
                detect_if_header_contains_any=["permalink", "reach", "post type"],
                fields=OrderedDict(
                    published=["publish time", "date"], title=["description", "caption"], link=["permalink"],
                    format=["post type"], views=["views", "plays", "impressions"], reach=["reach"], likes=["likes"],
                    comments=["comments"], shares=["shares"], saves=["saves"]),
                transforms=OrderedDict(title="truncated to 120 characters", published="any date format -> YYYY-MM-DD",
                                       not_provided=["watch_hours", "impressions", "ctr_pct"]),
                status="documented",
                verification="tested on sample data only per the content OS notes; no real export exists in reports/inbox",
                source=[s("reports/inbox/instagram-elevate/  Meta Business Suite"), s("const fromInstagram = (rows, account, today) =>")],
            ),
            OrderedDict(
                id="youtube_studio_table_data",
                platform="youtube",
                export_origin="YouTube Studio > Analytics > Advanced mode > Export > CSV ('Table data.csv')",
                detect_if_header_contains_any=["video title", "watch time"],
                fields=OrderedDict(
                    content_id=["content"], title=["video title"], published=["video publish time", "publish time"],
                    views=["views"], watch_hours=["watch time (hours)", "watch time"], impressions=["impressions"],
                    ctr_pct=["impressions click-through rate", "click-through rate"], likes=["likes"],
                    comments=["comments added", "comments"], shares=["shares"], duration_seconds=["duration"]),
                transforms=OrderedDict(
                    link="https://youtu.be/<content id> when the Content column is non-empty",
                    format="'short (<=3 min)' if duration <= 180 s, 'video' otherwise, blank if no duration",
                    skip_rows="rows whose Content value is 'total' (case-insensitive)",
                    title="truncated to 120 characters",
                    not_provided=["reach", "saves"]),
                status="documented",
                verification="tested on sample data only per the content OS notes; no real export exists in reports/inbox",
                source=[s("reports/inbox/youtube-elevate/    YouTube Studio"), s("const fromYouTube = (rows, account, today) =>")],
            ),
        ],
    )
    write("marketing/metrics-csv-formats.json",
          ["The CSV export formats tools/import-metrics.mjs understands, read from the script source (not from real exports).",
           "The script's header comment names inbox folders 'instagram-elevate'/'youtube-elevate', which pre-date the 9-account structure; any folder name is accepted as the account."],
          body, ["records"])



# ============================================================================================
# ACADEMIC
# ============================================================================================
H = "handover"
OPS = "elevate-education-operations"
PLANNER = "outputs/class12-planner/Class-12-Course-Planner.xlsx"
BOOKS = "outputs/concept-books/Elevate-Concept-Book-Indices.xlsx"
QCMP = "outputs/concept-books/Quant-Exam-Index-Comparison.xlsx"
OPSWB = "outputs/elevate-operations/Elevate-Operations.xlsx"


def build_programmes():
    C = "content-os"
    recs = []

    def add(**k):
        recs.append(OrderedDict(k))

    add(code="CLAT", name="CLAT UG preparation", family="CLAT", audience="Class 11-12 students targeting National Law Universities",
        mode=None, class_duration_minutes=None, status="offered",
        delivery_notes=["A CLAT 2027 batch exists (live-page audit, 7 Oct 2026).",
                        "Class length, weekly pattern and batch structure are not documented in any source."],
        source=[L(C, "brand/BRAND.md", "| CLAT | Students targeting National Law Universities |"),
                L(C, "accounts/instagram-clat/README.md", "So **a CLAT 2027 batch exists.**")])
    add(code="COM-11", name="Class 11 Commerce", family="Commerce boards", audience="Students starting commerce (Accounts, BST, Economics)",
        mode=None, class_duration_minutes=None, status="offered", delivery_notes=["Boards CBSE and some RBSE (operations handover)."],
        source=[L(C, "brand/BRAND.md", "| Class 11 Commerce |"), L(H, "Claude.md", "Elevate teaches Classes 11–12 commerce")])
    add(code="COM-12", name="Class 12 Commerce", family="Commerce boards", audience="Board-year students",
        mode=None, class_duration_minutes=None, status="offered", delivery_notes=[],
        source=[L(C, "brand/BRAND.md", "| Class 12 Commerce |")])
    add(code="CUET", name="CUET UG preparation", family="CUET", audience="Class 12 students targeting central universities",
        mode=None, class_duration_minutes=None, status="offered", delivery_notes=[],
        source=[L(C, "brand/BRAND.md", "| CUET | Class 12 students targeting central universities |")])
    add(code="ONL-C12-CUET", name="Online Class 12 boards + CUET curriculum", family="Commerce boards + CUET",
        audience="Class 12 (CBSE base followed by CUET additions)", mode="online", class_duration_minutes=60,
        status="paused",
        delivery_notes=["Intakes March/July/September and January revision; boards February / CUET May are planning windows.",
                        "Subjects Accounts, Maths, BST, Economics, English; only Accountancy is planned (see online-class12-accountancy.json).",
                        "Two test windows a week shared across subjects."],
        source=[L(H, "Claude.md", "Distinct from IPMAT: **60-minute teaching classes**")])
    add(code="IPMAT", name="Combined IIM entrance preparation (IPMAT and related)", family="IPMAT",
        audience="Students targeting IIM integrated programmes; coverage IIMB UG, IPMAT Indore, Rohtak, JIPMAT, Kozhikode, CUET GAT, NPAT, Symbiosis, Christ",
        mode=None, class_duration_minutes=75, status="paused",
        delivery_notes=["Teaching/practice class length 75 minutes (confirmed).",
                        "Batch variants below; only the Class 12 timetable is locked."],
        variants=[
            OrderedDict(code="IPMAT-C12", name="Class 12, April start, one year", status="locked",
                        timetable="Two 75-minute classes daily; April-June 5 days/week (12.5 h); July onward 6 days/week (15 h); third class Tue/Thu July-15 Oct (Class 12 override)",
                        source=[L(H, f"{OPS}/IPMAT_LOCKED_BASELINES.md", "## Class 12 weekly timetable — locked")]),
            OrderedDict(code="IPMAT-DROP", name="Dropper, June start, one year", status="provisional",
                        timetable="Shares Class 12 teaching with extra practice; weekly timetable not locked",
                        source=[L(H, "Claude.md", "Batch model: Class12 April start/one year")]),
            OrderedDict(code="IPMAT-C11", name="Class 11, April start, two years", status="provisional",
                        timetable="Not locked", source=[L(H, "Claude.md", "Batch model: Class12 April start/one year")]),
            OrderedDict(code="IPMAT-FT", name="Fast-track, March start, two months", status="proposed",
                        timetable="Four daily 75-minute classes over six days (separate proposal); detailed allocation pending",
                        source=[L(H, f"{OPS}/IPMAT_LOCKED_BASELINES.md", "Fast-track four daily 75-minute classes")]),
        ],
        source=[L(C, "brand/BRAND.md", "| IPMAT | Students targeting IIM integrated programmes"),
                L(H, "Claude.md", "Target coverage includes IIM Bangalore UG"),
                L(H, "Claude.md", "Teaching/practice class length75 minutes")])
    add(code="CAF", name="CA Foundation", family="CA", audience="CA aspirants at Foundation level",
        mode="offline", class_duration_minutes=75, status="paused",
        delivery_notes=["Three target attempts a year: January, May, September.",
                        "Batch planned: September 2027 Regular (CAF-SEP27-REG).",
                        "75-minute teaching classes selected in conversation; 1 March start selected per Claude.md, but ACADEMIC_PLANNING_DECISIONS.md and the Operations workbook (D-016) still list the March/April start as open: conflicting sources, reconcile before dating.",
                        "Approximate campus window 11:30-17:00, flexible.",
                        "Inter and Final are not offered; never imply them (BRAND.md). CA is not marketed as a course."],
        source=[L(C, "brand/BRAND.md", "| CA Foundation | CA aspirants at Foundation level"),
                L(H, "Claude.md", "Three target attempts: January, May, September."),
                L(H, "Claude.md", "September planning: March/April start discussed"),
                L(H, f"{OPS}/ACADEMIC_PLANNING_DECISIONS.md", "Exact batch start date remains unresolved"),
                L(H, f"{OPS}/IPMAT_REFERENCE_NOTES.md", "CA paused: start 1 March 2027 confirmed")])
    write("academic/programmes.json",
          ["Programme catalogue as documented. mode/class length are null where no source states them; nothing is inferred.",
           "status: offered = listed as a current course in BRAND.md; paused = planning stream paused in the operations handover; variant statuses as stated."],
          OrderedDict(records=recs), ["records"])


def _t(tables, heading_prefix, nth=1):
    hits = [t for t in tables if (t["heading"] or "").startswith(heading_prefix)]
    if len(hits) < nth:
        raise KeyError(heading_prefix)
    return hits[nth - 1]


def build_ipmat_baseline():
    rel = f"{OPS}/IPMAT_LOCKED_BASELINES.md"
    tabs = md_tables(H, rel)
    src_line = lambda ln: S(H, rel, f"line {ln}")

    qt = _t(tabs, "Quant teaching baseline")
    quant_blocks = [OrderedDict(block=c[0], teaching_classes=num(c[1]), source=src_line(ln)) for ln, c in qt["rows"]]
    # subtopic bullets (20, same order as the blocks)
    ls = lines(H, rel)
    bullets = [(i + 1, t) for i, t in enumerate(ls) if i >= 34 and i < 56 and t.startswith("- ")]
    assert len(bullets) == len(quant_blocks) == 20, (len(bullets), len(quant_blocks))
    for blk, (ln, t) in zip(quant_blocks, bullets):
        label, rest = t[2:].split(":", 1)
        subs = []
        for part in rest.strip().rstrip(".").split(";"):
            m = re.match(r"\s*(.+?)\s*\((\d+)\)\s*$", part)
            subs.append(OrderedDict(subtopic=m.group(1), classes=int(m.group(2))))
        blk["subtopics"] = subs
        blk["subtopic_label_in_source"] = label
        blk["subtopics_sum_matches"] = sum(s["classes"] for s in subs) == blk["teaching_classes"]
        blk["subtopics_source"] = src_line(ln)
    hm = _t(tabs, "Higher-maths additions")
    higher = [OrderedDict(topic=c[0], subtopic_allocation=c[1], teaching_classes=num(c[2]), practice_classes=num(c[3]), source=src_line(ln))
              for ln, c in hm["rows"] if c[0] != "Total"]
    qp = _t(tabs, "Existing Quant practice allocation")
    qprac = [OrderedDict(topic=c[0], practice_classes=num(c[1]), source=src_line(ln)) for ln, c in qp["rows"] if c[0] != "Total"]
    qprac_stated_total = [num(c[1]) for ln, c in qp["rows"] if c[0] == "Total"][0]
    vt = _t(tabs, "Verbal teaching baseline")
    vblocks = [OrderedDict(block=c[0], teaching_classes=num(c[1]), source=src_line(ln)) for ln, c in vt["rows"] if c[0] != "Total"]
    lrdi = _t(tabs, "LR and DI teaching baseline")
    lr_topics, di_topics, cur = [], [], None
    for ln, c in lrdi["rows"]:
        if c[0] == "LR total":
            cur = "DI"
            continue
        if c[0] == "DI total":
            continue
        (di_topics if cur == "DI" else lr_topics).append(OrderedDict(topic=c[0], teaching_classes=num(c[1]), source=src_line(ln)))
    lrp, dip = [t for t in tabs if (t["heading"] or "").startswith("LR and DI practice")]
    lr_prac = [OrderedDict(topic=c[0], practice_classes=num(c[1]), note=(c[1] if num(c[1]) is None else None), source=src_line(ln)) for ln, c in lrp["rows"] if c[0] != "Total"]
    di_prac = [OrderedDict(topic=c[0], practice_classes=num(c[1]), source=src_line(ln)) for ln, c in dip["rows"] if c[0] != "Total"]
    seq_lines = [(i + 1, t) for i, t in enumerate(ls) if re.match(r"^\d+\. ", t) and 75 < i < 110]
    lr_sequence = [OrderedDict(position=int(t.split(".")[0]), topic=t.split(". ", 1)[1], source=src_line(ln)) for ln, t in seq_lines]

    vrel = "outputs/Verbal-Teaching-Estimates-v2.md"
    vtab = md_tables(H, vrel)[0]
    vtopics = [OrderedDict(id=c[0], topic=c[1], teaching_classes=num(c[2]), hours=num(c[3]), source=S(H, vrel, f"line {ln}")) for ln, c in vtab["rows"]]

    vat = _t(tabs, "Verbal chapter assessment")
    vtests = []
    for ln, c in vat["rows"]:
        if c[0].startswith("VT"):
            vtests.append(OrderedDict(group_id=c[0], coverage=c[1], test_minutes_per_paper=num(c[2]), discussion_minutes_per_paper=num(c[3]),
                                      papers=[f"{c[0]}-A", f"{c[0]}-B"], source=src_line(ln)))

    # assessment budget from the planner workbook (formulas + cached values)
    wf, wv = wb(PLANNER, False)["Assessment budget"], wb(PLANNER, True)["Assessment budget"]
    ab = []
    for r in range(5, 20):
        ab.append(OrderedDict(
            assessment=wv.cell(r, 1).value, papers=wv.cell(r, 2).value, test_minutes_total=wv.cell(r, 3).value,
            discussion_minutes_total=wv.cell(r, 4).value, known_hours=wv.cell(r, 5).value, known_hours_formula=wf.cell(r, 5).value,
            planning_basis=wv.cell(r, 6).value, status="planned", source=X(PLANNER, "Assessment budget", f"A{r}:F{r}")))
    mocks = [a for a in ab if "mocks" in a["assessment"]]
    excluded_names = {"NPAT mocks", "Other non-IIM mocks"}

    C12 = f"{OPS}/CLASS12_ACCELERATED_BASELINE.md"
    for arr in (quant_blocks, higher, vblocks, vtopics, lr_topics, di_topics, lr_sequence, vtests, qprac, lr_prac, di_prac):
        for it in arr:
            it.setdefault("status", "locked")
    body = OrderedDict(
        locked_teaching_baseline=OrderedDict(
            status="locked", approved_on="2026-09-10", class_minutes=75,
            totals=OrderedDict(quant=151, quant_base=114, quant_higher_maths=37, verbal=57, lr=32, di=13, total=253, hours=316.25),
            meaning="Locked for planning; not taught or verified delivery.",
            source=[L(H, rel, "Quant 151 + Verbal 57 + LR 32 + DI 13 = 253 teaching classes / 316.25 hours."),
                    L(H, "Claude.md", "Teaching baseline: Quant151 (114 base +37 higher)")],
        ),
        quant_teaching_blocks=quant_blocks,
        quant_higher_maths=higher,
        verbal_teaching_blocks=vblocks,
        verbal_teaching_topics=vtopics,
        lr_teaching_topics=lr_topics,
        di_teaching_topics=di_topics,
        lr_di_teaching_sequence=lr_sequence,
        practice_allocations_programme_level=OrderedDict(
            status="locked",
            applies_to="programme baseline (superseded for the Class 12 cohort by the Class 12 override)",
            quant_practice_stated_total=53, quant_practice_base_rows=qprac, quant_practice_base_rows_stated_total=qprac_stated_total,
            quant_practice_base_rows_actual_sum=sum(x["practice_classes"] for x in qprac),
            quant_practice_note="Base practice rows sum to 36, not the stated 38 (arithmetic correction recorded in the source); higher maths adds 15 -> 51 mapped + 2 topic-allocation-pending classes = 53.",
            verbal_practice=28, lr_practice=lr_prac, di_practice=di_prac,
            programme_total_classes=360, programme_total_hours=450,
            source=[L(H, rel, "Current locked programme allocation: 253 teaching"),
                    L(H, rel, "Arithmetic correction found while reconciling class rows")],
        ),
        class12_override=OrderedDict(
            status="approved",
            status_note="Latest saved override (user-requested removal of eight practice classes). Lesson dates and exam date remain provisional.",
            applies_to="IPMAT Class 12 cohort only; do not apply to Class 11, dropper or fast-track",
            totals=OrderedDict(
                quant=OrderedDict(teaching=151, practice=27, total=178),
                verbal=OrderedDict(teaching=57, practice=13, total=70),
                lr=OrderedDict(teaching=32, practice=7, total=39),
                di=OrderedDict(teaching=13, practice=5, total=18),
                total=OrderedDict(teaching=253, practice=52, total=305, hours=381.25)),
            supersedes=[
                OrderedDict(label="313 classes / 391.25 h (253 teaching + 60 practice)", status="superseded",
                            source=L(H, C12, "| Total | 253 | 60 | 313 | 391.25 |")),
                OrderedDict(label="360 classes / 450 h (253 teaching + 107 practice)", status="superseded",
                            source=L(H, rel, "= 360 classes / 450 hours"))],
            removed_practice_to_homework=["Verbal-P038", "Verbal-P042", "Verbal-P043", "Quant-P024", "Quant-P025", "Quant-P026", "LR-P053", "LR-P054"],
            source=[L(H, C12, "Total 253 teaching + 52 practice = 305 classes / 381.25 hours."),
                    L(H, "Claude.md", "The most recent saved override is **305 classes /381.25 hours**"),
                    X(PLANNER, "Overview", "A4:G9")],
        ),
        assessments=OrderedDict(
            chapter_tests=OrderedDict(quant=25, verbal=28, lr=11, di=6, total=70, hours=85.75,
                                      verbal_note="28 = 14 topic groups x papers A and B (doubled from 14; locked)",
                                      status="approved",
                                      source=[L(H, "Claude.md", "Chapter tests Quant25, Verbal28"), X(PLANNER, "Assessment budget", "A5:E8")]),
            verbal_test_groups=vtests,
            sectionals=OrderedDict(quant=10, verbal=10, lr=6, di=4, test_minutes_each=60, discussion_minutes_each=75,
                                   status="documented",
                                   status_note="Quant 10 / Verbal 10 stated; LR 6 / DI 4 are 'historical ... check current workbook before changing'.",
                                   source=[L(H, "Claude.md", "Sectionals: Quant10, Verbal10"), X(PLANNER, "Assessment budget", "A9:F12")]),
            full_mocks=OrderedDict(
                workbook_allocation=[OrderedDict(exam=m["assessment"], papers=m["papers"],
                                                 discussion_minutes_total=m["discussion_minutes_total"],
                                                 test_duration="blank (pending exam-cycle mapping)",
                                                 active_schedule=(m["assessment"] not in excluded_names),
                                                 status=("planned" if m["assessment"] not in excluded_names else "superseded"), source=m["source"])
                                     for m in mocks],
                workbook_total=sum(m["papers"] for m in mocks),
                active_iim_focused_total=sum(m["papers"] for m in mocks if m["assessment"] not in excluded_names),
                excluded_from_active_schedule=sorted(excluded_names),
                status="approved",
                status_note="User excluded 20 non-IIM mocks from the active schedule, leaving 50 IIM-focused (Claude.md). The planner workbook still lists all 70 as annual allocations. No dated 50-mock timetable exists.",
                cadence="Start April; fortnightly in the first two months, weekly thereafter; weekdays available after 15 October",
                source=[L(H, "Claude.md", "Full mocks initially70"), X(PLANNER, "Assessment budget", "A13:F19")]),
            assessment_budget_rows=ab,
        ),
        calendar=OrderedDict(
            cycle="April 2027 - March 2028", cycle_status="provisional",
            teaching_target="2027-10-15", teaching_target_status="locked",
            teaching_target_extension="User permitted extension to 20 October or selected weekend/extra sessions if needed",
            di_start="2027-06-07", higher_maths_start="2027-07-14",
            pre_iimb_mock_phase=OrderedDict(start="2027-10-16", end="2027-11-10", gross_regular_hours=55),
            iimb_exam_date="2027-11-14", iimb_exam_date_status="unverified",
            iimb_exam_date_note="Approximate planning deadline only; not an official date. The official IIMB 2027-admissions page (checked 10 Sep 2026) gave a tentative test date of 15 November 2026 for the earlier cycle.",
            exclusion_allowance=OrderedDict(holiday_days=5, school_exam_days=5, slots=28, status="locked", dates_status="provisional"),
            source=[L(H, "Claude.md", "Provisional cycle April2027–March2028"), L(H, C12, "DI begins 7 June."),
                    L(H, C12, "Pre-IIMB full-mock phase is 16 October–10 November"),
                    L(H, f"{OPS}/IPMAT_WEB_REFERENCE_REVIEW.md", "tentative test 15 November 2026"),
                    L(H, "Claude.md", "Holiday/school-exam allowances:28 slots")],
        ),
    )
    write("academic/ipmat-baseline.json",
          ["Locked IPMAT/combined-entrance teaching baseline (253 classes) and the latest Class 12 override (305 classes), with lineage.",
           "All counts are planned classes/papers. Nothing here is delivered work. 'locked' = approved for planning by the user in conversation.",
           "The Class 12 override supersedes the 313- and 360-class allocations for the Class 12 cohort only."],
          body, ["quant_teaching_blocks", "quant_higher_maths", "verbal_teaching_blocks", "verbal_teaching_topics",
                 "lr_teaching_topics", "di_teaching_topics", "lr_di_teaching_sequence", "assessments.verbal_test_groups",
                 "assessments.full_mocks.workbook_allocation", "assessments.assessment_budget_rows",
                 "practice_allocations_programme_level.quant_practice_base_rows", "practice_allocations_programme_level.lr_practice",
                 "practice_allocations_programme_level.di_practice"])


def _row_values(ws, r, maxc):
    return [ws.cell(r, c).value for c in range(1, maxc + 1)]


def build_class12_plan():
    wbf, wbv = wb(PLANNER, False), wb(PLANNER, True)
    # ---- lessons
    lf, lv = wbf["Lesson planner"], wbv["Lesson planner"]
    hdr = [lv.cell(4, c).value for c in range(1, 18)]
    lessons = []
    for r in range(5, lv.max_row + 1):
        if not lv.cell(r, 1).value:
            continue
        v = dict(zip(hdr, _row_values(lv, r, 17)))
        lessons.append(OrderedDict(
            lesson_id=v["Lesson ID"], month=v["Month"], subject=v["Subject"], session=v["Session"].lower(),
            chapter=v["Chapter"], coverage=v["Subtopic / session coverage"], planned_minutes=v["Planned minutes"],
            planned_minutes_formula=lf.cell(r, 7).value, planned_date=jsonable(v["Planned date"]),
            chapter_test_ids=[x.strip() for x in (v["Chapter test ID(s)"] or "").split(",") if x.strip()],
            faculty=None, actual_date=jsonable(v["Actual date"]), actual_minutes=v["Actual minutes"],
            delivery_status_in_source=v["Delivery status"],
            status="planned",
            source=X(PLANNER, "Lesson planner", f"A{r}:Q{r}")))
    # chapter sequence summary
    chap = OrderedDict()
    for l in lessons:
        k = (l["subject"], l["chapter"])
        c = chap.setdefault(k, OrderedDict(subject=l["subject"], chapter=l["chapter"], teaching_classes=0, practice_classes=0,
                                           first_planned_date=l["planned_date"], last_planned_date=l["planned_date"], lesson_ids=[]))
        c["teaching_classes" if l["session"] == "teaching" else "practice_classes"] += 1
        c["first_planned_date"] = min(c["first_planned_date"], l["planned_date"])
        c["last_planned_date"] = max(c["last_planned_date"], l["planned_date"])
        c["lesson_ids"].append(l["lesson_id"])
    chapters = []
    for c in chap.values():
        c["planned_classes"] = c["teaching_classes"] + c["practice_classes"]
        c["status"] = "planned"
        c["source"] = X(PLANNER, "Lesson planner", "A5:Q309 (aggregated by Subject + Chapter)")
        chapters.append(c)

    # ---- overview + capacity math (cells + formulas)
    def cell(sheet, ref):
        return OrderedDict(cell=f"'{sheet}'!{ref}", label=None, formula=(wbf[sheet][ref].value if isinstance(wbf[sheet][ref].value, str) and str(wbf[sheet][ref].value).startswith("=") else None),
                           value=jsonable(wbv[sheet][ref].value))

    def lab(sheet, ref, label_ref):
        d = cell(sheet, ref)
        d["label"] = wbv[sheet][label_ref].value
        return d

    AB = "Assessment budget"
    capacity = OrderedDict(
        window="1 April - 15 October 2027 (provisional)",
        cells=[lab(AB, "B28", "A28"), lab(AB, "B29", "A29"), lab("Overview", "B14", "A14"), lab(AB, "B30", "A30"), lab(AB, "B31", "A31"),
               lab(AB, "B32", "A32"), lab(AB, "B33", "A33"), lab(AB, "B34", "A34"), lab(AB, "B35", "A35"), lab(AB, "B52", "A52"),
               lab(AB, "B53", "A53"), lab(AB, "E36", "A36"), lab(AB, "E37", "A37"), lab(AB, "B38", "A38"), lab("Overview", "B13", "A13")],
        derivation="gross slots = 157 regular teaching days x 2 classes + 31 third classes = 345; net = 345 - 28 excluded slots = 317; planned = 305 classes; headroom 345-305 = 40 before exclusions, 12 after.",
        whole_year=[lab(AB, "E20", "A20"), lab(AB, "E21", "A21"), lab(AB, "E22", "A22"), lab(AB, "E23", "A23"), lab(AB, "E24", "A24")],
        caveat="Capacity totals do not prove a feasible dated schedule; assessments are not proved to fit these slots.",
        status="locked", status_note="28-slot exclusion allowance locked for planning; closure dates provisional.",
        source=[X(PLANNER, AB, "A27:F54"), X(PLANNER, "Overview", "A12:B31")],
    )
    exclusions = []
    for r in range(44, 51):
        exclusions.append(OrderedDict(
            period=wbv[AB].cell(r, 1).value, holiday_days=wbv[AB].cell(r, 2).value, school_exam_days=wbv[AB].cell(r, 3).value,
            slots_per_excluded_day=wbv[AB].cell(r, 4).value, excluded_slots=wbv[AB].cell(r, 5).value,
            excluded_slots_formula=wbf[AB].cell(r, 5).value, basis=wbv[AB].cell(r, 6).value,
            dates=None, status="provisional", source=X(PLANNER, AB, f"A{r}:F{r}")))
    # ---- monthly
    mf, mv = wbf["Monthly allocation"], wbv["Monthly allocation"]
    mh = [mv.cell(4, c).value for c in range(1, 19)]
    monthly = []
    for r in range(5, 18):
        row = OrderedDict()
        for c in range(1, 19):
            h = mh[c - 1]
            val = jsonable(mv.cell(r, c).value)
            fv = mf.cell(r, c).value
            row[h] = val
            if isinstance(fv, str) and fv.startswith("="):
                row.setdefault("formulas", OrderedDict())[h] = fv
        row["status"] = "provisional"
        row["source"] = X(PLANNER, "Monthly allocation", f"A{r}:R{r}")
        monthly.append(row)
    # ---- overview totals
    ov = []
    for r in range(5, 10):
        ov.append(OrderedDict(subject=wbv["Overview"].cell(r, 1).value,
                              teaching=wbv["Overview"].cell(r, 2).value, practice=wbv["Overview"].cell(r, 3).value,
                              total=wbv["Overview"].cell(r, 4).value, hours=wbv["Overview"].cell(r, 5).value,
                              completed_classes=wbv["Overview"].cell(r, 6).value,
                              formulas=OrderedDict((wbv["Overview"].cell(4, c).value, wbf["Overview"].cell(r, c).value) for c in range(2, 8)),
                              status="planned", source=X(PLANNER, "Overview", f"A{r}:G{r}")))
    controls = [OrderedDict(control=wbv["Overview"].cell(r, 1).value, value=jsonable(wbv["Overview"].cell(r, 2).value),
                            source=X(PLANNER, "Overview", f"A{r}:B{r}")) for r in range(13, 32)]
    homework = []
    for r in range(37, 45):
        homework.append(OrderedDict(former_lesson_id=wbv["Overview"].cell(r, 1).value, month=wbv["Overview"].cell(r, 2).value,
                                    subject=wbv["Overview"].cell(r, 3).value, chapter=wbv["Overview"].cell(r, 4).value,
                                    homework_coverage=wbv["Overview"].cell(r, 5).value, classroom_hours_removed=wbv["Overview"].cell(r, 6).value,
                                    homework_status_in_source=wbv["Overview"].cell(r, 7).value, status="planned",
                                    source=X(PLANNER, "Overview", f"A{r}:G{r}")))
    # ---- chapter tests
    tf, tv = wbf["Chapter tests"], wbv["Chapter tests"]
    th = [tv.cell(4, c).value for c in range(1, 17)]
    tests = []
    for r in range(5, tv.max_row + 1):
        if not tv.cell(r, 1).value:
            continue
        v = dict(zip(th, _row_values(tv, r, 16)))
        tests.append(OrderedDict(
            test_id=v["Test ID"], subject=v["Subject"], coverage=v["Coverage"],
            prerequisite_lesson_ids=[x.strip() for x in (v["Prerequisite lesson IDs"] or "").split(",") if x.strip()],
            planned_topic_completion=jsonable(v["Planned topic completion"]), planned_topic_completion_formula=tf.cell(r, 5).value,
            saturday_test_date=jsonable(v["Saturday test date"]), sunday_discussion_date=jsonable(v["Sunday discussion date"]),
            test_minutes=v["Test minutes"], discussion_minutes=v["Discussion minutes"], combined_minutes=v["Combined minutes"],
            order_on_day=v["Order on day"], date_check=v["Date check"], schedule_constraint=v["Schedule constraint"],
            test_status_in_source=v["Test status"], status="planned", source=X(PLANNER, "Chapter tests", f"A{r}:P{r}")))
    # ---- weekend map
    wf_, wv_ = wbf["Weekend map"], wbv["Weekend map"]
    weekends = []
    for r in range(5, 38):
        weekends.append(OrderedDict(
            saturday=jsonable(wv_.cell(r, 1).value), sunday=jsonable(wv_.cell(r, 2).value),
            saturday_tests=[x.strip() for x in str(wv_.cell(r, 3).value).split(",") if x.strip() and x.strip() != "None"],
            test_minutes=wv_.cell(r, 5).value, discussion_minutes=wv_.cell(r, 6).value, total_minutes=wv_.cell(r, 7).value,
            weekend_cap_minutes=wv_.cell(r, 8).value, remaining_minutes=wv_.cell(r, 9).value,
            test_minutes_formula=wf_.cell(r, 5).value, risk=wv_.cell(r, 10).value, status="proposed",
            source=X(PLANNER, "Weekend map", f"A{r}:J{r}")))
    wrules = [OrderedDict(rule=wv_.cell(r, 1).value, detail=wv_.cell(r, 3).value, source=X(PLANNER, "Weekend map", f"A{r}:J{r}")) for r in range(40, 50)]
    wmap_json = json.loads(abspath(H, "work/class12-weekend-map.json").read_text(encoding="utf-8"))
    touch(H, "work/class12-weekend-map.json")
    summ = json.loads(abspath(H, "work/class12-accelerated-summary.json").read_text(encoding="utf-8"))
    touch(H, "work/class12-accelerated-summary.json")

    test_dates = {t["test_id"]: t["saturday_test_date"] for t in tests}
    after15 = sorted([k for k, d in test_dates.items() if d > "2027-10-15"])
    after10nov = sorted([k for k, d in test_dates.items() if d > "2027-11-10"])
    conflicts = [
        OrderedDict(id="C12-CONFLICT-001", kind="exam_date_clash",
                    description="Last Verbal paper VT14-B is set for Saturday 13 Nov 2027 with its discussion on Sunday 14 Nov 2027, the provisional (unverified) IIMB exam date.",
                    tests=after10nov, status="open",
                    source=[X(PLANNER, "Weekend map", "A37:J37"), L(H, f"{OPS}/CLASS12_ACCELERATED_BASELINE.md", "The last Verbal paper clashes")]),
        OrderedDict(id="C12-CONFLICT-002", kind="overlaps_mock_phase",
                    description="Chapter tests scheduled after the 15 Oct teaching target overlap the proposed pre-IIMB mock phase (16 Oct-10 Nov); mocks/sectionals are not in the weekend cap.",
                    tests=after15, count=len(after15), status="open",
                    source=[X(PLANNER, "Weekend map", "A33:J37"), L(H, f"{OPS}/CLASS12_ACCELERATED_BASELINE.md", "Twelve papers overlap the proposed mock phase.")]),
        OrderedDict(id="C12-CONFLICT-003", kind="unmapped_assessments",
                    description="Sectionals (30) and full mocks are not mapped to dates and must share remaining weekend capacity rather than exceed the 210-minute cap.",
                    status="open", source=[X(PLANNER, "Weekend map", "A46:J46")]),
        OrderedDict(id="C12-CONFLICT-004", kind="stale_document",
                    description="IPMAT_LOCKED_BASELINES.md header and work/class12-accelerated-summary.json still describe the 313-class version; the workbook (305) is the latest saved record.",
                    status="documented",
                    source=[L(H, f"{OPS}/IPMAT_LOCKED_BASELINES.md", "Current Class 12 plan is 253 teaching + 60 practice = 313"),
                            S(H, "work/class12-accelerated-summary.json", "classCount")]),
    ]
    body = OrderedDict(
        summary=OrderedDict(
            lessons=len(lessons), teaching=sum(l["session"] == "teaching" for l in lessons), practice=sum(l["session"] == "practice" for l in lessons),
            by_subject=OrderedDict((s, sum(l["subject"] == s for l in lessons)) for s in ["Quant", "Verbal", "LR", "DI"]),
            class_minutes=75, total_hours=len(lessons) * 75 / 60,
            first_planned_date=min(l["planned_date"] for l in lessons), last_planned_date=max(l["planned_date"] for l in lessons),
            chapter_tests=len(tests), chapter_test_hours=sum((t["test_minutes"] or 0) + (t["discussion_minutes"] or 0) for t in tests) / 60,
            weekend_map=OrderedDict(finish=wmap_json["finish"], completed_by_oct15=wmap_json["completedByOct15"],
                                    completed_by_nov10=wmap_json["completedByNov10"], after_oct15=wmap_json["afterOct15"],
                                    source=S(H, "work/class12-weekend-map.json", "top-level keys")),
            superseded_summary_json=OrderedDict(classCount=summ["classCount"], hours=summ["hours"], regularDays=summ["regularDays"],
                                                additionalClasses=summ["additionalClasses"], grossSlots=summ["grossSlots"], headroom=summ["headroom"],
                                                firstDI=summ["firstDI"], firstHigher=summ["firstHigher"], lastDate=summ["lastDate"],
                                                status="superseded", note="313-class version (before the eight practice classes were removed).",
                                                source=S(H, "work/class12-accelerated-summary.json", "top-level keys")),
            status="approved", status_note="Counts approved; month placement and dates provisional; delivery fields empty in source.",
            source=X(PLANNER, "Overview", "A1:G9"),
        ),
        overview_totals=ov,
        planning_controls=controls,
        capacity_math=capacity,
        exclusions=exclusions,
        monthly_allocation=monthly,
        chapters=chapters,
        lessons=lessons,
        practice_moved_to_homework=homework,
        chapter_tests=tests,
        weekend_map=weekends,
        weekend_rules=wrules,
        known_conflicts=conflicts,
    )
    write("academic/class12-plan.json",
          ["IPMAT Class 12 (April 2027 start) course planner: the latest saved workbook (305 classes) is authoritative.",
           "Every lesson is 'planned'; delivery fields (faculty, actual date/minutes) are empty in the source and stay null. Faculty names are never extracted.",
           "Formulas are copied verbatim with their cached values so importers can re-implement the capacity math.",
           "Weekend map and chapter-test dates are a draft (not locked)."],
          body, ["overview_totals", "exclusions", "monthly_allocation", "chapters", "lessons", "practice_moved_to_homework",
                 "chapter_tests", "weekend_map", "known_conflicts"])


def build_concept_books():
    wbf, wbv = wb(BOOKS, False), wb(BOOKS, True)
    ov = wbv["Overview"]
    books = []
    sheet_by_no = {1: "1 RC and Verbal", 2: "2 Quants", 3: "3 Higher Maths", 4: "4 LR and DI", 5: "5 CR", 6: "6 Grammar"}
    for r in range(5, 11):
        no = ov.cell(r, 1).value
        sh = sheet_by_no[no]
        ws, wsf = wbv[sh], wbf[sh]
        hdr = [ws.cell(4, c).value for c in range(1, ws.max_column + 1)]
        chapters, opening = [], None
        for rr in range(5, ws.max_row + 1):
            cid = ws.cell(rr, 1).value
            if not cid or not str(cid).startswith(f"B{no}-"):
                continue
            v = dict(zip(hdr, _row_values(ws, rr, ws.max_column)))
            rec = OrderedDict(chapter_id=cid, chapter_number=(None if cid.endswith("OPEN") else int(cid.split("-")[1])),
                              section=v.get("Section"), title=v.get("Chapter"),
                              subtopics=[x.strip() for x in (v.get("Subtopic index") or "").split(";") if x.strip()],
                              content_link=v.get("Content / file link"), content_status_in_source=v.get("Content status"),
                              content_status="not_started", status="locked", source=X(BOOKS, sh, f"A{rr}:{ws.cell(4, ws.max_column).column_letter}{rr}"))
            if no == 5:
                q = OrderedDict(concept_building=v.get("Concept-building questions"), practice_application=v.get("Practice/Application questions"),
                                rankers_zone=v.get("Elevate Ranker’s Zone questions"), total=v.get("Total questions"),
                                total_formula=wsf.cell(rr, 11).value, count_status="planned", written=0,
                                note="Planned question counts, not written questions.")
                rec["planned_questions"] = q
            if cid.endswith("OPEN"):
                rec["counted_in_chapter_total"] = False
                opening = rec
            else:
                chapters.append(rec)
        scope_row = [rr for rr in range(5, ws.max_row + 1) if ws.cell(rr, 1).value == "Scope"]
        books.append(OrderedDict(
            book_no=no, book_id=f"B{no}", title=ov.cell(r, 2).value, sheet=sh,
            chapter_count=len(chapters), chapter_count_formula=wbf["Overview"].cell(r, 3).value, chapter_count_cached=ov.cell(r, 3).value,
            opening_unit=opening, chapters=chapters,
            scope_note=(ws.cell(scope_row[0], 4).value if scope_row else None),
            content="deliberately empty (index only)", status="locked",
            source=[X(BOOKS, "Overview", f"A{r}:E{r}"), X(BOOKS, sh, f"A1:{ws.cell(4, ws.max_column).column_letter}{ws.max_row}")]))
    cr = wbv["5 CR"]
    cr_tot = OrderedDict(concept_building=cr["H23"].value, practice_application=cr["I23"].value, rankers_zone=cr["J23"].value, total=cr["K23"].value,
                         formulas=OrderedDict(H23=wbf["5 CR"]["H23"].value, I23=wbf["5 CR"]["I23"].value, J23=wbf["5 CR"]["J23"].value, K23=wbf["5 CR"]["K23"].value),
                         split_rule="50-question chapters 10/25/15; 80-question chapters 15/40/25; 7 x 50 + 10 x 80 = 1,150",
                         count_status="planned", written=0,
                         excluded="mixed-passage section (pending), class sheets, DPP and tests",
                         superseded_proposals=["1,890", "1,840"],
                         status="locked",
                         source=[X(BOOKS, "5 CR", "G23:K27"), L(H, "Claude.md", "Total **1,150 =220 concept +575 practice +355 Ranker**")])
    unrecoverable = OrderedDict(
        description="Earlier Quants/Higher Maths practice-question model: Narrow 60 = 12/30/18, Wide 100 = 20/50/30, Broad 150 = 30/75/45. Recorded totals: Quants 4,470 across 39 units (7 narrow / 15 wide / 17 broad), Higher Maths 1,220 across 11, combined 5,690.",
        quants_total=4470, quants_units=39, quants_category_counts=OrderedDict(narrow=7, wide=15, broad=17),
        higher_maths_total=1220, higher_maths_units=11, combined_total=5690,
        chapter_to_category_mapping=None,
        mapping_status="unrecoverable",
        note="The exact chapter-to-category mapping is not reliably saved. Do not invent it or call a reconstruction locked. Counts are planned, not written. Verbal practice allocation is pending.",
        count_status="planned",
        status="unverified",
        source=[L(H, "Claude.md", "Earlier Quants/Higher Maths model")])
    history = [
        OrderedDict(change="B4-10 Analogy and B4-11 Classification merged into B4-10 Analogy and Classification; B4-11 retired, later IDs kept", status="locked",
                    source=L(H, "Claude.md", "Merge B4-10 Analogy and B4-11 Classification")),
        OrderedDict(change="B1-25 Conversation Analysis moved to B5-07; subsequent CR IDs shifted by 1", status="locked",
                    source=L(H, "Claude.md", "Move B1-25 Conversation Analysis to **B5-07**")),
        OrderedDict(change="B1-12..B1-17 vocabulary moved to B6-18..B6-23; remaining B1 IDs unchanged (gaps are deliberate)", status="locked",
                    source=L(H, "Claude.md", "Move B1-12 throughB1-17 vocabulary")),
    ]
    total = sum(b["chapter_count"] for b in books)
    write("academic/concept-books.json",
          ["Six concept-book chapter indices (index only; content deliberately empty). Chapter IDs are stable and have deliberate gaps; never renumber.",
           "Every question count is tagged count_status='planned' and written=0: these are planned allocations, not written or audited questions."],
          OrderedDict(
              summary=OrderedDict(books=len(books), numbered_chapters=total, numbered_chapters_formula=wbf["Overview"]["C12"].value,
                                  numbered_chapters_cached=wbv["Overview"]["C12"].value, opening_units=1, status="locked",
                                  source=X(BOOKS, "Overview", "A4:E20")),
              records=books, cr_question_bank=cr_tot, quant_higher_maths_question_model=unrecoverable, id_history=history),
          ["records", "id_history"])


def build_ca_foundation():
    rel = "outputs/CA-Foundation-Accountancy-Full-Plan.md"
    ls = lines(H, rel)
    tabs = md_tables(H, rel)
    chapters = []
    for t in tabs:
        m = re.match(r"(\d+)\. (.+)", t["heading"] or "")
        if not m:
            continue
        no = int(m.group(1))
        topics = [OrderedDict(topic_id=c[0], topic=c[1], teaching_hours=num(c[2]), practice_hours=num(c[3]), total_hours=num(c[4]),
                              status="provisional", source=S(H, rel, f"line {ln}")) for ln, c in t["rows"] if c[0].startswith("ACC-")]
        tot = [c for ln, c in t["rows"] if "Total" in c[1]][0]
        aline = [(i + 1, x) for i, x in enumerate(ls) if x.startswith(f"Assessment ACC-T{no:02d}:")][0]
        am = re.search(r"([\d.]+) hour test \+ ([\d.]+) hour compulsory discussion", aline[1])
        chapters.append(OrderedDict(
            chapter_no=no, title=m.group(2), topics=topics,
            teaching_hours=num(tot[2]), practice_hours=num(tot[3]), total_hours=num(tot[4]),
            assessment=OrderedDict(test_id=f"ACC-T{no:02d}", test_hours=float(am.group(1)), discussion_hours=float(am.group(2)),
                                   status="provisional", source=S(H, rel, f"line {aline[0]}")),
            status="provisional", source=S(H, rel, f"line {t['heading_line']}")))
    # cross-check against the Operations workbook
    wv = wb(OPSWB, True)["Accountancy Plan"]
    wbrows = {wv.cell(r, 2).value: (wv.cell(r, 5).value, wv.cell(r, 6).value) for r in range(5, 51) if wv.cell(r, 2).value}
    mism = []
    for c in chapters:
        for t in c["topics"]:
            w = wbrows.get(t["topic_id"])
            if w is None or (num(w[0]), num(w[1])) != (t["teaching_hours"], t["practice_hours"]):
                mism.append(t["topic_id"])
    tt = wb(OPSWB, True)["Test Tracker"]
    wtests = {tt.cell(r, 2).value: (tt.cell(r, 4).value, tt.cell(r, 5).value) for r in range(5, 16)}
    tmism = [c["assessment"]["test_id"] for c in chapters
             if wtests.get(c["assessment"]["test_id"]) != (num(c["assessment"]["test_hours"]), num(c["assessment"]["discussion_hours"]))]
    draft = md_tables(H, f"{OPS}/CA_FOUNDATION_ACCOUNTANCY_DRAFT.md")[0]
    v01 = [OrderedDict(chapter=c[0], teaching_hours=num(c[1]), practice_hours=num(c[2]), total_hours=num(c[3]))
           for ln, c in draft["rows"] if c[0] != "Total"]
    body = OrderedDict(
        summary=OrderedDict(
            batch_id="CAF-SEP27-REG", programme="CA Foundation", target_attempt="September 2027", route="Regular", subject="Accountancy",
            plan_version="v0.2", chapters=len(chapters), topic_blocks=sum(len(c["topics"]) for c in chapters),
            teaching_hours=sum(c["teaching_hours"] for c in chapters), practice_hours=sum(c["practice_hours"] for c in chapters),
            teaching_plus_practice_hours=sum(c["total_hours"] for c in chapters),
            chapter_test_hours=sum(c["assessment"]["test_hours"] for c in chapters),
            discussion_hours=sum(c["assessment"]["discussion_hours"] for c in chapters),
            first_pass_student_hours=175, faculty_hours=163,
            class_equivalents_note="150 h = 120 x 75-minute class equivalents; not an approved 120-class timetable.",
            excluded="revision, full mocks, marking, repeat catch-up, remediation and contingency",
            chapter_structure_source="ICAI study material, May 2027 onwards (https://www.icai.org/post/sm-foundation-p1-may2027)",
            dates=None, session_length_status="unresolved",
            workbook_cross_check=OrderedDict(topic_hour_mismatches=mism, test_hour_mismatches=tmism,
                                             source=[X(OPSWB, "Accountancy Plan", "A5:P50"), X(OPSWB, "Test Tracker", "A5:M15")]),
            status="provisional",
            source=[L(H, rel, "Teaching plus guided practice: 150 hours."), L(H, f"{OPS}/ACADEMIC_PLANNING_DECISIONS.md", "All 11 chapters expanded into 46 topic blocks")],
        ),
        records=chapters,
        v01_chapter_estimates=OrderedDict(rows=v01, status="superseded", note="v0.1 chapter-level draft; v0.2 keeps the same chapter totals and splits them into 46 blocks.",
                                          source=S(H, f"{OPS}/CA_FOUNDATION_ACCOUNTANCY_DRAFT.md", f"lines {draft['start_line']}-{draft['rows'][-1][0]}")),
        other_subject_reference_budgets=[
            OrderedDict(subject="Business Law", hours=120, status="provisional", source=X(OPSWB, "Decisions", "A24:D24")),
            OrderedDict(subject="Quantitative Aptitude", hours=150, status="provisional", source=X(OPSWB, "Decisions", "A24:D24")),
            OrderedDict(subject="Business Economics", hours=100, status="provisional", source=X(OPSWB, "Decisions", "A24:D24")),
        ],
        calendar_rules=[
            OrderedDict(rule="March-April: weekdays teaching; Saturday tests; regular Sunday holiday", status="approved", source=X(OPSWB, "Decisions", "A16:D16")),
            OrderedDict(rule="May-June: Saturday teaching; Sunday tests; extra weekday hours allowed", status="approved", source=X(OPSWB, "Decisions", "A17:D17")),
            OrderedDict(rule="June-end first coverage; July revision; August revision and full mocks", status="approved", source=X(OPSWB, "Decisions", "A18:D18")),
            OrderedDict(rule="One main batch with temporary catch-up groups and merging", status="approved", source=X(OPSWB, "Decisions", "A19:D19")),
            OrderedDict(rule="Exact March/April start date, holidays and faculty hours", status="open", source=X(OPSWB, "Decisions", "A20:D20")),
            OrderedDict(rule="Proposed weekly split 6 Accounts / 4 Law / 6 QA / 4 Economics", status="rejected",
                        status_note="NOT accepted before the stream was paused", source=L(H, f"{OPS}/IPMAT_REFERENCE_NOTES.md", "Proposed 6 Accounts / 4 Law / 6 QA / 4 Economics weekly split was NOT accepted")),
        ],
    )
    write("academic/ca-foundation-accountancy.json",
          ["CA Foundation Accountancy plan v0.2 (Sept 2027 Regular): 11 chapters / 46 topic blocks. All hours provisional planning judgments, not ICAI-prescribed.",
           "Cross-checked topic by topic against the Operations workbook 'Accountancy Plan' and 'Test Tracker' sheets (mismatch lists in summary.workbook_cross_check)."],
          body, ["records", "other_subject_reference_budgets", "calendar_rules"])


def build_online_accountancy():
    src_b, line_b = LT(H, "Claude.md", "Accountancy conversation baseline:")
    src_c, line_c = LT(H, "Claude.md", "CBSE chapter teaching allocations:")
    alloc_text = line_c.split(":", 1)[1].split(".")[0]
    chapters = []
    for i, part in enumerate(alloc_text.split(";"), start=1):
        m = re.match(r"\s*(.+?)\s*(\d+)\s*$", part)
        chapters.append(OrderedDict(seq=i, chapter=m.group(1),
                                    chapter_note=("source abbreviation; read as 'Change in profit-sharing ratio'" if m.group(1) == "ChangePSR" else None),
                                    cbse_teaching_hours=int(m.group(2)), class_minutes=60,
                                    classes=int(m.group(2)), status="provisional", source=src_c))
    steps = [
        OrderedDict(step="CBSE teaching", add_hours=118, running_total=118),
        OrderedDict(step="CUET approach", add_hours=4, running_total=122),
        OrderedDict(step="Practice (board 24 / CUET 16)", add_hours=40, running_total=162, split=OrderedDict(board=24, cuet=16)),
        OrderedDict(step="Assessments", add_hours=30, running_total=192),
        OrderedDict(step="Discussions", add_hours=13, running_total=205),
        OrderedDict(step="Revision (board 15 / CUET 6)", add_hours=21, running_total=226, split=OrderedDict(board=15, cuet=6)),
    ]
    for s in steps:
        s["status"] = "provisional"
        s["source"] = src_b
    subjects = [
        OrderedDict(subject="Accountancy", status="provisional", detail="226-hour itemised plan (this file)", source=src_b),
        OrderedDict(subject="Mathematics", status="not_started", source=L(H, "Claude.md", "Subjects Accounts, Maths, BST, Economics, English")),
        OrderedDict(subject="Business Studies", status="not_started", source=L(H, "Claude.md", "Subjects Accounts, Maths, BST, Economics, English")),
        OrderedDict(subject="Economics", status="not_started", note="Needs additional content", source=L(H, "Claude.md", "Subjects Accounts, Maths, BST, Economics, English")),
        OrderedDict(subject="English", status="not_started", note="English board and entrance Verbal are different", source=L(H, "Claude.md", "Subjects Accounts, Maths, BST, Economics, English")),
    ]
    write("academic/online-class12-accountancy.json",
          ["Online Class 12 boards + CUET: only Accountancy is planned (226 hours, 60-minute classes). Source is the handover narrative (Claude.md section 9); no workbook holds this plan.",
           "CBSE chapter hours sum to the 118 CBSE teaching hours; the remaining 108 hours (CUET approach, practice, assessments, discussions, revision) are not itemised per chapter in the source.",
           "No project guidance hours (removing institute project guidance does not remove school/board obligations). Assessment durations and current-year content must be checked before implementation.",
           "classes = hours because classes are 60 minutes."],
          OrderedDict(
              summary=OrderedDict(programme="ONL-C12-CUET", subject="Accountancy", class_minutes=60, total_hours=226,
                                  cbse_teaching_hours=sum(c["cbse_teaching_hours"] for c in chapters), status="provisional",
                                  programme_status="paused", source=[src_b, src_c, L(H, "Claude.md", "Distinct from IPMAT: **60-minute teaching classes**")]),
              build_up=steps, records=chapters, subjects=subjects),
          ["records", "build_up", "subjects"])


EXAMS5 = ["IIMB UG-AT", "IPMAT Indore", "IIM Kozhikode BMS", "IPMAT Rohtak", "JIPMAT"]


def build_combined_syllabus():
    rel = "outputs/Combined-IIM-Entrance-Syllabus.md"
    tabs = md_tables(H, rel)
    areas = []
    for t in tabs:
        m = re.match(r"(\d)\. (.+)", t["heading"] or "")
        if not m:
            continue
        mods = []
        for ln, c in t["rows"]:
            mm = re.match(r"([A-Z]\d{2}) (.+)", c[0])
            mods.append(OrderedDict(module_id=mm.group(1), module=mm.group(2),
                                    topics=[x.strip() for x in c[1].split(";") if x.strip()],
                                    exams=EXAMS5, exam_mapping_basis="combined programme: all students receive the combined concepts; not a claim that each topic appears in each exam",
                                    review_flag=("coverage review" in mm.group(2).lower() or "review" in mm.group(2).lower()),
                                    status="proposed", source=S(H, rel, f"line {ln}")))
        areas.append(OrderedDict(area=m.group(2), modules=mods, status="proposed", source=S(H, rel, f"line {t['heading_line']}")))
    app_src, app_line = LT(H, rel, "All students receive the combined concepts.")
    layer = [
        OrderedDict(exam="IPMAT Indore", application="QA MCQ/short-answer and timed sections"),
        OrderedDict(exam="IIMB UG-AT", application="integrated Quant/DI plus LR/VARC"),
        OrderedDict(exam="IIM Kozhikode BMS", application="QA/VA"),
        OrderedDict(exam="IPMAT Rohtak", application="QA/LR/VA"),
        OrderedDict(exam="JIPMAT", application="QA/DILR/VARC"),
    ]
    for x in layer:
        x["status"] = "proposed"
        x["source"] = app_src
    # quant topic evidence matrix
    ws = wb(QCMP, True)["Topic comparison"]
    hdr = [ws.cell(4, c).value for c in range(1, 12)]
    legend = OrderedDict(N="named by the official source", L="school level only", B="broad parent group (editorial mapping)",
                         S="observed in official sample", U="unspecified (does NOT mean excluded)", X="beyond the stated level (not an official exclusion)")
    matrix = []
    for r in range(5, 22):
        v = _row_values(ws, r, 11)
        matrix.append(OrderedDict(topic=v[0], our_location=v[1],
                                  evidence=OrderedDict((hdr[i], v[i]) for i in range(2, 10)),
                                  interpretation=v[10], status="documented", source=X(QCMP, "Topic comparison", f"A{r}:K{r}")))
    es = wb(QCMP, True)["Exam sources"]
    esrc = [OrderedDict(id=es.cell(r, 1).value, exam=es.cell(r, 2).value, source_cycle=es.cell(r, 3).value, evidence_type=es.cell(r, 4).value,
                        quant_scope=es.cell(r, 5).value, limits=es.cell(r, 6).value, url=es.cell(r, 7).value, status="documented",
                        source=X(QCMP, "Exam sources", f"A{r}:G{r}")) for r in range(5, 14)]
    write("academic/combined-iim-syllabus.json",
          ["Combined Undergraduate Entrance Syllabus v1.0 (curriculum draft for discussion): one programme for IIMB UG-AT, IPMAT Indore, IIM Kozhikode BMS, IPMAT Rohtak and JIPMAT.",
           "The markdown does NOT map individual topics to exams; every module applies to all five targets, with exam differences handled in a separate practice/mock 'application layer'.",
           "Per-topic exam evidence exists only for Quant, in Quant-Exam-Index-Comparison.xlsx (checked 11 Sep 2026; eight exams; IPMAT Rohtak is not in that comparison). Its 'Our location' column refers to an older 32-chapter Quant index, not the locked 38-chapter Book 2.",
           "Official scope is distinguished from coaching-derived detail; verify the applicable year's official syllabus before use."],
          OrderedDict(target_exams=EXAMS5, records=areas, exam_application_layer=layer,
                      quant_topic_evidence_legend=legend, quant_topic_evidence=matrix, quant_evidence_sources=esrc),
          ["records", "exam_application_layer", "quant_topic_evidence", "quant_evidence_sources"])


def build_assessment_patterns():
    C = "content-os"
    W = f"{OPS}/IPMAT_WEB_REFERENCE_REVIEW.md"
    recs = []

    def add(**k):
        recs.append(OrderedDict(k))

    add(exam="CLAT UG", cycle="CLAT 2027", exam_date="2026-12-06", exam_time="14:00-16:00 IST", registration_closes="2026-10-31",
        total_questions=120, duration_minutes=120, marks_per_correct=1, negative_marking_per_wrong=0.25, mode="pen and paper (OMR)",
        sections=[OrderedDict(name=n, questions=None) for n in ["English", "Current Affairs/GK", "Legal Reasoning", "Logical Reasoning", "Quantitative Techniques"]],
        section_question_counts="unknown (not stated in any legacy source)",
        verification_status="secondary_source",
        verification_note="facts.md cites 'official, via BW Education / Testbook' for dates; pattern stated in the CLAT strategy and the CLAT-008 script; answer key/results timing unverified.",
        status="documented",
        source=[L(C, "courses/clat/facts.md", "CLAT 2027: exam 6 Dec 2026"), L(C, "courses/clat/facts.md", "Sections: English"),
                L(C, "accounts/instagram-clat/strategy-oct-dec-2026.md", "**Pattern:** 120 questions"),
                L(C, "library/CLAT-008-8-week-plan/script.md", "+1 / -0.25")])
    add(exam="IIM Bangalore UG Admissions Test (IIMB UG-AT)", cycle="2026 test / 2027 intake (FAQ dated 2026-08)", exam_date="2026-11-15 (tentative, official page)",
        total_questions=60, duration_minutes=135, question_type="MCQ",
        sections=[OrderedDict(name="Quantitative Aptitude / Data Interpretation", questions=30), OrderedDict(name="Logical Reasoning", questions=15),
                  OrderedDict(name="Verbal Ability / Reading Comprehension", questions=15)],
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown (not recorded in legacy sources)",
        syllabus_scope="NCERT Classes X-XII; Mathematics in XI/XII mandatory (applied mathematics accepted)",
        superseded=["Older October 2025 FAQ stated 120 minutes; must not replace current-cycle rules."],
        verification_status="official_source_cited", verification_note="Checked 10 Sep 2026 against https://ug.iimb.ac.in/wp-content/uploads/2026/08/UG-Admissions-FAQ-2026.pdf; refresh for each cycle.",
        status="documented", source=[L(H, W, "Current IIMB FAQ:"), L(H, W, "IIMB 2027 admissions:")])
    add(exam="IPMAT Indore", cycle="2026",
        total_questions=None, duration_minutes=120, duration_note="three separately timed 40-minute sections (3 x 40 derived; total not stated as such)",
        sections=[OrderedDict(name="Quantitative Ability (MCQ)", questions=None, minutes=40), OrderedDict(name="Quantitative Ability (short answer)", questions=None, minutes=40),
                  OrderedDict(name="Verbal Ability", questions=None, minutes=40)],
        marks_per_correct=None, negative_marking_per_wrong=None,
        marking_scheme="MCQ carries a penalty (value not recorded); no negative marking in short answer",
        verification_status="official_source_cited", verification_note="Checked 10 Sep 2026 against the IIM Indore IPM 2026-31 admission procedure PDF.",
        status="documented", source=[L(H, W, "Indore: https://iimidr.ac.in")])
    add(exam="IPMAT Rohtak", cycle="2026", total_questions=120, duration_minutes=120,
        sections=[OrderedDict(name="Quantitative Ability", questions=40), OrderedDict(name="Logical Reasoning", questions=40), OrderedDict(name="Verbal Ability", questions=40)],
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown (not recorded in legacy sources)",
        notes=["Legal reasoning belongs to the optional IPL selection, not standard IPM scope."],
        verification_status="official_source_cited", verification_note="Checked 10 Sep 2026 against https://iimrohtak.ac.in/ipm-admission.php",
        status="documented", source=[L(H, W, "Rohtak: https://iimrohtak.ac.in")])
    add(exam="JIPMAT (IIM Jammu, IIM Bodh Gaya; conducted by NTA)", cycle="2026", total_questions=100, duration_minutes=150,
        sections=[OrderedDict(name="Quantitative Aptitude", questions=33), OrderedDict(name="Data Interpretation and Logical Reasoning", questions=33),
                  OrderedDict(name="Verbal Ability and Reading Comprehension", questions=34)],
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown (not recorded in legacy sources)",
        syllabus_scope="QA officially up to Class 10",
        verification_status="official_source_cited", verification_note="Checked 10 Sep 2026 against the NTA JIPMAT 2026 information bulletin.",
        status="documented", source=[L(H, W, "JIPMAT: https://exams.nta.nic.in/jipmat/")])
    add(exam="IIM Kozhikode BMS Aptitude Test", cycle="2026 FAQ", total_questions=None, duration_minutes=None,
        sections=[OrderedDict(name="Verbal Ability", questions=None), OrderedDict(name="Quantitative Ability", questions=None)],
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown",
        syllabus_scope="Official topic families: grammar/vocabulary/RC; numbers, algebra, geometry incl. coordinates/trigonometry, mensuration, statistics/probability",
        verification_status="official_source_cited", status="documented", source=[L(H, W, "Kozhikode: https://www.iimk.ac.in")])
    for exam, sid, scope in [("NMIMS NPAT", "S6", "Quantitative Reasoning section; SAT-style question types (handout)"),
                             ("Symbiosis SET General", "S7", "Quantitative section (section-level pattern only)"),
                             ("CHRIST BBA entrance", "S8", "Mathematics; Data Analysis and Interpretation (general BBA group)"),
                             ("CUET GAT (501)", "S5", "Numerical ability; simple applications of arithmetic, algebra, geometry, mensuration and statistics")]:
        r = [rr for rr in range(5, 14) if wb(QCMP, True)["Exam sources"].cell(rr, 1).value == sid][0]
        add(exam=exam, cycle="2026", total_questions=None, duration_minutes=None, sections=None,
            marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown", syllabus_scope=scope,
            verification_status="official_source_cited", verification_note="Quant scope only; no full pattern recorded in legacy sources.",
            status="documented", source=[X(QCMP, "Exam sources", f"A{r}:G{r}")])
    add(exam="CUET UG", cycle="2027", total_questions=None, duration_minutes=None, sections=None,
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown",
        notes=["Domain papers follow the Class 12 syllabus.", "2027 changes (e.g. 4-subject cap, 1-day exam) are proposals/rumours; nothing confirmed by NTA as of Oct 2026."],
        verification_status="unverified", status="documented",
        source=[L(C, "courses/cuet/facts.md", "Domain papers follow the Class 12 syllabus"), L(C, "ideas/inbox.md", "4 subjects / 35-40 Qs / 1-day exam are proposals")])
    add(exam="CA Foundation", cycle=None, total_questions=None, duration_minutes=None, sections=None,
        marks_per_correct=None, negative_marking_per_wrong=None, marking_scheme="unknown (no exam pattern recorded in legacy sources)",
        notes=["Papers: Accounting, Business Law, Business Economics, Quantitative Aptitude (Quants, Logical Reasoning, Statistics). Three attempts a year (Jan, May, Sep)."],
        verification_status="unknown", status="documented", source=[L(H, "Claude.md", "Subjects: Accounting, Business Law")])
    internal = [
        OrderedDict(assessment="IPMAT chapter tests (Class 12)", detail="70 papers; per-paper test and discussion minutes in class12-plan.json chapter_tests; Saturday test + Sunday discussion, 210-minute weekend cap",
                    status="proposed", source=X(PLANNER, "Chapter tests", "A4:P74")),
        OrderedDict(assessment="IPMAT sectionals", detail="60-minute tests + 75-minute discussions", status="documented", source=X(PLANNER, "Assessment budget", "A9:F12")),
        OrderedDict(assessment="IPMAT full mocks", detail="Test duration blank pending exam mapping; 150-minute discussion each", status="documented", source=X(PLANNER, "Assessment budget", "A13:F19")),
        OrderedDict(assessment="CA Foundation Accountancy chapter tests", detail="ACC-T01..T09 1 h test + 1 h discussion; ACC-T10/T11 1.5 h + 2 h", status="provisional", source=X(OPSWB, "Test Tracker", "A5:M15")),
        OrderedDict(assessment="Online Class 12 weekly tests", detail="Two flexible test windows per week shared across enrolled subjects", status="locked",
                    source=X("outputs/online-operations/Elevate-Online-Easy.xlsx", "Rules", "A12:C12")),
    ]
    write("academic/assessment-patterns.json",
          ["Exam patterns exactly as found in the legacy sources. Values not stated in a source are null/'unknown'; nothing was filled from memory.",
           "verification_status: official_source_cited (the source cites an official document it checked, with the date), secondary_source, unverified, unknown.",
           "Patterns are cycle-specific; re-verify against the applicable year's official notice before building mocks or publishing."],
          OrderedDict(records=recs, internal_assessment_formats=internal), ["records", "internal_assessment_formats"])



# ============================================================================================
# OPERATIONS
# ============================================================================================
MKT_EASY = "outputs/marketing-operations/Elevate-Marketing-Easy.xlsx"
MKT_OPS = "outputs/marketing-operations/Elevate-Marketing-Operations.xlsx"
ONL_EASY = "outputs/online-operations/Elevate-Online-Easy.xlsx"
ONL_OPS = "outputs/online-operations/Elevate-Online-Operations.xlsx"
SOP_DOCX = "outputs/online-operations/Elevate-Online-Coordinator-SOP.docx"

TEMPLATE_PERSON_LIST = re.compile(r'^"?Maya Chen,')


def _is_formula(v):
    return isinstance(v, str) and v.startswith("=")


def _norm_formula(f: str, row: int) -> str:
    """Replace this-row references (A5, $A5) with {r} so per-row formulas can be compared."""
    return re.sub(rf"(?<![A-Za-z0-9$])(\$?[A-Z]{{1,3}}){row}(?!\d)", r"\1{r}", f)


def extract_sheet(rel: str, sheet: str, include_rows_limit: int = 300) -> OrderedDict:
    wf, wv = wb(rel, False)[sheet], wb(rel, True)[sheet]
    out = OrderedDict(sheet=sheet, state=wf.sheet_state, dimensions=wf.dimensions)
    dvs = []
    for dv in wf.data_validations.dataValidation:
        f1 = dv.formula1
        if f1 and TEMPLATE_PERSON_LIST.match(f1):
            f1 = "[list of 9 template placeholder person names omitted]"
        values = None
        if f1 and f1.startswith('"'):
            values = [x for x in f1.strip('"').split(",")]
        dvs.append(OrderedDict(range=str(dv.sqref), type=dv.type, formula=f1, allowed_values=values))
    out["data_validations"] = dvs
    tables = list(wf.tables.values())
    out["tables"] = [OrderedDict(name=t.name, ref=t.ref) for t in tables]
    if tables:
        t = tables[0]
        (c1, r1), (c2, r2) = [openpyxl.utils.cell.coordinate_from_string(x) for x in t.ref.split(":")]
        ci1, ci2 = openpyxl.utils.column_index_from_string(c1), openpyxl.utils.column_index_from_string(c2)
        headers = [wv.cell(r1, c).value for c in range(ci1, ci2 + 1)]
        out["header_row"] = r1
        out["columns"] = headers
        formula_cols = OrderedDict()
        rows = []
        prefilled = OrderedDict()
        for r in range(r1 + 1, r2 + 1):
            row = OrderedDict()
            for c in range(ci1, ci2 + 1):
                h = headers[c - ci1]
                fv = wf.cell(r, c).value
                if _is_formula(fv):
                    pat = _norm_formula(fv, r)
                    fc = formula_cols.setdefault(h, OrderedDict(template=pat, first_row=r, rows=0, variants=0))
                    fc["rows"] += 1
                    if pat != fc["template"]:
                        fc["variants"] += 1
                    continue
                if fv not in (None, ""):
                    row[h] = jsonable(fv)
            if row:
                row["_row"] = r
                rows.append(row)
        out["data_rows_prepared"] = r2 - r1
        input_keys = Counter(k for row in rows for k in row if k != "_row")
        out["rows_with_input_values"] = len(rows)
        out["formula_columns"] = formula_cols
        # placeholder detection: every non-empty row only carries pre-allocated ID/account values
        id_col = headers[0]
        placeholder_keys = {id_col} | {k for k, n in input_keys.items()
                                       if n == len(rows) and len({row[k] for row in rows}) == 1}
        only_placeholders = rows and all(set(row) - {"_row"} <= placeholder_keys for row in rows)
        if only_placeholders:
            ids = [row[id_col] for row in rows if id_col in row]
            out["placeholder_rows"] = OrderedDict(
                count=len(rows), id_first=ids[0] if ids else None, id_last=ids[-1] if ids else None,
                constant_values=OrderedDict((k, rows[0][k]) for k in placeholder_keys if k != id_col and k in rows[0]),
                note="Pre-allocated IDs only; reserved IDs are not posts/tasks and carry no work.")
            out["rows"] = []
        elif len(rows) < include_rows_limit:
            out["rows"] = rows
        else:
            out["rows"] = []
            out["rows_omitted"] = f"{len(rows)} rows with input values (>= {include_rows_limit}); not copied"
        # cells outside the table (titles, notes)
        extra = []
        for row in wv.iter_rows():
            for c in row:
                if c.value in (None, ""):
                    continue
                if r1 <= c.row <= r2 and ci1 <= c.column <= ci2:
                    continue
                fv = wf[c.coordinate].value
                extra.append(OrderedDict(cell=c.coordinate, value=jsonable(c.value), formula=(fv if _is_formula(fv) else None)))
        out["other_cells"] = extra
    else:
        cells = []
        for row in wf.iter_rows():
            for c in row:
                if c.value in (None, ""):
                    continue
                fv = c.value
                vv = wv[c.coordinate].value
                cells.append(OrderedDict(cell=c.coordinate, value=jsonable(vv if _is_formula(fv) else fv),
                                         formula=(fv if _is_formula(fv) else None)))
        out["cells"] = cells
    out["source"] = X(rel, sheet, wf.dimensions)
    out["status"] = "documented"
    return out


def build_departments():
    rel = f"{OPS}/SYSTEM_ARCHITECTURE.md"
    t = md_tables(H, rel)[0]
    recs = [OrderedDict(name=c[0], purpose=c[1], example_measures=[x.strip() for x in c[2].split(",")],
                        owner_role="Department head (to be named)", owner_named=None,
                        status="proposed", source=S(H, rel, f"line {ln}")) for ln, c in t["rows"]]
    ls = lines(H, rel)

    def bullets_after(heading):
        i = ls.index(heading)
        out = []
        for j in range(i + 1, len(ls)):
            if ls[j].startswith("## "):
                break
            if ls[j].startswith("- "):
                out.append((j + 1, ls[j][2:].strip()))
        return out

    status_std = [OrderedDict(value=s, status="proposed", source=S(H, rel, f"line {ln}")) for ln, s in bullets_after("## Work status standard")]
    escal = []
    for ln, s in bullets_after("## Escalation levels"):
        m = re.match(r"\*\*Level (\d):\*\* (.+)", s)
        escal.append(OrderedDict(level=int(m.group(1)), meaning=m.group(2), status="proposed", source=S(H, rel, f"line {ln}")))
    common = [OrderedDict(record=s, status="proposed", source=S(H, rel, f"line {ln}")) for ln, s in bullets_after("## Common records")]
    leader = [OrderedDict(item=s, status="proposed", source=S(H, rel, f"line {ln}")) for ln, s in bullets_after("## Leadership layer")]
    gov_src, _ = LT(H, f"{OPS}/PROJECT_CHARTER.md", "## Governance")
    gov = []
    pls = lines(H, f"{OPS}/PROJECT_CHARTER.md")
    gi = int(gov_src["locator"].split()[1])
    for j in range(gi, len(pls)):
        if pls[j].startswith("## ") and j != gi - 1:
            break
        m = re.match(r"- \*\*(.+?):\*\* (.+)", pls[j])
        if m:
            gov.append(OrderedDict(role=m.group(1), responsibility=m.group(2), status="proposed", source=S(H, f"{OPS}/PROJECT_CHARTER.md", f"line {j + 1}")))
    write("ops/departments.json",
          ["The 13-department starting model from SYSTEM_ARCHITECTURE.md ('a starting model ... will be adjusted to Elevate Education's actual structure').",
           "No owner is named in the source: owner_role is the generic 'Department head (to be named)' from PROJECT_CHARTER governance; owner_named stays null.",
           "Byte-identical copies exist under outputs/elevate-education-operations/; the elevate-education-operations/ copy is cited."],
          OrderedDict(records=recs, work_status_standard=status_std, escalation_levels=escal, common_records=common,
                      leadership_layer=leader, governance_roles=gov),
          ["records", "work_status_standard", "escalation_levels", "common_records", "leadership_layer", "governance_roles"])


def build_operations_workbook():
    sheets = [extract_sheet(OPSWB, s.title) for s in wb(OPSWB, False).worksheets]
    for s in sheets:
        for r in s.get("rows", []):
            for k in ("Decision status", "Status", "Topic status"):
                if k in r:
                    r["status_normalised"] = norm_status(r[k])
    vocab = OrderedDict()
    for s in sheets:
        for dv in s["data_validations"]:
            if dv["allowed_values"]:
                vocab[f"{s['sheet']}!{dv['range']}"] = dv["allowed_values"]
    wi = [s for s in sheets if s["sheet"] == "Work Inventory"][0]
    dec = [s for s in sheets if s["sheet"] == "Decisions"][0]
    vocab["Work Inventory!F (Decision status, values in use)"] = sorted({r["Decision status"] for r in wi["rows"]})
    vocab["Decisions!D (Status, values in use)"] = sorted({r["Status"] for r in dec["rows"]})
    write("ops/operations-workbook.json",
          ["Every sheet of outputs/elevate-operations/Elevate-Operations.xlsx (offline operations, 2027-28 planning). Read with openpyxl twice: formulas (data_only=False) and cached values (data_only=True).",
           "Table sheets: columns, rows with typed input values (formula cells excluded from rows), per-column formula templates ({r} = this row), data validations. Non-table sheets (Dashboard): every cell with formula and cached value.",
           "status_vocabularies collects every dropdown list and the status words actually used: they encode the workflow states importers must support.",
           "Planned/baseline numbers are not delivery: Teaching Log, Catch-up Log are empty and every verified/actual field is blank in the source.",
           "The Guide sheet's hours-reference URL contains third-party faculty names; its path is redacted."],
          OrderedDict(workbook=OrderedDict(path=f"handover/{OPSWB}", sheet_names=[s["sheet"] for s in sheets], sheet_count=len(sheets)),
                      status_vocabularies=vocab, records=sheets),
          ["records"])


def build_workflows():
    wv = wb(OPSWB, True)
    wi = {wv["Work Inventory"].cell(r, 1).value: [wv["Work Inventory"].cell(r, c).value for c in range(1, 7)] for r in range(5, 30)}
    wi_row = {wv["Work Inventory"].cell(r, 1).value: r for r in range(5, 30)}
    dec = {wv["Decisions"].cell(r, 1).value: [wv["Decisions"].cell(r, c).value for c in range(1, 5)] for r in range(5, 29)}
    dec_row = {wv["Decisions"].cell(r, 1).value: r for r in range(5, 29)}

    def wi_ref(op):
        v = wi[op]
        return OrderedDict(id=op, function=v[1], process=v[2], scope=v[3], proposed_role=v[4], source_status=v[5],
                           status=norm_status(v[5]), source=X(OPSWB, "Work Inventory", f"A{wi_row[op]}:F{wi_row[op]}"))

    def dec_ref(d):
        v = dec[d]
        return OrderedDict(id=d, area=v[1], decision=v[2], source_status=v[3], status=norm_status(v[3]),
                           source=X(OPSWB, "Decisions", f"A{dec_row[d]}:D{dec_row[d]}"))

    flow_src, flow_line = LT(H, "Claude.md", "Offline workflow: marketing")
    steps_txt = ["marketing", "CRM lead", "academic counselling", "separate demo", "approved admission/fees", "onboarding",
                 "timetable/classes", "attendance, DPP, tests and parent reporting"]
    step_links = {
        "marketing": ["OP-001"], "CRM lead": ["OP-002", "OP-003", "OP-007"], "academic counselling": ["OP-004"],
        "separate demo": ["OP-005", "OP-006"], "approved admission/fees": ["OP-008", "OP-009", "OP-010", "OP-011"],
        "onboarding": ["OP-012"], "timetable/classes": ["OP-017", "OP-018", "OP-019"],
        "attendance, DPP, tests and parent reporting": ["OP-013", "OP-014", "OP-015", "OP-016", "OP-020", "OP-021", "OP-022", "OP-023"]}
    offline = OrderedDict(
        id="WF-OFFLINE-STUDENT", name="Offline student workflow (lead to tests)",
        steps=[OrderedDict(seq=i, step=s, work_inventory=[wi_ref(o) for o in step_links[s]]) for i, s in enumerate(steps_txt, start=1)],
        source_status="documented in the handover narrative", status="documented",
        notes=["Reception gives basic information; academic staff handle detailed counselling and conversion.",
               "Meta leads reportedly enter the CRM automatically; walk-in iPad form integration discussed, not implemented (OP-003 Planned).",
               "Lead system is called CRM (not 'Academy'); the Work Inventory text still says 'Academy'."],
        source=[flow_src, L(H, "Claude.md", "Lead sources include Instagram organic/ads"), X(OPSWB, "Work Inventory", "A4:F29")])
    demo = OrderedDict(
        id="WF-DEMO", name="Demo terms",
        terms=OrderedDict(days=2, fee_inr=1000, refundable_if_not_joining=False, adjusted_against_fees_on_joining=True,
                          delivery="separate subject demo classes; never inserted into the ongoing main class; teacher booking communicated"),
        superseded=["Earlier three-day demo discussion"],
        open_items=[dec_ref("D-005")],
        decisions=[dec_ref("D-003"), dec_ref("D-004")], work_inventory=[wi_ref("OP-005"), wi_ref("OP-006"), wi_ref("OP-007")],
        source_status="Confirmed", status="approved",
        source=[L(H, "Claude.md", "Demo decision: **two days, ₹1,000**")])
    attendance = OrderedDict(
        id="WF-ATTENDANCE-OFFLINE", name="Offline attendance and absence call",
        rules=[dec_ref("D-006"), dec_ref("D-007"), dec_ref("D-008"), dec_ref("D-009")],
        work_inventory=[wi_ref("OP-013"), wi_ref("OP-014"), wi_ref("OP-015"), wi_ref("OP-016")],
        absence_call_after_minutes=15, source_status="Confirmed", status="approved",
        source=[L(H, "Claude.md", "Attendance: biometric campus entry/exit")])
    absence_online = OrderedDict(
        id="WF-ABSENCE-ONLINE", name="Online absence-call checkpoint",
        rule="Suggested first attendance check 15 minutes after class starts, subject to manager confirmation; the automatic absence notification does not replace the call.",
        absence_call_after_minutes=15, source_status="proposed", status="proposed",
        notes=["Based on the offline rule; not separately approved for online (Claude.md)."],
        source=[L(H, "Claude.md", "The15-minute online absence checkpoint is proposed"),
                S(H, SOP_DOCX, "section 'Attendance and absence calls', paragraph 3")])
    tests = OrderedDict(
        id="WF-TESTS-OFFLINE", name="Offline test cycle",
        steps=["plan", "paper preparation/issue/printing", "invigilation", "collection", "scanning", "checking", "re-evaluation when required",
               "compulsory discussion", "parent communication", "return originals (after checking/re-evaluation or scan verification)",
               "digital checked answer sheets, marksheets and performance reports"],
        decisions=[dec_ref("D-010"), dec_ref("D-011"), dec_ref("D-024")],
        work_inventory=[wi_ref("OP-020"), wi_ref("OP-021"), wi_ref("OP-022"), wi_ref("OP-023")],
        open_items=["Alternating two-copy mechanics need a final SOP", "Parent progress review cadence weekly vs monthly (D-024 Open)"],
        source_status="Confirmed (steps); cadence open", status="approved",
        source=[L(H, "Claude.md", "Tests: plan, paper preparation/issue/printing")])
    admission = OrderedDict(
        id="WF-ADMISSION-OFFLINE", name="Offline admission and fees",
        steps=["form/document collection", "secure document retention", "fee/down-payment verification", "authority approval",
               "two checks on agreed fees", "Tally invoice/receipt", "instalment tracking", "kit issue (box/T-shirt/bag)", "WhatsApp group", "timetable onboarding"],
        work_inventory=[wi_ref("OP-008"), wi_ref("OP-009"), wi_ref("OP-010"), wi_ref("OP-011"), wi_ref("OP-012")],
        privacy_note="Document types (e.g. Aadhaar, marksheet) are named as process steps only; no student records are extracted.",
        source_status="Confirmed", status="approved", source=[L(H, "Claude.md", "Admission: form/document collection")])

    rules_ws = wb(ONL_EASY, True)["Rules"]
    online_rules = []
    for r in range(5, 25):
        online_rules.append(OrderedDict(area=rules_ws.cell(r, 1).value, source_status=rules_ws.cell(r, 2).value,
                                        status=norm_status(rules_ws.cell(r, 2).value), rule=rules_ws.cell(r, 3).value,
                                        source=X(ONL_EASY, "Rules", f"A{r}:C{r}")))
    office = OrderedDict(
        id="WF-ONLINE-OFFICE-HOURS", name="Online office hours",
        rule="Monday-Saturday 11:00-18:00 IST; routine Sunday support closed; Sunday coverage is event-specific with an assigned event team.",
        source_status="Locked (Rules sheet); the coordinator SOP's service timings 'still need management approval' (Claude.md)",
        status="locked",
        conflict="Rules sheet marks office hours Locked; Claude.md section 1 says the SOP's proposed service timings still need management approval; the extraction doc calls the timings proposals.",
        source=[X(ONL_EASY, "Rules", "A5:C6"), L(H, "Claude.md", "Office **Monday–Saturday11:00–18:00 IST**"),
                L(H, "Claude.md", "Its proposed service timings still need management approval")])
    webinars = OrderedDict(
        id="WF-WEBINARS", name="Webinar cadence",
        rule="Two webinars a week: one Saturday, one Sunday. Lead form, WhatsApp + email communications, follow-ups, CRM deduplication, host post-webinar review.",
        caveat="Do not assume Sunday staff availability merely because a webinar is planned.",
        source_status="documented (Routine checklist 'Weekly'; Sunday coverage Locked)", status="documented",
        source=[L(H, "Claude.md", "Two webinars/week: oneSaturday,oneSunday"), X(ONL_EASY, "Routine", "A14:F14")])
    report = OrderedDict(
        id="WF-MONTHLY-REPORT", name="Monthly student report release",
        rule="Weekly internal review; monthly release by the fifth working day. App generates reports; team verifies and sends privately.",
        source_status="Proposed", status="proposed",
        source=[X(ONL_EASY, "Rules", "A14:C14"), L(H, "Claude.md", "Monthly fifth-working-day reporting is a proposal")])
    mkt = OrderedDict(
        id="WF-MARKETING-WEEK", name="Offline marketing weekly rhythm",
        defaults=OrderedDict(feed_posts_per_week=4, scheduling_lead_time_hours=24, post_review_after_days=7),
        variants=[OrderedDict(text="brief Wednesday, shoot Thursday, approve Friday, Saturday scheduling/preparation", source=L(H, "Claude.md", "Earlier operating defaults")),
                  OrderedDict(text="Plan Wed; briefs Thu; production Fri; approve/schedule Sat (MKT-01)", source=X(MKT_EASY, "SOP Register", "A6:L6"))],
        conflict="The two descriptions of the weekly rhythm differ by one day for briefs/production.",
        source_status="agreed starting standards, not measured performance", status="documented",
        source=[X(MKT_EASY, "Start Here", "A8:C11"), L(H, "Claude.md", "Earlier operating defaults")])
    flows = [offline, demo, admission, attendance, absence_online, tests, office, webinars, report, mkt]
    write("ops/workflows.json",
          ["Documented workflows with the status each source gives. source_status is verbatim; status is the controlled vocabulary (Confirmed->approved, Discussed->documented, User confirmed->documented (user-reported, not verified), Pending verification->unverified).",
           "Lead sources, platform capabilities (Vacademy) and integrations are user-reported requirements, not verified integrations."],
          OrderedDict(records=flows, online_operating_rules=online_rules,
                      lead_sources=OrderedDict(values=["Instagram organic/ads", "Google ads/SEO", "newspaper", "seminars", "webinars", "walk-ins"],
                                               crm_first_enquiry_source_dropdown=[v for v in wb(MKT_EASY, False)["CRM Import"].data_validations.dataValidation if str(v.sqref).startswith("E6")][0].formula1.strip('"').split(","),
                                               status="documented", source=[L(H, "Claude.md", "Lead sources include Instagram organic/ads"),
                                                                            X(MKT_EASY, "CRM Import", "E6:E1005 (data validation)")]),
                      lead_stages=OrderedDict(values=[v for v in wb(MKT_EASY, False)["CRM Import"].data_validations.dataValidation if str(v.sqref).startswith("K6")][0].formula1.strip('"').split(","),
                                              definitions=["Confirmed admission = approved fee arrangement, required documents and verified down payment; demo fee alone is not admission.",
                                                           "Contacted = first successful two-way contact; unanswered calls do not count."],
                                              status="documented", source=[X(MKT_EASY, "CRM Import", "K6:K1005 (data validation)"), X(MKT_EASY, "Start Here", "A31:C32")])),
          ["records", "online_operating_rules"])


def _docx_sections(rel):
    touch(H, rel)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    z = zipfile.ZipFile(abspath(H, rel))
    root = ET.fromstring(z.read("word/document.xml"))
    paras = []
    for el in root.find("w:body", ns):
        if el.tag.endswith("}p"):
            st = el.find("w:pPr/w:pStyle", ns)
            style = st.get("{%s}val" % ns["w"]) if st is not None else ""
            t = "".join(x.text or "" for x in el.iter("{%s}t" % ns["w"]))
            if t.strip():
                paras.append((style, t.strip()))
    return paras


def build_sops():
    tmpl_rel = f"{OPS}/templates/sop_template.md"
    tl = lines(H, tmpl_rel)
    tmpl_sections = [OrderedDict(section=t.lstrip("#").strip(), source=S(H, tmpl_rel, f"line {i + 1}")) for i, t in enumerate(tl) if t.startswith("## ")]
    doc_control = [t[2:].replace("**", "").rstrip(":").strip() for t in tl if t.startswith("- **")]
    reg_rel = f"{OPS}/templates/sop_register.csv"
    reg_rows = list(csv.reader(io.StringIO("\n".join(lines(H, reg_rel)) + "\n")))
    paras = _docx_sections(SOP_DOCX)
    sections, cur = [], None
    meta_lines = []
    for style, t in paras:
        if style == "Heading1":
            cur = OrderedDict(section=t, steps=[])
            sections.append(cur)
        elif cur is None:
            meta_lines.append(t)
        else:
            cur["steps"].append(t)
    for i, s in enumerate(sections, start=1):
        s["seq"] = i
        s["source"] = S(H, SOP_DOCX, f"word/document.xml, Heading1 #{i} '{s['section']}'")
    blank_fields = []
    for s in sections:
        for t in s["steps"]:
            for m in re.finditer(r"([A-Z][A-Za-z ]+?):\s*_{5,}", t):
                blank_fields.append(m.group(1).strip())
    coordinator = OrderedDict(
        id="SOP-ONLINE-COORDINATOR", title="Online Class Coordinator SOP", subtitle="Staff responsibilities and daily workflow",
        organisation="Elevate Education", dated="2026-09-18",
        owner=None, backup=None, reporting_manager=None, effective_date=None, approved_by=None, approval_date=None,
        blank_fields_in_source=blank_fields,
        status="draft",
        status_note="Shareable draft awaiting approval; named owner, backup, manager, coverage and approval date must be assigned before it is issued policy. Proposed service timings and the 15-minute absence checkpoint need management approval.",
        sections=sections,
        source=[S(H, SOP_DOCX, "word/document.xml"), L(H, "Claude.md", "The Word SOP provides a shareable draft.")])
    ops_reg = extract_sheet(OPSWB, "SOP Register")
    onl_reg = extract_sheet(ONL_EASY, "SOP Register")
    mkt_reg = extract_sheet(MKT_EASY, "SOP Register")
    for reg in (ops_reg, onl_reg, mkt_reg):
        for r in reg.get("rows", []):
            st = r.get("Status") or r.get("Document status")
            r["status"] = norm_status(st) if st else ("documented" if "Version" in r else "not_started")
    write("ops/sops.json",
          ["SOP template + register template (elevate-education-operations/templates), the three SOP registers found in the workbooks, and the online coordinator SOP (docx) parsed into sections and steps.",
           "No SOP is approved. Operations-workbook register says 'Register only: these are not approved SOPs'; online register rows are 'To draft'; the marketing register holds agreed operating summaries (v1.0, no approver/date).",
           "Owner/backup/manager fields are blank in the source and stay null; never fill them with names."],
          OrderedDict(
              sop_template=OrderedDict(sections=tmpl_sections, document_control_fields=doc_control, status="documented", source=S(H, tmpl_rel, f"lines 1-{len(tl)}")),
              sop_register_template=OrderedDict(columns=reg_rows[0], rows=[OrderedDict(zip(reg_rows[0], r)) for r in reg_rows[1:]], status="documented",
                                                source=S(H, reg_rel, "lines 1-2")),
              registers=[OrderedDict(id="operations", workbook=f"handover/{OPSWB}", **ops_reg),
                         OrderedDict(id="online", workbook=f"handover/{ONL_EASY}", **onl_reg),
                         OrderedDict(id="marketing", workbook=f"handover/{MKT_EASY}", **mkt_reg)],
              records=[coordinator]),
          ["records", "registers"])


def build_roles():
    ws = wb(ONL_EASY, True)["Roles"]
    online = []
    for r in range(5, 17):
        online.append(OrderedDict(role=ws.cell(r, 2).value, function=ws.cell(r, 1).value, main_work=ws.cell(r, 3).value,
                                  hand_over_to=ws.cell(r, 6).value, assigned_person=None, backup=None,
                                  role_set="online", status="proposed", source=X(ONL_EASY, "Roles", f"A{r}:F{r}")))
    mdv = [v for v in wb(MKT_EASY, False)["Content"].data_validations.dataValidation if str(v.sqref).startswith("I6")][0]
    mroles = mdv.formula1.strip('"').split(",")
    msop = wb(MKT_EASY, True)["SOP Register"]
    owns = defaultdict(list)
    for r in range(6, 15):
        owns[msop.cell(r, 3).value].append(f"{msop.cell(r, 1).value} {msop.cell(r, 2).value}")
    marketing = [OrderedDict(role=x, owns_procedures=owns.get(x, []), role_set="marketing", status="proposed",
                             source=[X(MKT_EASY, "Content", "I6:I205 (data validation)"), X(MKT_EASY, "SOP Register", "A6:C14")]) for x in mroles]
    opsroles = sorted({wb(OPSWB, True)["Work Inventory"].cell(r, 5).value for r in range(5, 30)})
    ops_set = [OrderedDict(role=x, role_set="offline_operations", status="proposed", source=X(OPSWB, "Work Inventory", "E5:E29")) for x in opsroles]
    tv = "plans/team-and-volume-oct-dec-2026.md"
    content_team = []
    for needle, role in [("| 1 | **Quant** |", "Quant teacher-face"), ("| 2 | **English + Logical** |", "English + Logical teacher-face"),
                         ("| 3 | **GK & Current Affairs** |", "GK & Current Affairs teacher-face"), ("| 4 | **Commerce (Accounts / Economics)** |", "Commerce teacher-face"),
                         ("| + | **Nikunj** |", "Founder (on camera)"), ("| + | **Content helper (off camera)** |", "Content helper (off camera)")]:
        src, line = LT("content-os", tv, needle)
        content_team.append(OrderedDict(role=role, covers=line.strip("|").split("|")[-1].strip(), role_set="content_os_team_plan",
                                        status="proposed", source=src))
    write("ops/roles.json",
          ["Role labels, not people and not hires. 'Twelve role labels across eight functions do not mean twelve hires' (Claude.md). Assigned person/backup are blank in the source and stay null.",
           "records = the 12 online-operations roles (Elevate-Online-Easy.xlsx Roles sheet). Other role sets found in the sources are listed separately for mapping; several labels overlap (e.g. Marketing Lead, Admissions Coordinator, Academic Counsellor).",
           "The content OS team plan (4 teacher-faces + founder + helper) is PROPOSED and awaits approval; teacher names are never extracted."],
          OrderedDict(records=online, marketing_roles=marketing, offline_operations_roles=ops_set, content_team_plan_roles=content_team,
                      label_note=OrderedDict(text="These are roles, not a required headcount.", source=X(ONL_EASY, "Roles", "A18"))),
          ["records", "marketing_roles", "offline_operations_roles", "content_team_plan_roles"])


def build_trackers():
    wbs = []
    for rel, role in [(MKT_EASY, "simplified daily-use marketing tracker (current)"), (MKT_OPS, "full-layout marketing workbook (earlier/full version)"),
                      (ONL_EASY, "simplified daily-use online tracker (current)"), (ONL_OPS, "full online operations workbook (earlier/full version)")]:
        sheets = [extract_sheet(rel, s.title) for s in wb(rel, False).worksheets]
        wbs.append(OrderedDict(workbook=f"handover/{rel}", role=role, sheet_count=len(sheets),
                               visible_sheets=[s["sheet"] for s in sheets if s["state"] == "visible"],
                               hidden_sheets=[s["sheet"] for s in sheets if s["state"] != "visible"],
                               sheets=sheets, live_connection=False, status="documented",
                               source=S(H, rel, "all sheets")))
    mt = list(csv.reader(io.StringIO("\n".join(lines(H, f"{OPS}/templates/master_tracker.csv")) + "\n")))
    intake = lines(H, f"{OPS}/templates/department_intake.md")
    templates = [
        OrderedDict(id="master_tracker", columns=mt[0], rows=[OrderedDict(zip(mt[0], r)) for r in mt[1:]], status="documented",
                    source=S(H, f"{OPS}/templates/master_tracker.csv", "lines 1-3")),
        OrderedDict(id="department_intake", sections=[t.lstrip("#").strip() for t in intake if t.startswith("## ")],
                    status="documented", source=S(H, f"{OPS}/templates/department_intake.md", "all lines")),
    ]
    write("ops/trackers.json",
          ["Structures of the marketing/online 'Easy' and 'Operations' workbooks: sheets, visibility, columns, dropdown vocabularies, formula templates, prepared row capacity.",
           "Rows are included when fewer than 300 rows carry input values. Rows holding only pre-allocated IDs (e.g. EE-001..EE-200, TASK-001..TASK-200) are summarised as placeholder_rows: reserved IDs are not posts or tasks.",
           "The Easy and Operations files are not synchronised with each other and have no live CRM/Vacademy connection.",
           "The hidden marketing 'Project Plan' sheet came from a template whose owner dropdown lists 9 placeholder person names; that list is omitted."],
          OrderedDict(records=wbs, templates=templates), ["records", "templates"])


# ============================================================================================
def main():
    build_accounts()
    build_ideas_and_placements()
    build_post_audit()
    build_content_rules()
    build_metrics_formats()
    build_programmes()
    build_ipmat_baseline()
    build_class12_plan()
    build_concept_books()
    build_ca_foundation()
    build_online_accountancy()
    build_combined_syllabus()
    build_assessment_patterns()
    build_departments()
    build_operations_workbook()
    build_workflows()
    build_sops()
    build_roles()
    build_trackers()
    extracted = set(ALL_SOURCES)
    for key, rel in ALSO_CONSULTED:
        touch(key, rel)
    zpath = ROOTS["content-os"] / "Elevate-Education-Agent-Handover-2026-10-15.zip"
    zf = zipfile.ZipFile(zpath) if zpath.exists() else None
    zmembers = set(zf.namelist()) if zf else set()
    entries = []
    for p in sorted(ALL_SOURCES):
        key, rel = p.split("/", 1)
        data = abspath(key, rel).read_bytes()
        e = OrderedDict(path=redact(p), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                        use=("extracted" if p in extracted else "consulted"))
        if key == "handover":
            member = f"Elevate-Education/{rel}"
            e["zip_member"] = member if member in zmembers else None
            e["matches_zip_member"] = (hashlib.sha256(zf.read(member)).hexdigest() == e["sha256"]) if member in zmembers else None
        entries.append(e)
    for key, rel, use in [("content-os", "Elevate-Education-Agent-Handover-2026-10-15.zip", "archive containing every handover/ file")]:
        data = abspath(key, rel).read_bytes()
        entries.append(OrderedDict(path=f"{key}/{rel}", sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), use=use))
    roots_note = {
        "content-os": "C:/OPENBOT/OLD/01-original-elevate-os/ (read-only legacy content OS)",
        "handover": "Elevate-Education/ inside content-os/Elevate-Education-Agent-Handover-2026-10-15.zip (read from an extracted copy; hashes compared with the zip members)",
    }
    (OUT / "_extract" / "sources_read.json").write_text(
        json.dumps(OrderedDict(roots=roots_note, files=entries), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"sources: {len(extracted)} extracted, {len(ALL_SOURCES) - len(extracted)} consulted; "
          f"zip mismatches: {[e['path'] for e in entries if e.get('matches_zip_member') is False]}")


# Files read while designing the extraction (structure, formulas, cross-checks) but not copied into outputs.
ALSO_CONSULTED = [
    ("content-os", "Claude1.md"),
    ("content-os", "reports/2026-10-11-next-week-plan.md"),
    ("content-os", "reports/2026-10-11-week.md"),
    ("content-os", "library/GEN-012-big4-scoreboards/script.md"),
    ("content-os", "courses/ipmat/facts.md"),
    ("content-os", "courses/commerce/facts.md"),
    ("content-os", "courses/clat/channels.json"),
    ("content-os", "courses/cuet/channels.json"),
    ("content-os", "courses/ipmat/channels.json"),
    ("content-os", "courses/commerce/channels.json"),
    ("content-os", "accounts/instagram-cuet12/README.md"),
    ("content-os", "accounts/youtube-clat/README.md"),
    ("handover", "PACKAGE_NOTES.md"),
    ("handover", "elevate-education-operations/README.md"),
    ("handover", "elevate-education-operations/IMPLEMENTATION_ROADMAP.md"),
    ("handover", "outputs/Quant-Class-Estimates.md"),
    ("handover", "outputs/Quant-Teaching-Estimates-v2.md"),
    ("handover", "work/build_operations.mjs"),
    ("handover", "work/build_class12.mjs"),
]


if __name__ == "__main__":
    main()
