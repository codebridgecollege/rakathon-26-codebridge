"""The PDF's own text layer, kept only as a second reading.

The layer is never the text of record and is never shown alone: FNO's text layers come from poor OCR or
broken font maps ("1112023" for 11/2023, "MO" for M0). It is still useful because it is independent of
Tesseract, so where both agree a token is confirmed (pagekit.page_index, mode tesseract_vs_layer).
"""

import fitz  # PyMuPDF


def page_text(page: fitz.Page) -> str:
    return page.get_text()


def has_text(page: fitz.Page) -> bool:
    return bool(page.get_text().strip())
