"""Fact keys and IDs for codebridge.extraction/2, the Python mirror of packages/domain/src/extraction/keys.ts.

A doctor's confirmation, edit or alert acknowledgement attaches to a fact ID or an alert ID, so a key built here must
equal the one the Worker builds. Both sides are tested against packages/domain/test/extraction-key-vectors.json; change
a rule in both files at once (docs/design/EXTRACTION-FORMAT.md, "Fact identity").
"""

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any

# JavaScript's \s (and what trim() removes), as code points: Python's \s and strip() differ (they lack U+FEFF and
# include U+001C..U+001F), and a different space rule would give the Python pipeline different keys from the Worker.
_JS_SPACE = "".join(
    map(chr, [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF])
)
_SPACE_CLASS = re.escape(_JS_SPACE)
_SPACES = re.compile(f"[{_SPACE_CLASS}]+")
_TRAILING = re.compile(f"[{_SPACE_CLASS}.,;:]+$")
_SUFFIX = re.compile(r"#\d+$")

_PRECISION_LEN = {"year": 4, "month": 7, "day": 10, "minute": 16}


def fnv1a32(text: str) -> str:
    """FNV-1a over the UTF-8 bytes of the NFC text, 32 bits, as 8 hex digits."""
    h = 0x811C9DC5
    for byte in unicodedata.normalize("NFC", text).encode("utf-8", "surrogatepass"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def norm_text(text: str | None) -> str:
    """Text as a key segment: NFC, invisible format characters (category Cf: soft hyphen, zero-width space) removed,
    lower case, whitespace collapsed, trailing punctuation dropped, "|" as "/"."""
    if text is None:
        return ""
    t = "".join(ch for ch in unicodedata.normalize("NFC", text) if unicodedata.category(ch) != "Cf")
    t = t.lower().replace("|", "/")
    t = _SPACES.sub(" ", t).strip(_JS_SPACE)
    return _TRAILING.sub("", t)


def _code_seg(code: str) -> str:
    return code.strip(_JS_SPACE).replace("|", "/")


def _js_number(x: float) -> str:
    """Number::toString from ECMAScript: shortest round-trip digits, exponent form below 1e-6 and from 1e21."""
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    _, digits_t, exp = Decimal(repr(abs(x))).normalize().as_tuple()
    digits = "".join(map(str, digits_t))
    k = len(digits)
    n = k + int(exp)  # the value is 0.digits * 10**n
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = f"{digits[:n]}.{digits[n:]}"
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + (f".{digits[1:]}" if k > 1 else "") + f"e{'+' if e > 0 else '-'}{abs(e)}"
    return sign + out


def js_str(value: Any) -> str:
    """String(value) as JavaScript writes it, for numbers and booleans in keys, value text and source IDs."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        # JSON integers arrive as int in Python and as a double in JS.
        return _js_number(float(value)) if isinstance(value, float) or abs(value) >= 10**21 else str(value)
    return str(value)


def value_text(value: Any) -> str:
    """All strings in a value, flattened in key order, as valueText in keys.ts."""
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return js_str(value)
    if isinstance(value, list):
        return " ".join(value_text(v) for v in value)
    # Object keys sort by UTF-16 code units in JS; the UTF-16 encoding compares the same way.
    return " ".join(value_text(value[k]) for k in sorted(value, key=_utf16))


def _utf16(text: str) -> bytes:
    return text.encode("utf-16-be", "surrogatepass")


def date_seg(date: Mapping[str, Any]) -> str:
    """The date part of a key: the sort form cut to the precision, else the text as written, else "undated"."""
    if date.get("sort") and date.get("precision"):
        return date["sort"][: _PRECISION_LEN[date["precision"]]]
    return norm_text(date.get("as_written")) or "undated"


def _written_date_seg(date: Mapping[str, Any]) -> str:
    return norm_text(date.get("as_written")) or "undated"


def _origin_seg(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> str:
    docs: set[str] = set()
    for sid in fact["sources"]:
        s = sources.get(sid)
        if s is None:
            continue
        docs.add(f"doc:{s['document_id']}" if s["type"] == "document" else f"nis:{s['resource']}")
    # Sorted by UTF-16 code units in JS; document IDs and FHIR references are ASCII, where the orders agree.
    return "+".join(sorted(docs)) if docs else "doc:none"


def _passage_seg(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> str | None:
    """A hash of the passages a fact is quoted from (passageSeg in keys.ts)."""
    quotes = []
    for sid in fact["sources"]:
        s = sources.get(sid)
        if s is not None and s["type"] == "document":
            quotes.append(norm_text(s["quote"]))
    # Sorted by UTF-16 code units, as JS sorts strings.
    return f"src:{fnv1a32(chr(10).join(sorted(quotes, key=_utf16)))}" if quotes else None


def _part_seg(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> str:
    """The document parts a fact is quoted from (partSeg in keys.ts)."""
    parts: set[str] = set()
    for sid in fact["sources"]:
        s = sources.get(sid)
        if s is None:
            continue
        if s["type"] == "document":
            # "??" in keys.ts: only a missing part falls back to the document.
            parts.add(f"part:{s['document_id'] if s.get('part') is None else s['part']}")
        else:
            parts.add(f"nis:{s['resource']}")
    return "+".join(sorted(parts, key=_utf16)) if parts else "part:none"


def _first_code(fact: Mapping[str, Any]) -> str | None:
    codes = fact["codes"]
    own = next((c for c in codes if c["assigned_by"] == "source"), codes[0] if codes else None)
    return _code_seg(own["code"]) if own else None


def _code_or(fact: Mapping[str, Any], fallback: str) -> str:
    # "??" in keys.ts: only a missing code falls back; an empty code segment stays empty.
    code = _first_code(fact)
    return fallback if code is None else code


def _join(*parts: Any) -> str:
    return "|".join(str(p) for p in parts)


def build_fact_key(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> str:
    """The key of a fact, per kind, without the collision suffix. Mirrors buildFactKey in keys.ts line by line."""
    kind = fact["kind"]
    v = fact["value"]
    d = fact["date"]
    if kind == "lab_result":
        what = _code_or(fact, norm_text(v["name_as_written"]))
        draw = norm_text(v["draw"]["as_written"]) or norm_text(d.get("as_written")) or "undated"
        parts = [kind, what, f"draw:{draw}"]
        if v["draw"].get("requisition"):
            parts.append(f"req:{norm_text(v['draw']['requisition'])}")
        parts.append(_origin_seg(fact, sources))
        # Undated values of one test in one document are told apart by their quoted passage (see keys.ts).
        if draw == "undated" and not v["draw"].get("requisition"):
            passage = _passage_seg(fact, sources)
            if passage:
                parts.append(passage)
        return _join(*parts)
    if kind == "diagnosis":
        return _join(kind, _code_or(fact, norm_text(v["text"])), "status:none" if v["disease_status"] is None else v["disease_status"], date_seg(d))
    if kind == "medication":
        # Undated list entries of one drug at two visits are told apart by their document part (stable, not a position).
        start = date_seg(d)
        parts = [kind, norm_text(v["drug"]), f"start:{start}"]
        if start == "undated":
            parts.append(_part_seg(fact, sources))
        return _join(*parts)
    if kind == "systemic_therapy":
        start = norm_text(v["start"]) or date_seg(d)
        line = "none" if v["line"] is None else js_str(v["line"])
        parts = [kind, norm_text(v["regimen"]), f"line:{line}", f"start:{start}"]
        if start == "undated":
            parts.append(_part_seg(fact, sources))
        return _join(*parts)
    if kind == "stage":
        return _join(kind, v["stage_kind"], date_seg(d))
    if kind == "imaging":
        return _join(kind, norm_text(v["modality"]), norm_text(v["region"]), date_seg(d))
    if kind == "procedure":
        return _join(kind, norm_text(v["name"]), norm_text(v["region"]), date_seg(d))
    if kind == "histology":
        return _join(kind, norm_text(v["specimen"]), date_seg(d))
    if kind in ("request", "plan"):
        return _join(kind, norm_text(v["what"]), _written_date_seg(d))
    if kind == "radiotherapy":
        return _join(kind, norm_text(v["target"]), date_seg(d))
    if kind == "metastasis":
        return _join(kind, norm_text(v["site"]), date_seg(d))
    if kind == "vital_sign":
        return _join(kind, norm_text(v["label_as_written"]) if v["what"] == "other" else v["what"], date_seg(d))
    if kind == "performance_status":
        return _join(kind, norm_text(v["scale"]), date_seg(d))
    if kind == "prognostic_score":
        return _join(kind, norm_text(v["score"]), date_seg(d))
    if kind == "risk_factor":
        return _join(kind, v["type"], date_seg(d))
    if kind == "allergy":
        return _join(kind, norm_text(v["substance"]), date_seg(d))
    if kind == "family_history":
        return _join(kind, norm_text(v["relation"]), norm_text(v["condition"]), date_seg(d))
    if kind == "decision":
        return _join(kind, v["body"], date_seg(d))
    if kind == "contraindication":
        return _join(kind, norm_text(v["what"]), date_seg(d))
    if kind == "visit":
        return _join(kind, v["type"], date_seg(d))
    if kind == "interval":
        return _join(kind, v["from_fact"], v["to_fact"])
    if kind == "comorbidity":
        return _join(kind, _code_or(fact, norm_text(v["text"])), date_seg(d))
    if kind == "exam_finding":
        return _join(kind, norm_text(v["region"]), norm_text(v["text"]), date_seg(d))
    if kind in ("symptom", "adverse_event"):
        return _join(kind, norm_text(v["text"]), date_seg(d))
    raise ValueError(f"unknown fact kind {kind!r}")


def base_key(key: str) -> str:
    """Strip the collision suffix ("#2")."""
    return _SUFFIX.sub("", key)


def _content_order(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> bytes:
    """What orders facts that share a key: their content, never their position (contentOrder in keys.ts)."""
    quotes = []
    for sid in fact["sources"]:
        s = sources.get(sid)
        if s is None:
            quotes.append("")
        elif s["type"] == "document":
            quotes.append(f"{s['document_id']}|{norm_text(s['quote'])}")
        else:
            quotes.append(f"nis|{s['resource']}")
    quotes.sort(key=_utf16)
    return _utf16(value_text(fact["value"]) + "\0" + "\0".join(quotes))


def assign_keys(facts: Sequence[Mapping[str, Any]], sources: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Keys for all facts of a run; facts sharing a key get "#2", "#3" in the order of their content."""
    by_id = {s["id"]: s for s in sources}
    groups: dict[str, list[int]] = {}
    for i, f in enumerate(facts):
        groups.setdefault(build_fact_key(f, by_id), []).append(i)
    out: list[str] = [""] * len(facts)
    for key, members in groups.items():
        # UTF-16 bytes compare like JS strings; identical content falls back to the input order, as in keys.ts.
        members.sort(key=lambda i: (_content_order(facts[i], by_id), i))
        for n, i in enumerate(members):
            out[i] = key if n == 0 else f"{key}#{n + 1}"
    return [{**f, "key": out[i]} for i, f in enumerate(facts)]


def mint_fact_id(case_id: str, key: str, taken: set[str] | frozenset[str]) -> str:
    """A fresh fact ID from the case and the key, salted when it is taken."""
    salt = 0
    while True:
        fid = f"f-{fnv1a32(f'{case_id}|{key}|{salt}' if salt else f'{case_id}|{key}')}"
        if fid not in taken:
            return fid
        salt += 1


def source_id_for(source: Mapping[str, Any], taken: set[str] | frozenset[str] = frozenset()) -> str:
    """A source ID from where the passage is, so a re-run over the same page gives the same ID."""
    if source["type"] == "document":
        base = f"{source['document_id']}|{source.get('part') or ''}|{js_str(source['page'])}|{source['quote']}"
    else:
        base = f"{source['system']}|{source['resource']}|{source.get('version') or ''}"
    salt = 0
    while True:
        sid = f"src-{fnv1a32(f'{base}|{salt}' if salt else base)}"
        if sid not in taken:
            return sid
        salt += 1


def pair_subject(a: str, b: str) -> str:
    """The subject of an alert about two facts: both IDs, sorted."""
    return "|".join(sorted([a, b]))


def alert_id(alert: Mapping[str, Any]) -> str:
    """The alert ID: the rule plus its subject, nothing else."""
    return "al-" + fnv1a32(f"{alert['rule']}|{alert['subject']}")


def view_line_id(view: str, facts: list[str]) -> str:
    """The ID of a composed view line: the view's name and the line's facts, sorted, nothing else (viewLineId)."""
    return "vl-" + fnv1a32(f"{view}|{'|'.join(sorted(facts))}")
