"""Redaction boxes from page_reader equal the committed p<n>.redactions.json, with the names the script uses."""

import json
import sys

from conftest import PAGES, REPO
from page_reader import redact

sys.path.insert(0, str(REPO / "scripts"))
import redact_pages  # noqa: E402


def test_redaction_boxes_equal_committed(monkeypatch):
    monkeypatch.chdir(REPO)  # the script resolves the mock case files relative to the repository
    names = redact_pages.known_names(REPO / "fixtures/data/mock-patient-list.json")
    committed = sorted(PAGES.glob("*/p*.redactions.json"))
    assert len(committed) >= 28
    for f in committed:
        n = f.name.split(".")[0]
        hits = redact.find(redact.read_lines(f.with_name(f"{n}.tess.tsv")), names)
        assert json.dumps(hits, ensure_ascii=False, indent=1) == f.read_text(), f
