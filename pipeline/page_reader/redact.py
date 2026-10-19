"""Find direct identifiers on a page from Tesseract's word boxes, and black them out on the page image.

This is option B in docs/design/DATA-PROTECTION.md: everything here runs locally, before a page image
may leave the hospital. What counts as a direct identifier:
- the patient's name, from the consultation form or the case record;
- a birth number (Czech rodné číslo) or a date after "nar.";
- phone numbers and e-mail addresses;
- the value after a form label such as "Jméno", "Příjmení", "Rodné číslo",
  "Pojišťovna", "Adresa", "Telefon";
- doctors' names after "MUDr." and similar titles, also when the OCR glued
  the title to the name ("MUDr.Hofrová"); they identify the care team.

Not removed, on purpose: examination dates, diagnoses, findings. They are the medical content; they are
also quasi-identifiers, which is why the redacted page is still personal data. The hits carry only the
reason and the box, never the identifier value.
"""

import csv
import io
import re
import unicodedata
from pathlib import Path

from PIL import ImageDraw, ImageFilter

SCALE = 150 / 300  # Tesseract read 300 dpi renders; the page image is 150 dpi
PAD = 2  # a little margin, so letter edges do not show around the box

RC = re.compile(r"^\d{6}/?\d{3,4}[.,;]?$")
PHONE = re.compile(r"^(\+?420)?\d{3}\s?\d{3}\s?\d{3}[.,;]?$")
EMAIL = re.compile(r"@")
# Compared after fold(), so without diacritics and trailing punctuation ("nar.:" becomes "nar").
FORM_LABELS = ("jmeno", "prijmeni", "rodne", "pojistovna", "poj", "kodpo", "adresa", "telefon", "bydliste", "nar")


def fold(s: str) -> str:
    """Match names regardless of case, diacritics, and trailing punctuation."""
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip(".,;:()[]")


def read_lines(tsv: Path) -> list[list[dict]]:
    with tsv.open(newline="") as fh:
        return read_lines_text(fh.read())


def read_lines_text(tsv_text: str) -> list[list[dict]]:
    """Group Tesseract's words into lines, keeping each word's box."""
    lines: dict[tuple, list[dict]] = {}
    for row in csv.DictReader(io.StringIO(tsv_text, newline=""), delimiter="\t", quoting=csv.QUOTE_NONE):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        key = (row["block_num"], row["par_num"], row["line_num"])
        box = [int(row[k]) * SCALE for k in ("left", "top", "width", "height")]
        lines.setdefault(key, []).append({"t": text, "b": box})
    return list(lines.values())


# "MUDr.Hofrová", "MUDr,Hofrová": OCR often glues the title to the name, so the name is in the same token.
TITLE_GLUED = re.compile(r"^(mudr|mgr|bc|ing|doc|prof|phdr)[.,]+\w{2,}")
# Not "prim.": it folds to the same text as "přim." (přiměřené), which is medical wording; "prim. MUDr. X"
# is still caught through "MUDr.".
TITLES = ("mudr", "mgr", "doc", "prof", "phdr")
LABEL_GLUED = re.compile(r"^(nar|poj|kodpoj|rc)\W*\d")  # "nar.:13.10.1961", "Kódpoj:111": label and value in one token
MAX_VALUE_TOKENS = 3  # a field value is a few words; beyond that the line has moved on
MAX_GAP = 200  # px at 150 dpi; a token far to the right belongs to another column


# A leading "*" (a birth marker, but also a bullet as OCR reads it) is allowed on the patient's own date only.
DATE = re.compile(r"^\*?\d{1,2}[./]\d{1,2}[./]\d{2,4}[.,;]?$")
BIRTH_LABELS = ("nar", "narozen", "narozena")


def _groups(names) -> dict[str, object]:
    """Name forms -> the name part they belong to. A plain set counts each form as its own part."""
    return dict(names) if isinstance(names, dict) else {f: f for f in names}


