"""The evaluation (pipeline/eval.py): the matcher, the lab judgement, the planted S03 misreads, and that the
pipeline has no failure the expected outputs do not already name."""

import json
import re

import pytest

import eval as ev  # pipeline/eval.py, a script next to the package; pytest puts pipeline/ on the path
from conftest import REPO

S03 = REPO / "samples/derived/pages/S03_pacient"


def test_expected_files_are_valid():
    specs = [ev.load_expected(p) for p in sorted(ev.EXPECTED_DIR.glob("*.json"))]
    assert {s["case"] for s in specs} >= {"10", "S01", "S02", "S03", "S04"}
    kinds = {e["failure_kind"] for s in specs for e in s["expectations"]}
    # Every CLAUDE.md failure case has at least one expectation.
    assert kinds == set(ev.FAILURE_KINDS), kinds
    for s in specs:
        for d in s["documents"]:
            assert (REPO / d["pages_dir"]).is_dir(), d


def test_no_unexpected_outcomes(capsys):
    """CI gate: a new failure, or a known failure that now passes, fails the build."""
    assert ev.main(["--check"]) == 0, capsys.readouterr().out


def test_matcher_operators():
    sources = {"s1": {"page": 3, "quote": "S_K: 5,8 mmol/l"}}
    fact = {"kind": "lab_result", "date": {"sort": None}, "codes": [{"code": "S_K"}, {"code": "x"}], "sources": ["s1"],
            "value": {"value_numeric": 5.8}}
    assert ev.matches(fact, {"kind": "lab_result", "codes.code": "S_K", "source.page": 3}, sources)
    assert ev.matches(fact, {"date.sort": None, "value.value_numeric": {"ne": 5.3}}, sources)
    assert ev.matches(fact, {"date.sort": {"not_in": ["2026-09-21"]}}, sources)
    assert ev.matches(fact, {"source.quote": {"regex": r"^S_K\b"}}, sources)
    # A field the producer did not write is not null: it equals nothing, so a "present" null never passes on it.
    assert not ev.matches(fact, {"value.result_fact": None}, sources)
    assert ev.matches(fact, {"value.result_fact": {"not_in": ["x"]}}, sources)
    assert ev.matches(fact, {"value.drug": {"not_regex": "x"}}, sources)
    assert not ev.matches(fact, {"kind": {"in": ["medication"]}}, sources)
    assert not ev.matches(fact, {"source.page": 4}, sources)
    with pytest.raises(ValueError):
        ev.matches(fact, {"kind": {"like": "x"}}, sources)


def test_source_keys_hold_for_one_source():
    sources = {"s1": {"page": 4, "identity": "matches"}, "s2": {"page": 1, "identity": "conflicts"}}
    fact = {"kind": "imaging", "sources": ["s1", "s2"]}
    assert not ev.matches(fact, {"source.page": 4, "source.identity": "conflicts"}, sources)
    assert ev.matches(fact, {"source.page": 1, "source.identity": "conflicts"}, sources)


def test_fragment_validation():
    assert ev._fragment_problems({"kind": "metastasis", "value.site": "x", "source.page": 3}, True) == []
    assert ev._fragment_problems({"kind": "metastasis", "value.sites": "x"}, True)  # a typo is an error, not a pass
    assert ev._fragment_problems({"kind": "x", "fact.kind": "imaging", "fact.value.modality": "MR"}, False) == []
    assert ev._fragment_problems({"kind": {"like": "x"}}, False)
    assert ev._fragment_problems({"source.pages": 3}, True)


def _run(facts, sources, checks=("lab_result",)):
    return {"facts": facts, "sources": [{"id": k, **v} for k, v in sources.items()], "alerts": [],
            "checks": [{"looks_for": c, "result": "found"} for c in checks]}


def _lab(fid, code, value, certainty="clear", date="2026-09-21", time="07:40", page=3):
    return {"id": fid, "kind": "lab_result", "certainty": certainty, "certainty_reason": None,
            "codes": [{"code": code}], "sources": [f"s{fid}"],
            "value": {"value_as_written": value, "unit": "mmol/l"},
            "date": {"sort": date, "as_written": f"{date} {time}" if time else date}}


def _judge(want, facts, sources):
    return ev.judge_lab(want, ev.assign_labs([want], _run(facts, sources))[0])[0]


def test_lab_judgement():
    want = {"code": "S_K", "page": 3, "value": "5,8", "unit": "mmol/l", "date": "2026-09-21", "time": "07:40"}
    src = lambda fid, q="S_K: x": {f"s{fid}": {"page": 3, "quote": q}}  # noqa: E731
    assert _judge(want, [_lab("1", "S_K", "5,8")], src("1")) == "exact"
    # A silent wrong value is the failure that matters most: clear, but not what the document says.
    assert _judge(want, [_lab("1", "S_K", "5,3")], src("1")) == "wrong"
    assert _judge(want, [_lab("1", "S_K", "5,8", date="2026-09-28")], src("1")) == "wrong"
    assert _judge(want, [_lab("1", "S_K", "5,3", certainty="verify")], src("1")) == "marked"
    assert _judge(want, [], {}) == "missing"
    # A line that did not parse counts as marked when its start resembles the code.
    assert _judge(want, [_unread("2")], src("2", "S K: 5,3.mmoll [3.5 ... 5.1]")) == "marked"
    assert _judge(want, [_unread("2")], src("2", "S NA: 139 mmol/l [136")) == "missing"


