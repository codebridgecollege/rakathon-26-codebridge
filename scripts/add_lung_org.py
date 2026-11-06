#!/usr/bin/env python3
"""Adds demo org C (the lung cancer MDT) to a database: the org, its fictional staff, ten fictional patients booked on
Tuesday 20.10.2026, and their reports, then starts the reading pipeline on each. Additive and repeatable: it writes only
rows of demo-c and R2 objects under org/demo-c/, and a row already there stays as it is.

Needs PyMuPDF and wrangler; the Worker must already list demo-c in PIPELINE_ORGS, UPLOAD_STORE_ORGS and MODEL_ORGS.

    python scripts/add_lung_org.py --print-only          # print the PDFs and the SQL, change nothing
    python scripts/add_lung_org.py --admin-user b-admin  # write to the deployed database and start the runs
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "samples/C_plicni"))
from patients import PATIENTS  # noqa: E402

ORG = "demo-c"
PREFIX = "C-"
DAY = "2026-10-20"  # a Tuesday in the week the calendar opens on (DEFAULT_WEEK)
AT = "2026-10-16T08:00:00.000Z"
BUCKET = "codebridge-mdt"
OUT = ROOT / "api/seed/out/org-c"
FONT = os.environ.get("PAGE_READER_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
DEPTS = [
    ("Pneumologie", [("MUDr.", "Bednář"), ("MUDr.", "Krejčí")]),
    ("Hrudní chirurgie", [("MUDr.", "Urban")]),
    ("Klinická onkologie", [("MUDr.", "Růžičková"), ("MUDr.", "Fiala")]),
    ("Radiační onkologie", [("MUDr.", "Kolář")]),
    ("Radiologie", [("MUDr.", "Sedláček")]),
    ("Nukleární medicína", [("MUDr.", "Marek")]),
    ("Patologie", [("MUDr.", "Doležalová")]),
]
COORD = ("c-coord", "Bc.", "Tichá", "koordinátorka MDT")


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def insert(table: str, row: dict) -> str:
    cols = ", ".join(row)
    return f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({', '.join(lit(v) for v in row.values())});"


def birth_number(birth: str, sex: str, n: int) -> str:
    """A made-up birth number of the right shape: the date, a serial, and divisible by 11."""
    d, m, y = (int(x) for x in birth.split("."))
    head = f"{y % 100:02d}{m + (50 if sex == 'žena' else 0):02d}{d:02d}"
    for tail in range(9000 + n * 7, 9999):
        if int(f"{head}{tail:04d}") % 11 == 0:
            return f"{head}/{tail:04d}"
    raise ValueError(birth)


def render(p: dict, rc: str) -> bytes:
    """The report on A4 pages, in a font with Czech letters."""
    font = fitz.Font(fontfile=FONT)
    text = (f"Plicní ambulance - pneumoonkologie, Ukázková nemocnice C\n\nAmbulantní vyšetření\n\n{p['last']} {p['first']}, "
            f"nar. {p['birth']}, r.č. {rc}, poj. 111\nDatum vyšetření: 12.10.2026\nOdesílá: {p['dept']}\n\n{p['body']}\n"
            f"Otázka pro MDT: {p['question']}\n")
    doc = fitz.open()
    page, y = None, 0.0
    size, leading, margin, width = 10.5, 15.0, 56.0, 595.28 - 112.0
    for para in text.split("\n"):
        line = ""
        rows = []
        for word in para.split(" "):
            trial = f"{line} {word}" if line else word
            if line and font.text_length(trial, size) > width:
                rows.append(line)
                line = word
            else:
                line = trial
        rows.append(line)
        for row in rows:
            if page is None or y > 841.89 - margin:
                page = doc.new_page(width=595.28, height=841.89)
                y = margin + size
            if row:
                tw = fitz.TextWriter(page.rect)
                tw.append((margin, y), row, font=font, fontsize=size)
                tw.write_text(page)
            y += leading
    out = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return out


def build(admin_user: str) -> tuple[list[str], list[dict]]:
    sql = [
        f"INSERT OR IGNORE INTO orgs (id, name, short_name, is_demo, case_id_prefix, mdt_name, mdt_weekday, mdt_time) VALUES ({lit(ORG)}, 'Ukázková nemocnice C', 'Nemocnice C', 1, {lit(PREFIX)}, 'Plicní MDT', 2, '14:00');",
        f"INSERT OR IGNORE INTO demo_state (org_id, data_epoch) VALUES ({lit(ORG)}, 1);",
    ]
    member = lambda mid, uid, role, fn, administers=0: insert("memberships", {"id": mid, "org_id": ORG, "user_id": uid, "role_id": role, "fn": fn, "active_from": AT, "administers": administers})  # noqa: E731
    for i, (name, people) in enumerate(DEPTS, 1):
        dept = f"c-d{i}"
        sql.append(insert("departments", {"id": dept, "org_id": ORG, "name": name, "sort": i - 1}))
        for j, (pre, sur) in enumerate(people, 1):
            uid = f"{dept}p{j}"
            sql.append(insert("users", {"id": uid, "pre": pre, "sur": sur, "post": ""}))
            sql.append(member(uid, uid, "doctor", ""))
            sql.append(insert("dept_members", {"org_id": ORG, "dept_id": dept, "user_id": uid, "position": j - 1}))
    cid, pre, sur, fn = COORD
    sql.append(insert("users", {"id": cid, "pre": pre, "sur": sur, "post": ""}))
    sql.append(member(cid, cid, "coordinator", fn))
    # The existing login gets a membership here, so C appears under the account menu's org switch; no new account.
    sql.append(member("c-admin", admin_user, "doctor", "správce systému", 1))
    # Demo org A's administrator login too, since the presenter may be signed in with that one.
    sql.append(member("c-admin-a", "admin", "doctor", "správce systému", 1))

    objects, runs = [], []
    for i, p in enumerate(PATIENTS, 1):
        rc = birth_number(p["birth"], p["sex"], i)
        pdf = render(p, rc)
        sha = hashlib.sha256(pdf).hexdigest()
        nr = f"NO-{100 + i}"
        case, pid, doc, run = f"{PREFIX}{nr}", f"pt-{PREFIX}{nr}", f"up-c-{i:02d}", f"pl-c-{i:02d}"
        name = f"{p['no']}-ambulantni-zprava.pdf"
        key = f"org/{ORG}/uploads/{case}/{doc}.pdf"
        objects.append({"key": key, "body": pdf})
        sql.append(insert("patients", {"id": pid, "org_id": ORG, "full_name": f"{p['first']} {p['last']}", "name_as_written": f"{p['last']} {p['first']}", "birth_number": rc,
                                       "birth_as_written": p["birth"], "sex": p["sex"], "sex_certainty": "stated", "data_origin": "codebridge_synthetic", "created_at": AT}))
        sql.append(insert("cases", {"id": case, "org_id": ORG, "case_no": nr, "patient_id": pid, "source_file": f"{100 + i}_novy.pdf", "list_order": i, "status": "scheduled", "processing_level": "none",
                                    "question_text": p["question"], "question_explicit": 1, "diagnosis_text": "Čeká na kontrolu lékařem", "referring_dept": p["dept"], "referring_dept_is_example": 0,
                                    "owner_user_id": admin_user, "owner_name": "Hudecová", "owner_is_example": 0, "submitted_on": "2026-10-12", "submitted_is_example": 0, "updated_on": "2026-10-12",
                                    "created_by": admin_user, "created_at": AT}))
        # case_members has no natural key, so a rerun adds them only to a case that has none yet.
        none_yet = f"NOT EXISTS (SELECT 1 FROM case_members WHERE org_id = {lit(ORG)} AND case_id = {lit(case)})"
        sql.append(f"INSERT INTO case_members (org_id, case_id, user_id, reason, added_by, added_at) SELECT {lit(ORG)}, {lit(case)}, {lit(admin_user)}, 'založil(a) případ', {lit(admin_user)}, {lit(AT)} WHERE {none_yet};")
        sql.append(f"INSERT INTO case_members (org_id, case_id, user_id, reason, added_by, added_at) SELECT {lit(ORG)}, {lit(case)}, 'admin', 'správce systému', {lit(admin_user)}, {lit(AT)} WHERE NOT EXISTS (SELECT 1 FROM case_members WHERE org_id = {lit(ORG)} AND case_id = {lit(case)} AND user_id = 'admin');")
        sql.append(f"INSERT INTO case_members (org_id, case_id, dept_id, reason, added_by, added_at) SELECT {lit(ORG)}, {lit(case)}, id, 'nový případ: oddělení MDT', {lit(admin_user)}, {lit(AT)} FROM departments WHERE org_id = {lit(ORG)} AND NOT EXISTS (SELECT 1 FROM case_members WHERE org_id = {lit(ORG)} AND case_id = {lit(case)} AND dept_id IS NOT NULL);")
        sql.append(insert("slots", {"org_id": ORG, "day": DAY, "time": p["slot"], "case_id": case, "booked_by": admin_user, "booked_at": AT}))
        sql.append(insert("documents", {"id": doc, "org_id": ORG, "case_id": case, "file_name": name, "media_type": "application/pdf", "page_count": 0, "original_r2_key": key, "sha256": sha,
                                        "size_bytes": len(pdf), "origin": "upload", "processing": "unprocessed", "uploaded_by": admin_user, "created_at": AT, "state": "queued"}))
        sql.append(insert("pipeline_runs", {"org_id": ORG, "id": run, "document_id": doc, "case_id": case, "state": "queued", "pipeline_version": "add_lung_org", "input_sha256": sha,
                                            "output_prefix": f"org/{ORG}/uploads/{case}/{doc}/{run}/", "created_by": admin_user, "created_by_name": "Hudecová", "created_at": AT, "updated_at": AT}))
        runs.append({"id": run, "params": {"org": ORG, "runId": run, "docId": doc, "caseId": case}})
    return sql, objects + [{"runs": runs}]


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("--admin-user", default="b-admin", help="the users.id of the login that administers org C")
    a.add_argument("--print-only", action="store_true")
    a.add_argument("--only", help="start the pipeline only on this case number, for example C01", default=None)
    args = a.parse_args()
    sql, items = build(args.admin_user)
    runs = items[-1]["runs"]
    objects = items[:-1]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "org-c.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    for o in objects:
        path = OUT / Path(o["key"]).name
        path.write_bytes(o["body"])
        o["file"] = path
    print(f"{len(sql)} statements in {OUT / 'org-c.sql'}, {len(objects)} PDFs")
    if args.print_only:
        return
    api = ROOT / "api"
    run = lambda *c: subprocess.run(["npx", "wrangler", *c], cwd=api, check=True, capture_output=True, text=True)  # noqa: E731
    # R2 first, so a document row never points at a missing object.
    for o in objects:
        run("r2", "object", "put", f"{BUCKET}/{o['key']}", "--file", str(o["file"]), "--content-type", "application/pdf", "--remote", "--jurisdiction", "eu")
    run("d1", "execute", "codebridge-mdt", "--remote", "--yes", "--file", str(OUT / "org-c.sql"))
    for i, r in enumerate(runs, 1):
        if args.only and PATIENTS[i - 1]["no"] != args.only:
            continue
        run("workflows", "trigger", "codebridge-process-document", json.dumps(r["params"]), "--id", r["id"])
        print("started", r["id"])


if __name__ == "__main__":
    main()
