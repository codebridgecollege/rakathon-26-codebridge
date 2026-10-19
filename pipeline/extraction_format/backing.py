"""Whether a composed text (a view line, a brief sentence) says only what its facts say, the Python mirror of
packages/domain/src/extraction/backing.ts.

Every date, number, negation and side in the text must appear in the facts it points at: their values, dates, codes
or quoted passages. A fact's note and certainty reason are the assistant's words and back nothing. Drug names are not
checked. A guard against invented content, not a proof. Both sides are tested against
packages/domain/test/extraction-backing-vectors.json.
"""

import re
from dataclasses import dataclass

from .keys import js_str

# A letter on either side means the digits belong to a word or a code ("G2", "pT2a", "C64"). [^\W\d_] is a letter or a
# non-decimal numeral, as [\p{L}\p{Nl}\p{No}] in the TypeScript; digits are ASCII on both sides.
_L = r"[^\W\d_]"
_NL_BEFORE = r"(?<![^\W\d_])"
_NL_AFTER = r"(?![^\W\d_])"

_UNIT = r"mg|g|kg|µg|mcg|ml|l|mm|cm|m2|m²|%|mmhg|mmol/l|µmol/l|umol/l|g/l|iu|ij|gy|cykl[^\W\d_]*|týdn[^\W\d_]*|dn[^\W\d_]*|měsíc[^\W\d_]*|let|rok[^\W\d_]*"
_UNIT_AFTER = re.compile(r"\s?(" + _UNIT + r")" + _NL_AFTER, re.IGNORECASE)


@dataclass(frozen=True)
class Evidence:
    texts: list[str]
    negated: bool
    # Every fact is a recorded negative: the text must then say so.
    all_negated: bool = False


def _year(s: str) -> int:
    return 2000 + int(s) if len(s) == 2 else int(s)


_MONTHS = [
    (re.compile(r"^led(en|na|nu)$"), 1),
    (re.compile(r"^únor(a|u)?$"), 2),
    (re.compile(r"^břez(en|na|nu)$"), 3),
    (re.compile(r"^dub(en|na|nu)$"), 4),
    (re.compile(r"^květ(en|na|nu)$"), 5),
    (re.compile(r"^červ(en|na|nu)$"), 6),
    (re.compile(r"^červen(ec|ce|ci)$"), 7),
    (re.compile(r"^srp(en|na|nu)$"), 8),
    (re.compile(r"^září$"), 9),
    (re.compile(r"^říj(en|na|nu)$"), 10),
    (re.compile(r"^listopad(u)?$"), 11),
    (re.compile(r"^prosin(ec|ce|ci)$"), 12),
]


def _month_of(w: str) -> int | None:
    return next((n for rx, n in _MONTHS if rx.match(w.lower())), None)


def _dm(m: re.Match[str]):
    return (None, int(m[2]), int(m[1])) if 1 <= int(m[2]) <= 12 else None


def _my(m: re.Match[str]):
    return (_year(m[2]), int(m[1]), None) if 1 <= int(m[1]) <= 12 else None


def _named(m: re.Match[str]):
    mo = _month_of(m[1])
    return (int(m[2]), mo, None) if mo else None


_DATE_RES = [
    (re.compile(r"([0-9]{4})-([0-9]{2})(?:-([0-9]{2}))?"), lambda m: (int(m[1]), int(m[2]), int(m[3]) if m[3] else None)),
    (re.compile(r"(?<![0-9.,])([0-9]{1,2})\s?[.,]\s?([0-9]{1,2})\s?[.,]\s?([0-9]{4}|[0-9]{2})(?![0-9])"), lambda m: (_year(m[3]), int(m[2]), int(m[1]))),
    (re.compile(r"(?<![0-9.,])([0-9]{1,2})\.\s?([0-9]{1,2})\.(?!\s?[0-9])"), _dm),
    (re.compile(r"(?<![0-9/])([0-9]{1,2})/([0-9]{4}|[0-9]{2})(?![0-9/])"), _my),
    (re.compile(_NL_BEFORE + r"(" + _L + r"+)\s+([0-9]{4})(?![0-9])"), _named),
    (re.compile(_NL_BEFORE + r"(?<![0-9])((?:19|20)[0-9]{2})(?![0-9])(?!\s?(?:" + _UNIT + r")" + _NL_AFTER + r")", re.IGNORECASE),
     lambda m: (int(m[1]), None, None)),
]


