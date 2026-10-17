"""Refactor safety: pagekit rebuilds the committed page index exactly, and the 6b-1 page record has its shape."""

import json

from conftest import PAGES, REPO
from pagekit import page_index as pi


def test_rebuild_equals_committed_page_index():
    committed = json.loads((REPO / "data/derived/page-index.json").read_text())
    rebuilt = pi.build_index(PAGES, log=lambda *_: None)
    assert list(rebuilt) == list(committed)
    for f, doc in committed.items():
        assert len(rebuilt[f]["pages"]) == len(doc["pages"])
        for a, b in zip(rebuilt[f]["pages"], doc["pages"]):
            assert a["verify"] == b["verify"], (f, b["n"])
            assert a == b, (f, b["n"])
    assert json.dumps(rebuilt, ensure_ascii=False) == (REPO / "data/derived/page-index.json").read_text()


def test_tesseract_vs_layer_page_record():
    d = PAGES / "S02_pacient"
    words = pi.tess_words(d / "p5.tess.tsv")
    text = (d / "p5.tess.txt").read_text()
    rec = pi.tesseract_page(5, [1240, 1754], text, words, (d / "p5.layer.txt").read_text())
    assert set(rec) == {"n", "size", "text", "engine", "words", "mean_conf", "low_conf_words", "verify", "second_reading"}
    assert rec["engine"] == "tesseract" and rec["second_reading"] == "text_layer" and rec["text"] == text
    assert rec["verify"], "the S02 lab sheet has misread units"
    for v in rec["verify"]:
        assert set(v) == {"tess", "start", "end", "layer", "conf", "box", "reason"}
        assert text[v["start"]:v["end"]] == v["tess"]  # offsets point into the text of record
        assert v["reason"] in ("disagree", "only_tesseract", "low_conf")
    # Tesseract's '10"9/|' against the layer's "10^9/l" is marked; offsets select exactly that token.
    assert any(v["tess"] == '10"9/|' and v["layer"] == "10^9/l" for v in rec["verify"])


def test_empty_layer_gives_only_low_conf_items():
    d = PAGES / "S02_pacient"
    words = pi.tess_words(d / "p5.tess.tsv")
    rec = pi.tesseract_page(5, [0, 0], (d / "p5.tess.txt").read_text(), words, "")
    assert rec["second_reading"] is None
    assert rec["verify"] and all(v["reason"] == "low_conf" for v in rec["verify"])
    assert all(v["conf"] < pi.LOW_CONF for v in rec["verify"])


def test_layer_only_risky_token_is_marked():
    text = "Staging pT2 M0 dle CT."
    words = [{"t": t, "c": 95, "b": [i * 10, 0, 8, 8]} for i, t in enumerate(text.split())]
    toks = pi.plain_tokens(text)
    items = pi.disagreements(toks, [{"t": t} for t in "Staging pT2 N1 M0 dle CT.".split()], text, pi.LAYER,
                             pi.attach_words(toks, words))
    assert [(v["reason"], v["layer"]) for v in items] == [("only_layer", "N1")]
    v = items[0]
    assert text[v["start"]:v["end"]] == v["tess"] and v["box"] is not None
