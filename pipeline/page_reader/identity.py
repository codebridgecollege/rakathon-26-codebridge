"""Identity check per document: does the text name the patient the case expects (step-6.md, "Identity check").

CLAUDE.md: do not merge patients silently. A document scanned into the wrong case, or a page of another patient
inside one PDF (S04 page 4), must show. The check runs on the hospital side, on the text of record, before any
pseudonymization, and returns offsets and field kinds only, never an identifier's value.

What is looked for on each page:
- birth numbers (rodné číslo) "YYMMDD/XXXX", also with spaces around the slash, or without it after a label
  ("r.č.", "RČ", "rodné číslo");
- birth dates after "nar." ("nar. 12.3.1964", "Dat. nar.:13.10.1961");
- the expected name, its parts in any order (case and diacritics folded), anywhere on the page;
- a name in a form field ("Jméno:", "Pacient:", "Jméno pacienta:", "Příjmení pacienta:") or at the start of a
  line before "nar." ("Vrbenská Lenka, nar. 18.4.1959"), where a header names the patient.

How each finding counts (the design agreed for issue #18):
- matches: the birth number equals the expected one; the birth date equals; the full name is found with the
  same letters, diacritics included.
- conflicts: a different birth number that passes the mod-11 check and has a possible date (so it is a real
  number, not a misread one); for the old 9-digit numbers, which have no check digit, one that differs in two
  or more digits; a full name in a form field or before "nar." that clearly differs from the expected one
  (a part that is not even similar to any expected part, as "Lenka" against "Ludmila").
- cannot_verify: a differing birth number that fails the check (OCR damage: one wrong digit always breaks it);
  a differing birth date (OCR turns one digit into another and keeps a valid date, so it is not proof); a name
  that differs only in diacritics ("Kotěrova" for "Kotěrová": FNO's document prints it so, and Tesseract drops
  diacritics) or by a letter or two (a misread); a single name part in a form field.
A page conflicts when anything on it conflicts, matches when something matches and nothing conflicts, and
cannot_verify otherwise, also when nothing is found (FNO patient 10's blacked-out header). The document takes
the same rule over its pages.
"""

import difflib
import re
import unicodedata
from datetime import date

_UP = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"
_LO = "a-záčďéěíňóřšťúůýž"
# A name word: capitalized, letters only, optionally double-barrelled ("Nováková-Malá").
_WORD = rf"[{_UP}][{_LO}]+(?:-[{_UP}][{_LO}]+)?"
# Birth number: six digits, an optional slash (spaces around it allowed), three or four digits.
BIRTH_NUMBER = re.compile(r"(?<![\d/])(\d{6})[ \t]*/[ \t]*(\d{3,4})(?![\d/])")
# Without the slash only right after a label, since ten digits alone may be any number.
BIRTH_NUMBER_LABELLED = re.compile(r"(?:r\.\s?č\.|RČ|R\.Č\.|[Rr]odné číslo)\s*:?\s*(\d{9,10})(?!\d)")
BIRTH_DATE = re.compile(r"\bnar\.?\s*:?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)")
# A form field naming the patient, at the start of a line (OCR may leave a few stray marks before it). One or two
# name words on the same line; FNO's forms put the given name and the surname in two fields.
FIELD_FULL = re.compile(rf"^\W{{0,3}}(?:Jméno a příjmení|Příjmení a jméno|Jméno pacienta|Jméno|Pacientka|Pacient)"
                        rf"[ \t]*:[ \t]*(?P<a>{_WORD})(?:[ \t]+(?P<b>{_WORD}))?", re.M)
