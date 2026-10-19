"""The container's HTTP API, started in a thread on a free port."""

import base64
import http.client
import io
import json
import sys
import threading
import urllib.error
import urllib.request

import fitz
import pytest
from PIL import Image, ImageDraw

from conftest import REPO, needs_tesseract
from page_reader import page_index, redact

sys.path.insert(0, str(REPO / "pipeline/container"))
import server  # noqa: E402

PDF = REPO / "samples/S02_pacient/upload/04-laborator-2026-03-10.pdf"


@pytest.fixture(scope="module")
def base():
    srv = server.make_server(0, "127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def call(url, body=None, method=None):
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_healthz(base):
    status, body = call(base + "/healthz")
    assert status == 200 and body["ok"] is True
    assert set(body["versions"]) == {"page_reader", "pymupdf", "tesseract", "ces_model"}


def test_inspect(base):
    status, body = call(base + "/v1/inspect", PDF.read_bytes())
    assert status == 200
    assert body == {"page_count": 1, "encrypted": False, "producer_present": body["producer_present"], "has_text_layer": [True]}
    assert isinstance(body["producer_present"], bool)


def test_inspect_refuses_non_pdf_and_encrypted(base):
    status, body = call(base + "/v1/inspect", b"PK\x03\x04 not a pdf")
    assert status == 422 and body["error"]["code"] == "not_pdf" and body["error"]["message_cs"]
    doc = fitz.open(PDF)
    enc = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="x", owner_pw="y")
    status, body = call(base + "/v1/inspect", enc)
    assert status == 422 and body["error"]["code"] == "encrypted"
    many = fitz.open()
    for _ in range(61):
        many.new_page()
    status, body = call(base + "/v1/inspect", many.tobytes())
    assert status == 422 and body["error"]["code"] == "too_many_pages"


def test_errors(base):
    assert call(base + "/nope")[0] == 404
    assert call(base + "/v1/analyze", b"{not json")[1]["error"]["code"] == "bad_json"
    assert call(base + "/v1/pages?from=2&to=3", PDF.read_bytes())[1]["error"]["code"] == "bad_range"
    assert call(base + "/v1/inspect", method="GET")[0] == 405


