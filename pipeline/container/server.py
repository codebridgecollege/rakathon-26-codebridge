"""The page reader over HTTP: the container the Worker's document Workflow calls (docs/research/backend-steps/step-6.md).

Run locally:  cd pipeline && uv run python container/server.py [--port 8080]
Run in Docker: docker build -f pipeline/container/Dockerfile -t page-reader . && docker run -p 8080:8080 page-reader
(build context is the repository root).

A standard-library ThreadingHTTPServer with JSON in and out. It holds no secrets, no storage and needs no
outbound network. It logs only method, path, status, duration and page counts, never a request or
response body, because bodies are patient documents.

Contract, version 1 (the Worker and the image can be deployed apart, so a breaking change gets /v2):

GET /healthz
  200 {"ok": true, "versions": {"page_reader": str, "pymupdf": str, "tesseract": str|null,
                                "ces_model": "sha256:<16 hex>"|bool}}

POST /v1/inspect            body: PDF bytes
  200 {"page_count": int, "encrypted": false, "producer_present": bool, "has_text_layer": [bool per page]}

POST /v1/pages?from=1&to=5  body: PDF bytes; pages are 1-based and inclusive, at most MAX_BATCH per call
  200 {"pages": [{"n": int, "size": [w, h],            # of the 150 dpi grayscale PNG
                  "png_b64": str,                      # that PNG, base64
                  "words": [{"t": str, "c": int, "b": [x, y, w, h]}],  # Tesseract on a 300 dpi render,
                                                       # boxes scaled to the 150 dpi PNG
                  "tess_text": str,                    # Tesseract -l ces --psm 4, plain text
                  "layer_text": str,                   # the PDF text layer, a second reading only
                  "unreadable": [{"b": [x, y, w, h],   # ink no confidently read word explains (handwriting,
                                  "reason": "no_text"|"low_conf"}]}]}  # signature, stamp), 150 dpi PNG coordinates
  unreadable (added in page reader 0.2.0): "low_conf" when a word Tesseract read below confidence 60 overlaps the
  region, else "no_text" (at most two confidently read words inside). The lines of one note are one region;
  regions narrower than 160 px, near-solid areas (photos, codes, logos) and ruled frames are left out
  (page_reader/redact.py).
  Nothing in a region is read or filled in.

POST /v1/analyze            body: {"pages": [{"n", "words", "tess_text", "layer_text", "size", "unreadable"?}]}
  200 {"pages": [{"n": int,
                  "page": {"n", "size", "text", "engine": "tesseract", "words", "mean_conf", "low_conf_words",
                           "verify": [{"tess", "start", "end", "layer", "conf", "box", "reason"}],
                           "second_reading": "text_layer"|null,
                           "unreadable": [{"b", "reason"}]},  # as sent ([] when not sent)
                  "readability": {"level": "good"|"fair"|"poor"|"empty", "reasons_cs": [str],
                                  "metrics": {...}}}],
       "document": {"level": str, "reasons_cs": [str]}}
  "text" is Tesseract's text (the text of record); start/end are offsets into it. verify reasons:
  "disagree" (the text layer reads it differently), "only_tesseract" (not in the layer), "low_conf"
  (Tesseract's confidence below 60 on a token with a digit), and since 0.2.0 "unreadable" (a token whose word box
  centre lies in an unreadable region; layer null, box the region's). second_reading is null when the page has
  no text layer; then only low_conf and unreadable items appear. unreadable is the field /v1/pages returned, passed
  on as is; without it the image counts as not looked at (metrics unreadable_regions null). Since 0.2.0 the
  readability also judges tokens with a shape no Czech or medical word has (metrics garbage_share, garbage per
  kind) and unreadable regions (metrics unreadable_regions, unreadable_share); see page_reader/readability.py.

POST /v1/labs               body: {"pages": [{"n", "text", "layer_text", "readability_level",
                                              "words"?, "engine"?, "doc_id"?}],
                                   "document": {"doc_id": str}}
  200 {"name_note", "draws": [...], "tests": [...], "indices": [...], "unparsed": [{"n", "doc_id", "line_no",
       "start", "end", "reason", "reason_cs"}], "counts": {...}}
  The labs_series shape of fixtures/data/mock-case-S02.json; see page_reader/labs.py for the rules.
  unparsed reasons: "lab_like_not_parsed", "draw_date_not_parsed" (offsets into "text"), and
  "only_second_reading" (a result only the text layer has; offsets into "layer_text", with "in", "code"
  and "quote"). A page without readability_level counts as not readable: its points are unclear_ocr.
  Since 0.2.0 a line that starts like a lab sheet's code and has a value, a range or a lab unit is listed as
  lab_like_not_parsed even when OCR turned its letters into Czech capitals or lost its colon and brackets.

POST /v1/compare            body: {"pages": [{"n", "text", "words"}]}
  200 {"pages": [{"n": int, "verify": [{"vision", "start", "end", "tess", "conf", "box", "reason"}]}]}
  Where a vision reading of a page (issue #20) disagrees with Tesseract's words: every span that matters clinically
  and is not confirmed by both, with offsets into "text" (the "ověřit" marks of the page index, page_index.disagreements).

POST /v1/redact             body: {"pages": [{"n", "png_b64", "words"}],
                                   "identity": {"names": [[str]], "staff": [[str]], "birth_number": str|null,
                                                "birth_date": str|null},
                                   "ink_marks": bool}
  200 {"pages": [{"n": int, "png_b64": str, "hits": [{"reason": str, "box": [x, y, w, h]}]}]}
  Blacks out direct identifiers on page images before they may leave for a cloud model (option B in
  docs/design/DATA-PROTECTION.md). names and staff are folded name forms (lower case, no diacritics, declined), one
  list per name part (a plain list of strings counts each as its own part), which
  the Worker computes from the case record and the org's staff (api/src/domain/pseudonymize.ts, nameForms); staff
  a form counts on a capitalized word, or in any case next to another part of the same name. ink_marks also blacks out dark areas no OCR word covers (signatures,
  stamps, handwriting; best effort). Hits carry the reason and the box, never the value. At most MAX_BATCH pages.

POST /v1/convert            body: JPEG or PNG bytes (a photo of a page), judged by its magic bytes
  200 {"pdf_b64": str, "width": int, "height": int}
  A one-page A4 PDF holding the photo upright (EXIF orientation applied), in grayscale, without the photo's
  metadata; width and height are the upright photo's pixels. See page_reader/convert.py.

POST /v1/parts              body: {"pages": [{"n", "text", "layer_text"?, "readability_level"?}]}
  200 {"parts": [{"ordinal": int, "pages": [int], "from": {"n", "offset"}, "to": {"n", "offset"|null},
                  "type": "outpatient_report"|"discharge_report"|"lab_results"|"histology"|"radiology"|
                          "operation_protocol"|"request"|"mdt_referral"|"other"|"unknown",
                  "title_cs": str|null, "date_as_written": str|null, "date": "YYYY-MM-DD"|"YYYY-MM"|"YYYY"|null,
                  "date_kind": "draw"|"report"|"exam"|"operation"|"admission"|"discharge"|null,
                  "evidence": [{"n", "start", "end", "what": "title"|"type"|"date"}],
                  "certainty": "documented"|"verify", "verify_reasons": [str],
                  "readability_level": str|null}]}
  The clinical documents inside one PDF, in page order (page_reader/parts.py has the rules). "text" is the
  text of record (Tesseract's); layer_text is accepted and not used yet. A page may belong to two parts when a
  document starts inside it (FNO's lab panel under a report): "from"/"to" offsets say where (to.offset null =
  page end). title_cs and date_as_written are as printed, never invented; a labelled date that does not read
  as a date gives date null and certainty "verify". "unknown" is shown as "neurčeno" for the doctor to set.
  readability_level is the worst page level when every page of the part carries one, else null.

POST /v1/identity           body: {"pages": [{"n", "text"}],
                                   "expected": {"name": str|null, "birth_number": str|null, "birth_date": str|null}}
  200 {"result": "matches"|"conflicts"|"cannot_verify",
       "pages": [{"n": int, "result": ...}],
       "evidence": [{"n": int, "start": int, "end": int, "field": "name"|"birth_number"|"birth_date",
                     "result": ...}]}
  Added in 0.2.0. Whether each page names the expected patient (page_reader/identity.py has the rules): a valid
  differing birth number after a birth-number label or on the header line, or a clearly different full name in a
  form field or the header line, conflicts; a damaged or unlabelled number, a number next to a relative, a
  differing birth date, or a name that differs only in diacritics or one misread letter cannot be verified; a
  page matches on its name or birth number (a birth date that equals only supports a match, its evidence then
  says "matches"); nothing found cannot be verified. "text" is the text of record; offsets point into it. The
  answer holds offsets and field kinds only, never a value. birth_date is "YYYY-MM-DD" or "d.m.yyyy". At most
  MAX_PAGES pages.

Errors: {"error": {"code": str, "message_cs": str}} with
  400 bad_json, bad_request, bad_range; 404 not_found; 405 method_not_allowed; 413 too_large;
  422 not_pdf, encrypted, too_many_pages, unreadable_pdf, page_too_large (over MAX_PIXELS at 300 dpi),
  not_image, image_too_large (over convert.MAX_PIXELS); 500 internal (no detail, nothing from the body).
"""

