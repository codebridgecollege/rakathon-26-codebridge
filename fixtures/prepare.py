# /// script
# requires-python = ">=3.11"
# ///
"""Prepare the demo data the Worker's seed and static files use, from the committed synthetic fixtures.

Usage:
    uv run fixtures/prepare.py

Writes `fixtures/ukazka/S<nn>-dokumenty.zip`, the documents of each intake demo patient as one ZIP that the
"Nový pacient" dialog links to (the Worker serves it at `/ukazka/`). The seed (`api/seed/seed.py`) imports
`page_index()` and `guidance()` from this file, so the D1 rows and R2 objects it writes come from one merge of
`fixtures/data/` (the fixture JSON) and `data/derived/page-index.json` (the page index).
"""

import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
DERIVED = HERE.parent / "data" / "derived"


def page_index() -> str:
    index = json.loads((DERIVED / "page-index.json").read_text())
    for name, doc in index.items():
        for page in doc["pages"]:
            # The source viewer shows the vision text and Tesseract's word boxes; the plain
            # Tesseract text is not shown, so it is left out of what the seed stores.
            page.pop("tess_text", None)
            # The redaction record holds only reasons and boxes, never the identifier values.
            folder = DERIVED / "pages" / Path(name).stem
            record = folder / f"p{page['n']}.redactions.json"
            if (folder / f"p{page['n']}.redacted.png").exists() and record.exists():
                reasons = [r["reason"] for r in json.loads(record.read_text())]
                page["redacted"] = {"image": f"pages/{folder.name}/p{page['n']}.redacted.png", "count": len(reasons), "reasons": sorted(set(reasons))}
    return json.dumps(index, ensure_ascii=False)


def guidance() -> str:
    """Merge the guideline and literature files into the one object `GET /api/cases/{case_id}/guidance` returns.

    The seed stores it in R2. PDFs are not bundled: the viewer opens each guideline online at the cited page.
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
    # Curated observations reference the existing case and guideline excerpts by ID.
    findings = json.loads((DATA / "deviations-case-10.json").read_text())
    out["deviation_case_file"] = findings["case_file"]
    out["deviation_findings"] = findings["findings"]
    return json.dumps(out, ensure_ascii=False)


def intake_zips() -> list[str]:
    """Pack each intake demo patient's upload folder (`samples/S<nn>_pacient/upload/`) into `fixtures/ukazka/S<nn>-dokumenty.zip`.

    The presenter, or a visitor of the demo, downloads it from the "Nový pacient" dialog and drops the files in. Fixed timestamps keep the ZIP byte-identical between builds, so it changes in git only when a file does.
    """
    written = []
    for case in sorted(DATA.glob("mock-case-S*.json")):
        if not json.loads(case.read_text()).get("intake_demo"):
            continue
        sid = case.stem.removeprefix("mock-case-")
        folder = HERE.parent / "samples" / f"{sid}_pacient" / "upload"
        target = HERE / "ukazka" / f"{sid}-dokumenty.zip"
        target.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(folder.iterdir()):
                if f.is_file():
                    z.writestr(zipfile.ZipInfo(f.name, date_time=(2026, 10, 17, 0, 0, 0)), f.read_bytes(), zipfile.ZIP_DEFLATED)
        written.append(str(target.relative_to(HERE.parent)))
    return written


def main() -> None:
    for z in intake_zips():
        print(f"wrote {z}")


if __name__ == "__main__":
    main()
