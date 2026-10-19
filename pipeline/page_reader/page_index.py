"""Page index: Tesseract words with boxes and the spans to verify ("ověřit").

A span is marked "ověřit" when it carries a digit or a stage and the two
readings of the page disagree, only the primary reading has it, or
Tesseract read it with low confidence. Two modes:

- `vision_vs_tesseract`: the primary text is the vision model's Markdown,
  the second reading is Tesseract's words (the page index the source viewer
  loads, built by scripts/build_page_index.py).
- `tesseract_vs_layer`: slice 6b-1 has no vision model, so the primary
  text (the text of record) is Tesseract's text and the second reading is
  the PDF text layer. The layer is never the text of record: FNO's font
  maps are broken, but it is independent of Tesseract, so where both agree
  the token is confirmed.

Each item carries its character offsets (start, end) in the primary text,
so the viewer marks exactly that place; see
docs/research/2026-10-16-ocr-evaluation.md.

This module needs only the standard library, so scripts/build_page_index.py
runs without installing anything.
"""

import csv
import difflib
import io
import re
import struct
import unicodedata
from pathlib import Path

LOW_CONF = 60  # every Tesseract error in the evaluation scored below this
SCALE = 150 / 300  # Tesseract read 300 dpi renders; the shown image is 150 dpi

VISION = "vision_vs_tesseract"
LAYER = "tesseract_vs_layer"


def png_size(path: Path) -> tuple[int, int]:
    """Read width and height from the PNG header, so no imaging library is needed."""
    with path.open("rb") as fh:
        head = fh.read(24)
    return png_size_bytes(head)


def png_size_bytes(head: bytes) -> tuple[int, int]:
    return struct.unpack(">II", head[16:24])


def norm(tok: str) -> str:
    """Compare tokens without case, punctuation at the edges, or Markdown markup."""
    tok = tok.strip("*#|_`[](){}.,;:!?\"'„“").lower()
    return unicodedata.normalize("NFC", tok)


def tess_words_text(tsv_text: str) -> list[dict]:
    """Tesseract's TSV as words {t, c, b}, boxes scaled from the 300 dpi OCR render to the 150 dpi image."""
    words = []
    for row in csv.DictReader(io.StringIO(tsv_text, newline=""), delimiter="\t", quoting=csv.QUOTE_NONE):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        box = [round(int(row[k]) * SCALE) for k in ("left", "top", "width", "height")]
        words.append({"t": text, "c": round(float(row["conf"])), "b": box})
    return words


def tess_words(tsv: Path) -> list[dict]:
    with tsv.open(newline="") as fh:
        return tess_words_text(fh.read())


def vision_tokens(md: str) -> list[tuple[str, int, int]]:
    """The vision text's words with their character offsets in the Markdown, so the app can mark them in place."""
    # Markers such as [razítko: SK] or [?] are not printed text, and runs of Markdown markup are not words;
    # both are blanked to spaces of the same length, which keeps every offset valid. A bracket with a digit
    # is printed text (a lab reference range such as "[28 ... 34]"), so it stays.
    masked = re.sub(r"\[[^\]\d]*\]", lambda m: " " * len(m.group()), md)
    masked = re.sub(r"[|*#>`_-]{2,}", lambda m: " " * len(m.group()), masked)
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", masked) if norm(m.group())]


def plain_tokens(text: str) -> list[tuple[str, int, int]]:
    """Whitespace tokens of a plain text (Tesseract's text or the text layer) with their offsets."""
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", text) if norm(m.group())]


def attach_words(toks: list[tuple[str, int, int]], words: list[dict]) -> list[dict | None]:
    """For each token of Tesseract's plain text, the TSV word it is (for its confidence and box).

    The text and the TSV come from two Tesseract runs on the same image, so they hold the same words in
    the same order; the alignment only guards against a line Tesseract split or joined differently."""
    meta: list[dict | None] = [None] * len(toks)
    a = [t[0] for t in toks]
    b = [w["t"] for w in words]
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
            for i, j in zip(range(i1, i2), range(j1, j2)):
                meta[i] = words[j]
    return meta


DIGIT = re.compile(r"\d")
STAGE = re.compile(r"\b[pcy]?[TNM]\d")


