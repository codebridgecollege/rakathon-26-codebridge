"""Identity check per document: does the text name the patient the case expects (step-6.md, "Identity check").

CLAUDE.md: do not merge patients silently. A document scanned into the wrong case, or a page of another patient
inside one PDF (S04 page 4), must show. The check runs on the hospital side, on the text of record, before any
pseudonymization, and returns offsets and field kinds only, never an identifier's value.

What is looked for on each page:
- birth numbers (rodné číslo) "YYMMDD/XXXX", also with spaces around the slash, or without it after a label
  ("r.č.", "RČ", "rodné číslo");
- birth dates after "nar." ("nar. 12.3.1964", "Dat. nar.:13.10.1961");
- a name in a form field ("Jméno:", "Pacient:", "Jméno pacienta:", "Příjmení pacienta:") or in the page's header
  line, "Surname Given, nar. ..." at the start of one of the first HEADER_LINES lines;
- the expected name, its parts next to each other in any order (case and diacritics folded), anywhere on the
  page, only where no form field or header names anyone.

How each finding counts (the design agreed for issue #18):
- matches: the birth number equals the expected one; every expected name part is in the field or header with
  the same letters, diacritics included (extra words such as a second given name do not matter); the expected
  name stands elsewhere on a page without a field or header. A birth date that equals supports a match but does
  not make one on its own: many people share a birth date.
- conflicts: a different birth number that passes the mod-11 check and has a possible date (a real number, not
  a misread one; for the old 9-digit numbers, which have no check digit, one that differs in two or more
  digits), after a birth-number label or on the header line, and not on a page that also holds the expected
  number or next to a relative ("Matka: RČ ..."); a field or header whose words leave an expected name part
  unaccounted for while one of its own words is not even similar to any expected part ("Vrbenská Lenka" against
  "Ludmila Vrbenská").
- cannot_verify: a differing birth number that fails the check (OCR damage: one wrong digit always breaks it),
  that has no label, or that sits next to a relative; a differing birth date (OCR turns one digit into another
  and keeps a valid date, so it is not proof); a name that differs only in diacritics ("Kotěrova" for
  "Kotěrová": FNO's document prints it so, and Tesseract drops diacritics) or by one misread letter; a single
  name word in a field; an expected name of one part only.
A page conflicts when anything on it conflicts, matches when a name or birth number matches and nothing
conflicts, and cannot_verify otherwise, also when nothing is found (a blacked-out header). The document takes the
same rule over its pages.
"""

import difflib
import re
import unicodedata
from datetime import date

_UP = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"
_LO = "a-záčďéěíňóřšťúůýž"
# A name word: capitalized ("Nováková") or in capitals ("NOVÁKOVÁ", as many headers print the surname),
# optionally double-barrelled ("Nováková-Malá").
_WORD = rf"(?:[{_UP}][{_LO}]+|[{_UP}]{{2,}})(?:-(?:[{_UP}][{_LO}]+|[{_UP}]{{2,}}))?"
WORD = re.compile(_WORD)
# Birth number: six digits, a slash (spaces around it allowed), three or four digits.
BIRTH_NUMBER = re.compile(r"(?<![\d/])(\d{6})[ \t]*/[ \t]*(\d{3,4})(?![\d/])")
# Without the slash only right after a label, since ten digits alone may be any number. "\s*(?::\s*)?" and not
# "\s*:?\s*", which backtracks quadratically on a long run of spaces.
BN_LABEL = r"(?:r\.\s?č\.|RČ|R\.Č\.|[Rr]odné číslo)"
BIRTH_NUMBER_LABELLED = re.compile(BN_LABEL + r"\s*(?::\s*)?(\d{9,10})(?!\d)")
BN_LABEL_BEFORE = re.compile(BN_LABEL + r"[\s:]*$")
BIRTH_DATE = re.compile(r"\bnar\.?\s*(?::\s*)?(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)")
# A form field naming the patient, at the start of a line (OCR may leave a few stray marks before it). Its words
# are read up to the next label (psm 4 often joins the form's columns into one line). FNO's forms put the given
# name and the surname in two fields.
FIELD_FULL = re.compile(r"^\W{0,3}(?:Jméno a příjmení|Příjmení a jméno|Jméno pacienta|Jméno|Pacientka|Pacient)"
                        r"[ \t]*:[ \t]*(?P<rest>[^\n]*)", re.M)
FIELD_SURNAME = re.compile(r"^\W{0,3}Příjmení(?: pacienta)?[ \t]*:[ \t]*(?P<rest>[^\n]*)", re.M)
# The header line "Surname Given, nar. ..." (also "Dat. nar."): at the start of a line among the first
# HEADER_LINES lines, and only the first such line of a page, so a relative listed in the history
# ("Nováková Marie, nar. 1940" further down) is not taken for the patient.
HEADER_NAME = re.compile(rf"^\W{{0,3}}(?P<rest>(?:{_WORD}[ \t]+){{1,3}}?{_WORD})[ \t]*,?[ \t]*(?:Dat\.[ \t]*)?nar\.", re.M)
HEADER_LINES = 15
NAME_TOKEN = re.compile(rf"[{_UP}{_LO}]+(?:-[{_UP}{_LO}]+)?", re.I)
# Folded words that end a field's name (the next label) or are not a name: labels, titles and honorifics, and
# relatives. A relative or a title right before a name means the name is someone else's.
LABEL_WORDS = {"prijmeni", "jmeno", "rodne", "datum", "dat", "pojistovna", "poj", "bydliste", "adresa", "telefon",
               "pohlavi", "kod", "cislo", "rc", "narozeni", "nar", "diagnoza", "vek", "trvale", "zp"}
