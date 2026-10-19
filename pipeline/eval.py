"""Evaluation: run the document pipeline over the sample cases and compare with their expected outputs.

Usage (from pipeline/):
    uv run python eval.py                      # report per case and per failure kind
    uv run python eval.py --check              # exit 1 on a failure not marked as known (CI)
    uv run python eval.py --case S03 --verbose # one case, every expectation with its outcome
    uv run python eval.py --json OUT.json      # the full result, for tooling
    uv run python eval.py --runs-out DIR       # also write the run each case produced

Why: every pipeline change that affects what the doctor sees is checked against synthetic cases for the
CLAUDE.md failure cases (a critical fact left out, a wrong date, a negation read as positive, two patients
mixed up, a missing report, a referral without a result, a poor scan). The expected outputs live in
samples/expected/<case>.json (format below); their README explains each case.

What runs: the deterministic page reader as the container runs it (page_index.tesseract_page, readability,
labs.parse), from the stored Tesseract output of each page (p<n>.tess.txt, p<n>.tess.tsv, p<n>.layer.txt).
OCR itself is not rerun, because its output depends on the local Tesseract version; the stored output is
the reference and is regenerated with scripts/ocr_pages.py. The page reader does not yet write the
extraction format (docs/design/EXTRACTION-FORMAT.md, codebridge.extraction/2), so `to_run` below maps its
output to a run in that format. When the pipeline writes runs itself, this adapter goes and the
comparison stays.

Outcomes per expectation:
- pass / fail;
- not_run: the expectation needs a check the producer does not run yet (an extraction step that looks for
  diagnoses, requests, identity...). The run's `checks` say what ran; everything else is not_run, so a
  gap in the pipeline never passes for a success;
- known_failure: it fails and the expected file says why (`known_failure`); --check tolerates it. If it
  passes, --check fails until the mark is removed, so the list of known failures stays true.

Expected file (`codebridge.eval-expected/1`):
    {"schema": ..., "case": "S03", "about": "...",
     "documents": [{"document_id": "S03_pacient", "pages_dir": "samples/derived/pages/S03_pacient"}],
     "reference_labs": "fixtures/data/mock-case-S01.json",   # optional: lab values of a prepared case
     "labs": [{"code", "page", "value", "unit", "date", "time"}],   # optional: lab values written out
     "lab_failure_kind": "poor_scan",              # failure kind of the lab points (default "reference")
     "expectations": [{"id", "failure_kind", "about", "expect": "present"|"absent",
                       "fact": {path: matcher} | "alert": {path: matcher}, "needs": [...], "known_failure": "..."}]}

A matcher is a value (equal), or {"in": [...]}, {"not_in": [...]}, {"regex": "..."}, {"ne": value}. Paths
are dotted ("value.value_numeric"); a list on the way matches when any element matches ("codes.code").
`source.<field>` matches against any of the fact's sources ("source.page", "source.quote"), and in an
alert, `fact.<path>` against any of the alert's facts ("fact.date.sort").

A lab point passes when the run has it exactly (clear, same value, unit, date and time), or marked for
checking (certainty verify or unreadable, including a lab-like line that did not parse and resembles the
code). It fails when it is missing, or when the run shows a different value as clear: a silent wrong value
is the failure that matters most. A clear lab value no expected point accounts for also fails.

Only synthetic data is read: samples/, data/derived (FNO's synthetic challenge patients) and fixtures/.
"""

import argparse
import difflib
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from page_reader import VERSION, labs, page_index, readability
from page_reader.page_index import same_unit

REPO = Path(__file__).resolve().parents[1]
EXPECTED_DIR = REPO / "samples/expected"
SCHEMA = "codebridge.eval-expected/1"

FAILURE_KINDS = (
    "critical_fact_left_out", "wrong_date", "negation_read_as_positive", "patients_mixed_up",
    "report_missing", "request_without_result", "poor_scan", "reference",
)
# What each looks_for of the adapter's checks covers. An alert kind maps to the check that raises it.
ALERT_NEEDS = {"poor_copy": "readability", "missing": "original_report", "identity": "identity",
               "contradiction": "contradiction", "chronology": "chronology", "unclear": "unclear"}
