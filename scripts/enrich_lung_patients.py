#!/usr/bin/env python3
"""Fuller fictional documentation for the ten lung patients of hospital A, so every tab has something to show: an outpatient
report with all anamnesis sections, findings, and a lab sheet with two draws in the hospital's printout format. The new
documents go through the real pipeline and the AI model; each patient's older one-page report is withdrawn, kept as a row.

    python scripts/enrich_lung_patients.py --print-only      # write the PDFs and the SQL, change nothing
    python scripts/enrich_lung_patients.py --only NO-101     # one patient
    python scripts/enrich_lung_patients.py                   # all
    python scripts/enrich_lung_patients.py --rerun r2        # read the current documents again
"""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "samples/C_plicni"))
from add_lung_org import BUCKET, insert, lit, render_text  # noqa: E402
from add_lung_org import birth_number  # noqa: E402
from patients import EXTRA, LAB_BASE, PATIENTS  # noqa: E402

ORG = "demo-a"
AT = "2026-11-06T12:00:00.000Z"
OUT = ROOT / "api/seed/out/lung-a"
BY = "c-d1p1"


def identity(p: dict, rc: str) -> str:
    return f"{p['last']} {p['first']}, nar. {p['birth']}, r.č. {rc}, poj. 111"


def report(p: dict, e: dict, rc: str) -> str:
    return (f"Plicní ambulance - pneumoonkologie, Ukázková nemocnice A\n\nAmbulantní vyšetření\n\n{identity(p, rc)}\nDatum vyšetření: 12.10.2026\nOdesílá: {p['dept']}\n\n{p['body']}\n"
            f"Anamnéza:\nRA: {e['ra']}\nPA: {e['pa']}\nSA: {e['sa']}\nAA: {e['aa']}\nAbusus: {e['abusus']}\nEA: {e['ea']}\nPreventivní prohlídky: {e['prev']}\n\n"
            f"Objektivně: {e['obj']}\n\nOtázka pro MDT: {p['question']}\n\nMUDr. Bednář, plicní ambulance\n")


def lab_sheet(p: dict, e: dict, rc: str, draw: int) -> str:
    lines = [f"Laboratoř klinické biochemie a hematologie\n\nVýsledky laboratorních vyšetření\n\n{identity(p, rc)}\nŽádající: plicní ambulance\nOdběr: {e['draws'][draw]}\nPrimární vzorek: krev, sérum\n"]
    for section, tests in LAB_BASE:
        lines.append(f"{section}:")
        for code, unit, low, high, first, second in tests:
            value = e["labs"].get(code, (first, second))[draw]
            lines.append(f"{code}: {value} {unit} [{low} ... {high}]")
    return "\n".join(lines) + "\n\nUvolnila: Mgr. Rybízková, klinická biochemička\n"


def findings(p: dict, rc: str) -> str:
    keep = [ln for ln in p["body"].splitlines() if ln.startswith(("Histologie", "CT", "PET", "MR", "Funkční", "Bronchoskopie", "Pravostranná", "Konkomitantní"))]
    return (f"Komplement zobrazovacích a histologických nálezů\n\n{identity(p, rc)}\n\n" + "\n\n".join(keep) + "\n\nOpis nálezů z nemocničního systému.\n")


def build(only: str | None):
    sql, objects, runs = [], [], []
    for i, p in enumerate(PATIENTS, 1):
        case = f"NO-{100 + i}"
        if only and only != case:
            continue
        e = EXTRA[p["no"]]
        rc = birth_number(p["birth"], p["sex"], i)
        # The earlier one-page report leaves the case; its row and reason stay.
        sql.append(f"UPDATE documents SET lifecycle = 'withdrawn', lifecycle_reason_cs = 'nahrazeno úplnější dokumentací', lifecycle_changed_at = {lit(AT)}, lifecycle_changed_by = {lit(BY)} WHERE org_id = {lit(ORG)} AND id = {lit(f'up-a-{i:02d}')} AND lifecycle = 'current';")
        docs = [("zprava", f"{p['no']}-ambulantni-zprava-uplna.pdf", report(p, e, rc)), ("nalezy", f"{p['no']}-nalezy.pdf", findings(p, rc)),
                ("lab1", f"{p['no']}-laborator-1.pdf", lab_sheet(p, e, rc, 0)), ("lab2", f"{p['no']}-laborator-2.pdf", lab_sheet(p, e, rc, 1))]
        for tag, name, text in docs:
            pdf = render_text(text)
            sha = hashlib.sha256(pdf).hexdigest()
            doc, run = f"up-b-{i:02d}-{tag}", f"pl-b-{i:02d}-{tag}"
            key = f"org/{ORG}/uploads/{case}/{doc}.pdf"
            objects.append({"key": key, "body": pdf, "file": OUT / f"{doc}.pdf"})
            sql.append(insert("documents", {"id": doc, "org_id": ORG, "case_id": case, "file_name": name, "media_type": "application/pdf", "page_count": 0, "original_r2_key": key, "sha256": sha,
                                            "size_bytes": len(pdf), "origin": "upload", "processing": "unprocessed", "uploaded_by": BY, "created_at": AT, "state": "queued"}))
            sql.append(insert("pipeline_runs", {"org_id": ORG, "id": run, "document_id": doc, "case_id": case, "state": "queued", "pipeline_version": "enrich_lung", "input_sha256": sha,
                                                "output_prefix": f"org/{ORG}/uploads/{case}/{doc}/{run}/", "created_by": BY, "created_by_name": "Bednář", "created_at": AT, "updated_at": AT}))
            runs.append({"id": run, "params": {"org": ORG, "runId": run, "docId": doc, "caseId": case}})
    return sql, objects, runs


