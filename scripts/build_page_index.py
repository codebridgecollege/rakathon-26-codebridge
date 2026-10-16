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


def vision_tokens(md: str) -> list[tuple[str, int, int]]:
    """The vision text's words with their character offsets in the Markdown, so the app can mark them in place."""
    # Markers such as [razítko: SK] or [?] are not printed text, and runs of Markdown markup are not words;
    # both are blanked to spaces of the same length, which keeps every offset valid. A bracket with a digit
    # is printed text (a lab reference range such as "[28 ... 34]"), so it stays.
    masked = re.sub(r"\[[^\]\d]*\]", lambda m: " " * len(m.group()), md)
    masked = re.sub(r"[|*#>`_-]{2,}", lambda m: " " * len(m.group()), masked)
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", masked) if norm(m.group())]


DIGIT = re.compile(r"\d")
STAGE = re.compile(r"\b[pcy]?[TNM]\d")


def risky(text: str) -> bool:
    """Digits, dates, doses and stages are where a misread changes the clinical meaning."""
    return bool(DIGIT.search(text) or STAGE.search(text))


CONFUSABLE = str.maketrans({"l": "1", "I": "1", "i": "1", "O": "0", "o": "0", "µ": "u"})


def same_unit(v: str, t: str) -> bool:
    """"mmol/l" read as "mmol/1": a unit without digits that differs only by look-alike characters is not a
    clinical risk. A token with a digit ("M0" read as "MO") still counts."""
    return not DIGIT.search(v) and v.translate(CONFUSABLE) == t.translate(CONFUSABLE)


def box_of(words: list[dict]) -> list[int]:
    xs = [w["b"] for w in words]
    x0, y0 = min(x[0] for x in xs), min(x[1] for x in xs)
    return [x0, y0, max(x[0] + x[2] for x in xs) - x0, max(x[1] + x[3] for x in xs) - y0]


def item(vtoks, vi: list[int], words, wj: list[int], reason) -> dict:
    """One "ověřit" item: the vision span (text and offsets), what Tesseract read there, and where on the image."""
    tw = [words[j] for j in wj]
    return {
        "vision": " ".join(vtoks[i][0] for i in vi), "start": vtoks[vi[0]][1], "end": vtoks[vi[-1]][2],
        "tess": " ".join(w["t"] for w in tw), "conf": min((w["c"] for w in tw), default=None),
        "box": box_of(tw) if tw else None, "reason": reason,
    }


def runs(idx: list[int], vtoks, md) -> list[list[int]]:
    """Split vision token indices into runs that are adjacent in the text and on one line."""
    out = []
    for i in idx:
        if out and i == out[-1][-1] + 1 and "\n" not in md[vtoks[i - 1][2]:vtoks[i][1]]:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def classify(vi, wj, vtoks, words, md, a, b, final):
    """Align vision tokens vi with Tesseract words wj. Returns the items found and, unless final, the
    tokens and words left unexplained (deleted, inserted, or in long replaced spans) for a second pass."""
    out, left_v, left_w = [], [], []
    ops = difflib.SequenceMatcher(None, [a[i] for i in vi], [b[j] for j in wj], autojunk=False).get_opcodes()
    for op, i1, i2, j1, j2 in ops:
        V, W = vi[i1:i2], wj[j1:j2]
        if op == "equal":
            # Agreement does not clear a word Tesseract itself doubts when it carries a digit.
            for i, j in zip(V, W):
                if words[j]["c"] < LOW_CONF and DIGIT.search(words[j]["t"]):
                    out.append(item(vtoks, [i], words, [j], "low_conf"))
        elif not final and (op != "replace" or len(V) > 4 or len(W) > 4):
            left_v += V
            left_w += W
        elif op == "delete":
            for r in runs(V, vtoks, md):
                if risky(" ".join(vtoks[i][0] for i in r)):
                    out.append(item(vtoks, r, words, [], "only_vision"))
        elif op == "replace" and len(V) <= 4 and len(W) <= 4:
            vs, ts = " ".join(vtoks[i][0] for i in V), " ".join(words[j]["t"] for j in W)
            if risky(vs + " " + ts) and not same_unit(norm(vs), norm(ts)):
                out.append(item(vtoks, V, words, W, "disagree"))
        elif op == "replace":
            # A long replaced span can hide a misread line; pair its risky words one by one by similarity.
            used = set()
            for i in V:
                if not risky(vtoks[i][0]):
                    continue
                best, score = None, 0.0
                for j in W:
                    r = 0.0 if j in used else difflib.SequenceMatcher(None, a[i], b[j]).ratio()
                    if r > score:
                        best, score = j, r
                if best is not None and score >= .6:
                    used.add(best)
                    if a[i] != b[best] and not same_unit(a[i], b[best]):
                        out.append(item(vtoks, [i], words, [best], "disagree"))
                else:
                    out.append(item(vtoks, [i], words, [], "only_vision"))
    return out, left_v, left_w


def disagreements(vtoks: list[tuple[str, int, int]], words: list[dict], md: str) -> list[dict]:
    """Align the two readings and keep every span that matters clinically and is not confirmed by both engines.

    Two passes: Tesseract often reads columns or paragraphs in another order, so text the first alignment
    calls missing is aligned again against Tesseract's leftover words before it is called vision-only."""
    a = [norm(t[0]) for t in vtoks]
    b = [norm(w["t"]) for w in words]
    out, left_v, left_w = classify(list(range(len(a))), list(range(len(b))), vtoks, words, md, a, b, final=False)
    more, _, _ = classify(left_v, left_w, vtoks, words, md, a, b, final=True)
    return sorted(out + more, key=lambda x: x["start"])


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(args[args.index("--pages") + 1]) if "--pages" in args else Path("data/derived/pages")
    out = Path(args[args.index("--out") + 1]) if "--out" in args else Path("data/derived/page-index.json")
    index = {}
    for doc in sorted(p for p in pages_dir.iterdir() if p.is_dir()):
        pages = []
        # Only the page renders; p<n>.redacted.png from scripts/redact_pages.py sits in the same folder.
        renders = [p for p in doc.glob("p*.png") if re.fullmatch(r"p\d+\.png", p.name)]
        for png in sorted(renders, key=lambda p: int(re.sub(r"\D", "", p.stem))):
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
                "verify": disagreements(vision_tokens(md), words, md) if md else [],
            })
        index[f"{doc.name}.pdf"] = {"pages": pages}
        print(f"{doc.name}: {len(pages)} pages, {sum(len(p['verify']) for p in pages)} tokens to verify")
    out.write_text(json.dumps(index, ensure_ascii=False))


if __name__ == "__main__":
    main()
