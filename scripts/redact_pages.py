# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["pillow==10.4.0"]
# ///
"""Black out direct identifiers on page images before they leave the hospital.

Usage:
    uv run scripts/redact_pages.py [--pages data/derived/pages] [--names fixtures/data/mock-patient-list.json]

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
- doctors' names after "MUDr." and similar titles, also when the OCR glued
  the title to the name ("MUDr.Hofrová"); they identify the care team.

Not removed, on purpose: examination dates, diagnoses, findings. They are
the medical content; they are also quasi-identifiers, which is why the
redacted page is still personal data.
"""

import json
import sys
from pathlib import Path

from PIL import Image

# The logic lives in pipeline/pagekit, shared with the container and the tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from pagekit.redact import apply, find, name_parts, read_lines  # noqa: E402


def known_names(names_file: Path) -> set[str]:
    """Known patient names come from the form fields the app already holds."""
    case_file = Path("fixtures/data/mock-case-10.json")
    known = [p.get("name") for p in json.loads(names_file.read_text())]
    known.append(json.loads(case_file.read_text())["patient"]["name"])
    # Our synthetic patients (mock-case-S<nn>.json) are not in the patient list, so their names come from their case files.
    known += [json.loads(f.read_text())["list_entry"]["name"] for f in sorted(case_file.parent.glob("mock-case-S*.json"))]
    return name_parts(known)


def main() -> None:
    args = sys.argv[1:]
    pages_dir = Path(args[args.index("--pages") + 1]) if "--pages" in args else Path("data/derived/pages")
    names_file = Path(args[args.index("--names") + 1]) if "--names" in args else Path("fixtures/data/mock-patient-list.json")
    names = known_names(names_file)
    total = 0
    for tsv in sorted(pages_dir.glob("*/p*.tess.tsv")):
        n = tsv.name.split(".")[0]
        png = tsv.with_name(f"{n}.png")
        hits = find(read_lines(tsv), names)
        apply(Image.open(png).convert("L"), hits).save(tsv.with_name(f"{n}.redacted.png"))
        tsv.with_name(f"{n}.redactions.json").write_text(json.dumps(hits, ensure_ascii=False, indent=1))
        total += len(hits)
        print(f"{tsv.parent.name} {n}: {len(hits)} redactions ({', '.join(sorted({h['reason'] for h in hits})) or 'none'})")
    print(f"total {total}")


if __name__ == "__main__":
    main()