def _unread(fid):
    return {"id": fid, "kind": "lab_result", "certainty": "unreadable", "certainty_reason": {"code": "x"},
            "codes": [], "sources": [f"s{fid}"], "value": None, "date": {"sort": None, "as_written": None}}


def test_one_line_stands_for_one_expected_value():
    """S_ALT and S_AST are 0.8 alike: one unreadable S_AST line must not cover a missing S_ALT too."""
    alt = {"code": "S_ALT", "page": 5, "value": "0,31", "unit": "µkat/l", "date": None, "time": None}
    ast = {"code": "S_AST", "page": 5, "value": "0,29", "unit": "µkat/l", "date": None, "time": None}
    run = _run([_unread("1")], {"s1": {"page": 5, "quote": "S AST: 0,29 ukat/l [0.17 ... 0.58]"}})
    got = [ev.judge_lab(p, f)[0] for p, f in zip([alt, ast], ev.assign_labs([alt, ast], run))]
    assert got == ["missing", "marked"]


def test_not_run_when_the_producer_does_not_look():
    e = {"id": "x", "expect": "absent", "fact": {"kind": "metastasis"}}
    assert ev.judge(e, _run([], {}))[0] == "not_run"  # absent, but nobody looked: never a pass
    assert ev.judge(e, _run([], {}, checks=("metastasis",)))[0] == "pass"


@pytest.mark.parametrize("page,truth,misread", [
    (1, "Bisoprolol 1,25 mg", "Bisoprolol 4,25 mg"),  # D1
    (2, "jater neprokázáno", "jater prokázáno"),  # D2
    (3, "Odběr: 21.9.2026 07:40", "Odběr: 21 9 2026"),  # D3, D4
    (3, "S_K: **5,8** mmol/l", "S K: 5,3"),  # D5
])
def test_s03_planted_misreads(page, truth, misread):
    """The table in samples/S03_pacient/GROUND-TRUTH.md holds for the committed OCR."""
    assert truth in (S03 / f"p{page}.truth.md").read_text()
    tess = re.sub(r"\.\s+(?=jater)", " ", (S03 / f"p{page}.tess.txt").read_text())  # "postižení. jater"
    assert misread in tess
    assert truth.replace("**", "") not in tess


def test_ai_runs_are_merged_and_judged(tmp_path):
    """--ai-runs adds an AI run fragment: its checks replace the adapter's, so an expectation that needed them runs,
    and a clear wrong fact fails it."""
    spec = next(s for s in (ev.load_expected(p) for p in sorted(ev.EXPECTED_DIR.glob("*.json"))) if s["case"] == "S03")
    src = {"id": "src-x", "type": "document", "document_id": "S03_pacient", "part": None, "page": 2,
           "quote": "Metastatické postižení. jater  prokázáno.", "quote_text": "tesseract", "anchor": None,
           "reported_as": "original", "identity": "matches", "reading_check": None}
    fact = {"id": "f-x", "key": "metastasis|játra|2026-09-16", "kind": "metastasis", "subject": "patient",
            "value": {"site": "játra", "status": "confirmed", "basis": None, "text": None},
            "date": {"as_written": None, "precision": None, "sort": None}, "status": "documented", "negated": False,
            "not_stated": [], "origin": "document", "certainty": "clear", "codes": [], "note": None,
            "quarantined": False, "sources": ["src-x"]}
    check = {"id": "chk-metastasis", "looks_for": "metastasis", "expected": None, "covered": [], "unreadable": [],
             "result": "found"}
    run = {"sources": [src], "facts": [fact], "checks": [check], "alerts": [], "run": {"stages": []}}
    (tmp_path / "S03.json").write_text(json.dumps(run, ensure_ascii=False))
    out = {r["id"]: r["outcome"] for r in ev.evaluate_case(spec, tmp_path)["results"]}
    assert out["S03-D2-no-proven-liver-metastases"] == "fail"
    assert out["S03-D2-liver-excluded-or-marked"] == "pass"
    fact["certainty"] = "verify"
    (tmp_path / "S03.json").write_text(json.dumps(run, ensure_ascii=False))
    out = {r["id"]: r["outcome"] for r in ev.evaluate_case(spec, tmp_path)["results"]}
    assert out["S03-D2-no-proven-liver-metastases"] == "pass"


def test_damage_spec_names_every_defect():
    spec = json.loads((REPO / "samples/S03_pacient/damage.json").read_text())
    assert [d["id"] for d in spec["defects"]] == ["D1", "D2", "D3", "D4", "D5"]
    assert all(d["why"] for d in spec["defects"])