def rerun(tag: str) -> None:
    """Reads the current documents of the lung patients again, for example after the model changed. Their rows stay."""
    api = ROOT / "api"
    query = "SELECT p.id, p.document_id, p.case_id FROM pipeline_runs p JOIN documents d ON d.id = p.document_id AND d.org_id = p.org_id WHERE p.org_id = 'demo-a' AND p.id LIKE 'pl-b-%' AND p.id NOT LIKE '%-r%' AND d.lifecycle = 'current'"
    out = subprocess.run(["npx", "wrangler", "d1", "execute", "codebridge-mdt", "--remote", "--json", "--command", query], cwd=api, check=True, capture_output=True, text=True).stdout
    rows = json.loads(out)[0]["results"]
    # A run counts only when no finished run of its document is newer, so it must sort after every earlier one, whatever
    # time those were stamped with.
    last = subprocess.run(["npx", "wrangler", "d1", "execute", "codebridge-mdt", "--remote", "--json", "--command", "SELECT MAX(created_at) m FROM pipeline_runs WHERE org_id = 'demo-a' AND id LIKE 'pl-b-%'"], cwd=api, check=True, capture_output=True, text=True).stdout
    newest = datetime.fromisoformat(json.loads(last)[0]["results"][0]["m"].replace("Z", "+00:00"))
    at = (max(newest, datetime.now(timezone.utc)) + timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    sql = []
    for r in rows:
        run = f"{r['id']}-{tag}"
        sql.append(f"INSERT OR IGNORE INTO pipeline_runs (org_id, id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at) SELECT org_id, {lit(run)}, document_id, case_id, 'queued', 'enrich_lung_rerun', input_sha256, {lit(f'org/{ORG}/uploads/{r['case_id']}/{r['document_id']}/{run}/')}, created_by, created_by_name, {lit(at)}, {lit(at)} FROM pipeline_runs WHERE id = {lit(r['id'])};")
        sql.append(f"UPDATE documents SET state = 'queued', state_detail_cs = NULL WHERE org_id = {lit(ORG)} AND id = {lit(r['document_id'])};")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "rerun.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    subprocess.run(["npx", "wrangler", "d1", "execute", "codebridge-mdt", "--remote", "--yes", "--file", str(OUT / "rerun.sql")], cwd=api, check=True, capture_output=True, text=True)
    started = 0
    for r in rows:
        run = f"{r['id']}-{tag}"
        done = subprocess.run(["npx", "wrangler", "workflows", "trigger", "codebridge-process-document", json.dumps({"org": ORG, "runId": run, "docId": r["document_id"], "caseId": r["case_id"]}), "--id", run], cwd=api, capture_output=True, text=True)
        started += done.returncode == 0
    print(f"started {started} of {len(rows)}")


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("--print-only", action="store_true")
    a.add_argument("--only")
    a.add_argument("--rerun", help="read the current documents again, under this run suffix, for example r2")
    args = a.parse_args()
    if args.rerun:
        rerun(args.rerun)
        return
    sql, objects, runs = build(args.only)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "lung-a.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    for o in objects:
        o["file"].write_bytes(o["body"])
    print(f"{len(sql)} statements, {len(objects)} PDFs in {OUT}")
    if args.print_only:
        return
    api = ROOT / "api"
    for o in objects:
        subprocess.run(["npx", "wrangler", "r2", "object", "put", f"{BUCKET}/{o['key']}", "--file", str(o["file"]), "--content-type", "application/pdf", "--remote", "--jurisdiction", "eu"], cwd=api, check=True, capture_output=True, text=True)
    subprocess.run(["npx", "wrangler", "d1", "execute", "codebridge-mdt", "--remote", "--yes", "--file", str(OUT / "lung-a.sql")], cwd=api, check=True, capture_output=True, text=True)
    for r in runs:
        done = subprocess.run(["npx", "wrangler", "workflows", "trigger", "codebridge-process-document", json.dumps(r["params"]), "--id", r["id"]], cwd=api, capture_output=True, text=True)
        print("started" if done.returncode == 0 else "not started:", r["id"])


if __name__ == "__main__":
    main()
