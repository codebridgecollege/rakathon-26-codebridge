"""Small builders for the hand-written fact specs of the codebridge.extraction/2 conversion (convert_v2.py).

A spec names each fact by a local handle (for alerts, the brief and the guidance files), gives its value as the
format's types define it (packages/domain/src/extraction/types.ts), and lists the passages it rests on as quotes on a
page. The converter turns the quotes into verbatim sources and the handles into fact IDs; nothing here is an ID.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Q:
    """A passage on a page. `text` is matched against the page text with whitespace tolerance; the source keeps the
    page's own characters. `part` is the ordinal of the document part (today's documents list) when the page belongs
    to several parts; `cited` marks a passage that quotes another report (the format's reported_as)."""

    page: int
    text: str
    part: int | None = None
    cited: bool | None = None


@dataclass
class Spec:
    handle: str
    kind: str
    value: dict[str, Any]
    date: str | None = None
    status: str = "documented"
    negated: bool = False
    quotes: list[Q] = field(default_factory=list)
    certainty: str = "clear"
    reason: tuple[str, str] | None = None
    note: str | None = None
    codes: list[dict[str, Any]] = field(default_factory=list)
    not_stated: list[str] = field(default_factory=list)
    origin: str = "document"
    based_on: list[str] | None = None
    subject: str = "patient"


@dataclass
class AlertSpec:
    rule: str
    kind: str
    subject: str | tuple[str, str]  # a fact handle, a pair of handles, or a literal subject ("age", a part ID)
    facts: list[str]
    args: dict[str, str]  # argument name -> fact handle (fact, fact_a, fact_b) or literal (document, field)
    note: str | None = None
    replaces: list[str] = field(default_factory=list)  # today's items it replaces, for the conversion report


def verify(text: str, code: str = "ocr_char_swap") -> dict[str, Any]:
    """The "ověřit" mark: certainty verify with its reason, shown to the doctor in a tooltip."""
    return {"certainty": "verify", "reason": (code, text)}


# ----- values per kind (all fields of the kind, so the JSON Schema's required lists are met) -----

def dx(text, status=None, primary=False):
    return {"text": text, "disease_status": status, "primary": primary}


def hist(specimen, result, tumour=None, grade=None):
    return {"specimen": specimen, "result_text": result, "tumour_type": tumour, "grade": grade}


def stage(as_written, tnm, kind, as_of, at_diagnosis, edition=None):
    return {"tnm_as_written": as_written, "tnm": tnm, "stage_kind": kind, "edition": edition, "as_of": as_of, "at_diagnosis": at_diagnosis}


def meta(site, status, basis=None, text=None):
    return {"site": site, "status": status, "basis": basis, "text": text}


def proc(name, region=None, text=None):
    return {"name": name, "region": region, "text": text}


def ther(regimen, line=None, start=None, stop=None, reason=None, text=None):
    return {"regimen": regimen, "line": line, "start": start, "stop": stop, "reason_stopped": reason, "text": text}


def rt(target, dose=None, fractions=None, text=None):
    return {"target": target, "dose": dose, "fractions": fractions, "text": text}


def img(modality, region, finding, response=None):
    return {"modality": modality, "region": region, "finding_text": finding, "response": response}


def resp(system, category):
    return {"system": system, "category": category}


def vital(what, value, numeric, unit, label=None):
    return {"what": what, "label_as_written": label, "value_as_written": value, "value_numeric": numeric, "unit": unit}


def perf(scale, value, numeric):
    return {"scale": scale, "value_as_written": value, "value_numeric": numeric}


def exam(region, text):
    return {"region": region, "text": text}


def sym(text):
    return {"text": text}


def comor(text):
    return {"text": text}


def med(drug, strength=None, dosing=None, change=None, indication=None, text=None):
    return {"drug": drug, "strength": strength, "dosing": dosing, "change": change, "indication": indication, "text": text}


def contra(what, stated_by="document"):
    return {"what": what, "stated_by": stated_by}


def ae(text, grade=None, related=None):
    return {"text": text, "grade": grade, "related_therapy": related}


def prog(score, value, group=None):
    return {"score": score, "value_as_written": value, "risk_group": group}


def risk(kind, text, pack_years=None):
    return {"type": kind, "text": text, "pack_years": pack_years}


def req(what, kind=None, result=None):
    return {"what": what, "request_kind": kind, "result_fact": result}


def dec(body, text, as_written=None):
    return {"body": body, "body_as_written": as_written, "text": text}


def plan(what, when=None):
    return {"what": what, "when_as_written": when}


def code(system, value, display=None):
    return {"system": system, "code": value, "assigned_by": "source", "display": display}
