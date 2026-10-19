"""Convert case 10, S01 and S02 to codebridge.extraction/2 runs (docs/design/EXTRACTION-FORMAT.md) and re-key the
guideline and deviation files of case 10 to fact IDs.

Usage (from the repository root; the format package and jsonschema come from the pipeline project):
    uv run --project pipeline python fixtures/convert/convert_v2.py            # write runs, guidance, catalogs
    uv run --project pipeline python fixtures/convert/convert_v2.py --check    # convert and compare, write nothing

One-time but rerunnable: the facts are written by hand in case10_v2.py and synthetic_v2.py from today's fixtures,
IDs follow deterministically from the case and each fact's key, and the guidance re-key reads its own tables, never
the array positions it replaces. A run that fails either validator, a quote not found verbatim in its page text, or
a patient identifier in a run stops the script before anything is written.

Writes:
- fixtures/data/runs/NO-010.json, NO-S01.json, NO-S02.json
- fixtures/data/guideline-fact-refs-case-10.json, guidelines-case-10*.json (patient_facts), deviations-case-10.json
- i18n/{cs,sk,en}/alerts.ftl (the alert messages the runs use)
and prints the conversion report (counts, alert mapping, view coverage, quote misses).
"""

import argparse
import hashlib
import json
import subprocess
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "pipeline"))
sys.path.insert(0, str(HERE))

from extraction_format import alert_id, assign_fact_ids, pair_subject, source_id_for, validate_run, view_line_id  # noqa: E402

import case10_v2 as C10  # noqa: E402
from spec import AlertSpec, Q, Spec  # noqa: E402
from synthetic_v2 import SYNTHETIC  # noqa: E402

DATA = REPO / "fixtures/data"
RUNS = DATA / "runs"
PAGES = REPO / "data/derived/pages"
PDFS = [REPO / "data/rakathon-26/2_AI asistent MDT", REPO / "samples"]
RUN_CREATED = "2026-10-19T00:00:00Z"
ENGINE = "fixtures/convert/convert_v2.py"
# Imaging and histology in an outpatient report quote another report (reported_as "cited"); the rest is the report's own.
CITED_KINDS = {"imaging", "histology"}
FACT_KINDS_WITH_CHECKS = [
    "diagnosis", "histology", "stage", "metastasis", "procedure", "systemic_therapy", "radiotherapy", "imaging", "lab_result",
    "vital_sign", "performance_status", "exam_finding", "symptom", "comorbidity", "medication", "contraindication", "allergy",
    "adverse_event", "prognostic_score", "risk_factor", "family_history", "request", "decision", "plan", "visit", "interval",
]

# ---------------------------------------------------------------------------------------------------------------------
# Fluent messages of the alerts (I18N.md): Czech is the source; Slovak and English follow the catalog convention (every
# Czech message in each, same placeholders). Arguments: fact, fact_a, fact_b are fact IDs the view renders as the
# fact's line; document is a document or part ID the view renders as its title; field is a code.

MESSAGES: dict[str, dict[str, str]] = {
    "alert-request-without-result": {
        "cs": "Požadavek bez výsledku v dostupné dokumentaci: { $fact }",
        "sk": "Požiadavka bez výsledku v dostupnej dokumentácii: { $fact }",
        "en": "Request without a result in the available documentation: { $fact }",
    },
    "alert-original-report-missing": {
        "cs": "Originální zpráva v dostupné dokumentaci chybí, jen citace: { $fact }",
        "sk": "Originálna správa v dostupnej dokumentácii chýba, len citácia: { $fact }",
        "en": "Original report missing from the available documentation, cited only: { $fact }",
    },
    "alert-mdt-question-missing": {
        "cs": "Výslovná otázka pro MDT { -gap-not-stated-f }. Účel dle dokumentu: { $fact }",
        "sk": "Výslovná otázka pre MDT { -gap-not-stated-f }. Účel podľa dokumentu: { $fact }",
        "en": "Explicit question for the MDT { -gap-not-stated-f }. Purpose according to the document: { $fact }",
    },
    "alert-suspicion-not-verified": {
        "cs": "Suspekce bez histologického ani jiného ověření v dostupné dokumentaci: { $fact }",
        "sk": "Suspekcia bez histologického ani iného overenia v dostupnej dokumentácii: { $fact }",
        "en": "Suspicion without histological or other confirmation in the available documentation: { $fact }",
    },
    "alert-document-date-not-stated": {
        "cs": "Datum dokumentu { $document }: { -gap-not-stated }",
        "sk": "Dátum dokumentu { $document }: { -gap-not-stated }",
        "en": "Date of the document { $document }: { -gap-not-stated }",
    },
    "alert-lab-draw-date-not-stated": {
        "cs": "Datum odběru laboratorních hodnot v dokumentu { $document }: { -gap-not-stated }",
        "sk": "Dátum odberu laboratórnych hodnôt v dokumente { $document }: { -gap-not-stated }",
        "en": "Sample date of the lab values in { $document }: { -gap-not-stated }",
    },
    "alert-reading-uncertain": {
        "cs": "Nejisté čtení: { $fact }",
        "sk": "Neisté čítanie: { $fact }",
        "en": "Uncertain reading: { $fact }",
    },
    "alert-patient-field-missing": {
        "cs": "{ $field ->\n    [age] Věk\n    [birth_number] Rodné číslo\n   *[other] Údaj o pacientovi\n}: { -gap-not-stated }",
        "sk": "{ $field ->\n    [age] Vek\n    [birth_number] Rodné číslo\n   *[other] Údaj o pacientovi\n}: { -gap-not-stated }",
        "en": "{ $field ->\n    [age] Age\n    [birth_number] Birth number\n   *[other] Patient detail\n}: { -gap-not-stated }",
    },
    "alert-consultation-form-missing": {
        "cs": "Konzultační formulář v dostupné dokumentaci nenalezen.",
        "sk": "Konzultačný formulár v dostupnej dokumentácii nenájdený.",
        "en": "Consultation form not found in the available documentation.",
    },
    "alert-comparison-imaging-missing": {
        "cs": "Předchozí vyšetření ke srovnání v dostupné dokumentaci nenalezeno: { $fact }",
        "sk": "Predchádzajúce vyšetrenie na porovnanie v dostupnej dokumentácii nenájdené: { $fact }",
        "en": "No earlier examination for comparison found in the available documentation: { $fact }",
    },
    "alert-exam-attribution-unclear": {
        "cs": "Nejasné, ke kterému vyšetření nález patří: { $fact }",
        "sk": "Nejasné, ku ktorému vyšetreniu nález patrí: { $fact }",
        "en": "Unclear which examination the finding belongs to: { $fact }",
    },
    "alert-date-contradiction": {
        "cs": "Rozdílné datum téhož vyšetření: { $fact_a }; { $fact_b }",
        "sk": "Rozdielny dátum toho istého vyšetrenia: { $fact_a }; { $fact_b }",
        "en": "Different dates for the same examination: { $fact_a }; { $fact_b }",
    },
    "alert-response-assessment-differs": {
        "cs": "Hodnocení odpovědi na léčbu se v dokumentaci liší: { $fact_a }; { $fact_b }",
        "sk": "Hodnotenie odpovede na liečbu sa v dokumentácii líši: { $fact_a }; { $fact_b }",
        "en": "The treatment response assessment differs within the documentation: { $fact_a }; { $fact_b }",
    },
    "alert-cycles-differ": {
        "cs": "Počet indikovaných a dokumentovaných cyklů se liší: { $fact }",
        "sk": "Počet indikovaných a zdokumentovaných cyklov sa líši: { $fact }",
        "en": "The number of indicated and documented cycles differs: { $fact }",
    },
    "alert-page-order-unclear": {
        "cs": "Pořadí stran a nejnovější závěr dokumentu nejsou jednoznačné: { $document }",
        "sk": "Poradie strán a najnovší záver dokumentu nie sú jednoznačné: { $document }",
        "en": "The page order and the latest conclusion of the document are not clear: { $document }",
    },
    "alert-dosing-differs": {
        "cs": "Dávkování léku se mezi částmi dokumentace liší: { $fact_a }; { $fact_b }",
        "sk": "Dávkovanie lieku sa medzi časťami dokumentácie líši: { $fact_a }; { $fact_b }",
        "en": "The dosing of a drug differs between parts of the documentation: { $fact_a }; { $fact_b }",
    },
    # Rules the fixtures do not raise but the pipeline and the identity check do (pipeline/eval.py, the validator
    # tests): a poorly readable document, and a page that shows another patient. The identity message names only the
    # document and the page, never what the page says.
    "alert-poor-copy": {
        "cs": "Špatně čitelný dokument, vyžádejte lepší kopii: { $document }",
        "sk": "Zle čitateľný dokument, vyžiadajte lepšiu kópiu: { $document }",
        "en": "Poorly readable document, ask for a better copy: { $document }",
    },
    "alert-identity-conflict": {
        "cs": "Strana patří jinému pacientovi; její údaje nejsou zobrazeny: { $document }, s. { $page }",
        "sk": "Strana patrí inému pacientovi; jej údaje nie sú zobrazené: { $document }, s. { $page }",
        "en": "The page belongs to another patient; its items are not shown: { $document }, p. { $page }",
    },
}

