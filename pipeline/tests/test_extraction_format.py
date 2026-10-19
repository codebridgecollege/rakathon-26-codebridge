"""The Python mirror of codebridge.extraction/2 against the same vectors and worked examples as the TypeScript tests
(packages/domain/test/extraction.test.ts). A key or an alert ID that differs between the two sides would detach a
doctor's confirmation, so the shared vectors are the contract."""

import copy
import json

import pytest

from conftest import REPO
from extraction_format import (
    alert_id,
    assign_fact_ids,
    assign_keys,
    build_fact_key,
    date_precision_problem,
    date_seg,
    fnv1a32,
    norm_text,
    pair_subject,
    validate_run,
    value_text,
)

DOMAIN = REPO / "packages/domain"
VECTORS = json.loads((DOMAIN / "test/extraction-key-vectors.json").read_text(encoding="utf-8"))
EXAMPLE = json.loads((DOMAIN / "schema/examples/worked-examples.json").read_text(encoding="utf-8"))


def example() -> dict:
    return copy.deepcopy(EXAMPLE)


def codes(run: dict) -> list[str]:
    return [i.code for i in validate_run(run).issues]


def drafts(run: dict) -> list[dict]:
    return [{k: v for k, v in f.items() if k not in ("id", "key")} for f in run["facts"]]


# Shared vectors: written by packages/domain/scripts/extraction-key-vectors.ts from the TypeScript functions.


@pytest.mark.parametrize(("text", "want"), VECTORS["fnv1a32"])
def test_fnv1a32(text, want):
    assert fnv1a32(text) == want


@pytest.mark.parametrize(("text", "want"), VECTORS["norm_text"])
def test_norm_text(text, want):
    assert norm_text(text) == want


@pytest.mark.parametrize(("date", "want"), VECTORS["date_seg"])
def test_date_seg(date, want):
    assert date_seg(date) == want


@pytest.mark.parametrize("vector", VECTORS["fact_keys"], ids=lambda v: v["fact"]["kind"])
def test_fact_keys(vector):
    sources = {s["id"]: s for s in vector["sources"]}
    assert build_fact_key(vector["fact"], sources) == vector["key"]


@pytest.mark.parametrize(("alert", "want"), VECTORS["alert_ids"])
def test_alert_ids(alert, want):
    assert alert_id(alert) == want


@pytest.mark.parametrize(("value", "want"), VECTORS["value_text"])
def test_value_text(value, want):
    assert value_text(value) == want


@pytest.mark.parametrize(("date", "bad"), VECTORS["date_precision"])
def test_date_precision(date, bad):
    assert (date_precision_problem(date) is not None) == bad


@pytest.mark.parametrize("vector", VECTORS["collisions"])
def test_collisions(vector):
    assert [f["key"] for f in assign_keys(vector["facts"], vector["sources"])] == vector["keys"]


@pytest.mark.parametrize("m", VECTORS["matches"], ids=lambda m: m["name"])
def test_matcher_scenarios(m):
    opts = m["options"]
    res = assign_fact_ids("NO-010", m["drafts"], m["sources"], m["previous"], opts.get("retiredDocuments", ()), opts.get("issuedIds", ()))
    assert [f["id"] for f in res.facts] == m["expected"]["ids"]
    assert [f["key"] for f in res.facts] == m["expected"]["keys"]
    assert res.how == m["expected"]["how"]
    assert res.dropped == m["expected"]["dropped"]


def test_vectors_cover_every_fact_kind():
    from extraction_format import FACT_KINDS

    assert {v["fact"]["kind"] for v in VECTORS["fact_keys"]} == set(FACT_KINDS)


# Keys and IDs.


def test_worked_example_keys():
    run = example()
    src = {s["id"]: s for s in run["sources"]}
    assert build_fact_key(run["facts"][0], src) == "lab_result|S_HSCRP|draw:undated|doc:10_pacient"
    assert build_fact_key(run["facts"][1], src) == "stage|pathological|2022-06-02"


def test_collision_suffix_by_content_not_position():
    run = example()
    lab = run["facts"][0]
    second = {**lab, "value": {**lab["value"], "value_as_written": "12,0", "value_numeric": 12}}
    plain = "lab_result|S_HSCRP|draw:undated|doc:10_pacient"
    for facts, sources in (([lab, second], run["sources"]), ([second, lab], list(reversed(run["sources"])))):
        keyed = {f["value"]["value_as_written"]: f["key"] for f in assign_keys(facts, sources)}
        assert keyed == {"12,0": plain, "9,5": f"{plain}#2"}