def risky(text: str) -> bool:
    """Digits, dates, doses and stages are where a misread changes the clinical meaning."""
    return bool(DIGIT.search(text) or STAGE.search(text))


# Negation words and forms. A negation misread changes the finding ("prokázány" for "neprokázány"), so in
# layer mode these are risky like digits. Vision mode keeps its rules, so the committed page index stays as built.
NEGATION = re.compile(r"^(?:ne|bez|ani|není|nejsou|nebyl\w*|nelze|žádn\w*|neg\w*|pozit\w*|vylouč\w*)$")


def risky_layer(text: str) -> bool:
    return risky(text) or any(NEGATION.match(norm(t)) for t in text.split())


def negation_pair(vs: str, ts: str) -> bool:
    """One reading has a negation the other lacks: a "ne-" prefix ("neprokázány"/"prokázány") or a
    negation word on one side only."""
    A, B = [norm(t) for t in vs.split()], [norm(t) for t in ts.split()]
    if any(x != y and (x == "ne" + y or y == "ne" + x) for x in A for y in B):
        return True
    return sorted(t for t in A if NEGATION.match(t)) != sorted(t for t in B if NEGATION.match(t))


CONFUSABLE = str.maketrans({"l": "1", "I": "1", "i": "1", "O": "0", "o": "0", "µ": "u"})


def same_unit(v: str, t: str) -> bool:
    """"mmol/l" read as "mmol/1": a unit without digits that differs only by look-alike characters is not a
    clinical risk. A token with a digit ("M0" read as "MO") still counts."""
    return not DIGIT.search(v) and v.translate(CONFUSABLE) == t.translate(CONFUSABLE)


def box_of(words: list[dict]) -> list[int]:
    xs = [w["b"] for w in words]
    x0, y0 = min(x[0] for x in xs), min(x[1] for x in xs)
    return [x0, y0, max(x[0] + x[2] for x in xs) - x0, max(x[1] + x[3] for x in xs) - y0]


class _Pair:
    """The two readings being aligned, and where confidences and boxes come from in each mode.

    In vision mode the second reading (Tesseract's words) carries them; in layer mode the primary
    reading (Tesseract's text, joined to its TSV words) does, and the text layer has none."""

    def __init__(self, mode, ptoks, stoks, text, pmeta=None):
        self.mode, self.ptoks, self.stoks, self.text = mode, ptoks, stoks, text
        self.pmeta = pmeta or [None] * len(ptoks)
        self.a = [norm(t[0]) for t in ptoks]
        self.b = [norm(w["t"]) for w in stoks]
        self.primary_only = "only_vision" if mode == VISION else "only_tesseract"
        self.risky = risky if mode == VISION else risky_layer
        self.negations = mode == LAYER
        # Layer mode only: second-reading tokens some alignment explained, and the primary token each
        # unexplained one sits next to, so a risky token only the layer has ("N1" Tesseract dropped) is marked.
        self.explained: set[int] = set()
        self.anchor: dict[int, int] = {}

    def meta(self, V, W) -> list[dict]:
        if self.mode == VISION:
            return [self.stoks[j] for j in W]
        return [self.pmeta[i] for i in V if self.pmeta[i]]

    def item(self, V, W, reason) -> dict:
        """One "ověřit" item: the primary span (text and offsets), the other reading there, and where on the image."""
        tw = self.meta(V, W)
        p = " ".join(self.ptoks[i][0] for i in V)
        s = " ".join(self.stoks[j]["t"] for j in W)
        conf = min((w["c"] for w in tw), default=None)
        box = box_of(tw) if tw else None
        start, end = self.ptoks[V[0]][1], self.ptoks[V[-1]][2]
        if self.mode == VISION:
            return {"vision": p, "start": start, "end": end, "tess": s, "conf": conf, "box": box, "reason": reason}
        return {"tess": p, "start": start, "end": end, "layer": s, "conf": conf, "box": box, "reason": reason}

    def low_conf(self, i, j) -> bool:
        """Agreement does not clear a word Tesseract itself doubts when it carries a digit."""
        w = self.stoks[j] if self.mode == VISION else self.pmeta[i]
        return bool(w) and w["c"] < LOW_CONF and bool(DIGIT.search(w["t"]))


