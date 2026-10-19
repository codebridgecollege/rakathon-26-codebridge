"""Measure the live OCR path (render, Tesseract, text layer, readability, labs) on the synthetic calibration set, so
two Tesseract builds can be compared: the container's 5.3.0 (Debian bookworm) and a developer's local one.

    cd pipeline && uv run python measure_ocr.py --out ../measure-local.json        # local Tesseract
    (CI, .github/workflows/pipeline.yml, runs the same inside the container image and keeps the JSON as an artifact)
    uv run python measure_ocr.py --compare measure-local.json measure-container.json

Inputs are committed synthetic data only: FNO's ten challenge PDFs (data/rakathon-26) and our S01/S02
(samples/), 35 pages, the set the readability thresholds were calibrated on, plus S02's four lab sheet uploads.
The output holds counts, levels, confidences and pattern codes per page; never page text, so it can be shared.

Lab comparison against the hand-checked fixtures (fixtures/data/mock-case-S0*.json): every fixture point is
"same" (read as documented and equal), "verify" (marked unclear_ocr, the doctor checks it), "silent" (read as
documented but different: a failure, must stay 0) or "missing" (not found once on its page).
"""

import argparse
import json
import sys
from pathlib import Path

from page_reader import labs, layer, ocr, page_index as pi, readability as rd, render

REPO = Path(__file__).resolve().parents[1]
FNO = REPO / "data/rakathon-26/2_AI asistent MDT"
PDFS = sorted(FNO.glob("*_pacient.pdf"), key=lambda p: int(p.stem.split("_")[0])) + [
    REPO / "samples/S01_pacient/S01_pacient.pdf", REPO / "samples/S02_pacient/S02_pacient.pdf"]
S02_UPLOADS = {  # upload -> its page in the combined S02 PDF, where the fixture's sources point
    "04-laborator-2026-03-10.pdf": 5, "05-laborator-2026-06-02.pdf": 6,
    "06-laborator-2026-09-15.pdf": 7, "07-laborator-2026-10-06.pdf": 8,
}
S01_LAB_PAGES = [3, 4, 5, 7]


def read_pdf(data: bytes, doc_id: str) -> list[dict]:
    """The Workflow's path through /v1/pages and /v1/analyze for every page of one PDF."""
    doc = render.open_pdf(data)
    out = []
    for n, page in enumerate(doc, 1):
        text, tsv = ocr.ocr_png(render.png(page, render.OCR_DPI))
        words = pi.tess_words_text(tsv)
        layer_text = layer.page_text(page)
        rec = pi.tesseract_page(n, [0, 0], text, words, layer_text)
        a = rd.assess(n, words, text, rec["verify"], rec["second_reading"])
        out.append({"n": n, "doc_id": doc_id, "text": text, "layer_text": layer_text, "words": words,
                    "readability_level": a["level"], "verify": len(rec["verify"]), "metrics": a["metrics"]})
    return out


def page_summary(p: dict) -> dict:
    m = p["metrics"]
    return {"level": p["readability_level"], "words": m.get("word_count"), "mean_conf": m.get("mean_conf"),
            "low_conf_share": m.get("low_conf_share"), "verify": p["verify"], "verify_share": m.get("verify_share"),
            "damage": m.get("damage", {})}


def compare_labs(result: dict, mock: dict, page_of) -> dict:
    found: dict[tuple, list] = {}
    for t in result["tests"]:
        for p in t["points"]:
            if p:
                found.setdefault((t["code"], page_of(p["source"])), []).append(p)
    counts = {"same": 0, "verify": 0, "silent": 0, "missing": 0}
    # Which points were missing or silent, by test code and page only (a code is no patient data), so a difference
    # between two builds can be traced; and whether the parser listed a missing point's page as unparsed.
    unparsed_pages = {page_of({"page": u.get("n"), "doc_id": u.get("doc_id")}) for u in result.get("unparsed", [])}
    problems = []
    for t in mock["tests"]:
        for mp in t["points"]:
            got = found.get((t["code"], mp["source"]["page"]), [])
            if len(got) != 1:
                counts["missing"] += 1
                problems.append({"kind": "missing", "code": t["code"], "page": mp["source"]["page"], "found": len(got),
                                 "page_has_unparsed": mp["source"]["page"] in unparsed_pages})
            elif got[0]["certainty"] == "unclear_ocr":
                counts["verify"] += 1
            else:
                p = got[0]
                same = (p["value"] == mp["value"] and p["reference_range"] == t["reference_range"] and p["date"] == mp["date"]
                        and p["time"] == mp["time"] and (p["unit"] == t["unit"] or pi.same_unit(p["unit"], t["unit"])))
                counts["same" if same else "silent"] += 1
                if not same:
                    problems.append({"kind": "silent", "code": t["code"], "page": mp["source"]["page"]})
    counts["points"] = sum(counts.values())
    counts["problems"] = problems
    return counts