FIELD_SURNAME = re.compile(rf"^\W{{0,3}}Příjmení(?: pacienta)?[ \t]*:[ \t]*(?P<a>{_WORD})", re.M)
# A header line "Surname Given, nar. ..." (also "Dat. nar."): only at the start of a line, so a relative named in
# the history ("matka Marie, nar. 1940") is not taken for the patient.
HEADER_NAME = re.compile(rf"^\W{{0,3}}(?P<a>{_WORD})[ \t]+(?P<b>{_WORD})[ \t]*,?[ \t]*(?:Dat\.[ \t]*)?nar\.", re.M)
NAME_TOKEN = re.compile(rf"[{_UP}{_LO}]+(?:-[{_UP}{_LO}]+)?", re.I)
# Folded parts at least this similar are the same name misread (one letter in a short name: "Kotěrová" and
# "Koterova" fold to equal; "Klenovskv" against "Klenovsky" is 0.89); "Lenka" against "Ludmila" is 0.33.
SIMILAR_NAME = 0.75


def fold(s: str) -> str:
    """Lower case without diacritics: "Kotěrová" and "KOTEROVA" fold to the same string."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def birth_number_valid(digits: str) -> bool:
    """A real birth number: a possible date in the first six digits and, for ten digits, the mod-11 check (the
    whole number divisible by 11, or for numbers from before 1985 the first nine giving remainder 10 and the last
    digit 0). Nine-digit numbers (born before 1954) have no check digit."""
    if len(digits) not in (9, 10):
        return False
    yy, mm, dd = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    # Women have 50 added to the month; since 2004 a number series may add 20 more.
    month = mm - 50 if mm > 50 else mm
    month = month - 20 if month > 20 else month
    year = 1900 + yy if len(digits) == 9 or yy >= 54 else 2000 + yy
    try:
        date(year, month, dd)
    except ValueError:
        return False
    if len(digits) == 9:
        return True
    n = int(digits)
    return n % 11 == 0 or (int(digits[:9]) % 11 == 10 and digits[9] == "0")


def _expected_date(value: str | None) -> tuple[int, int, int] | None:
    """(day, month, year) from "1958-06-14" or "14.6.1958"; None when absent or not a date."""
    if not value:
        return None
    m = re.fullmatch(r"\s*(\d{4})-(\d{2})-(\d{2})\s*", value)
    if m:
        return int(m[3]), int(m[2]), int(m[1])
    m = re.fullmatch(r"\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\s*", value)
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def _name_parts(name: str | None) -> list[str]:
    return [t for t in NAME_TOKEN.findall(name or "") if len(t) > 1]


def _compare_name(found: list[str], expected: list[str]) -> str:
    """matches / conflicts / cannot_verify for name words from a form field or header against the expected parts.
    One word alone is a single part: it never decides more than cannot_verify or matches with another field."""
    exact = {p.casefold() for p in expected}
    folded = [fold(p) for p in expected]
    kinds = []
    for w in found:
        if w.casefold() in exact:
            kinds.append("exact")
        elif fold(w) in folded:
            kinds.append("diacritics")
        elif max(difflib.SequenceMatcher(None, fold(w), f).ratio() for f in folded) >= SIMILAR_NAME:
            kinds.append("similar")
        else:
            kinds.append("different")
    if len(found) < 2:
        return "cannot_verify"
    if "different" in kinds:
        return "conflicts"
    return "matches" if all(k == "exact" for k in kinds) else "cannot_verify"


def _name_anywhere(text: str, expected: list[str]) -> list[tuple[int, int, str]]:
    """Every place the expected name stands with its parts next to each other, in any order: (start, end,
    "matches" when the letters are the same, "cannot_verify" when only the folded forms are)."""
    if len(expected) < 2:
        return []
    toks = [(m.group(), m.start(), m.end()) for m in NAME_TOKEN.finditer(text)]
    want = sorted(fold(p) for p in expected)
    exact = sorted(p.casefold() for p in expected)
    k, out = len(expected), []
    for i in range(len(toks) - k + 1):
        win = toks[i:i + k]
        # Only spaces, a comma or a line break between the parts: "Kotěrova Jaroslava", "Poláček, Daniel".
        if any(re.search(r"[^\s,]", text[a[2]:b[1]]) for a, b in zip(win, win[1:])):
            continue
        if sorted(fold(t[0]) for t in win) == want:
            same = sorted(t[0].casefold() for t in win) == exact
            out.append((win[0][1], win[-1][2], "matches" if same else "cannot_verify"))
    return out


def check_page(n: int, text: str, expected: dict) -> tuple[str, list[dict]]:
    """The page's result and its evidence: [{"n", "start", "end", "field", "result"}], offsets into text."""
    ev: list[dict] = []
    exp_bn = re.sub(r"\D", "", expected.get("birth_number") or "")
    exp_date = _expected_date(expected.get("birth_date"))
    parts = _name_parts(expected.get("name"))

    def add(start: int, end: int, field: str, result: str) -> None:
        ev.append({"n": n, "start": start, "end": end, "field": field, "result": result})

    seen_bn: set[int] = set()
    for rx in (BIRTH_NUMBER, BIRTH_NUMBER_LABELLED):
        for m in rx.finditer(text):
            start = m.start(1)
            if start in seen_bn:
                continue
            seen_bn.add(start)
            digits = "".join(g for g in m.groups() if g)
            if not exp_bn:
                result = "cannot_verify"  # nothing to compare with
            elif digits == exp_bn:
                result = "matches"
            elif len(digits) == 10:
                result = "conflicts" if birth_number_valid(digits) else "cannot_verify"
            elif len(exp_bn) == 9 and birth_number_valid(digits):
                # No check digit: one differing digit may be a misread, two or more are another number.
                diff = sum(a != b for a, b in zip(digits, exp_bn))
                result = "conflicts" if diff >= 2 else "cannot_verify"
            else:
                result = "cannot_verify"
            add(start, m.end(), "birth_number", result)

    for m in BIRTH_DATE.finditer(text):
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
        if exp_date is None:
            continue
        add(m.start(1), m.end(3), "birth_date", "matches" if (d, mo, y) == exp_date else "cannot_verify")

    if parts:
        named: list[tuple[int, int]] = []
        given_field = [m for m in FIELD_FULL.finditer(text)]
        surname_field = [m for m in FIELD_SURNAME.finditer(text)]
        for m in HEADER_NAME.finditer(text):
            add(m.start("a"), m.end("b"), "name", _compare_name([m["a"], m["b"]], parts))
            named.append((m.start("a"), m.end("b")))
        for m in given_field:
            words = [w for w in (m["a"], m["b"]) if w]
            end = m.end("b") if m["b"] else m.end("a")
            if len(words) == 1 and len(surname_field) == 1:
                # FNO's form: "Jméno pacienta: Lenka" and "Příjmení pacienta: Kabátová" are one full name.
                s = surname_field[0]
                words.append(s["a"])
                add(m.start("a"), end, "name", _compare_name(words, parts))
                add(s.start("a"), s.end("a"), "name", _compare_name(words, parts))
                named += [(m.start("a"), end), (s.start("a"), s.end("a"))]
                continue
            add(m.start("a"), end, "name", _compare_name(words, parts))
            named.append((m.start("a"), end))
        for start, end, result in _name_anywhere(text, parts):
            if not any(a <= start < b for a, b in named):
                add(start, end, "name", result)

    results = {e["result"] for e in ev}
    page = "conflicts" if "conflicts" in results else "matches" if "matches" in results else "cannot_verify"
    return page, sorted(ev, key=lambda e: e["start"])


def check(pages: list[dict], expected: dict) -> dict:
    """{"result", "pages": [{"n", "result"}], "evidence": [{"n", "start", "end", "field", "result"}]}."""
    out_pages, evidence = [], []
    for p in pages:
        result, ev = check_page(int(p["n"]), p.get("text") or "", expected or {})
        out_pages.append({"n": int(p["n"]), "result": result})
        evidence += ev
    results = {p["result"] for p in out_pages}
    doc = "conflicts" if "conflicts" in results else "matches" if "matches" in results else "cannot_verify"
    return {"result": doc, "pages": out_pages, "evidence": evidence}
