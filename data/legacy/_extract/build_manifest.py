"""Write data/legacy/MANIFEST.json: SHA-256 of every output file and of every source file read.

    python -I data/legacy/_extract/build_manifest.py

Run last (after extract_legacy.py, verify.py and README.md edits). MANIFEST.json does not hash itself.
Source hashes come from _extract/sources_read.json, written by extract_legacy.py (which also compares every
handover file with its member in the original zip).
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import OrderedDict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent

outputs = []
for p in sorted(ROOT.rglob("*")):
    if not p.is_file() or p.name == "MANIFEST.json" or "__pycache__" in p.parts:
        continue
    data = p.read_bytes()
    entry = OrderedDict(path=p.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
    if p.suffix == ".json" and "_extract" not in p.parts:
        d = json.loads(data.decode("utf-8"))
        counts = OrderedDict()
        for k in d["meta"]["record_arrays"]:
            o = d
            for part in k.split("."):
                o = o[part]
            counts[k] = len(o)
        entry["record_counts"] = counts
    outputs.append(entry)

src = json.loads((ROOT / "_extract" / "sources_read.json").read_text(encoding="utf-8"))
manifest = OrderedDict(
    meta=OrderedDict(
        extracted_at="2026-10-17",
        generator="data/legacy/_extract/build_manifest.py",
        source_roots=src["roots"],
        notes=["outputs: every file under data/legacy except MANIFEST.json itself.",
               "sources: every legacy file read; use='extracted' (data copied into outputs) or 'consulted' (read for structure or cross-checks only).",
               "handover files were read from an extracted copy; matches_zip_member=true means the bytes equal the member of the original zip.",
               "Paths containing the founder's first name are shown with the {founder} placeholder (see _private/README.md); hashes are of the real files.",
               "Third-party reference files in the handover (source-references/Part_1.md, Part_2.md, THE IIM GUIDE, IMS timetable) were NOT read or copied."],
    ),
    outputs=outputs,
    sources=src["files"],
)
(ROOT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"MANIFEST.json: {len(outputs)} outputs, {len(src['files'])} sources")
