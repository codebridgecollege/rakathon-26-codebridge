# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["pymupdf==1.24.10", "pillow==10.4.0", "numpy==2.1.1"]
# ///
"""Turn a clean rendered sample PDF into a poor scan, reproducibly (fixed seed).

Usage:
    uv run scripts/degrade_scan.py CLEAN_PDF --damage DAMAGE_JSON --out SCAN_PDF
        [--truth-pages DIR] [--seed 19] [--no-ocr-layer]

Why: the CLAUDE.md failure case "a poor scan whose misread characters change
a value or a negation" needs a sample whose misreads we know exactly. FNO's
referrals are scans with a poor OCR text layer, so the clean render of our
Markdown (scripts/render_samples.py) is not enough.

Each page is rendered at 300 dpi, then:
1. **Planted defects** from DAMAGE_JSON (one entry per defect): a toner
   dropout or a white-out over chosen characters, placed on the ink of
   those characters, so OCR reads a different character or loses a prefix.
   Each entry says which text it hits and why, so the ground truth is
   written down next to the defect (samples/S03_pacient/GROUND-TRUTH.md).
2. **Whole-page wear:** faded ink, a grey paper tone, blur, sensor noise,
   speckles, a slight skew, a 200 dpi scan resolution and strong JPEG
   compression. The amount is set per page in DAMAGE_JSON (`pages`).

Randomness comes from one NumPy generator seeded with --seed, so the same
inputs give the same images on any machine with the same Pillow and NumPy.

By default each page also gets an invisible OCR text layer, as scanner
software adds one: Tesseract in page-segmentation mode 3 reads the degraded
image (the page reader reads in mode 4, so the two readings are not one
reading twice). The layer depends on the local Tesseract version, so a
regenerated PDF may differ in its layer; the committed PDF is the reference.

With --truth-pages DIR, the `p<n>.vision.md` files that render_samples.py
wrote for the clean render are renamed to `p<n>.truth.md`: they are what the
page really says, not a reading of the scan, so they must not pass for the
vision model's transcription.

Tesseract runs locally; no page leaves the machine.
"""

import argparse
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageFilter

RENDER_DPI = 300  # the defects are placed at this resolution
SCAN_DPI = 200  # common office scanner setting; below 300 dpi Tesseract already loses accuracy
PAPER = 236  # grey paper tone of a recycled-paper printout
INK_THRESHOLD = 128  # a pixel darker than this is ink when the defect looks for the glyph's ink box

# Wear applied when DAMAGE_JSON does not set a page's own values.
DEFAULT_WEAR = {"fade": 0.75, "blur": 0.9, "noise": 16.0, "speckles": 900, "skew_deg": 0.6, "jpeg_quality": 30}


def char_boxes(page: fitz.Page, find: str, occurrence: int) -> list[fitz.Rect]:
    """The bounding boxes of each character of the occurrence-th match of `find` on the page, in points.

    Matched within one text line, so the defect lands on exactly the characters named, never on a
    neighbouring line that happens to contain the same text."""
    hits = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            chars = [c for span in line["spans"] for c in span["chars"]]
            text = "".join(c["c"] for c in chars)
            start = text.find(find)
            while start >= 0:
                hits.append([fitz.Rect(c["bbox"]) for c in chars[start:start + len(find)]])
                start = text.find(find, start + 1)
    if len(hits) <= occurrence:
        raise SystemExit(f"page {page.number + 1}: '{find}' occurrence {occurrence} not found ({len(hits)} hits)")
    return hits[occurrence]