def _dates_in(text: str) -> tuple[list[tuple[int | None, int | None, int | None]], str]:
    dates: list[tuple[int | None, int | None, int | None]] = []
    rest = text
    for rx, f in _DATE_RES:
        def sub(m: re.Match[str], f=f) -> str:
            v = f(m)
            if v is None:
                return m[0]
            dates.append(v)
            return " "
        rest = rx.sub(sub, rest)
    return dates, rest


def _norm(n: str) -> str:
    return js_str(float(n.replace(",", ".", 1)))


_NUM = re.compile(_NL_BEFORE + r"(?<![0-9.,])[0-9]+(?:[.,][0-9]+)?")


def _numbers_in(text: str) -> list[tuple[str, str]]:
    out = []
    for m in _NUM.finditer(text):
        u = _UNIT_AFTER.match(text, m.end())
        out.append((_norm(m[0]), u[1].lower() if u else ""))
    return out


def _evidence_numbers(ev: str) -> tuple[set[str], set[str]]:
    plain: set[str] = set()
    for m in re.finditer(r"[0-9]+(?:[.,][0-9]+)?", ev):
        plain.add(_norm(m[0]))
        for part in re.split(r"[.,]", m[0]):
            plain.add(_norm(part))
    with_unit = {f"{n} {u}" for n, u in _numbers_in(ev) if u}
    return plain, with_unit


_NEGATION = [
    ("bez", "bez"), ("není", "není"), ("nejsou", "nejsou"), ("nebyl[aoiy]?", "nebyl"), ("neguje", "neguje"),
    ("negativn" + _L + "*", "negativn"), ("nemá", "nemá"), ("nezvrací", "nezvrací"), ("nepřibyl[aoiy]?", "nepřibyl"),
    ("vyloučen" + _L + "*", "vyloučen"), ("nevyšetřen" + _L + "*", "nevyšetřen"), ("neprokázán" + _L + "*", "neprokázán"),
    ("nenalezen" + _L + "*", "nenalezen"), ("nezjištěn" + _L + "*", "nezjištěn"), ("nezvětšen" + _L + "*", "nezvětšen"),
    ("nehmatn" + _L + "*", "nehmatn"), ("nepřítomn" + _L + "*", "nepřítomn"), ("žádn" + _L + "*", "žádn"), ("nikoli", "nikoli"),
]
_NEGATION_RE = [(re.compile(_NL_BEFORE + p + _NL_AFTER, re.IGNORECASE), stem) for p, stem in _NEGATION]


def negation_cues(text: str) -> set[str]:
    """The negation cues a text holds, as stems."""
    return {stem for rx, stem in _NEGATION_RE if rx.search(text)}


_SIDES = [
    ("right", re.compile(_NL_BEFORE + r"(vpravo|pravostrann" + _L + r"*|prav(?:ý|á|é|ého|ém|ou|ých|ým|ými|ému))" + _NL_AFTER, re.IGNORECASE)),
    ("left", re.compile(_NL_BEFORE + r"(vlevo|levostrann" + _L + r"*|lev(?:ý|á|é|ého|ém|ou|ých|ým|ými|ému))" + _NL_AFTER, re.IGNORECASE)),
    ("both", re.compile(_NL_BEFORE + r"(oboustrann" + _L + r"*|bilaterál" + _L + r"*)" + _NL_AFTER, re.IGNORECASE)),
]


def _sides_in(text: str) -> set[str]:
    return {s for s, rx in _SIDES if rx.search(text)}


def backing_problems(text: str, evidence: Evidence) -> list[str]:
    """What in `text` its evidence does not back: "date", "number", "negation", "side", in this order."""
    ev = "\n".join(evidence.texts)
    out: list[str] = []
    t_dates, t_rest = _dates_in(text)
    e_dates, _ = _dates_in(ev)

    def backed(x) -> bool:
        return any((x[0] is None or y[0] == x[0]) and (x[1] is None or y[1] == x[1]) and (x[2] is None or y[2] == x[2]) for y in e_dates)

    if not all(backed(x) for x in t_dates):
        out.append("date")
    plain, with_unit = _evidence_numbers(ev)
    if not all((f"{n} {u}" in with_unit) if u else (n in plain) for n, u in _numbers_in(t_rest)):
        out.append("number")
    cues = negation_cues(text)
    if (not evidence.negated and not cues <= negation_cues(ev)) or (evidence.all_negated and not cues):
        out.append("negation")
    if not _sides_in(text) <= _sides_in(ev):
        out.append("side")
    return out
