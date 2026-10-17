# /// script
# requires-python = ">=3.11"
# ///
"""Merge the per-page OCR outputs into one index the app can load.

Usage:
    uv run scripts/build_page_index.py [--pages data/derived/pages] [--out data/derived/page-index.json]

Reads, for every `<pdf stem>/p<n>` in the pages folder:
- `p<n>.vision.md`: the vision model's transcription (primary text),
- `p<n>.tess.tsv`: Tesseract's words with confidence and position,
- `p<n>.png`: the page image shown in the source view (150 dpi).

Writes one JSON with, per page: the image path, the vision text,
Tesseract's words with boxes scaled to the 150 dpi image, and the spans to
verify. A span is marked "ověřit" (verify) when it carries a digit or a
stage and the engines read it differently ("disagree"), only the vision
model read it ("only_vision"), or Tesseract read it with low confidence
("low_conf"). Each item carries its character offsets (start, end) in the
vision text, so the app marks exactly that place; see
docs/research/2026-10-16-ocr-evaluation.md.
"""

import json
import sys
from pathlib import Path

# The logic lives in pipeline/pagekit, shared with the container and the tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from pagekit.page_index import build_index  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(args[args.index("--pages") + 1]) if "--pages" in args else Path("data/derived/pages")
    out = Path(args[args.index("--out") + 1]) if "--out" in args else Path("data/derived/page-index.json")
    out.write_text(json.dumps(build_index(pages_dir), ensure_ascii=False))


if __name__ == "__main__":
    main()
