#!/usr/bin/env python3
"""Hospital A as the one hospital with many MDT teams (Soňa, 2026-11-06): adds the teams with a weekly schedule, files its
existing patients under the neuro-oncology team, adds the lung specialists and ten fictional lung patients under the lung
team, and starts the reading pipeline on their reports. Additive and repeatable: nothing is deleted, hospitals B and C stay.

The schedule is a starting point for the teams to change in Administrace: no two teams overlap, each meeting is two hours.
Every doctor of the hospital starts in every team, so nobody loses a patient; narrowing that is part of customizing a team.

    python scripts/add_mdt_teams.py --print-only     # print the PDFs and the SQL, change nothing
    python scripts/add_mdt_teams.py --local          # apply the SQL to the local database only
    python scripts/add_mdt_teams.py                  # write to the deployed database and start the runs
"""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "samples/C_plicni"))
from add_lung_org import AT, BUCKET, birth_number, insert, lit, render  # noqa: E402
from patients import PATIENTS  # noqa: E402

ORG = "demo-a"
DAY = "2026-10-20"  # the Tuesday of the week the calendar opens on
OUT = ROOT / "api/seed/out/teams-a"
ADMIN_USER = "b-admin"  # the login that also administers org B
# id suffix, name, weekday (1 = Monday), time
TEAMS = [
    ("git", "GIT tým", 1, "12:00"),
    ("uro", "Urologický tým", 1, "14:00"),
    ("kozni", "Kožní tým", 2, "12:00"),
    ("plicni", "Plicní tým", 2, "14:00"),
    ("gyn", "Gynekologický tým", 3, "12:00"),
    ("mama", "Mamární tým", 3, "14:00"),
    ("orl", "ORL tým", 4, "12:00"),
    ("neuro", "Neuroonkologický tým", 4, "14:00"),
    ("hemato", "Hematoonkologický tým", 5, "10:00"),
    ("sarkom", "Sarkomový tým", 5, "12:00"),
    ("mtb", "Molekulární tumor board", 5, "14:00"),
]
# Lung specialists already on the staff of hospital C keep their user rows; here they get a membership and a department.
NEW_DEPTS = [("a-d7", "Pneumologie", ["c-d1p1", "c-d1p2"]), ("a-d8", "Hrudní chirurgie", ["c-d2p1"]), ("a-d9", "Nukleární medicína", ["c-d6p1"])]