import base64
import io
import json
import logging
import math
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# In the image server.py sits next to page_reader/ in /app; in the repository page_reader/ is one folder up.
_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here if (_here / "page_reader").is_dir() else _here.parent))

import fitz  # noqa: E402  PyMuPDF
from PIL import Image  # noqa: E402

from page_reader import (VERSION, convert, identity, labs, layer, ocr, page_index, parts, readability,  # noqa: E402
                         redact, render)

MAX_BODY = 20 * 1024 * 1024  # the upload limit of step 6, so anything larger never came from our Worker
MAX_PAGES = 60  # a referral PDF is a few dozen pages; more is a wrong upload, and it bounds the work
# A4 at 300 dpi is 8.7 Mpx and A3 17.4 Mpx; 40 Mpx leaves room for large scans while one grayscale render
# stays under 40 MB.
MAX_PIXELS = 40_000_000
MAX_BATCH = 10  # the Workflow sends 5; 10 leaves room and keeps one response at a few MB

REQUEST_TIMEOUT = 30  # seconds a client may take to send its body; a stalled upload must not hold a thread

log = logging.getLogger("page_reader")
# PyMuPDF is not thread-safe, and the instance has half a vCPU, so PDF and OCR work runs one request at a
# time; a Workflow retry that overlaps a slow batch waits instead of crashing the process.
WORK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message_cs: str):
        super().__init__(code)
        self.status, self.code, self.message_cs = status, code, message_cs


