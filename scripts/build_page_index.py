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
Tesseract's words with boxes scaled to the 150 dpi image, and the tokens
where the two engines disagree. A disagreement on a token with a digit,
or a Tesseract word under the confidence threshold, is what the app marks
"ověřit" (verify); see docs/research/2026-10-16-ocr-evaluation.md.
"""

import csv
import difflib
import json
import re
import struct
import sys
import unicodedata
from pathlib import Path

LOW_CONF = 60  # every Tesseract error in the evaluation scored below this
SCALE = 150 / 300  # Tesseract read 300 dpi renders; the shown image is 150 dpi


def png_size(path: Path) -> tuple[int, int]:
    """Read width and height from the PNG header, so no imaging library is needed."""
    with path.open("rb") as fh:
        head = fh.read(24)
    return struct.unpack(">II", head[16:24])


def norm(tok: str) -> str:
    """Compare tokens without case, punctuation at the edges, or Markdown markup."""
    tok = tok.strip("*#|_`[](){}.,;:!?\"'„“").lower()
    return unicodedata.normalize("NFC", tok)


def tess_words(tsv: Path) -> list[dict]:
    words = []
    with tsv.open(newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            if not text:
                continue
            box = [round(int(row[k]) * SCALE) for k in ("left", "top", "width", "height")]
            words.append({"t": text, "c": round(float(row["conf"])), "b": box})
    return words


def vision_tokens(md: str) -> list[str]:
    # Markers such as [razítko] or [?] are not printed text, so they are left out of the comparison.
    plain = re.sub(r"\[[^\]]*\]", " ", md)
    plain = re.sub(r"[|*#>`_-]{2,}", " ", plain)
    return [t for t in plain.split() if norm(t)]


def disagreements(vtoks: list[str], words: list[dict]) -> list[dict]:
    """Align the two readings and keep the replaced spans that matter clinically."""
    a = [norm(t) for t in vtoks]
    b = [norm(w["t"]) for w in words]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            # Agreement does not clear a word Tesseract itself doubts only when it carries a digit.
            for k in range(j2 - j1):
                w = words[j1 + k]
                if w["c"] < LOW_CONF and re.search(r"\d", w["t"]):
                    out.append({"vision": vtoks[i1 + k], "tess": w["t"], "conf": w["c"], "box": w["b"], "reason": "low_conf"})
            continue
        if op != "replace":
            continue
        v = " ".join(vtoks[i1:i2])
        t = " ".join(w["t"] for w in words[j1:j2])
        # Spans longer than a few tokens are layout differences (column order), not misreads.
        if i2 - i1 > 4 or j2 - j1 > 4:
            continue
        if re.search(r"\d", v + t) or re.search(r"\b[pcy]?[TNM]\d", v + t):
            xs = [w["b"] for w in words[j1:j2]]
            box = [min(x[0] for x in xs), min(x[1] for x in xs),
                   max(x[0] + x[2] for x in xs) - min(x[0] for x in xs),
                   max(x[1] + x[3] for x in xs) - min(x[1] for x in xs)]
            out.append({"vision": v, "tess": t, "conf": min(w["c"] for w in words[j1:j2]), "box": box, "reason": "disagree"})
    return out


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(args[args.index("--pages") + 1]) if "--pages" in args else Path("data/derived/pages")
    out = Path(args[args.index("--out") + 1]) if "--out" in args else Path("data/derived/page-index.json")
    index = {}
    for doc in sorted(p for p in pages_dir.iterdir() if p.is_dir()):
        pages = []
        for png in sorted(doc.glob("p*.png"), key=lambda p: int(re.sub(r"\D", "", p.stem))):
            n = int(re.sub(r"\D", "", png.stem))
            vis = doc / f"p{n}.vision.md"
            md = vis.read_text() if vis.exists() else ""
            words = tess_words(doc / f"p{n}.tess.tsv")
            confs = [w["c"] for w in words]
            w, h = png_size(png)
            pages.append({
                "n": n,
                "image": f"pages/{doc.name}/p{n}.png",
                "size": [w, h],
                "text": md,
                "engine": "vision" if md else "tesseract",
                "tess_text": (doc / f"p{n}.tess.txt").read_text(),
                "words": words,
                "mean_conf": round(sum(confs) / len(confs), 1) if confs else None,
                "low_conf_words": sum(c < LOW_CONF for c in confs),
                "verify": disagreements(vision_tokens(md), words) if md else [],
            })
        index[f"{doc.name}.pdf"] = {"pages": pages}
        print(f"{doc.name}: {len(pages)} pages, {sum(len(p['verify']) for p in pages)} tokens to verify")
    out.write_text(json.dumps(index, ensure_ascii=False))


if __name__ == "__main__":
    main()
