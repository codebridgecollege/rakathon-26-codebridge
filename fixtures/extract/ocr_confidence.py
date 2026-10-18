"""Decide whether a "!" (ověřit čtení) mark is still needed on a fact of case 10 (round 25).

Usage:
    python3 fixtures/extract/ocr_confidence.py [--write]

The "!" marks in the app come from `ocr_note_cs` in `fixtures/data/mock-case-10-extra.json`: notes written
when the facts were extracted from the PDF's old text layer, which misreads characters ("výbormně", "zyyšuji",
"MO"). Since then every page has two independent readings in `data/derived/page-index.json`: the vision model's
transcription (`text`) and Tesseract's words with confidence (`words`). A doctor asked why "!" shows on words
that are obviously right, so each note is checked against those two readings.

Rule, per token the note quotes („...“):
1. Find the vision model's word for the token on the source page, then Tesseract's word for that vision word.
2. Drop the mark ("agree") when both readings are the same after removing diacritics, case, punctuation and
   spaces. Digits stay digits, so O/0 and l/1 swaps still count as a difference.
3. Drop the mark ("lexicon") when the vision word is a known Czech or medical word and Tesseract differs from it
   by one character, unless that character is a digit, the difference is a negation prefix (ne-, bez) or a unit.
4. Otherwise keep the mark: the readings differ in a digit, a negation, a unit or meaning, one engine did not
   read the word at all, or the note itself states a doubt ("ověřit", "nečitelné"). A fact keeps its mark if any
   of its tokens keeps it.

The known-word list is a stand-in for a real Czech and medical dictionary (none is installed here): the words of
the team-reviewed Czech text fields in the case data (text_cs, comment_cs, ...), which are hand-corrected
readings, plus a few clinical terms. The result is written as `ocr_check` next to the note; the note itself stays
as the record of what the old text layer said. The mock hides "!" when `ocr_check.mark` is false.
"""

import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "fixtures/data"
EXTRA_PATH = DATA / "mock-case-10-extra.json"
INDEX = json.loads((ROOT / "data/derived/page-index.json").read_text())
EXTRA = json.loads(EXTRA_PATH.read_text())
FILE = "10_pacient.pdf"
# Blocks whose facts carry ocr_note_cs; the same "!" mark is drawn for all of them.
BLOCKS = ["status_praesens", "onco_compact_v3", "onco_detailed_v3", "timeline_cards_v3", "anamnesis_v3", "diagnosis_headline"]
# The note doubts the content itself ("ověřit", "nečitelné" for an unreadable part); "nečitelný znak" only describes
# the old text layer and is checked like any other token.
DOUBT = re.compile(r"ověřit|nečitelné\b|neuveden", re.I)
UNIT = re.compile(r"mg|ml|mmol|µ|/l|kg|%|gy", re.I)
NEGATION = re.compile(r"^(ne|bez)")
CLINICAL = {"jizvy", "nález", "nalez", "fenoménů", "fenomenu", "nevolnost", "výborně", "progrese", "retroperitoneu",
            "vyšetření", "zvyšuji", "nepřibyla", "venózního", "světlobuněčného", "osteoplastické", "velikosti"}


