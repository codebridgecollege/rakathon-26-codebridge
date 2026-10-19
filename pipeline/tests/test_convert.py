"""A phone photo of a page into a PDF the pipeline reads: upright by EXIF, without metadata, refused when not an image."""

import io
import json
import sys
import threading
import urllib.error
import urllib.request

import pytest
from PIL import Image

from conftest import REPO, needs_tesseract
from page_reader import convert, labs, layer, ocr, page_index as pi, readability as rd, render

sys.path.insert(0, str(REPO / "pipeline/container"))
import server  # noqa: E402

SHEET = REPO / "samples/S02_pacient/upload/04-laborator-2026-03-10.pdf"
MARKER = "codebridge-exif-marker-7731"


def photo(fmt: str = "JPEG") -> bytes:
    """S02's first lab sheet as a phone would store it: pixels turned sideways, an EXIF tag saying how to turn them
    back (orientation 6: rotate 90 degrees clockwise to view), and a description standing in for location data."""
    page = render.open_pdf(SHEET.read_bytes())[0]
    im = Image.open(io.BytesIO(render.png(page, 200))).rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x010E] = MARKER
    buf = io.BytesIO()
    im.save(buf, fmt, exif=exif.tobytes()) if fmt == "JPEG" else im.save(buf, fmt)
    return buf.getvalue()


def test_photo_becomes_an_upright_one_page_pdf_without_metadata():
    data = photo()
    assert MARKER.encode() in data
    pdf, (w, h) = convert.image_to_pdf(data)
    assert h > w, "the EXIF orientation was applied"
    assert MARKER.encode() not in pdf
    doc = render.open_pdf(pdf)
    assert doc.page_count == 1 and doc[0].rect.height > doc[0].rect.width
    assert render.pixels(doc[0], render.OCR_DPI) < 40_000_000


def test_no_metadata_of_any_kind_reaches_the_pdf():
    """EXIF, XMP (an APP1 segment written by hand: Pillow 10.4 cannot write one), an ICC profile and a JPEG comment,
    each with its own marker."""
    im = Image.new("RGB", (400, 600), "white")
    exif = Image.Exif()
    exif[0x0112] = 1
    exif[0x010E] = "exif-marker-5521"
    marks = {"comment": b"com-marker-8812", "xmp": b"xmp-marker-4410", "icc": b"icc-marker-9930", "exif": b"exif-marker-5521"}
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=exif.tobytes(), comment=marks["comment"], icc_profile=b"\x00" * 128 + marks["icc"])
    body = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>" + marks["xmp"] + b"</x:xmpmeta>"
    data = buf.getvalue()
    data = data[:2] + b"\xff\xe1" + (len(body) + 2).to_bytes(2, "big") + body + data[2:]
    assert all(m in data for m in marks.values()), [k for k, m in marks.items() if m not in data]
    pdf, _ = convert.image_to_pdf(data)
    page = render.open_pdf(pdf)[0]
    embedded = b"".join(page.parent.extract_image(x[0])["image"] for x in page.get_images())
    for name, m in marks.items():
        assert m not in pdf and m not in embedded, name


def test_transparent_png_is_white_paper_and_a_big_photo_is_reduced():
    clear = Image.new("RGBA", (300, 400), (0, 0, 0, 0))
    buf = io.BytesIO()
    clear.save(buf, "PNG")
    pdf, _ = convert.image_to_pdf(buf.getvalue())
    pix = render.open_pdf(pdf)[0].get_pixmap(dpi=36, colorspace="gray")
    assert min(pix.samples) > 200, "transparent became white, not black"
    big = io.BytesIO()
    Image.new("L", (6000, 8000), 255).save(big, "JPEG")
    _, (w, h) = convert.image_to_pdf(big.getvalue())
    assert max(w, h) == convert.MAX_SIDE


def test_pillow_bomb_limit_reads_as_too_large(monkeypatch):
    data = photo()
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # Pillow raises DecompressionBombError above twice this
    with pytest.raises(convert.TooLarge):
        convert.image_to_pdf(data)


def test_png_is_converted_and_other_bytes_are_refused():
    pdf, _ = convert.image_to_pdf(photo("PNG"))
    assert render.is_pdf(pdf)
    with pytest.raises(convert.NotImage):
        convert.image_to_pdf(b"%PDF-1.7 not an image")
    with pytest.raises(convert.NotImage):
        convert.image_to_pdf(b"\xff\xd8\xff" + b"\x00" * 100)  # a JPEG header with nothing behind it


def test_huge_image_is_refused_before_decoding(monkeypatch):
    monkeypatch.setattr(convert, "MAX_PIXELS", 1000)
    with pytest.raises(convert.TooLarge):
        convert.image_to_pdf(photo())


@needs_tesseract
def test_photo_of_a_lab_sheet_reads_its_values():
    """Through the same path as an uploaded PDF: the converted photo still yields the sheet's lab values, each either
    as printed or marked for checking, and its draw date."""
    pdf, _ = convert.image_to_pdf(photo())
    page = render.open_pdf(pdf)[0]
    text, tsv = ocr.ocr_png(render.png(page, render.OCR_DPI))
    words = pi.tess_words_text(tsv)
    rec = pi.tesseract_page(1, [0, 0], text, words, layer.page_text(page))
    level = rd.assess(1, words, text, rec["verify"], rec["second_reading"])["level"]
    assert level in ("good", "fair")
    result = labs.parse([{"n": 1, "text": text, "layer_text": layer.page_text(page), "words": words,
                          "readability_level": level, "doc_id": "photo"}])
    assert [d["date"] for d in result["draws"]] == ["2026-03-10"]
    assert result["counts"]["points"] >= 15


def test_server_convert_endpoint():
    srv = server.make_server(0, "127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        req = urllib.request.Request(base + "/v1/convert", data=photo(), method="POST", headers={"content-type": "image/jpeg"})
        body = json.loads(urllib.request.urlopen(req).read())
        assert body["height"] > body["width"] and body["pdf_b64"]
        bad = urllib.request.Request(base + "/v1/convert", data=b"hello", method="POST")
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(bad)
        assert e.value.code == 422 and json.loads(e.value.read())["error"]["code"] == "not_image"
    finally:
        srv.shutdown()
