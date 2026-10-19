"""Readability levels on the calibration pages and on synthetic damage."""

import re

import pytest

from conftest import PAGES
from page_reader import page_index as pi, readability as rd

LEVELS = {}  # page -> level, printed by test_report_levels


def all_pages():
    for doc in sorted(PAGES.iterdir()):
        for tsv in sorted(doc.glob("p*.tess.tsv"), key=lambda p: int(re.sub(r"\D", "", p.name.split(".")[0]))):
            yield doc, int(re.sub(r"\D", "", tsv.name.split(".")[0]))


def assess_page(doc, n):
    words = pi.tess_words(doc / f"p{n}.tess.tsv")
    text = (doc / f"p{n}.tess.txt").read_text()
    rec = pi.tesseract_page(n, [0, 0], text, words, (doc / f"p{n}.layer.txt").read_text())
    return rd.assess(n, words, text, rec["verify"], rec["second_reading"])


@pytest.mark.parametrize("doc,n", list(all_pages()), ids=lambda x: getattr(x, "name", x))
def test_calibration_pages(doc, n):
    r = assess_page(doc, n)
    LEVELS[f"{doc.name} p{n}"] = r["level"]
    for reason in r["reasons_cs"]:
        assert reason.startswith(f"s. {n}: ")
    if doc.name.startswith("S0"):
        assert r["level"] in ("good", "fair"), r  # our clean synthetic print is never poor
    if doc.name == "9_pacient" and n == 4:
        assert r["level"] == "empty"  # a blank back page
    else:
        assert r["level"] != "poor", r  # every calibration page is readable by eye
    if doc.name == "10_pacient" and n == 4:
        assert r["level"] in ("fair", "poor")  # step-6.md: patient 10 page 4 at least fair


def test_patient_10_page_3_marks_letter_o_in_range():
    r = assess_page(PAGES / "10_pacient", 3)
    assert any("[O" in x and "písmeno O" in x for x in r["reasons_cs"])
    assert r["metrics"]["damage"]["unit_slash_1"] > 0


def test_degraded_page_is_poor():
    words = pi.tess_words(PAGES / "S02_pacient/p5.tess.tsv")
    text = (PAGES / "S02_pacient/p5.tess.txt").read_text()
    # Every third word read with confidence 40, as on a faded scan.
    bad = [dict(w, c=40) if i % 3 == 0 else w for i, w in enumerate(words)]
    r = rd.assess(5, bad, text)
    assert r["level"] == "poor"
    assert any("s nízkou jistotou" in x for x in r["reasons_cs"])
    assert any("průměrná jistota" in x for x in r["reasons_cs"])


def test_damage_patterns_give_fair_with_reasons():
    words = [{"t": "x", "c": 95, "b": [0, 0, 1, 1]}] * 50
    text = ("Kontrola dne 1112023.\nStaging: pT2 NO MO, R0 resekce.\nDexamethason lmg denně.\n"
            "S_HSCRP: 9,5 mg/l [O ... 5]\nS_K: 4,1 mmol/1 [3.5 ... 5.1]\nr.č. 585614/4019, žádanka S02-260310-01\n"
            "eGFR 1,01 ml/s/1,73 m2")
    r = rd.assess(4, words, text)
    assert r["level"] == "fair"
    joined = "\n".join(r["reasons_cs"])
    assert "s. 4: data ve tvaru 1112023, ověřte v originálu" in r["reasons_cs"]
    assert "NO" in joined and "MO" in joined
    assert "lmg" in joined
    assert "[O" in joined
    assert "mmol/1" in joined
    # Not damage: a birth number, a requisition number, the eGFR unit.
    assert r["metrics"]["damage"].get("date_run") == 1
    assert r["metrics"]["damage"].get("unit_slash_1") == 1
    # A reason names the pattern and the damaged token only, never the sentence around it.
    assert "Kontrola" not in joined and "Dexamethason" not in joined


def test_no_tnm_context_no_tnm_hit():
    words = [{"t": "x", "c": 95, "b": [0, 0, 1, 1]}] * 50
    assert rd.assess(1, words, "PO kontrole doma.\nNO comment.")["level"] == "good"


def test_empty_and_document_level():
    assert rd.assess(2, [], "")["level"] == "empty"
    doc = rd.document([{"n": 1, "level": "good", "reasons_cs": []}, {"n": 2, "level": "poor", "reasons_cs": ["s. 2: x"]}])
    assert doc["level"] == "poor" and doc["reasons_cs"][0].startswith("Dokument je špatně čitelný, vyžádejte lepší kopii (s. 2)")


def test_report_levels():
    for k, v in LEVELS.items():
        print("readability", k, v)