@needs_tesseract
def test_pages_analyze_labs(base):
    status, body = call(base + "/v1/pages?from=1&to=1", PDF.read_bytes())
    assert status == 200 and len(body["pages"]) == 1
    p = body["pages"][0]
    assert set(p) == {"n", "size", "png_b64", "words", "tess_text", "layer_text", "unreadable"}
    assert p["unreadable"] == []  # clean print: no ink without confidently read words
    assert base64.b64decode(p["png_b64"])[:8] == b"\x89PNG\r\n\x1a\n"
    png = base64.b64decode(p["png_b64"])
    assert p["size"] == [int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")]
    assert p["size"][0] == 1240  # A4 at 150 dpi
    assert p["words"] and set(p["words"][0]) == {"t", "c", "b"} and "Odběr" in p["tess_text"] and "B_LKC" in p["layer_text"]

    page = {k: p[k] for k in ("n", "words", "tess_text", "layer_text", "size")}
    status, an = call(base + "/v1/analyze", {"pages": [page]})
    assert status == 200
    rec, rd = an["pages"][0]["page"], an["pages"][0]["readability"]
    assert rec["engine"] == "tesseract" and rec["second_reading"] == "text_layer" and rec["text"] == p["tess_text"]
    assert rd["level"] in ("good", "fair") and set(rd) == {"level", "reasons_cs", "metrics"}
    assert an["document"]["level"] == rd["level"]

    status, lab = call(base + "/v1/labs", {"pages": [{"n": 1, "text": rec["text"], "layer_text": p["layer_text"],
                                                       "readability_level": rd["level"], "words": rec["words"]}],
                                            "document": {"doc_id": "doc-1"}})
    assert status == 200
    assert set(lab) >= {"draws", "tests", "unparsed", "counts"}
    assert lab["draws"][0]["date"] == "2026-03-10" and lab["draws"][0]["source"]["doc_id"] == "doc-1"
    # 18 results on the sheet: read, or listed as only in the PDF text layer when this Tesseract build lost one
    # (5.3.0 in the container loses B_NEU), never missing without a trace.
    listed = [u for u in lab["unparsed"] if u["reason"] == "only_second_reading"]
    assert lab["counts"]["points"] + len(listed) == 18 and len(listed) <= 1
    pt = lab["tests"][0]["points"][0]
    assert set(pt) >= {"value", "out_of_range", "flagged_in_document", "date", "time", "certainty", "source"}
    assert rec["text"][pt["source"]["start"]:pt["source"]["end"]] == pt["source"]["quote"]


@needs_tesseract
def test_pages_find_handwriting_and_analyze_marks_it(base):
    """A handwritten note drawn below the results of S02's lab sheet: /v1/pages returns it as an unreadable region,
    /v1/analyze keeps the region on the page record and gives the readability reason. Tesseract may read the
    strokes as low-confidence garbage ("low_conf") or not at all ("no_text"); both are unreadable."""
    doc = fitz.open(PDF)
    page = doc[0]
    for row in range(3):  # 3 lines of zigzag strokes, as in tests/test_unreadable.py, in PDF points
        y = 650 + row * 26
        page.draw_polyline([(72 + k * 6, y + (19 if k % 2 else 0)) for k in range(41)], width=1.5)
    status, body = call(base + "/v1/pages?from=1&to=1", doc.tobytes())
    assert status == 200
    p = body["pages"][0]
    assert len(p["unreadable"]) == 1 and p["unreadable"][0]["reason"] in ("no_text", "low_conf")
    x, y, rw, rh = p["unreadable"][0]["b"]
    # 72 pt is 150 px at 150 dpi; the note spans 72-312 pt across and 650-721 pt down.
    assert x <= 152 and x + rw >= 636 and y <= 1356 and y + rh >= 1490
    raw = {k: p[k] for k in ("n", "words", "tess_text", "layer_text", "size", "unreadable")}
    status, an = call(base + "/v1/analyze", {"pages": [raw]})
    assert status == 200
    rec, rd = an["pages"][0]["page"], an["pages"][0]["readability"]
    assert rec["unreadable"] == p["unreadable"]
    assert any("nelze přečíst" in r for r in rd["reasons_cs"]) and rd["level"] in ("fair", "poor")
    # Whatever Tesseract guessed inside the region is marked, never shown as read.
    inside = [w for w in rec["words"] if x <= w["b"][0] + w["b"][2] / 2 <= x + rw and y <= w["b"][1] + w["b"][3] / 2 <= y + rh]
    marked = {v["start"] for v in rec["verify"] if v["reason"] == "unreadable"}
    assert len(marked) >= min(1, len(inside))


def test_analyze_takes_unreadable_regions(base):
    words = [{"t": f"slovo{i}", "c": 95, "b": [100 + 60 * (i % 10), 100 + 30 * (i // 10), 50, 20]} for i in range(30)]
    text = "\n".join(" ".join(f"slovo{i}" for i in range(r * 10, r * 10 + 10)) for r in range(3))
    page = {"n": 2, "words": words, "tess_text": text, "layer_text": "", "size": [1240, 1755],
            "unreadable": [{"b": [90, 90, 120, 40], "reason": "low_conf"}]}
    status, an = call(base + "/v1/analyze", {"pages": [page]})
    assert status == 200
    rec, rd = an["pages"][0]["page"], an["pages"][0]["readability"]
    assert rec["unreadable"] == page["unreadable"]
    assert [(v["tess"], v["reason"]) for v in rec["verify"]] == [("slovo0", "unreadable"), ("slovo1", "unreadable")]
    assert "s. 2: oblast, kterou nelze přečíst (např. rukopis, podpis nebo razítko)" in rd["reasons_cs"]
    # Without the field the image was not looked at: an empty list on the record, no rule in readability.
    del page["unreadable"]
    status, an = call(base + "/v1/analyze", {"pages": [page]})
    assert an["pages"][0]["page"]["unreadable"] == [] and an["pages"][0]["readability"]["metrics"]["unreadable_regions"] is None
    for bad in ([{"b": [1, 2, 3], "reason": "no_text"}], [{"b": [1, 2, 3, 4], "reason": "smudge"}], "x"):
        status, body = call(base + "/v1/analyze", {"pages": [dict(page, unreadable=bad)]})
        assert status == 400 and body["error"]["code"] == "bad_request"


def test_identity(base, caplog):
    text = (REPO / "samples/derived/pages/S04_pacient/p4.tess.txt").read_text()
    own = (REPO / "samples/derived/pages/S04_pacient/p1.tess.txt").read_text()
    body = {"pages": [{"n": 1, "text": own}, {"n": 4, "text": text}],
            "expected": {"name": "Ludmila Vrbenská", "birth_number": "615203/1006", "birth_date": "1961-02-03"}}
    with caplog.at_level("INFO", logger="page_reader"):
        status, r = call(base + "/v1/identity", body)
    assert status == 200
    assert r["result"] == "conflicts" and r["pages"] == [{"n": 1, "result": "matches"}, {"n": 4, "result": "conflicts"}]
    assert all(set(e) == {"n", "start", "end", "field", "result"} for e in r["evidence"])
    # Neither the response nor the log carries an identifier's value.
    for secret in ("Vrbensk", "Lenka", "Ludmila", "615203", "595418", "1961"):
        assert secret not in json.dumps(r) and secret not in caplog.text
    assert "/v1/identity 200" in caplog.text
    for bad in ({"pages": [{"n": 1, "text": "x"}]}, {"pages": [{"n": 1, "text": 5}], "expected": {}},
                {"pages": [{"text": "x"}], "expected": {}}, {"pages": [], "expected": {"name": 5}}):
        status, err = call(base + "/v1/identity", bad)
        assert status == 400 and err["error"]["code"] == "bad_request"


def test_bad_content_length(base):
    host, port = base.removeprefix("http://").split(":")
    c = http.client.HTTPConnection(host, int(port), timeout=10)
    c.putrequest("POST", "/v1/inspect")
    c.putheader("Content-Length", "-1")
    c.endheaders()
    r = c.getresponse()
    assert r.status == 400 and json.loads(r.read())["error"]["code"] == "bad_request"


def test_parts(base):
    text = "Ústav patologie\nBioptický histologický nález\nOdběr: 9.3.2026, přijato: 9.3.2026, vydáno: 12.3.2026\nZávěr: x y z w"
    status, body = call(base + "/v1/parts", {"pages": [{"n": 1, "text": text}]})
    assert status == 200
    p = body["parts"][0]
    assert (p["type"], p["date"], p["date_kind"], p["title_cs"]) == ("histology", "2026-03-12", "report", "Bioptický histologický nález")
    assert call(base + "/v1/parts", {"pages": [{"text": "x"}]})[1]["error"]["code"] == "bad_request"


def test_huge_page_is_refused(base):
    doc = fitz.open()
    doc.new_page(width=14400, height=14400)  # 200 x 200 inches: 3.6 Gpx at 300 dpi
    status, body = call(base + "/v1/pages?from=1&to=1", doc.tobytes())
    assert status == 422 and body["error"]["code"] == "page_too_large"


def _png_b64(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_redact_blacks_out_case_identity_and_returns_no_values(base):
    """S02 page 1 (our synthetic patient): name, birth number and the birth date after a mid-line "nar." are
    blacked out with identity from the case record; the answer names reasons and boxes, never the values."""
    d = REPO / "data/derived/pages/S02_pacient"
    entry = json.loads((REPO / "fixtures/data/mock-case-S02.json").read_text())["list_entry"]
    names = [[part.lower()] for part in entry["name"].split()]
    png = (d / "p1.png").read_bytes()
    status, body = call(base + "/v1/redact", {
        "pages": [{"n": 1, "png_b64": base64.b64encode(png).decode(), "words": page_index.tess_words(d / "p1.tess.tsv")}],
        "identity": {"names": names, "staff": [], "birth_number": entry["rc"], "birth_date": None},
        "ink_marks": True})
    assert status == 200
    page = body["pages"][0]
    reasons = {h["reason"] for h in page["hits"]}
    assert {"jméno pacienta", "rodné číslo", "datum narození"} <= reasons
    assert all(set(h) == {"reason", "box"} for h in page["hits"])
    text = json.dumps(page["hits"], ensure_ascii=False)
    for secret in [entry["rc"], *entry["name"].split()]:
        assert secret not in text
    assert base64.b64decode(page["png_b64"]) != png


def test_redact_staff_only_when_capitalized():
    line = [{"t": "Malá", "b": [0, 0, 40, 10]}, {"t": "pánev", "b": [45, 0, 40, 10]},
            {"t": "malé", "b": [90, 0, 40, 10]}, {"t": "pánve", "b": [135, 0, 40, 10]}]
    hits = redact.find([line], set(), {"mala", "male", "malou"})
    assert [h["box"][0] for h in hits] == [0]


def test_redact_names_need_capital_or_a_neighbour():
    words = [{"t": t, "b": [i * 60, 100, 50, 15]} for i, t in enumerate(["CT", "hlavy", "Hlava", "jan", "hlava"])]
    hits = redact.find(redact.lines_from_words(words), {"hlava": 1, "hlavy": 1, "jan": 0})
    assert [h["box"][0] for h in hits] == [120, 180, 240]


def test_redact_split_birth_number():
    words = [{"t": t, "b": [i * 60, 100, 50, 15]} for i, t in enumerate(["r.č.", "585614", "/", "1234", "CRP", "1234"])]
    hits = redact.find(redact.lines_from_words(words), set(), birth_number="585614/1234")
    assert [h["box"][0] for h in hits] == [60, 180]


def test_redact_mid_line_birth_date():
    words = [{"t": t, "b": [i * 60, 100, 50, 15]} for i, t in enumerate(["Testová", "Eva,", "nar.", "1.2.1950,", "C20"])]
    hits = redact.find(redact.lines_from_words(words), {"testova"})
    assert [h["reason"] for h in hits] == ["jméno pacienta", "datum narození"]


def test_redact_ink_marks(base):
    img = Image.new("L", (600, 800), 255)
    draw = ImageDraw.Draw(img)
    # a signature-like scribble with no OCR word over it
    draw.line([(100, 600), (140, 560), (170, 640), (210, 570), (260, 630), (300, 580)], fill=0, width=4)
    page = {"n": 1, "png_b64": _png_b64(img), "words": []}
    status, body = call(base + "/v1/redact", {"pages": [page], "identity": {}, "ink_marks": True})
    assert status == 200
    hits = body["pages"][0]["hits"]
    assert len(hits) == 1 and hits[0]["reason"].startswith("podpis")
    x, y, w, h = hits[0]["box"]
    assert x <= 100 and y <= 560 and x + w >= 300 and y + h >= 640
    status, body = call(base + "/v1/redact", {"pages": [page], "identity": {}, "ink_marks": False})
    assert status == 200 and body["pages"][0]["hits"] == []


def test_redact_refuses_bad_input(base):
    status, body = call(base + "/v1/redact", {"pages": [{"n": 1, "png_b64": "bm90IGEgcG5n", "words": []}], "identity": {}})
    assert status == 400 and body["error"]["code"] == "bad_request"
    many = [{"n": i, "png_b64": "", "words": []} for i in range(1, server.MAX_BATCH + 2)]
    status, body = call(base + "/v1/redact", {"pages": many, "identity": {}})
    assert status == 400 and body["error"]["code"] == "bad_request"
