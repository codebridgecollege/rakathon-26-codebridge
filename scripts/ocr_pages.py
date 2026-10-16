# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["pymupdf==1.24.10"]
# ///
"""Render PDF pages to images and read them with Tesseract.

Usage:
    uv run scripts/ocr_pages.py PDF [PDF ...] [--out data/derived/pages]

For each page of each PDF this writes, under OUT/<pdf stem>/:
- `p<n>.png`: the page rendered as a viewer shows it (150 dpi, grayscale),
  for the source view in the app.
- `p<n>.tess.tsv`: Tesseract's words with confidence and position, read
  from a 300 dpi render.
- `p<n>.tess.txt`: Tesseract's plain text.
- `p<n>.layer.txt`: the PDF's own text layer, kept only for comparison.

Why the rendered page: FNO's PDFs hold a faded background image with the
readable text drawn on top in fonts, and some fonts map glyphs to the
wrong characters, so neither the embedded image nor the text layer is
reliable (docs/research/2026-10-16-ocr-evaluation.md).

Needs the Tesseract binary with the Czech model: `brew install tesseract
tesseract-lang`. Tesseract runs locally, so no page leaves the machine.
"""

import shutil
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF

VIEW_DPI = 150  # enough to read on screen, small enough to ship in a static page
OCR_DPI = 300  # Tesseract's accuracy drops noticeably below 300 dpi
LANG = "ces"
# Mode 4 reads a single column of variable-size text, which suits the
# label-then-text layout of the reports better than the default mode 3.
PSM = "4"


def ocr_page(png: Path, stem: Path) -> None:
    """Run Tesseract twice: plain text for reading, TSV for confidences and boxes."""
    for fmt in ([], ["tsv"]):
        subprocess.run(["tesseract", str(png), str(stem), "-l", LANG, "--psm", PSM, *fmt],
                       check=True, capture_output=True)


def process(pdf: Path, out: Path) -> None:
    doc = fitz.open(pdf)
    target = out / pdf.stem
    target.mkdir(parents=True, exist_ok=True)
    for i, page in enumerate(doc, 1):
        base = target / f"p{i}"
        page.get_pixmap(dpi=VIEW_DPI, colorspace=fitz.csGRAY).save(f"{base}.png")
        (target / f"p{i}.layer.txt").write_text(page.get_text())
        hi = target / f"p{i}.ocr300.png"
        page.get_pixmap(dpi=OCR_DPI, colorspace=fitz.csGRAY).save(hi)
        ocr_page(hi, Path(f"{base}.tess"))
        hi.unlink()  # the 300 dpi render is only an OCR input; the 150 dpi one is kept
        print(f"{pdf.name} p{i}: done")


def main() -> None:
    args = sys.argv[1:]
    out = Path("data/derived/pages")
    if "--out" in args:
        k = args.index("--out")
        out = Path(args[k + 1])
        args = args[:k] + args[k + 2:]
    if not args:
        sys.exit(__doc__)
    if not shutil.which("tesseract"):
        sys.exit("tesseract not found; brew install tesseract tesseract-lang")
    for a in args:
        process(Path(a), out)


if __name__ == "__main__":
    main()