def _open(body: bytes) -> fitz.Document:
    """Open the PDF body or refuse it, with the same checks for every PDF endpoint."""
    if not render.is_pdf(body):
        raise ApiError(422, "not_pdf", "Soubor není PDF.")
    try:
        doc = render.open_pdf(body)
    except Exception:  # PyMuPDF raises its own types for damaged files; the detail may quote the file
        raise ApiError(422, "unreadable_pdf", "PDF nelze otevřít, soubor je poškozený.") from None
    if render.is_encrypted(doc):
        raise ApiError(422, "encrypted", "PDF je zaheslované nebo šifrované; nahrajte nezabezpečenou kopii.")
    if doc.page_count > MAX_PAGES:
        raise ApiError(422, "too_many_pages", f"PDF má více než {MAX_PAGES} stran; rozdělte ho na jednotlivé dokumenty.")
    return doc


def healthz(_body, _query) -> tuple[dict, int]:
    return {"ok": True, "versions": {"page_reader": VERSION, "pymupdf": fitz.VersionBind, **ocr.versions()}}, 0


def inspect(body: bytes, _query) -> tuple[dict, int]:
    with WORK:
        doc = _open(body)
        try:
            return _inspect(doc)
        finally:
            doc.close()


def _inspect(doc) -> tuple[dict, int]:
    return {
        "page_count": doc.page_count,
        "encrypted": False,  # an encrypted file is refused above
        "producer_present": bool((doc.metadata or {}).get("producer")),
        "has_text_layer": [layer.has_text(p) for p in doc],
    }, doc.page_count


def pages(body: bytes, query: dict) -> tuple[dict, int]:
    with WORK:
        doc = _open(body)
        try:
            return _pages(doc, query)
        finally:
            doc.close()


def _pages(doc, query: dict) -> tuple[dict, int]:
    try:
        lo = int(query.get("from", ["1"])[0])
        hi = int(query.get("to", [str(lo)])[0])
    except ValueError:
        raise ApiError(400, "bad_range", "Parametry from a to musí být čísla stran.") from None
    if not (1 <= lo <= hi <= doc.page_count) or hi - lo + 1 > MAX_BATCH:
        raise ApiError(400, "bad_range", f"Rozsah stran musí ležet v 1-{doc.page_count} a mít nejvýš {MAX_BATCH} stran.")
    # Check every page of the batch before rendering any: a huge mediabox would exhaust memory at 300 dpi.
    for n in range(lo, hi + 1):
        if render.pixels(doc[n - 1], render.OCR_DPI) > MAX_PIXELS:
            raise ApiError(422, "page_too_large", f"Strana {n} je příliš velká na zpracování; nahrajte dokument ve formátu A4.")
    out = []
    for n in range(lo, hi + 1):
        page = doc[n - 1]
        view = render.png(page, render.VIEW_DPI)
        text, tsv = ocr.ocr_png(render.png(page, render.OCR_DPI))
        words = page_index.tess_words_text(tsv)
        # Ink no confident word explains (handwriting, signatures, stamps), on the 150 dpi image the word boxes
        # are scaled to; only the page image can show it, so it is found here and passed on to /v1/analyze.
        with Image.open(io.BytesIO(view)) as img:
            unreadable = redact.unreadable_regions(img, words)
        out.append({
            "n": n, "size": list(page_index.png_size_bytes(view[:24])),
            "png_b64": base64.b64encode(view).decode("ascii"),
            "words": words, "tess_text": text, "layer_text": layer.page_text(page), "unreadable": unreadable,
        })
    return {"pages": out}, len(out)


