# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema==4.23.0"]
# ///
"""Seed the Worker's D1 database and R2 bucket from the synthetic fixtures in the repository.

Usage (from the repository root or from api/):
    uv run api/seed/seed.py --target local [--reset] [--persist-to DIR]   # wrangler dev state (api/.wrangler/state)
    uv run api/seed/seed.py --target remote [--reset]    # the EU database and bucket
    uv run api/seed/seed.py --dry-run                    # write api/seed/out/ only

Reads only synthetic data that is committed: fixtures/data/, data/derived/, data/rakathon-26/ (the organizers'
synthetic challenge PDFs) and samples/. It never opens private/.

Extraction runs are the converted codebridge.extraction/2 files in fixtures/data/runs/ (fixtures/convert/convert_v2.py),
stored unchanged after pipeline/extraction_format's validator accepts them; a run it refuses stops the seed before
anything is written.

Identity (name, birth number, birth date, age, insurer) goes to the D1 `patients` table only. The case-side JSON
stored in R2 (extraction, guidance, prognosis) is stripped of it, and an identity scan stops the seed when a
patient's name or birth number is still found anywhere in that JSON or in a case row outside a `quote` field.
Quotes are source evidence and stay verbatim (CLAUDE.md), so hits inside them are reported by path only.
Design: docs/research/backend-steps/step-2.md.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# The codebridge.extraction/2 validator and matcher (pipeline/extraction_format) are the Python twin of the Worker's, so
# the seed refuses a run the Worker's storeRun would refuse. The package has no installer entry; it is imported from its
# folder, which is why the path goes in before the import.
sys.path.insert(0, str(ROOT / "pipeline"))
from extraction_format import alert_id, assign_fact_ids, source_id_for, validate_run  # noqa: E402
API = ROOT / "api"
OUT = API / "seed" / "out"
DATA = ROOT / "fixtures" / "data"
RUNS = DATA / "runs"  # converted codebridge.extraction/2 runs, one per case (NO-010, NO-S01, NO-S02)
DERIVED = ROOT / "data" / "derived"
FNO_PDFS = ROOT / "data" / "rakathon-26" / "2_AI asistent MDT"
SAMPLES = ROOT / "samples"
MIGRATIONS = API / "migrations"
DB_NAME = "codebridge-mdt"
BUCKET = "codebridge-mdt"
MAX_STATEMENT = 90_000  # D1 refuses SQL statements over 100 KB; keep a margin.

# Tables in dependency order (parents first). --reset deletes them in the reverse order. orgs, demo_state, users,
# memberships, roles and user_identities are not in it: orgs, people and memberships are upserted, never deleted (AUTH.md,
# "Demo reset is per org"; a membership outside the seed is ended), and each org keeps its data epoch across a reseed.
TABLES = [
    "departments", "dept_members", "patients", "patient_nis_links", "cases", "case_members", "status_history",
    "slots", "sessions", "attendance", "protocols", "decisions", "task_suggestions", "tasks",
    "question_confirmations", "fact_edits", "edit_log", "extraction_runs", "alerts", "alert_events_v1", "alert_identities", "alert_events",
    "fact_ids", "fact_confirmations",
    "documents", "document_parts", "pages", "fixture_files", "fixture_patients", "recordings", "jobs", "transcript_passes",
    "transcript_lines", "transcript_summaries", "audio_uploads", "audio_parts", "audio_segments", "access_log", "seed_meta", "attendance_sets", "notifications", "case_access_grants", "idempotency_keys",
    "write_guards", "auth_sessions",
]
# What the app writes (step 4). POST /api/admin/reset-demo empties these in one org and reinserts that org's seed rows
# from the R2 object seed/reset.json, which this script writes (a section per demo org); the other tables change only
# through this script. users and memberships are upserted there, never deleted.
MUTABLE = [
    "users", "memberships", "departments", "dept_members", "cases", "case_members", "status_history", "slots", "sessions",
    "attendance", "attendance_sets", "protocols", "decisions", "task_suggestions", "tasks", "question_confirmations",
    "fact_edits", "edit_log", "alert_events", "notifications", "case_access_grants", "idempotency_keys", "write_guards",
    "recordings", "jobs", "transcript_passes", "transcript_lines", "transcript_summaries", "audio_uploads", "audio_parts",
    "audio_segments", "access_log",
]
# patients is not in the list: identity stays in D1 only (no copy in R2). The app never changes a seeded patient row,
# so the reset keeps those and deletes only patients created after the seed (reset.json lists the seeded IDs).
RESET_KEY = "seed/reset.json"


def load_build():
    """fixtures/prepare.py's page_index() and guidance(), the one merge of the fixture JSON and the page index."""
    spec = importlib.util.spec_from_file_location("fixtures_prepare", ROOT / "fixtures" / "prepare.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # main() is guarded, so importing builds nothing
    return mod


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def jdump(o) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


# ---------- staff: the same values as DEFAULT_STAFF in packages/domain/src/staff-default.ts ----------
STAFF_DEPTS = [
    ("Neurochirurgie", ["Novák", "Dvořák"]),
    ("Klinická onkologie", ["Svobodová", "Malá"]),
    ("Radiační onkologie", ["Černý", "Horáková"]),
    ("Radiologie", ["Šimek", "Veselá"]),
    ("Neurologie", ["Beneš", "Pokorná"]),
    ("Patologie", ["Králová", "Němcová"]),
]
COORD = {"id": "coord", "pre": "Bc.", "sur": "Marková", "post": "", "fn": "koordinátorka MDT", "role": "coordinator"}
ADMIN = {"id": "admin", "pre": "Ing.", "sur": "Kovář", "post": "", "fn": "správce systému", "role": "admin"}
# Demo org B: the same values as DEFAULT_STAFF_B in packages/domain/src/staff-default.ts.
STAFF_DEPTS_B = [
    ("Onkologie", ["Vlčková"]),
    ("Radiologie", ["Zeman"]),
]
COORD_B = {"id": "b-coord", "pre": "Bc.", "sur": "Holubová", "post": "", "fn": "koordinátorka MDT", "role": "coordinator"}
ADMIN_B = {"id": "b-admin", "pre": "Ing.", "sur": "Pospíšil", "post": "", "fn": "správce systému", "role": "admin"}

# Organizations (docs/design/AUTH.md): demo org A holds the hackathon demo. Demo org B holds no patient data, only its
# departments and people, so the team's own test data there starts from an empty org and its reset returns to that. The
# case ID prefix keeps internal IDs unique across orgs; each org counts its case numbers (case_no) on its own.
ORG_A, ORG_B = "demo-a", "demo-b"
ORGS = [
    {"id": ORG_A, "name": "Ukázková nemocnice A", "short_name": "Nemocnice A", "is_demo": 1, "case_id_prefix": ""},
    {"id": ORG_B, "name": "Ukázková nemocnice B", "short_name": "Nemocnice B", "is_demo": 1, "case_id_prefix": "B-"},
]
# The demo accounts' e-mails (AUTH.md, "Demo accounts"): the first login of step 3 links the IdP account by it.
EMAILS = {
    "d2p1": "lekar1.a@codebridge.demo", "d1p1": "lekar2.a@codebridge.demo", "coord": "koordinator.a@codebridge.demo",
    "admin": "admin.a@codebridge.demo", "b-d1p1": "lekar1.b@codebridge.demo", "b-d2p1": "lekar2.b@codebridge.demo",
    "b-coord": "koordinator.b@codebridge.demo", "b-admin": "admin.b@codebridge.demo",
}
ACTIVE_FROM = "2026-01-01T00:00:00.000Z"


def org_key(org: str, rest: str) -> str:
    """R2 keys of org data live under org/<org id>/ (DATABASE.md, R2 prefixes); guidance/ and fixtures/ stay global."""
    return f"org/{org}/{rest}"


def staff_name(x) -> str:
    base = " ".join(s.strip() for s in (x["pre"], x["sur"]) if s and s.strip())
    return base + (f", {x['post'].strip()}" if x["post"].strip() else "")


def staff(org=ORG_A, spec=None, prefix="", coord=None, admin=None):
    """One org's departments, people (users rows are the person), memberships and department members."""
    spec = STAFF_DEPTS if spec is None else spec
    coord, admin = coord or COORD, admin or ADMIN
    depts, users, members = [], [], []
    for i, (name, surs) in enumerate(spec):
        did = f"{prefix}d{i + 1}"
        depts.append({"id": did, "org_id": org, "name": name, "sort": i})
        for j, sur in enumerate(surs):
            u = {"id": f"{did}p{j + 1}", "pre": "MUDr.", "sur": sur, "post": "", "fn": "", "role": "doctor"}
            users.append(u)
            members.append({"org_id": org, "dept_id": did, "user_id": u["id"], "position": j})
    users += [coord, admin]
    return depts, users, members


def person_rows(org, users):
    """users rows (the person) and memberships rows (role and function in this org; the membership id is the person's)."""
    people = [{"id": u["id"], "pre": u["pre"], "sur": u["sur"], "post": u["post"], "email": EMAILS.get(u["id"])} for u in users]
    ms = [{"id": u["id"], "org_id": org, "user_id": u["id"], "role_id": u["role"], "fn": u["fn"], "active_from": ACTIVE_FROM} for u in users]
    return people, ms


# ---------- the patient list: a port of initialPatients() and listPatient() ----------
SLOTS = [("2026-10-22", "14:10"), ("2026-10-22", "14:20"), ("2026-10-22", "14:30"), ("2026-10-22", "14:40"), None,
         ("2026-10-22", "14:50"), None, ("2026-10-22", "15:00"), None]
SUBMITTED_OFFSETS = [1, 3, 5, 8, 12, 15, 19, 26, 33, 40]
EXAMPLE_DEPTS = ["Nemocnice Havířov, neurologie", "Slezská nemocnice v Opavě, onkologie",
                 "Nemocnice Karviná-Ráj, neurochirurgie", "FN Ostrava, Klinika onkologická"]


def case_id(file: str) -> str:
    return "NO-" + file.replace("_pacient.pdf", "").rjust(3, "0")


def js_or(*vals):
    """JavaScript's `a || b`: the first truthy value, else the last one."""
    for v in vals:
        if v:
            return v
    return vals[-1]


def list_patient(o, slot, extra_others, syn_by_file):
    ex = extra_others.get(o["file"], {})
    has_q = bool(o.get("mdt_question_cs")) and o.get("mdt_question_explicit") is not False
    aob = o.get("age_or_birth") or ""
    note = o.get("note") or ""
    return {
        "file": o["file"], "name": o["name"], "rc": o.get("rc") or None,
        "synthetic": bool(syn_by_file.get(o["file"], {}).get("synthetic_patient")),
        "birth": re.sub(r"^nar\.\s*", "", aob, count=1) if re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", aob) else None,
        "age": aob if "let" in aob else None,
        "warn": o["note"] if re.search(r"ověřit identitu", note, re.I) else None,
        "nameNote": {"text": o["name_note_cs"], "src": o.get("name_note_source")} if o.get("name_note_cs") else None,
        "diagnosis": js_or(ex.get("diagnosis_cs"), o.get("main_problem_cs")), "mkn10": ex.get("mkn10") or None,
        "question": o["mdt_question_cs"] if has_q else None, "purpose": o.get("mdt_question_cs"), "explicit": has_q,
        "draft": None if has_q else (o.get("question_draft_cs") or None),
        "qkind": None if has_q else (o.get("question_kind") or None),
        "basis": None if has_q else (o.get("question_basis") or None),
        "summary": o.get("one_line_summary_cs"), "pages": o.get("page_count"),
        "referrer": ex.get("referring_doctor") or None, "dept": ex.get("referring_department") or None,
        "status": "new" if not slot else "attention" if re.search(r"ověřit identitu|useknut", note, re.I) else "scheduled",
        "slot": slot, "updated": "2026-10-15",
        # Kept for the cases row; not part of the UI row.
        "_insurer": o.get("insurer"), "_question_source": o.get("mdt_question_source"),
        "_context_note": ex.get("context_note_cs"),
    }


def initial_patients(case, extra, others_list, syn, depts):
    mq = case["mdt_question"]
    hl = extra.get("diagnosis_headline")
    p10 = {
        "file": case["file"], "name": case["patient"]["name"], "nameAsWritten": case["patient"].get("name_as_written"),
        "rc": case["patient"].get("birth_number") or None, "birth": case["patient"].get("birth_date") or None,
        "age": case["patient"].get("age") or None,
        # JS String.replace with a string pattern replaces the first match only.
        "diagnosis": f"{hl['histology_cs']}, {hl['tnm_cs'].replace('(', ' (', 1)}" if hl else "Světlobuněčný karcinom ledviny",
        "diagnosisNote": "pTNM při diagnóze 6/2022 · nyní susp. MTS v mozečku",
        "mkn10": (case.get("diagnosis") or {}).get("code") or None,
        "question": mq.get("text_cs"), "purpose": (mq.get("closest_source") or {}).get("quote"),
        "explicit": bool(mq.get("text_cs")),
        "draft": mq.get("question_draft_cs") or None, "qkind": mq.get("question_kind") or None,
        "basis": mq.get("question_basis") or None,
        "status": "ready", "slot": {"day": "2026-10-22", "time": "14:00"}, "updated": "2026-10-16", "full": True,
        "_insurer": case["patient"].get("insurer"), "_identity_source": case["patient"].get("source"),
    }
    syn_by_file = {s["file"]: s for s in syn}
    extra_others = {o["file"]: o for o in [*(extra.get("others") or []), *[s["others_entry"] for s in syn if s.get("others_entry")]]}
    entries = [*others_list, *[s["list_entry"] for s in syn if not s.get("intake_demo")]]
    rows = [p10] + [
        list_patient(o, {"day": SLOTS[i][0], "time": SLOTS[i][1]} if i < len(SLOTS) and SLOTS[i] else None, extra_others, syn_by_file)
        for i, o in enumerate(entries)
    ]
    # ownerFor(i): even i the first doctor of "Klinická onkologie", odd i the second doctor of "Neurochirurgie".
    owner_for = lambda i: depts[1 if i % 2 == 0 else 0]["people"][i % 2]  # noqa: E731
    out = []
    for i, p in enumerate(rows):
        owner = None if p.get("referrer") else owner_for(i)
        p = {
            **p, "id": case_id(p["file"]),
            "owner": p.get("referrer") or staff_name(owner), "_owner_user_id": owner["id"] if owner else None,
            "ownerExample": not p.get("referrer"),
            "submitted": (date(2026, 10, 15) - timedelta(days=SUBMITTED_OFFSETS[i % 10])).isoformat(), "submittedExample": True,
            "dept": p.get("dept") or EXAMPLE_DEPTS[i % 4], "deptExample": not p.get("dept"),
        }
        out.append(p)
    return out


# ---------- identity removal and the residual scan ----------
def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).lower()