FTL_HEADER = {
    "cs": "# Czech, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,\n",
    "sk": "# Slovak, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,\n",
    "en": "# English, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,\n",
}
FTL_BODY = (
    "# named alert-<rule>. Arguments: $fact, $fact_a, $fact_b are fact IDs the view renders as that fact's line;\n"
    "# $document is a document or part ID the view renders as its title; $field is a code. Messages are \"label: value\",\n"
    "# so no argument needs a grammatical case. The model's own explanation is the alert's note, in the content language.\n"
    "# Written by fixtures/convert/convert_v2.py from its MESSAGES table; edit the table and rerun, not this file.\n"
)


def ftl_text(locale: str) -> str:
    out = [FTL_HEADER[locale] + FTL_BODY]
    for mid, by_locale in MESSAGES.items():
        out.append(f"\n{mid} = {by_locale[locale]}\n")
    return "".join(out)


def message_id(rule: str) -> str:
    return "alert-" + rule.replace("_", "-")


# ---------------------------------------------------------------------------------------------------------------------
# Page text and quotes

_page_cache: dict[tuple[str, int], str] = {}


def page_text(document: str, page: int) -> str:
    key = (document, page)
    if key not in _page_cache:
        _page_cache[key] = (PAGES / document / f"p{page}.layer.txt").read_text(encoding="utf-8")
    return _page_cache[key]


def find_span(text: str, quote: str) -> tuple[int, int] | None:
    """Where a quote sits in the page text: the same characters, with any run of whitespace in either standing for any
    other run (today's quotes joined broken lines with a space). The source keeps the page's own characters."""
    tokens = quote.split()
    if not tokens:
        return None
    matches = list(re.finditer(r"\s+".join(re.escape(t) for t in tokens), text))
    if len(matches) > 1:
        raise SystemExit(f"quote occurs {len(matches)} times on its page, lengthen it: {quote[:60]!r}")
    return (matches[0].start(), matches[0].end()) if matches else None


DATE_PATTERNS = [
    (re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2})$"), "minute"),
    (re.compile(r"^(\d{1,2})[.,](\d{1,2})[.,](\d{4})$"), "day"),
    (re.compile(r"^(\d{1,2})/(\d{4})$"), "month"),
    (re.compile(r"^(\d{1,2})/(\d{2})$"), "month2"),
    (re.compile(r"^(?:r\.)?(\d{4})$"), "year"),
    (re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4}) - \d{1,2}\.\d{1,2}\.\d{4}$"), "day"),
]


def fact_date(as_written: str | None) -> dict[str, Any]:
    """The format's date: kept as written; precision and an ISO sort form cut to it, never a made-up day."""
    if as_written is None:
        return {"as_written": None, "precision": None, "sort": None}
    for rx, kind in DATE_PATTERNS:
        m = rx.match(as_written)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        if kind == "minute":
            return {"as_written": as_written, "precision": "minute", "sort": f"{g[2]:04d}-{g[1]:02d}-{g[0]:02d}T{g[3]:02d}:{g[4]:02d}"}
        if kind == "day":
            return {"as_written": as_written, "precision": "day", "sort": f"{g[2]:04d}-{g[1]:02d}-{g[0]:02d}"}
        if kind == "month":
            return {"as_written": as_written, "precision": "month", "sort": f"{g[1]:04d}-{g[0]:02d}"}
        if kind == "month2":
            return {"as_written": as_written, "precision": "month", "sort": f"20{g[1]:02d}-{g[0]:02d}"}
        return {"as_written": as_written, "precision": "year", "sort": f"{g[0]:04d}"}
    raise ValueError(f"cannot read the date {as_written!r}")


def sha256_of(path: Path | None) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path and path.exists() else None


def pdf_of(document: str) -> Path | None:
    for base in PDFS:
        for p in (base / f"{document}.pdf", base / document / f"{document}.pdf"):
            if p.exists():
                return p
    return None


