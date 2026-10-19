"""Lab sheet parser: dated draws and test values from the text of record, checked against a second reading.

Labs never go to an LLM. The parser reads FNO-style printouts: `CODE: value unit [low ... high]`, one or
several records per line (a record may wrap onto the next line), NČLP-style codes (the national code list
for lab tests: `S_CREAE`, `B_PLT`, `PT(KIDN)_EGFRCKDE`), section headings, and sample-quality indices
(`S_IDXLIPK: NEGAT -`). Rules from docs/research/backend-steps/step-6.md, "Lab parser":

- The value, unit and reference range are kept as written in the text of record. The code is normalized
  ("B LKC" and "S AST." from Tesseract become B_LKC and S_AST) and the written form is kept with it.
- A point is "documented" only when the second reading (the PDF text layer, or Tesseract when the text of
  record is the vision model's) has the same code, value, unit and range at the same place, the value
  needed no look-alike repair (O for 0, l or I for 1), Tesseract read the value with confidence of at
  least LOW_CONF, the draw date was confirmed by both readings, and the page is not poor. Anything else is
  "unclear_ocr" ("ověřit") with the reasons, and both readings are kept where they differ.
- Units that differ only by look-alike letters and carry no digit ("umol/l" for "µmol/l") are not a
  clinical risk and do not make a point unclear (same_unit in page_index); the readings are still kept.
- The draw date comes only from "Odběr: d.m.yyyy hh:mm" on the page. Without it the date is null with the
  fixed wording for a gap; nothing is guessed from the document date or a neighbouring page.
- S_IDX* records are sample-quality indices: listed apart, never findings.
- A test whose unit or reference range changes between draws is not merged into one trend row.
- A line that looks like a lab result but does not parse is listed in `unparsed`, never dropped silently.
"""

import difflib
import re
from datetime import date

from .page_index import CONFUSABLE, LOW_CONF, attach_words, plain_tokens, same_unit

GAP_CS = "neuvedeno v dostupné dokumentaci"

# Our display labels; the sheets print only the code (CLAUDE.md: the code stays as given).
NAMES = {
    "B_LKC": "Leukocyty", "B_NEU": "Neutrofily (abs.)", "B_LYMFO": "Lymfocyty (abs.)", "B_HB": "Hemoglobin",
    "B_PLT": "Trombocyty", "S_GLC": "Glukóza", "S_UREA": "Urea", "S_CREAE": "Kreatinin",
    "PT(KIDN)_EGFRCKDE": "eGFR CKD-EPI", "S_NA": "Sodík", "S_K": "Draslík", "S_BIL": "Bilirubin celkový",
    "S_ALT": "ALT", "S_AST": "AST", "S_GGT": "GGT", "S_ALP": "ALP", "S_ALB": "Albumin", "S_HSCRP": "CRP",
    "S_CEA": "CEA", "S_CA199": "CA 19-9",
}

_NUM = r"[\dOolI]+(?:[.,][\dOolI]+)?"  # look-alike letters allowed here, then repaired and flagged
_CODE = (r"(?<![\w(])(?P<code>(?P<pre>[A-Z]{1,5})"
         # "(B)" or "(KIDN)"; Tesseract reads "(" as "C" ("ERCCB) MCH", "LKCCB). NEU").
         r"(?P<grp>[(C][A-Z]{1,5}\))?"
         # The underscore Tesseract drops or reads as space, dot or hyphen ("B LKC", "S. BIL", "B-HB", "S....AST").
         r"(?P<sep>[ _.\-]{1,4})"
         r"(?P<name>[A-Z][A-Z0-9]{0,11}))")