def test_pair_subject_is_order_free():
    assert pair_subject("f-b", "f-a") == pair_subject("f-a", "f-b")


def test_same_keys_keep_ids_when_reordered():
    prev = example()
    res = assign_fact_ids("NO-010", list(reversed(drafts(prev))), prev["sources"], prev)
    by_key = {f["key"]: f["id"] for f in prev["facts"]}
    assert all(f["id"] == by_key[f["key"]] for f in res.facts)
    assert res.dropped == []


def test_reworded_fact_keeps_id_by_similarity():
    prev = example()
    d = drafts(prev)
    d[2] = {**d[2], "value": {**d[2]["value"], "what": "projednání nálezu MR mozku na neurochirurgickém semináři FNO"}}
    res = assign_fact_ids("NO-010", d, prev["sources"], prev)
    assert res.facts[2]["id"] == "f-3c90de"
    assert res.how["f-3c90de"] == "similar"


def test_dropped_fact_is_reported():
    prev = example()
    d = [f for f in drafts(prev) if f["kind"] != "metastasis"]
    assert assign_fact_ids("NO-010", d, prev["sources"], prev).dropped == ["f-5a0b12"]


def test_ids_equal_the_typescript_ids_for_a_first_run():
    # mintFactId hashes the case and the key, so a first run without a previous one gives fixed IDs on both sides.
    prev = example()
    res = assign_fact_ids("NO-010", drafts(prev), prev["sources"], None)
    for f in res.facts:
        assert f["id"].startswith("f-") and len(f["id"]) == 10
    assert res.facts[0]["id"] == "f-" + fnv1a32("NO-010|" + res.facts[0]["key"])


def test_draft_references_are_rewritten():
    prev = example()
    d = [{**f, "draft_id": f"d{i}"} for i, f in enumerate(drafts(prev))]
    d[6] = {**d[6], "value": {**d[6]["value"], "from_fact": "d1", "to_fact": "d5"}, "based_on": ["d1", "d5"]}
    res = assign_fact_ids("NO-010", d, prev["sources"], None)
    iv = res.facts[6]
    assert iv["value"]["from_fact"] == res.facts[1]["id"]
    assert iv["value"]["to_fact"] == res.facts[5]["id"]
    assert iv["based_on"] == [res.facts[1]["id"], res.facts[5]["id"]]
    assert iv["key"] == f"interval|{res.facts[1]['id']}|{res.facts[5]['id']}"
    assert all("draft_id" not in f for f in res.facts)


# The validator: the same cases and codes as validate.ts.


def test_accepts_worked_examples():
    assert validate_run(example()).issues == []


def test_unknown_field_and_wrong_enum():
    run = example()
    run["facts"][0]["certanity"] = "clear"
    run["facts"][1]["value"]["stage_kind"] = "radiological"
    issues = validate_run(run).issues
    assert [i.path for i in issues] == ["/facts/0/certanity", "/facts/1/value/stage_kind"]
    assert issues[0].message == "unknown field certanity"


def test_unknown_kind():
    run = example()
    run["facts"][0]["kind"] = "tumour_board"
    assert "unknown_kind" in codes(run)


def test_duplicate_fact_ids():
    run = example()
    run["facts"][1]["id"] = run["facts"][0]["id"]
    assert "duplicate_fact_id" in codes(run)


def test_fact_without_sources():
    run = example()
    run["facts"][0]["sources"] = []
    assert codes(run) == ["fact_without_sources"]
    ok = example()
    del ok["facts"][6]["based_on"]
    assert codes(ok) == ["fact_without_sources"]


def test_unknown_sources_documents_and_parts():
    run = example()
    run["facts"][0]["sources"] = ["src-nope"]
    run["sources"][0]["part"] = "10_pacient/p9"
    run["checks"][0]["covered"].append({"document_id": "11_pacient", "part": None})
    assert sorted(codes(run)) == ["unknown_document", "unknown_part", "unknown_source"]


def test_alert_rules():
    run = example()
    run["alerts"][0]["facts"] = ["f-000000"]
    run["alerts"][0]["id"] = "al-anything"
    assert sorted(codes(run)) == ["alert_id_mismatch", "unknown_fact"]


def test_brief_and_question_references():
    run = example()
    run["brief"]["sentences"].append({"text": "Bez zdroje.", "facts": []})
    run["question_draft"]["basis"][0]["facts"] = ["f-000000"]
    assert sorted(codes(run)) == ["sentence_without_facts", "unknown_fact"]