def build() -> tuple[list[str], list[dict], list[dict]]:
    sql: list[str] = []
    for suffix, name, weekday, time in TEAMS:
        sql.append(insert("teams", {"id": f"t-a-{suffix}", "org_id": ORG, "name": name, "weekday": weekday, "time": time, "created_at": AT}))
    # The login that was only in hospital B administers this hospital too, and lands here as its oldest org.
    sql.append(insert("memberships", {"id": "a-admin-b", "org_id": ORG, "user_id": ADMIN_USER, "role_id": "doctor", "fn": "správce systému", "active_from": AT, "administers": 1}))
    for i, (dept, name, people) in enumerate(NEW_DEPTS):
        sql.append(insert("departments", {"id": dept, "org_id": ORG, "name": name, "sort": 6 + i}))
        for j, uid in enumerate(people):
            sql.append(insert("memberships", {"id": f"a-{uid}", "org_id": ORG, "user_id": uid, "role_id": "doctor", "fn": "", "active_from": AT, "administers": 0}))
            sql.append(insert("dept_members", {"org_id": ORG, "dept_id": dept, "user_id": uid, "position": j}))
    sql.append(f"INSERT OR IGNORE INTO team_members (org_id, team_id, user_id) SELECT {lit(ORG)}, t.id, m.user_id FROM teams t JOIN memberships m ON m.org_id = t.org_id WHERE t.org_id = {lit(ORG)} AND m.role_id = 'doctor' AND m.active_until IS NULL;")
    # What hospital A already holds is its neuro-oncology demo; only cases not yet filed.
    sql.append(f"UPDATE cases SET team_id = 't-a-neuro' WHERE org_id = {lit(ORG)} AND team_id IS NULL AND case_no NOT LIKE 'NO-1__';")

    objects, runs = [], []
    for i, p in enumerate(PATIENTS, 1):
        rc = birth_number(p["birth"], p["sex"], i)
        pdf = render(p, rc)
        sha = hashlib.sha256(pdf).hexdigest()
        nr = f"NO-{100 + i}"
        pid, doc, run = f"pt-{nr}", f"up-a-{i:02d}", f"pl-a-{i:02d}"
        key = f"org/{ORG}/uploads/{nr}/{doc}.pdf"
        objects.append({"key": key, "body": pdf})
        sql.append(insert("patients", {"id": pid, "org_id": ORG, "full_name": f"{p['first']} {p['last']}", "name_as_written": f"{p['last']} {p['first']}", "birth_number": rc,
                                       "birth_as_written": p["birth"], "sex": p["sex"], "sex_certainty": "stated", "data_origin": "codebridge_synthetic", "created_at": AT}))
        sql.append(insert("cases", {"id": nr, "org_id": ORG, "case_no": nr, "patient_id": pid, "source_file": f"{100 + i}_pacient.pdf", "list_order": 10 + i, "status": "scheduled", "processing_level": "none",
                                    "question_text": p["question"], "question_explicit": 1, "diagnosis_text": "Čeká na kontrolu lékařem", "referring_dept": p["dept"], "referring_dept_is_example": 0,
                                    "owner_user_id": "c-d1p1", "owner_name": "Bednář", "owner_is_example": 0, "submitted_on": "2026-10-12", "submitted_is_example": 0, "updated_on": "2026-10-12",
                                    "created_by": "c-d1p1", "created_at": AT, "team_id": "t-a-plicni"}))
        sql.append(insert("slots", {"org_id": ORG, "day": DAY, "time": p["slot"], "case_id": nr, "booked_by": "c-d1p1", "booked_at": AT}))
        sql.append(insert("documents", {"id": doc, "org_id": ORG, "case_id": nr, "file_name": f"{p['no']}-ambulantni-zprava.pdf", "media_type": "application/pdf", "page_count": 0, "original_r2_key": key, "sha256": sha,
                                        "size_bytes": len(pdf), "origin": "upload", "processing": "unprocessed", "uploaded_by": "c-d1p1", "created_at": AT, "state": "queued"}))
        sql.append(insert("pipeline_runs", {"org_id": ORG, "id": run, "document_id": doc, "case_id": nr, "state": "queued", "pipeline_version": "add_mdt_teams", "input_sha256": sha,
                                            "output_prefix": f"org/{ORG}/uploads/{nr}/{doc}/{run}/", "created_by": "c-d1p1", "created_by_name": "Bednář", "created_at": AT, "updated_at": AT}))
        runs.append({"id": run, "params": {"org": ORG, "runId": run, "docId": doc, "caseId": nr}})
    return sql, objects, runs


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("--print-only", action="store_true")
    a.add_argument("--local", action="store_true")
    args = a.parse_args()
    sql, objects, runs = build()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "teams-a.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    for o in objects:
        o["file"] = OUT / Path(o["key"]).name
        o["file"].write_bytes(o["body"])
    print(f"{len(sql)} statements in {OUT / 'teams-a.sql'}, {len(objects)} PDFs")
    if args.print_only:
        return
    api = ROOT / "api"
    run = lambda *c: subprocess.run(["npx", "wrangler", *c], cwd=api, check=True, capture_output=True, text=True)  # noqa: E731
    if args.local:
        run("d1", "execute", "codebridge-mdt", "--local", "--yes", "--file", str(OUT / "teams-a.sql"))
        print("applied to the local database")
        return
    # R2 first, so a document row never points at a missing object.
    for o in objects:
        run("r2", "object", "put", f"{BUCKET}/{o['key']}", "--file", str(o["file"]), "--content-type", "application/pdf", "--remote", "--jurisdiction", "eu")
    run("d1", "execute", "codebridge-mdt", "--remote", "--yes", "--file", str(OUT / "teams-a.sql"))
    for r in runs:
        run("workflows", "trigger", "codebridge-process-document", json.dumps(r["params"]), "--id", r["id"])
        print("started", r["id"])


if __name__ == "__main__":
    main()