def _json(body: bytes) -> dict:
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "bad_json", "Tělo požadavku není platný JSON.") from None
    if not isinstance(data, dict) or not isinstance(data.get("pages"), list):
        raise ApiError(400, "bad_request", "Chybí seznam stran (pages).")
    return data


def analyze(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    out = []
    try:
        for p in data["pages"]:
            rec = page_index.tesseract_page(int(p["n"]), p.get("size") or [0, 0], p.get("tess_text") or "",
                                            p.get("words") or [], p.get("layer_text") or "")
            # A caller that did not send "unreadable" (an older Worker) did not look at the image: None, which
            # readability tells apart from "looked, found none".
            regions = _regions(p["unreadable"]) if "unreadable" in p else None
            page_index.mark_unreadable(rec, regions or [])
            rd = readability.assess(rec["n"], rec["words"], rec["text"], rec["verify"], rec["second_reading"],
                                    unreadable=regions, size=rec["size"])
            out.append({"n": rec["n"], "page": rec, "readability": rd})
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, words, tess_text, layer_text, size).") from None
    doc = readability.document([{"n": p["n"], **p["readability"]} for p in out])
    return {"pages": out, "document": doc}, len(out)


def _regions(value) -> list[dict]:
    """Unreadable regions as /v1/pages returns them, checked: a list of {"b": [4 numbers], "reason"}."""
    if not isinstance(value, list):
        raise ValueError("unreadable")
    out = []
    for r in value:
        b = r["b"]
        if r.get("reason") not in ("no_text", "low_conf") or not (
                isinstance(b, list) and len(b) == 4 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in b)):
            raise ValueError("unreadable")
        out.append({"b": b, "reason": r["reason"]})
    return out


def labs_(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    try:
        result = labs.parse(data["pages"], doc_id=(data.get("document") or {}).get("doc_id"))
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, text, layer_text, readability_level).") from None
    return result, len(data["pages"])


def _name_groups(value) -> dict[str, int]:
    """Folded name form -> its name part: a list of strings (one part each) or a list of lists (forms per part)."""
    out: dict[str, int] = {}
    for i, part in enumerate(value if isinstance(value, list) else []):
        for x in part if isinstance(part, list) else [part]:
            if isinstance(x, str) and len(x) > 1:
                out[redact.fold(x)] = i
    return out


def compare_(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    if len(data["pages"]) > MAX_BATCH:
        raise ApiError(400, "bad_request", f"Nejvýš {MAX_BATCH} stran.")
    out = []
    try:
        for p in data["pages"]:
            text = p["text"]
            if not isinstance(text, str):
                raise TypeError
            words = p.get("words") or []
            out.append({"n": int(p["n"]), "verify": page_index.disagreements(page_index.vision_tokens(text), words, text)})
    except (KeyError, TypeError, ValueError, AttributeError):
        # AttributeError: a word that is not an object ({t, c, b}).
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, text, words).") from None
    return {"pages": out}, len(out)


def redact_(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    ident = data.get("identity") or {}
    if not isinstance(ident, dict) or len(data["pages"]) > MAX_BATCH:
        raise ApiError(400, "bad_request", f"Očekávám identitu a nejvýš {MAX_BATCH} stran.")
    names, staff = _name_groups(ident.get("names")), _name_groups(ident.get("staff"))
    bn = ident.get("birth_number") if isinstance(ident.get("birth_number"), str) else None
    bd = ident.get("birth_date") if isinstance(ident.get("birth_date"), str) else None
    out = []
    try:
        for p in data["pages"]:
            words = p.get("words") or []
            img = Image.open(io.BytesIO(base64.b64decode(p["png_b64"], validate=True)))
            if img.width * img.height > MAX_PIXELS:
                raise ApiError(422, "page_too_large", "Obrázek strany je příliš velký.")
            img = img.convert("L")
            hits = redact.find(redact.lines_from_words(words), names, staff, bn, bd)
            if data.get("ink_marks"):
                hits += redact.ink_marks(img, words)
            png = io.BytesIO()
            redact.apply(img, hits).save(png, format="PNG", optimize=True)
            out.append({"n": int(p["n"]), "png_b64": base64.b64encode(png.getvalue()).decode("ascii"), "hits": hits})
    except ApiError:
        raise
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        # OSError is Pillow's error for a body that is not an image; its message is not passed on.
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, png_b64, words).") from None
    return {"pages": out}, len(out)