def patient_patterns(p):
    """One patient's patterns: each name part (from the list name and the name as written) with a stem for Czech case
    endings and the dropped vowel ("Šimek" -> "Šimka", "Poláček" -> "Poláčka"), the birth date as written, and the
    birth number digits (also the first six, the birth-date part)."""
    pats = []
    names = " ".join(x for x in (p["full_name"], p.get("name_as_written")) if x)
    for t in {t for t in re.split(r"[\s,]+", fold(names)) if len(t) >= 3}:
        for v in {t, t[:-2] if len(t) >= 6 else t, re.sub(r"e(?=[a-z]$)", "", t)}:
            if len(v) >= 3:
                pats.append(re.compile(r"(?<![a-z])" + re.escape(v)))
    if p.get("birth_as_written"):
        pats.append(re.compile(re.escape(fold(p["birth_as_written"]))))
    if p.get("birth_number"):
        digits = re.sub(r"\D", "", p["birth_number"])
        pats += [re.compile(re.escape(digits)), re.compile(re.escape(digits[:6]))]
    return pats


def identity_patterns(patients):
    return [x for p in patients for x in patient_patterns(p)]


def is_quote_path(path: list) -> bool:
    """A hit is allowed only inside a quote: a key named quote (or *_quote) somewhere on the path."""
    return any(isinstance(k, str) and (k == "quote" or k.endswith("_quote")) for k in path)


def scan(obj, pats, path, hits):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and any(p.search(fold(k).replace(" ", "")) for p in pats):
                hits.append((path + [k], "key"))
            scan(v, pats, path + [k], hits)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            scan(v, pats, path + [i], hits)
    elif isinstance(obj, str):
        f = fold(obj)
        digits_only = re.sub(r"\D", "", obj)
        if any(p.search(f) or (p.pattern.isdigit() and p.pattern in digits_only) for p in pats):
            hits.append((path, "value"))


