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


def test_the_finished_run_is_valid_and_states_what_the_fixture_states(draft):
    stand_in = {n.removeprefix(seed.UPLOAD_DOC): n.removeprefix(seed.UPLOAD_DOC)[:-4] for n in (d["document_id"] for d in draft["documents"])}
    run = seed.finalize_upload_run(draft, stand_in, "NO-123", "fixture-NO-123-test")
    res = validate_run(run)
    assert res.ok, [(i.code, i.path) for i in res.issues]
    assert len(run["facts"]) == len(RUN["facts"]) and len(run["alerts"]) == len(RUN["alerts"])
    strip = lambda r: sorted(re.sub(r"\|doc:[^|]*", "|doc:", f["key"]) for f in r["facts"])  # noqa: E731
    assert strip(run) == strip(RUN)
    # Fact IDs belong to the new case, and every reference uses them.
    ids = {f["id"] for f in run["facts"]}
    assert not ids & {f["id"] for f in RUN["facts"]}
    assert all(set(a["facts"]) <= ids for a in run["alerts"])
    assert all(c["expected"]["of_fact"] in ids for c in run["checks"] if c.get("expected"))
