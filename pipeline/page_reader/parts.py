"""Split a referral PDF into the clinical documents it holds, and say what each one is (stage 1 of step 6).

FNO's referral PDFs hold several clinical documents one after another, sometimes newest first: an outpatient
report, a lab sheet, a histology report, the MDT request form. A "part" is one such document: its pages, a
fixed type code, its title and date as printed, and how sure the split is. Deterministic only: header and
layout patterns, no model, so the same pages always give the same parts.

Rules, chosen so that a wrong split is visible rather than silent (CLAUDE.md, "Clinical trust"):

- A title counts only in the header zone of a page (its first HEADER_LINES lines that carry words), where a
  report prints its title. A title quoted in the body ("MR vyš. mozku 14.9.2026") is a citation, not a
  document; the assistant reports it elsewhere.
- A new part starts on a page with a title when the page also shows a start mark (a department line, a
  labelled date, a requisition or biopsy number, "strana 1 z n") or when the title names another type than
  the current part. A repeated title alone ("Ambulantní vyšetření kontrolní" printed on every page) is a
  continuation, marked "verify": the same header may also start a second report of the same kind, and
  only the doctor can tell.
- A lab block that starts inside a page (FNO prints the lab panel under the report text) opens a lab part
  on that page; the page then belongs to both parts, and `from`/`to` give the character offsets.
- A page without a header continues the previous part; when the text runs on (the previous page ends
  mid-sentence or this one starts in lower case) that is "documented", otherwise "verify".
- Title and date are taken as printed. A date comes only from a labelled field of the part's first page
  ("Odběr:", "vydáno:", "Datum vyšetření:"), never from the body, which cites many dates. A partial date
  stays partial ("03/2024" is a month). A label whose date does not read as a date ("1112023",
  "13.40.1961") gives no date and "verify": a misread date is never repaired by guessing.
- What no rule recognises is "unknown" ("neurčeno"): the doctor sets the type.

Offsets in `evidence`, `from` and `to` point into each page's text; the output never carries text from the
pages except the title and date strings themselves.
"""

import difflib
import re
import unicodedata
from datetime import date

from .labs import RECORD
from .readability import worst

# Fixed type codes; the UI names them in Czech. "unknown" is shown as "neurčeno" for the doctor to set.
TYPES = ("outpatient_report", "discharge_report", "lab_results", "histology", "radiology", "operation_protocol",
         "request", "mdt_referral", "other", "unknown")

# Title phrases, diacritics-folded and lower case, with the type they name. The phrase is matched in a
# folded header line, exactly or (for OCR-damaged headers such as "Ambulantnf vyletfenf") approximately.
TITLES = (
    ("ambulantni vysetreni", "outpatient_report"),
    ("ambulantni zprava", "outpatient_report"),
    ("propousteci zprava", "discharge_report"),
    ("epikriza", "discharge_report"),
    ("vysledky laboratornich vysetreni", "lab_results"),
    ("laboratorni vysledky", "lab_results"),
    ("vysledkovy list", "lab_results"),
    ("bioptický histologický nález", "histology"),
    ("histologicke vysetreni", "histology"),
    ("biopticke vysetreni", "histology"),
    ("cytologicke vysetreni", "histology"),
    ("operacni protokol", "operation_protocol"),
    ("operacni zprava", "operation_protocol"),
    ("radiologicka zprava", "radiology"),
    ("vysledek zobrazovaciho vysetreni", "radiology"),
    ("zadanka", "request"),
    ("zadost o vysetreni", "request"),
    ("pozadavek na vysetreni", "request"),
    ("konzultace pacienta", "mdt_referral"),
)
# FNO's MDT request form ("Konzultace pacienta") prints section labels, not its title: two of them in the
# header zone name the form.
FORM_LABELS = ("identifikace pacienta", "zdravotni stav a diagnozy", "otazka pro mdt", "jmeno pacienta")
HEADER_LINES = 4  # title, department, patient line and one more; deeper lines are the report's body
# A fuzzy title match needs this ratio: "ambulantnf vyletfenf" against "ambulantni vysetreni" scores 0.85,
# while ordinary body lines against any phrase stay under 0.7 on the 35 calibration pages.
FUZZY_RATIO = 0.8
MIN_WORDS_PAGE = 5  # as readability.MIN_WORDS: fewer words is a blank page

