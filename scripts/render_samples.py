# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["pymupdf==1.24.10", "markdown==3.7"]
# ///
"""Render our own synthetic sample documents to one A4 PDF per patient.

Usage:
    uv run scripts/render_samples.py samples/S01_pacient [--pages data/derived/pages] [--upload DIR] [--out PDF]

Reads the Markdown documents in the sample folder in name order (one file
per clinical document; a line `<!-- page -->` starts a new printed page)
and writes:
- `<folder>/<folder name>.pdf` (or the `--out` path): all documents in
  one PDF, like FNO's `<n>_pacient.pdf` referrals, each document starting
  on a new page. S03 uses `--out` because its clean render is only the
  input of `scripts/degrade_scan.py`, which writes the scanned referral;
- `<pages>/<folder name>/p<n>.vision.md`: the Markdown of each printed
  page, which stands in for the vision model's transcription because we
  wrote the text ourselves;
- with `--upload DIR`, also `DIR/<md stem>.pdf`: one PDF per document, as
  a doctor would upload them one by one (pages numbered within the
  document).

Then run `scripts/ocr_pages.py` on the PDF (page images and Tesseract
boxes) and `scripts/build_page_index.py` (page index), as for FNO's data.

Every page carries a footer saying the document is synthetic, so a
rendered page can never pass for a real record.
"""

import os
import sys
from pathlib import Path

import fitz  # PyMuPDF
import markdown

# Liberation Sans (metrics of Arial, common in hospital printouts) covers Czech diacritics and µ; the PDF base
# fonts do not. SAMPLE_FONTS points elsewhere on a machine without the Debian font package.
FONTS = os.environ.get("SAMPLE_FONTS", "/usr/share/fonts/truetype/liberation")
FOOTER = "SYNTETICKÝ DOKUMENT - fiktivní pacient, vytvořeno týmem CodeBridge pro Rakathon 2026"
CSS = """
@font-face { font-family: doc; src: url(LiberationSans-Regular.ttf); }
@font-face { font-family: doc; src: url(LiberationSans-Bold.ttf); font-weight: bold; }
@font-face { font-family: doc; src: url(LiberationSans-Italic.ttf); font-style: italic; }
@font-face { font-family: doc; src: url(LiberationSans-BoldItalic.ttf); font-weight: bold; font-style: italic; }
* { font-family: doc; font-size: 10pt; line-height: 1.35; }
h1 { font-size: 14pt; margin: 6pt 0 8pt 0; }
p { margin: 0 0 6pt 0; }
ul { margin: 0 0 6pt 0; padding-left: 14pt; }
li { margin: 0 0 2pt 0; }
"""
A4 = fitz.paper_rect("a4")
BODY = fitz.Rect(56, 50, A4.width - 56, A4.height - 60)  # about 2 cm margins, room for the footer
PAGE_BREAK = "<!-- page -->"


def render_page(pdf: fitz.Document, md: str, foot: str, archive: fitz.Archive) -> bool:
    """Add one A4 page with the Markdown text and the synthetic footer; False if the text does not fit."""
    page = pdf.new_page(width=A4.width, height=A4.height)
    # nl2br keeps one lab value per printed line, as on a lab sheet, so a quote never spans two lines.
    html = markdown.markdown(md, extensions=["nl2br"])
    spare, scale = page.insert_htmlbox(BODY, html, css=CSS, archive=archive, scale_low=1)
    page.insert_htmlbox(fitz.Rect(56, A4.height - 45, A4.width - 56, A4.height - 25),
                        f"<p>{foot}</p>", css=CSS.replace("10pt", "7.5pt"), archive=archive)
    # scale_low=1 forbids shrinking; a negative spare height means the text did not fit the page.
    return spare >= 0


def option(args: list[str], name: str) -> str | None:
    return args[args.index(name) + 1] if name in args else None


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(option(args, "--pages") or "data/derived/pages")
    upload = option(args, "--upload")
    out_pdf = option(args, "--out")
    opts = ("--pages", "--upload", "--out")
    args = [a for i, a in enumerate(args) if a not in opts and (i == 0 or args[i - 1] not in opts)]
    if not args:
        sys.exit(__doc__)
    folder = Path(args[0])
    out_pages = pages_dir / folder.name
    out_pages.mkdir(parents=True, exist_ok=True)
    archive = fitz.Archive(FONTS)
    pdf = fitz.open()
    n = 0
    for src in sorted(folder.glob("*.md")):
        if src.name.upper() == "README.MD":
            continue
        chunks = [c.strip() for c in src.read_text().split(PAGE_BREAK)]
        for md in chunks:
            n += 1
            foot = f"{FOOTER} · strana {n}"
            if not render_page(pdf, md, foot, archive):
                sys.exit(f"{src.name}: page {n} overflows; add a {PAGE_BREAK} line")
            (out_pages / f"p{n}.vision.md").write_text(f"{md}\n\n{foot}\n")
            print(f"{src.name} -> page {n}")
        if upload:
            # The same pages again as a document of their own, numbered from 1 like a printout of one report.
            one = fitz.open()
            for k, md in enumerate(chunks, 1):
                render_page(one, md, f"{FOOTER} · strana {k}", archive)
            Path(upload).mkdir(parents=True, exist_ok=True)
            one.subset_fonts()
            one.save(Path(upload) / f"{src.stem}.pdf", garbage=3, deflate=True)
    target = Path(out_pdf) if out_pdf else folder / f"{folder.name}.pdf"
    pdf.subset_fonts()  # embed only the glyphs used; the full fonts make the PDF megabytes larger
    pdf.save(target, garbage=3, deflate=True)
    print(f"wrote {target} ({n} pages) and {n} vision files in {out_pages}")
    if upload:
        print(f"wrote one PDF per document in {upload}")


if __name__ == "__main__":
    main()
