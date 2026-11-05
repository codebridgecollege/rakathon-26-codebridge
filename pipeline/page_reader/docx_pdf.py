"""A Word document (.docx) into a plain PDF of its text, so the rest of the pipeline reads it like any scanned PDF:
render, Tesseract, readability. LibreOffice would do this with the layout intact but adds several hundred MB to the
container image; the pipeline needs the words, not the layout.

- Paragraphs and table rows in document order. A table row becomes one line, its cells separated by " | ".
- Tracked deletions are not text of the document (Word keeps them in w:delText, which is not read).
- Headers, footers, images and comments are not read; content controls (w:sdt) and nested tables are.
- The PDF is built from the text alone, so the document's metadata (author, company, revision history) does not reach it.
  The uploaded original is kept unchanged by the Worker; only this derived PDF is read.
- The XML comes from an untrusted file: a DOCTYPE or entity declaration (the way to write an entity bomb) is refused,
  and so is a document that unpacks to more than MAX_XML bytes.
"""

import io
import os
import zipfile
import xml.etree.ElementTree as ET

import fitz  # PyMuPDF

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A4 = (595.28, 841.89)  # points
MARGIN = 56.0
FONT_SIZE = 10.5
LEADING = FONT_SIZE * 1.4
GAP = FONT_SIZE * 0.5  # between paragraphs
MAX_XML = 8_000_000  # an ElementTree of this much XML is already hundreds of MB of memory
MAX_PAGES = 60  # the same limit as a PDF the page reader takes
# The font is a file because PyMuPDF's built-in fonts cannot draw Czech letters; the container installs DejaVu Sans.
FONT_FILE = os.environ.get("PAGE_READER_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


class NotDocument(ValueError):
    pass


class TooLarge(ValueError):
    pass


def is_docx(data: bytes) -> bool:
    """A zip holding word/document.xml, judged by its entry names."""
    if data[:4] != b"PK\x03\x04":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return "word/document.xml" in z.namelist()
    except zipfile.BadZipFile:
        return False


def _runs_text(p: ET.Element) -> str:
    out: list[str] = []
    for e in p.iter():
        if e.tag == W + "t" and e.text:
            out.append(e.text)
        elif e.tag == W + "tab":
            out.append("    ")
        elif e.tag in (W + "br", W + "cr"):
            out.append("\n")
        elif e.tag == W + "noBreakHyphen":
            out.append("-")
    return "".join(out)


def lines_of(data: bytes) -> list[str]:
    """The document's text, one entry per paragraph or table row; empty entries are blank lines between paragraphs."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_XML:
                raise TooLarge()
            xml = z.read(info)
    except (zipfile.BadZipFile, KeyError):
        raise NotDocument() from None
    # Only UTF-8 is read: the byte checks below cannot see a DOCTYPE written in UTF-16.
    if xml[:2] in (b"\xff\xfe", b"\xfe\xff") or b"\x00" in xml[:200] or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise NotDocument()
    try:
        body = ET.fromstring(xml).find(W + "body")
    except ET.ParseError:
        raise NotDocument() from None
    if body is None:
        raise NotDocument()
    out: list[str] = []
    _walk(body, out)
    return out


def _cell_text(tc: ET.Element) -> str:
    parts: list[str] = []
    for e in tc:
        if e.tag == W + "p":
            parts.append(_runs_text(e))
        elif e.tag == W + "tbl":
            parts.extend(_table_rows(e))
        elif e.tag == W + "sdt":
            sc = e.find(W + "sdtContent")
            if sc is not None:
                parts.append(_cell_text(sc))
    return " ".join(x for x in parts if x).strip()


def _table_rows(tbl: ET.Element) -> list[str]:
    return [" | ".join(_cell_text(tc) for tc in tr if tc.tag == W + "tc") for tr in tbl if tr.tag == W + "tr"]


def _walk(parent: ET.Element, out: list[str]) -> None:
    """Paragraphs and table rows in order, through content controls (w:sdt); a nested table's rows follow their own cell."""
    for child in parent:
        if child.tag == W + "p":
            out.append(_runs_text(child))
        elif child.tag == W + "tbl":
            out.extend(_table_rows(child))
        elif child.tag == W + "sdt":
            sc = child.find(W + "sdtContent")
            if sc is not None:
                _walk(sc, out)


def _wrap(text: str, font: fitz.Font, width: float) -> list[str]:
    lines: list[str] = []
    for hard in text.split("\n"):
        cur = ""
        for word in hard.split(" "):
            # A word wider than the line (a long URL) is cut by character, so it is not clipped at the page edge.
            while font.text_length(word, FONT_SIZE) > width:
                n = len(word)
                while n > 1 and font.text_length(word[:n], FONT_SIZE) > width:
                    n -= 1
                if cur:
                    lines.append(cur)
                    cur = ""
                lines.append(word[:n])
                word = word[n:]
            trial = f"{cur} {word}" if cur else word
            if cur and font.text_length(trial, FONT_SIZE) > width:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        lines.append(cur)
    return lines


def docx_to_pdf(data: bytes) -> bytes:
    """The PDF bytes. NotDocument for a file that is not a readable Word document, TooLarge for one over MAX_PAGES pages."""
    paragraphs = lines_of(data)
    if not any(p.strip() for p in paragraphs):
        raise NotDocument()
    font = fitz.Font(fontfile=FONT_FILE)
    width = A4[0] - 2 * MARGIN
    doc = fitz.open()
    page = None
    y = 0.0

    def new_page():
        nonlocal page, y
        if len(doc) >= MAX_PAGES:
            raise TooLarge()
        page = doc.new_page(width=A4[0], height=A4[1])
        y = MARGIN + FONT_SIZE

    new_page()
    try:
        for para in paragraphs:
            for line in _wrap(para, font, width):
                if y > A4[1] - MARGIN:
                    new_page()
                if line:
                    tw = fitz.TextWriter(page.rect)
                    tw.append((MARGIN, y), line, font=font, fontsize=FONT_SIZE)
                    tw.write_text(page)
                y += LEADING
            y += GAP
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
