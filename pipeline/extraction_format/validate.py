"""The validator every run passes before it is stored, the Python mirror of packages/domain/src/extraction/validate.ts.

Two layers: the JSON Schema generated from the TypeScript types (packages/domain/schema/extraction-2.schema.json), then
the rules a schema cannot express. Issue codes and paths equal the TypeScript ones; the schema messages come from the
jsonschema library and may be worded differently, so callers act on the code, not the message.
"""

import json
import os
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError

from .backing import Evidence, backing_problems
from .keys import alert_id, base_key, build_fact_key, passage_suffix, value_text, view_line_id
from .types import EXTRACTION_SCHEMA, FACT_KINDS, VIEW_NAMES

# The schema lives with the TypeScript types. A container that does not copy packages/ sets the path explicitly.
_DEFAULT_SCHEMA = Path(__file__).resolve().parents[2] / "packages/domain/schema/extraction-2.schema.json"
SCHEMA_PATH = Path(os.environ.get("CODEBRIDGE_EXTRACTION_SCHEMA", _DEFAULT_SCHEMA))

# Composite steps only say "a subschema had errors"; the step inside them says which.
_WRAPPERS = {"$ref", "anyOf", "allOf", "oneOf", "properties", "items", "if", "then", "else"}
_ITEM_PATH = re.compile(r"^/(facts|sources)/\d+")


@dataclass(frozen=True)
class Issue:
    path: str
    code: str
    message: str


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    issues: list[Issue]


@cache
def _schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@cache
def _run_validator() -> Draft7Validator:
    return Draft7Validator(_schema())


@cache
def _def_validator(name: str) -> Draft7Validator | None:
    """One validator per member of a union (a fact kind, a source type), so an invalid item says what is wrong with
    it instead of the errors of every alternative it is not."""
    schema = _schema()
    if name not in schema.get("definitions", {}):
        return None
    return Draft7Validator({**schema, "$ref": f"#/definitions/{name}"})


def _pascal(snake: str) -> str:
    return "".join(w[:1].upper() + w[1:] for w in snake.split("_"))


_SOURCE_DEFS = {"document": "DocumentSource", "nis": "NisSource"}


def _pointer(path: Iterable[Any]) -> str:
    return "".join(f"/{str(p).replace('~', '~0').replace('/', '~1')}" for p in path)


def _leaves(err: ValidationError) -> list[ValidationError]:
    """The innermost errors: an anyOf error carries its alternatives' errors in `context`."""
    if err.context:
        out: list[ValidationError] = []
        for c in err.context:
            out.extend(_leaves(c))
        return out
    return [err]


def _message(leaf: ValidationError) -> str:
    """A message without the offending value: jsonschema quotes it, and a value may be patient text."""
    if leaf.validator == "required":
        return leaf.message  # names the missing field, never a value
    if leaf.validator == "enum":
        return f"value is not one of {json.dumps(leaf.validator_value, ensure_ascii=False)}"
    if leaf.validator == "type":
        return f"value is not of type {json.dumps(leaf.validator_value)}"
    if leaf.validator == "const":
        return f"value is not {json.dumps(leaf.validator_value, ensure_ascii=False)}"
    return f"value fails {leaf.validator}"


def _schema_issues(errors: Iterable[ValidationError], prefix: str = "") -> list[Issue]:
    # (path, keyword, message) per innermost error. jsonschema reports an unknown field at its parent, validate.ts at
    # the field itself, so it is moved to the field before the deepest-location filter.
    found: list[tuple[str, str, str]] = []
    for leaf in (x for e in errors for x in _leaves(e)):
        p = _pointer(leaf.absolute_path)
        if leaf.validator == "additionalProperties" and isinstance(leaf.instance, dict):
            known = set((leaf.schema or {}).get("properties", {}))
            found += [(f"{p}/{k}", "additionalProperties", f"unknown field {k}") for k in sorted(leaf.instance) if k not in known]
        else:
            found.append((p, str(leaf.validator), _message(leaf)))
    paths = [p for p, _, _ in found]
    # Keep the deepest location, as validate.ts does; a missing required field is reported at its parent and kept.
    deepest = [x for x in found if x[1] == "required" or not any(q != x[0] and q.startswith(f"{x[0]}/") for q in paths)]
    out: dict[str, Issue] = {}
    for p, keyword, message in deepest:
        if keyword in _WRAPPERS and any(q == p and k not in _WRAPPERS for q, k, _ in deepest):
            continue
        out.setdefault(f"{p}|{message}", Issue(prefix + p, "schema", message))
    return list(out.values())