# A unit token is short ("g", "fl", "%", "1") or carries a slash, power sign or percent ("mmol/l", "10^9/l",
# "ml/s/1,73"); at most two tokens with one space ("ml/s/1,73 m2"). This keeps the unit from swallowing the
# next record or a word of prose when a colon or bracket is lost.
_UNIT_TOK = r"(?:[^\s\[\]:]{1,3}|[^\s\[\]:]*[/%^][^\s\[\]:]*)"
# Spaces, or a line break that Tesseract may double into a blank line: a record wraps at most once
# ("S URAT: 301\numol/1", "S. ALP: 1,30\n\nukat/1"), so a record never runs across a whole paragraph.
_GAP = r"(?:[ \t]+|[ \t]*\n[ \t]*(?:\n[ \t]*)?)"
_GAP0 = r"[ \t]*(?:\n[ \t]*){0,2}"
RECORD = re.compile(
    # Sample-quality indices (S_IDX*) are never results, also when they carry a number.
    _CODE.replace("(?P<name>[A-Z]", "(?P<name>(?!IDX)[A-Z]") + r"[ \t]*[:.]" + _GAP0 +
    r"(?P<b1>\*\*)?(?P<val>[<>]?" + _NUM + r")(?P<b2>\*\*)?"
    # A printed flag after the value ("5,8 H mmol/l") is the sheet's mark, not part of the unit.
    r"(?:[ \t]+(?P<flag>[HL]|\*{1,2}|!))?"
    + _GAP + r"(?P<unit>" + _UNIT_TOK + r"(?: " + _UNIT_TOK + r")?)" + _GAP0 +
    # "[2.9... 8.2]", "[135 .... 175]", "[135\n. 175)", "[O ... 5]": spacing, the dot count and the closing bracket vary in OCR.
    r"\[\s*(?P<lo>" + _NUM + r")\s*\.{1,4}\s*(?P<hi>" + _NUM + r")\s*[\])]")
INDEX = re.compile(_CODE.replace("(?P<name>[A-Z][A-Z0-9]{0,11})", "(?P<name>IDX[A-Z0-9]{1,10})")
                   + r"\s*:\s*(?P<val>[A-ZÀ-Ža-zà-ž]+|[<>]?[\d,.]+)(?:[ \t]*(?P<flag>[-+]{1,3}))?"
                   # A numeric index may print a unit and range; a unit is taken only in front of its range.
                   r"(?:(?:[ \t]+(?P<unit>" + _UNIT_TOK + r"))?[ \t]*\[[^\]\n]{0,30}[\])])?")
# Where the separator is not an underscore, the code must start like an NČLP code, so prose such as
# "PET CT: 4 cm [1 ... 2]" is not taken for a test (it is listed as unparsed instead).
CODE_PREFIXES = {"S", "B", "P", "U", "PT", "LKC", "ERC", "PLT", "KREV", "MOC", "CSF", "SA"}
# "/1" where a unit ends in l ("mmol/1"; not "ml/s/1,73 m2"), "|" for l, and the power sign read as a
# letter or digit ("10A9/l", "10\"9/|"), as in page_reader.readability's damage patterns.
UNIT_DAMAGE = re.compile(r"(?<=[A-Za-zµ9])/1(?![\d,.])|\||\d[\"A]\d")
DRAW = re.compile(r"Odběr:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?")
# Anything that looks like a draw header, also misread ("Odbér", "Odbèr", "Odbr: l.3.2026"): it ends the
# current draw even when its date cannot be read, so later results are never filed under an earlier date.
DRAW_LIKE = re.compile(r"\bOdb\w{0,2}r\b|\bOdb\w{1,3}\s*[:.;,]?\s*[\dlIO]")
# A time after the date that is not two clean digit pairs ("07:2O"): the time is unreadable, not absent.
TIME_LIKE = re.compile(r"\s+[\dOolI]{1,2}[:.][\dOolI]{2}")
DATE_UNREADABLE_CS = "Datum odběru nečitelné, ověřte v originálu."
DATE_PREVIOUS_PAGE_CS = "Datum odběru je na předchozí straně; ověřte v originálu."
REQUISITION = re.compile(r"Č\. žádanky: \S+")
# What makes a line look like a lab result even when no record parsed: a reference range, or a code-like
# token followed by a colon and a number.
LAB_LIKE = re.compile(r"\[\s*" + _NUM + r"\s*\.{1,4}|\.{2,4}\s*" + _NUM + r"\s*[\])]"
                      r"|(?<![\w(])[A-Z]{1,5}(?:[(C][A-Z]{1,5}\))?[ _.\-]{0,4}[A-Z][A-Z0-9]{0,11}\s*[:.]\s*[\dOlI]")


