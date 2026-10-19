"""Page tools for the offline extraction harness (api/scripts/extract-eval.ts), the same code the container runs.

    uv run python harness_tools.py readability <pages dir>
        {"<n>": {"level": "good"|"fair"|"poor"|"empty", "disagreements": int, "layer_chars": int}, ...}
        as /v1/analyze judges the stored Tesseract output; disagreements between Tesseract and the text layer
    uv run python harness_tools.py redact <pages dir> <n>   (identity JSON on stdin)
        {"png_b64": str, "reasons": [str]}  the page image with direct identifiers blacked out, as /v1/redact
    uv run python harness_tools.py compare <pages dir> <n>  (reading text on stdin)
        {"verify": [[start, end], ...]}  where a vision reading disagrees with Tesseract's words, as the page index

Synthetic data only (samples/, data/derived). Nothing is logged; the output goes to stdout for the harness.
"""

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

from page_reader import page_index, readability as rd, redact, render

REPO = Path(__file__).resolve().parents[1]


def _page_png(pages_dir: Path, n: int) -> Path:
    """The page image; for the evaluation samples (samples/derived/pages, images not committed) rendered from the
    sample's PDF, the same way scripts/ocr_pages.py renders it."""
    png = pages_dir / f"p{n}.png"
    if not png.exists():
        import fitz  # PyMuPDF, only needed when an image is missing

        pdf = REPO / "samples" / pages_dir.name / f"{pages_dir.name}.pdf"
        render.save_png(fitz.open(pdf)[n - 1], render.VIEW_DPI, png)
    return png


def readability(pages_dir: Path) -> dict:
    out = {}
    for tsv in sorted(pages_dir.glob("p*.tess.tsv")):
        n = int(tsv.name[1:].split(".")[0])
        text = (pages_dir / f"p{n}.tess.txt").read_text()
        layer = (pages_dir / f"p{n}.layer.txt").read_text() if (pages_dir / f"p{n}.layer.txt").exists() else ""
        rec = page_index.tesseract_page(n, [0, 0], text, page_index.tess_words(tsv), layer)
        r = rd.assess(n, rec["words"], rec["text"], rec["verify"], rec["second_reading"])
        out[str(n)] = {"level": r["level"], "disagreements": len(rec["verify"]), "layer_chars": len(layer.strip())}
    return out


def _groups(value) -> dict:
    out = {}
    for i, part in enumerate(value or []):
        for x in part if isinstance(part, list) else [part]:
            out[redact.fold(x)] = i
    return out


def redact_page(pages_dir: Path, n: int, identity: dict) -> dict:
    words = page_index.tess_words(pages_dir / f"p{n}.tess.tsv")
    img = Image.open(_page_png(pages_dir, n)).convert("L")
    hits = redact.find(redact.lines_from_words(words), _groups(identity.get("names")), _groups(identity.get("staff")),
                       identity.get("birth_number"), identity.get("birth_date"))
    hits += redact.ink_marks(img, words)
    buf = io.BytesIO()
    redact.apply(img, hits).save(buf, format="PNG", optimize=True)
    return {"png_b64": base64.b64encode(buf.getvalue()).decode("ascii"), "reasons": sorted({h["reason"] for h in hits})}


def compare(pages_dir: Path, n: int, text: str) -> dict:
    words = page_index.tess_words(pages_dir / f"p{n}.tess.tsv")
    items = page_index.disagreements(page_index.vision_tokens(text), words, text)
    return {"verify": [[i["start"], i["end"]] for i in items]}


def main(argv: list[str]) -> None:
    cmd, pages_dir = argv[0], Path(argv[1])
    if cmd == "readability":
        out = readability(pages_dir)
    elif cmd == "redact":
        out = redact_page(pages_dir, int(argv[2]), json.load(sys.stdin))
    elif cmd == "compare":
        out = compare(pages_dir, int(argv[2]), sys.stdin.read())
    else:
        raise SystemExit(f"unknown command {cmd}")
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1:])
