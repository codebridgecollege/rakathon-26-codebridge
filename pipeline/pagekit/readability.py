"""Reading certainty of a page, judged from the text itself (CLAUDE.md, "Check that a document is readable").

Not from whether a text layer exists: FNO's text layers are poor OCR. Levels, worst first:

- empty: fewer than MIN_WORDS words read.
- poor: mean word confidence below POOR_MEAN_CONF; more than POOR_LOW_SHARE of words below LOW_CONF;
  more than POOR_UNKNOWN_SHARE of alphabetic tokens of 4+ letters in no word list (only when a word list
  is configured, see below); more than POOR_VERIFY_SHARE of risky tokens (digits, stages) marked "ověřit"
  when the second reading is the vision model.
- fair: FAIR_LOW_SHARE or more of words below LOW_CONF; more than FAIR_LAYER_VERIFY_SHARE of risky tokens
  marked "ověřit" when the second reading is the PDF text layer; any OCR damage pattern (DAMAGE below).
- good otherwise.

Every reason is a Czech string naming the page and the pattern, never the surrounding text. The document
level is its worst page. The rules and thresholds are those of docs/research/backend-steps/step-6.md,
"Readability check"; the calibration on the 35 pages in data/derived is reported where each constant is.

Word list: the unknown-token rule needs a Czech word list (hunspell-cs), which is not installed here or in
the container image yet, so the rule is off unless `wordlist` is passed to `assess()`. Turning it on in
one place only would make the container and the scripts disagree, so it is a parameter, not a default.
"""

import re

from .page_index import DIGIT, LOW_CONF, risky

MIN_WORDS = 5  # step-6.md; the blank back pages of FNO's PDFs give 0-3 stray marks
# step-6.md values, kept after calibration on the 35 pages in data/derived (Tesseract 5.5.3, ces, psm 4):
# the lowest page mean was 83.5 (FNO 9_pacient p3, a lab printout) and the highest low-confidence share
# 11.2 % (FNO 10_pacient p3, also a lab printout). Every one of those pages is readable by eye, so none
# should be poor, and none is.
POOR_MEAN_CONF = 75
POOR_LOW_SHARE = 0.15
POOR_UNKNOWN_SHARE = 0.25  # step-6.md; not calibrated, the rule is off without a word list
FAIR_LOW_SHARE = 0.05  # step-6.md; 5-15 % of low-confidence words. S01/S02 lab sheets sit at 5-8 %.
# step-6.md said 10 %. With the vision model as second reading (page-index.json) the clean synthetic print
# of S01 p3/p4 reaches 10.9 % and FNO 10_pacient p1 14.5 %, all readable by eye, so 10 % would call clean
# pages poor; 25 % keeps every calibration page above poor while a page with one risky token in four
# misread still is.
POOR_VERIFY_SHARE = 0.25
# With the PDF text layer as second reading (slice 6b-1) a disagreement may be the layer's fault: FNO's
# layers come from broken font maps (10_pacient p1 16 %, 18_pacient p1 29 %, while S01/S02 stay at or below
# 9.1 %). So a high share there means "fair", never "poor".
FAIR_LAYER_VERIFY_SHARE = 0.10
VERIFY_MIN_RISKY = 20  # below 20 risky tokens one disagreement is already 5 %, too few to judge a page by

LEVELS = ("good", "fair", "poor", "empty")  # ordered from best to worst

# OCR damage patterns from step-6.md and the FNO evaluation (docs/research/2026-10-16-ocr-evaluation.md).
# Each is (code, regex, Czech description). Matched on the text of record.
DAMAGE = (
    # "1112023" for 11/2023, "212024" for 2/1/2024: a 6-7 digit run ending in a plausible year, not part of a
    # birth number ("585614/4019", or "902005 1234" with a space), a requisition number ("S02-260310-01") or a
    # longer number. A dot right before it is allowed after a letter ("nar.1112023"), not after a digit.
    ("date_run", re.compile(r"(?<![\d/\-,])(?<!\d\.)\d{2,3}(?:19[5-9]\d|20[0-3]\d)(?![\d/\-]|[.,]\d|\s\d{3,4}\b)"),
     "data ve tvaru {tok}, ověřte v originálu"),
    # "MO"/"NO"/"RO"/"PO" for M0/N0/R0/P0; only where a TNM, resection or response term is on the same line.
    ("tnm_letter_o", re.compile(r"(?<![A-Za-zÀ-ž])(?:y?[cp]?)[MNRP]O(?![A-Za-zÀ-ž0-9])"),
     "stadium ve tvaru {tok} (písmeno O místo nuly), ověřte v originálu"),
    # "lmg" for 1 mg, "1l2", "0,l5": l or I where a digit belongs in a number or dose.
    ("l_in_number", re.compile(r"(?<![A-Za-zÀ-ž])[lI](?:[.,]\d+)?\s?(?:mg|g|ml|mmol|µg|ug|IU|j)\b|\d[lI]\d|\d[.,][lI]\b|(?<![A-Za-zÀ-ž])[lI][.,]\d"),
     "číslo nebo dávka ve tvaru {tok} (písmeno l/I místo jedničky), ověřte v originálu"),
    # "[O ... 5]", "[O0 ... 4]", "1O5": the letter O inside a number or a reference range.
    # Not "O2" (oxygen) on its own: only O next to a digit run or a decimal sign counts.
    ("o_in_number", re.compile(r"\[\s*O|O\s*\.{2,3}|\.{2,3}\s*O\b|(?<=\d)O|(?<![A-Za-zÀ-ž])O(?=[.,]\d)"),
     "číslo nebo rozmezí ve tvaru {tok} (písmeno O místo nuly), ověřte v originálu"),
    # "mmol/1", "g/1": a unit ending in /1 where /l is printed. "ml/s/1,73 m2" (eGFR) is a real unit.
    ("unit_slash_1", re.compile(r"(?:(?<![A-Za-zÀ-ž])[A-Za-zµ]{1,4}|\d)/1(?![\d,.])"),
     "jednotka ve tvaru {tok} (jednička místo l), ověřte v originálu"),
)
TNM_CONTEXT = re.compile(r"(?<![A-Za-z])(?:y?[cp]?T(?:[0-4]|is|x|X)|TNM|stadi|staging|resek|okraj|R[0-2]\b|odpově|regrese)", re.I)
TOKEN_SHOWN = 16  # a reason shows the damaged token only, cut to this length, never its context


