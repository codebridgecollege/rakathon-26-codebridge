"""codebridge.extraction/2 for the Python pipeline: types, keys and IDs, the matcher, the validator.

The TypeScript in packages/domain/src/extraction is the definition (docs/design/EXTRACTION-FORMAT.md); this package
mirrors it so a run written here gets the same keys, IDs and validation result as in the Worker.
"""

from .keys import (
    alert_id,
    assign_keys,
    base_key,
    build_fact_key,
    date_seg,
    fnv1a32,
    js_str,
    mint_fact_id,
    norm_text,
    pair_subject,
    source_id_for,
    value_text,
    view_line_id,
)
from .match import MATCH_MARGIN, MATCH_THRESHOLD, MatchResult, assign_fact_ids, same_frame, similarity
from .backing import Evidence, backing_problems
from .types import ALERT_KINDS, EXTRACTION_SCHEMA, FACT_KINDS, VIEW_NAMES
from .validate import Issue, ValidationResult, date_precision_problem, evidence_of, reference_issues, validate_run

__all__ = [
    "ALERT_KINDS",
    "EXTRACTION_SCHEMA",
    "Evidence",
    "FACT_KINDS",
    "VIEW_NAMES",
    "MATCH_MARGIN",
    "MATCH_THRESHOLD",
    "Issue",
    "MatchResult",
    "ValidationResult",
    "alert_id",
    "assign_fact_ids",
    "assign_keys",
    "backing_problems",
    "base_key",
    "build_fact_key",
    "date_precision_problem",
    "date_seg",
    "evidence_of",
    "fnv1a32",
    "js_str",
    "mint_fact_id",
    "norm_text",
    "pair_subject",
    "reference_issues",
    "same_frame",
    "similarity",
    "source_id_for",
    "value_text",
    "validate_run",
    "view_line_id",
]