# ---------- codebridge.extraction/2 runs ----------
def load_run(cid: str) -> tuple[dict, bytes]:
    """The converted run of one case and its file bytes. The seed stores the bytes unchanged, so the object in R2 is the
    file in the repository; a run the validator refuses, or one whose frame is not a first fixture run, stops the seed."""
    path = RUNS / f"{cid}.json"
    if not path.exists():
        sys.exit(f"seed: {path.relative_to(ROOT)} is missing; run fixtures/convert/convert_v2.py (fixtures/README.md)")
    body = path.read_bytes()
    run = json.loads(body)
    v = validate_run(run)
    if not v.ok:
        # Codes and paths only: a message could carry patient text from the run.
        sys.exit(f"seed: {path.relative_to(ROOT)} is not a valid codebridge.extraction/2 run: "
                 + "; ".join(f"{i.code} at {i.path}" for i in v.issues[:8]))
    frame = run["run"]
    if run["case_id"] != cid or frame["producer"] != "fixture" or frame.get("supersedes") is not None:
        sys.exit(f"seed: {path.relative_to(ROOT)} must be the first fixture run of {cid} (case_id, producer fixture, no supersedes)")
    return run, body


def check_run_documents(run: dict, seeded_docs: dict[str, str], seeded_parts: set[str]) -> None:
    """Every document the run read is the seeded PDF with the same bytes, and every part it names is a seeded
    document_parts.part_id, so a source opens the page it quotes and the documents tab lists the run's parts."""
    for d in run["documents"]:
        sha = seeded_docs.get(d["document_id"])
        if sha is None:
            sys.exit(f"seed: run {run['run']['id']} reads {d['document_id']}, which is not a seeded document of {run['case_id']}")
        if d.get("sha256") and d["sha256"] != sha:
            sys.exit(f"seed: run {run['run']['id']} was made from another version of {d['document_id']} (sha256 differs)")
        missing = sorted(set(d["parts"]) - seeded_parts)
        if missing:
            sys.exit(f"seed: run {run['run']['id']} names parts that are not seeded: {missing[:5]}")