def number(text: str | None) -> float | None:
    """A Czech decimal ("9,5", "4,130") or a dotted one ("25.98") as a number; None when it is not one."""
    if text is None:
        return None
    t = text.strip().replace(",", ".")
    try:
        x = float(t)
    except ValueError:
        return None
    return int(x) if x.is_integer() and "." not in t else x


def range_bounds(rng: str | None) -> tuple[float | None, float | None]:
    m = re.match(r"^\s*([\d.,]+)\s*\.\.\.\s*([\d.,]+)\s*$", rng or "")
    return (number(m.group(1)), number(m.group(2))) if m else (None, None)


# ---------------------------------------------------------------------------------------------------------------------
# Building one run


class Builder:
    """Collects the quotes of a case's facts, merges overlapping ones into one source per passage, and builds the run."""

    def __init__(self, case_id: str, document: str, n_parts: int, default_part: dict[int, int], identity_names: list[str]):
        self.case_id = case_id
        self.document = document
        self.n_parts = n_parts
        self.default_part = default_part
        self.identity_names = identity_names
        self.misses: list[str] = []
        # (page, part) -> list of [start, end, cited]
        self.spans: dict[tuple[int, int], list[list[Any]]] = defaultdict(list)
        self.specs: list[Spec] = []
        self.quote_of: dict[str, list[tuple[int, int, int, int]]] = {}  # handle -> [(page, part, start, end)]
        self.tokens: dict[int, list[dict[str, Any]]] = defaultdict(list)  # page -> reading-check tokens of today

    def part_id(self, ordinal: int) -> str:
        return f"{self.document}/p{ordinal}"

    def add(self, spec: Spec) -> None:
        self.specs.append(spec)
        located = []
        for q in spec.quotes:
            text = page_text(self.document, q.page)
            span = find_span(text, q.text)
            if span is None:
                self.misses.append(f"{spec.handle}: p{q.page} {q.text!r}")
                continue
            part = q.part if q.part is not None else self.default_part[q.page]
            cited = q.cited if q.cited is not None else spec.kind in CITED_KINDS
            self.spans[(q.page, part)].append([span[0], span[1], cited])
            located.append((q.page, part, span[0], span[1]))
        self.quote_of[spec.handle] = located

    def build_sources(self) -> None:
        """One source per passage: quotes on the same page and part that overlap are one passage (trimmed variants of
        today's quotes), stored as the page's own characters over the union of their spans."""
        self.clusters: dict[tuple[int, int], list[tuple[int, int, bool]]] = {}
        for key, spans in self.spans.items():
            merged: list[list[Any]] = []
            for s, e, cited in sorted(spans):
                if merged and s < merged[-1][1]:
                    merged[-1][1] = max(merged[-1][1], e)
                    merged[-1][2] = merged[-1][2] or cited
                else:
                    merged.append([s, e, cited])
            self.clusters[key] = [tuple(m) for m in merged]
        self.sources: list[dict[str, Any]] = []
        self.source_at: dict[tuple[int, int, int], str] = {}  # (page, part, cluster start) -> source ID
        taken: set[str] = set()
        for (page, part), clusters in sorted(self.clusters.items()):
            text = page_text(self.document, page)
            for s, e, cited in clusters:
                quote = text[s:e]
                src = {
                    "id": "",
                    "type": "document",
                    "document_id": self.document,
                    "part": self.part_id(part),
                    "page": page,
                    "quote": quote,
                    "quote_text": "pdf_text",
                    "anchor": None,
                    "reported_as": "cited" if cited else "original",
                    "identity": "matches" if any(n in text for n in self.identity_names) else "cannot_verify",
                    "reading_check": self.reading_check(page, quote),
                }
                src["id"] = source_id_for(src, taken)
                taken.add(src["id"])
                self.sources.append(src)
                self.source_at[(page, part, s)] = src["id"]

    def reading_check(self, page: int, quote: str) -> dict[str, Any] | None:
        """Today's per-token reading comparison (ocr_check) for the tokens inside this passage."""
        seen, tokens = set(), []
        for t in self.tokens.get(page, []):
            if t["layer"] and t["layer"] in quote:
                key = (t["layer"], t.get("tess"), t.get("vision"), t["rule"])
                if key not in seen:
                    seen.add(key)
                    tokens.append({"pdf_text": t["layer"], "tesseract": t.get("tess"), "vision": t.get("vision"), "rule": t["rule"]})
        if not tokens:
            return None
        return {"mark": any(t["rule"] != "agree" for t in tokens), "tokens": tokens}

    def sources_of(self, handle: str) -> list[str]:
        out: list[str] = []
        for page, part, s, e in self.quote_of[handle]:
            for cs, ce, _ in self.clusters[(page, part)]:
                if cs <= s and e <= ce:
                    sid = self.source_at[(page, part, cs)]
                    if sid not in out:
                        out.append(sid)
        return out

    def facts_at(self, page: int, quote: str) -> list[str]:
        """The handles of the facts resting on a passage that overlaps this quote (any part of the page)."""
        span = find_span(page_text(self.document, page), quote)
        if span is None:
            return []
        s, e = span
        out = []
        for spec in self.specs:
            for p, _part, qs, qe in self.quote_of.get(spec.handle, []):
                if p == page and qs < e and s < qe and spec.handle not in out:
                    out.append(spec.handle)
        return out

    def drafts(self) -> list[dict[str, Any]]:
        out = []
        for sp in self.specs:
            d: dict[str, Any] = {
                "draft_id": sp.handle,
                "kind": sp.kind,
                "subject": sp.subject,
                "value": sp.value,
                "date": fact_date(sp.date),
                "status": sp.status,
                "negated": sp.negated,
                "not_stated": list(sp.not_stated),
                "origin": sp.origin,
                "certainty": sp.certainty,
                "certainty_reason": {"code": sp.reason[0], "text": sp.reason[1]} if sp.reason else None,
                "codes": list(sp.codes),
                "note": sp.note,
                "quarantined": False,
                "sources": self.sources_of(sp.handle),
            }
            if sp.based_on:
                d["based_on"] = list(sp.based_on)
            out.append(d)
        return out


# Alert subjects that are not facts: a field, an expected document, a document or part ID. Anything else must be a
# fact handle, so a mistyped handle fails instead of becoming a dangling literal.
LITERAL_SUBJECTS = {"mdt_question", "age", "birth_number", "consultation_form"}