MARKED = ("verify", "unreadable")
SIMILAR_CODE = 0.75  # "S_GREAE" for S_CREAE (0.86), "S K" for S_K; different tests stay apart ("S_NA" vs "S_K": 0.5)


# ---------- the producer: today's page reader, mapped to codebridge.extraction/2 ----------

def _pages(pages_dir: Path) -> list[int]:
    return sorted(int(m.group(1)) for p in pages_dir.glob("p*.tess.txt") if (m := re.fullmatch(r"p(\d+)\.tess\.txt", p.name)))


def _number(text: str | None) -> float | None:
    try:
        return float(text.replace(",", ".")) if text else None
    except ValueError:
        return None


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def read_document(document_id: str, pages_dir: Path) -> dict:
    """Readability and labs of one document, exactly as the container's /v1/analyze and /v1/labs compute them."""
    analysed, lab_pages = [], []
    for n in _pages(pages_dir):
        text = (pages_dir / f"p{n}.tess.txt").read_text()
        layer = (pages_dir / f"p{n}.layer.txt").read_text() if (pages_dir / f"p{n}.layer.txt").exists() else ""
        words = page_index.tess_words(pages_dir / f"p{n}.tess.tsv")
        rec = page_index.tesseract_page(n, [0, 0], text, words, layer)
        rd = readability.assess(n, rec["words"], rec["text"], rec["verify"], rec["second_reading"])
        analysed.append({"n": n, **rd})
        lab_pages.append({"n": n, "text": text, "layer_text": layer, "words": words, "readability_level": rd["level"]})
    return {"document_id": document_id, "pages": analysed, "readability": readability.document(analysed),
            "labs": labs.parse(lab_pages, doc_id=document_id), "texts": {p["n"]: p["text"] for p in lab_pages}}