def find(lines: list[list[dict]], names, staff=frozenset(),
         birth_number: str | None = None, birth_date: str | None = None) -> list[dict]:
    """The direct identifiers on a page. `names` are the patient's name forms and `staff` the org's staff name
    forms (folded), each a set or a dict form -> name part. A name form counts when the word is capitalized, or
    next to a form of another part of the same name ("jan hlava", not "hlavy Hlava"), because
    many names are ordinary words ("Malá", "Hlava": "malé pánve", "CT hlavy" stay readable); the same rule as the
    text pseudonymization (api/src/domain/pseudonymize.ts). birth_number and birth_date come from the case record."""
    names, staff = _groups(names), _groups(staff)
    bn_digits = re.sub(r"\D", "", birth_number or "")
    bd = _date_key(birth_date) if birth_date else None
    hits = []
    for line in lines:
        after_label = 0  # how many more tokens count as the value of the last form label
        for i, w in enumerate(line):
            f = fold(w["t"])
            near = i > 0 and w["b"][0] - (line[i - 1]["b"][0] + line[i - 1]["b"][2]) < MAX_GAP
            prev = fold(line[i - 1]["t"]) if i > 0 else ""
            nxt = fold(line[i + 1]["t"]) if i + 1 < len(line) else ""
            capital = w["t"][:1].isupper()
            digits = re.sub(r"\D", "", w["t"])
            prev_digits = re.sub(r"\D", "", line[i - 1]["t"]) if i > 0 else ""
            reason = None
            if LABEL_GLUED.match(f.replace(" ", "")):
                reason = "hodnota identifikačního pole"
            elif f in names and (capital or _paired(names, f, prev, nxt)):
                reason = "jméno pacienta"
            elif f in staff and (capital or _paired(staff, f, prev, nxt)):
                reason = "jméno lékaře"
            elif len(bn_digits) >= 9 and digits and (digits in (bn_digits, bn_digits[:6]) or (
                    # "585614 / 1234" read as separate tokens: the ending after the first half or a lone slash
                    digits == bn_digits[6:] and (prev_digits == bn_digits[:6] or line[i - 1]["t"] == "/"))):
                reason = "rodné číslo"
            elif DATE.match(w["t"]) and (prev in BIRTH_LABELS or (bd is not None and _date_key(w["t"]) == bd)):
                # "Lipenská Věra, nar. 14.6.1958": "nar." in the middle of a line, with the date as its own token.
                reason = "datum narození"
            elif RC.match(w["t"]):
                reason = "rodné číslo"
            elif PHONE.match(w["t"]):
                reason = "telefon"
            elif EMAIL.search(w["t"]):
                reason = "e-mail"
            elif TITLE_GLUED.match(f):
                reason = "jméno lékaře"
            elif i > 0 and fold(line[i - 1]["t"]) in TITLES:
                reason = "jméno lékaře"
            elif after_label > 0 and near and not f.endswith(":"):
                reason = "hodnota identifikačního pole"
            after_label = after_label - 1 if near else 0
            is_label = any(f == lbl or (f.startswith(lbl) and len(lbl) > 3) for lbl in FORM_LABELS)
            # A form label starts its line or ends with a colon; "v místě bydliště." in a
            # sentence is medical text and must stay readable.
            if is_label and (i == 0 or w["t"].rstrip().endswith(":")):
                # The few tokens right after "Jméno:", "Rodné číslo:", "nar." are identity data.
                after_label = MAX_VALUE_TOKENS
            if reason:
                hits.append({"reason": reason, "box": [round(x) for x in w["b"]]})
    return hits


def _paired(groups: dict, f: str, prev: str, nxt: str) -> bool:
    return any(o in groups and groups[o] != groups[f] for o in (prev, nxt))


def _date_key(s: str) -> tuple | None:
    m = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)", s.replace(" ", ""))
    return (int(m[1]), int(m[2]), m[3][-2:]) if m else None


def lines_from_words(words: list[dict]) -> list[list[dict]]:
    """Group a page record's words ({t, c, b}, without Tesseract's line numbers) into lines: a word joins the
    line whose vertical centre is within half a word height of its own, and each line is read left to right."""
    lines: list[tuple[float, float, list[dict]]] = []  # (centre, height, words)
    for w in sorted(words, key=lambda w: (w["b"][1] + w["b"][3] / 2, w["b"][0])):
        _x, y, _w, h = w["b"]
        c = y + h / 2
        for lc, lh, ws in lines:
            if abs(c - lc) <= max(h, lh) / 2:
                ws.append(w)
                break
        else:
            lines.append((c, h, [w]))
    return [sorted(ws, key=lambda w: w["b"][0]) for _, _, ws in lines]


