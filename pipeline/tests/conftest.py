"""Shared paths and helpers. Tests read only synthetic data: data/derived (FNO's synthetic challenge
patients and ours), samples/ and the mock case files; never private/."""

import json
import shutil
from pathlib import Path

import pytest

from page_reader import labs, page_index as pi
from page_reader.page_index import same_unit

REPO = Path(__file__).resolve().parents[2]
PAGES = REPO / "data/derived/pages"
MOCKS = REPO / "fixtures/data"
HAS_TESSERACT = shutil.which("tesseract") is not None
needs_tesseract = pytest.mark.skipif(not HAS_TESSERACT, reason="tesseract not installed")

# Lab pages per synthetic patient, as in the builders (fixtures/extract/build_case_s0*.py).
LAB_PAGES = {"S01_pacient": [3, 4, 5, 7], "S02_pacient": [5, 6, 7, 8]}


def mock_labs(patient: str) -> dict:
    return json.loads((MOCKS / f"mock-case-{patient.split('_')[0]}.json").read_text())["labs_series"]


def page_input(patient: str, n: int, engine: str) -> dict:
    d = PAGES / patient
    layer_text = (d / f"p{n}.layer.txt").read_text()
    if engine == "vision":
        return {"n": n, "text": (d / f"p{n}.vision.md").read_text(), "layer_text": layer_text,
                "engine": "vision", "readability_level": "good"}
    return {"n": n, "text": (d / f"p{n}.tess.txt").read_text(), "layer_text": layer_text,
            "words": pi.tess_words(d / f"p{n}.tess.tsv"), "readability_level": "fair"}


def compare_with_mock(result: dict, mock: dict, page_of=lambda src: src["page"]) -> dict:
    """Every mock point must be found, under its code and on its page, and either equal the mock in value,
    unit, range, date and out-of-range, or be marked unclear_ocr. A point the text of record lost counts as
    "listed" when the parser lists it as only in the second reading (reason only_second_reading, same code, same
    page): the doctor sees it marked for checking, so it is not lost. Which points end up there depends on the
    Tesseract build (5.3.0 in the container loses S02 p5 B_NEU, 5.5.3 locally loses S01 S_AST). Returns counts."""
    listed = {(u.get("code"), page_of({"page": u["n"], "doc_id": u.get("doc_id")}))
              for u in result.get("unparsed", []) if u.get("reason") == "only_second_reading"}
    found: dict[tuple, list] = {}
    for t in result["tests"]:
        for p in t["points"]:
            if p:
                found.setdefault((t["code"], page_of(p["source"])), []).append(p)
    counts = {"documented": 0, "unclear_ocr": 0, "listed": 0}
    problems = []
    for t in mock["tests"]:
        for mp in t["points"]:
            got = found.get((t["code"], mp["source"]["page"]), [])
            if not got and (t["code"], mp["source"]["page"]) in listed:
                counts["listed"] += 1
                continue
            if len(got) != 1:
                problems.append((t["code"], mp["source"]["page"], f"{len(got)} points"))
                continue
            p = got[0]
            counts[p["certainty"]] += 1
            if p["certainty"] == "unclear_ocr":
                assert p["verify_reasons"], (t["code"], p)
                continue
            same = (p["value"] == mp["value"] and p["reference_range"] == t["reference_range"]
                    and p["date"] == mp["date"] and p["time"] == mp["time"] and p["out_of_range"] == mp["out_of_range"])
            # Tolerance: a unit that differs only by look-alike letters without a digit ("umol/l" for "µmol/l")
            # stays documented, as same_unit in the page index; the differing reading is then kept on the point.
            unit_ok = p["unit"] == t["unit"] or (same_unit(p["unit"], t["unit"]) and "readings" in p)
            if not (same and unit_ok):
                problems.append((t["code"], mp["source"]["page"], p["value"], mp["value"], p["unit"], t["unit"]))
    assert not problems, problems
    total = sum(len(t["points"]) for t in mock["tests"])
    assert result["counts"]["points"] + counts["listed"] == total, "a point the mock does not have"
    return counts