def to_run(case_id: str, docs: list[dict]) -> dict:
    """A codebridge.extraction/2 run from the page reader's output: lab_result facts, poor_copy alerts, and
    checks that say only labs and readability were looked at."""
    sources, facts, alerts = [], [], []

    def source(doc_id: str, page: int, quote: str, quote_text: str, text: str | None, start=None, end=None) -> str:
        sid = f"src-{len(sources) + 1:04d}"
        anchor = ({"page_text_sha256": _sha(text), "engine": "tesseract", "char_range": [start, end]}
                  if text is not None and start is not None else None)
        sources.append({"id": sid, "type": "document", "document_id": doc_id, "part": None, "page": page,
                        "quote": quote, "quote_text": quote_text, "anchor": anchor, "reported_as": "original",
                        "identity": "cannot_verify"})
        return sid

    for doc in docs:
        did, lab = doc["document_id"], doc["labs"]
        for t in lab["tests"]:
            for p in t["points"]:
                if not p:
                    continue
                src = p["source"]
                drawn = f"{p['date']} {p['time']}" if p["time"] else p["date"]
                verify = p["certainty"] != "documented"
                facts.append({
                    "id": f"f-{len(facts) + 1:04d}",
                    "key": f"lab_result|{t['code']}|draw:{drawn or 'undated'}|doc:{did}",
                    "kind": "lab_result", "subject": "patient",
                    "value": {
                        "name_as_written": p["code_as_written"], "value_as_written": p["value"],
                        "value_numeric": _number(p["value"]), "unit_as_written": p["unit"], "unit": p["unit"],
                        "reference_range": p["reference_range"], "reference_low": t["reference_low"],
                        "reference_high": t["reference_high"], "out_of_range": p["out_of_range"],
                        "out_of_range_origin": "assistant",
                        "draw": {"as_written": drawn, "requisition": None, "specimen": None},
                    },
                    "date": {"as_written": drawn, "precision": ("minute" if p["time"] else "day") if p["date"] else None,
                             "sort": p["date"]},
                    "status": "documented", "negated": False, "not_stated": [] if p["date"] else ["draw"],
                    "origin": "document", "certainty": "verify" if verify else "clear",
                    "certainty_reason": {"code": p["verify_reasons"][0], "text": ", ".join(p["verify_reasons"])} if verify else None,
                    "codes": [{"system": "fno-local-lab", "code": t["code"], "assigned_by": "source"}],
                    "note": None, "quarantined": False,
                    "sources": [source(did, src["page"], src["quote"], "tesseract", doc["texts"].get(src["page"]),
                                       src["start"], src["end"])],
                })
        # A lab-like line that did not parse is an unreadable fact: listed, never dropped, never filled in.
        for u in lab["unparsed"]:
            if u["reason"] == "draw_date_not_parsed":
                continue  # a date line, not a result; the draw itself already carries the unreadable date
            second = u.get("in")
            text = doc["texts"].get(u["n"], "")
            quote = u["quote"] if second else text[u["start"]:u["end"]]
            facts.append({
                "id": f"f-{len(facts) + 1:04d}", "key": f"lab_result|unreadable|doc:{did}|p{u['n']}|line:{u['line_no']}",
                "kind": "lab_result", "subject": "patient", "value": None,
                "date": {"as_written": None, "precision": None, "sort": None},
                "status": "documented", "negated": False, "not_stated": [], "origin": "document",
                "certainty": "unreadable", "certainty_reason": {"code": u["reason"], "text": u["reason_cs"]},
                "codes": [], "note": None, "quarantined": False,
                "sources": [source(did, u["n"], quote, "pdf_text" if second else "tesseract", None if second else text,
                                   None if second else u["start"], None if second else u["end"])],
            })
        rd = doc["readability"]
        if rd["level"] in ("poor", "empty"):
            alerts.append({"id": f"al-poor-copy-{did}", "rule": "poor_copy", "subject": did, "kind": "poor_copy",
                           "facts": [], "message": {"id": "alert-poor-copy", "args": {"document": did}},
                           "note": "; ".join(rd["reasons_cs"])})

    covered = [{"document_id": d["document_id"], "part": None} for d in docs]
    checks = [
        {"id": "chk-lab_result", "looks_for": "lab_result", "expected": None, "covered": covered, "unreadable": [],
         "result": "found" if any(f["kind"] == "lab_result" for f in facts) else "nothing_found"},
        {"id": "chk-readability", "looks_for": "readability", "expected": None, "covered": covered, "unreadable": [],
         "result": "found" if alerts else "nothing_found"},
    ]
    return {
        "schema": "codebridge.extraction/2", "case_id": case_id, "content_language": "cs",
        "run": {"id": f"run-eval-{case_id}", "producer": "pipeline",
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "stages": [{"name": "ocr", "engine": "tesseract (stored output)"},
                           {"name": "page_reader", "engine": f"page-reader {VERSION}"}],
                "supersedes": None},
        "documents": [{"document_id": d["document_id"], "sha256": None, "parts": []} for d in docs],
        "sources": sources, "facts": facts, "checks": checks, "alerts": alerts,
        "brief": None, "question_draft": None,
        # Not part of the format: the page levels, so the report can show why a document is poor.
        "_readability": {d["document_id"]: d["readability"] for d in docs},
    }


# ---------- matching ----------

def _resolve(obj, path: list[str]) -> list:
    """Every value at the dotted path; a list on the way fans out."""
    if not path:
        return obj if isinstance(obj, list) else [obj]
    if isinstance(obj, list):
        return [v for o in obj for v in _resolve(o, path)]
    if not isinstance(obj, dict) or path[0] not in obj:
        return []
    return _resolve(obj[path[0]], path[1:])


def _one(matcher, value) -> bool:
    if isinstance(matcher, dict):
        if "in" in matcher:
            return value in matcher["in"]
        if "not_in" in matcher:
            return value not in matcher["not_in"]
        if "ne" in matcher:
            return value != matcher["ne"]
        if "regex" in matcher:
            return isinstance(value, str) and re.search(matcher["regex"], value) is not None
        raise ValueError(f"unknown matcher {matcher}")
    return value == matcher


def matches(item: dict, fragment: dict, sources: dict, facts: dict | None = None) -> bool:
    for path, matcher in fragment.items():
        parts = path.split(".")
        if parts[0] == "source":
            values = [v for sid in item.get("sources", []) for v in _resolve(sources.get(sid, {}), parts[1:])]
        elif parts[0] == "fact" and facts is not None:  # an alert's facts ("fact.kind", "fact.date.sort")
            values = [v for fid in item.get("facts", []) for v in _resolve(facts.get(fid, {}), parts[1:])]
        else:
            values = _resolve(item, parts)
        # A missing field compares as None, so {"date.sort": null} and {"not_in": [...]} mean what they say.
        if not any(_one(matcher, v) for v in (values or [None])):
            return False
    return True