HONORIFICS = {"pan", "pani", "slecna", "mudr", "mgr", "bc", "ing", "doc", "prof", "phdr", "judr"}
RELATIVES = {"matka", "otec", "syn", "dcera", "manzel", "manzelka", "sestra", "bratr", "babicka", "dedecek",
             "teta", "stryc", "vnuk", "vnucka", "partner", "partnerka", "druh", "druzka", "zastupce", "opatrovnik"}
RELATIVE_NEAR = re.compile(r"\b(?:" + "|".join(sorted(RELATIVES)) + r")\b", re.I)
MAX_NAME_PARTS = 5  # a person has a few names; a longer "name" is a wrong input and would only cost time
# Folded parts at least this similar are the same name misread: "Klenovskv" against "Klenovsky" is 0.89; "Lenka"
# against "Ludmila" 0.33. Short names also count with one letter changed ("Exa" for "Eva" is only 0.67).
SIMILAR_NAME = 0.75


def fold(s: str) -> str:
    """Lower case without diacritics: "Kotěrová" and "KOTEROVA" fold to the same string."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def _one_edit(a: str, b: str) -> bool:
    """At most one letter changed, added or dropped."""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _similar(a: str, b: str) -> bool:
    fa, fb = fold(a), fold(b)
    return _one_edit(fa, fb) or difflib.SequenceMatcher(None, fa, fb).ratio() >= SIMILAR_NAME


def birth_number_valid(digits: str) -> bool:
    """A real birth number: a possible date in the first six digits and, for ten digits, the mod-11 check (the
    whole number divisible by 11, or for numbers issued before 1985 the first nine giving remainder 10 and the
    last digit 0). Nine-digit numbers were issued before 1954 only and have no check digit."""
    if len(digits) not in (9, 10):
        return False
    yy, mm, dd = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    if len(digits) == 9:
        if yy >= 54:
            return False
        year = 1900 + yy
    else:
        year = 1900 + yy if yy >= 54 else 2000 + yy
    # Women have 50 added to the month; from 2004 a number series may add 20 more.
    month = mm - 50 if mm > 50 else mm
    if month > 20 and year >= 2004:
        month -= 20
    try:
        date(year, month, dd)
    except ValueError:
        return False
    if len(digits) == 9:
        return True
    return int(digits) % 11 == 0 or (year < 1985 and int(digits[:9]) % 11 == 10 and digits[9] == "0")


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
    """The expected name's parts; an initial ("J.") is not a part."""
    return [t for t in NAME_TOKEN.findall(name or "") if len(t) > 1][:MAX_NAME_PARTS]


def _name_words(rest: str, offset: int) -> tuple[list[tuple[str, int, int]], bool]:
    """The name words at the start of a field's or header's text, with their offsets: up to three, ending at the
    first word that is not a name or is a label; titles and honorifics before them are skipped. Also whether a
    relative word starts it ("Matka Marie"), which makes the name someone else's."""
    words = []
    for m in re.finditer(r"[^\s,;]+", rest):
        tok = m.group().rstrip(".:")
        f = fold(tok)
        if not words and f in HONORIFICS:
            continue
        if not words and f in RELATIVES:
            return [], True
        if f in LABEL_WORDS or f in HONORIFICS or not WORD.fullmatch(tok) or len(words) == 3:
            break
        words.append((tok, offset + m.start(), offset + m.start() + len(tok)))
        if rest[m.end():m.end() + 1] in (",", ";"):
            break  # "Nováková Jana, nar.": the name ends at the comma
    return words, False


def _compare_name(found: list[str], expected: list[str]) -> str:
    """matches / conflicts / cannot_verify for the name words of a field or header against the expected parts."""
    if len(found) < 2 or len(expected) < 2:
        return "cannot_verify"  # one word, or a one-part expected name, is too little to tell people apart
    status = []
    for p in expected:
        if any(w.casefold() == p.casefold() for w in found):
            status.append("exact")
        elif any(_similar(w, p) for w in found):
            status.append("similar")  # diacritics or one misread letter
        else:
            status.append("missing")
    if all(s == "exact" for s in status):
        return "matches"
    if "missing" in status and any(not any(_similar(w, p) for p in expected) for w in found):
        return "conflicts"
    return "cannot_verify"


