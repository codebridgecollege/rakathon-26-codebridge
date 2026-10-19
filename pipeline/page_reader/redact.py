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

from PIL import ImageDraw

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


def find(lines: list[list[dict]], names: set[str]) -> list[dict]:
    hits = []
    for line in lines:
        after_label = 0  # how many more tokens count as the value of the last form label
        for i, w in enumerate(line):
            f = fold(w["t"])
            near = i > 0 and w["b"][0] - (line[i - 1]["b"][0] + line[i - 1]["b"][2]) < MAX_GAP
            reason = None
            if LABEL_GLUED.match(f.replace(" ", "")):
                reason = "hodnota identifikačního pole"
            elif f in names:
                reason = "jméno pacienta"
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