def _tok(m: re.Match) -> str:
    """The match itself, never the token around it: OCR glues neighbours on ("Novák1112023"), and a name
    or a birth number must not reach the reason."""
    return m.group().strip(",;:(). ")[:TOKEN_SHOWN]


def damage_hits(text: str) -> dict[str, list[str]]:
    """The OCR damage patterns found on a page: pattern code to the damaged tokens."""
    hits: dict[str, list[str]] = {}
    lines = text.splitlines()
    for code, rx, _ in DAMAGE:
        for line in lines:
            if code == "tnm_letter_o" and not TNM_CONTEXT.search(line):
                continue
            for m in rx.finditer(line):
                hits.setdefault(code, []).append(_tok(m))
    return hits


def _alpha_tokens(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]{4,}", text)


def assess(n: int, words: list[dict], text: str, verify: list[dict] | None = None,
           second_reading: str | None = None, wordlist: set[str] | None = None) -> dict:
    """The reading certainty of page n: {level, reasons_cs, metrics}.

    words are Tesseract's words ({t, c, b}), text the text of record, verify the page's "ověřit" items,
    second_reading what they were checked against: "text_layer", "vision", or None for no second reading."""
    confs = [w["c"] for w in words]
    count = len(confs)
    metrics: dict = {"word_count": count}
    if count < MIN_WORDS:
        return {"level": "empty", "reasons_cs": [f"s. {n}: na stránce není čitelný text"], "metrics": metrics}

    mean = sum(confs) / count
    low_share = sum(c < LOW_CONF for c in confs) / count
    metrics.update(mean_conf=round(mean, 1), low_conf_share=round(low_share, 3))
    poor, fair = [], []
    if mean < POOR_MEAN_CONF:
        poor.append(f"s. {n}: nízká průměrná jistota čtení ({round(mean)} %)")
    if low_share > POOR_LOW_SHARE:
        poor.append(f"s. {n}: {round(low_share * 100)} % slov přečteno s nízkou jistotou")
    elif low_share >= FAIR_LOW_SHARE:
        fair.append(f"s. {n}: {round(low_share * 100)} % slov přečteno s nízkou jistotou")

    if wordlist is not None:
        alpha = _alpha_tokens(text)
        unknown = sum(t.lower() not in wordlist for t in alpha)
        share = unknown / len(alpha) if alpha else 0.0
        metrics["unknown_share"] = round(share, 3)
        if share > POOR_UNKNOWN_SHARE:
            poor.append(f"s. {n}: {round(share * 100)} % slov není česky ani lékařsky srozumitelných")
    else:
        metrics["unknown_share"] = None

    risky_count = sum(risky(t) for t in text.split())
    metrics["risky_tokens"] = risky_count
    if second_reading and verify is not None:
        # Low-confidence marks are counted by the confidence rules already; this counts the two readings' disagreements.
        marked = sum(1 for v in verify if v.get("reason") != "low_conf")
        share = marked / risky_count if risky_count else 0.0
        metrics["verify_share"] = round(share, 3)
        if risky_count >= VERIFY_MIN_RISKY:
            if second_reading == "vision" and share > POOR_VERIFY_SHARE:
                poor.append(f"s. {n}: {round(share * 100)} % čísel a stadií se v obou čteních liší")
            elif second_reading == "text_layer" and share > FAIR_LAYER_VERIFY_SHARE:
                fair.append(f"s. {n}: {round(share * 100)} % čísel a stadií se liší od textové vrstvy PDF")
    else:
        metrics["verify_share"] = None

    hits = damage_hits(text)
    metrics["damage"] = {k: len(v) for k, v in hits.items()}
    for code, _, desc in DAMAGE:
        for tok in sorted(set(hits.get(code, [])))[:3]:  # three examples per pattern keep the list readable
            fair.append(f"s. {n}: " + desc.format(tok=tok))

    level = "poor" if poor else "fair" if fair else "good"
    return {"level": level, "reasons_cs": poor + fair, "metrics": metrics}


def worst(levels: list[str]) -> str:
    return max(levels, key=LEVELS.index) if levels else "empty"


def document(pages: list[dict]) -> dict:
    """The document level is its worst page; poor or empty raises the request for a better copy."""
    level = worst([p["level"] for p in pages])
    reasons = [r for p in pages for r in p["reasons_cs"]]
    if level in ("poor", "empty"):
        bad = ", ".join(str(p["n"]) for p in pages if p["level"] in ("poor", "empty"))
        reasons.insert(0, f"Dokument je špatně čitelný, vyžádejte lepší kopii (s. {bad})")
    return {"level": level, "reasons_cs": reasons}
