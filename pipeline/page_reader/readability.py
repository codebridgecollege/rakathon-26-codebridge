"""Reading certainty of a page, judged from the text itself (CLAUDE.md, "Check that a document is readable").

Not from whether a text layer exists: FNO's text layers are poor OCR. Levels, worst first:

- empty: fewer than MIN_WORDS words read.
- poor: mean word confidence below POOR_MEAN_CONF; more than POOR_LOW_SHARE of words below LOW_CONF;
  more than POOR_UNKNOWN_SHARE of alphabetic tokens of 4+ letters in no word list (only when a word list
  is configured, see below); more than POOR_VERIFY_SHARE of risky tokens (digits, stages) marked "ověřit"
  when the second reading is the vision model; more than POOR_GARBAGE_SHARE of tokens with a shape no Czech
  or medical word has (garbage_tokens, no word list needed); unreadable regions (ink with no confidently
  read words, such as handwriting) covering more than POOR_UNREADABLE_SHARE of the page.
- fair: FAIR_LOW_SHARE or more of words below LOW_CONF; more than FAIR_LAYER_VERIFY_SHARE of risky tokens
  marked "ověřit" when the second reading is the PDF text layer; any OCR damage pattern (DAMAGE below);
  FAIR_GARBAGE_SHARE or more of garbage-shaped tokens; any unreadable region.
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
# Tokens with a shape no Czech or medical word has (garbage_tokens below), as a share of the tokens of three or
# more letters. Calibration (Tesseract 5.5.3, ces, psm 4; 2026-10-19): on the 35 pages of data/derived and the
# 8 readable-by-eye pages of samples/derived (S04, S03 p2) at most one such token per page, 0.8 % at most
# (13_pacient p2, "gr.lll" for "gr. III"); 0 on all 40 vision readings; at most 1.3 % on the PDF text layers,
# FNO's broken font maps included. S03 p3, the deliberately degraded lab sheet, reaches 2.7 % ("ÚUŘEA",
# "mmolll"), so 2 % gives "fair" there and on nothing clean. No calibration page comes near "poor"; 10 % is a
# page where one token in ten is garbage, which no reader would call readable (tested on synthetic text).
FAIR_GARBAGE_SHARE = 0.02
POOR_GARBAGE_SHARE = 0.10
GARBAGE_MIN_COUNT = 2  # one odd token is a typo or a rare name, not a reading problem
# Unreadable regions (redact.unreadable_regions: ink with no confidently read word). Any region makes a page fair:
# what is written there is not in the text. Calibration (2026-10-19): no region on any of the 35 pages of
# data/derived or the 8 pages of S03 and S04, none of which carries a signature, stamp or handwriting. Regions
# over a tenth of the page are more than a signature or a stamp (a signature is about 1 % of an A4 page): a
# handwritten paragraph, so the page is poor.
POOR_UNREADABLE_SHARE = 0.10

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
    # "cTl N0 M0", "Nl Ml": l or I for 1 in a stage; only on a line with two stage tokens, one of them N or M.
    ("tnm_letter_l", re.compile(r"(?<![A-Za-zÀ-ž0-9])y?[cp]?[TNM][lI][a-d]?(?![A-Za-zÀ-ž0-9])"),
     "stadium ve tvaru {tok} (písmeno l/I místo jedničky), ověřte v originálu"),
    # "l0 mg/kg", "l00 mg", "1l0 mg", "10l mg": l or I as a leading or inner digit of a dose.
    ("l_in_dose", re.compile(r"(?<![A-Za-zÀ-ž])[lI][\dOlI]+(?:[.,]\d+)?\s?(?:mg|g|ml|mmol|µg|ug|IU|j|Gy)\b"
                             r"|\d+[lI][\dlI]*\s?(?:mg|g|ml|mmol|µg|ug|IU|j|Gy)\b"),
     "dávka ve tvaru {tok} (písmeno l/I místo jedničky), ověřte v originálu"),
    # "[O ... 5]", "[O0 ... 4]", "1O5": the letter O inside a number or a reference range.
    # Not "O2" (oxygen) on its own: only O next to a digit run or a decimal sign counts.
    ("o_in_number", re.compile(r"\[\s*O|O\s*\.{2,3}|\.{2,3}\s*O\b|(?<=\d)O|(?<![A-Za-zÀ-ž])O(?=[.,]\d)"),
     "číslo nebo rozmezí ve tvaru {tok} (písmeno O místo nuly), ověřte v originálu"),
    # "mmol/1", "g/1": a unit ending in /1 where /l is printed. "ml/s/1,73 m2" (eGFR) is a real unit.
    ("unit_slash_1", re.compile(r"(?:(?<![A-Za-zÀ-ž])[A-Za-zµ]{1,4}|\d)/1(?![\d,.])"),
     "jednotka ve tvaru {tok} (jednička místo l), ověřte v originálu"),
)
TNM_CONTEXT = re.compile(r"(?<![A-Za-z])(?:y?[cp]?T(?:[0-4]|is|x|X)|TNM|stadi|staging|resek|okraj|R[0-2]\b|odpově|regrese)", re.I)
# A stage-like token, also misread ("T2", "cN0", "Ml", "MO"): two on one line make a TNM context.
TNM_TOKENS = re.compile(r"(?<![A-Za-zÀ-ž0-9])(?:y?[cp]?[TNM](?:[0-4]|[lIOxX]|is)[a-d]?)(?![A-Za-zÀ-ž0-9])")
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
            # An N or M token is required: a line of T-only tokens is an MRI sequence list ("T2, TI sag").
            stage = TNM_TOKENS.findall(line)
            if code == "tnm_letter_l" and (len(stage) < 2 or not any(re.search(r"[NM]", t) for t in stage)):
                continue
            for m in rx.finditer(line):
                hits.setdefault(code, []).append(_tok(m))
    return hits


def _alpha_tokens(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]{4,}", text)


# ---------- tokens that are neither Czech nor medical, without a word list ----------
# The word-list rule above needs hunspell-cs, which neither the container nor the scripts have. These shape rules
# need none: each describes a letter sequence that Czech words, Latin terms, codes and units do not form, so a
# token that has one is an OCR misread. They catch character-level garbage only; a misread that still looks like
# a word (S03's "opnotamém" for "adenokarcinom", "PLUTO" for "PLT") passes them, and only the confidence rules,
# a word list or a vision reading can catch it.
_V = "aeiouyáéěíóúůý"
_LOWER = "a-záčďéěíňóřšťúůýž"
_UPPER = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"
# Letters a Czech medical text uses: the Czech alphabet, the German umlauts and ß of drug, place and person
# names, and the micro sign of units. Tesseract's Czech model can still emit others ("Odbèr").
_LETTERS_OK = set("abcdefghijklmnopqrstuvwxyzáčďéěíňóřšťúůýžäöüßµ")
# The one common unit with a capital between small letters; every other case pattern below holds without it.
_CASE_EXCEPTIONS = {"mmHg"}
GARBAGE_KINDS = {
    # "Odbèr", Cyrillic or Greek look-alikes: a letter outside the Czech and Latin alphabets.
    "foreign_char": "znaky mimo českou abecedu",
    # "kpsm": four or more small letters without a vowel, and no syllabic r or l between consonants as in "vlk",
    # "smrt", "čtvrt". Lower case only: abbreviations of three letters ("stp", "mts", "cps") and capital codes
    # ("PDWSD") are common in the reports.
    "no_vowel": "slova bez samohlásky",
    # Five consonants in a row other than r and l, counting "ch" as one: Czech stops at four ("postschemické"
    # has s-t-s-ch). Not in capital codes.
    "consonant_run": "dlouhé řady souhlásek",
    # "ciSterny", "kipIcká": a capital between small letters in a word that starts small. Brand names start
    # with a capital ("CodeBridge") and stages and units have the small letters first ("ypT2", "eGFR").
    "mixed_case": "velká písmena uvnitř slova",
    # Sequences Czech spelling never has: "ě" or "ů" at the start of a word, "ě" after a vowel, "ů" before a
    # vowel, a long and a short form of one vowel side by side ("ÚUŘEA" for "UREA"), and one small letter
    # three times ("mmolll", "Vlll" for VIII).
    "impossible_seq": "nemožná spojení písmen",
    # "kl1nický", "1tb1l": a digit between small letters. Not "x" ("15x14x8mm" is a size) and not a digit at
    # either end, so "ypT2", "m2" and "Ki67" stay.
    "letter_digit": "číslice uprostřed slova",
}
_GARBAGE_RX = {
    "impossible_seq": re.compile(f"^[ůěŮĚ]|[{_V}]ě|ů[{_V}]|ÚU|úu|ÁA|áa|ÉE|ée|ÍI|íi|ÝY|ýy|([{_LOWER}])\\1\\1"),
    "mixed_case": re.compile(f"[{_LOWER}][{_UPPER}][{_LOWER}]"),
    "letter_digit": re.compile(r"[a-wyzá-ž]\d+[a-wyzá-ž]"),
    "no_vowel_ok": re.compile(f"[{_V}]|[^{_V}][rl](?:[^{_V}]|$)"),
    "consonants": re.compile(r"[bcčdďfghjkmnňpqsštťvwxzž]+"),
}
GARBAGE_MIN_LETTERS = 3  # one- and two-letter tokens ("mg", "pH", "kU") are too short to judge by shape


def garbage_tokens(text: str) -> tuple[int, dict[str, int]]:
    """Tokens of the page (runs of letters and digits, GARBAGE_MIN_LETTERS letters or more) and, per kind, how
    many of them have a shape no Czech or medical word has. Counts only, never the tokens."""
    tokens = [t for t in re.findall(r"[^\W_]+", text) if sum(c.isalpha() for c in t) >= GARBAGE_MIN_LETTERS]
    counts: dict[str, int] = {}
    for t in tokens:
        low = t.lower()
        kinds = []
        if any(c.isalpha() and c not in _LETTERS_OK for c in low):
            kinds.append("foreign_char")
        if t.isalpha() and t.islower() and len(t) >= 4 and not _GARBAGE_RX["no_vowel_ok"].search(low):
            kinds.append("no_vowel")
        if t.isalpha() and not t.isupper():
            runs = _GARBAGE_RX["consonants"].findall(low.replace("ch", "h"))
            if runs and max(map(len, runs)) >= 5:
                kinds.append("consonant_run")
        if t[:1].islower() and t not in _CASE_EXCEPTIONS and _GARBAGE_RX["mixed_case"].search(t):
            kinds.append("mixed_case")
        if _GARBAGE_RX["impossible_seq"].search(t):
            kinds.append("impossible_seq")
        if _GARBAGE_RX["letter_digit"].search(t):
            kinds.append("letter_digit")
        for k in kinds[:1]:  # a token counts once, under its first kind
            counts[k] = counts.get(k, 0) + 1
    return len(tokens), counts


def assess(n: int, words: list[dict], text: str, verify: list[dict] | None = None,
           second_reading: str | None = None, wordlist: set[str] | None = None,
           unreadable: list[dict] | None = None, size: list[int] | None = None) -> dict:
    """The reading certainty of page n: {level, reasons_cs, metrics}.

    words are Tesseract's words ({t, c, b}), text the text of record, verify the page's "ověřit" items,
    second_reading what they were checked against: "text_layer", "vision", or None for no second reading.
    unreadable are the page's unreadable regions ({"b", "reason"}, redact.unreadable_regions) and size the
    [w, h] of the page image they are measured on; None when the page image was not looked at."""
    confs = [w["c"] for w in words]
    count = len(confs)
    metrics: dict = {"word_count": count}
    regions_reason, regions_share = _unreadable(n, unreadable, size, metrics)
    if count < MIN_WORDS:
        # A page of handwriting alone is "empty" of read text, but the doctor is told there is ink on it.
        return {"level": "empty", "reasons_cs": [f"s. {n}: na stránce není čitelný text"] + regions_reason,
                "metrics": metrics}

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

    judged, garbage = garbage_tokens(text)
    bad = sum(garbage.values())
    g_share = bad / judged if judged else 0.0
    metrics.update(garbage_share=round(g_share, 3), garbage=garbage)
    if bad >= GARBAGE_MIN_COUNT:
        # The reason names the patterns and the share, never a token: a misread name is still a name.
        what = ", ".join(GARBAGE_KINDS[k] for k in GARBAGE_KINDS if k in garbage)
        reason = f"s. {n}: {round(g_share * 100)} % slov nevypadá jako česká ani lékařská slova ({what})"
        if g_share > POOR_GARBAGE_SHARE:
            poor.append(reason)
        elif g_share >= FAIR_GARBAGE_SHARE:
            fair.append(reason)

    risky_count = sum(risky(t) for t in text.split())
    metrics["risky_tokens"] = risky_count
    if second_reading and verify is not None:
        # Low-confidence marks are counted by the confidence rules already; this counts the two readings' disagreements.
        # Unreadable-region marks are counted by the region rule below.
        marked = sum(1 for v in verify if v.get("reason") not in ("low_conf", "unreadable"))
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

    if regions_reason:
        (poor if regions_share > POOR_UNREADABLE_SHARE else fair).extend(regions_reason)

    level = "poor" if poor else "fair" if fair else "good"
    return {"level": level, "reasons_cs": poor + fair, "metrics": metrics}


def _unreadable(n: int, regions: list[dict] | None, size: list[int] | None, metrics: dict) -> tuple[list[str], float]:
    """The reason for the page's unreadable regions (none when there are none) and the share of the page they
    cover. The reason names the page and the count only; what is in a region is never read or guessed."""
    if regions is None:
        metrics.update(unreadable_regions=None, unreadable_share=None)
        return [], 0.0
    area = size[0] * size[1] if size and size[0] and size[1] else 0
    share = sum(r["b"][2] * r["b"][3] for r in regions) / area if area else 0.0
    metrics.update(unreadable_regions=len(regions), unreadable_share=round(share, 3))
    if not regions:
        return [], 0.0
    if len(regions) == 1:
        return [f"s. {n}: oblast, kterou nelze přečíst (např. rukopis, podpis nebo razítko)"], share
    word = "oblasti" if len(regions) < 5 else "oblastí"
    return [f"s. {n}: {len(regions)} {word}, které nelze přečíst (např. rukopis, podpis nebo razítko)"], share


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
