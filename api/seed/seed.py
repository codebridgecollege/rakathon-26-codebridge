# /// script
# requires-python = ">=3.11"
# ///
"""Seed the Worker's D1 database and R2 bucket from the synthetic fixtures in the repository.

Usage (from the repository root or from api/):
    uv run api/seed/seed.py --target local [--reset]     # wrangler dev state in api/.wrangler
    uv run api/seed/seed.py --target remote [--reset]    # the EU database and bucket
    uv run api/seed/seed.py --dry-run                    # write api/seed/out/ only

Reads only synthetic data that is committed: mocks/src/data/, data/derived/, data/rakathon-26/ (the organizers'
synthetic challenge PDFs) and samples/. It never opens private/.

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
API = ROOT / "api"
OUT = API / "seed" / "out"
DATA = ROOT / "mocks" / "src" / "data"
DERIVED = ROOT / "data" / "derived"
FNO_PDFS = ROOT / "data" / "rakathon-26" / "2_AI asistent MDT"
SAMPLES = ROOT / "samples"
MIGRATIONS = API / "migrations"
DB_NAME = "codebridge-mdt"
BUCKET = "codebridge-mdt"
MAX_STATEMENT = 90_000  # D1 refuses SQL statements over 100 KB; keep a margin.

# Tables in dependency order (parents first). DELETE runs in the reverse order.
TABLES = [
    "roles", "departments", "users", "dept_members", "patients", "cases", "case_members", "status_history",
    "slots", "sessions", "attendance", "protocols", "decisions", "task_suggestions", "tasks",
    "question_confirmations", "fact_edits", "edit_log", "extraction_runs", "alerts", "alert_events",
    "documents", "document_parts", "pages", "fixture_files", "transcript_passes", "transcript_lines", "jobs",
    "access_log", "seed_meta",
]


def load_build():
    """mocks/build.py's page_index() and guidance(), so the seeded data is byte-for-byte what the mock embeds."""
    spec = importlib.util.spec_from_file_location("mock_build", ROOT / "mocks" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # main() is guarded, so importing builds nothing
    return mod


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def jdump(o) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


# ---------- staff: the same values as defaultStaff() in mocks/src/v3-template.html ----------
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


def staff_name(x) -> str:
    base = " ".join(s.strip() for s in (x["pre"], x["sur"]) if s and s.strip())
    return base + (f", {x['post'].strip()}" if x["post"].strip() else "")


def staff():
    depts, users, members = [], [], []
    for i, (name, surs) in enumerate(STAFF_DEPTS):
        did = f"d{i + 1}"
        depts.append({"id": did, "name": name, "sort": i})
        for j, sur in enumerate(surs):
            u = {"id": f"{did}p{j + 1}", "pre": "MUDr.", "sur": sur, "post": "", "fn": "", "role": "doctor"}
            users.append(u)
            members.append({"dept_id": did, "user_id": u["id"], "position": j})
    users += [COORD, ADMIN]
    return depts, users, members


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


def identity_patterns(patients):
    """Per patient: word-start patterns for each name part (and a stem, to catch Czech case endings) and the birth number digits."""
    pats = []
    for p in patients:
        tokens = [t for t in re.split(r"[\s,]+", fold(p["full_name"])) if len(t) >= 3]
        for t in tokens:
            stem = t[:-2] if len(t) >= 6 else t
            pats.append(re.compile(r"(?<![a-z])" + re.escape(stem)))
        if p.get("birth_number"):
            digits = re.sub(r"\D", "", p["birth_number"])
            pats.append(re.compile(re.escape(digits)))
    return pats


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


def strip_case10(case, extra):
    c = json.loads(json.dumps(case))
    e = json.loads(json.dumps(extra))
    pat = c.get("patient", {})
    for k in ("name", "name_as_written", "birth_number", "birth_date", "age", "insurer", "source"):
        pat.pop(k, None)
    # The page text lives in the per-page objects; v3 does not read this copy.
    c.pop("full_text_by_page", None)
    # Other patients' details become their own case rows.
    e.pop("others", None)
    return c, e


def strip_syn(s):
    s = json.loads(json.dumps(s))
    le = s.get("list_entry", {})
    s["list_entry"] = {"file": le.get("file"), "page_count": le.get("page_count")}
    s.pop("others_entry", None)
    s.pop("fhir_referral", None)
    return s


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


def insert(table: str, row: dict) -> str:
    cols = ", ".join(row)
    vals = ", ".join(lit(v) for v in row.values())
    stmt = f"INSERT INTO {table} ({cols}) VALUES ({vals});"
    if len(stmt.encode()) > MAX_STATEMENT:
        sys.exit(f"seed: statement for {table} is {len(stmt.encode())} bytes, over the D1 limit")
    return stmt


def trigger_names(sql: str) -> list[str]:
    return re.findall(r"CREATE TRIGGER (\w+)", sql)


# ---------- wrangler ----------
def wrangler(args: list[str], capture=False) -> str:
    r = subprocess.run(["npx", "wrangler", *args], cwd=API, capture_output=True, text=True)
    if r.returncode != 0:
        # wrangler's own error output carries no patient data (SQL and object bodies are passed as files).
        sys.exit(f"seed: wrangler {' '.join(args[:3])} failed:\n{r.stderr[-2000:] or r.stdout[-2000:]}")
    return r.stdout


def d1_query(target: str, sql: str):
    out = wrangler(["d1", "execute", DB_NAME, f"--{target}", "--json", "--command", sql])
    start = out.index("[")
    return json.loads(out[start:])[0]["results"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["local", "remote"])
    ap.add_argument("--reset", action="store_true", help="wipe every table (also the demo access log) and reseed")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not a.dry_run and not a.target:
        ap.error("--target is required unless --dry-run")
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
            hashes[f"mocks/src/data/{name}"] = sha256_file(DATA / name)

    # 2. Staff.
    depts, users, members = staff()
    depts_people = [{"people": [u for u in users if u["id"].startswith(d["id"] + "p")]} for d in depts]

    # 3. Patients and cases.
    rows = initial_patients(case, extra, others_list, syn, depts_people)
    syn_by_file = {s["file"]: s for s in syn}
    sql: list[str] = []
    r2: list[dict] = []  # {key, body (bytes) or file (Path), content_type}

    sql += [insert("roles", {"id": r, "label_cs": l}) for r, l in (("doctor", "lékař"), ("coordinator", "koordinátor(ka) MDT"), ("admin", "správce systému"))]
    sql += [insert("departments", d) for d in depts]
    sql += [insert("users", {k: u[k] for k in ("id", "pre", "sur", "post", "fn")} | {"role_id": u["role"]}) for u in users]
    sql += [insert("dept_members", m) for m in members]

    patients, cases = [], []
    for i, p in enumerate(rows):
        pid = "pt-" + p["id"].removeprefix("NO-")
        processing = "full" if p.get("full") else "partial" if p["file"] in syn_by_file else "none"
        nn = p.get("nameNote")
        patients.append({
            "id": pid, "full_name": p["name"], "name_as_written": p.get("nameAsWritten"), "birth_number": p.get("rc"),
            "birth_as_written": p.get("birth"), "age_as_written": p.get("age"), "insurer": p.get("_insurer"),
            "sex": case["patient"].get("sex") if p.get("full") else None,
            "sex_certainty": case["patient"].get("sex_certainty") if p.get("full") else None,
            "identity_warning": p.get("warn"), "name_note_cs": nn["text"] if nn else None,
            "name_note_source_json": nn["src"] if nn and nn.get("src") else None,
            "identity_source_json": {"source": p["_identity_source"]} if p.get("_identity_source") else None,
            "data_origin": "codebridge_synthetic" if p.get("synthetic") else "fno_challenge",
        })
        cases.append({
            "id": p["id"], "patient_id": pid, "source_file": p["file"], "list_order": i, "status": p["status"],
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
        sql += [insert("case_members", {"case_id": c["id"], "dept_id": d["id"], "reason": "seed: oddělení MDT"}) for d in depts]
    for p in rows:
        if p.get("slot"):
            sql.append(insert("slots", {"day": p["slot"]["day"], "time": p["slot"]["time"], "case_id": p["id"]}))

    # 5. Documents, their logical parts and pages.
    doc_parts = {case["file"]: (extra.get("documents") or [], extra.get("documents_note_cs"))}
    for s in syn:
        doc_parts[s["file"]] = (s.get("documents") or [], None)
    page_count_total = 0
    for p in rows:
        f = p["file"]
        stem = f.removesuffix(".pdf")
        pdf = FNO_PDFS / f if (FNO_PDFS / f).exists() else SAMPLES / stem / f
        if not pdf.exists():
            sys.exit(f"seed: missing source PDF for {p['id']}")
        pages = page_index.get(f, {}).get("pages", [])
        r2.append({"key": f"docs/{p['id']}/{stem}.pdf", "file": pdf, "content_type": "application/pdf"})
        parts, note = doc_parts.get(f, ([], None))
        sql.append(insert("documents", {
            "id": stem, "case_id": p["id"], "file_name": f, "page_count": len(pages), "original_r2_key": f"docs/{p['id']}/{stem}.pdf",
            "sha256": sha256_file(pdf), "size_bytes": pdf.stat().st_size, "origin": "seed",
            "processing": "processed" if f in doc_parts else "unprocessed", "note_cs": note,
        }))
        for k, d in enumerate(parts):
            sql.append(insert("document_parts", {
                "document_id": stem, "ordinal": k, "title_cs": d["title_cs"], "type": d.get("type"), "date": d.get("date"),
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
            r2.append({"key": f"pages/{stem}/p{n}.json", "body": jdump(body).encode(), "content_type": "application/json"})
            r2.append({"key": f"pages/{stem}/p{n}.png", "file": folder / f"p{n}.png", "content_type": "image/png"})
            if red:
                r2.append({"key": f"pages/{stem}/p{n}.redacted.png", "file": folder / f"p{n}.redacted.png", "content_type": "image/png"})
            sql.append(insert("pages", {
                "document_id": stem, "n": n, "json_r2_key": f"pages/{stem}/p{n}.json", "image_r2_key": f"pages/{stem}/p{n}.png",
                "redacted_r2_key": f"pages/{stem}/p{n}.redacted.png" if red else None,
                "width": pg["size"][0], "height": pg["size"][1], "engine": pg["engine"], "mean_conf": pg.get("mean_conf"),
                "low_conf_words": pg.get("low_conf_words"), "is_empty": bool(re.fullmatch(r"\s*\[prázdná stránka\]\s*", pg["text"])),
                "verify_count": len(pg.get("verify") or []), "redaction_count": red["count"] if red else None,
                "redaction_reasons_json": red["reasons"] if red else None,
            }))
            page_count_total += 1

    # 6. Extraction runs and alerts (case 10 and the synthetic patient S01).
    def alert_rows(cid, flags, gaps):
        out, ids = [], {"flag": [], "gap": []}
        for origin, items in (("flag", flags), ("gap", gaps)):
            for pos, it in enumerate(items):
                src = (it.get("based_on") or it.get("refs") or [it.get("source")] or [None])[0] or {}
                basis = f"{src.get('file')}:{src.get('page')}:{src.get('quote')}"
                aid = "al-" + sha256_bytes(f"{cid}|{origin}|{it['kind']}|{it['text_cs']}|{basis}".encode())[:16]
                ids[origin].append(aid)
                out.append({"id": aid, "case_id": cid, "origin": origin, "position": pos, "kind": it["kind"],
                            "text_cs": it["text_cs"], "relevant": bool(it.get("relevant"))})
        return out, ids

    extractions = []  # (case id, json object)
    c10, e10 = strip_case10(case, extra)
    al10, ids10 = alert_rows("NO-010", case.get("flags") or [], extra.get("data_gaps_v3") or [])
    extractions.append(("NO-010", {"case": c10, "extra": e10, "alert_ids": ids10}, al10, "full"))
    for s in syn:
        if s.get("intake_demo"):
            continue  # S02 enters through "Nový pacient" (Step 6); only its upload files are stored below.
        cid = case_id(s["file"])
        al, ids = alert_rows(cid, [], s.get("data_gaps") or [])
        extractions.append((cid, {"syn": strip_syn(s), "alert_ids": ids}, al, "partial"))

    # 9 (before anything is written). Identity scan over every case-side JSON and every case row.
    pats = identity_patterns(patients)
    stored_json = {}
    for cid, data, _, processing in extractions:
        stored_json[f"extract/{cid}"] = {"schema": "codebridge.extraction/1", "case_id": cid, "processing": processing, **data}
    stored_json["guidance/NO-010"] = guidance
    stored_json["prognosis/NO-010"] = prognosis
    hits = []
    for name, obj in stored_json.items():
        scan(obj, pats, [name], hits)
    for c in cases:
        scan(c, pats, [f"cases/{c['id']}"], hits)
    # The scan must see the names in the unstripped fixtures; if it does not, the scan is broken, not the data clean.
    control = []
    scan({"case": case, "syn": syn}, pats, ["control"], control)
    if not any(not is_quote_path(h[0]) for h in control):
        sys.exit("seed: identity scan self-check failed (found no names in the unstripped fixtures)")
    bad = [h for h in hits if not is_quote_path(h[0])]
    lines = [f"{'OK  ' if is_quote_path(p) else 'FAIL'} {kind} {'.'.join(map(str, p))}" for p, kind in hits]
    (OUT / "identity-scan.txt").write_text(
        "# Paths (never values) where a patient's name or birth number occurs in case-side data.\n"
        "# OK: inside a quote (source evidence, kept verbatim). FAIL: anywhere else; the seed stops.\n" + "\n".join(lines) + "\n")
    print(f"identity scan: {len(hits)} hits, {len(hits) - len(bad)} inside quotes, {len(bad)} outside")
    if bad:
        sys.exit("seed: identity found outside quotes; see api/seed/out/identity-scan.txt")

    for cid, data, al, processing in extractions:
        doc = stored_json[f"extract/{cid}"]
        body = jdump(doc).encode()
        run_id = f"seed-{cid}-{sha256_bytes(body)[:8]}"
        doc = {**doc, "run_id": run_id}
        body = jdump(doc).encode()
        key = f"extract/{cid}/{run_id}.json"
        r2.append({"key": key, "body": body, "content_type": "application/json"})
        sql.append(insert("extraction_runs", {
            "id": run_id, "case_id": cid, "kind": "seed_fixture", "model": None, "prompt_version": None, "temperature": None,
            "input_hashes_json": hashes, "r2_key": key, "sha256": sha256_bytes(body), "is_current": True,
        }))
        sql += [insert("alerts", {**x, "run_id": run_id}) for x in al]
    # Guidance and the saved prognosis replay have no table of their own: the Worker reads them by their fixed key.
    r2.append({"key": "guidance/NO-010.json", "body": jdump(guidance).encode(), "content_type": "application/json"})
    r2.append({"key": "prognosis/NO-010/saved-2026-10-22.json", "body": jdump(prognosis).encode(), "content_type": "application/json"})

    # 7. The two example tasks of the mock, assigned to the coordinator.
    for t in ({"id": 1, "case_id": "NO-002", "text": "doplnit pooperační MR do podkladů", "done": False},
              {"id": 2, "case_id": "NO-013", "text": "vyžádat snímky MR 8/2025 ke srovnání", "done": True}):
        sql.append(insert("tasks", {**t, "assignee_user_id": "coord", "assignee_name": staff_name(COORD), "due": "2026-10-21"}))

    # 8. Fixture library: the intake demo's upload files, matched by hash when Step 6 accepts uploads.
    for s in syn:
        if not s.get("intake_demo"):
            continue
        sid = s["file"].removesuffix("_pacient.pdf")
        for f in sorted((SAMPLES / f"{sid}_pacient" / "upload").iterdir()):
            if not f.is_file():
                continue
            ct = "application/pdf" if f.suffix == ".pdf" else "application/fhir+json" if f.suffix == ".json" else "application/octet-stream"
            r2.append({"key": f"fixtures/{sid}/upload/{f.name}", "file": f, "content_type": ct})
            sql.append(insert("fixture_files", {"sha256": sha256_file(f), "fixture_id": sid, "file_name": f.name, "r2_prefix": f"fixtures/{sid}/"}))

    git = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "unknown"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    sql.append(insert("seed_meta", {"id": 1, "seeded_at": now, "git_commit": git, "fixtures_json": hashes}))

    # 10. The SQL file. A reset drops the append-only triggers, empties every table, then restores the triggers from
    # the migration text itself, so they come back exactly as migrated.
    triggers_sql = (MIGRATIONS / "0002_append_only.sql").read_text()
    prefix = []
    if a.reset:
        prefix += [f"DROP TRIGGER IF EXISTS {t};" for t in trigger_names(triggers_sql)]
        prefix += [f"DELETE FROM {t};" for t in reversed(TABLES)]
        prefix += ["DELETE FROM sqlite_sequence;"]
        prefix += [l for l in triggers_sql.splitlines() if l.startswith("CREATE TRIGGER")]
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
    wrangler(["d1", "migrations", "apply", DB_NAME, f"--{t}"])
    if not a.reset and d1_query(t, "SELECT COUNT(*) AS n FROM seed_meta")[0]["n"]:
        sys.exit("seed: the database is already seeded; rerun with --reset to wipe it (this also deletes the demo access log)")

    # 11. R2 first, so D1 never points at a missing object. Unchanged objects are skipped on later runs.
    state_file = OUT / f".seed-state-{t}.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if t == "local" and not (API / ".wrangler" / "state" / "v3" / "r2").exists():
        state = {}  # the local state was wiped, so the record of uploads no longer holds
    todo = [m for m in manifest if state.get(m["key"]) != m["sha256"]]
    loc = ["--local"] if t == "local" else ["--remote", "--jurisdiction", "eu"]

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
    wrangler(["d1", "execute", DB_NAME, f"--{t}", "--yes", "--file", str(OUT / "seed.sql")])

    # 13. Verify counts and that every append-only trigger exists.
    counts = d1_query(t, "SELECT (SELECT COUNT(*) FROM patients) p, (SELECT COUNT(*) FROM cases) c, (SELECT COUNT(*) FROM documents) d,"
                         " (SELECT COUNT(*) FROM pages) pg, (SELECT COUNT(*) FROM alerts) a, (SELECT COUNT(*) FROM tasks) t,"
                         " (SELECT COUNT(*) FROM fixture_files) f, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger') tr")[0]
    print("seeded:", counts)
    want_triggers = len(trigger_names(triggers_sql))
    if counts["tr"] != want_triggers or counts["p"] != len(patients) or counts["pg"] != page_count_total:
        sys.exit(f"seed: verification failed (expected {want_triggers} triggers, {len(patients)} patients, {page_count_total} pages)")


if __name__ == "__main__":
    main()
