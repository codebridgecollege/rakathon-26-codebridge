"""Splitting multi-document PDFs into parts, measured against the hand-labelled documents of the mock cases."""

import json
import re

from conftest import MOCKS, PAGES
from page_reader import parts

GT_TYPE = {"ambulantní zpráva": "outpatient_report", "laboratorní výsledky": "lab_results", "histologie": "histology"}


def pages_of(patient: str) -> list[dict]:
    d = PAGES / patient
    ns = sorted(int(re.sub(r"\D", "", p.name.split(".")[0])) for p in d.glob("p*.tess.txt"))
    return [{"n": n, "text": (d / f"p{n}.tess.txt").read_text()} for n in ns]


def test_synthetic_samples_match_ground_truth():
    for patient in ("S01", "S02"):
        gt = json.loads((MOCKS / f"mock-case-{patient}.json").read_text())["documents"]
        got = parts.split(pages_of(f"{patient}_pacient"))["parts"]
        assert [p["pages"] for p in got] == [d["pages"] for d in gt]
        assert [p["type"] for p in got] == [GT_TYPE[d["type"]] for d in gt]
        assert [p["date"] for p in got] == [d["date"] for d in gt]
        assert all(p["certainty"] == "documented" for p in got)
        for p in got:  # the title is printed text, found at its evidence offsets
            ev = next(e for e in p["evidence"] if e["what"] == "title")
            page = next(x for x in pages_of(f"{patient}_pacient") if x["n"] == ev["n"])
            assert p["title_cs"].startswith(page["text"][ev["start"]:ev["end"]])


def test_case_10_pages_and_types():
    # Ground truth (mock-case-10-extra.json, top-level documents): report 1-3, lab panel on 3, report 4-5.
    got = parts.split(pages_of("10_pacient"))["parts"]
    assert [(p["pages"], p["type"]) for p in got] == [([1, 2, 3], "outpatient_report"), ([3], "lab_results"),
                                                     ([4, 5], "outpatient_report")]
    assert all(p["date"] is None for p in got)  # no labelled date anywhere: nothing is guessed from the body
    assert got[0]["certainty"] == "verify"  # joined by a repeated header only
    assert got[0]["to"]["offset"] == got[1]["from"]["offset"]


def test_unknown_and_form():
    assert parts.split(pages_of("2_pacient"))["parts"][0]["type"] == "unknown"
    p = parts.split(pages_of("17_pacient"))["parts"][0]
    assert p["type"] == "mdt_referral" and p["title_cs"] is None


def test_dates_keep_precision_and_damage_gives_verify():
    assert parts.parse_date("03/2024") == ("2024-03", "03/2024", True)
    assert parts.parse_date("6.10.2026") == ("2026-10-06", "6.10.2026", True)
    assert parts.parse_date("1112023")[0] is None
    assert parts.parse_date("13.40.1961")[0] is None
    text = "Laboratoř klinické biochemie\nVýsledky laboratorních vyšetření\nOdběr: 1112023 07:30\n" + "B LKC: 8,61 10^9/l [4 ... 10]\n" * 4
    p = parts.split([{"n": 1, "text": text}])["parts"][0]
    assert p["type"] == "lab_results" and p["date"] is None and p["date_as_written"] is None
    assert p["certainty"] == "verify" and "date_unreadable" in p["verify_reasons"]
    assert any(e["what"] == "date" for e in p["evidence"])


def test_blank_page_joins_previous_part():
    got = parts.split(pages_of("9_pacient"))["parts"]
    assert got[-1]["pages"][-1] == 4
