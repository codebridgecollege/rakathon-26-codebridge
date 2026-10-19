"""The intake demo's run (api/seed/seed.py run_for_uploads and finalize_upload_run).

NO-S02's converted run numbers pages across the combined PDF S02_pacient.pdf; the intake uploads one PDF per document
(samples/S02_pacient/upload/). The seed re-points every reference at the uploaded file and the page inside it. A wrong
page number would open the wrong page next to a quote the doctor is checking, so each mapped quote is looked up in the
text layer of the uploaded PDF itself, independent of the seed's own page index."""

import importlib.util
import json
import re

import fitz
import pytest

from conftest import REPO
from extraction_format import validate_run

SPEC = importlib.util.spec_from_file_location("seed", REPO / "api/seed/seed.py")
seed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed)  # main() is guarded, so loading defines functions only

UPLOAD = REPO / "samples/S02_pacient/upload"
SYN = json.loads((REPO / "fixtures/data/mock-case-S02.json").read_text(encoding="utf-8"))
RUN = json.loads((REPO / "fixtures/data/runs/NO-S02.json").read_text(encoding="utf-8"))


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", t.replace("*", "")).strip()


@pytest.fixture(scope="module")
def draft():
    index = json.loads(seed.load_build().page_index())
    pages = {p["n"]: p for p in index[SYN["file"]]["pages"]}
    sha = {d["upload_name"]: seed.sha256_file(UPLOAD / d["upload_name"]) for d in SYN["documents"] if d.get("upload_name")}
    return seed.run_for_uploads(RUN, SYN, pages, sha)


def upload_text(name: str, page: int) -> str:
    with fitz.open(UPLOAD / name) as pdf:
        assert 1 <= page <= pdf.page_count, (name, page)
        return norm(pdf[page - 1].get_text())


def test_every_quote_is_on_the_uploaded_page_it_names(draft):
    docs = SYN["documents"]
    assert len(draft["sources"]) == len(RUN["sources"])
    renumbered = 0
    for orig, mapped in zip(RUN["sources"], draft["sources"]):
        name = mapped["document_id"].removeprefix(seed.UPLOAD_DOC)
        assert mapped["part"] == seed.UPLOAD_PART + name
        # The part's document in the combined PDF is the uploaded file, and the page is that page inside it.
        d = docs[int(orig["part"].rsplit("/p", 1)[1])]
        assert d["upload_name"] == name
        assert d["pages"][mapped["page"] - 1] == orig["page"]
        assert norm(mapped["quote"]) in upload_text(name, mapped["page"]), (orig["id"], name, mapped["page"])
        renumbered += mapped["page"] != orig["page"]
    # Combined pages 3 to 8 are page 1 of their own files: the numbering restarts per file.
    assert renumbered > 0


def test_documents_and_checks_name_only_uploaded_files(draft):
    names = [d["upload_name"] for d in SYN["documents"] if d.get("upload_name")]
    assert [d["document_id"] for d in draft["documents"]] == [seed.UPLOAD_DOC + n for n in names]
    assert all(d["sha256"] == seed.sha256_file(UPLOAD / n) for d, n in zip(draft["documents"], names))
    raw = json.dumps({k: draft[k] for k in ("documents", "sources", "checks", "alerts")})
    assert "S02_pacient" not in raw
    # A check over the whole combined PDF covers every uploaded file.
    whole = next(c for c in draft["checks"] if c["id"] == "chk-report-s2-mr1")
    assert [x["document_id"] for x in whole["covered"]] == [seed.UPLOAD_DOC + n for n in names]