# Ink marks: signatures, stamps and handwriting are not words Tesseract reads, so they are found as dark areas that
# no OCR word covers. Best effort (docs/design/DATA-PROTECTION.md): a light stamp, or a signature crossing printed
# text, can be missed; a logo or a drawing is blacked out too.
INK_SCALE = 4  # work on a quarter-size image: fast in pure Python, and a stroke is still a few pixels wide
INK_DARK = 140
INK_MIN = (10, 8)  # w, h at quarter size: 40 x 32 px at 150 dpi; a printed line OCR missed is lower than that
INK_MAX_AREA = 0.15  # of the page; anything larger is a frame or a table
INK_MIN_FILL = 0.06  # dark pixels per box area; a table grid is sparser than a signature or a stamp
INK_MAX_WORDS = 2  # a box over more OCR words is printed content (a framed table), not a signature


def ink_marks(img, words: list[dict]) -> list[dict]:
    """Boxes (150 dpi) of dark areas that no OCR word covers, as hits with the reason "podpis, razítko"."""
    boxes = []
    for box in _ink_boxes(img, words, INK_MAX_AREA):
        if sum(1 for w in words if _within(w["b"], box)) > INK_MAX_WORDS:
            continue
        boxes.append({"reason": "podpis, razítko nebo rukopis (odhad)", "box": box})
    return boxes