# A department or institution line, printed above a report's title: it starts a document.
DEPARTMENT = re.compile(r"\b(?:ambulance|oddělení|klinika|ústav|laboratoř|poradna|pracoviště|centrum)\b", re.I)
CONTINUED = re.compile(r"pokračování", re.I)
# "Strana 1 z 2", "str. 2/3": a page counter of the document itself.
PAGE_OF = re.compile(r"\b(?:strana|str\.)\s*(\d{1,2})\s*(?:z|/|ze)\s*(\d{1,2})\b", re.I)
# Other marks that only a document's first page prints.
START_MARKS = re.compile(r"Č\.\s*(?:žádanky|biopsie)\s*:|Datum vyšetření\s*:|Odběr\s*:|Datum přijetí\s*:", re.I)
# Lab section headings of FNO's printouts; a lab block inside a page starts at the first of them.
LAB_SECTION = re.compile(r"^\s*(?:Stav materiálu|Sérum, plazma|Krevní obraz|Primární vzorek|Krev - |Moč)", re.M)
MIN_LAB_RECORDS = 3  # one or two records can be values quoted in a report ("PLT 97"); a panel has more

# Labelled dates: (date kind, label). The kind says what the date is; each type prefers some kinds.
DATE_LABELS = (
    ("draw", re.compile(r"\bOdběr\s*:", re.I)),
    ("report", re.compile(r"\b(?:vydáno|Datum vydání|Uvolněno)\s*:", re.I)),
    ("exam", re.compile(r"\b(?:Datum vyšetření|Vyšetřen[oa]? dne)\s*:?", re.I)),
    ("operation", re.compile(r"\b(?:Datum operace|Operace dne)\s*:?", re.I)),
    ("admission", re.compile(r"\b(?:Datum přijetí|Přijat[a]? dne)\s*:?", re.I)),
    ("discharge", re.compile(r"\b(?:Datum propuštění|Propuštěn[a]? dne)\s*:?", re.I)),
)
PREFERRED_KINDS = {
    "lab_results": ("draw", "report"),
    "histology": ("report", "draw"),
    "outpatient_report": ("exam", "report"),
    "discharge_report": ("discharge", "report", "admission"),
    "operation_protocol": ("operation", "exam", "report"),
    "radiology": ("exam", "report"),
}
DEFAULT_KINDS = ("exam", "report", "draw", "operation", "discharge", "admission")
# The value after a label: digits with dots, slashes or commas, also OCR-damaged ("1112023", "l3.3.2026").
DATE_VALUE = re.compile(r"[ \t]*([0-9OlI|]{1,2}[ \t]?[.,][ \t]?[0-9OlI|]{1,2}[ \t]?[.,][ \t]?[0-9OlI|]{2,4}"
                        r"|[0-9OlI]{1,2}/[0-9OlI]{4}|[0-9OlI|]{4,8})")
FULL = re.compile(r"(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})")
FULL_COMMA = re.compile(r"(\d{1,2})[.,]\s?(\d{1,2})[.,]\s?(\d{4})")  # "14,9,2026": read, but a misread separator
MONTH = re.compile(r"(\d{1,2})/(\d{4})")
YEAR = re.compile(r"(?:19|20)\d{2}")


def fold(s: str) -> str:
    """Lower case without diacritics, for matching headers that OCR read with or without them."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _lines(text: str) -> list[tuple[int, int]]:
    """(start, end) of each line of text that carries at least two letters in a row."""
    out, pos = [], 0
    for line in text.split("\n"):
        if re.search(r"[^\W\d_]{2,}", line):
            out.append((pos, pos + len(line)))
        pos += len(line) + 1
    return out


def _header(text: str) -> list[tuple[int, int]]:
    """The header zone: the first HEADER_LINES lines with words. OCR noise lines of a logo or a stamp
    ("EE S 5 EEE") come first on some FNO pages and would push the title down, so a line counts only when
    most of its tokens are words of two or more letters."""
    out = []
    for s, e in _lines(text):
        toks = text[s:e].split()
        if sum(bool(re.fullmatch(r"\W*[^\W\d_]{2,}\W*", t)) for t in toks) * 2 < len(toks):
            continue
        out.append((s, e))
        if len(out) == HEADER_LINES:
            break
    return out


def _title_in(text: str, s: int, e: int) -> dict | None:
    """The title phrase in the line text[s:e]: its type, the title as written and whether it read exactly.

    Folding keeps one character per character for Czech letters, so offsets in the folded line are offsets
    in the line. The title as written runs from the phrase to the end of its words: following lower-case
    words of 4+ letters ("kontrolní"), not trailing OCR noise ("ny aš", "Zee")."""
    line = text[s:e]
    fl = fold(line)
    if len(fl) != len(line):  # a character that folds to two would shift offsets; then match exact text only
        fl = line.lower()
    best = None
    for phrase, typ in TITLES:
        p = fold(phrase)
        i = fl.find(p)
        if i >= 0:
            best = {"type": typ, "start": i, "end": i + len(p), "exact": True}
            break
        # Approximate: slide a window of the phrase's length over the line's word starts.
        for m in re.finditer(r"\S+", fl):
            j = m.start()
            r = difflib.SequenceMatcher(None, fl[j:j + len(p)], p).ratio()
            if r >= FUZZY_RATIO and (best is None or r > best["ratio"]):
                best = {"type": typ, "start": j, "end": j + len(p), "exact": False, "ratio": r}
    if best is None:
        return None
    end = best["end"]
    # Finish the word the phrase ends in, then take following lower-case words.
    while end < len(line) and line[end].isalpha():
        end += 1
    for m in re.finditer(r"\s+([^\W\d_]{4,})(?=\s|$|[,.;:])", line[end:]):
        if m.start() != 0 or not m.group(1).islower():
            break
        end += m.end()
    return {"type": best["type"], "start": s + best["start"], "end": s + end,
            "title": line[best["start"]:end].strip(), "exact": best["exact"]}


def _form(text: str, header: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Spans of the MDT form's section labels anywhere in the first lines of the page."""
    spans = []
    for s, e in _lines(text)[:HEADER_LINES + 6]:
        fl = fold(text[s:e])
        for lab in FORM_LABELS:
            i = fl.find(lab)
            if i >= 0 and len(fl) == e - s:
                spans.append((s + i, s + i + len(lab)))
    return spans