@pytest.mark.parametrize("case_id", ["NO-S02", "NO-123"])
def test_the_finished_run_is_valid_and_states_what_the_fixture_states(draft, case_id):
    # NO-S02 is the ID the intake gives the demo patient (api/src/domain/intake.ts): non-lab facts then keep their
    # fixture ID while lab facts (whose key names the uploaded document) get new ones, so draft references must be
    # rewritten for some facts and kept for others. NO-123 is a case where every ID changes.
    stand_in = {n.removeprefix(seed.UPLOAD_DOC): n.removeprefix(seed.UPLOAD_DOC)[:-4] for n in (d["document_id"] for d in draft["documents"])}
    run = seed.finalize_upload_run(draft, stand_in, case_id, f"fixture-{case_id}-test")
    res = validate_run(run)
    assert res.ok, [(i.code, i.path) for i in res.issues]
    assert len(run["facts"]) == len(RUN["facts"]) and len(run["alerts"]) == len(RUN["alerts"])
    strip = lambda r: sorted(re.sub(r"\|doc:[^|]*", "|doc:", f["key"]) for f in r["facts"])  # noqa: E731
    assert strip(run) == strip(RUN)
    # The same fact (by position) behind every reference: alerts, check expectations and fact links point at the
    # finished ID of the fact the fixture pointed at.
    final = {orig["id"]: new["id"] for orig, new in zip(RUN["facts"], run["facts"])}
    assert all(new["key"].split("|doc:")[0] == orig["key"].split("|doc:")[0] for orig, new in zip(RUN["facts"], run["facts"]))
    for orig, new in zip(RUN["alerts"], run["alerts"]):
        assert new["facts"] == [final[x] for x in orig["facts"]]
        assert new["message"]["args"] == {k: final.get(v, v) for k, v in orig["message"]["args"].items()}
    for orig, new in zip(RUN["checks"], run["checks"]):
        if orig.get("expected"):
            assert new["expected"]["of_fact"] == final[orig["expected"]["of_fact"]]
    for orig, new in zip(RUN["facts"], run["facts"]):
        assert new.get("based_on") == ([final[x] for x in orig["based_on"]] if orig.get("based_on") else orig.get("based_on"))
    kept = sum(final[k] == k for k in final)
    if case_id == "NO-S02":
        assert 0 < kept < len(final)
    else:
        assert kept == 0


def test_alert_parts_pages_and_pairs_map_to_the_uploads():
    index = json.loads(seed.load_build().page_index())
    pages = {p["n"]: p for p in index[SYN["file"]]["pages"]}
    sha = {d["upload_name"]: "0" * 64 for d in SYN["documents"] if d.get("upload_name")}
    up = [d["upload_name"] for d in SYN["documents"]]
    extra = {"rule": "test", "kind": "unclear", "facts": [], "note": None,
             "subject": "S02_pacient/p3|S02_pacient/p4", "message": {"id": "alert-test", "args": {"part": "S02_pacient/p4", "page": 6}}}
    out = seed.run_for_uploads({**RUN, "alerts": [*RUN["alerts"], extra]}, SYN, pages, sha)["alerts"][-1]
    assert out["subject"] == f"{seed.UPLOAD_PART}{up[3]}|{seed.UPLOAD_PART}{up[4]}"
    # Combined page 6 is the only page of the fifth document's file.
    assert out["message"]["args"] == {"part": seed.UPLOAD_PART + up[4], "page": 1}
    for bad in ({"document": "S02_pacient"}, {"page": 6}, {"part": "S02_pacient/p4", "page": 3}):
        with pytest.raises(SystemExit):
            seed.run_for_uploads({**RUN, "alerts": [{**extra, "subject": "x", "message": {"id": "alert-test", "args": bad}}]}, SYN, pages, sha)


def test_composed_view_lines_follow_the_final_fact_ids(draft):
    # NO-S02 has no composed views; a line over two of its facts must come out on their final IDs, with its ID derived.
    a, b = draft["facts"][0]["draft_id"], draft["facts"][1]["draft_id"]
    line = {"id": seed.view_line_id("timeline", [a, b]), "text": "x", "title": None, "detail": None, "date": None,
            "category": "laboratory", "status": "done", "facts": [a, b], "note": None}
    with_view = {**draft, "views": {"timeline": [line], "made_by": {"model": None, "prompt": None}}}
    stand_in = {d["document_id"].removeprefix(seed.UPLOAD_DOC): d["document_id"].removeprefix(seed.UPLOAD_DOC)[:-4] for d in draft["documents"]}
    run = seed.finalize_upload_run(with_view, stand_in, "NO-123", "fixture-NO-123-test")
    out = run["views"]["timeline"][0]
    assert out["facts"] == [run["facts"][0]["id"], run["facts"][1]["id"]]
    assert out["id"] == seed.view_line_id("timeline", out["facts"])
    assert run["views"]["made_by"] == {"model": None, "prompt": None}