def needs_of(e: dict) -> list[str]:
    if "needs" in e:
        return e["needs"]
    if "fact" in e:
        return [e["fact"].get("kind", "any_fact")]
    return [ALERT_NEEDS.get(e["alert"].get("kind"), str(e["alert"].get("kind")))]


def judge(e: dict, run: dict) -> tuple[str, str]:
    """(outcome, detail) of one written expectation."""
    ran = {c["looks_for"] for c in run["checks"] if c["result"] != "not_run"}
    missing = [n for n in needs_of(e) if n not in ran]
    if missing:
        return "not_run", "needs " + ", ".join(missing)
    sources = {s["id"]: s for s in run["sources"]}
    if "fact" in e:
        hits = [f["id"] for f in run["facts"] if matches(f, e["fact"], sources)]
    else:
        facts = {f["id"]: f for f in run["facts"]}
        hits = [a["id"] for a in run["alerts"] if matches(a, e["alert"], sources, facts)]
    ok = bool(hits) if e["expect"] == "present" else not hits
    detail = f"{len(hits)} match" + ("" if len(hits) == 1 else "es") + (f": {', '.join(hits[:5])}" if hits else "")
    return ("pass" if ok else "fail"), detail


def _code_like(a: str, b: str) -> bool:
    fa, fb = re.sub(r"[^A-Z0-9]", "", a.upper()), re.sub(r"[^A-Z0-9]", "", b.upper())
    return fa == fb or difflib.SequenceMatcher(None, fa, fb).ratio() >= SIMILAR_CODE


def _leading_code(quote: str) -> str:
    """The code-like start of a line that did not parse: everything before the first digit or colon
    ("B „LKC: 8,24 ..." gives "B „LKC", "- S NA: 139 ..." gives "S NA")."""
    m = re.match(r"\W*([^\d:]+)", quote)
    return m.group(1).strip() if m else ""


def judge_lab(p: dict, run: dict) -> tuple[str, str]:
    """(outcome, detail) of one expected lab point: exact, marked, wrong (clear but different) or missing."""
    sources = {s["id"]: s for s in run["sources"]}
    on_page = [f for f in run["facts"] if f["kind"] == "lab_result"
               and any(sources[s]["page"] == p["page"] for s in f["sources"])]
    same = [f for f in on_page if f["codes"] and f["codes"][0]["code"] == p["code"]]
    if not same:  # a misread code ("S_GREAE") or a line that did not parse
        same = [f for f in on_page if (f["codes"] and _code_like(f["codes"][0]["code"], p["code"]))
                or (f["certainty"] == "unreadable" and _code_like(_leading_code(sources[f["sources"][0]]["quote"]), p["code"]))]
    if not same:
        return "missing", f"{p['code']} p{p['page']}: not in the run"
    f = same[0]
    if f["certainty"] in MARKED:
        return "marked", f"{p['code']} p{p['page']}: {f['certainty']} ({(f['certainty_reason'] or {}).get('code')})"
    v = f["value"]
    got = (v["value_as_written"], f["date"]["sort"], (f["date"]["as_written"] or "")[11:] or None)
    want = (p["value"], p.get("date"), p.get("time"))
    unit_ok = v["unit"] == p["unit"] or same_unit(v["unit"], p["unit"])
    if got == want and unit_ok:
        return "exact", f"{p['code']} p{p['page']}: {p['value']}"
    return "wrong", f"{p['code']} p{p['page']}: shown clear as {got[0]} {v['unit']} {got[1]} {got[2]}, document {want[0]} {p['unit']} {want[1]} {want[2]}"


def truth_pages(pages_dir: Path) -> dict[int, str]:
    """What each page really says: p<n>.truth.md for a sample we degraded ourselves (S03), else the
    p<n>.vision.md that stands for the page's text (written by us for S01/S02/S04, the reviewed vision
    reading for FNO's patients)."""
    out = {}
    for n in _pages(pages_dir):
        for name in (f"p{n}.truth.md", f"p{n}.vision.md"):
            if (pages_dir / name).exists():
                out[n] = (pages_dir / name).read_text()
                break
    return out


