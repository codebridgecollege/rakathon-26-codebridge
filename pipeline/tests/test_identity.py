"""Identity check per document on the synthetic samples (S01-S04) and FNO's synthetic patients."""

import json
import re

import pytest

from conftest import PAGES, REPO
from page_reader import identity

SAMPLES = REPO / "samples/derived/pages"


def pages(d):
    return [{"n": int(re.search(r"\d+", p.name).group()), "text": p.read_text()}
            for p in sorted(d.glob("p*.tess.txt"), key=lambda p: int(re.search(r"\d+", p.name).group()))]


def s02_identity() -> dict:
    """S02's identity as its referral (a FHIR bundle) gives it: the Patient resource."""
    bundle = json.loads((REPO / "samples/S02_pacient/upload/zadost-fhir.json").read_text())
    pat = next(e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Patient")
    name = pat["name"][0]
    return {"name": " ".join(name["given"] + [name["family"]]), "birth_number": pat["identifier"][0]["value"],
            "birth_date": pat["birthDate"]}


S01 = {"name": "Radovan Křemínek", "birth_number": None, "birth_date": "1964-03-12"}
S04 = {"name": "Ludmila Vrbenská", "birth_number": "615203/1006", "birth_date": "1961-02-03"}


def test_s02_matches_its_referral():
    r = identity.check(pages(PAGES / "S02_pacient"), s02_identity())
    assert r["result"] == "matches" and all(p["result"] == "matches" for p in r["pages"])
    assert {e["field"] for e in r["evidence"]} == {"name", "birth_number", "birth_date"}


def test_s01_matches_by_name_without_a_birth_number():
    r = identity.check(pages(PAGES / "S01_pacient"), S01)
    assert r["result"] == "matches"
    assert {e["field"] for e in r["evidence"]} == {"name", "birth_date"}


def test_s01_text_against_s02_identity_conflicts():
    r = identity.check(pages(PAGES / "S01_pacient"), s02_identity())
    assert r["result"] == "conflicts" and all(p["result"] == "conflicts" for p in r["pages"])


def test_s04_foreign_page_conflicts():
    """S04 page 4 is another patient's CT (same surname, other given name and birth number)."""
    r = identity.check(pages(SAMPLES / "S04_pacient"), S04)
    assert r["result"] == "conflicts"
    assert {p["n"]: p["result"] for p in r["pages"]} == {1: "matches", 2: "matches", 3: "matches", 4: "conflicts",
                                                         5: "matches"}
    p4 = {(e["field"], e["result"]) for e in r["evidence"] if e["n"] == 4}
    assert ("birth_number", "conflicts") in p4 and ("name", "conflicts") in p4


def test_s03_poor_scan_still_matches():
    r = identity.check(pages(SAMPLES / "S03_pacient"),
                       {"name": "Bořivoj Klenovský", "birth_number": "571107/1003", "birth_date": "1957-11-07"})
    assert r["result"] == "matches"


def test_ocr_damaged_birth_number_is_not_a_conflict():
    """One misread digit always breaks the mod-11 check: cannot_verify, never conflicts."""
    text = (PAGES / "S02_pacient/p1.tess.txt").read_text().replace("585614/4019", "585614/4018")
    exp = dict(s02_identity(), name=None, birth_date=None)
    r = identity.check([{"n": 1, "text": text}], exp)
    assert r["result"] == "cannot_verify"
    assert [(e["field"], e["result"]) for e in r["evidence"]] == [("birth_number", "cannot_verify")]
    # With the name the page still matches: one identifier found, none conflicting.
    assert identity.check([{"n": 1, "text": text}], s02_identity())["result"] == "matches"
    # A valid number of someone else is a conflict.
    other = text.replace("585614/4018", "595418/1002")
    assert identity.check([{"n": 1, "text": other}], s02_identity())["result"] == "conflicts"


def test_evidence_has_offsets_and_kinds_never_values():
    text = (PAGES / "S02_pacient/p1.tess.txt").read_text()
    r = identity.check([{"n": 1, "text": text}], s02_identity())
    for e in r["evidence"]:
        assert set(e) == {"n", "start", "end", "field", "result"}
        assert e["field"] in ("name", "birth_number", "birth_date")
    bn = next(e for e in r["evidence"] if e["field"] == "birth_number")
    assert re.sub(r"\D", "", text[bn["start"]:bn["end"]]) == "5856144019"
    assert "585614" not in json.dumps(r) and "Lipensk" not in json.dumps(r)


def test_name_differing_only_in_diacritics_cannot_be_verified():
    """FNO patient 2's document prints "Kotěrova Jaroslava"; the patient list has "Jaroslava Kotěrová"."""
    r = identity.check(pages(PAGES / "2_pacient"), {"name": "Jaroslava Kotěrová", "birth_number": None, "birth_date": None})
    assert r["result"] == "cannot_verify"
    assert [(e["field"], e["result"]) for e in r["evidence"]] == [("name", "cannot_verify")]
    # Tesseract dropping the diacritics in a header field is the same case, not a conflict.
    r = identity.check([{"n": 1, "text": "Klenovsky Borivoj, nar. 7.11.1957"}],
                       {"name": "Bořivoj Klenovský", "birth_number": None, "birth_date": None})
    assert r["result"] == "cannot_verify"


def test_misread_name_letter_is_not_a_conflict():
    r = identity.check([{"n": 1, "text": "Klenovskv Bořivoj, nar. 7.11.1957, poj. 211"}],
                       {"name": "Bořivoj Klenovský", "birth_number": None, "birth_date": None})
    assert r["result"] == "cannot_verify"


def test_nothing_found_cannot_be_verified():
    """A header blacked out (as on FNO patient 10's scans): nothing to compare, never a match."""
    text = "Ambulantní vyšetření kontrolní\n\nMR mozku 14.9.2026: bez známek progrese.\n"
    r = identity.check([{"n": 1, "text": text}], {"name": "Daniel Poláček", "birth_number": "800101/1234",
                                                  "birth_date": "1980-01-01"})
    assert r == {"result": "cannot_verify", "pages": [{"n": 1, "result": "cannot_verify"}], "evidence": []}


def test_fno_forms_with_given_name_and_surname_fields():
    """FNO's consultation form puts the given name and the surname in two fields; patient 17's form swaps them."""
    assert identity.check(pages(PAGES / "11_pacient"), {"name": "Lenka Kabátová"})["result"] == "matches"
    assert identity.check(pages(PAGES / "17_pacient"), {"name": "Otakar Jelen"})["result"] == "matches"
    other = identity.check(pages(PAGES / "11_pacient"), {"name": "Lenka Nováková"})
    assert other["result"] == "conflicts"


@pytest.mark.parametrize("text", [
    "RA: matka Marie Nová, nar. 1940, karcinom prsu.",  # a relative in the history, not a header
    "Odesílající lékař: MUDr. Alena Brabcová",
    "Pacient poučen o povaze onemocnění.",
])
def test_other_people_in_the_text_are_no_conflict(text):
    r = identity.check([{"n": 1, "text": text}], {"name": "Bořivoj Klenovský", "birth_number": None, "birth_date": None})
    assert r["result"] == "cannot_verify"


def test_birth_number_check_digit():
    assert identity.birth_number_valid("5856144019") and identity.birth_number_valid("5954181002")
    assert not identity.birth_number_valid("5856144018")  # one digit off
    assert not identity.birth_number_valid("5813444019")  # month 34 is no month
    assert identity.birth_number_valid("475712123")  # nine digits, before 1954: no check digit
    # Old nine-digit numbers: a difference in one digit may be a misread, in two it is another number.
    exp = {"name": None, "birth_number": "475712/123", "birth_date": None}
    assert identity.check([{"n": 1, "text": "r.č. 475712/128"}], exp)["result"] == "cannot_verify"
    assert identity.check([{"n": 1, "text": "r.č. 475812/128"}], exp)["result"] == "conflicts"
    # A birth number written without the slash counts only after a label.
    exp10 = {"name": None, "birth_number": "585614/4019", "birth_date": None}
    assert identity.check([{"n": 1, "text": "RČ: 5856144019"}], exp10)["result"] == "matches"
    assert identity.check([{"n": 1, "text": "Číslo vzorku 5954181002"}], exp10)["result"] == "cannot_verify"
