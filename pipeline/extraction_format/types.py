"""TypedDicts for codebridge.extraction/2, the Python side of packages/domain/src/extraction/types.ts.

A run is the output of one extraction over a case's documents (docs/design/EXTRACTION-FORMAT.md). The TypeScript types
are the one definition: the JSON Schema is generated from them, and validate.py checks every run against that schema.
These TypedDicts only give the pipeline's code names and editor help. They type the frame of each record; the fields
of each fact kind's `value` are checked by the schema, not repeated here.
"""

from typing import Any, Literal, NotRequired, TypedDict

EXTRACTION_SCHEMA = "codebridge.extraction/2"

Producer = Literal["fixture", "pipeline", "nis"]
QuoteText = Literal["pdf_text", "tesseract", "vision"]
DatePrecision = Literal["minute", "day", "month", "year"]
IdentityResult = Literal["matches", "conflicts", "cannot_verify"]
Subject = Literal["patient", "relative"]
FactStatus = Literal["documented", "planned", "requested", "done", "stopped", "interrupted"]
Origin = Literal["document", "nis", "assistant"]
Certainty = Literal["clear", "verify", "conflicting", "inferred", "unreadable"]
CheckResult = Literal["found", "nothing_found", "not_run"]
AlertKind = Literal["missing", "contradiction", "chronology", "unclear", "poor_copy", "identity"]
FactKind = Literal[
    "diagnosis", "histology", "stage", "metastasis", "procedure", "systemic_therapy", "radiotherapy", "imaging",
    "lab_result", "vital_sign", "performance_status", "exam_finding", "symptom", "comorbidity", "medication",
    "contraindication", "allergy", "adverse_event", "prognostic_score", "risk_factor", "family_history", "request",
    "decision", "plan", "interval",
]

# The same list and order as FACT_KINDS in types.ts.
FACT_KINDS: tuple[str, ...] = (
    "diagnosis", "histology", "stage", "metastasis", "procedure", "systemic_therapy", "radiotherapy", "imaging",
    "lab_result", "vital_sign", "performance_status", "exam_finding", "symptom", "comorbidity", "medication",
    "contraindication", "allergy", "adverse_event", "prognostic_score", "risk_factor", "family_history", "request",
    "decision", "plan", "interval",
)
ALERT_KINDS: tuple[str, ...] = ("missing", "contradiction", "chronology", "unclear", "poor_copy", "identity")


class FactDate(TypedDict):
    as_written: str | None
    precision: DatePrecision | None
    sort: str | None


class RunStage(TypedDict):
    name: str
    engine: NotRequired[str | None]
    model: NotRequired[str | None]
    prompt: NotRequired[str | None]
    prompt_sha256: NotRequired[str | None]
    temperature: NotRequired[float | None]


class RunInfo(TypedDict):
    id: str
    producer: Producer
    created_at: str
    stages: list[RunStage]
    supersedes: str | None


class RunDocument(TypedDict):
    document_id: str
    sha256: str | None
    parts: list[str]


class DocumentSource(TypedDict):
    id: str
    type: Literal["document"]
    document_id: str
    part: str | None
    page: int
    quote: str
    quote_text: QuoteText
    anchor: dict[str, Any] | None
    reported_as: Literal["original", "cited"]
    identity: IdentityResult
    reading_check: dict[str, Any] | None


class NisSource(TypedDict):
    id: str
    type: Literal["nis"]
    system: str
    resource: str
    version: str | None
    last_updated: str | None


Source = DocumentSource | NisSource


class FactCode(TypedDict):
    system: str
    code: str
    assigned_by: Literal["source", "assistant"]
    display: NotRequired[str | None]


class DraftFact(TypedDict):
    """A fact before keys.assign_keys and match.assign_fact_ids give it its key and ID."""

    kind: FactKind
    subject: Subject
    value: dict[str, Any]
    date: FactDate
    status: FactStatus
    negated: bool
    not_stated: list[str]
    origin: Origin
    certainty: Certainty
    certainty_reason: NotRequired[dict[str, str] | None]
    codes: list[FactCode]
    note: str | None
    quarantined: bool
    sources: list[str]
    based_on: NotRequired[list[str]]
    # Only before IDs exist: lets based_on, result_fact and interval ends point at another draft.
    draft_id: NotRequired[str]


class Fact(DraftFact):
    id: str
    key: str


class CheckPart(TypedDict):
    document_id: str
    part: str | None


class CheckPage(CheckPart):
    page: int


class Check(TypedDict):
    id: str
    looks_for: str
    expected: dict[str, str] | None
    covered: list[CheckPart]
    unreadable: list[CheckPage]
    result: CheckResult


class AlertMessage(TypedDict):
    id: str
    args: dict[str, str | int | float]


class Alert(TypedDict):
    id: str
    rule: str
    subject: str
    kind: AlertKind
    facts: list[str]
    message: AlertMessage
    note: str | None


class ExtractionRun(TypedDict, total=False):
    """The top level. See types.ts for which members are required; the schema enforces it."""

    schema: str
    case_id: str
    content_language: str
    run: RunInfo
    documents: list[RunDocument]
    sources: list[Source]
    facts: list[Fact]
    checks: list[Check]
    alerts: list[Alert]
    brief: dict[str, Any] | None
    question_draft: dict[str, Any] | None
