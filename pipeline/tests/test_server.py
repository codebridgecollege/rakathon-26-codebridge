"""The container's HTTP API, started in a thread on a free port."""

import base64
import http.client
import json
import sys
import threading
import urllib.error
import urllib.request

import fitz
import pytest

from conftest import REPO, needs_tesseract

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
    assert set(p) == {"n", "size", "png_b64", "words", "tess_text", "layer_text"}
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
    assert lab["counts"]["points"] == 18
    pt = lab["tests"][0]["points"][0]
    assert set(pt) >= {"value", "out_of_range", "flagged_in_document", "date", "time", "certainty", "source"}
    assert rec["text"][pt["source"]["start"]:pt["source"]["end"]] == pt["source"]["quote"]


def test_bad_content_length(base):
    host, port = base.removeprefix("http://").split(":")
    c = http.client.HTTPConnection(host, int(port), timeout=10)
    c.putrequest("POST", "/v1/inspect")
    c.putheader("Content-Length", "-1")
    c.endheaders()
    r = c.getresponse()
    assert r.status == 400 and json.loads(r.read())["error"]["code"] == "bad_request"


def test_huge_page_is_refused(base):
    doc = fitz.open()
    doc.new_page(width=14400, height=14400)  # 200 x 200 inches: 3.6 Gpx at 300 dpi
    status, body = call(base + "/v1/pages?from=1&to=1", doc.tobytes())
    assert status == 422 and body["error"]["code"] == "page_too_large"