def convert_(body: bytes, _query) -> tuple[dict, int]:
    with WORK:  # Pillow and PyMuPDF work, one request at a time like the other PDF endpoints
        try:
            pdf, (w, h) = convert.image_to_pdf(body)
        except convert.TooLarge:
            raise ApiError(422, "image_too_large", "Fotografie má příliš mnoho pixelů.") from None
        except convert.NotImage:
            raise ApiError(422, "not_image", "Soubor není čitelná fotografie (JPEG nebo PNG).") from None
    return {"pdf_b64": base64.b64encode(pdf).decode("ascii"), "width": w, "height": h}, 1


def parts_(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    try:
        result = parts.split(data["pages"])
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, text).") from None
    return result, len(data["pages"])


def identity_(body: bytes, _query) -> tuple[dict, int]:
    data = _json(body)
    exp = data.get("expected")
    if (not isinstance(exp, dict) or len(data["pages"]) > MAX_PAGES
            or any(not (exp.get(k) is None or isinstance(exp.get(k), str)) for k in ("name", "birth_number", "birth_date"))):
        raise ApiError(400, "bad_request", f"Očekávám identitu pacienta (name, birth_number, birth_date) a nejvýš {MAX_PAGES} stran.")
    expected = {k: exp.get(k) for k in ("name", "birth_number", "birth_date")}
    try:
        for p in data["pages"]:
            if not isinstance(p.get("text", ""), str):
                raise TypeError("text")
        result = identity.check(data["pages"], expected)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        raise ApiError(400, "bad_request", "Strana nemá očekávaný tvar (n, text).") from None
    return result, len(data["pages"])


ROUTES = {("GET", "/healthz"): healthz, ("POST", "/v1/inspect"): inspect, ("POST", "/v1/pages"): pages,
          ("POST", "/v1/analyze"): analyze, ("POST", "/v1/labs"): labs_, ("POST", "/v1/redact"): redact_,
          ("POST", "/v1/compare"): compare_, ("POST", "/v1/convert"): convert_, ("POST", "/v1/parts"): parts_,
          ("POST", "/v1/identity"): identity_}


class Handler(BaseHTTPRequestHandler):
    server_version = "page_reader"
    sys_version = ""
    timeout = REQUEST_TIMEOUT

    def log_message(self, *args):  # the default logs the request line only; ours is in _handle
        pass

    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method: str) -> None:
        t0, url, status, count = time.monotonic(), urlparse(self.path), 500, 0
        try:
            route = ROUTES.get((method, url.path))
            if route is None:
                if any(p == url.path for _, p in ROUTES):
                    raise ApiError(405, "method_not_allowed", "Tato metoda zde není povolena.")
                raise ApiError(404, "not_found", "Neznámá adresa.")
            raw = self.headers.get("Content-Length") or "0"
            # A negative length would read until the client closes, past MAX_BODY.
            if not raw.isdigit():
                raise ApiError(400, "bad_request", "Chybí platná délka těla požadavku (Content-Length).")
            length = int(raw)
            if length > MAX_BODY:
                raise ApiError(413, "too_large", "Soubor je větší než 20 MB.")
            body = self.rfile.read(length) if length else b""
            payload, count = route(body, parse_qs(url.query))
            status = 200
            self._send(200, payload)
        except ApiError as e:
            status = e.status
            self._send(e.status, {"error": {"code": e.code, "message_cs": e.message_cs}})
        except Exception:
            # Log the exception type only: a traceback can carry fragments of the document.
            log.error("internal error %s on %s", sys.exc_info()[0].__name__, url.path)
            status = 500
            self._send(500, {"error": {"code": "internal", "message_cs": "Chyba zpracování dokumentu."}})
        finally:
            log.info("%s %s %d %.0fms pages=%d", method, url.path, status, (time.monotonic() - t0) * 1000, count)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def make_server(port: int = 8080, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8080
    make_server(port).serve_forever()


if __name__ == "__main__":
    main()
