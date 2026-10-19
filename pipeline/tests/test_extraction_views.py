"""Composed views in the Python mirror, against the same backing vectors and worked examples as the TypeScript tests
(packages/domain/test/extraction-views.test.ts). A line the Worker accepts and the pipeline rejects (or the reverse)
would make one side store what the other refuses, so the vectors are the contract."""

import copy
import json

import pytest

from conftest import REPO
from extraction_format import Evidence, alert_id, backing_problems, validate_run, view_line_id

DOMAIN = REPO / "packages/domain"
BACKING = json.loads((DOMAIN / "test/extraction-backing-vectors.json").read_text(encoding="utf-8"))["cases"]
EXAMPLE = json.loads((DOMAIN / "schema/examples/worked-examples.json").read_text(encoding="utf-8"))


def example() -> dict:
    return copy.deepcopy(EXAMPLE)


def codes(run: dict) -> list[str]:
    return [i.code for i in validate_run(run).issues]


@pytest.mark.parametrize("case", BACKING, ids=[c["name"] for c in BACKING])
def test_backing_vectors(case):
    assert backing_problems(case["text"], Evidence(case["texts"], case["negated"], case.get("all_negated", False))) == case["want"]


def test_view_line_ids_follow_view_and_fact_set():
    assert view_line_id("onco_lines", ["f-b", "f-a"]) == view_line_id("onco_lines", ["f-a", "f-b"])
    assert view_line_id("onco_lines", ["f-a"]) != view_line_id("timeline", ["f-a"])
    # The worked examples' IDs were written by this function; the TypeScript validator accepts them too.
    for view in ("onco_lines", "timeline"):
        for line in EXAMPLE["views"][view]:
            assert line["id"] == view_line_id(view, line["facts"])


def test_accepts_views_and_a_run_without_them():
    assert codes(example()) == []
    run = example()
    del run["views"]
    assert codes(run) == []


def test_line_without_facts_unknown_fact_and_id():
    empty = example()
    empty["views"]["onco_lines"][0]["facts"] = []
    assert [(i.code, i.path) for i in validate_run(empty).issues] == [("schema", "/views/onco_lines/0/facts")]
    run = example()
    run["views"]["timeline"][0]["facts"].append("f-000000")
    assert sorted(codes(run)) == ["unknown_fact", "view_line_id_mismatch"]


def test_duplicate_line():
    run = example()
    run["views"]["onco_lines"].append(copy.deepcopy(run["views"]["onco_lines"][0]))
    assert codes(run) == ["duplicate_view_line_id"]


def test_unbacked_text_title_and_detail():
    run = example()
    run["views"]["onco_lines"][0]["text"] = "pT2a pN1 M0 vlevo, 3.6.2022, bez progrese, 7 uzlin"
    assert [(i.code, i.path, i.message) for i in validate_run(run).issues] == [
        ("view_line_unbacked", "/views/onco_lines/0/text", f"a {p} in the line's text is not in its facts")
        for p in ("date", "number", "negation", "side")
    ]
    card = example()
    card["views"]["timeline"][0]["title"] = "Seminář 12.10.2026"
    card["views"]["timeline"][0]["detail"] = "Nález vpravo."
    assert [i.path for i in validate_run(card).issues] == ["/views/timeline/0/title", "/views/timeline/0/detail"]


def test_line_date_precision():
    run = example()
    run["views"]["onco_lines"][0]["date"] = {"as_written": "6/2022", "precision": "month", "sort": "2022-06-02"}
    assert codes(run) == ["date_precision"]


def test_line_date_and_status_follow_the_facts():
    run = example()
    line = run["views"]["onco_lines"][0]
    line["date"] = {"as_written": "3.6.2022", "precision": "day", "sort": "2022-06-03"}
    line["status"] = "planned"
    assert codes(run) == ["view_line_date_unbacked", "view_line_status_mismatch"]
    card = example()
    card["views"]["timeline"][0]["status"] = "done"
    assert codes(card) == ["view_line_status_mismatch"]


def test_quarantined_fact_in_a_line():
    run = example()
    run["sources"][0]["identity"] = "conflicts"
    run["facts"][0]["quarantined"] = True
    subject = "10_pacient/p2#3"
    run["alerts"].append({"id": alert_id({"rule": "page_identity_conflict", "subject": subject}), "rule": "page_identity_conflict",
                          "subject": subject, "kind": "identity", "facts": ["f-8d41c2"],
                          "message": {"id": "alert-identity-conflict", "args": {}}, "note": None})
    assert codes(run) == []
    line = run["views"]["onco_lines"][0]
    line["facts"].append("f-8d41c2")
    line["id"] = view_line_id("onco_lines", line["facts"])
    assert codes(run) == ["quarantined_in_use"]


def test_schema_rejects_unknown_field_and_category():
    run = example()
    run["views"]["timeline"][0]["category"] = "visit"
    run["views"]["timeline"][0]["colour"] = "red"
    assert sorted(i.path for i in validate_run(run).issues) == ["/views/timeline/0/category", "/views/timeline/0/colour"]


def test_brief_sentence_backed_by_its_facts():
    run = example()
    run["brief"]["sentences"][0]["text"] = "Patologické stadium pT2a pN1 M0 z 3.6.2022."
    assert codes(run) == ["sentence_unbacked"]
    run = example()
    run["brief"]["sentences"].append({"text": "Bez zdroje 1.1.2020.", "facts": []})
    assert codes(run) == ["sentence_without_facts"]