def _number(tok: str) -> tuple[float | None, bool]:
    """The number a token stands for and whether that needed the look-alike map (O for 0, l or I for 1)."""
    raw = tok.lstrip("<>")
    fixed = raw.translate(CONFUSABLE)
    try:
        return float(fixed.replace(",", ".")), fixed != raw
    except ValueError:
        return None, fixed != raw


def _fold(s: str) -> str:
    """Grouping key for units and ranges: look-alike letters and spacing do not split a trend row."""
    return re.sub(r"\s+", "", s.translate(CONFUSABLE).lower())


def _flat(s: str) -> str:
    """Compare two quotes without Markdown bold and line wrapping, which are not reading differences."""
    return re.sub(r"\s+", " ", s.replace("**", "")).strip()


def parse_text(text: str) -> tuple[list[dict], list[dict], list[tuple[int, int]]]:
    """Records, indices and the character spans they cover, from one page's text."""
    records, indices, spans = [], [], []
    for d in _draws(text):
        if d["date"]:  # an unreadable header stays uncovered, so it is listed in unparsed
            spans.append((d["start"], d["end"]))
    for m in RECORD.finditer(text):
        g = m.groupdict()
        if not g["sep"].startswith("_") and g["pre"] not in CODE_PREFIXES:
            continue
        code = g["pre"] + (f"({g['grp'][1:-1]})" if g["grp"] else "") + "_" + g["name"]
        records.append({
            "code": code, "code_as_written": g["code"], "value": g["val"],
            # Bold on one side only is a transcription slip, so the print cannot be told: null, not False.
            "bold": True if g["b1"] and g["b2"] else None if g["b1"] or g["b2"] else False,
            "unit": g["unit"], "flag": g["flag"], "lo": g["lo"], "hi": g["hi"], "start": m.start(), "end": m.end(),
            "val_start": m.start("val"), "val_end": m.end("val"),
        })
        spans.append((m.start(), m.end()))
    for m in INDEX.finditer(text):
        g = m.groupdict()
        code = g["pre"] + (f"({g['grp'][1:-1]})" if g["grp"] else "") + "_" + g["name"]
        indices.append({"code": code, "code_as_written": g["code"], "value": g["val"], "flag": g["flag"],
                        "start": m.start(), "end": m.end()})
        spans.append((m.start(), m.end()))
    return records, indices, spans


def unparsed_lines(text: str, spans: list[tuple[int, int]]) -> list[dict]:
    """Lines that look like lab results in the parts no record covered."""
    covered = bytearray(len(text))
    for s, e in spans:
        covered[s:e] = b"\x01" * (e - s)
    out, pos = [], 0
    for line_no, line in enumerate(text.split("\n"), 1):
        rest = "".join(" " if covered[pos + k] else ch for k, ch in enumerate(line))
        if DRAW_LIKE.search(rest):
            out.append({"line_no": line_no, "start": pos, "end": pos + len(line), "reason": "draw_date_not_parsed",
                        "reason_cs": "Řádek vypadá jako datum odběru, ale nepodařilo se ho přečíst; ověřte v originálu."})
        elif LAB_LIKE.search(rest):
            out.append({"line_no": line_no, "start": pos, "end": pos + len(line),
                        "reason": "lab_like_not_parsed",
                        "reason_cs": "Řádek vypadá jako laboratorní výsledek, ale nepodařilo se ho přečíst; ověřte v originálu."})
        pos += len(line) + 1
    return out


def _pair(tor: list[dict], second: list[dict]) -> list[dict | None]:
    """For each record of the text of record, the record of the second reading at the same place."""
    out: list[dict | None] = [None] * len(tor)
    a, b = [r["code"] for r in tor], [r["code"] for r in second]
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        # A replaced block of equal length is a misread code at the same place ("S_CA190" for "S_CA199").
        if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
            for i, j in zip(range(i1, i2), range(j1, j2)):
                out[i] = second[j]
    return out