def runs(idx: list[int], vtoks, md) -> list[list[int]]:
    """Split primary token indices into runs that are adjacent in the text and on one line."""
    out = []
    for i in idx:
        if out and i == out[-1][-1] + 1 and "\n" not in md[vtoks[i - 1][2]:vtoks[i][1]]:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def classify(P: _Pair, vi, wj, final):
    """Align primary tokens vi with second-reading tokens wj. Returns the items found and, unless final, the
    tokens left unexplained (deleted, inserted, or in long replaced spans) for a second pass."""
    a, b, vtoks = P.a, P.b, P.ptoks
    out, left_v, left_w = [], [], []
    ops = difflib.SequenceMatcher(None, [a[i] for i in vi], [b[j] for j in wj], autojunk=False).get_opcodes()
    for op, i1, i2, j1, j2 in ops:
        V, W = vi[i1:i2], wj[j1:j2]
        if not final and op != "equal":
            near = V[0] if V else vi[i1 - 1] if i1 > 0 else vi[0] if vi else None
            for j in W:
                P.anchor.setdefault(j, near)
        if op == "equal" or (op == "replace" and len(V) <= 4 and len(W) <= 4):
            P.explained.update(W)
        if op == "equal":
            for i, j in zip(V, W):
                if P.low_conf(i, j):
                    out.append(P.item([i], [j], "low_conf"))
        elif not final and (op != "replace" or len(V) > 4 or len(W) > 4):
            left_v += V
            left_w += W
        elif op == "delete":
            for r in runs(V, vtoks, P.text):
                if P.risky(" ".join(vtoks[i][0] for i in r)):
                    out.append(P.item(r, [], P.primary_only))
        elif op == "replace" and len(V) <= 4 and len(W) <= 4:
            vs, ts = " ".join(vtoks[i][0] for i in V), " ".join(P.stoks[j]["t"] for j in W)
            if P.risky(vs + " " + ts) and not same_unit(norm(vs), norm(ts)):
                out.append(P.item(V, W, "disagree"))
            elif P.negations and negation_pair(vs, ts):
                # Mark the word that lost or gained its negation, not the whole replaced run.
                pairs = [(i, j) for i in V for j in W if a[i] != b[j] and (a[i] == "ne" + b[j] or b[j] == "ne" + a[i])]
                if pairs:
                    out.extend(P.item([i], [j], "disagree") for i, j in pairs)
                else:
                    out.append(P.item(V, W, "disagree"))
        elif op == "replace":
            # A long replaced span can hide a misread line; pair its risky words one by one by similarity.
            used = set()
            for i in V:
                # Layer mode pairs every word, so a dropped "ne-" on an ordinary word is found too.
                if not P.risky(vtoks[i][0]) and not P.negations:
                    continue
                best, score = None, 0.0
                for j in W:
                    r = 0.0 if j in used else difflib.SequenceMatcher(None, a[i], b[j]).ratio()
                    if r > score:
                        best, score = j, r
                if best is not None and score >= .6:
                    used.add(best)
                    P.explained.add(best)
                    if P.negations and negation_pair(a[i], b[best]):
                        out.append(P.item([i], [best], "disagree"))
                    elif P.risky(vtoks[i][0]) and a[i] != b[best] and not same_unit(a[i], b[best]):
                        out.append(P.item([i], [best], "disagree"))
                elif not P.risky(vtoks[i][0]):
                    continue
                else:
                    out.append(P.item([i], [], P.primary_only))
    return out, left_v, left_w


def disagreements(ptoks: list[tuple[str, int, int]], stoks: list[dict], text: str,
                  mode: str = VISION, pmeta: list[dict | None] | None = None) -> list[dict]:
    """Align the two readings and keep every span that matters clinically and is not confirmed by both.

    Two passes: Tesseract often reads columns or paragraphs in another order, so text the first alignment
    calls missing is aligned again against the leftover tokens before it is called primary-only.
    In layer mode an empty text layer is no second reading at all, so only Tesseract's own doubts apply."""
    P = _Pair(mode, ptoks, stoks, text, pmeta)
    if mode == LAYER and not stoks:
        return [P.item([i], [], "low_conf") for i, m in enumerate(P.pmeta)
                if m and m["c"] < LOW_CONF and DIGIT.search(m["t"])]
    out, left_v, left_w = classify(P, list(range(len(P.a))), list(range(len(P.b))), final=False)
    more, _, _ = classify(P, left_v, left_w, final=True)
    if mode == LAYER:
        more += _only_second(P)
    return sorted(out + more, key=lambda x: x["start"])