def reference_points(path: Path) -> list[dict]:
    """Lab points of a prepared case (fixtures/data/mock-case-*.json), the human-checked reference."""
    data = json.loads(path.read_text())
    if "labs_series" in data:
        return [{"code": t["code"], "page": pt["source"]["page"], "value": pt["value"], "unit": t["unit"],
                 "date": pt["date"], "time": pt["time"]}
                for t in data["labs_series"]["tests"] for pt in t["points"] if pt]
    return [{"code": x["code"], "page": x["source"]["page"], "value": x["value"], "unit": x["unit"],
             "date": x["date"], "time": None} for x in data["labs"]]


# ---------- the evaluation ----------

def load_expected(path: Path) -> dict:
    spec = json.loads(path.read_text())
    if spec.get("schema") != SCHEMA:
        raise SystemExit(f"{path.name}: schema must be {SCHEMA}")
    ids = [e["id"] for e in spec["expectations"]]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{path.name}: duplicate expectation ids")
    for e in spec["expectations"]:
        if e["failure_kind"] not in FAILURE_KINDS:
            raise SystemExit(f"{path.name} {e['id']}: unknown failure kind {e['failure_kind']}")
        if e["expect"] not in ("present", "absent") or ("fact" in e) == ("alert" in e):
            raise SystemExit(f"{path.name} {e['id']}: needs expect present/absent and one of fact, alert")
    if spec.get("lab_failure_kind", "reference") not in FAILURE_KINDS:
        raise SystemExit(f"{path.name}: unknown lab_failure_kind")
    return spec


def _final(outcome: str, e: dict) -> str:
    if e.get("known_failure"):
        return "known_failure" if outcome == "fail" else "fixed_known_failure" if outcome == "pass" else outcome
    return outcome


def evaluate_case(spec: dict) -> dict:
    docs = [read_document(d["document_id"], REPO / d["pages_dir"]) for d in spec["documents"]]
    run = to_run(spec["case"], docs)
    results = []
    for e in spec["expectations"]:
        outcome, detail = judge(e, run)
        results.append({"id": e["id"], "failure_kind": e["failure_kind"], "about": e["about"],
                        "outcome": _final(outcome, e), "detail": detail, "known_failure": e.get("known_failure")})
    points = list(spec.get("labs", []))
    if spec.get("reference_labs"):
        points += reference_points(REPO / spec["reference_labs"])
    kind = spec.get("lab_failure_kind", "reference")
    known = spec.get("lab_known_failures", {})  # "<code> p<page>" -> why
    stale = set(known) - {f"{p['code']} p{p['page']}" for p in points}
    if stale:
        raise SystemExit(f"{spec['case']}: lab_known_failures name no expected lab point: {sorted(stale)}")
    lab_outcomes = {"exact": 0, "marked": 0, "wrong": 0, "missing": 0}
    accounted = set()
    for p in points:
        o, detail = judge_lab(p, run)
        lab_outcomes[o] += 1
        label = f"{p['code']} p{p['page']}"
        e = {"known_failure": known.get(label)}
        results.append({"id": f"{spec['case']}-lab-{label}-{p.get('date') or 'undated'}", "failure_kind": kind,
                        "about": f"lab value {label} {p['value']} {p['unit']}",
                        "outcome": _final("pass" if o in ("exact", "marked") else "fail", e),
                        "detail": f"{o}: {detail}", "known_failure": e["known_failure"]})
        accounted.add((p["page"], p["code"], p["value"]))
    if points:
        # A clear lab value no expected point accounts for is a value the doctor would see without a check.
        # It is fine when the page's true text holds it ("CODE: value"): a prepared case may list only some of
        # a sheet's values (case 10 lists 26 of page 3's).
        sources = {s["id"]: s for s in run["sources"]}
        truth = {(d["document_id"], n): text for d in spec["documents"] for n, text in truth_pages(REPO / d["pages_dir"]).items()}

        def on_truth_page(f: dict) -> bool:
            src = sources[f["sources"][0]]
            text = re.sub(r"\*\*", "", truth.get((src["document_id"], src["page"]), ""))
            return f"{f['codes'][0]['code']}: {f['value']['value_as_written']} " in text

        extra = [f for f in run["facts"] if f["kind"] == "lab_result" and f["certainty"] == "clear"
                 and (sources[f["sources"][0]]["page"], f["codes"][0]["code"], f["value"]["value_as_written"]) not in accounted
                 and not on_truth_page(f)]
        results.append({"id": f"{spec['case']}-lab-no-unexpected-clear-values", "failure_kind": kind,
                        "about": "no clear lab value that the documents do not hold", "known_failure": None,
                        "outcome": "pass" if not extra else "fail",
                        "detail": f"{len(extra)} unexpected" + ("" if not extra else ": " + ", ".join(
                            f"{f['codes'][0]['code']} {f['value']['value_as_written']} p{sources[f['sources'][0]]['page']}" for f in extra[:5]))})
    return {"case": spec["case"], "about": spec.get("about", ""), "results": results, "labs": lab_outcomes,
            "readability": run.pop("_readability"), "run": run}


