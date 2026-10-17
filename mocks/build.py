# /// script
# requires-python = ">=3.11"
# ///
"""Build the self-contained mock pages from their templates and data.

Usage:
    uv run mocks/build.py

Writes `mocks/v1.html` to `mocks/v3.html`. Each template has placeholders
(`/*CASE*/`, `/*LIST*/`, `/*EXTRA*/`, and in v3 `/*PAGES*/` and `/*SYN*/`) that are
replaced with the JSON files in `mocks/src/data/` and the page index in
`data/derived/page-index.json`, so the page needs no server.

Mock v3 shows the rendered page images in their source view. The page index
refers to them as `pages/<pdf stem>/p<n>.png`, so the build copies
`data/derived/pages/<pdf stem>/p<n>.png` to `mocks/pages/<pdf stem>/`, next
to the generated HTML. It also copies `p<n>.redacted.png` (written by
`scripts/redact_pages.py`), which the viewer shows on request as what would
be sent to a cloud model after local redaction. Publishing v3 means
publishing that folder with it. Mock v3's guideline layer reads the merged
guideline and literature files through an API stub and opens each guideline
PDF online at the cited page. Retrospective deviations quote the guideline
edition valid on each decision's date (`guidelines-case-10-past-historic.json`).
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
    out = {"guidelines": [], "statements": [], "pages": [], "not_retrieved": [], "literature": [], "queries": [], "past_statements": [], "fact_refs": {}}
    for name in ("guidelines-case-10.json", "guidelines-case-10-more.json"):
        f = DATA / name
        if f.exists():
            part = json.loads(f.read_text())
            for key in ("guidelines", "statements", "pages", "not_retrieved"):
                out[key] += part.get(key, [])
    # Past decisions for the retrospective deviations. guidelines-case-10-past.json gives each decision's place in the
    # documentation (decision_cs, row_index, decision_ref); the guideline passage comes only from
    # guidelines-case-10-past-historic.json, which quotes the edition valid on the decision date. The past file's own
    # quotes cite the 2026 edition and are not used, so a past decision is never measured against a later edition.
    past = DATA / "guidelines-case-10-past.json"
    historic = DATA / "guidelines-case-10-past-historic.json"
    if past.exists():
        hist = json.loads(historic.read_text()) if historic.exists() else {"items": [], "editions": []}
        by_id = {it["id"]: it for it in hist.get("items", [])}
        known = {g["id"] for g in out["guidelines"]}
        for ed in hist.get("editions", []):
            if ed["id"] not in known:
                # Older editions of a guideline we already list share its type label (same publication, another year).
                same = next((g for g in out["guidelines"] if g["name"] == ed["name"]), {})
                out["guidelines"].append({**{k: ed[k] for k in ("id", "name", "society", "year", "version", "url", "pdf_url")}, "type_cs": same.get("type_cs", "")})
                known.add(ed["id"])
        for st in json.loads(past.read_text()).get("statements", []):
            row = {k: st[k] for k in ("id", "decision_cs", "row_index", "decision_ref") if k in st}
            it = by_id.get(st["id"])
            if not it:
                # No passage was looked up in the edition valid at the time: the item shows the decision without a quote.
                row["status"] = "not_checked"
            else:
                ed = it["edition"]
                row.update({
                    "guideline_id": ed["id"],
                    "edition": {k: ed.get(k) for k in ("name", "society", "year", "version", "valid_from", "valid_to", "url", "pdf_url")},
                    "decision_date": it.get("decision_date"),
                    "status": it.get("status", "found") if it.get("quote") else "not_found",
                    "quote": it.get("quote", ""),
                    "pdf_page": it.get("pdf_page"),
                    "printed_page": it.get("printed_page"),
                    "section": it.get("section", ""),
                    "evidence": it.get("evidence", ""),
                    "relation_cs": it.get("relation_cs", ""),
                    "additional_passages": it.get("additional_passages", []),
                })
                # The viewer highlights the quote in the page text; only the verified excerpts are kept, never whole pages.
                for q in [it] + it.get("additional_passages", []):
                    if q.get("quote") and q.get("pdf_page"):
                        out["pages"].append({"guideline_id": ed["id"], "pdf_page": q["pdf_page"], "text": q["quote"]})
            out["past_statements"].append(row)
    # Each patient fact a statement rests on gets its source passages (indexes into the case's refs), so the doctor
    # can open the documentation behind the "Proč" part of an entry.
    fact_refs = DATA / "guideline-fact-refs-case-10.json"
    if fact_refs.exists():
        out["fact_refs"] = json.loads(fact_refs.read_text()).get("facts", {})
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


def synthetic_cases() -> str:
    """The team's synthetic patients (`samples/S<nn>_pacient`), one `mock-case-S<nn>.json` each, as a JSON array.

    They are kept apart from the FNO patient list so mocks v1 and v2 stay as they were; mock v3 adds them to its
    patient database with their documents, data gaps and lab series.
    """
    return json.dumps([json.loads(f.read_text()) for f in sorted(DATA.glob("mock-case-S*.json"))], ensure_ascii=False)


def main() -> None:
    parts = {
        "/*CASE*/": embed((DATA / "mock-case-10.json").read_text()),
        "/*LIST*/": embed((DATA / "mock-patient-list.json").read_text()),
        "/*EXTRA*/": embed((DATA / "mock-case-10-extra.json").read_text()),
        "/*PAGES*/": embed(page_index()),
        "/*SYN*/": embed(synthetic_cases()),
        # Guideline statements for the guideline layer (mock v3); empty until the file exists.
        "/*GUIDE*/": embed(guidance()),
    }
    for version in ("v1", "v2", "v3"):
        page = (HERE / "src" / f"{version}-template.html").read_text()
        for key, value in parts.items():
            page = page.replace(key, value)
        (HERE / f"{version}.html").write_text(page)
        print(f"wrote mocks/{version}.html ({len(page)} bytes)")
    print(f"copied {copy_page_images()} page images to mocks/pages/")


if __name__ == "__main__":
    main()