def _only_second(P: _Pair) -> list[dict]:
    """Risky tokens only the text layer has, as one item per neighbouring Tesseract token.

    The text of record is the reading that may have dropped them, so they cannot be left unmarked; the
    item points at the Tesseract token next to the gap (start/end), with the layer's tokens as the reading."""
    groups: dict[int, list[int]] = {}
    for j in range(len(P.stoks)):
        i = P.anchor.get(j)
        if j not in P.explained and i is not None and P.risky(P.stoks[j]["t"]):
            groups.setdefault(i, []).append(j)
    return [P.item([i], W, "only_layer") for i, W in groups.items()]


def conf_stats(words: list[dict]) -> tuple[float | None, int]:
    confs = [w["c"] for w in words]
    return (round(sum(confs) / len(confs), 1) if confs else None), sum(c < LOW_CONF for c in confs)


def tesseract_page(n: int, size: list[int], tess_text: str, words: list[dict], layer_text: str) -> dict:
    """The Step 2 page record for slice 6b-1: Tesseract's text of record, verified against the text layer."""
    ptoks = plain_tokens(tess_text)
    ltoks = [{"t": t[0]} for t in plain_tokens(layer_text or "")]
    mean_conf, low = conf_stats(words)
    return {
        "n": n, "size": list(size), "text": tess_text, "engine": "tesseract", "words": words,
        "mean_conf": mean_conf, "low_conf_words": low,
        "verify": disagreements(ptoks, ltoks, tess_text, LAYER, attach_words(ptoks, words)),
        # No text layer means no second reading: the page then carries only Tesseract's own doubts.
        "second_reading": "text_layer" if ltoks else None,
    }


def mark_unreadable(rec: dict, regions: list[dict]) -> dict:
    """Put the page's unreadable regions ({"b": [x, y, w, h], "reason"}, from redact.unreadable_regions) on the
    page record, and mark every token of the text of record whose word lies in one as "ověřit" with the reason
    "unreadable": what Tesseract guessed there is shown for checking against the image, never as read text.
    A word lies in a region when the centre of its box does."""
    rec["unreadable"] = [{"b": list(r["b"]), "reason": r["reason"]} for r in regions]
    if not regions:
        return rec
    toks = plain_tokens(rec["text"])
    marked = {(v["start"], v["end"]) for v in rec["verify"]}
    for (tok, start, end), w in zip(toks, attach_words(toks, rec["words"])):
        if w is None or (start, end) in marked:
            continue
        cx, cy = w["b"][0] + w["b"][2] / 2, w["b"][1] + w["b"][3] / 2
        for r in regions:
            x, y, bw, bh = r["b"]
            if x <= cx <= x + bw and y <= cy <= y + bh:
                rec["verify"].append({"tess": tok, "start": start, "end": end, "layer": None, "conf": w["c"],
                                      "box": list(r["b"]), "reason": "unreadable"})
                break
    rec["verify"].sort(key=lambda v: v["start"])
    return rec


def build_index(pages_dir: Path, log=print) -> dict:
    """The page index of scripts/build_page_index.py: vision text verified against Tesseract, per PDF stem."""
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
            mean_conf, low = conf_stats(words)
            w, h = png_size(png)
            pages.append({
                "n": n,
                "image": f"pages/{doc.name}/p{n}.png",
                "size": [w, h],
                "text": md,
                "engine": "vision" if md else "tesseract",
                "tess_text": (doc / f"p{n}.tess.txt").read_text(),
                "words": words,
                "mean_conf": mean_conf,
                "low_conf_words": low,
                "verify": disagreements(vision_tokens(md), words, md) if md else [],
            })
        index[f"{doc.name}.pdf"] = {"pages": pages}
        log(f"{doc.name}: {len(pages)} pages, {sum(len(p['verify']) for p in pages)} tokens to verify")
    return index