def _lab_block(text: str, after: int) -> tuple[int, int] | None:
    """Where a lab panel starts inside the page text after offset `after`: the first lab section heading
    with at least MIN_LAB_RECORDS lab records below it."""
    for m in LAB_SECTION.finditer(text, after):
        if len(list(RECORD.finditer(text, m.start()))) >= MIN_LAB_RECORDS:
            end = text.find("\n", m.start())
            return m.start(), len(text) if end < 0 else end
    return None


def parse_date(raw: str) -> tuple[str | None, str | None, bool]:
    """(normalised date, as written, clean) of a date string read after a label.

    The precision stays as printed: "6.10.2026" is a day, "03/2024" a month, "2024" a year. A string that
    does not read as a real date gives (None, None, False): it is damage, and the label is shown for
    checking. A date with commas for dots ("14,9,2026") is read but not clean."""
    raw = raw.strip()
    for rx, clean in ((FULL, True), (FULL_COMMA, False)):
        m = rx.fullmatch(raw)
        if m:
            d, mo, y = (int(x) for x in m.groups())
            try:
                return date(y, mo, d).isoformat(), raw, clean
            except ValueError:
                return None, None, False
    m = MONTH.fullmatch(raw)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{m.group(2)}-{int(m.group(1)):02d}", raw, True
    if YEAR.fullmatch(raw):
        return raw, raw, True
    return None, None, False


def _date(text: str, start: int, end: int, typ: str) -> dict | None:
    """The part's date from the labelled fields in text[start:end], by the kinds its type prefers."""
    found = {}
    for kind, rx in DATE_LABELS:
        m = rx.search(text, start, end)
        if not m:
            continue
        v = DATE_VALUE.match(text, m.end())
        if v is None:
            continue  # a label with nothing date-like after it is a form label left empty
        iso, written, clean = parse_date(v.group(1))
        found[kind] = {"kind": kind, "date": iso, "as_written": written, "clean": clean,
                       "start": v.start(1), "end": v.end(1)}
    for kind in PREFERRED_KINDS.get(typ, DEFAULT_KINDS):
        if kind in found:
            return found[kind]
    return None


def _ends_open(text: str) -> bool:
    """The page's text stops mid-sentence: the last line with words ends without a sentence end."""
    lines = _lines(text)
    if not lines:
        return False
    last = text[lines[-1][0]:lines[-1][1]].rstrip()
    return bool(last) and last[-1] not in ".!?:)"


def _starts_lower(text: str) -> bool:
    m = re.search(r"[^\W\d_]", text)
    return bool(m) and m.group().islower()


def _word_count(text: str) -> int:
    return len(re.findall(r"[^\W\d_]{2,}", text))


class _Part:
    def __init__(self, n: int, offset: int, typ: str, title: dict | None):
        self.pages = [n]
        self.start = {"n": n, "offset": offset}
        self.end = {"n": n, "offset": None}
        self.type = typ
        self.title = title
        self.evidence: list[dict] = []
        self.verify: list[str] = []  # why the part is "verify"; codes for tests, never shown with page text

    def add(self, n: int) -> None:
        if n not in self.pages:
            self.pages.append(n)
        self.end = {"n": n, "offset": None}