def test_key_mismatch_and_suffix():
    run = example()
    run["facts"][1]["key"] = "stage|pathological|2022-06"
    assert codes(run) == ["key_mismatch"]
    run["facts"][1]["key"] = "stage|pathological|2022-06-02#2"
    assert codes(run) == []


def test_contradiction_of_mixed_kinds():
    run = example()
    subject = pair_subject("f-8d41c2", "f-0b19e4")
    run["alerts"].append({"id": alert_id({"rule": "same_time_disagrees", "subject": subject}), "rule": "same_time_disagrees", "subject": subject, "kind": "contradiction", "facts": ["f-8d41c2", "f-0b19e4"], "message": {"id": "alert-contradiction", "args": {}}, "note": None})
    assert codes(run) == ["contradiction_mixed_kinds"]


def test_quarantine():
    run = example()
    run["sources"][0]["identity"] = "conflicts"
    assert "quarantine_missing" in codes(run)
    run["facts"][0]["quarantined"] = True
    assert codes(run) == ["quarantine_without_identity_alert"]
    subject = "10_pacient/p2#3"
    run["alerts"].append({"id": alert_id({"rule": "page_identity_conflict", "subject": subject}), "rule": "page_identity_conflict", "subject": subject, "kind": "identity", "facts": ["f-8d41c2"], "message": {"id": "alert-identity-conflict", "args": {"page": 3}}, "note": None})
    assert codes(run) == []
    run["brief"]["sentences"][0]["facts"].append("f-8d41c2")
    assert codes(run) == ["quarantined_in_use"]


def test_quarantine_without_conflict():
    run = example()
    run["facts"][0]["quarantined"] = True
    assert "quarantine_without_conflict" in codes(run)


def test_interval_is_the_assistants():
    run = example()
    run["facts"][6]["origin"] = "document"
    assert "interval_not_assistant" in codes(run)


# Guards added after the separate review: the same cases as the TypeScript tests.


def test_flipped_negation_subject_or_status_gets_a_new_id():
    prev = example()
    for i, change in ((4, {"negated": False}), (2, {"status": "done"}), (2, {"subject": "relative"})):
        d = drafts(prev)
        d[i] = {**d[i], **change}
        res = assign_fact_ids("NO-010", d, prev["sources"], prev)
        assert res.facts[i]["id"] != prev["facts"][i]["id"]
        assert prev["facts"][i]["id"] in res.dropped


def test_partial_date_that_gained_a_day():
    run = example()
    run["facts"][1]["date"] = {"as_written": "6/2022", "precision": "month", "sort": "2022-06-02"}
    assert "date_precision" in codes(run)


def test_metastasis_negation_mismatch():
    run = example()
    run["facts"][4]["negated"] = False
    assert codes(run) == ["negation_mismatch"]


def test_relative_subject_outside_family_history():
    run = example()
    run["facts"][4]["subject"] = "relative"
    assert codes(run) == ["subject_mismatch"]


def test_check_result_mismatch():
    run = example()
    run["checks"][1]["result"] = "nothing_found"
    run["checks"][0]["result"] = "found"
    assert codes(run) == ["check_result_mismatch", "check_result_mismatch"]


def test_quarantined_fact_in_check_or_alert_subject():
    run = example()
    run["sources"][2]["identity"] = "conflicts"
    run["facts"][2]["quarantined"] = True
    run["alerts"][0]["facts"] = []
    run["question_draft"] = None
    run["checks"].append({"id": "chk-x", "looks_for": "original_report", "expected": {"of_fact": "f-3c90de"}, "covered": [], "unreadable": [], "result": "nothing_found"})
    run["alerts"].append({"id": alert_id({"rule": "page_identity_conflict", "subject": "p"}), "rule": "page_identity_conflict", "subject": "p", "kind": "identity", "facts": ["f-3c90de"], "message": {"id": "x", "args": {}}, "note": None})
    assert [(i.code, i.path) for i in validate_run(run).issues] == [
        ("quarantined_in_use", "/alerts/0/subject"),
        ("quarantined_in_use", f"/checks/{len(run['checks']) - 1}/expected/of_fact"),
    ]


def test_source_errors_against_own_type_without_values():
    run = example()
    run["sources"][0]["quote_text"] = "ocr"
    run["sources"][1]["extra"] = 1
    del run["sources"][1]["quote"]
    issues = validate_run(run).issues
    assert all(i.code == "schema" for i in issues)
    assert sorted(i.path for i in issues) == ["/sources/0/quote_text", "/sources/1", "/sources/1/extra"]
    # The bad value itself never lands in a message: it may be patient text.
    assert not any("ocr" in i.message for i in issues)
