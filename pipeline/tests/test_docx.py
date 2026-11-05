"""A Word document into a plain PDF of its text: Czech letters kept, tables as lines, tracked deletions left out,
no metadata carried, and files that are not Word documents refused."""

import io
import os
import sys
import zipfile

import fitz
import pytest

from conftest import REPO
from page_reader import docx_pdf

sys.path.insert(0, str(REPO / "pipeline/container"))
import server  # noqa: E402

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
SECRET = "codebridge-author-marker-5512"


@pytest.fixture(autouse=True)
def font(monkeypatch):
    # The container installs DejaVu Sans; a developer machine may have another font with Czech letters.
    for f in (docx_pdf.FONT_FILE, "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f):
            monkeypatch.setattr(docx_pdf, "FONT_FILE", f)
            return
    pytest.skip("no font with Czech letters on this machine")


def word(body: str, extra: dict[str, str] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("docProps/core.xml", f"<cp>{SECRET}</cp>")
        z.writestr("word/document.xml", f'<w:document {NS}><w:body>{body}</w:body></w:document>')
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return buf.getvalue()


P = lambda t: f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>"  # noqa: E731
BODY = (
    P("Propouštěcí zpráva: pacient s plicním karcinomem, FEV1 52 % normy.")
    + "<w:p><w:r><w:t>Bez</w:t></w:r><w:del><w:r><w:delText>SMAZANÝ</w:delText></w:r></w:del><w:r><w:tab/><w:t>metastáz.</w:t></w:r></w:p>"
    + "<w:tbl><w:tr><w:tc>" + P("DLCO") + "</w:tc><w:tc>" + P("48 %") + "</w:tc></w:tr></w:tbl>"
)


def text_of(pdf: bytes) -> str:
    # Some fonts (Arial) write their space as a no-break space; DejaVu, the container's font, does not.
    return "".join(p.get_text() for p in fitz.open(stream=pdf, filetype="pdf")).replace("\xa0", " ")


def test_czech_text_paragraphs_and_table_rows_are_read():
    assert docx_pdf.is_docx(word(BODY))
    txt = text_of(docx_pdf.docx_to_pdf(word(BODY)))
    assert "Propouštěcí zpráva" in txt and "plicním karcinomem" in txt and "52 %" in txt
    assert "DLCO | 48 %" in txt
    assert "metastáz" in txt and "SMAZANÝ" not in txt


def test_no_metadata_reaches_the_pdf():
    pdf = docx_pdf.docx_to_pdf(word(BODY))
    assert SECRET.encode() not in pdf


def test_long_text_goes_on_more_pages():
    pdf = docx_pdf.docx_to_pdf(word(P("slovo " * 3000)))
    assert fitz.open(stream=pdf, filetype="pdf").page_count > 1


def test_refuses_what_is_not_readable():
    for bad in (b"not a zip", word(""), word(BODY.replace("<w:p>", "<w:p", 1)), word(BODY, {"x": "y"})[:50]):
        with pytest.raises(docx_pdf.NotDocument):
            docx_pdf.docx_to_pdf(bad)
    assert not docx_pdf.is_docx(b"PK\x03\x04junk")
    # An entity declaration is how an XML bomb is written.
    bomb = f'<!DOCTYPE d [<!ENTITY a "aaaa">]><w:document {NS}><w:body>{P("&a;")}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", bomb)
    with pytest.raises(docx_pdf.NotDocument):
        docx_pdf.docx_to_pdf(buf.getvalue())


def test_content_controls_nested_tables_and_long_words():
    sdt = "<w:sdt><w:sdtContent>" + P("Obsah kontroly") + "</w:sdtContent></w:sdt>"
    nested = "<w:tbl><w:tr><w:tc>" + P("vnější") + "<w:tbl><w:tr><w:tc>" + P("vnitřní") + "</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>"
    txt = text_of(docx_pdf.docx_to_pdf(word(sdt + nested + P("x" * 400))))
    assert "Obsah kontroly" in txt and txt.count("vnitřní") == 1 and "vnější" in txt
    assert txt.replace("\n", "").count("x") == 400, "a long word is broken, not clipped"


def test_utf16_xml_is_refused():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-16"?><w:document {NS}><w:body>{P("a")}</w:body></w:document>'.encode("utf-16"))
    with pytest.raises(docx_pdf.NotDocument):
        docx_pdf.docx_to_pdf(buf.getvalue())


def test_over_the_page_limit_is_too_large(monkeypatch):
    monkeypatch.setattr(docx_pdf, "MAX_PAGES", 1)
    with pytest.raises(docx_pdf.TooLarge):
        docx_pdf.docx_to_pdf(word(P("slovo " * 3000)))


def test_the_convert_route_reads_a_word_file_and_still_refuses_junk():
    out, _ = server.convert_(word(BODY), {})
    import base64
    assert "FEV1 52 %" in text_of(base64.b64decode(out["pdf_b64"]))
    with pytest.raises(server.ApiError) as e:
        server.convert_(b"PK\x03\x04junk", {})
    assert e.value.code == "not_document"
