# /// script
# requires-python = ">=3.11"
# ///
"""Build the self-contained mock pages from their templates and data.

Usage:
    uv run mocks/build.py

Writes `mocks/v1.html` to `mocks/v4.html`. Each template has placeholders
(`/*CASE*/`, `/*LIST*/`, `/*EXTRA*/`, and in v4 `/*PAGES*/`) that are
replaced with the JSON files in `mocks/src/data/` and the page index in
`data/derived/page-index.json`, so the page needs no server.

Mock v4 shows the rendered page images in its source view. The page index
refers to them as `pages/<pdf stem>/p<n>.png`, so the build copies
`data/derived/pages/<pdf stem>/p<n>.png` to `mocks/pages/<pdf stem>/`, next
to the generated HTML. It also copies `p<n>.redacted.png` (written by
`scripts/redact_pages.py`), which the viewer shows on request as what would
be sent to a cloud model after local redaction. Publishing v4 means
publishing that folder with it. Mock v3's guideline layer reads the merged
guideline and literature files through an API stub and opens each guideline
PDF online at the cited page.
"""

import json
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "src" / "data"
DERIVED = HERE.parent / "data" / "derived"


def embed(text: str) -> str:
    # A literal "</" would close the <script> tag early, and the artifact host
    # rejects raw U+FFFD, which the OCR text contains; both are escaped as JSON.
    return text.replace("</", "<\\/").replace("�", "\\ufffd")


PAGE_IMAGE = re.compile(r"p\d+(\.redacted)?\.png")


def page_index() -> str:
    index = json.loads((DERIVED / "page-index.json").read_text())
    for name, doc in index.items():
        for page in doc["pages"]:
            # The viewer shows the vision text and Tesseract's word boxes; the plain
            # Tesseract text is not shown, so it is left out to keep the page small.
            page.pop("tess_text", None)
            # The redaction record holds only reasons and boxes, never the identifier values.
            folder = DERIVED / "pages" / Path(name).stem
            record = folder / f"p{page['n']}.redactions.json"
            if (folder / f"p{page['n']}.redacted.png").exists() and record.exists():
                reasons = [r["reason"] for r in json.loads(record.read_text())]
                page["redacted"] = {"image": f"pages/{folder.name}/p{page['n']}.redacted.png", "count": len(reasons), "reasons": sorted(set(reasons))}
    return json.dumps(index, ensure_ascii=False)


def copy_page_images() -> int:
    """Copy the page renders (and their redacted versions) next to the HTML, where the page index expects them."""
    count = 0
    for png in sorted((DERIVED / "pages").glob("*/*.png")):
        # Only the page images; anything else a script leaves in the folder stays out of the mock.
        if not PAGE_IMAGE.fullmatch(png.name):
            continue
        target = HERE / "pages" / png.parent.name / png.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(png, target)
        count += 1
    return count


def guidance() -> str:
    """Merge the guideline and literature files into the one response the mock's API stub returns.

    In a deployed app this is what `GET /api/cases/{case_id}/guidance` would return from the server; the
    mock embeds it because it is a single HTML file. PDFs are not bundled: the viewer opens each guideline
    online at the cited page.
    """
    out = {"guidelines": [], "statements": [], "pages": [], "not_retrieved": [], "literature": [], "queries": [], "past_statements": []}
    for name in ("guidelines-case-10.json", "guidelines-case-10-more.json"):
        f = DATA / name
        if f.exists():
            part = json.loads(f.read_text())
            for key in ("guidelines", "statements", "pages", "not_retrieved"):
                out[key] += part.get(key, [])
    # Statements about past decisions sit next to the oncology summary rows, not under the proposed management.
    out["past_statements"] = []
    past = DATA / "guidelines-case-10-past.json"
    if past.exists():
        part = json.loads(past.read_text())
        known = {g["id"] for g in out["guidelines"]}
        out["guidelines"] += [g for g in part.get("guidelines", []) if g["id"] not in known]
        out["past_statements"] = part.get("statements", [])
        out["pages"] += part.get("pages", [])
    # Several files may cite the same page; join their excerpts so the viewer finds every quote on it.
    merged = {}
    for pg in out["pages"]:
        key = (pg["guideline_id"], pg["pdf_page"])
        merged[key] = f"{merged[key]} […] {pg['text']}" if key in merged and pg["text"] not in merged[key] else merged.get(key, pg["text"])
    out["pages"] = [{"guideline_id": g, "pdf_page": n, "text": t} for (g, n), t in merged.items()]
    lit = DATA / "literature-case-10.json"
    if lit.exists():
        part = json.loads(lit.read_text())
        out["literature"] = part.get("articles", [])
        out["queries"] = part.get("queries", [])
    return json.dumps(out, ensure_ascii=False)


def main() -> None:
    parts = {
        "/*CASE*/": embed((DATA / "mock-case-10.json").read_text()),
        "/*LIST*/": embed((DATA / "mock-patient-list.json").read_text()),
        "/*EXTRA*/": embed((DATA / "mock-case-10-extra.json").read_text()),
        "/*PAGES*/": embed(page_index()),
        # Guideline statements for the guideline layer (mock v3); empty until the file exists.
        "/*GUIDE*/": embed(guidance()),
    }
    for version in ("v1", "v2", "v3", "v4"):
        page = (HERE / "src" / f"{version}-template.html").read_text()
        for key, value in parts.items():
            page = page.replace(key, value)
        (HERE / f"{version}.html").write_text(page)
        print(f"wrote mocks/{version}.html ({len(page)} bytes)")
    print(f"copied {copy_page_images()} page images to mocks/pages/")


if __name__ == "__main__":
    main()