def resolve_alerts(alerts: list[AlertSpec], ids: dict[str, str], lab_ids: list[str]) -> list[dict[str, Any]]:
    out = []
    for a in alerts:
        if isinstance(a.subject, tuple):
            subject = pair_subject(ids[a.subject[0]], ids[a.subject[1]])
        elif a.subject in ids:
            subject = ids[a.subject]
        elif a.subject in LITERAL_SUBJECTS or re.fullmatch(r"[A-Z0-9]+_pacient(/p\d+)?", a.subject):
            subject = a.subject
        else:
            raise SystemExit(f"alert {a.rule}: subject {a.subject!r} is neither a fact handle nor a known literal")
        facts: list[str] = []
        for h in a.facts:
            facts += lab_ids if h == "@labs" else [ids[h]]
        args = {k: ids[v] if k.startswith("fact") else v for k, v in a.args.items()}
        al = {"id": "", "rule": a.rule, "subject": subject, "kind": a.kind, "facts": facts,
              "message": {"id": message_id(a.rule), "args": args}, "note": a.note}
        al["id"] = alert_id(al)
        out.append(al)
    return out


def all_parts(document: str, n: int) -> list[dict[str, Any]]:
    return [{"document_id": document, "part": f"{document}/p{k}"} for k in range(n)]


def kind_checks(document: str, n_parts: int, facts: list[dict[str, Any]], nothing_found: list[str], not_run: list[str],
                run_kinds: list[str] | None, covered: dict[str, list[int]] | None = None) -> list[dict[str, Any]]:
    """One check per fact kind. `run_kinds` None: every kind was looked for (found or nothing_found), except `not_run`.
    Otherwise only the listed kinds ran; the others are not_run, whatever facts exist."""
    have = Counter(f["kind"] for f in facts)
    out = []
    for kind in FACT_KINDS_WITH_CHECKS:
        ran = kind not in not_run and (run_kinds is None or kind in run_kinds)
        if not ran:
            result = "not_run"
        elif have[kind]:
            result = "found"
        else:
            result = "nothing_found"
            if kind not in nothing_found:
                raise SystemExit(f"{document}: check {kind} would say nothing_found; list it in NOTHING_FOUND_KINDS if that is what the fixture covered")
        parts = (covered or {}).get(kind)
        cov = [{"document_id": document, "part": f"{document}/p{k}"} for k in parts] if parts is not None else all_parts(document, n_parts)
        out.append({"id": f"chk-{kind.replace('_', '-')}", "looks_for": kind, "expected": None,
                    "covered": cov if result != "not_run" else [], "unreadable": [], "result": result})
    return out


def report_checks(document: str, n_parts: int, handles: list[str], ids: dict[str, str]) -> list[dict[str, Any]]:
    """An original report looked for and not found, one check per cited exam (the missing-document alerts rest on it)."""
    return [{"id": f"chk-report-{h.replace('_', '-')}", "looks_for": "original_report", "expected": {"of_fact": ids[h]},
             "covered": [{"document_id": document, "part": None}], "unreadable": [], "result": "nothing_found"} for h in handles]


def lab_spec_from_value(lab: dict[str, Any], part: int, quote: str, flag_origin: str, draw: dict[str, Any] | None = None) -> Spec:
    """A lab_result fact from one of today's lab values; the unit as written comes from the quote, the corrected one
    from today's fixture, and a difference between them (mg/1 for mg/l) is the "ověřit" reason."""
    m = re.match(r"^\s*(\S+):\s*(\S+)\s+(.*?)\s*\[(.*?)\]?\s*$", quote)
    # The value is copied, never corrected: a value that differs from its passage is a fixture error, not a reading.
    if not m or m.group(2) != lab["value"]:
        raise SystemExit(f"lab {lab['code']}: value {lab['value']!r} is not the value in its passage {quote!r}")
    unit_written = m.group(3) if m else None
    range_written = m.group(4).strip() if m else None
    low, high = range_bounds(lab["reference_range"])
    diffs = []
    if m and m.group(1).replace("....", "_") != lab["code"] and m.group(1) != lab["code"]:
        diffs.append((m.group(1), lab["code"]))
    if unit_written and unit_written != lab["unit"]:
        diffs.append((unit_written, lab["unit"]))
    if range_written and range_written.replace(" ", "") != (lab["reference_range"] or "").replace(" ", ""):
        diffs.append((f"[{range_written}]", f"[{lab['reference_range']}]"))
    certainty, reason = "clear", None
    if lab.get("certainty") == "unclear_ocr" or diffs:
        certainty = "verify"
        text = ("V textu " + ", ".join(f"„{a}“ čteno jako {b}" for a, b in diffs) + ".") if diffs else "Čtení hodnoty ověřit."
        reason = ("ocr_char_swap", text)
    out_of_range = lab.get("out_of_range")
    draw = draw or {"as_written": None, "requisition": None, "specimen": None}
    value = {
        "name_as_written": lab["name_cs"],
        "value_as_written": lab["value"],
        "value_numeric": number(lab["value"]),
        "unit_as_written": unit_written,
        "unit": lab["unit"],
        "reference_range": lab["reference_range"],
        "reference_low": low,
        "reference_high": high,
        "out_of_range": out_of_range,
        "out_of_range_origin": (flag_origin if out_of_range else None),
        "draw": draw,
    }
    return Spec(f"lab_{lab['code']}_{draw['as_written'] or 'undated'}", "lab_result", value, date=draw["as_written"],
                quotes=[Q(int(lab["source"]["page"]), quote, part, False)], certainty=certainty, reason=reason,
                codes=[{"system": "fno-local-lab", "code": lab["code"], "assigned_by": "source"}],
                not_stated=[] if draw["as_written"] else ["draw"], note=lab.get("note") if certainty == "clear" else None)


def run_frame(case_id: str, document: str, n_parts: int) -> dict[str, Any]:
    return {
        "schema": "codebridge.extraction/2",
        "case_id": case_id,
        "content_language": "cs",
        "run": {"id": f"fixture-{case_id}-v2", "producer": "fixture", "created_at": RUN_CREATED,
                "stages": [{"name": "convert", "engine": ENGINE}], "supersedes": None},
        "documents": [{"document_id": document, "sha256": sha256_of(pdf_of(document)), "parts": [f"{document}/p{k}" for k in range(n_parts)]}],
    }


