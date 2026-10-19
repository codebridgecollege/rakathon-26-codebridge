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
    mint_fact_id,
    norm_text,
    pair_subject,
    source_id_for,
)
from .match import MATCH_MARGIN, MATCH_THRESHOLD, MatchResult, assign_fact_ids, similarity
from .types import ALERT_KINDS, EXTRACTION_SCHEMA, FACT_KINDS
from .validate import Issue, ValidationResult, reference_issues, validate_run

__all__ = [
    "ALERT_KINDS",
    "EXTRACTION_SCHEMA",
    "FACT_KINDS",
    "MATCH_MARGIN",
    "MATCH_THRESHOLD",
    "Issue",
    "MatchResult",
    "ValidationResult",
    "alert_id",
    "assign_fact_ids",
    "assign_keys",
    "base_key",
    "build_fact_key",
    "date_seg",
    "fnv1a32",
    "mint_fact_id",
    "norm_text",
    "pair_subject",
    "reference_issues",
    "similarity",
    "source_id_for",
    "validate_run",
]