def _name_anywhere(text: str, expected: list[str]) -> list[tuple[int, int, str]]:
    """Every place the expected name stands with its parts next to each other, in any order, and no title or
    relative right before it (a doctor or a sister of the same name): (start, end, "matches" when the letters
    are the same, "cannot_verify" when only the folded forms are)."""
    if len(expected) < 2:
        return []
    toks = [(m.group(), m.start(), m.end()) for m in NAME_TOKEN.finditer(text)]
    want = sorted(fold(p) for p in expected)
    exact = sorted(p.casefold() for p in expected)
    k, out = len(expected), []
    for i in range(len(toks) - k + 1):
        win = toks[i:i + k]
        if sorted(fold(t[0]) for t in win) != want:
            continue
        # Only spaces, a comma or a line break between the parts: "Kotěrova Jaroslava", "Poláček, Daniel".
        if any(re.search(r"[^\s,]", text[a[2]:b[1]]) for a, b in zip(win, win[1:])):
            continue
        if i > 0 and fold(toks[i - 1][0]) in HONORIFICS | RELATIVES:
            continue
        same = sorted(t[0].casefold() for t in win) == exact
        out.append((win[0][1], win[-1][2], "matches" if same else "cannot_verify"))
    return out


def _line_of(text: str, pos: int) -> tuple[int, int]:
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return start, len(text) if end < 0 else end


def check_page(n: int, text: str, expected: dict) -> tuple[str, list[dict]]:
    """The page's result and its evidence: [{"n", "start", "end", "field", "result"}], offsets into text."""
    ev: list[dict] = []
    exp_bn = re.sub(r"\D", "", expected.get("birth_number") or "")
    exp_date = _expected_date(expected.get("birth_date"))
    parts = _name_parts(expected.get("name"))

    def add(start: int, end: int, field: str, result: str) -> None:
        ev.append({"n": n, "start": start, "end": end, "field": field, "result": result})

    numbers, seen = [], set()
    for rx in (BIRTH_NUMBER, BIRTH_NUMBER_LABELLED):
        for m in rx.finditer(text):
            if m.start(1) not in seen:
                seen.add(m.start(1))
                numbers.append((m.start(1), m.end(), "".join(g for g in m.groups() if g)))
    has_own = bool(exp_bn) and any(d == exp_bn for _, _, d in numbers)
    for start, end, digits in numbers:
        ls, le = _line_of(text, start)
        before = text[max(ls, start - 25):start]
        # A conflict needs a number that is meant as a birth number of this page's patient: after a label or on
        # the header line, not next to a relative, and not beside the expected number on the same page.
        labelled = bool(BN_LABEL_BEFORE.search(before)) or "nar." in text[ls:le]
        foreign_ok = labelled and not has_own and not RELATIVE_NEAR.search(text[ls:start])
        if not exp_bn:
            result = "cannot_verify"  # nothing to compare with
        elif digits == exp_bn:
            result = "matches"
        elif not foreign_ok or not birth_number_valid(digits):
            result = "cannot_verify"
        elif len(digits) == 10:
            result = "conflicts"
        else:
            # No check digit: one differing digit may be a misread, two or more are another number.
            result = "conflicts" if sum(a != b for a, b in zip(digits, exp_bn)) >= 2 else "cannot_verify"
        add(start, end, "birth_number", result)

    if exp_date is not None:
        for m in BIRTH_DATE.finditer(text):
            same = (int(m[1]), int(m[2]), int(m[3])) == exp_date
            add(m.start(1), m.end(3), "birth_date", "supports" if same else "cannot_verify")

    if parts:
        named = False
        header_limit = sum(len(line) + 1 for line in text.split("\n")[:HEADER_LINES])
        header = next((m for m in HEADER_NAME.finditer(text) if m.start() < header_limit), None)
        if header is not None:
            words, relative = _name_words(header["rest"], header.start("rest"))
            if words and not relative:
                add(words[0][1], words[-1][2], "name", _compare_name([w[0] for w in words], parts))
                named = True
        surnames = [_name_words(m["rest"], m.start("rest"))[0] for m in FIELD_SURNAME.finditer(text)]
        surnames = [s for s in surnames if s]
        for m in FIELD_FULL.finditer(text):
            words, relative = _name_words(m["rest"], m.start("rest"))
            if not words or relative:
                continue
            if len(words) == 1 and len(surnames) == 1:
                # FNO's form: "Jméno pacienta: Lenka" and "Příjmení pacienta: Kabátová" are one full name.
                s = surnames[0]
                result = _compare_name([words[0][0], s[0][0]], parts)
                add(s[0][1], s[0][2], "name", result)
            else:
                result = _compare_name([w[0] for w in words], parts)
            add(words[0][1], words[-1][2], "name", result)
            named = True
        if not named:
            # The name in running text counts only where no field or header names anyone: there a sister or a
            # doctor of the same name could stand next to another patient's header.
            for start, end, result in _name_anywhere(text, parts):
                add(start, end, "name", result)

    ev.sort(key=lambda e: e["start"])
    results = {e["result"] for e in ev}
    page = "conflicts" if "conflicts" in results else "matches" if "matches" in results else "cannot_verify"
    # "supports" is not a result of its own: a birth date that equals backs a match, it never makes one.
    for e in ev:
        if e["result"] == "supports":
            e["result"] = "matches"
    return page, ev


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