def committed_run(case_id: str) -> dict[str, Any] | None:
    """The run as committed at HEAD; where there is no git checkout (the pipeline image copies files only), the file on
    disk, which there is the committed one; None for a run that does not exist yet."""
    path = RUNS / f"{case_id}.json"
    rel = path.relative_to(REPO).as_posix()
    try:
        out = subprocess.run(["git", "-C", str(REPO), "show", f"HEAD:{rel}"], capture_output=True, check=True)
        return json.loads(out.stdout.decode("utf-8"))
    except (OSError, subprocess.CalledProcessError):
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def finish(b: Builder, frame: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    b.build_sources()
    drafts = b.drafts()
    # The committed run (HEAD) is the previous run: a change to the converter or to a key rule then keeps every fact ID
    # the matcher can carry over, so references in D1 and in the guidance files stay valid (EXTRACTION-FORMAT.md,
    # "Fact identity"). HEAD, not the working file, so --check still catches a hand edit of an ID in the working tree.
    # IDs therefore depend on the committed history, not on the case and key alone; a first conversion mints them new.
    previous = committed_run(b.case_id)
    result = assign_fact_ids(b.case_id, drafts, b.sources, previous)
    ids = {d["draft_id"]: f["id"] for d, f in zip(drafts, result.facts)}
    # ID and key first, so a reader of the JSON sees which fact it is before its content.
    facts = [{"id": f["id"], "key": f["key"], **{k: v for k, v in f.items() if k not in ("id", "key")}} for f in result.facts]
    return {**frame, "sources": b.sources, "facts": facts}, ids


def collect_tokens(b: Builder, *objs: Any) -> None:
    """Today's ocr_check tokens, by page, so each source carries the comparison for the tokens inside it."""

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            oc = o.get("ocr_check")
            if isinstance(oc, dict):
                for t in oc.get("tokens") or []:
                    if t.get("layer") and t.get("page"):
                        b.tokens[int(t["page"])].append(t)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for o in objs:
        walk(o)


# ---------------------------------------------------------------------------------------------------------------------
# Case 10


def split_brief(text: str) -> list[tuple[str, list[int]]]:
    """Today's brief as sentences with the "[n]" markers each holds; the markers leave the text (the view numbers them)."""
    out = []
    for para in text.split("\n"):
        for sent in re.split(r"(?<=[.])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])", para.strip()):
            if not sent:
                continue
            refs = [int(n) for n in re.findall(r"\[(\d+)\]", sent)]
            clean = re.sub(r"\s*\[\d+\]", "", sent).strip()
            out.append((clean, refs))
    return out


def build_case10(report: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], Builder]:
    case, extra = C10.CASE, C10.EXTRA
    n_parts = len(extra["documents"])
    b = Builder(C10.CASE_ID, C10.DOCUMENT, n_parts, C10.DEFAULT_PART, [case["patient"]["name_as_written"], case["patient"]["name"]])
    collect_tokens(b, extra, case)
    for sp in C10.FACTS + visit_specs(C10.VISITS):
        b.add(sp)
    lab_handles = []
    for lab in case["labs"]:
        quote = C10.LAB_QUOTE_FIX.get(lab["code"], lab["source"]["quote"])
        sp = lab_spec_from_value(lab, C10.LAB_PART, quote, C10.LAB_FLAG_ORIGIN)
        b.add(sp)
        lab_handles.append(sp.handle)
    frame = run_frame(C10.CASE_ID, C10.DOCUMENT, n_parts)
    run, ids = finish(b, frame)
    lab_ids = [ids[h] for h in lab_handles]
    report["visits"] = visit_report(C10.VISITS, ids)

    run["checks"] = (
        kind_checks(C10.DOCUMENT, n_parts, run["facts"], C10.NOTHING_FOUND_KINDS, C10.NOT_RUN_KINDS, None, {"lab_result": [C10.LAB_PART]})
        + [{"id": cid, "looks_for": lf, "expected": None,
            "covered": [{"document_id": C10.DOCUMENT, "part": f"{C10.DOCUMENT}/p{k}"} for k in (parts if parts is not None else range(n_parts))],
            "unreadable": [], "result": res} for cid, lf, res, parts in C10.EXTRA_CHECKS]
        + report_checks(C10.DOCUMENT, n_parts, C10.ORIGINAL_REPORTS, ids)
    )
    for c in run["checks"]:
        c["unreadable"] = [{"document_id": C10.DOCUMENT, "part": f"{C10.DOCUMENT}/p{part}", "page": page} for page, part in C10.UNREADABLE.get(c["id"], [])]
    run["alerts"] = resolve_alerts(C10.ALERTS, ids, lab_ids)

    # The brief: today's sentences, each with the facts it states; every marker's passage must rest on one of them.
    sentences = split_brief(extra["onco_summary_v3_cs"])
    if len(sentences) != len(C10.BRIEF_FACTS):
        raise SystemExit(f"case 10 brief: {len(sentences)} sentences, {len(C10.BRIEF_FACTS)} fact lists")
    brief_issues = []
    for (text, refs), handles in zip(sentences, C10.BRIEF_FACTS):
        for n in refs:
            ref = extra["onco_summary_v3_refs"][n - 1]
            under = b.facts_at(int(ref["page"]), ref["quote"])
            if not set(under) & set(handles):
                brief_issues.append(f"[{n}] {ref['quote'][:60]!r} rests on {under} (none in the sentence)")
    def fixed(t: str) -> str:
        for a, b2 in C10.BRIEF_TEXT_FIX.items():
            t = t.replace(a, b2)
        return t

    run["brief"] = {"sentences": [{"text": fixed(t), "facts": [ids[h] for h in hs]} for (t, _), hs in zip(sentences, C10.BRIEF_FACTS)],
                    "made_by": {"model": None, "prompt": None}}
    report["brief_issues"] = brief_issues

    mq = case["mdt_question"]
    run["question_draft"] = {"text": mq["question_draft_cs"], "question_kind": mq["question_kind"],
                             "basis": [{"role": role, "facts": [ids[h] for h in hs]} for role, hs in C10.QUESTION_BASIS]}
    run["views"] = compose_views_case10(run, ids)
    report["view_coverage"] = view_coverage_case10(b)
    return run, ids, b


# Today's line kinds as the view's event categories. A planned compact line is filed by what it plans (as the view's
# compactKind did): a line about a drug or a treatment line is systemic, any other plan clinical.
CATEGORY = {"surgery": "surgery", "imaging": "imaging", "systemic": "systemic", "pathology": "pathology", "mdt": "mdt",
            "diagnosis": "clinical", "visit": "clinical"}
PLAN_SYSTEMIC = re.compile(r"everolim|sunitinib|nivolumab|ipilimumab|kabozantinib|cabozantinib|linie", re.IGNORECASE)