def test_reasons_never_carry_glued_neighbours():
    words = [{"t": "x", "c": 95, "b": [0, 0, 1, 1]}] * 50
    r = rd.assess(1, words, "Novák1112023 kontrola\nRČ 902005 1234\nnar.1112023\nO2 maskou 2 l/min")
    joined = "\n".join(r["reasons_cs"])
    assert "Novák" not in joined and "902005" not in joined
    assert r["metrics"]["damage"].get("date_run") == 2  # both 1112023 runs; the reason shows the digits only
    assert "o_in_number" not in r["metrics"]["damage"]


def test_l_for_1_in_stages_and_doses():
    words = [{"t": "x", "c": 95, "b": [0, 0, 1, 1]}] * 50
    for text, code in (("Staging cTl N0 M0.", "tnm_letter_l"), ("cT2 Nl Ml", "tnm_letter_l"),
                       ("Karboplatina l0 mg/kg.", "l_in_dose"), ("Dexamethason l00 mg.", "l_in_dose")):
        r = rd.assess(1, words, text)
        assert r["level"] == "fair" and code in r["metrics"]["damage"], (text, r)
    # Not damage: a stage with digits, a flow in litres, an MRI sequence list (T tokens only).
    assert rd.assess(1, words, "cT1 N0 M0, kyslík 2 l/min\nT2, Flair, TI sag")["level"] == "good"


SAMPLES = PAGES.parents[2] / "samples/derived/pages"


@pytest.mark.parametrize("tok,kind", [
    ("Odbèr", "foreign_char"), ("Пациент", "foreign_char"), ("kpsmt", "no_vowel"), ("zdkptsa", "consonant_run"),
    ("ciSterny", "mixed_case"), ("ÚUŘEA", "impossible_seq"), ("mmolll", "impossible_seq"), ("ěvoda", "impossible_seq"),
    ("kl1nický", "letter_digit"),
])
def test_garbage_shapes(tok, kind):
    assert rd.garbage_tokens(tok) == (1, {kind: 1})


@pytest.mark.parametrize("tok", [
    "čtvrt", "smrt", "vlk", "Brno", "postschemické", "mmHg", "ypT2", "eGFR", "CodeBridge", "S_CREAE", "PDWSD",
    "biopsií", "onkologií", "intrakraniálně", "15x14x8mm", "Ki67", "stp", "mts", "Müller", "µmol", "zaangažovaný",
])
def test_czech_and_medical_tokens_are_not_garbage(tok):
    assert rd.garbage_tokens(tok)[1] == {}


def _calibration_texts():
    for d in [*sorted(PAGES.iterdir()), *sorted(SAMPLES.iterdir())]:
        for p in sorted(d.glob("p*.tess.txt")):
            yield f"{d.name}/{p.name}", p


@pytest.mark.parametrize("name,path", list(_calibration_texts()), ids=lambda x: x if isinstance(x, str) else "")
def test_garbage_share_on_calibration_pages(name, path):
    """Clean pages stay under the fair threshold; S03 p3 (the degraded lab sheet) reaches it."""
    judged, garbage = rd.garbage_tokens(path.read_text())
    share = sum(garbage.values()) / judged if judged else 0
    if name == "S03_pacient/p3.tess.txt":
        assert share >= rd.FAIR_GARBAGE_SHARE
    else:
        assert share < rd.FAIR_GARBAGE_SHARE, (name, garbage)


def test_s03_lab_sheet_gets_the_garbage_reason_without_tokens():
    d = SAMPLES / "S03_pacient"
    words = pi.tess_words(d / "p3.tess.tsv")
    text = (d / "p3.tess.txt").read_text()
    rec = pi.tesseract_page(3, [0, 0], text, words, (d / "p3.layer.txt").read_text())
    r = rd.assess(3, words, text, rec["verify"], rec["second_reading"])
    assert r["level"] == "poor"
    reason = [x for x in r["reasons_cs"] if "nevypadá jako česká" in x]
    assert reason == ["s. 3: 3 % slov nevypadá jako česká ani lékařská slova (nemožná spojení písmen)"]


def test_garbage_page_is_poor():
    """A page whose text is one token in five garbage (as a broken font map or a wrecked scan gives) is poor even
    when Tesseract is confident: the rule judges the text itself."""
    words = [{"t": "x", "c": 95, "b": [0, 0, 1, 1]}] * 50
    text = " ".join(["Pacientka přichází ke kontrole po chemoterapii"] * 4 + ["kpsmt ciSterny Odbèr zdkptsa"] * 3)
    r = rd.assess(1, words, text)
    assert r["level"] == "poor" and r["metrics"]["garbage_share"] > rd.POOR_GARBAGE_SHARE
    assert not any(t in "\n".join(r["reasons_cs"]) for t in ("kpsmt", "ciSterny", "Odbèr"))
    # One odd token is a typo or a rare name, not a reading problem.
    one = rd.assess(1, words, "Pacient Xkcdq přichází ke kontrole po chemoterapii.")
    assert one["level"] == "good"