def mock(name: str) -> dict:
    return json.loads((REPO / f"fixtures/data/mock-case-{name}.json").read_text())["labs_series"]


def measure() -> dict:
    out: dict = {"versions": ocr.versions(), "pages": {}, "labs": {}}
    read: dict[str, list[dict]] = {}
    for pdf in PDFS:
        read[pdf.stem] = read_pdf(pdf.read_bytes(), pdf.stem)
        for p in read[pdf.stem]:
            out["pages"][f"{pdf.stem} p{p['n']}"] = page_summary(p)
        print(f"{pdf.stem}: {len(read[pdf.stem])} pages", file=sys.stderr)
    s01 = [p for p in read["S01_pacient"] if p["n"] in S01_LAB_PAGES]
    out["labs"]["S01 lab pages"] = compare_labs(labs.parse(s01), mock("S01"), lambda s: s["page"])
    ups = []
    for name, _ in S02_UPLOADS.items():
        ups += read_pdf((REPO / "samples/S02_pacient/upload" / name).read_bytes(), name)
    for p in ups:
        out["pages"][f"S02 upload {p['doc_id']}"] = page_summary(p)
    out["labs"]["S02 lab sheet uploads"] = compare_labs(labs.parse(ups), mock("S02"), lambda s: S02_UPLOADS[s["doc_id"]])
    levels: dict[str, int] = {}
    for k, v in out["pages"].items():
        if not k.startswith("S02 upload"):
            levels[v["level"]] = levels.get(v["level"], 0) + 1
    out["levels_35"] = levels
    return out


def compare(a: dict, b: dict) -> None:
    """A Markdown summary of two measurements (a: baseline, b: the other build)."""
    va, vb = a["versions"]["tesseract"], b["versions"]["tesseract"]
    print(f"| | {va} | {vb} |\n|---|---|---|")
    for k in sorted(set(a["levels_35"]) | set(b["levels_35"])):
        print(f"| pages {k} (of 35) | {a['levels_35'].get(k, 0)} | {b['levels_35'].get(k, 0)} |")
    for k in a["labs"]:
        print(f"| labs {k} same/verify/silent/missing | " + " | ".join(
            "{same}/{verify}/{silent}/{missing}".format(**x["labs"][k]) for x in (a, b)) + " |")
    for x in (a, b):
        for k, v in x["labs"].items():
            for p in v.get("problems", []):
                print(f"- {x['versions']['tesseract']}, {k}: {p}")
    sa = sum(v["verify"] for v in a["pages"].values())
    sb = sum(v["verify"] for v in b["pages"].values())
    print(f"| verify marks, all pages | {sa} | {sb} |")
    print("\nPages whose level differs:")
    for k in a["pages"]:
        pa, pb = a["pages"][k], b["pages"].get(k)
        if pb and pa["level"] != pb["level"]:
            print(f"- {k}: {pa['level']} -> {pb['level']} (mean conf {pa['mean_conf']} -> {pb['mean_conf']}, "
                  f"low share {pa['low_conf_share']} -> {pb['low_conf_share']}, damage {pa['damage']} -> {pb['damage']})")
    lows = sorted((v["mean_conf"] or 0, k) for k, v in b["pages"].items() if v["mean_conf"] is not None)[:3]
    highs = sorted(((v["low_conf_share"] or 0), k) for k, v in b["pages"].items())[-3:]
    print(f"\nLowest mean confidence ({vb}): {lows}\nHighest low-confidence share ({vb}): {highs}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--compare", nargs=2)
    args = ap.parse_args()
    if args.compare:
        compare(*(json.loads(Path(p).read_text()) for p in args.compare))
        return
    result = measure()
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text)
    print(json.dumps({"versions": result["versions"], "levels_35": result["levels_35"], "labs": result["labs"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