def _draws(text: str) -> list[dict]:
    """The draw headers of a page in order, each with its date as printed after "Odběr:".

    A header whose word or date cannot be read still counts (date None, status "unreadable"); a header
    without a time has time None; a time that is there but misread sets time_unreadable."""
    draws, last_end = [], -1
    for h in DRAW_LIKE.finditer(text):
        if h.start() < last_end:
            continue
        m = DRAW.match(text, h.start())
        iso, tm, key, end, time_bad = None, None, None, h.end(), False
        if m:
            d, mo, y, hh, mm = m.groups()
            try:
                iso = date(int(y), int(mo), int(d)).isoformat()
            except ValueError:  # "31.2.2026" is a misread, not a date
                iso = None
            end = m.end()
            if iso:
                key = m.groups()
                if hh:
                    tm = f"{int(hh):02d}:{mm}"
                elif TIME_LIKE.match(text, m.end()):
                    time_bad = True
        line_end = text.find("\n", h.start())
        line_end = len(text) if line_end < 0 else line_end
        draws.append({"at": h.start(), "date": iso, "time": tm, "key": key, "time_unreadable": time_bad,
                      "status": "ok" if iso else "unreadable",
                      "quote": text[h.start():end if iso else line_end], "start": h.start(), "end": end if iso else line_end})
        last_end = end
    return draws


def _draw_at(draws: list[dict], pos: int) -> dict | None:
    before = [d for d in draws if d["at"] < pos]
    return before[-1] if before else None