def validate_run(run: Any) -> ValidationResult:
    """Validates a run. `ok` is False when there is any issue; the run must then not be stored."""
    issues: list[Issue] = []
    top = list(_run_validator().iter_errors(run))
    # Fact and source errors are reported per item below, with the item's own schema.
    issues += [i for i in _schema_issues(top) if not _ITEM_PATH.match(i.path)]
    if not isinstance(run, dict) or run.get("schema") != EXTRACTION_SCHEMA:
        return ValidationResult(False, issues)
    facts = run.get("facts") if isinstance(run.get("facts"), list) else []
    for i, f in enumerate(facts):
        kind = f.get("kind") if isinstance(f, dict) else None
        if not isinstance(kind, str) or kind not in FACT_KINDS:
            issues.append(Issue(f"/facts/{i}/kind", "unknown_kind", f"unknown fact kind {json.dumps(kind, ensure_ascii=False)}"))
            continue
        issues += _schema_issues(_def_validator(f"{_pascal(kind)}Fact").iter_errors(f), f"/facts/{i}")  # type: ignore[union-attr]
    sources = run.get("sources") if isinstance(run.get("sources"), list) else []
    for i, s in enumerate(sources):
        stype = s.get("type") if isinstance(s, dict) else None
        name = _SOURCE_DEFS.get(stype) if isinstance(stype, str) else None
        if name is None:
            issues.append(Issue(f"/sources/{i}/type", "schema", f"unknown source type {json.dumps(stype, ensure_ascii=False)}"))
            continue
        issues += _schema_issues(_def_validator(name).iter_errors(s), f"/sources/{i}")  # type: ignore[union-attr]
    # Reference rules need well-formed arrays; with schema errors present they would only add noise.
    if issues:
        return ValidationResult(False, issues)
    issues += reference_issues(run)
    return ValidationResult(not issues, issues)


_SORT_FORM = {
    "year": re.compile(r"^[0-9]{4}\Z"),
    "month": re.compile(r"^[0-9]{4}-[0-9]{2}\Z"),
    "day": re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z"),
    "minute": re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}"),
}


def date_precision_problem(date: Mapping[str, Any]) -> str | None:
    """Why a fact date's sort form does not fit its precision, or None (datePrecisionProblem in validate.ts)."""
    precision, sort = date.get("precision"), date.get("sort")
    if (precision is None) != (sort is None):
        return "precision and sort are set together or not at all"
    if precision and sort and not _SORT_FORM[precision].match(sort):
        return f"sort form {sort} does not match precision {precision}"
    return None


def _duplicates(items: list[Mapping[str, Any]], id_of: Callable[[Mapping[str, Any]], str], path: Callable[[int], str], code: str, what: str) -> list[Issue]:
    seen: set[str] = set()
    out: list[Issue] = []
    for i, x in enumerate(items):
        xid = id_of(x)
        if xid in seen:
            out.append(Issue(path(i), code, f"duplicate {what} {xid}"))
        seen.add(xid)
    return out


def evidence_of(facts: list[Mapping[str, Any]], sources: Mapping[str, Mapping[str, Any]]) -> Evidence:
    """What a set of facts says, for backing a composed text: values, codes, dates and quoted passages (evidenceOf)."""
    texts: list[str] = []
    for f in facts:
        texts += [value_text(f["value"]), f["date"].get("as_written") or "", f["date"].get("sort") or ""]
        for c in f["codes"]:
            texts += [c["code"], c.get("display") or ""]
        for sid in f["sources"]:
            src = sources.get(sid)
            if src and src["type"] == "document":
                texts.append(src["quote"])
    return Evidence([t for t in texts if t], any(f["negated"] for f in facts), bool(facts) and all(f["negated"] for f in facts))