def split(pages: list[dict]) -> dict:
    """The parts of one PDF from its pages ({n, text, layer_text?, readability_level?}), in page order."""
    pages = sorted(pages, key=lambda p: int(p["n"]))
    texts = {int(p["n"]): p.get("text") or "" for p in pages}
    levels = {int(p["n"]): p.get("readability_level") for p in pages}
    parts: list[_Part] = []
    prev_text = ""
    for p in pages:
        n, text = int(p["n"]), texts[int(p["n"])]
        cur = parts[-1] if parts else None
        if _word_count(text) < MIN_WORDS_PAGE:
            # A blank page (a scan's back side) belongs to the document before it; it opens nothing.
            if cur:
                cur.add(n)
            else:
                part = _Part(n, 0, "unknown", None)
                part.verify.append("no_header")
                parts.append(part)
            continue
        header = _header(text)
        title = None
        for s, e in header:
            title = _title_in(text, s, e)
            if title:
                break
        form = _form(text, header)
        hz_end = header[-1][1] if header else 0
        hz = text[:hz_end]
        counter = PAGE_OF.search(text)
        continued = bool(CONTINUED.search(hz)) or bool(counter and int(counter.group(1)) > 1)
        first_of = bool(counter and int(counter.group(1)) == 1)
        start_mark = (first_of or bool(START_MARKS.search(text[:_header_window(text)]))
                      or any(DEPARTMENT.search(text[s:e]) for s, e in header))
        typ = title["type"] if title else ("mdt_referral" if len(form) >= 2 else None)

        if cur is None or (not continued and (
                (typ and start_mark) or (typ and typ != cur.type) or (typ and cur.type == "unknown"))):
            part = _Part(n, 0, typ or _content_type(text), title)
            if title:
                part.evidence += [{"n": n, "start": title["start"], "end": title["end"], "what": "title"}]
                if not title["exact"]:
                    part.verify.append("title_approximate")
            elif typ == "mdt_referral":
                part.evidence += [{"n": n, "start": s, "end": e, "what": "type"} for s, e in form]
            if part.type == "unknown":
                part.verify.append("type_unknown")
            if cur is not None and not start_mark:
                part.verify.append("start_by_type_change")
            parts.append(part)
            cur = part
        else:
            cur.add(n)
            if continued:
                pass  # the page says so itself
            elif title and cur.title and fold(title["title"]) == fold(cur.title["title"]):
                cur.verify.append("repeated_header")  # same header may also start another report of the kind
            elif not title and (_ends_open(prev_text) or _starts_lower(text)):
                pass  # the text runs on from the previous page
            else:
                cur.verify.append("continuation_unclear")

        # A lab panel printed under the report text opens a lab part on this page.
        if cur.type != "lab_results":
            block = _lab_block(text, hz_end)
            if block:
                cur.end = {"n": n, "offset": block[0]}
                lab = _Part(n, block[0], "lab_results", None)
                lab.evidence.append({"n": n, "start": block[0], "end": block[1], "what": "type"})
                parts.append(lab)
        prev_text = text

    out = []
    for i, part in enumerate(parts):
        first = texts[part.start["n"]]
        end = part.end["offset"] if part.end["n"] == part.start["n"] and part.end["offset"] is not None else len(first)
        d = _date(first, part.start["offset"], end, part.type)
        if d:
            part.evidence.append({"n": part.start["n"], "start": d["start"], "end": d["end"], "what": "date"})
            if not d["clean"]:
                part.verify.append("date_unreadable" if d["date"] is None else "date_separator")
        lv = [levels[n] for n in part.pages if levels.get(n)]
        out.append({
            "ordinal": i,
            "pages": part.pages,
            "from": part.start,
            "to": part.end,
            "type": part.type,
            "title_cs": part.title["title"] if part.title else None,
            "date_as_written": d["as_written"] if d else None,
            "date": d["date"] if d else None,
            "date_kind": d["kind"] if d and d["date"] else None,
            "evidence": sorted(part.evidence, key=lambda x: (x["n"], x["start"])),
            "certainty": "verify" if part.verify else "documented",
            "verify_reasons": sorted(set(part.verify)),
            "readability_level": worst(lv) if len(lv) == len(part.pages) else None,
        })
    return {"parts": out}


def _header_window(text: str) -> int:
    """End offset of the first lines where a document's first page prints its start marks (a few lines
    under the header: patient line, requisition number, draw date)."""
    lines = _lines(text)
    return lines[min(len(lines), HEADER_LINES + 4) - 1][1] if lines else 0


def _content_type(text: str) -> str:
    """The type of a page without a title, from its layout: a lab panel is recognisable without one."""
    if len(list(RECORD.finditer(text))) >= MIN_LAB_RECORDS and LAB_SECTION.search(text):
        return "lab_results"
    return "unknown"
