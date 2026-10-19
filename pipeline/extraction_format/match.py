"""Fact IDs carried over from the previous run, the Python mirror of packages/domain/src/extraction/match.ts.

Doctor confirmations, edits and alert acknowledgements live in D1 under fact and alert IDs, so a new run reuses the
previous run's ID for the same fact: the same key; else a clearly most similar fact of the same kind; else a new ID.
A wrong reuse would move a confirmation onto another fact, so the similarity step is strict. The thresholds and the
order of the steps must stay equal to match.ts.
"""

import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from .keys import assign_keys, date_seg, mint_fact_id, norm_text, value_text

MatchHow = Literal["key", "similar", "new"]

MATCH_THRESHOLD = 0.75
MATCH_MARGIN = 0.15


def _tokens(text: str) -> set[str]:
    # The JS splits on [^\p{L}\p{N}]+; Python's re has no \p classes, so the categories are checked directly.
    out: set[str] = set()
    cur: list[str] = []
    for ch in norm_text(text):
        if unicodedata.category(ch)[0] in "LN":
            cur.append(ch)
        elif cur:
            out.add("".join(cur))
            cur = []
    if cur:
        out.add("".join(cur))
    return out


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    both = len(a & b)
    return both / (len(a) + len(b) - both)


def same_frame(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """Whether two facts can be the same fact at all (sameFrame in match.ts): negation, subject, status and date sit
    outside `value`, so the view would not see them change under a kept ID."""
    return (
        a["kind"] == b["kind"]
        and a["negated"] == b["negated"]
        and a["subject"] == b["subject"]
        and a["status"] == b["status"]
        and date_seg(a["date"]) == date_seg(b["date"])
    )


def _evidence(fact: Mapping[str, Any], sources: Mapping[str, Mapping[str, Any]]) -> set[str]:
    out: set[str] = set()
    for sid in fact["sources"]:
        s = sources.get(sid)
        if s is None:
            continue
        out.add(f"{s['document_id']}|{norm_text(s['quote'])}" if s["type"] == "document" else f"nis|{s['resource']}")
    return out


def similarity(a: Mapping[str, Any], a_src: Mapping[str, Mapping[str, Any]], b: Mapping[str, Any], b_src: Mapping[str, Mapping[str, Any]]) -> float:
    """0..1: value text weighs more than sources, because a re-read page may quote the same fact differently."""
    if not same_frame(a, b):
        return 0.0
    v = _jaccard(
        _tokens(f"{value_text(a['value'])} {a['date'].get('as_written') or ''}"),
        _tokens(f"{value_text(b['value'])} {b['date'].get('as_written') or ''}"),
    )
    ea, eb = _evidence(a, a_src), _evidence(b, b_src)
    if not ea or not eb:
        return v
    return 0.7 * v + 0.3 * _jaccard(ea, eb)


@dataclass
class MatchResult:
    facts: list[dict[str, Any]]
    how: dict[str, MatchHow]
    # Previous fact IDs with no fact in this run: their confirmations show as missing from the new processing.
    dropped: list[str]


@dataclass
class _State:
    case_id: str
    prev_facts: list[Mapping[str, Any]]
    prev_by_key: dict[str, Mapping[str, Any]]
    prev_src: dict[str, Mapping[str, Any]]
    cur_src: dict[str, Mapping[str, Any]]
    used_prev: set[str] = field(default_factory=set)
    taken: set[str] = field(default_factory=set)
    how: dict[str, MatchHow] = field(default_factory=dict)


def _match_round(drafts: Sequence[Mapping[str, Any]], sources: Sequence[Mapping[str, Any]], st: _State) -> tuple[list[str], list[str]]:
    keyed = assign_keys(drafts, sources)
    ids: list[str | None] = [None] * len(keyed)

    # 1. Same key.
    for i, f in enumerate(keyed):
        p = st.prev_by_key.get(f["key"])
        if p is not None and same_frame(p, f) and p["id"] not in st.used_prev:
            ids[i] = p["id"]
            st.used_prev.add(p["id"])
            st.how[p["id"]] = "key"

    # 2. Similar value and sources, greedy from the best pair (a stable sort, as Array.prototype.sort is).
    open_prev = [p for p in st.prev_facts if p["id"] not in st.used_prev]
    scores: list[tuple[int, Mapping[str, Any], float]] = []
    for i, f in enumerate(keyed):
        if ids[i]:
            continue
        for p in open_prev:
            if p["kind"] == f["kind"]:
                scores.append((i, p, similarity(f, st.cur_src, p, st.prev_src)))
    scores.sort(key=lambda x: -x[2])
    for n, (ci, cp, cs) in enumerate(scores):
        if cs < MATCH_THRESHOLD:
            break
        if ids[ci] or cp["id"] in st.used_prev:
            continue
        runner_up = 0.0
        for m, (xi, xp, xs) in enumerate(scores):
            if m == n:
                continue
            rival_prev = xi == ci and xp["id"] not in st.used_prev
            rival_cur = xp["id"] == cp["id"] and not ids[xi]
            if rival_prev or rival_cur:
                runner_up = max(runner_up, xs)
        if cs - runner_up < MATCH_MARGIN:
            continue
        ids[ci] = cp["id"]
        st.used_prev.add(cp["id"])
        st.how[cp["id"]] = "similar"

    # 3. New IDs; every previous ID counts as taken, so a retired ID never goes to a different fact.
    for fid in ids:
        if fid:
            st.taken.add(fid)
    for i, f in enumerate(keyed):
        if ids[i]:
            continue
        fid = mint_fact_id(st.case_id, f["key"], st.taken)
        st.taken.add(fid)
        ids[i] = fid
        st.how[fid] = "new"
    return [f["key"] for f in keyed], [fid for fid in ids if fid is not None]


def assign_fact_ids(
    case_id: str,
    drafts: Sequence[Mapping[str, Any]],
    sources: Sequence[Mapping[str, Any]],
    previous: Mapping[str, Any] | None,
    retired_documents: Iterable[str] = (),
    issued_ids: Iterable[str] = (),
) -> MatchResult:
    """Keys and IDs for a new run's facts; `previous` is the case's current run (its facts and sources) or None.

    Drafts may carry a `draft_id` that based_on, result_fact and interval ends use before IDs exist; they are
    rewritten to the final IDs. Intervals are keyed by their ends' IDs, so they get IDs in a second round.
    `retired_documents` (superseded or withdrawn since the previous run): previous facts resting only on them are not
    matched, so their confirmations show as missing instead of moving to another document's fact. `issued_ids`: every
    fact ID ever issued for the case, so a new fact never takes a retired one. As MatchOptions in match.ts.
    """
    all_prev = list(previous["facts"]) if previous else []
    prev_src = {s["id"]: s for s in (previous["sources"] if previous else [])}
    retired = set(retired_documents)

    def on_retired(f: Mapping[str, Any]) -> bool:
        return bool(f["sources"]) and all(
            prev_src.get(s, {}).get("type") == "document" and prev_src[s]["document_id"] in retired for s in f["sources"]
        )

    prev_facts = [f for f in all_prev if not on_retired(f)]
    st = _State(
        case_id=case_id,
        prev_facts=prev_facts,
        prev_by_key={f["key"]: f for f in prev_facts},
        prev_src=prev_src,
        cur_src={s["id"]: s for s in sources},
        taken={p["id"] for p in all_prev} | set(issued_ids),
    )
    finals: list[tuple[str, str]] = [("", "")] * len(drafts)
    draft_to_final: dict[str, str] = {}

    def remap(x: str) -> str:
        return draft_to_final.get(x, x)

    first = [i for i, d in enumerate(drafts) if d["kind"] != "interval"]
    keys, ids = _match_round([drafts[i] for i in first], sources, st)
    for n, i in enumerate(first):
        finals[i] = (keys[n], ids[n])
        if drafts[i].get("draft_id"):
            draft_to_final[drafts[i]["draft_id"]] = ids[n]

    second = [i for i, d in enumerate(drafts) if d["kind"] == "interval"]
    intervals = [
        {**drafts[i], "value": {**drafts[i]["value"], "from_fact": remap(drafts[i]["value"]["from_fact"]), "to_fact": remap(drafts[i]["value"]["to_fact"])}}
        for i in second
    ]
    keys, ids = _match_round(intervals, sources, st)
    for n, i in enumerate(second):
        finals[i] = (keys[n], ids[n])
        if drafts[i].get("draft_id"):
            draft_to_final[drafts[i]["draft_id"]] = ids[n]

    facts: list[dict[str, Any]] = []
    for i, d in enumerate(drafts):
        out = {k: v for k, v in d.items() if k != "draft_id"}
        out["key"], out["id"] = finals[i]
        if out.get("based_on") is not None:
            out["based_on"] = [remap(b) for b in out["based_on"]]
        if out["kind"] == "request" and out["value"].get("result_fact"):
            out["value"] = {**out["value"], "result_fact": remap(out["value"]["result_fact"])}
        if out["kind"] == "interval":
            out["value"] = {**out["value"], "from_fact": remap(out["value"]["from_fact"]), "to_fact": remap(out["value"]["to_fact"])}
        facts.append(out)
    dropped = [p["id"] for p in all_prev if p["id"] not in st.used_prev]
    return MatchResult(facts=facts, how=st.how, dropped=dropped)