def ink_box(img: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """The rectangle of ink inside a font box: font boxes include the ascender and descender space, so a
    "left half" or "flag" defect must be measured on the drawn glyph, not on its box."""
    x0, y0, x1, y1 = box
    ys, xs = np.nonzero(img[y0:y1, x0:x1] < INK_THRESHOLD)
    if len(xs) == 0:
        return box
    return x0 + int(xs.min()), y0 + int(ys.min()), x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1


def apply_defect(img: np.ndarray, page: fitz.Page, d: dict) -> None:
    """Paint one planted defect in paper colour over the chosen characters."""
    scale = RENDER_DPI / 72
    rects = char_boxes(page, d["find"], d.get("occurrence", 0))
    a, b = d["chars"]
    for r in rects[a:b]:
        box = (int(r.x0 * scale), int(r.y0 * scale), int(np.ceil(r.x1 * scale)), int(np.ceil(r.y1 * scale)))
        x0, y0, x1, y1 = ink_box(img, box)
        w, h = x1 - x0, y1 - y0
        mode = d["mode"]
        if mode == "erase":  # the whole glyph is gone (white-out, toner dropout)
            region = (x0 - 2, y0 - 2, x1 + 2, y1 + 2)
        elif mode == "left_half":  # an "8" without its left bowls reads as "3"
            region = (x0 - 2, y0 - 2, x0 + int(w * 0.5), y1 + 2)
        elif mode == "flag":  # a "1" without its flag reads as "l" or "|"
            region = (x0 - 2, y0 - 2, x0 + int(w * 0.62), y0 + int(h * 0.42))
        else:
            raise SystemExit(f"unknown defect mode {mode}")
        rx0, ry0, rx1, ry1 = region
        img[max(ry0, 0):ry1, max(rx0, 0):rx1] = 255


def wear(img: np.ndarray, rng: np.random.Generator, p: dict) -> Image.Image:
    """Whole-page scan wear; every random draw comes from rng, so the result is reproducible."""
    f = img.astype(np.float32)
    # Faded ink on grey paper: ink keeps `fade` of its darkness, white becomes the paper tone.
    f = PAPER - (255.0 - f) * p["fade"] * (PAPER / 255.0)
    im = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(p["blur"]))
    f = np.asarray(im).astype(np.float32) + rng.normal(0.0, p["noise"], size=f.shape)
    # Dark speckles of dust and toner, two to four pixels across.
    h, w = f.shape
    for _ in range(p["speckles"]):
        y, x, s = rng.integers(0, h - 4), rng.integers(0, w - 4), rng.integers(2, 5)
        f[y:y + s, x:x + s] = rng.uniform(40, 120)
    im = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
    im = im.rotate(p["skew_deg"], resample=Image.BICUBIC, expand=False, fillcolor=PAPER)
    return im.resize((round(w * SCAN_DPI / RENDER_DPI), round(h * SCAN_DPI / RENDER_DPI)), Image.LANCZOS)


def jpeg(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, dpi=(SCAN_DPI, SCAN_DPI), optimize=False, progressive=False)
    return buf.getvalue()


def ocr_layer_page(jpg: bytes, tmp: Path, n: int) -> fitz.Document:
    """A one-page PDF of the scan with Tesseract's invisible text layer (psm 3), as scanner software makes."""
    src = tmp / f"p{n}.jpg"
    src.write_bytes(jpg)
    subprocess.run(["tesseract", str(src), str(tmp / f"p{n}"), "-l", "ces", "--psm", "3", "pdf"],
                   check=True, capture_output=True, timeout=120)
    return fitz.open(tmp / f"p{n}.pdf")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clean_pdf")
    ap.add_argument("--damage", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--truth-pages")
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--no-ocr-layer", dest="ocr_layer", action="store_false")
    a = ap.parse_args()
    spec = json.loads(Path(a.damage).read_text())
    if a.ocr_layer and not shutil.which("tesseract"):
        raise SystemExit("tesseract not found; brew install tesseract tesseract-lang, or pass --no-ocr-layer")
    rng = np.random.default_rng(a.seed)
    clean = fitz.open(a.clean_pdf)
    out = fitz.open()
    with tempfile.TemporaryDirectory(prefix="degrade-") as tmp:
        for page in clean:
            n = page.number + 1
            pix = page.get_pixmap(dpi=RENDER_DPI, colorspace=fitz.csGRAY)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()
            for d in spec["defects"]:
                if d["page"] == n:
                    apply_defect(img, page, d)
            p = {**DEFAULT_WEAR, **spec.get("pages", {}).get(str(n), {})}
            jpg = jpeg(wear(img, rng, p), p["jpeg_quality"])
            if a.ocr_layer:
                out.insert_pdf(ocr_layer_page(jpg, Path(tmp), n))
            else:
                pg = out.new_page(width=page.rect.width, height=page.rect.height)
                pg.insert_image(pg.rect, stream=jpg)
            print(f"page {n}: {sum(d['page'] == n for d in spec['defects'])} defects, wear {p}")
    out.save(a.out, garbage=3, deflate=True)
    print(f"wrote {a.out} ({len(out)} pages)")
    if a.truth_pages:
        for v in sorted(Path(a.truth_pages).glob("p*.vision.md")):
            v.rename(v.with_name(v.name.replace(".vision.md", ".truth.md")))
        print(f"renamed the clean render's page texts in {a.truth_pages} to p<n>.truth.md")


if __name__ == "__main__":
    main()