def _ink_boxes(img, masked: list[dict], max_area: float | None, keep_thin: bool = False,
               with_fill: bool = False) -> list:
    """Boxes (150 dpi) of the dark areas left after blanking the boxes of the `masked` words: at least INK_MIN,
    at most max_area of the page (None: any size), and at least INK_MIN_FILL dark. keep_thin widens strokes by a
    pixel before the quarter-size reduction, so a 1 px or grey ballpoint line still reads as ink there. with_fill
    returns (box, fill) pairs."""
    s = INK_SCALE
    gray = img.convert("L")
    if keep_thin:
        gray = gray.filter(ImageFilter.MinFilter(3))
    small = gray.resize((max(1, img.width // s), max(1, img.height // s)))
    W, H = small.size
    data = small.tobytes()
    limit = THIN_DARK if keep_thin else INK_DARK
    dark = bytearray(1 if v < limit else 0 for v in data)
    for w in masked:  # words OCR read are handled as text; only the ink they do not explain is left
        x, y, wd, h = w["b"]
        for yy in range(max(0, int(y // s) - 1), min(H, int((y + h) // s) + 2)):
            x0, x1 = max(0, int(x // s) - 1), min(W, int((x + wd) // s) + 2)
            dark[yy * W + x0: yy * W + x1] = bytes(x1 - x0)
    seen = bytearray(W * H)
    boxes = []
    for start in range(W * H):
        if not dark[start] or seen[start]:
            continue
        stack, n = [start], 0
        seen[start] = 1
        x0 = x1 = start % W
        y0 = y1 = start // W
        while stack:
            i = stack.pop()
            n += 1
            x, y = i % W, i // W
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            # neighbours up to two pixels away, so the separate strokes of one signature join into one area
            for dy in (-2, -1, 0, 1, 2):
                yy = y + dy
                if not 0 <= yy < H:
                    continue
                for dx in (-2, -1, 0, 1, 2):
                    xx = x + dx
                    if 0 <= xx < W:
                        j = yy * W + xx
                        if dark[j] and not seen[j]:
                            seen[j] = 1
                            stack.append(j)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if bw < INK_MIN[0] or bh < INK_MIN[1] or n / (bw * bh) < INK_MIN_FILL:
            continue
        if max_area is not None and bw * bh > max_area * W * H:
            continue
        box = [x0 * s, y0 * s, bw * s, bh * s]
        boxes.append((box, n / (bw * bh)) if with_fill else box)
    return boxes


# Unreadable regions: ink that no confidently read word explains. Handwriting, a signature, a stamp, or print too
# damaged to read; the page reader cannot tell them apart and never fills them in. The ink detection is
# ink_marks', with these differences:
# - Only words read with confidence UNREADABLE_CONF or more are blanked, so ink under Tesseract's low-confidence
#   guesses (it reads handwriting as garbage words) still counts.
# - Thin and grey strokes are kept (keep_thin, THIN_DARK): a 1 px line at grey 60 or a 2 px line at grey 100, as a
#   ballpoint pen writes, is found; ink_marks finds strokes of about 3 px only.
# - No upper size limit, since a handwritten paragraph is large; instead areas filled more than
#   UNREADABLE_MAX_FILL are left out: photos, barcodes, QR codes, logos and dark bands are near solid (0.8-1.0
#   at quarter size, tests/test_unreadable.py), handwriting is not (0.2-0.46), a stamp's rings even less (0.09).
# - Handwriting lines lower than INK_MIN (32 px, about 5 mm) that do not touch each other are not found.
UNREADABLE_CONF = 60  # page_index.LOW_CONF, the confidence below which every Tesseract error in the evaluation fell
UNREADABLE_MAX_WORDS = INK_MAX_WORDS  # more confident words inside the box: printed content, as in ink_marks
THIN_DARK = 160  # a pixel darker than this at quarter size is ink, once strokes were widened by a pixel
UNREADABLE_MAX_FILL = 0.6
# Widening the strokes also thickens print: a low-confidence printed word with its neighbour line, a page mark or
# a bracket then forms a small area. On the 43 calibration pages (2026-10-19) 21 such areas appeared, 40-120 px
# wide; a signature or a line of handwriting is wider than 160 px (27 mm). Initials or a single short handwritten
# word are below it and not found.
UNREADABLE_MIN_WIDTH = 160


def unreadable_regions(img, words: list[dict]) -> list[dict]:
    """Regions (150 dpi boxes) of ink with no confidently read word: {"b": [x, y, w, h], "reason"}, where reason
    is "low_conf" when a word Tesseract read below UNREADABLE_CONF overlaps it, else "no_text" (at most
    UNREADABLE_MAX_WORDS confident words, such as a printed name under a signature, may lie inside)."""
    sure = [w for w in words if w["c"] >= UNREADABLE_CONF]
    boxes = [b for b, fill in _ink_boxes(img, sure, None, keep_thin=True, with_fill=True)
             if fill <= UNREADABLE_MAX_FILL and sum(1 for w in sure if _within(w["b"], b)) <= UNREADABLE_MAX_WORDS]
    out = []
    for box in _join_lines(boxes):
        if box[2] < UNREADABLE_MIN_WIDTH:
            continue
        doubtful = any(_overlaps(w["b"], box) for w in words if w["c"] < UNREADABLE_CONF)
        out.append({"b": box, "reason": "low_conf" if doubtful else "no_text"})
    return out


UNREADABLE_JOIN = 24  # px at 150 dpi: the gap between two lines of handwriting; a printed line needs more room


def _join_lines(boxes: list[list[int]]) -> list[list[int]]:
    """Join boxes that overlap side to side and lie at most UNREADABLE_JOIN apart vertically: the lines of one
    handwritten note are one region for the doctor, not one per line."""
    boxes = [list(b) for b in boxes]
    joined = True
    while joined:
        joined = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                side = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
                gap = max(a[1], b[1]) - min(a[1] + a[3], b[1] + b[3])
                if side and gap <= UNREADABLE_JOIN:
                    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
                    boxes[i] = [x0, y0, max(a[0] + a[2], b[0] + b[2]) - x0, max(a[1] + a[3], b[1] + b[3]) - y0]
                    del boxes[j]
                    joined = True
                    break
            if joined:
                break
    return sorted(boxes, key=lambda b: (b[1], b[0]))


def _overlaps(b, box) -> bool:
    x, y, w, h = b
    return x < box[0] + box[2] and box[0] < x + w and y < box[1] + box[3] and box[1] < y + h


def _within(b, box) -> bool:
    x, y, w, h = b
    return box[0] <= x and box[1] <= y and x + w <= box[0] + box[2] and y + h <= box[1] + box[3]


def name_parts(names) -> set[str]:
    """Split known names into folded parts, so "Poláček Daniel" and "Daniel Poláček" are both found."""
    return {fold(part) for n in names if n for part in n.split() if len(part) > 2}


def apply(img, hits: list[dict]):
    """Draw a black box over every hit on a Pillow image (mode L); returns the same image."""
    draw = ImageDraw.Draw(img)
    for h in hits:
        x, y, w, hh = h["box"]
        draw.rectangle([x - PAD, y - PAD, x + w + PAD, y + hh + PAD], fill=0)
    return img