def fold(s: str) -> str:
    """Lower case, no diacritics, no punctuation or spaces; digits and letters stay distinct."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^0-9a-zµ]", "", s)


def lexicon() -> set[str]:
    words = set(fold(w) for w in CLINICAL)

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str) and k.endswith("_cs") and not k.startswith("ocr"):
                    words.update(fold(w) for w in re.findall(r"\w+", v))
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(EXTRA)
    words.discard("")
    return words


LEX = lexicon()


def window(text: str, quote: str) -> int:
    """Start of the stretch of text that best matches the quote (the quotes come from the old text layer)."""
    n, best_start, best_r = len(quote), 0, -1.0
    for start in range(0, max(1, len(text) - n // 2), max(1, min(8, n // 6))):
        r = difflib.SequenceMatcher(None, text[start:start + n + n // 3], quote, autojunk=False).ratio()
        if r > best_r:
            best_start, best_r = start, r
    return best_start


def reading_at(text: str, quote: str, i1: int, i2: int, min_ratio: float = 0.6) -> str | None:
    """The word or words of `text` that stand where quote[i1:i2] stands, found by aligning the quote to the text."""
    n = len(quote)
    w0 = window(text, quote)
    seg = text[w0:w0 + n + n // 3]
    # A stretch that barely resembles the quote means this reading does not contain the passage.
    if difflib.SequenceMatcher(None, seg, quote, autojunk=False).ratio() < min_ratio:
        return None
    blocks = difflib.SequenceMatcher(None, seg, quote, autojunk=False).get_matching_blocks()
    # Map each quote offset to a text offset through the matching blocks; offsets between blocks take the
    # nearest block edge, so a misread character still lands inside the right word.
    def to_text(q: int) -> int | None:
        prev = None
        first = next(((a, b) for a, b, size in blocks if size), None)
        if first and q < first[1]:
            return max(0, first[0] - (first[1] - q))
        for a, b, size in blocks:
            if size and b <= q < b + size:
                return a + (q - b)
            if size and b + size <= q:
                prev = a + size
        return prev
    s, e = to_text(i1), to_text(max(i1, i2 - 1))
    if s is None or e is None:
        return None
    s, e = min(s, e), max(s, e) + 1
    while s > 0 and not seg[s - 1].isspace():
        s -= 1
    while e < len(seg) and not seg[e].isspace():
        e += 1
    word = seg[s:e].strip()
    return word or None




def one_char_safe(v: str, t: str) -> bool:
    """True when v and t differ by one edit that is not a digit, a negation prefix or a unit."""
    a, b = fold(v), fold(t)
    ops = [op for op in difflib.SequenceMatcher(None, a, b).get_opcodes() if op[0] != "equal"]
    if len(ops) != 1:
        return False
    tag, i1, i2, j1, j2 = ops[0]
    changed = a[i1:i2] + b[j1:j2]
    if max(i2 - i1, j2 - j1) > 1 or re.search(r"\d", changed):
        return False
    if bool(NEGATION.match(a)) != bool(NEGATION.match(b)):
        return False
    return not (UNIT.search(v) or UNIT.search(t))


def check(item) -> dict:
    note = item.get("ocr_note_cs") or ""
    tokens = re.findall(r"„([^“]+)“", note)
    if DOUBT.search(note) or not tokens:
        return {"mark": True, "rule": "note_states_doubt" if DOUBT.search(note) else "no_token", "tokens": []}
    refs = [EXTRA["refs"][i] for i in item.get("refs") or []] or ([item["source"]] if item.get("source") else [])
    out, keep = [], False
    for tok in tokens:
        entry = {"layer": tok, "vision": None, "tess": None}
        # The token is quoted from the old text layer, so it stands inside one of the fact's quotes.
        hit = next(((r, r["quote"].find(tok)) for r in refs if tok in r["quote"]), None)
        if not hit:
            entry["rule"], keep = "token_not_in_quote", True
            out.append(entry)
            continue
        ref, i = hit
        pg = INDEX[FILE]["pages"][ref["page"] - 1]
        # Align only the token and up to 30 characters around it: Tesseract may place a heading apart from its line,
        # so the whole quote does not always align, while the near context does.
        v = t = None
        for width, min_ratio in ((30, 0.6), (12, 0.5)):
            c0 = max(0, i - width)
            ctx = ref["quote"][c0:i + len(tok) + width]
            v = v or reading_at(pg["text"], ctx, i - c0, i - c0 + len(tok), min_ratio)
            t = t or (reading_at(pg["tess_text"], ctx, i - c0, i - c0 + len(tok), min_ratio) if v else None)
        entry.update(vision=v, tess=t, page=ref["page"])
        if not v:
            entry["rule"], keep = "vision_missing", True
        elif not t or difflib.SequenceMatcher(None, fold(v), fold(t)).ratio() < 0.5:
            entry["rule"], keep = "tess_missing", True
        elif fold(v) == fold(t):
            entry["rule"] = "agree"
        elif fold(v) in LEX and one_char_safe(v, t):
            entry["rule"] = "lexicon"
        else:
            entry["rule"], keep = "differ", True
        out.append(entry)
    return {"mark": keep, "rule": "kept" if keep else "suppressed", "tokens": out}


def items():
    for block in BLOCKS:
        stack = [(block, EXTRA[block])]
        while stack:
            path, o = stack.pop()
            if isinstance(o, dict):
                if o.get("ocr_note_cs"):
                    yield path, o
                stack += [(f"{path}.{k}", v) for k, v in o.items() if isinstance(v, (dict, list))]
            elif isinstance(o, list):
                stack += [(f"{path}[{i}]", v) for i, v in enumerate(o)]


if __name__ == "__main__":
    for path, it in sorted(items(), key=lambda x: x[0]):
        it["ocr_check"] = check(it)
        toks = "; ".join(f"{x['layer']!r} vision={x['vision']!r} tess={x['tess']!r} {x['rule']}" for x in it["ocr_check"]["tokens"])
        print(f"{'KEEP' if it['ocr_check']['mark'] else 'DROP'} {path}: {toks or it['ocr_check']['rule']}")
    if "--write" in sys.argv:
        out = json.dumps(EXTRA, ensure_ascii=False, indent=1)
        assert chr(0x2014) not in out  # house style: no em dashes in data
        EXTRA_PATH.write_text(out + "\n")
