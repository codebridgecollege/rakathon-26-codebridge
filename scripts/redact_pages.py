# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["pillow==10.4.0"]
# ///
"""Black out direct identifiers on page images before they leave the hospital.

Usage:
    uv run scripts/redact_pages.py [--pages data/derived/pages] [--names mocks/src/data/mock-patient-list.json]

This is option B in docs/design/DATA-PROTECTION.md: everything here runs
locally. For each page it reads Tesseract's word boxes (`p<n>.tess.tsv`,
from scripts/ocr_pages.py), finds direct identifiers, and writes:
- `p<n>.redacted.png`: the 150 dpi page with black boxes over them,
- `p<n>.redactions.json`: what was blacked out and why (no identifier
  values are written, only the reason and the box).

What counts as a direct identifier here:
- the patient's name, from the consultation form or the case record;
- a birth number (Czech rodné číslo) or a date after "nar.";
- phone numbers and e-mail addresses;
- the value after a form label such as "Jméno", "Příjmení", "Rodné číslo",
  "Pojišťovna", "Adresa", "Telefon";
- doctors' names after "MUDr." (they identify the patient's care team).

Not removed, on purpose: examination dates, diagnoses, findings. They are
the medical content; they are also quasi-identifiers, which is why the
redacted page is still personal data.
"""

import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw

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
    """Group Tesseract's words into lines, keeping each word's box."""
    lines: dict[tuple, list[dict]] = {}
    with tsv.open(newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            if not text:
                continue
            key = (row["block_num"], row["par_num"], row["line_num"])
            box = [int(row[k]) * SCALE for k in ("left", "top", "width", "height")]
            lines.setdefault(key, []).append({"t": text, "b": box})
    return list(lines.values())


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
            elif i > 0 and fold(line[i - 1]["t"]) == "mudr":
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


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(args[args.index("--pages") + 1]) if "--pages" in args else Path("data/derived/pages")
    names_file = Path(args[args.index("--names") + 1]) if "--names" in args else Path("mocks/src/data/mock-patient-list.json")
    case_file = Path("mocks/src/data/mock-case-10.json")
    # Known patient names come from the form fields the app already holds; split into parts so
    # "Poláček Daniel" and "Daniel Poláček" are both found.
    known = [p.get("name") for p in json.loads(names_file.read_text())]
    known.append(json.loads(case_file.read_text())["patient"]["name"])
    names = {fold(part) for n in known if n for part in n.split() if len(part) > 2}
    total = 0
    for tsv in sorted(pages_dir.glob("*/p*.tess.tsv")):
        n = tsv.name.split(".")[0]
        png = tsv.with_name(f"{n}.png")
        hits = find(read_lines(tsv), names)
        img = Image.open(png).convert("L")
        draw = ImageDraw.Draw(img)
        for h in hits:
            x, y, w, hh = h["box"]
            draw.rectangle([x - PAD, y - PAD, x + w + PAD, y + hh + PAD], fill=0)
        img.save(tsv.with_name(f"{n}.redacted.png"))
        tsv.with_name(f"{n}.redactions.json").write_text(json.dumps(hits, ensure_ascii=False, indent=1))
        total += len(hits)
        print(f"{tsv.parent.name} {n}: {len(hits)} redactions ({', '.join(sorted({h['reason'] for h in hits})) or 'none'})")
    print(f"total {total}")


if __name__ == "__main__":
    main()