def view_line(view: str, facts: list[str], text: str, title: str | None, detail: str | None, sort: str | None,
              by_id: dict[str, dict[str, Any]], category: str, status: str, note: str | None) -> dict[str, Any]:
    """One composed line. Its date is the date of the first of its facts filed under the line's day (today's date_sort),
    kept as that fact writes it; a line without a date stays undated."""
    date = {"as_written": None, "precision": None, "sort": None}
    if sort:
        match = next((by_id[f]["date"] for f in facts if by_id[f]["date"]["sort"] == sort), None)
        if match is None:
            raise SystemExit(f"{view}: no fact of the line is dated {sort}")
        date = match
    return {"id": view_line_id(view, facts), "text": text, "title": title, "detail": detail, "date": date,
            "category": category, "status": status, "facts": facts, "note": note}


def compose_views_case10(run: dict[str, Any], ids: dict[str, str]) -> dict[str, Any]:
    """Today's onco lines, timeline cards and other diagnoses in today's wording, each pointing at the facts it states
    (case10_v2.ONCO_LINES, TIMELINE_CARDS, OTHER_DX). The validator checks them like brief sentences."""
    extra = C10.EXTRA
    by_id = {f["id"]: f for f in run["facts"]}
    lines = extra["onco_compact_v3"]["lines"]
    cards = extra["timeline_cards_v3"]
    if len(lines) != len(C10.ONCO_LINES) or len(cards) != len(C10.TIMELINE_CARDS):
        raise SystemExit("case 10 views: the fact lists do not match today's lines and cards")
    onco = []
    for line, handles in zip(lines, C10.ONCO_LINES):
        planned = line["kind"] == "plan"
        category = ("systemic" if PLAN_SYSTEMIC.search(line["text_cs"]) else "clinical") if planned else CATEGORY[line["kind"]]
        onco.append(view_line("onco_lines", [ids[h] for h in handles], line["text_cs"], None, None, line.get("date_sort"), by_id,
                              category, "planned" if planned else "done", line.get("note_cs")))
    timeline = []
    for card, handles in zip(cards, C10.TIMELINE_CARDS):
        status = "planned" if card["status"] == "planned" else "done"
        timeline.append(view_line("timeline", [ids[h] for h in handles], card["text_cs"], card["title_cs"], card.get("detail_cs"),
                                  card.get("date_sort"), by_id, CATEGORY[card["kind"]], status, card.get("note_cs")))
    other = extra["onco_compact_v3"]["other_dx_cs"]
    others = [view_line("other_diagnoses", [ids[h] for h in C10.OTHER_DX], other, None, None, None, by_id, "clinical", "documented", None)]
    return {"onco_lines": onco, "other_diagnoses": others, "timeline": timeline, "made_by": {"model": None, "prompt": None}}


def visit_specs(visits: list[tuple[Spec, list[str]]]) -> list[Spec]:
    """The visit facts (kind `visit`: type, type_as_written, department, reason, end_as_written; key = kind, type,
    date). Each visit is cited in the outpatient report or is its own header there; quotes are the sources."""
    return [sp for sp, _today in visits]


def visit_report(visits: list[tuple[Spec, list[str]]], ids: dict[str, str]) -> list[dict[str, Any]]:
    return [{"visit": sp.handle, "id": ids[sp.handle], "type": sp.value["type"], "as_written": sp.value["type_as_written"],
             "date": sp.date, "status": sp.status, "today": today} for sp, today in visits]


def view_coverage_case10(b: Builder) -> dict[str, Any]:
    """Each of today's view items, by the passages it cites, mapped to the facts resting on them."""
    case, extra = C10.CASE, C10.EXTRA

    def refs_of(item: dict[str, Any]) -> list[tuple[int, str]]:
        out = []
        for r in item.get("refs") or []:
            if isinstance(r, int):
                out.append((int(extra["refs"][r]["page"]), C10.REF_FIX.get(r, extra["refs"][r]["quote"])))
            elif isinstance(r, dict):
                out.append((int(r["page"]), C10.OLD_QUOTE_FIX.get(r["quote"], r["quote"])))
        for key in ("source",):
            if isinstance(item.get(key), dict) and item[key].get("quote"):
                out.append((int(item[key]["page"]), C10.OLD_QUOTE_FIX.get(item[key]["quote"], item[key]["quote"])))
        for key in ("sources", "based_on"):
            for r in item.get(key) or []:
                if isinstance(r, dict) and r.get("quote"):
                    out.append((int(r["page"]), C10.OLD_QUOTE_FIX.get(r["quote"], r["quote"])))
        return out

    items: list[tuple[str, dict[str, Any]]] = []
    oc = extra["onco_compact_v3"]
    items.append(("onco_compact.headline", {"refs": oc["headline_refs"]}))
    items.append(("onco_compact.other_dx", {"refs": oc["other_dx_refs"]}))
    items += [(f"onco_compact.lines[{i}]", x) for i, x in enumerate(oc["lines"])]
    items += [(f"onco_detailed_v3[{i}]", x) for i, x in enumerate(extra["onco_detailed_v3"])]
    items += [(f"timeline_cards_v3[{i}]", x) for i, x in enumerate(extra["timeline_cards_v3"])]
    items += [(f"status_praesens.items[{i}]", x) for i, x in enumerate(extra["status_praesens"]["items"])]
    for sec, xs in extra["anamnesis_v3"].items():
        items += [(f"anamnesis_v3.{sec}[{i}]", x) for i, x in enumerate(xs)]
    items.append(("diagnosis_headline", extra["diagnosis_headline"]))
    items += [(f"labs[{i}]", {"source": {**x["source"], "quote": C10.LAB_QUOTE_FIX.get(x["code"], x["source"]["quote"])}}) for i, x in enumerate(case["labs"])]
    for sec, xs in case["sections"].items():
        items += [(f"sections.{sec}[{i}]", x) for i, x in enumerate(xs)]
    items += [(f"summary[{i}]", x) for i, x in enumerate(case["summary"])]
    items += [(f"timeline[{i}]", x) for i, x in enumerate(case["timeline"])]
    items.append(("diagnosis", case["diagnosis"]))
    covered, without = {}, []
    for name, item in items:
        passages = refs_of(item)
        handles: list[str] = []
        unmapped = []
        for page, quote in passages:
            hs = b.facts_at(page, quote)
            if not hs:
                unmapped.append(f"p{page} {quote[:50]!r}")
            handles += [h for h in hs if h not in handles]
        covered[name] = handles
        if not passages or unmapped:
            without.append({"item": name, "passages": len(passages), "unmapped": unmapped})
    return {"items": len(items), "map": covered, "without_fact": without}


# ---------------------------------------------------------------------------------------------------------------------
# S01 and S02