def _similar_code(a: str, b: str) -> bool:
    """A misread of the same code ("S_CA190" for "S_CA199"), not a different test at the same place."""
    return len(a) == len(b) and a.split("_")[0] == b.split("_")[0] and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def parse(pages: list[dict], doc_id: str | None = None, second_name: str = "text_layer") -> dict:
    """Parse the lab pages of one or more documents into the labs_series shape of mock-case-S02.json.

    Each page: {n, text (text of record), layer_text (second reading, may be empty), readability_level,
    optional words (Tesseract's words, for the value confidence), optional engine ("vision" when the text
    of record is the vision Markdown, whose bold marks the sheet's out-of-range print), optional doc_id}."""
    draws, raw_points, indices, unparsed = [], [], [], []
    had_draw: set = set()  # documents whose earlier page carried a draw header
    for pg in pages:
        n, text = pg["n"], pg.get("text") or ""
        second_text = pg.get("layer_text") or ""
        did = pg.get("doc_id") or doc_id
        records, idx, spans = parse_text(text)
        second, _, _ = parse_text(second_text)
        paired = _pair(records, second)
        meta = None
        if pg.get("words"):
            toks = plain_tokens(text)
            meta = list(zip(toks, attach_words(toks, pg["words"])))
        # A page whose readability was not judged counts as not readable, never as readable.
        level = pg.get("readability_level")
        poor = level not in ("good", "fair")
        is_vision = pg.get("engine") == "vision"

        page_draws, second_draws = _draws(text), _draws(second_text)
        # A draw is confirmed when the second reading has the same headers in the same order; a header one
        # reading lost would otherwise file the following results under the previous date.
        same_headers = [d["key"] for d in page_draws] == [d["key"] for d in second_draws]
        for d in page_draws:
            d["confirmed"] = bool(d["date"]) and same_headers
            d["confirmed"] = d["confirmed"] and not d["time_unreadable"]
        if not page_draws or (records and records[0]["start"] < page_draws[0]["at"]):
            # Results before any header on this page: their date is not on the page and is not guessed. When an
            # earlier page of the same document had a header, this is a continuation page, which is not a gap.
            page_draws.insert(0, {"at": -1, "date": None, "time": None, "key": None, "quote": None, "confirmed": False,
                                  "time_unreadable": False, "status": "previous_page" if did in had_draw else "missing"})
        if any(d["status"] != "missing" and d["at"] >= 0 for d in page_draws):
            had_draw.add(did)
        for d in page_draws:
            draw = {
                # Date only when the time is not printed: never a made-up time, never "... None".
                "datetime": (f"{d['date']} {d['time']}" if d["time"] else d["date"]) if d["date"] else None,
                "date": d["date"], "time": d["time"],
                "source": ({"doc_id": did, "page": n, "quote": d["quote"], "start": d["start"], "end": d["end"]}
                           if d["quote"] else None),
                "certainty": (None if d["status"] == "missing" else "unclear_ocr" if not d["date"]
                              else "documented" if d["confirmed"] else "unclear_ocr"),
            }
            req = REQUISITION.search(text)
            draw["requisition_quote"] = req.group(0) if req else None
            if d["status"] == "missing":
                draw["date_note_cs"] = f"Datum odběru {GAP_CS}."
            elif d["status"] == "unreadable":
                draw["date_note_cs"] = DATE_UNREADABLE_CS
            elif d["status"] == "previous_page":
                draw["date_note_cs"] = DATE_PREVIOUS_PAGE_CS
            elif d["time_unreadable"]:
                draw["date_note_cs"] = "Čas odběru nečitelný, ověřte v originálu."
            d["record"] = draw
            draws.append(draw)

        for r, other in zip(records, paired):
            d = _draw_at(page_draws, r["start"])
            reasons = []
            num, fixed_v = _number(r["value"])
            lo, fixed_lo = _number(r["lo"])
            hi, fixed_hi = _number(r["hi"])
            if fixed_v or fixed_lo or fixed_hi:
                reasons.append("confusable")
            if other is None:
                reasons.append("no_second_reading")
            else:
                if other["code"] != r["code"]:
                    reasons.append("code_differs")
                if other["value"] != r["value"]:
                    reasons.append("value_differs")
                if other["unit"] != r["unit"] and not same_unit(r["unit"], other["unit"]):
                    reasons.append("unit_differs")
                if (other["lo"], other["hi"]) != (r["lo"], r["hi"]):
                    reasons.append("range_differs")
            # Both readings can share a misread ("g/1", "10A9/1" in FNO's layer and in Tesseract alike).
            if UNIT_DAMAGE.search(r["unit"]):
                reasons.append("unit_damaged")
            if meta is None and not is_vision:
                reasons.append("conf_unknown")  # Tesseract's text sent without its words: the confidence rule cannot run
            if meta is not None:
                confs = [w["c"] for (t, w) in meta if w and t[1] < r["val_end"] and t[2] > r["val_start"]]
                if not confs:
                    reasons.append("conf_unknown")
                elif min(confs) < LOW_CONF:
                    reasons.append("low_conf")
            # A missing date shows as a gap on the draw; a date read once but not confirmed may be a wrong date.
            # The paired record must also sit under the same header in the second reading.
            d2 = _draw_at(second_draws, other["start"]) if other is not None else None
            if d["status"] == "unreadable":
                reasons.append("draw_date_unreadable")
            elif d["status"] == "previous_page":
                reasons.append("draw_on_previous_page")
            elif d["time_unreadable"]:
                reasons.append("draw_time_unreadable")
            elif d["date"] and not (d["confirmed"] and d2 is not None and d2["key"] == d["key"]):
                reasons.append("draw_date_unconfirmed")
            elif not d["date"] and d2 is not None:
                reasons.append("draw_date_differs")  # the second reading has a draw header the text of record lost
            if level is None:
                reasons.append("readability_unknown")
            elif poor:
                reasons.append("page_poor")
            out = None
            if num is not None and lo is not None and hi is not None and not r["value"].startswith(("<", ">")):
                out = "high" if num > hi else "low" if num < lo else None
            quote = text[r["start"]:r["end"]]
            point = {
                "value": r["value"], "unit": r["unit"], "reference_range": f"{r['lo']} ... {r['hi']}",
                "out_of_range": out,
                # Bold is visible only in the vision Markdown; Tesseract's text cannot tell, so null, not False.
                "flagged_in_document": True if r["flag"] else r["bold"] if is_vision else None,
                "flag_as_written": r["flag"],
                "date": d["record"]["date"], "time": d["record"]["time"],
                "certainty": "unclear_ocr" if reasons else "documented", "verify_reasons": reasons,
                "code_as_written": r["code_as_written"],
                "source": {"doc_id": did, "page": n, "quote": quote, "start": r["start"], "end": r["end"]},
            }
            if other is not None and _flat(other_quote := second_text[other["start"]:other["end"]]) != _flat(quote):
                point["readings"] = {"text_of_record": quote, second_name: other_quote}
            # Grouping into trend rows follows the second reading where there is one, so a unit misread in one
            # draw ("10\"9/|" against "10^9/l") does not split the row; the point stays unclear and as written.
            ref = other if other is not None else r
            code = r["code"]
            if (other is not None and other["code"] != r["code"] and other["code"] in NAMES and r["code"] not in NAMES
                    and _similar_code(r["code"], other["code"])):
                code = other["code"]  # a misread code ("S_CA190") is filed under the code the other reading has
            raw_points.append({"code": code, "unit_key": _fold(ref["unit"]), "range_key": (_fold(ref["lo"]), _fold(ref["hi"])),
                               "lo": lo, "hi": hi, "num": num, "draw": d["record"], "point": point})
        for i in idx:
            indices.append({"code": i["code"], "code_as_written": i["code_as_written"], "value": i["value"], "flag": i["flag"],
                            "kind": "sample_quality_index",
                            "source": {"doc_id": did, "page": n, "quote": text[i["start"]:i["end"]], "start": i["start"], "end": i["end"]}})
        unparsed += [{"n": n, "doc_id": did, **u} for u in unparsed_lines(text, spans)]
        # A result only the second reading has may be one the text of record lost ("S_K: 6,9" Tesseract
        # dropped); it is listed with the other reading's quote, so it never vanishes.
        taken = {id(o) for o in paired if o is not None}
        for o in second:
            if id(o) not in taken:
                unparsed.append({"n": n, "doc_id": did, "line_no": second_text.count("\n", 0, o["start"]) + 1,
                                 "start": o["start"], "end": o["end"], "in": second_name, "code": o["code"],
                                 "quote": second_text[o["start"]:o["end"]], "reason": "only_second_reading",
                                 "reason_cs": "Výsledek je jen ve druhém čtení (textová vrstva PDF), v textu záznamu "
                                              "chybí; ověřte v originálu."})

    # Chronological order; draws without a date keep their input order after the dated ones. An undated draw
    # with no results (a page that is not a lab sheet) is not a draw at all.
    with_points = {id(p["draw"]) for p in raw_points}
    draws = [d for d in draws if d["date"] or id(d) in with_points]
    draws = [d for _, d in sorted(enumerate(draws), key=lambda kd: (kd[1]["datetime"] is None, kd[1]["datetime"] or "", kd[0]))]
    slot = {id(d): k for k, d in enumerate(draws)}

    rows: dict[tuple, dict] = {}
    for p in raw_points:
        key = (p["code"], p["unit_key"], p["range_key"])
        k = slot[id(p["draw"])]
        dup = 0
        while (key + (dup,)) in rows and rows[key + (dup,)]["points"][k] is not None:
            dup += 1  # two values of one test in one draw cannot share a trend row
        row = rows.setdefault(key + (dup,), {
            "code": p["code"], "name_cs": NAMES.get(p["code"]), "unit": p["point"]["unit"],
            "reference_range": p["point"]["reference_range"], "reference_low": p["lo"], "reference_high": p["hi"],
            "values": [None] * len(draws), "points": [None] * len(draws),
        })
        # "<0,5" is a detection limit, not a measurement, so a chart must not plot it as 0.5.
        row["values"][k] = None if p["point"]["value"].startswith(("<", ">")) else p["num"]
        row["points"][k] = p["point"]
    tests = list(rows.values())
    per_code: dict[str, int] = {}
    for t in tests:
        per_code[t["code"]] = per_code.get(t["code"], 0) + 1
    for t in tests:
        if per_code[t["code"]] > 1:
            t["note_cs"] = ("Jednotka nebo referenční rozmezí se mezi odběry liší, případně jsou v jednom odběru dvě "
                            "hodnoty; řádky nejsou sloučeny do jednoho trendu.")
    points = [p for t in tests for p in t["points"] if p]
    return {
        "name_note": "name_cs is our display label; the sheets print only the code.",
        "draws": draws, "tests": tests, "indices": indices, "unparsed": unparsed,
        "counts": {"draws": len(draws), "tests": len(tests), "points": len(points),
                   "documented": sum(p["certainty"] == "documented" for p in points),
                   "unclear_ocr": sum(p["certainty"] == "unclear_ocr" for p in points),
                   "indices": len(indices), "unparsed": len(unparsed),
                   "only_second_reading": sum(u["reason"] == "only_second_reading" for u in unparsed)},
    }