def fact_ids_of(obj) -> set[str]:
    """Every fact ID a guidance file names (fact_ids, fact_id, row_fact_id, decision_fact_ids, source_fact_ids)."""
    out: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.endswith("fact_ids") and isinstance(v, list):
                out |= {x for x in v if isinstance(x, str)}
            elif k.endswith("fact_id") and isinstance(v, str):
                out.add(v)
            else:
                out |= fact_ids_of(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= fact_ids_of(v)
    return out


# ---------- the prepared extraction of the intake fixture (step 6) ----------
# Placeholders in the prepared run for what exists only once the files are uploaded: the uploaded document's ID and its
# one part. POST /api/cases/:id/intake/complete (api/src/routes/intake.ts) swaps them for the real IDs.
UPLOAD_DOC = "@upload:"
UPLOAD_PART = "@upload-part:"


def run_for_uploads(run: dict, s: dict, pages: dict, upload_sha: dict[str, str]) -> dict:
    """The fixture's run, made over the combined PDF (one document, a part per clinical document, pages numbered across
    the whole PDF), re-pointed at the files the intake uploads: one document per file, one part per document, pages
    numbered inside the file. The result is a draft (api/src/store/runs.ts DraftRun): facts carry their fixture ID as
    draft_id and no ID or key, alerts no ID, since IDs depend on the case the intake creates (prepareRun assigns them).
    Stops when a reference cannot be mapped or a quote is not on the page it maps to."""
    stem = s["file"].removesuffix(".pdf")
    # Part ordinals count every document of the combined PDF, uploaded or not (C-1: the index in syn.documents).
    by_part = {f"{stem}/p{k}": d for k, d in enumerate(s.get("documents") or [])}
    uploads = [d for d in s.get("documents") or [] if d.get("upload_name")]
    names = [d["upload_name"] for d in uploads]
    if len(set(names)) != len(names):
        sys.exit(f"seed: two documents of {s['file']} share an upload file; the intake maps one part to one file")
    by_page = {k: d for d in uploads for k in d["pages"]}
    norm = lambda t: re.sub(r"\s+", " ", t.replace("*", "")).strip()  # noqa: E731

    def upload_of(document_id, part, page):
        if document_id != stem:
            sys.exit(f"seed: the {s['file']} run refers to document {document_id}")
        d = by_part.get(part) if part is not None else by_page.get(page)
        if d is None or not d.get("upload_name"):
            sys.exit(f"seed: {part or document_id} page {page} of {s['file']} is in no uploaded file")
        if page is not None and page not in d["pages"]:
            sys.exit(f"seed: page {page} is not a page of {part}")
        return d

    def where(x: dict, page_key="page") -> dict:
        d = upload_of(x["document_id"], x.get("part"), x.get(page_key))
        out = {**x, "document_id": UPLOAD_DOC + d["upload_name"], "part": UPLOAD_PART + d["upload_name"] if x.get("part") else None}
        if x.get(page_key) is not None:
            out[page_key] = d["pages"].index(x[page_key]) + 1
        return out

    sources = []
    for src in run["sources"]:
        if src["type"] != "document":
            sources.append(src)
            continue
        if norm(src["quote"]) not in norm(pages[src["page"]]["text"]):
            sys.exit(f"seed: a quote of {stem} page {src['page']} is not in that page's text ({src['id']})")
        sources.append(where(src))

    def covered(entries):
        out = []
        for x in entries:
            if x.get("part") is None and x.get("page") is None:
                # The whole combined PDF: every uploaded file.
                out += [{**x, "document_id": UPLOAD_DOC + n, "part": None} for n in names]
            else:
                out.append(where(x))
        return out

    def ref(v):
        """An alert subject or argument that names the combined document or one of its parts."""
        if v == stem:
            sys.exit(f"seed: an alert of {stem} names the whole combined PDF, which the intake uploads as several files")
        if isinstance(v, str) and v in by_part:
            return UPLOAD_PART + upload_of(stem, v, None)["upload_name"]
        return v

    return {
        **run,
        "documents": [{"document_id": UPLOAD_DOC + n, "sha256": upload_sha[n], "parts": [UPLOAD_PART + n]} for n in names],
        "sources": sources,
        "facts": [{**{k: v for k, v in f.items() if k not in ("id", "key")}, "draft_id": f["id"]} for f in run["facts"]],
        "alerts": [{**{k: v for k, v in a.items() if k != "id"}, "subject": ref(a["subject"]),
                    "message": {**a["message"], "args": {k: ref(v) for k, v in a["message"]["args"].items()}}} for a in run["alerts"]],
        "checks": [{**c, "covered": covered(c["covered"]), "unreadable": [where(x) for x in c["unreadable"]]} for c in run["checks"]],
        "run": {k: v for k, v in run["run"].items() if k != "supersedes"},
    }


def finalize_upload_run(draft: dict, doc_ids: dict[str, str], case_id: str, run_id: str) -> dict:
    """What the intake does with the draft (api/src/routes/intake.ts uploadRun, then prepareRun with no previous run):
    swap the placeholders, derive the source IDs from where each passage now is, assign fact IDs for the case, rewrite
    every draft reference and derive the alert IDs. The seed runs it with stand-in document IDs and validates the result,
    so a draft the Worker's storeRun would refuse is never stored."""
    def swap(o):
        if isinstance(o, dict):
            return {k: swap(v) for k, v in o.items()}
        if isinstance(o, list):
            return [swap(v) for v in o]
        if isinstance(o, str) and o.startswith(UPLOAD_PART):
            return f"{doc_ids[o.removeprefix(UPLOAD_PART)]}/p0"
        if isinstance(o, str) and o.startswith(UPLOAD_DOC):
            return doc_ids[o.removeprefix(UPLOAD_DOC)]
        return o

    d = swap(draft)
    taken: set[str] = set()
    new_src: dict[str, str] = {}
    sources = []
    for src in d["sources"]:
        sid = source_id_for({k: v for k, v in src.items() if k != "id"}, taken)
        taken.add(sid)
        new_src[src["id"]] = sid
        sources.append({**src, "id": sid})
    drafts = [{**f, "sources": [new_src[x] for x in f["sources"]]} for f in d["facts"]]
    m = assign_fact_ids(case_id, drafts, sources, None)
    final = {f["draft_id"]: m.facts[i]["id"] for i, f in enumerate(drafts)}
    fid = lambda x: final.get(x, x)  # noqa: E731

    def subject(sv: str) -> str:
        return "|".join(sorted(fid(x) for x in sv.split("|"))) if "|" in sv else fid(sv)

    alerts = []
    for a in d["alerts"]:
        subj = subject(a["subject"])
        args = {k: fid(v) if isinstance(v, str) else v for k, v in a["message"]["args"].items()}
        alerts.append({"id": alert_id({"rule": a["rule"], "subject": subj}), **a, "subject": subj,
                       "facts": [fid(x) for x in a["facts"]], "message": {**a["message"], "args": args}})
    brief = d.get("brief")
    qd = d.get("question_draft")
    return {
        **d, "case_id": case_id, "run": {**d["run"], "id": run_id, "supersedes": None},
        "sources": sources, "facts": m.facts, "alerts": alerts,
        "checks": [{**c, "expected": {"of_fact": fid(c["expected"]["of_fact"])}} if c.get("expected") else c for c in d["checks"]],
        "brief": {**brief, "sentences": [{**x, "facts": [fid(y) for y in x["facts"]]} for x in brief["sentences"]]} if brief else None,
        "question_draft": {**qd, "basis": [{**b, "facts": [fid(y) for y in b["facts"]]} for b in qd["basis"]]} if qd else None,
    }


def prepared_fixture(s, sid, page_index, row, pats, run):
    """R2 objects for one intake fixture: fixtures/<sid>/prepared.json (the draft run over the uploads, the documents'
    titles, the case row and the page metadata) and the page JSON and images of each upload."""
    combined = s["file"]
    pages = {p["n"]: p for p in page_index.get(combined, {}).get("pages", [])}
    uploads = [d for d in s.get("documents") or [] if d.get("upload_name")]
    upload_dir = SAMPLES / combined.removesuffix(".pdf") / "upload"
    upload_sha = {d["upload_name"]: sha256_file(upload_dir / d["upload_name"]) for d in uploads}
    where = {}  # combined page -> (upload name, page inside the upload)
    for d in uploads:
        for j, k in enumerate(d["pages"], 1):
            where[k] = (d["upload_name"], j)

    # The case row's question source is a /1-style reference {file, page, quote} into the combined PDF (the cases
    # table's question_source_json); it points at the uploaded file as "@upload:<name>" with the page inside it.
    def rewrite(o):
        if isinstance(o, dict):
            o = {k: rewrite(v) for k, v in o.items()}
            if o.get("file") == combined and isinstance(o.get("page"), int):
                if o["page"] not in where:
                    sys.exit(f"seed: {combined} page {o['page']} is in no upload")
                name, j = where[o["page"]]
                o = {**o, "file": f"@upload:{name}", "page": j, "orig_file": combined, "orig_page": o["page"]}
            return o
        if isinstance(o, list):
            return [rewrite(v) for v in o]
        return o

    draft = run_for_uploads(run, s, pages, upload_sha)
    # The draft as the Worker will finish it, with each upload's file stem standing in for its document ID: it must pass
    # the validator, and it must say what the fixture run says (the same fact keys and alert rules), only over other files.
    stand_in = {n: n.removesuffix(".pdf") for n in upload_sha}
    trial = finalize_upload_run(draft, stand_in, run["case_id"], run["run"]["id"])
    v = validate_run(trial)
    if not v.ok:
        sys.exit(f"seed: the {sid} run over the uploads is not valid: " + "; ".join(f"{i.code} at {i.path}" for i in v.issues[:8]))
    # A lab result's key names its document ("doc:<id>"), which is now the uploaded file; the rest must be equal.
    keys = lambda r: sorted(re.sub(r"\|doc:[^|]*", "|doc:", f["key"]) for f in r["facts"])  # noqa: E731
    if keys(trial) != keys(run) or sorted(a["rule"] for a in trial["alerts"]) != sorted(a["rule"] for a in run["alerts"]):
        sys.exit(f"seed: the {sid} run over the uploads states other facts or alerts than {RUNS.relative_to(ROOT)}/{run['case_id']}.json")

    case_row = rewrite({
        "diagnosis_text": row.get("diagnosis"), "summary_one_line": row.get("summary"), "question_text": row.get("question"),
        "question_explicit": bool(row.get("explicit")), "question_purpose": row.get("purpose"),
        "question_source_json": row.get("_question_source"), "page_count": row.get("pages"),
    })
    documents = [{k: d.get(k) for k in ("upload_name", "title_cs", "type", "date", "readability", "reason_cs")} for d in uploads]
    page_meta, objs = {}, []
    for d in uploads:
        stem = d["upload_name"].removesuffix(".pdf")
        meta = []
        for j, k in enumerate(d["pages"], 1):
            pg = pages[k]
            red = pg.get("redacted")
            body = {"n": j, "size": pg["size"], "text": pg["text"], "engine": pg["engine"], "words": pg["words"],
                    "mean_conf": pg.get("mean_conf"), "low_conf_words": pg.get("low_conf_words"), "verify": pg.get("verify") or [],
                    "redacted": {"count": red["count"], "reasons": red["reasons"]} if red else None}
            base = f"fixtures/{sid}/pages/{stem}/p{j}"
            folder = DERIVED / "pages" / combined.removesuffix(".pdf")
            objs.append({"key": f"{base}.json", "body": jdump(body).encode(), "content_type": "application/json"})
            objs.append({"key": f"{base}.png", "file": folder / f"p{k}.png", "content_type": "image/png"})
            if red:
                objs.append({"key": f"{base}.redacted.png", "file": folder / f"p{k}.redacted.png", "content_type": "image/png"})
            meta.append({"n": j, "width": pg["size"][0], "height": pg["size"][1], "engine": pg["engine"], "mean_conf": pg.get("mean_conf"),
                         "low_conf_words": pg.get("low_conf_words"), "is_empty": bool(re.fullmatch(r"\s*\[prázdná stránka\]\s*", pg["text"])),
                         "verify_count": len(pg.get("verify") or []), "redacted": bool(red), "redaction_count": red["count"] if red else None,
                         "redaction_reasons": red["reasons"] if red else None})
        page_meta[d["upload_name"]] = meta
    doc = {"schema": "codebridge.prepared/2", "fixture_id": sid, "run": draft, "documents": documents, "case_row": case_row, "pages": page_meta}
    # Strict for this file: not even a quote may carry the patient's name or birth number (step 6 acceptance).
    hits = []
    scan(doc, pats, ["prepared"], hits)
    if hits:
        sys.exit("seed: identity in the prepared extraction: " + ", ".join(".".join(map(str, h[0])) for h in hits[:5]))
    objs.append({"key": f"fixtures/{sid}/prepared.json", "body": jdump(doc).encode(), "content_type": "application/json"})
    print(f"prepared {sid}: {len(uploads)} uploads, {sum(len(m) for m in page_meta.values())} pages, {len(draft['facts'])} facts,"
          f" {len(draft['alerts'])} alerts, quotes checked, run valid over the uploads")
    return objs


# ---------- SQL ----------
def lit(v) -> str:
    """The one SQL literal function: NULL, integers, booleans as 0/1, text with ' doubled."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        v = jdump(v)
    return "'" + str(v).replace("'", "''") + "'"


ROWS: list[tuple[str, dict]] = []  # every seeded row, for the grouped statements of seed/reset.json


# The reset's upserts: people and memberships are restored, never deleted (AUTH.md, "Demo reset is per org"). A
# membership row is updated only when it belongs to the org being reset.
CONFLICT = {
    # roles are global and referenced by memberships, which a reseed keeps.
    "roles": "ON CONFLICT(id) DO UPDATE SET label_cs = excluded.label_cs",
    # {org} is filled per org: a person is renamed only when they have a membership in the org being reset.
    "users": "ON CONFLICT(id) DO UPDATE SET pre = excluded.pre, sur = excluded.sur, post = excluded.post, email = excluded.email, active = 1"
             " WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = {org} AND m.user_id = users.id)",
    "memberships": "ON CONFLICT(id) DO UPDATE SET role_id = excluded.role_id, fn = excluded.fn, active_until = NULL WHERE memberships.org_id = excluded.org_id",
}


def sql_cols(row: dict) -> dict:
    """The columns of a row; keys starting with "_" are bookkeeping (the org of a users row) and never reach SQL."""
    return {k: v for k, v in row.items() if not k.startswith("_")}


def insert(table: str, row: dict) -> str:
    ROWS.append((table, row))
    cols = ", ".join(sql_cols(row))
    vals = ", ".join(lit(v) for v in sql_cols(row).values())
    org = row.get("org_id") or row.get("_org")
    stmt = f"INSERT INTO {table} ({cols}) VALUES ({vals}){' ' + CONFLICT[table].format(org=lit(org)) if table in CONFLICT else ''};"
    if len(stmt.encode()) > MAX_STATEMENT:
        sys.exit(f"seed: statement for {table} is {len(stmt.encode())} bytes, over the D1 limit")
    return stmt


def grouped_inserts(tables: list[str], org: str) -> list[str]:
    """One org's multi-row INSERTs per table, each under the D1 statement limit, so the reset fits few statements."""
    out = []
    for t in tables:
        rows = [sql_cols(r) for tt, r in ROWS if tt == t and (r.get("org_id") or r.get("_org")) == org]
        by_cols: dict[tuple, list[dict]] = {}
        for r in rows:
            by_cols.setdefault(tuple(r), []).append(r)
        tail = f" {CONFLICT[t].format(org=lit(org))}" if t in CONFLICT else ""
        for cols, rs in by_cols.items():
            head = f"INSERT INTO {t} ({', '.join(cols)}) VALUES "
            chunk: list[str] = []
            for r in rs:
                v = "(" + ", ".join(lit(x) for x in r.values()) + ")"
                if chunk and len((head + ", ".join(chunk + [v]) + tail).encode()) > MAX_STATEMENT:
                    out.append(head + ", ".join(chunk) + tail)
                    chunk = []
                chunk.append(v)
            if chunk:
                out.append(head + ", ".join(chunk) + tail)
    return out


def trigger_names(sql: str) -> list[str]:
    return re.findall(r"CREATE TRIGGER (\w+)", sql)


# ---------- wrangler ----------
def wrangler(args: list[str], capture=False) -> str:
    r = subprocess.run(["npx", "wrangler", *args], cwd=API, capture_output=True, text=True)
    if r.returncode != 0:
        # wrangler's own error output carries no patient data (SQL and object bodies are passed as files).
        sys.exit(f"seed: wrangler {' '.join(args[:3])} failed:\n{r.stderr[-2000:] or r.stdout[-2000:]}")
    return r.stdout


# Extra wrangler flags for --target local: --persist-to <dir> when the seed writes into a state directory other than
# wrangler dev's default (.wrangler/state), as the parallel browser suite does (one copy per local Worker).
LOCAL_STATE: list[str] = []


def d1_query(target: str, sql: str):
    out = wrangler(["d1", "execute", DB_NAME, f"--{target}", *(LOCAL_STATE if target == "local" else []), "--json", "--command", sql])
    start = out.index("[")
    return json.loads(out[start:])[0]["results"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["local", "remote"])
    ap.add_argument("--reset", action="store_true", help="wipe every table (also the demo access log) and reseed")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--persist-to", help="with --target local: the wrangler state directory (default .wrangler/state), relative to api/")
    a = ap.parse_args()
    if not a.dry_run and not a.target:
        ap.error("--target is required unless --dry-run")
    if a.persist_to and a.target != "local":
        ap.error("--persist-to needs --target local")
    if a.persist_to:
        LOCAL_STATE.extend(["--persist-to", a.persist_to])
    OUT.mkdir(parents=True, exist_ok=True)
    build = load_build()

    # 1. Fixtures and their hashes.
    inputs = {
        "case": DATA / "mock-case-10.json", "extra": DATA / "mock-case-10-extra.json",
        "list": DATA / "mock-patient-list.json", "prognosis": DATA / "prognosis-case-10.json",
        "page_index": DERIVED / "page-index.json",
    }
    syn_files = sorted(DATA.glob("mock-case-S*.json"))
    hashes = {str(p.relative_to(ROOT)): sha256_file(p) for p in [*inputs.values(), *syn_files]}
    case = json.loads(inputs["case"].read_text())
    extra = json.loads(inputs["extra"].read_text())
    others_list = json.loads(inputs["list"].read_text())
    syn = [json.loads(f.read_text()) for f in syn_files]
    prognosis = json.loads(inputs["prognosis"].read_text())
    page_index = json.loads(build.page_index())
    guidance = {**json.loads(build.guidance()), "prior_assessments": {}}
    for name in ("guidelines-case-10.json", "guidelines-case-10-more.json", "guidelines-case-10-past.json",
                 "guidelines-case-10-past-historic.json", "guideline-fact-refs-case-10.json", "literature-case-10.json",
                 "deviations-case-10.json"):
        if (DATA / name).exists():
            hashes[f"fixtures/data/{name}"] = sha256_file(DATA / name)

    # 2. Staff of both demo orgs: departments, people and their memberships.
    depts, users, members = staff()
    depts_b, users_b, members_b = staff(ORG_B, STAFF_DEPTS_B, "b-", COORD_B, ADMIN_B)
    depts_people = [{"people": [u for u in users if u["id"].startswith(d["id"] + "p")]} for d in depts]

    # 3. Patients and cases.
    rows = initial_patients(case, extra, others_list, syn, depts_people)
    syn_by_file = {s["file"]: s for s in syn}
    sql: list[str] = []
    r2: list[dict] = []  # {key, body (bytes) or file (Path), content_type}

    sql += [insert("roles", {"id": r, "label_cs": l}) for r, l in (("doctor", "lékař"), ("coordinator", "koordinátor(ka) MDT"), ("admin", "správce systému"), ("staff", "personál pracoviště"))]
    # orgs and their demo state are upserted, never deleted: memberships, data and (from step 3) logins point at them,
    # and each org keeps counting its data epoch.
    for o in ORGS:
        sql.append(f"INSERT INTO orgs (id, name, short_name, is_demo, case_id_prefix) VALUES ({lit(o['id'])}, {lit(o['name'])}, {lit(o['short_name'])},"
                   f" {o['is_demo']}, {lit(o['case_id_prefix'])}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,"
                   " is_demo = excluded.is_demo, case_id_prefix = excluded.case_id_prefix;")
        sql.append(f"INSERT INTO demo_state (org_id, data_epoch) VALUES ({lit(o['id'])}, 1) ON CONFLICT(org_id) DO NOTHING;")
    for org, us, ds, dms in ((ORG_A, users, depts, members), (ORG_B, users_b, depts_b, members_b)):
        people, mems = person_rows(org, us)
        sql += [insert("users", x | {"_org": org}) for x in people]
        sql += [insert("memberships", m) for m in mems]
        sql += [insert("departments", d) for d in ds]
        sql += [insert("dept_members", m) for m in dms]

    patients, cases = [], []
    for i, p in enumerate(rows):
        pid = "pt-" + p["id"].removeprefix("NO-")
        processing = "full" if p.get("full") else "partial" if p["file"] in syn_by_file else "none"
        nn = p.get("nameNote")
        patients.append({
            "id": pid, "org_id": ORG_A, "full_name": p["name"], "name_as_written": p.get("nameAsWritten"), "birth_number": p.get("rc"),
            "birth_as_written": p.get("birth"), "age_as_written": p.get("age"), "insurer": p.get("_insurer"),
            "sex": case["patient"].get("sex") if p.get("full") else None,
            "sex_certainty": case["patient"].get("sex_certainty") if p.get("full") else None,
            "identity_warning": p.get("warn"), "name_note_cs": nn["text"] if nn else None,
            "name_note_source_json": nn["src"] if nn and nn.get("src") else None,
            "identity_source_json": {"source": p["_identity_source"]} if p.get("_identity_source") else None,
            "data_origin": "codebridge_synthetic" if p.get("synthetic") else "fno_challenge",
        })
        cases.append({
            "id": p["id"], "org_id": ORG_A, "case_no": p["id"], "patient_id": pid, "source_file": p["file"], "list_order": i, "status": p["status"],
            "processing_level": processing, "question_text": p.get("question"), "question_explicit": bool(p.get("explicit")),
            "question_purpose": p.get("purpose"), "question_source_json": p.get("_question_source"),
            "question_draft": p.get("draft"), "question_kind": p.get("qkind"), "question_basis_json": p.get("basis"),
            "diagnosis_text": p.get("diagnosis"), "diagnosis_note": p.get("diagnosisNote"), "mkn10": p.get("mkn10"),
            "summary_one_line": p.get("summary"), "page_count": p.get("pages"), "referrer_name": p.get("referrer"),
            "referring_dept": p["dept"], "referring_dept_is_example": p["deptExample"],
            "context_note_cs": p.get("_context_note"), "owner_user_id": p.get("_owner_user_id"), "owner_name": p["owner"],
            "owner_is_example": p["ownerExample"], "submitted_on": p["submitted"], "submitted_is_example": p["submittedExample"],
            "updated_on": p["updated"],
        })
    sql += [insert("patients", x) for x in patients]
    sql += [insert("cases", x) for x in cases]

    # 4. Every department is on every seeded case's team, as in the shared demo where every doctor opens every case.
    for c in cases:
        sql += [insert("case_members", {"org_id": ORG_A, "case_id": c["id"], "dept_id": d["id"], "reason": "seed: oddělení MDT"}) for d in depts]
    for p in rows:
        if p.get("slot"):
            sql.append(insert("slots", {"org_id": ORG_A, "day": p["slot"]["day"], "time": p["slot"]["time"], "case_id": p["id"]}))

    # 5. Documents, their logical parts and pages.
    doc_parts = {case["file"]: (extra.get("documents") or [], extra.get("documents_note_cs"))}
    for s in syn:
        doc_parts[s["file"]] = (s.get("documents") or [], None)
    page_count_total = 0
    seeded_docs: dict[str, dict[str, str]] = {}  # case -> {document id: sha256}, for the runs' document check
    seeded_parts: set[str] = set()  # every document_parts.part_id
    for p in rows:
        f = p["file"]
        stem = f.removesuffix(".pdf")
        pdf = FNO_PDFS / f if (FNO_PDFS / f).exists() else SAMPLES / stem / f
        if not pdf.exists():
            sys.exit(f"seed: missing source PDF for {p['id']}")
        pages = page_index.get(f, {}).get("pages", [])
        r2.append({"key": org_key(ORG_A, f"docs/{p['id']}/{stem}.pdf"), "file": pdf, "content_type": "application/pdf"})
        parts, note = doc_parts.get(f, ([], None))
        seeded_docs.setdefault(p["id"], {})[stem] = sha256_file(pdf)
        sql.append(insert("documents", {
            "id": stem, "org_id": ORG_A, "case_id": p["id"], "file_name": f, "page_count": len(pages), "original_r2_key": org_key(ORG_A, f"docs/{p['id']}/{stem}.pdf"),
            "sha256": sha256_file(pdf), "size_bytes": pdf.stat().st_size, "origin": "seed",
            "processing": "processed" if f in doc_parts else "unprocessed", "note_cs": note,
        }))
        # A part's ID is <document id>/p<index in the fixture's documents list>, the ID the converted runs use (C-1).
        for k, d in enumerate(parts):
            seeded_parts.add(f"{stem}/p{k}")
            sql.append(insert("document_parts", {
                "org_id": ORG_A, "document_id": stem, "ordinal": k, "part_id": f"{stem}/p{k}", "title_cs": d["title_cs"], "type": d.get("type"), "date": d.get("date"),
                "date_note_cs": d.get("date_note_cs"), "pages_json": d.get("pages") or [], "readability": d.get("readability"),
                "reason_cs": d.get("reason_cs"), "upload_name": d.get("upload_name"),
            }))
        for pg in pages:
            n = pg["n"]
            folder = DERIVED / "pages" / stem
            red = pg.get("redacted")
            body = {"n": n, "size": pg["size"], "text": pg["text"], "engine": pg["engine"], "words": pg["words"],
                    "mean_conf": pg.get("mean_conf"), "low_conf_words": pg.get("low_conf_words"), "verify": pg.get("verify") or [],
                    "redacted": {"count": red["count"], "reasons": red["reasons"]} if red else None}
            base = org_key(ORG_A, f"pages/{stem}/p{n}")
            r2.append({"key": f"{base}.json", "body": jdump(body).encode(), "content_type": "application/json"})
            r2.append({"key": f"{base}.png", "file": folder / f"p{n}.png", "content_type": "image/png"})
            if red:
                r2.append({"key": f"{base}.redacted.png", "file": folder / f"p{n}.redacted.png", "content_type": "image/png"})
            sql.append(insert("pages", {
                "org_id": ORG_A, "document_id": stem, "n": n, "json_r2_key": f"{base}.json", "image_r2_key": f"{base}.png",
                "redacted_r2_key": f"{base}.redacted.png" if red else None,
                "width": pg["size"][0], "height": pg["size"][1], "engine": pg["engine"], "mean_conf": pg.get("mean_conf"),
                "low_conf_words": pg.get("low_conf_words"), "is_empty": bool(re.fullmatch(r"\s*\[prázdná stránka\]\s*", pg["text"])),
                "verify_count": len(pg.get("verify") or []), "redaction_count": red["count"] if red else None,
                "redaction_reasons_json": red["reasons"] if red else None,
            }))
            page_count_total += 1

    # 6. Extraction runs: the converted codebridge.extraction/2 runs of case 10 and the synthetic patient S01, validated
    # by load_run. S02 enters through "Nový pacient" (step 6): its run is the intake's prepared draft (section 8).
    runs = {}  # case id -> (run, file bytes)
    for p in rows:
        if (RUNS / f"{p['id']}.json").exists():
            runs[p["id"]] = load_run(p["id"])
    if set(runs) != {"NO-010", "NO-S01"}:
        sys.exit(f"seed: expected the runs of NO-010 and NO-S01 in {RUNS.relative_to(ROOT)}, found {sorted(runs)}")
    for cid, (run, _body) in runs.items():
        check_run_documents(run, seeded_docs.get(cid, {}), seeded_parts)
    # The guidance of case 10 points at facts by ID (guideline-fact-refs, patient_facts, deviations); each ID must be a
    # fact of the run it names, or the "Proč" links would open nothing.
    run10 = runs["NO-010"][0]
    # The merged guidance keeps only fact_refs_run_id, so the run each source file names is read from the file itself.
    g_runs = {v for k, v in guidance.items() if k.endswith("run_id")} | {
        json.loads(f.read_text()).get("run_id") for f in DATA.glob("*case-10*.json")} - {None}
    if g_runs - {run10["run"]["id"]}:
        sys.exit(f"seed: guidance/NO-010 names runs {sorted(g_runs)}, not the seeded {run10['run']['id']}")
    unknown = fact_ids_of(guidance) - {f["id"] for f in run10["facts"]}
    if unknown:
        sys.exit(f"seed: guidance/NO-010 names fact IDs that are not in {run10['run']['id']}: {sorted(unknown)[:5]}")

    # 9 (before anything is written). Identity scan over every case-side JSON and every case row.
    pats = identity_patterns(patients)
    stored_json = {f"extract/{cid}": run for cid, (run, _body) in runs.items()}
    stored_json["guidance/NO-010"] = guidance
    stored_json["prognosis/NO-010"] = prognosis
    hits = []
    for name, obj in stored_json.items():
        scan(obj, pats, [name], hits)
    for c in cases:
        scan(c, pats, [f"cases/{c['id']}"], hits)
    # The scan must see the names in the unstripped fixtures; if it does not, the scan is broken, not the data clean.
    # Document notes and titles end up in D1 columns outside patients, so they are scanned as well.
    scan({"documents": {f: v for f, v in doc_parts.items()}}, pats, ["documents"], hits)
    # The scan must find every patient in the unstripped fixtures; if it misses one, the scan is broken, not the data clean.
    for pt in patients:
        control = []
        scan({"case": case, "syn": syn, "list": others_list}, patient_patterns(pt), ["control"], control)
        if not control:
            sys.exit(f"seed: identity scan self-check failed for {pt['id']} (its name is not found in the unstripped fixtures)")
    bad = [h for h in hits if not is_quote_path(h[0])]
    lines = [f"{'OK  ' if is_quote_path(p) else 'FAIL'} {kind} {'.'.join(map(str, p))}" for p, kind in hits]
    (OUT / "identity-scan.txt").write_text(
        "# Paths (never values) where a patient's name or birth number occurs in case-side data.\n"
        "# OK: inside a quote (source evidence, kept verbatim). FAIL: anywhere else; the seed stops.\n" + "\n".join(lines) + "\n")
    print(f"identity scan: {len(hits)} hits, {len(hits) - len(bad)} inside quotes, {len(bad)} outside")
    if bad:
        sys.exit("seed: identity found outside quotes; see api/seed/out/identity-scan.txt")

    # The run file's bytes go to R2 unchanged; D1 gets its row (seeded, so the demo reset keeps it), every fact ID it
    # issues (the matcher's issuedIds) and every alert identity (what acknowledgements attach to).
    for cid, (run, body) in runs.items():
        run_id = run["run"]["id"]
        key = org_key(ORG_A, f"extract/{cid}/{run_id}.json")
        r2.append({"key": key, "body": body, "content_type": "application/json"})
        sql.append(insert("extraction_runs", {
            "id": run_id, "org_id": ORG_A, "case_id": cid, "producer": "fixture", "seeded": 1, "schema": run["schema"],
            "supersedes": None, "model": None, "prompt_version": None, "temperature": None,
            "input_hashes_json": {f"fixtures/data/runs/{cid}.json": sha256_bytes(body), **{d["document_id"]: d.get("sha256") for d in run["documents"]}},
            "r2_key": key, "sha256": sha256_bytes(body), "is_current": True, "created_at": run["run"]["created_at"],
        }))
        sql += [insert("fact_ids", {"org_id": ORG_A, "case_id": cid, "fact_id": f["id"], "first_run_id": run_id}) for f in run["facts"]]
        sql += [insert("alert_identities", {"org_id": ORG_A, "case_id": cid, "id": a["id"], "rule": a["rule"], "subject": a["subject"],
                                            "kind": a["kind"], "first_run_id": run_id}) for a in run["alerts"]]
    # Guidance and the saved prognosis replay have no table of their own: the Worker reads them by their fixed key.
    r2.append({"key": "guidance/NO-010.json", "body": jdump(guidance).encode(), "content_type": "application/json"})
    r2.append({"key": "prognosis/NO-010/saved-2026-10-22.json", "body": jdump(prognosis).encode(), "content_type": "application/json"})

    # 7. The two example tasks of the mock, assigned to the coordinator.
    for t in ({"id": 1, "case_id": "NO-002", "text": "doplnit pooperační MR do podkladů", "done": False},
              {"id": 2, "case_id": "NO-013", "text": "vyžádat snímky MR 8/2025 ke srovnání", "done": True}):
        sql.append(insert("tasks", {**t, "org_id": ORG_A, "assignee_user_id": "coord", "assignee_name": staff_name(COORD), "due": "2026-10-21"}))

    # 8. Fixture registry (step 6): every synthetic file the upload route accepts, matched by the SHA-256 of its bytes.
    # Each fixture names its patient in fixture_patients (D1 only), so a file uploaded into another patient's case is
    # recognised at once. The seeded cases' own PDFs are fixtures too (FNO's challenge PDFs and S01).
    fixture_rows, fixture_pats = [], []
    # Only a written date ("nar. 14.6.1958") is a birth date; an age such as "53 let" is not, and nothing is inferred.
    def birth_of(v):
        m = re.fullmatch(r"(?:nar\.\s*)?(\d{1,2}\.\d{1,2}\.\d{4})", (v or "").strip())
        return m.group(1) if m else None
    pat_by_id = {x["id"]: x for x in patients}
    for p in rows:
        f = p["file"]
        stem = f.removesuffix(".pdf")
        pdf = FNO_PDFS / f if (FNO_PDFS / f).exists() else SAMPLES / stem / f
        fid = stem.removesuffix("_pacient") if f in syn_by_file else "FNO-" + stem.removesuffix("_pacient")
        pt = pat_by_id["pt-" + p["id"].removeprefix("NO-")]
        fixture_pats.append({"fixture_id": fid, "full_name": pt["full_name"], "birth_number": pt["birth_number"],
                             "birth_as_written": pt.get("birth_as_written"), "data_origin": pt["data_origin"]})
        fixture_rows.append({"sha256": sha256_file(pdf), "fixture_id": fid, "file_name": f, "r2_prefix": org_key(ORG_A, f"docs/{p['id']}/"),
                             "kind": "combined", "size_bytes": pdf.stat().st_size, "title_cs": None, "doc_type": None, "doc_date": None,
                             "page_count": len(page_index.get(f, {}).get("pages", [])), "combined_pages_json": None})
    for s in syn:
        if not s.get("intake_demo"):
            continue
        sid = s["file"].removesuffix("_pacient.pdf")
        le = s["list_entry"]
        # The birth date as the documents write it, so the completed intake shows the age (migration 0008).
        fixture_pats.append({"fixture_id": sid, "full_name": le["name"], "birth_number": le.get("rc") or None,
                             "birth_as_written": birth_of(le.get("age_or_birth")), "data_origin": "codebridge_synthetic"})
        combined = SAMPLES / f"{sid}_pacient" / s["file"]
        fixture_rows.append({"sha256": sha256_file(combined), "fixture_id": sid, "file_name": s["file"], "r2_prefix": f"fixtures/{sid}/",
                             "kind": "combined", "size_bytes": combined.stat().st_size, "title_cs": None, "doc_type": None, "doc_date": None,
                             "page_count": le.get("page_count"), "combined_pages_json": None})
        by_upload = {d["upload_name"]: d for d in s.get("documents") or [] if d.get("upload_name")}
        for f in sorted((SAMPLES / f"{sid}_pacient" / "upload").iterdir()):
            if not f.is_file():
                continue
            ct = "application/pdf" if f.suffix == ".pdf" else "application/fhir+json" if f.suffix == ".json" else "application/octet-stream"
            r2.append({"key": f"fixtures/{sid}/upload/{f.name}", "file": f, "content_type": ct})
            d = by_upload.get(f.name)
            if f.suffix == ".pdf" and not d:
                sys.exit(f"seed: {f.name} is not listed as an upload_name in {s['file']}'s documents")
            fixture_rows.append({"sha256": sha256_file(f), "fixture_id": sid, "file_name": f.name, "r2_prefix": f"fixtures/{sid}/",
                                 "kind": "upload" if f.suffix == ".pdf" else "referral", "size_bytes": f.stat().st_size,
                                 "title_cs": d["title_cs"] if d else None, "doc_type": d.get("type") if d else None,
                                 "doc_date": d.get("date") if d else None, "page_count": len(d["pages"]) if d else None,
                                 "combined_pages_json": d["pages"] if d else None})
        # The prepared extraction an intake attaches (POST /api/cases/:id/intake/complete): the fixture's converted run
        # (fixtures/data/runs/NO-S02.json) re-pointed from the combined PDF to one uploaded file per document, with each
        # page numbered inside its file (run_for_uploads); the Worker swaps in the uploaded documents' IDs and assigns
        # the case's fact IDs. Each upload's pages are stored under its name.
        # The intake patient is not in patients (it enters through "Nový pacient"), so its own patterns are added, with
        # the same self-check as above: they must find the patient in the unstripped fixture.
        fx_pats = patient_patterns({"full_name": le["name"], "birth_number": le.get("rc"),
                                    "birth_as_written": re.sub(r"^nar\.\s*", "", le.get("age_or_birth") or "") or None})
        control = []
        scan(s, fx_pats, ["control"], control)
        if not control:
            sys.exit(f"seed: identity scan self-check failed for fixture {sid}")
        fx_run, _ = load_run(case_id(s["file"]))
        prepared_objs = prepared_fixture(s, sid, page_index, list_patient(le, None, {}, syn_by_file), pats + fx_pats, fx_run)
        r2.extend(prepared_objs)
    # Titles end up in documents rows outside patients, so they get the identity scan too.
    fx_hits = []
    scan([{k: v for k, v in r.items() if k not in ("sha256",)} for r in fixture_rows], pats, ["fixture_files"], fx_hits)
    if fx_hits:
        sys.exit("seed: identity found in the fixture registry: " + ", ".join(".".join(map(str, h[0])) for h in fx_hits))
    sql += [insert("fixture_patients", x) for x in fixture_pats]
    sql += [insert("fixture_files", x) for x in fixture_rows]
    (OUT / "fixtures.json").write_text(json.dumps([{k: v for k, v in r.items()} for r in fixture_rows], ensure_ascii=False, indent=1))

    git = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "unknown"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    sql.append(insert("seed_meta", {"id": 1, "seeded_at": now, "git_commit": git, "fixtures_json": hashes}))

    # 10. The SQL file. A reset empties every table of every org inside the demo_state flag that lets the append-only
    # triggers through (migration 0011, per org), then reseeds and bumps each org's data_epoch, so every open tab
    # reloads instead of writing into data it never saw. People, orgs and their demo state are upserted, never deleted.
    # Without --reset the database must be empty (checked below).
    prefix = []
    if a.reset:
        prefix += ["UPDATE demo_state SET reset_in_progress = 1;"]
        prefix += [f"DELETE FROM {t};" for t in reversed(TABLES)]
        prefix += ["DELETE FROM sqlite_sequence WHERE name <> 'demo_state';"]
        seeded = jdump([r["id"] for t, r in ROWS if t == "memberships"])
        prefix += [f"UPDATE memberships SET active_until = {lit(now)} WHERE active_until IS NULL AND id NOT IN (SELECT value FROM json_each({lit(seeded)}));"]
    suffix = [f"UPDATE demo_state SET reset_in_progress = 0, data_epoch = data_epoch + {1 if a.reset else 0}, seed_version = {lit(git)},"
              f" reset_at = {lit(now) if a.reset else 'reset_at'}, reset_by = {lit('seed.py') if a.reset else 'reset_by'};"]
    sql = sql + suffix
    # Demo org B is the team's empty org (a user decision): its seed is its setup only, people and departments. A row of
    # any other table, or an R2 object under its prefix, would put patient or case data back into it.
    b_setup = {"users", "memberships", "departments", "dept_members"}
    b_rows = sorted({t for t, r in ROWS if (r.get("org_id") or r.get("_org")) == ORG_B} - b_setup)
    # Global prefixes (extract/, guidance/, prognosis/) are keyed by case ID, so an org B case ("B-...") counts as well.
    b_prefix = ORGS[1]["case_id_prefix"]
    b_rows += sorted({t for t, r in ROWS if str(r.get("case_id") or "").startswith(b_prefix)} - set(b_rows))
    b_keys = [o["key"] for o in r2 if o["key"].startswith(org_key(ORG_B, "")) or f"/{b_prefix}" in o["key"]]
    if b_rows or b_keys:
        sys.exit(f"seed: demo org B must hold no patient or case data; found rows in {b_rows} and {len(b_keys)} R2 objects")
    # seed/reset.json: per demo org, the mutable tables' rows for reset-demo, grouped so the reset stays one small D1
    # batch, the seeded patients (kept) and the seeded memberships (restored; any other membership of the org ends).
    reset_doc = {"seed_version": git, "seeded_at": now, "tables": MUTABLE, "orgs": {
        org: {"statements": grouped_inserts(MUTABLE, org), "patient_ids": [x["id"] for x in patients if x["org_id"] == org],
              "membership_ids": [r["id"] for t, r in ROWS if t == "memberships" and r["org_id"] == org]}
        for org in (ORG_A, ORG_B)}}
    r2.append({"key": RESET_KEY, "body": jdump(reset_doc).encode(), "content_type": "application/json"})
    (OUT / "seed.sql").write_text("\n".join(prefix + sql) + "\n")
    # The manifest lists keys, local source files and hashes only; generated bodies are written next to it.
    bodies = OUT / "objects"
    manifest = []
    for o in r2:
        if "body" in o:
            path = bodies / o["key"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(o["body"])
            o["file"] = path
        manifest.append({"key": o["key"], "file": str(Path(o["file"]).relative_to(ROOT)), "content_type": o["content_type"], "sha256": sha256_file(Path(o["file"]))})
    (OUT / "r2-manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(prefix) + len(sql)} SQL statements and {len(manifest)} R2 objects to api/seed/out/")
    if a.dry_run:
        return

    t = a.target
    # Migrations are idempotent; applying them first means a fresh local state works with one command.
    local = LOCAL_STATE if t == "local" else []
    wrangler(["d1", "migrations", "apply", DB_NAME, f"--{t}", *local])
    if not a.reset and d1_query(t, "SELECT COUNT(*) AS n FROM seed_meta")[0]["n"]:
        sys.exit("seed: the database is already seeded; rerun with --reset to wipe it (this also deletes the demo access log)")

    # 11. R2 first, so D1 never points at a missing object. Unchanged objects are skipped on later runs.
    # One record per state directory: each holds its own R2 objects.
    state_dir = API / (a.persist_to or ".wrangler/state")
    tag = t if not a.persist_to else f"{t}-{hashlib.sha256(str(state_dir.resolve()).encode()).hexdigest()[:12]}"
    state_file = OUT / f".seed-state-{tag}.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if t == "local" and not (state_dir / "v3" / "r2").exists():
        state = {}  # the local state was wiped, so the record of uploads no longer holds
    todo = [m for m in manifest if state.get(m["key"]) != m["sha256"]]
    loc = ["--local", *local] if t == "local" else ["--remote", "--jurisdiction", "eu"]

    def put(m):
        wrangler(["r2", "object", "put", f"{BUCKET}/{m['key']}", "--file", str(ROOT / m["file"]), "--content-type", m["content_type"], *loc])
        return m

    # Local puts share one SQLite file in .wrangler/state and fail when run in parallel.
    with concurrent.futures.ThreadPoolExecutor(1 if t == "local" else 6) as ex:
        for m in ex.map(put, todo):
            state[m["key"]] = m["sha256"]
            state_file.write_text(json.dumps(state))
    print(f"uploaded {len(todo)} R2 objects ({len(manifest) - len(todo)} unchanged)")

    # 12. D1.
    r = subprocess.run(["npx", "wrangler", "d1", "execute", DB_NAME, f"--{t}", *local, "--yes", "--file", str(OUT / "seed.sql")],
                       cwd=API, capture_output=True, text=True)
    if r.returncode != 0:
        # A reset that stops half way can leave the append-only triggers dropped; say so, since nothing else will.
        # A reset that stops half way leaves reset_in_progress = 1: writes answer 503 "resetting" until a rerun.
        sys.exit("seed: d1 execute failed (writes stay paused while demo_state.reset_in_progress = 1;"
                 f" rerun with --reset):\n{r.stderr[-2000:] or r.stdout[-2000:]}")

    # 13. Verify counts, the runs and that every append-only trigger exists.
    counts = d1_query(t, "SELECT (SELECT COUNT(*) FROM patients) p, (SELECT COUNT(*) FROM cases) c, (SELECT COUNT(*) FROM documents) d,"
                         " (SELECT COUNT(*) FROM pages) pg, (SELECT COUNT(*) FROM tasks) t, (SELECT COUNT(*) FROM fixture_files) f,"
                         " (SELECT COUNT(*) FROM extraction_runs WHERE seeded = 1 AND is_current = 1 AND schema = 'codebridge.extraction/2') r2,"
                         " (SELECT COUNT(*) FROM extraction_runs WHERE schema <> 'codebridge.extraction/2') r1, (SELECT COUNT(*) FROM alerts) a1,"
                         " (SELECT COUNT(*) FROM fact_ids) fi, (SELECT COUNT(*) FROM alert_identities) ai")[0]
    print("seeded:", counts)
    run_parts = sorted({x for run, _ in runs.values() for d in run["documents"] for x in d["parts"]})
    parts_found = d1_query(t, f"SELECT COUNT(*) AS n FROM document_parts WHERE org_id = {lit(ORG_A)} AND part_id IN"
                              f" (SELECT value FROM json_each({lit(jdump(run_parts))}))")[0]["n"]
    want_counts = {"r2": len(runs), "r1": 0, "a1": 0, "fi": sum(len(r["facts"]) for r, _ in runs.values()),
                   "ai": sum(len(r["alerts"]) for r, _ in runs.values())}
    wrong = {k: (counts[k], v) for k, v in want_counts.items() if counts[k] != v}
    if parts_found != len(run_parts):
        wrong["run parts in document_parts"] = (parts_found, len(run_parts))
    # Each stored run object is the fixture file, byte for byte (the R2 read-back of the two runs).
    for cid, (run, body) in runs.items():
        back = OUT / "verify" / f"{cid}.json"
        back.parent.mkdir(parents=True, exist_ok=True)
        wrangler(["r2", "object", "get", f"{BUCKET}/{org_key(ORG_A, f'extract/{cid}/{run['run']['id']}.json')}", "--file", str(back), *loc])
        if back.read_bytes() != body:
            wrong[f"R2 run of {cid}"] = ("differs", "the fixture file")
        back.unlink()
    # The append-only triggers are checked by name, not by counting all triggers, so a later migration that adds
    # other triggers (0013 adds the document lifecycle ones) does not fail the seed.
    have = {r["name"] for r in d1_query(t, "SELECT name FROM sqlite_master WHERE type='trigger'")}
    # 0016 adds the append-only triggers of the codebridge.extraction/2 tables and redefines the reset trigger.
    want = set(trigger_names((MIGRATIONS / "0002_append_only.sql").read_text()))
    want |= {n for n in trigger_names((MIGRATIONS / "0016_extraction_v2.sql").read_text()) if n.endswith(("_no_update", "_no_delete")) or n == "demo_reset_uploads"}
    # 0015 removes the NIS links at a demo reset; without the trigger a reset would leave links to deleted patients.
    want |= set(trigger_names((MIGRATIONS / "0015_patient_nis_links.sql").read_text()))
    missing = sorted(want - have)
    if missing or wrong or counts["p"] != len(patients) or counts["pg"] != page_count_total:
        sys.exit(f"seed: verification failed (missing triggers {missing}; got vs expected {wrong}; expected"
                 f" {len(patients)} patients, {page_count_total} pages, got {counts['p']} and {counts['pg']})")
    print(f"verified: {len(runs)} seeded /2 runs current and equal to their files, {want_counts['fi']} fact IDs,"
          f" {want_counts['ai']} alert identities, {len(run_parts)} run parts seeded, no /1 run or alert")


if __name__ == "__main__":
    main()