def summarize(cases: list[dict]) -> dict:
    keys = ("pass", "fail", "known_failure", "fixed_known_failure", "not_run")
    per_case = {c["case"]: {k: sum(r["outcome"] == k for r in c["results"]) for k in keys} for c in cases}
    per_kind = {k: {o: 0 for o in keys} for k in FAILURE_KINDS}
    for c in cases:
        for r in c["results"]:
            per_kind[r["failure_kind"]][r["outcome"]] += 1
    return {"per_case": per_case, "per_kind": per_kind}


def _table(title: str, rows: dict) -> str:
    cols = ("pass", "fail", "known_failure", "fixed_known_failure", "not_run")
    head = f"{title:<26}" + "".join(f"{c:>21}" for c in cols)
    lines = [head, "-" * len(head)]
    lines += [f"{name:<26}" + "".join(f"{row[c]:>21}" for c in cols) for name, row in rows.items()]
    return "\n".join(lines)


def report(cases: list[dict], summary: dict, verbose: bool) -> str:
    out = []
    for c in cases:
        out.append(f"\n== {c['case']}: {c['about']}")
        for did, rd in c["readability"].items():
            out.append(f"   readability {did}: {rd['level']}")
        lo = c["labs"]
        if sum(lo.values()):
            out.append(f"   lab points: {sum(lo.values())} expected, {lo['exact']} exact, {lo['marked']} marked for checking, "
                       f"{lo['wrong']} shown clear but wrong, {lo['missing']} missing")
        for r in c["results"]:
            if verbose or r["outcome"] != "pass":
                why = f"  [known: {r['known_failure']}]" if r["known_failure"] else ""
                out.append(f"   {r['outcome']:<20} {r['id']}: {r['about']} ({r['detail']}){why}")
    out.append("\n" + _table("case", summary["per_case"]))
    out.append("\n" + _table("failure kind", summary["per_kind"]))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--case", action="append", help="only these cases (repeatable)")
    ap.add_argument("--check", action="store_true", help="exit 1 on a failure not marked as known, or a known failure that passes")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--json", help="write the full result here")
    ap.add_argument("--runs-out", help="write each case's run (codebridge.extraction/2) to this folder")
    a = ap.parse_args(argv)
    specs = [load_expected(p) for p in sorted(EXPECTED_DIR.glob("*.json"))]
    if a.case:
        specs = [s for s in specs if s["case"] in a.case]
    cases = [evaluate_case(s) for s in specs]
    summary = summarize(cases)
    print(report(cases, summary, a.verbose))
    if a.runs_out:
        Path(a.runs_out).mkdir(parents=True, exist_ok=True)
        for c in cases:
            (Path(a.runs_out) / f"{c['case']}.run.json").write_text(json.dumps(c["run"], ensure_ascii=False, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps({"summary": summary, "cases": [{k: v for k, v in c.items() if k != "run"} for c in cases]},
                                           ensure_ascii=False, indent=1))
    bad = sum(r["fail"] + r["fixed_known_failure"] for r in summary["per_case"].values())
    if a.check and bad:
        print(f"\n{bad} unexpected outcome(s): a new failure, or a known failure that now passes (remove its mark).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
