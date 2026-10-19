"""Tesseract OCR of a rendered page: plain text for reading, TSV for confidences and boxes.

Needs the Tesseract binary with the Czech model (`brew install tesseract tesseract-lang`, or the
tesseract-ocr-ces package in the container). Tesseract runs locally, so no page leaves the machine.
"""

import hashlib
import re
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

LANG = "ces"
OCR_TIMEOUT = 120  # seconds per Tesseract run; a dense 300 dpi page takes a few seconds on half a vCPU
# Mode 4 reads a single column of variable-size text, which suits the label-then-text layout of the
# reports better than the default mode 3.
PSM = "4"


def ocr_file(png: Path, stem: Path) -> None:
    """Run Tesseract twice, writing <stem>.txt and <stem>.tsv next to each other."""
    for fmt in ([], ["tsv"]):
        subprocess.run(["tesseract", str(png), str(stem), "-l", LANG, "--psm", PSM, *fmt],
                       check=True, capture_output=True, timeout=OCR_TIMEOUT)


def ocr_png(png_bytes: bytes) -> tuple[str, str]:
    """Tesseract's plain text and TSV for one PNG; the temporary files are removed whatever happens."""
    with tempfile.TemporaryDirectory(prefix="page_reader-") as tmp:
        src = Path(tmp) / "page.png"
        src.write_bytes(png_bytes)
        stem = Path(tmp) / "page"
        ocr_file(src, stem)
        return stem.with_suffix(".txt").read_text(), stem.with_suffix(".tsv").read_text()


@lru_cache(maxsize=1)
def versions() -> dict:
    """The Tesseract version and a hash of the Czech model, so a stored run says which OCR produced it."""
    try:
        ver = subprocess.run(["tesseract", "--version"], capture_output=True, text=True, check=True)
        first = (ver.stdout or ver.stderr).splitlines()[0].strip()
        langs = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return {"tesseract": None, "ces_model": None}
    # The first line names the tessdata folder: List of available languages in "/usr/share/.../tessdata/" (3):
    m = re.search(r'"([^"]+)"', langs.stdout)
    model = Path(m.group(1)) / f"{LANG}.traineddata" if m else None
    if model and model.exists():
        ces = "sha256:" + hashlib.sha256(model.read_bytes()).hexdigest()[:16]
    else:
        ces = LANG in langs.stdout.split()
    return {"tesseract": first, "ces_model": ces}