def build_synthetic(cfg: dict[str, Any], report: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], Builder]:
    s = json.loads((DATA / cfg["file"]).read_text(encoding="utf-8"))
    n_parts = len(s["documents"])
    le = s["list_entry"]
    # The name as printed on the pages ("Křemínek Radovan"), to say which pages show the patient's identity.
    first, last = le["name"].split(" ", 1)
    b = Builder(cfg["case_id"], cfg["document"], n_parts, cfg["default_part"], [f"{last} {first}", le["name"]])
    for sp in cfg["facts"]:
        b.add(sp)
    lab_handles = []
    draws = {d["date"] + " " + d["time"]: d for d in s["labs_series"]["draws"]}
    lab_parts = set()
    for t in s["labs_series"]["tests"]:
        for p in t["points"]:
            if p.get("value") is None:
                continue
            d = draws[p["date"] + " " + p["time"]]
            m = re.match(r"^Odběr:\s*(.+)$", d["source"]["quote"])
            req_m = re.match(r"^Č\. žádanky:\s*(\S+)$", d.get("requisition_quote") or "")
            draw = {"as_written": m.group(1).strip(), "requisition": req_m.group(1) if req_m else None, "specimen": None}
            lab = {"code": t["code"], "name_cs": t["name_cs"], "value": p["value"], "unit": t["unit"], "reference_range": t["reference_range"],
                   "out_of_range": p.get("out_of_range"), "certainty": p.get("certainty"), "source": p["source"]}
            page = int(p["source"]["page"])
            part = cfg["default_part"][page]
            lab_parts.add(part)
            origin = "document" if p.get("flagged_in_document") else "assistant"
            sp = lab_spec_from_value(lab, part, p["source"]["quote"], origin, draw)
            b.add(sp)
            lab_handles.append(sp.handle)
    frame = run_frame(cfg["case_id"], cfg["document"], n_parts)
    run, ids = finish(b, frame)
    lab_ids = [ids[h] for h in lab_handles]
    run["checks"] = kind_checks(cfg["document"], n_parts, run["facts"], [], [], ["lab_result", "request"],
                                {"lab_result": sorted(lab_parts), "request": cfg["report_parts"]}) + report_checks(cfg["document"], n_parts, cfg["original_reports"], ids)
    run["alerts"] = resolve_alerts(cfg["alerts"], ids, lab_ids)
    run["brief"] = None
    run["question_draft"] = None
    run["views"] = None
    # Today's gaps, each mapped to the alerts that replace it.
    report["gaps"] = [{"old": f"data_gaps[{i}]", "text": g["text_cs"]} for i, g in enumerate(s["data_gaps"])]
    return run, ids, b


# ---------------------------------------------------------------------------------------------------------------------
# Guidance re-key (case 10)


def rekey_guidance(run: dict[str, Any], ids: dict[str, str]) -> dict[Path, Any]:
    """The guideline and deviation files with fact IDs in place of fact text keys and array positions."""
    run_id = run["run"]["id"]
    out: dict[Path, Any] = {}

    def fids(handles: list[str]) -> list[str]:
        return [ids[h] for h in handles]

    def fact_ref(text: str) -> dict[str, Any]:
        if text not in C10.GUIDE_FACTS:
            raise SystemExit(f"guidance: no facts listed for the patient fact {text!r} (case10_v2.GUIDE_FACTS)")
        return {"text": text, "fact_ids": fids(C10.GUIDE_FACTS[text])}

    for name in ("guidelines-case-10.json", "guidelines-case-10-more.json"):
        path = DATA / name
        doc = json.loads(path.read_text(encoding="utf-8"))
        for st in doc["statements"]:
            st["patient_facts"] = [fact_ref(pf if isinstance(pf, str) else pf["text"]) for pf in st.get("patient_facts") or []]
        out[path] = {"run_id": run_id, **{k: v for k, v in doc.items() if k != "run_id"}}

    path = DATA / "guidelines-case-10-past.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    for st in doc["statements"]:
        cfg = C10.PAST_STATEMENTS[st["id"]]
        # On the first run the positional fields are still there; they must agree with the table that replaces them.
        if "row_index" in st and C10.PAST_ROW[st["row_index"]] != cfg["row"]:
            raise SystemExit(f"guidance: {st['id']} row_index {st['row_index']} disagrees with PAST_STATEMENTS")
        if "decision_ref" in st and C10.PAST_DECISION_REF[st["decision_ref"]] != cfg.get("decision"):
            raise SystemExit(f"guidance: {st['id']} decision_ref {st['decision_ref']} disagrees with PAST_STATEMENTS")
        st.pop("row_index", None)
        st.pop("decision_ref", None)
        st["row_fact_id"] = ids[cfg["row"]]
        st["decision_fact_ids"] = fids([cfg["row"], *cfg.get("also", [])] + ([cfg["decision"]] if cfg.get("decision") else []))
    out[path] = {"run_id": run_id, **{k: v for k, v in doc.items() if k != "run_id"}}

    path = DATA / "guideline-fact-refs-case-10.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    texts = list(doc["facts"].keys()) if isinstance(doc["facts"], dict) else [f["text"] for f in doc["facts"]]
    out[path] = {
        "description": ("Sources for the patient facts that the guideline statements of synthetic patient 10 rest on (the 'Proč' part "
                        "of an entry in the Navrhovaný postup tab). One entry per fact text exactly as in guidelines-case-10.json and "
                        "guidelines-case-10-more.json; fact_ids name the facts of run_id (fixtures/data/runs/NO-010.json) that state it, "
                        "and the view opens their sources. Written by fixtures/convert/convert_v2.py."),
        "generated": doc.get("generated"),
        "run_id": run_id,
        "facts": [fact_ref(t) for t in texts],
    }

    path = DATA / "deviations-case-10.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    for f in doc["findings"]:
        f.pop("source_refs", None)
        f["source_fact_ids"] = fids(C10.DEVIATION_FACTS[f["id"]])
    out[path] = {"run_id": run_id, **{k: v for k, v in doc.items() if k != "run_id"}}
    return out


def guidance_cross_check(b: Builder) -> list[str]:
    """Compare the hand-written guidance tables with the facts under today's positional references (first run only)."""
    notes = []
    refs = C10.EXTRA["refs"]
    fr = json.loads((DATA / "guideline-fact-refs-case-10.json").read_text(encoding="utf-8"))
    if isinstance(fr["facts"], dict):
        for text, idx in fr["facts"].items():
            under = {h for i in idx for h in b.facts_at(int(refs[i]["page"]), C10.REF_FIX.get(i, refs[i]["quote"]))}
            mine = set(C10.GUIDE_FACTS.get(text, []))
            if not mine & under:
                notes.append(f"fact-refs {text[:50]!r}: table {sorted(mine)} shares nothing with refs {sorted(under)}")
    dev = json.loads((DATA / "deviations-case-10.json").read_text(encoding="utf-8"))
    for f in dev["findings"]:
        if "source_refs" in f:
            under = {h for i in f["source_refs"] for h in b.facts_at(int(refs[i]["page"]), C10.REF_FIX.get(i, refs[i]["quote"]))}
            mine = set(C10.DEVIATION_FACTS[f["id"]])
            if mine - under or under - mine:
                notes.append(f"deviation {f['id']}: table-only {sorted(mine - under)}, refs-only {sorted(under - mine)}")
    return notes


