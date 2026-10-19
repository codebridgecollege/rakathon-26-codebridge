"""The real 6b-1 path on the S02 upload PDFs: render, local Tesseract, text layer, analyze, labs."""

from conftest import REPO, compare_with_mock, mock_labs, needs_tesseract
from page_reader import labs, layer, ocr, page_index as pi, readability as rd, render

UPLOADS = {  # upload file -> page of that sheet in the combined S02 PDF (the fixture's source page)
    "04-laborator-2026-03-10.pdf": 5, "05-laborator-2026-06-02.pdf": 6,
    "06-laborator-2026-09-15.pdf": 7, "07-laborator-2026-10-06.pdf": 8,
}


def process(pdf_bytes: bytes, doc_id: str) -> list[dict]:
    """What the Workflow does through /v1/pages and /v1/analyze, as the labs input."""
    doc = render.open_pdf(pdf_bytes)
    out = []
    for n, page in enumerate(doc, 1):
        text, tsv = ocr.ocr_png(render.png(page, render.OCR_DPI))
        words = pi.tess_words_text(tsv)
        rec = pi.tesseract_page(n, [0, 0], text, words, layer.page_text(page))
        level = rd.assess(n, words, text, rec["verify"], rec["second_reading"])["level"]
        out.append({"n": n, "text": text, "layer_text": layer.page_text(page), "words": words,
                    "readability_level": level, "doc_id": doc_id})
    return out


@needs_tesseract
def test_s02_uploads_through_ocr():
    pages = []
    for name in UPLOADS:
        pages += process((REPO / "samples/S02_pacient/upload" / name).read_bytes(), name)
    assert all(p["readability_level"] in ("good", "fair") for p in pages)
    result = labs.parse(pages)
    counts = compare_with_mock(result, mock_labs("S02_pacient"), page_of=lambda s: UPLOADS[s["doc_id"]])
    print("labs S02 uploads via OCR", counts)
    assert counts["documented"] > 0
    assert [d["date"] for d in result["draws"]] == ["2026-03-10", "2026-06-02", "2026-09-15", "2026-10-06"]
