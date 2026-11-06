#!/usr/bin/env python3
"""Reads hospital A's FNO demo patients through the real pipeline and AI, so what their PDFs say reaches the timeline, the
anamnesis and the other tabs. The pipeline's case merge takes uploaded documents, so each original demo document gets a copy
as an upload and the original row is withdrawn; its row and reason stay. Poláček and Křemínek keep their prepared data: the
merge leaves a case with a prepared run alone, so they are not listed. FNO's patients are fictitious challenge data.

    python scripts/read_fno_patients.py NO-020            # one patient
    python scripts/read_fno_patients.py NO-002 NO-009 ... # several
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from add_lung_org import BUCKET, insert, lit  # noqa: E402

ORG = "demo-a"
BY = "d2p1"
BY_NAME = "Svobodová"
ALLOWED = {"NO-002", "NO-009", "NO-011", "NO-013", "NO-015", "NO-017", "NO-018", "NO-019", "NO-020"}
API = ROOT / "api"


def wrangler(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["npx", "wrangler", *args], cwd=API, check=check, capture_output=True, text=True)


def main() -> None:
    cases = sys.argv[1:]
    if not cases or set(cases) - ALLOWED:
        sys.exit(f"name cases from {sorted(ALLOWED)}")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    listed = ",".join(lit(c) for c in cases)
    rows = json.loads(wrangler("d1", "execute", "codebridge-mdt", "--remote", "--json", "--command",
                               f"SELECT id, case_id, file_name, original_r2_key FROM documents WHERE org_id = {lit(ORG)} AND origin = 'seed' AND lifecycle = 'current' AND case_id IN ({listed})").stdout)[0]["results"]
    sql, runs = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for r in rows:
            local = Path(tmp) / f"{r['id']}.pdf"
            wrangler("r2", "object", "get", f"{BUCKET}/{r['original_r2_key']}", "--file", str(local), "--remote", "--jurisdiction", "eu")
            # A case holds a given file once (documents_case_sha), withdrawn or not. A comment after the PDF's end changes the
            # fingerprint and nothing a reader sees.
            data = local.read_bytes() + b"\n% copy for processing\n"
            local.write_bytes(data)
            doc, run = f"up-f-{r['id']}", f"pl-f-{r['id']}"
            key = f"org/{ORG}/uploads/{r['case_id']}/{doc}.pdf"
            wrangler("r2", "object", "put", f"{BUCKET}/{key}", "--file", str(local), "--content-type", "application/pdf", "--remote", "--jurisdiction", "eu")
            sha = hashlib.sha256(data).hexdigest()
            sql.append(f"UPDATE documents SET lifecycle = 'withdrawn', lifecycle_reason_cs = 'nahrazeno kopií ke zpracování', lifecycle_changed_at = {lit(now)}, lifecycle_changed_by = {lit(BY)} WHERE org_id = {lit(ORG)} AND id = {lit(r['id'])};")
            sql.append(insert("documents", {"id": doc, "org_id": ORG, "case_id": r["case_id"], "file_name": f"zprava-{r['file_name']}", "media_type": "application/pdf", "page_count": 0, "original_r2_key": key, "sha256": sha,
                                            "size_bytes": len(data), "origin": "upload", "processing": "unprocessed", "uploaded_by": BY, "created_at": now, "state": "queued"}))
            sql.append(insert("pipeline_runs", {"org_id": ORG, "id": run, "document_id": doc, "case_id": r["case_id"], "state": "queued", "pipeline_version": "read_fno", "input_sha256": sha,
                                                "output_prefix": f"org/{ORG}/uploads/{r['case_id']}/{doc}/{run}/", "created_by": BY, "created_by_name": BY_NAME, "created_at": now, "updated_at": now}))
            runs.append({"id": run, "params": {"org": ORG, "runId": run, "docId": doc, "caseId": r["case_id"]}})
        file = Path(tmp) / "fno.sql"
        file.write_text("\n".join(sql) + "\n", encoding="utf-8")
        wrangler("d1", "execute", "codebridge-mdt", "--remote", "--yes", "--file", str(file))
    for r in runs:
        done = wrangler("workflows", "trigger", "codebridge-process-document", json.dumps(r["params"]), "--id", r["id"], check=False)
        print("started" if done.returncode == 0 else "not started:", r["id"])


if __name__ == "__main__":
    main()