# ---------------------------------------------------------------------------------------------------------------------


def identity_strings() -> list[str]:
    """Patient identifiers that must never appear in a run (DATA-PROTECTION.md): names, birth numbers, birth dates."""
    out = []
    p = C10.CASE["patient"]
    out += [x for x in (p.get("name"), p.get("name_as_written"), p.get("birth_number"), p.get("birth_date")) if x]
    for cfg in SYNTHETIC:
        le = json.loads((DATA / cfg["file"]).read_text(encoding="utf-8"))["list_entry"]
        first, last = le["name"].split(" ", 1)
        out += [le["name"], f"{last} {first}", last]
        if le.get("rc"):
            out.append(le["rc"])
        m = re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", le.get("age_or_birth") or "")
        if m:
            out.append(m.group(0))
    out.append(p["name"].split()[-1])
    return out


def counts(run: dict[str, Any]) -> dict[str, int]:
    return dict(sorted(Counter(f["kind"] for f in run["facts"]).items()))


def dump(obj: Any, indent: int = 1) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent) + "\n"


def indent_of(path: Path) -> int:
    """The indent a JSON file is written with today, so a re-keyed file changes only where its content does."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    return len(lines[1]) - len(lines[1].lstrip(" ")) if len(lines) > 1 and lines[1].startswith(" ") else 2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="convert and compare with the files on disk; write nothing")
    ap.add_argument("--report", type=Path, help="also write the conversion report as JSON to this path")
    args = ap.parse_args(argv)

    report: dict[str, Any] = {}
    run10, ids10, b10 = build_case10(report)
    runs = {"NO-010": run10}
    misses = list(b10.misses)
    alert_map: dict[str, list[str]] = {"NO-010": [f"{', '.join(a.replaces) or '(new)'} -> {r['id']} {r['rule']} ({r['kind']})" for a, r in zip(C10.ALERTS, run10["alerts"])]}
    syn_reports = {}
    for cfg in SYNTHETIC:
        rep: dict[str, Any] = {}
        run, _, b = build_synthetic(cfg, rep)
        misses += b.misses
        runs[cfg["case_id"]] = run
        syn_reports[cfg["case_id"]] = rep
        alert_map[cfg["case_id"]] = [f"{', '.join(a.replaces)} -> {r['id']} {r['rule']} ({r['kind']})" for a, r in zip(cfg["alerts"], run["alerts"])]

    problems = []
    if misses:
        problems.append(f"{len(misses)} quotes not found in the page text: {misses}")
    for cid, run in runs.items():
        res = validate_run(run)
        if not res.ok:
            problems.append(f"{cid}: invalid run: {[(i.code, i.path, i.message) for i in res.issues][:20]}")
        for f in run["facts"]:
            if not f["sources"] and not f.get("based_on"):
                problems.append(f"{cid}: fact {f['id']} without sources")
        text = json.dumps(run, ensure_ascii=False)
        for s in identity_strings():
            if s and s in text:
                problems.append(f"{cid}: a patient identifier is in the run")
        used = {a["message"]["id"] for a in run["alerts"]}
        if used - MESSAGES.keys():
            problems.append(f"{cid}: alert messages without a catalog entry: {sorted(used - MESSAGES.keys())}")
    if report["brief_issues"]:
        problems.append(f"brief: {report['brief_issues']}")
    if problems:
        for p in problems:
            print("ERROR:", p, file=sys.stderr)
        return 1

    guidance_notes = guidance_cross_check(b10)
    guidance = rekey_guidance(run10, ids10)
    outputs: dict[Path, str] = {RUNS / f"{cid}.json": dump(run) for cid, run in runs.items()}
    outputs.update({p: dump(doc, indent_of(p)) for p, doc in guidance.items()})
    outputs.update({REPO / f"i18n/{loc}/alerts.ftl": ftl_text(loc) for loc in ("cs", "sk", "en")})

    full = {
        "counts": {cid: counts(run) for cid, run in runs.items()},
        "sources": {cid: len(run["sources"]) for cid, run in runs.items()},
        "alerts": alert_map,
        "checks": {cid: Counter(c["result"] for c in run["checks"]) for cid, run in runs.items()},
        "view_coverage": {"items": report["view_coverage"]["items"], "without_fact": report["view_coverage"]["without_fact"]},
        "view_map": report["view_coverage"]["map"],
        "visits": report["visits"],
        "guidance_cross_check": guidance_notes,
        "quote_misses": misses,
        "synthetic_gaps": syn_reports,
    }
    if args.report:
        args.report.write_text(dump({**full, "checks": {k: dict(v) for k, v in full["checks"].items()}}), encoding="utf-8")

    stale = [p for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
    if args.check:
        for p in stale:
            print(f"stale: {p.relative_to(REPO)}")
    else:
        RUNS.mkdir(parents=True, exist_ok=True)
        for p in stale:
            p.write_text(outputs[p], encoding="utf-8")
            print(f"wrote {p.relative_to(REPO)}")

    print("\nFacts per kind:")
    for cid, c in full["counts"].items():
        print(f"  {cid}: {sum(c.values())} facts, {full['sources'][cid]} sources: {c}")
    print("Checks:", {cid: dict(c) for cid, c in full["checks"].items()})
    print("Alerts (today -> run):")
    for cid, rows in alert_map.items():
        for r in rows:
            print(f"  {cid}: {r}")
    print(f"View items of case 10: {full['view_coverage']['items']}, without a fact: {len(full['view_coverage']['without_fact'])}")
    for w in full["view_coverage"]["without_fact"]:
        print(f"  {w}")
    print("Visits:")
    for v in full["visits"]:
        print(f"  {v['id']} {v['visit']}: {v['type']} {v['as_written']!r}, {v['date'] or 'bez data'}, {v['status']} ({', '.join(v['today'])})")
    print(f"Quote misses: {len(misses)}")
    if guidance_notes:
        print("Guidance cross-check:")
        for n in guidance_notes:
            print(f"  {n}")
    return 1 if (args.check and stale) else 0


if __name__ == "__main__":
    raise SystemExit(main())
