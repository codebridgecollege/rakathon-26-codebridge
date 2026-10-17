"""Render PDF pages to grayscale PNGs with PyMuPDF.

Why the rendered page and not the PDF's own image or text: FNO's PDFs hold a faded background image with
the readable text drawn on top in fonts, and some fonts map glyphs to the wrong characters, so neither the
embedded image nor the text layer is reliable (docs/research/2026-10-16-ocr-evaluation.md).
"""

import fitz  # PyMuPDF

VIEW_DPI = 150  # enough to read on screen, small enough to ship in a static page
OCR_DPI = 300  # Tesseract's accuracy drops noticeably below 300 dpi

PDF_MAGIC = b"%PDF-"


def is_pdf(data: bytes) -> bool:
    """Judge by the magic bytes, never by a file name; the PDF spec allows junk before the header in the first 1 KiB."""
    return PDF_MAGIC in data[:1024]


def open_pdf(data: bytes) -> fitz.Document:
    return fitz.open(stream=data, filetype="pdf")


def is_encrypted(doc: fitz.Document) -> bool:
    """Encrypted also when PyMuPDF opened it with the empty password: such a file carries restrictions we do not bypass."""
    return bool(doc.needs_pass or doc.is_encrypted or (doc.metadata or {}).get("encryption"))


def png(page: fitz.Page, dpi: int) -> bytes:
    return page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY).tobytes("png")


def save_png(page: fitz.Page, dpi: int, path) -> None:
    page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY).save(str(path))


def pixels(page: fitz.Page, dpi: int) -> float:
    """Pixel count of a render at dpi, from the page size alone, so the size is known before rendering."""
    r = page.rect
    return (r.width * dpi / 72) * (r.height * dpi / 72)
