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

from .keys import alert_id, base_key, build_fact_key
from .types import EXTRACTION_SCHEMA, FACT_KINDS

# The schema lives with the TypeScript types. A container that does not copy packages/ sets the path explicitly.
_DEFAULT_SCHEMA = Path(__file__).resolve().parents[2] / "packages/domain/schema/extraction-2.schema.json"
SCHEMA_PATH = Path(os.environ.get("CODEBRIDGE_EXTRACTION_SCHEMA", _DEFAULT_SCHEMA))

# Composite steps only say "a subschema had errors"; the step inside them says which.
_WRAPPERS = {"$ref", "anyOf", "allOf", "oneOf", "properties", "items", "if", "then", "else"}
_FACT_PATH = re.compile(r"^/facts/\d+")


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
def _fact_validator(kind: str) -> Draft7Validator | None:
    """One validator per fact kind, so an invalid fact says what is wrong instead of failing 25 alternatives."""
    name = "".join(w[:1].upper() + w[1:] for w in kind.split("_")) + "Fact"
    schema = _schema()
    if name not in schema.get("definitions", {}):
        return None
    return Draft7Validator({**schema, "$ref": f"#/definitions/{name}"})


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


def _schema_issues(errors: Iterable[ValidationError], prefix: str = "") -> list[Issue]:
    leaves = [leaf for e in errors for leaf in _leaves(e)]
    paths = [_pointer(leaf.absolute_path) for leaf in leaves]
    # Keep the deepest location, as validate.ts does: an enclosing object's error repeats what its field says.
    deepest = [(p, leaf) for p, leaf in zip(paths, leaves) if not any(q != p and q.startswith(f"{p}/") for q in paths)]
    out: dict[str, Issue] = {}
    for p, leaf in deepest:
        if leaf.validator in _WRAPPERS and any(q == p and x.validator not in _WRAPPERS for q, x in deepest):
            continue
        if leaf.validator == "additionalProperties":
            # jsonschema reports an unknown field at its parent; validate.ts reports it at the field itself.
            known = set((leaf.schema or {}).get("properties", {}))
            for extra in sorted(k for k in leaf.instance if k not in known):
                path = f"{prefix}{p}/{extra}"
                out.setdefault(f"{path}|unknown", Issue(path, "schema", f"unknown field {extra}"))
            continue
        path = prefix + p
        out.setdefault(f"{path}|{leaf.message}", Issue(path, "schema", leaf.message))
    return list(out.values())


def validate_run(run: Any) -> ValidationResult:
    """Validates a run. `ok` is False when there is any issue; the run must then not be stored."""
    issues: list[Issue] = []
    top = list(_run_validator().iter_errors(run))
    # Fact errors are reported per fact below, with the fact's own schema.
    issues += [i for i in _schema_issues(top) if not _FACT_PATH.match(i.path)]
    if not isinstance(run, dict) or run.get("schema") != EXTRACTION_SCHEMA:
        return ValidationResult(False, issues)
    facts = run.get("facts") if isinstance(run.get("facts"), list) else []
    for i, f in enumerate(facts):
        kind = f.get("kind") if isinstance(f, dict) else None
        if not isinstance(kind, str) or kind not in FACT_KINDS:
            issues.append(Issue(f"/facts/{i}/kind", "unknown_kind", f"unknown fact kind {json.dumps(kind, ensure_ascii=False)}"))
            continue
        issues += _schema_issues(_fact_validator(kind).iter_errors(f), f"/facts/{i}")  # type: ignore[union-attr]
    # Reference rules need well-formed arrays; with schema errors present they would only add noise.
    if issues:
        return ValidationResult(False, issues)
    issues += reference_issues(run)
    return ValidationResult(not issues, issues)


def _duplicates(items: list[Mapping[str, Any]], id_of: Callable[[Mapping[str, Any]], str], path: Callable[[int], str], code: str, what: str) -> list[Issue]:
    seen: set[str] = set()
    out: list[Issue] = []
    for i, x in enumerate(items):
        xid = id_of(x)
        if xid in seen:
            out.append(Issue(path(i), code, f"duplicate {what} {xid}"))
        seen.add(xid)
    return out


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
        if resolved and all(s in sources for s in f["sources"]) and base_key(f["key"]) != want:
            push(f"{p}/key", "key_mismatch", f"key {json.dumps(f['key'], ensure_ascii=False)} should be {json.dumps(want, ensure_ascii=False)}")

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
    for i, b in enumerate((run.get("question_draft") or {}).get("basis", [])):
        for j, fid in enumerate(b["facts"]):
            path = f"/question_draft/basis/{i}/facts/{j}"
            if fid not in facts:
                push(path, "unknown_fact", f"unknown fact {fid}")
            else:
                use_of(path, fid)
    return issues
