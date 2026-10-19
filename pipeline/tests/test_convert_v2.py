"""Invariants of the converted reference runs (fixtures/data/runs, written by fixtures/convert/convert_v2.py).

A doctor acts on what these runs say, so the checks are about trust: every source quote is verbatim in its page text,
no fact stands without a source, no patient identifier is in a run, the guidance files point at facts by ID only, and
the files on disk are what the converter writes today (so a hand edit or a stale run is caught)."""

import json
import re
import sys

import pytest

from conftest import PAGES, REPO
from extraction_format import validate_run

sys.path.insert(0, str(REPO / "fixtures/convert"))
import convert_v2  # noqa: E402

RUNS = REPO / "fixtures/data/runs"
CASES = ["NO-010", "NO-S01", "NO-S02"]


def run_of(case_id: str) -> dict:
    return json.loads((RUNS / f"{case_id}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case_id", CASES)
def test_run_is_valid(case_id):
    res = validate_run(run_of(case_id))
    assert res.ok, [(i.code, i.path) for i in res.issues]


@pytest.mark.parametrize("case_id", CASES)
def test_every_quote_is_verbatim_in_its_page_text(case_id):
    run = run_of(case_id)
    for s in run["sources"]:
        assert s["type"] == "document" and s["quote_text"] == "pdf_text"
        text = (PAGES / s["document_id"] / f"p{s['page']}.layer.txt").read_text(encoding="utf-8")
        assert s["quote"] in text, s["id"]
        assert s["part"] in run["documents"][0]["parts"]


@pytest.mark.parametrize("case_id", CASES)
def test_no_fact_without_a_source_and_no_source_without_a_fact(case_id):
    run = run_of(case_id)
    used = set()
    for f in run["facts"]:
        assert f["sources"] or (f["origin"] == "assistant" and f.get("based_on")), f["id"]
        used.update(f["sources"])
    assert used == {s["id"] for s in run["sources"]}


@pytest.mark.parametrize("case_id", CASES)
def test_no_patient_identifier_in_a_run(case_id):
    text = (RUNS / f"{case_id}.json").read_text(encoding="utf-8")
    for ident in convert_v2.identity_strings():
        assert ident not in text


def test_counts():
    counts = {c: convert_v2.counts(run_of(c)) for c in CASES}
    assert sum(counts["NO-010"].values()) == 153
    assert counts["NO-010"]["lab_result"] == 26  # today's 26 lab values, one undated panel
    assert counts["NO-S01"]["lab_result"] == 52  # 13 tests x 4 draws
    assert counts["NO-S02"]["lab_result"] == 72  # 18 tests x 4 draws
    assert [len(run_of(c)["alerts"]) for c in CASES] == [21, 4, 8]


def test_partial_dates_stay_partial_and_negations_stay_negated():
    run = run_of("NO-010")
    for f in run["facts"]:
        d = f["date"]
        if d["as_written"] and re.fullmatch(r"\d{1,2}/\d{2,4}", d["as_written"]):
            assert d["precision"] == "month" and len(d["sort"]) == 7, f["id"]
        if f["kind"] == "metastasis":
            assert (f["value"]["status"] == "excluded") == f["negated"]
    negated = {f["value"].get("text") or f["value"].get("site") for f in run["facts"] if f["negated"]}
    assert "Na cílený dotaz neguje závratě či poruchy rovnováhy." in negated
    assert "plicní embolie" in {f["value"]["text"] for f in run["facts"] if f["kind"] == "diagnosis" and f["negated"]}


def test_alert_messages_are_in_every_catalog():
    used = {a["message"]["id"] for c in CASES for a in run_of(c)["alerts"]}
    for loc in ("cs", "sk", "en"):
        ftl = (REPO / f"i18n/{loc}/alerts.ftl").read_text(encoding="utf-8")
        ids = set(re.findall(r"^([a-z0-9-]+) =", ftl, re.M))
        assert used <= ids, (loc, used - ids)


def test_guidance_points_at_facts_by_id_only():
    ids = {f["id"] for f in run_of("NO-010")["facts"]}
    data = REPO / "fixtures/data"
    for name in ("guidelines-case-10.json", "guidelines-case-10-more.json"):
        doc = json.loads((data / name).read_text(encoding="utf-8"))
        assert doc["run_id"] == "fixture-NO-010-v2"
        for st in doc["statements"]:
            for pf in st["patient_facts"]:
                assert pf["text"] and pf["fact_ids"] and set(pf["fact_ids"]) <= ids
    past = json.loads((data / "guidelines-case-10-past.json").read_text(encoding="utf-8"))
    for st in past["statements"]:
        assert "row_index" not in st and "decision_ref" not in st
        assert st["row_fact_id"] in ids and set(st["decision_fact_ids"]) <= ids
    refs = json.loads((data / "guideline-fact-refs-case-10.json").read_text(encoding="utf-8"))
    assert all(set(f["fact_ids"]) <= ids for f in refs["facts"])
    dev = json.loads((data / "deviations-case-10.json").read_text(encoding="utf-8"))
    for f in dev["findings"]:
        assert "source_refs" not in f and f["source_fact_ids"] and set(f["source_fact_ids"]) <= ids


def test_files_are_what_the_converter_writes(capsys):
    # --check converts in memory and fails on any file that differs, so a hand edit of a run or a stale run is caught.
    assert convert_v2.main(["--check"]) == 0, capsys.readouterr().out