def reference_issues(run: Mapping[str, Any]) -> list[Issue]:
    """The rules a JSON Schema cannot express. Assumes the run passed the schema. Same order and codes as validate.ts."""
    issues: list[Issue] = []

    def push(path: str, code: str, message: str) -> None:
        issues.append(Issue(path, code, message))

    issues += _duplicates(run["facts"], lambda f: f["id"], lambda i: f"/facts/{i}/id", "duplicate_fact_id", "fact ID")
    issues += _duplicates(run["facts"], lambda f: f["key"], lambda i: f"/facts/{i}/key", "duplicate_fact_key", "fact key")
    issues += _duplicates(run["sources"], lambda s: s["id"], lambda i: f"/sources/{i}/id", "duplicate_source_id", "source ID")
    issues += _duplicates(run["alerts"], lambda a: a["id"], lambda i: f"/alerts/{i}/id", "duplicate_alert_id", "alert ID")
    issues += _duplicates(run["checks"], lambda c: c["id"], lambda i: f"/checks/{i}/id", "duplicate_check_id", "check ID")

    docs = {d["document_id"]: set(d["parts"]) for d in run["documents"]}
    sources = {s["id"]: s for s in run["sources"]}
    facts = {f["id"]: f for f in run["facts"]}

    def check_doc_part(path: str, document_id: str, part: str | None) -> None:
        parts = docs.get(document_id)
        if parts is None:
            push(f"{path}/document_id", "unknown_document", f"document {document_id} is not in the run's documents")
        elif part is not None and part not in parts:
            push(f"{path}/part", "unknown_part", f"part {part} is not a part of {document_id}")

    for i, s in enumerate(run["sources"]):
        if s["type"] == "document":
            check_doc_part(f"/sources/{i}", s["document_id"], s["part"])

    for i, f in enumerate(run["facts"]):
        p = f"/facts/{i}"
        based_on = f.get("based_on")
        # Only an assistant inference may stand without a passage, and then it must say which facts it rests on.
        if not f["sources"] and not (f["origin"] == "assistant" and based_on):
            push(f"{p}/sources", "fact_without_sources", f"fact {f['id']} has no sources (only an assistant fact with based_on may)")
        for j, s in enumerate(f["sources"]):
            if s not in sources:
                push(f"{p}/sources/{j}", "unknown_source", f"unknown source {s}")
        for j, b in enumerate(based_on or []):
            if b not in facts:
                push(f"{p}/based_on/{j}", "unknown_fact", f"unknown fact {b}")
        v = f["value"]
        if f["kind"] == "request" and v.get("result_fact") and v["result_fact"] not in facts:
            push(f"{p}/value/result_fact", "unknown_fact", f"unknown fact {v['result_fact']}")
        if f["kind"] == "interval":
            if f["origin"] != "assistant":
                push(f"{p}/origin", "interval_not_assistant", "an interval is always the assistant's computation")
            for end in ("from_fact", "to_fact"):
                if v[end] not in facts:
                    push(f"{p}/value/{end}", "unknown_fact", f"unknown fact {v[end]}")
        resolved = bool(f["sources"]) or f["origin"] == "assistant"
        want = build_fact_key(f, sources)
        # A lab value that shares its key with another one carries its passage in the key as well (assign_keys).
        passage = passage_suffix(f, sources)
        key_ok = base_key(f["key"]) == want or (passage is not None and base_key(f["key"]) == f"{want}|{passage}")
        if resolved and all(s in sources for s in f["sources"]) and not key_ok:
            # The message names no key: keys hold clinical text, and issues may be logged.
            push(f"{p}/key", "key_mismatch", f"the key of fact {f['id']} does not follow from its kind and values")

        # A partial date stays partial: "03/2024" must not gain a day in its sort form, which the timeline orders by.
        problem = date_precision_problem(f["date"])
        if problem:
            push(f"{p}/date", "date_precision", problem)
        # "Bez metastáz" is a recorded negative; the status and the negation must say the same.
        if f["kind"] == "metastasis" and (v["status"] == "excluded") != f["negated"]:
            want_neg = "true" if v["status"] == "excluded" else "false"
            push(f"{p}/negated", "negation_mismatch", f"metastasis status {v['status']} needs negated: {want_neg}")
        # A drug with a stated stop is history: listing it as current medication would mislead the doctor.
        if f["kind"] == "medication" and v.get("stop_as_written") is not None and f["status"] not in ("stopped", "interrupted"):
            push(f"{p}/status", "stop_without_stopped_status", f"medication {f['id']} has a stop but status {f['status']}")
        # A relative's disease is family history and never becomes the patient's.
        if (f["kind"] == "family_history") != (f["subject"] == "relative"):
            msg = "family history is about a relative" if f["kind"] == "family_history" else f"a {f['kind']} fact is about the patient"
            push(f"{p}/subject", "subject_mismatch", msg)

        conflicting = any(sources.get(s, {}).get("type") == "document" and sources[s].get("identity") == "conflicts" for s in f["sources"])
        if conflicting and not f["quarantined"]:
            push(f"{p}/quarantined", "quarantine_missing", f"fact {f['id']} rests on a page that shows another patient and must be quarantined")
        if f["quarantined"] and not conflicting:
            push(f"{p}/quarantined", "quarantine_without_conflict", f"fact {f['id']} is quarantined but none of its sources conflicts on identity")

    quarantined = {f["id"] for f in run["facts"] if f["quarantined"]}
    if quarantined and not any(a["kind"] == "identity" for a in run["alerts"]):
        push("/alerts", "quarantine_without_identity_alert", "quarantined facts need an identity alert that tells the doctor")

    # A quarantined fact stays out of the brief, the question and the rules until a doctor resolves the identity.
    def use_of(path: str, fid: str) -> None:
        if fid in quarantined:
            push(path, "quarantined_in_use", f"quarantined fact {fid} is used outside the identity alert")

    for i, f in enumerate(run["facts"]):
        if f["quarantined"]:
            continue
        for j, b in enumerate(f.get("based_on") or []):
            use_of(f"/facts/{i}/based_on/{j}", b)
        if f["kind"] == "interval":
            use_of(f"/facts/{i}/value/from_fact", f["value"]["from_fact"])
            use_of(f"/facts/{i}/value/to_fact", f["value"]["to_fact"])
        if f["kind"] == "request" and f["value"].get("result_fact"):
            use_of(f"/facts/{i}/value/result_fact", f["value"]["result_fact"])

    for i, a in enumerate(run["alerts"]):
        p = f"/alerts/{i}"
        for j, fid in enumerate(a["facts"]):
            if fid not in facts:
                push(f"{p}/facts/{j}", "unknown_fact", f"unknown fact {fid}")
            elif a["kind"] != "identity":
                use_of(f"{p}/facts/{j}", fid)
        # A rule's subject names the facts it is about (one ID, or a sorted pair); a quarantined one may not be among them.
        if a["kind"] != "identity":
            for fid in a["subject"].split("|"):
                use_of(f"{p}/subject", fid)
        want = alert_id(a)
        if a["id"] != want:
            push(f"{p}/id", "alert_id_mismatch", f"alert ID {a['id']} should be {want} (rule and subject)")
        if a["kind"] == "contradiction":
            kinds = {facts[fid]["kind"] for fid in a["facts"] if fid in facts}
            if len(kinds) > 1:
                push(f"{p}/facts", "contradiction_mixed_kinds", "a contradiction compares facts of one kind only")

    for i, c in enumerate(run["checks"]):
        p = f"/checks/{i}"
        if c["expected"] and c["expected"]["of_fact"] not in facts:
            push(f"{p}/expected/of_fact", "unknown_fact", f"unknown fact {c['expected']['of_fact']}")
        elif c["expected"]:
            use_of(f"{p}/expected/of_fact", c["expected"]["of_fact"])
        # A check for a fact kind must agree with the facts (quarantined facts count: the documents do state them).
        if not c["expected"] and c["looks_for"] in FACT_KINDS and c["result"] != "not_run":
            has = any(f["kind"] == c["looks_for"] for f in run["facts"])
            if (c["result"] == "found") != has:
                push(f"{p}/result", "check_result_mismatch", f"check {c['id']} says {c['result']} but the run has {'' if has else 'no '}{c['looks_for']} facts")
        for j, x in enumerate(c["covered"]):
            check_doc_part(f"{p}/covered/{j}", x["document_id"], x["part"])
        for j, x in enumerate(c["unreadable"]):
            check_doc_part(f"{p}/unreadable/{j}", x["document_id"], x["part"])

    for i, s in enumerate((run.get("brief") or {}).get("sentences", [])):
        # A brief sentence with no facts cannot be checked against them, so the producer must drop it.
        if not s["facts"]:
            push(f"/brief/sentences/{i}/facts", "sentence_without_facts", "a brief sentence must point at the facts it states")
        for j, fid in enumerate(s["facts"]):
            path = f"/brief/sentences/{i}/facts/{j}"
            if fid not in facts:
                push(path, "unknown_fact", f"unknown fact {fid}")
            else:
                use_of(path, fid)
        # Every date, number, negation and side of the sentence must be in its facts.
        evidence = evidence_of([facts[fid] for fid in s["facts"] if fid in facts], sources)
        for problem in backing_problems(s["text"], evidence) if s["facts"] else []:
            push(f"/brief/sentences/{i}/text", "sentence_unbacked", f"a {problem} in the sentence is not in its facts")
    for i, b in enumerate((run.get("question_draft") or {}).get("basis", [])):
        for j, fid in enumerate(b["facts"]):
            path = f"/question_draft/basis/{i}/facts/{j}"
            if fid not in facts:
                push(path, "unknown_fact", f"unknown fact {fid}")
            else:
                use_of(path, fid)

    # Composed lines say only what their facts say; the ID follows from the view and the facts (validate.ts).
    for view in VIEW_NAMES:
        lines = (run.get("views") or {}).get(view)
        if not lines:
            continue
        seen: set[str] = set()
        for i, line in enumerate(lines):
            p = f"/views/{view}/{i}"
            if line["id"] in seen:
                push(f"{p}/id", "duplicate_view_line_id", f"duplicate view line ID {line['id']}")
            seen.add(line["id"])
        for i, line in enumerate(lines):
            p = f"/views/{view}/{i}"
            if not line["facts"]:
                push(f"{p}/facts", "view_line_without_facts", "a view line must point at the facts it states")
            for j, fid in enumerate(line["facts"]):
                if fid not in facts:
                    push(f"{p}/facts/{j}", "unknown_fact", f"unknown fact {fid}")
                else:
                    use_of(f"{p}/facts/{j}", fid)
            want = view_line_id(view, line["facts"])
            if line["id"] != want:
                push(f"{p}/id", "view_line_id_mismatch", f"view line ID {line['id']} should be {want} (view and facts)")
            problem = date_precision_problem(line["date"])
            if problem:
                push(f"{p}/date", "date_precision", problem)
            own = [facts[fid] for fid in line["facts"] if fid in facts]
            # Filed under the date of one of its facts; a planned line rests on a planned fact (validate.ts).
            if line["date"]["sort"] and own and not any(f["date"]["sort"] == line["date"]["sort"] for f in own):
                push(f"{p}/date", "view_line_date_unbacked", "the line's date is not the date of any of its facts")

            def ahead(s: str) -> bool:
                return s in ("planned", "requested")

            if own and (not any(ahead(f["status"]) for f in own) if ahead(line["status"]) else all(ahead(f["status"]) for f in own)):
                push(f"{p}/status", "view_line_status_mismatch", f"the line's status {line['status']} does not fit its facts' statuses")
            evidence = evidence_of(own, sources)
            for field in ("text", "title", "detail"):
                text = line.get(field)
                if not text or not line["facts"]:
                    continue
                for problem in backing_problems(text, evidence):
                    push(f"{p}/{field}", "view_line_unbacked", f"a {problem} in the line's {field} is not in its facts")
    return issues
