"""Lab parser against the hand-checked labs_series of the synthetic patients and FNO's patient 10 printout."""

import re

import pytest

from conftest import LAB_PAGES, PAGES, compare_with_mock, mock_labs, page_input
from page_reader import labs

COUNTS = {}  # filled per source, printed at the end of the session by test_report


@pytest.mark.parametrize("patient", sorted(LAB_PAGES))
@pytest.mark.parametrize("engine", ["vision", "tesseract"])
def test_labs_equal_mock_or_unclear(patient, engine):
    pages = [page_input(patient, n, engine) for n in LAB_PAGES[patient]]
    result = labs.parse(pages, doc_id=f"{patient}.pdf")
    mock = mock_labs(patient)
    assert [d["date"] for d in result["draws"]] == [d["date"] for d in mock["draws"]]
    assert [d["time"] for d in result["draws"]] == [d["time"] for d in mock["draws"]]
    assert all(d["certainty"] == "documented" for d in result["draws"])
    counts = compare_with_mock(result, mock)
    COUNTS[(patient, engine)] = counts
    assert not result["unparsed"] and not result["indices"]
    assert len(result["tests"]) == len(mock["tests"]), [t["code"] for t in result["tests"]]
    if engine == "vision":
        # The vision Markdown is clean print and carries the sheet's bold: everything is documented and
        # equals the builders' output, including the out-of-range bold.
        assert counts["unclear_ocr"] == 0
        by = {(t["code"], p["source"]["page"]): p for t in result["tests"] for p in t["points"]}
        for t in mock["tests"]:
            for mp in t["points"]:
                p = by[(t["code"], mp["source"]["page"])]
                assert p["flagged_in_document"] == mp["flagged_in_document"]
                assert p["unit"] == t["unit"]
                assert p["source"]["quote"].replace("**", "") == mp["source"]["quote"]
    else:
        assert all(p["flagged_in_document"] is None for t in result["tests"] for p in t["points"])
        assert counts["documented"] > 0


def test_tesseract_misreads_are_unclear():
    pages = [page_input("S02_pacient", n, "tesseract") for n in LAB_PAGES["S02_pacient"]]
    result = labs.parse(pages, doc_id="S02_pacient.pdf")
    rows = {t["code"]: t for t in result["tests"]}
    # '10"9/|' for 10^9/l: shown as written, marked, both readings kept.
    lkc = rows["B_LKC"]["points"][0]
    assert lkc["unit"] == '10"9/|' and lkc["certainty"] == "unclear_ocr"
    assert lkc["readings"]["text_layer"].startswith("B_LKC: 7,42 10^9/l")
    assert lkc["code_as_written"] == "B LKC"
    # "S CA190" for S_CA199: filed under the code the layer has, and marked.
    ca = [p for p in rows["S_CA199"]["points"] if p["code_as_written"] == "S CA190"]
    assert ca and all("code_differs" in p["verify_reasons"] for p in ca)
    # "[O ... 5]" for [0 ... 5] on page 6: the range needed the look-alike map.
    cea = rows["S_CEA"]["points"][1]
    assert cea["reference_range"] == "O ... 5" and "confusable" in cea["verify_reasons"]
    # "umol/l" for µmol/l: no digit, so no clinical risk; documented, and the layer's reading is kept.
    crea = rows["S_CREAE"]["points"][0]
    assert crea["unit"] == "umol/l" and "readings" in crea


def test_fno_patient_10_page_3():
    page = page_input("10_pacient", 3, "tesseract")
    result = labs.parse([page], doc_id="10_pacient.pdf")
    # Sample-quality indices are kept apart and are not findings.
    assert [i["code"] for i in result["indices"]] == ["S_IDXLIPK", "S_IDXHEMK", "S_IDXIKTK"]
    assert all(i["kind"] == "sample_quality_index" for i in result["indices"])
    assert not any(t["code"].startswith("S_IDX") for t in result["tests"])
    # No "Odběr:" on the page: the draw date is a gap, never invented.
    assert len(result["draws"]) == 1
    d = result["draws"][0]
    assert d["date"] is None and d["datetime"] is None and "neuvedeno v dostupné dokumentaci" in d["date_note_cs"]
    assert all(p["date"] is None for t in result["tests"] for p in t["points"] if p)
    rows = {t["code"]: t["points"][0] for t in result["tests"]}
    # The layer's "[O ... 5]" against Tesseract's "[0 ... 5]": marked.
    assert "range_differs" in rows["S_HSCRP"]["verify_reasons"]
    assert rows["S_HSCRP"]["readings"]["text_layer"].endswith("[O ... 5]")
    # Tesseract's own "[O ... 0.05]" and "[O0 ... 4]": the look-alike map was needed.
    assert "confusable" in rows["LKC(B)_EOS"]["verify_reasons"]
    assert "confusable" in rows["B_NLR"]["verify_reasons"]
    # "g/1" in both readings is still a damaged unit.
    assert "unit_damaged" in rows["B_HB"]["verify_reasons"]
    # "SAALT: 0,48 ..." (S_ALT with the underscore read as A) does not parse and is listed, not dropped.
    assert "S_ALT" not in rows
    assert result["counts"]["points"] == 38  # 39 on the sheet, one listed twice: unparsed line, layer-only record
    assert [u["reason"] for u in result["unparsed"]] == ["lab_like_not_parsed", "only_second_reading"]
    assert result["unparsed"][1]["code"] == "S_ALT" and result["counts"]["only_second_reading"] == 1
    assert result["unparsed"] and result["unparsed"][0]["reason"] == "lab_like_not_parsed"
    text = page["text"]
    u = result["unparsed"][0]
    assert "SAALT" in text[u["start"]:u["end"]]
    # Records spanning a line break ("S URAT: 301\numol/1 [202 ... 417]") are parsed.
    assert rows["S_URAT"]["value"] == "301"
    COUNTS[("10_pacient p3", "tesseract")] = {k: result["counts"][k] for k in ("documented", "unclear_ocr")}


def test_cross_draw_unit_change_is_not_merged():
    a = {"n": 1, "text": "Odběr: 1.2.2026 07:00\nS_CREAE: 66 µmol/l [44 ... 80]", "layer_text": "Odběr: 1.2.2026 07:00\nS_CREAE: 66 µmol/l [44 ... 80]", "readability_level": "good", "engine": "vision"}
    b = {"n": 2, "text": "Odběr: 1.3.2026 07:00\nS_CREAE: 0,9 mg/dl [0.5 ... 1.1]", "layer_text": "Odběr: 1.3.2026 07:00\nS_CREAE: 0,9 mg/dl [0.5 ... 1.1]", "readability_level": "good", "engine": "vision"}
    result = labs.parse([a, b], doc_id="x")
    rows = [t for t in result["tests"] if t["code"] == "S_CREAE"]
    assert len(rows) == 2 and all("note_cs" in t for t in rows)
    assert all(p["certainty"] == "documented" for t in rows for p in t["points"] if p)


def test_no_second_reading_and_poor_page_are_unclear():
    text = "Odběr: 1.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]"
    r = labs.parse([{"n": 1, "text": text, "layer_text": "", "readability_level": "good", "engine": "vision"}], doc_id="x")
    p = r["tests"][0]["points"][0]
    assert p["certainty"] == "unclear_ocr" and "no_second_reading" in p["verify_reasons"]
    assert r["draws"][0]["certainty"] == "unclear_ocr"
    r = labs.parse([{"n": 1, "text": text, "layer_text": text, "readability_level": "poor", "engine": "vision"}], doc_id="x")
    assert r["tests"][0]["points"][0]["verify_reasons"] == ["page_poor"]


def test_report():
    """Not an assertion: prints the documented/unclear split per source (run with -s to see it)."""
    for k, v in sorted(COUNTS.items()):
        print("labs", k, v)


def _one(text, layer=None, engine="vision"):
    return labs.parse([{"n": 1, "text": text, "layer_text": text if layer is None else layer,
                        "readability_level": "good", "engine": engine}], doc_id="x")


def test_lost_draw_header_never_files_results_under_the_previous_date():
    good = "Odběr: 1.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]\nOdběr: 1.3.2026 07:00\nS_K: 5,9 mmol/l [3.5 ... 5.1]"
    misread = good.replace("Odběr: 1.3.2026", "Odbér: 1.3.2026")
    r = _one(misread, layer=good)
    second = [p for t in r["tests"] for p in t["points"] if p and p["value"] == "5,9"][0]
    # The misread header ends the first draw: 5,9 is not filed under 1.2.2026.
    assert second["certainty"] == "unclear_ocr" and "draw_date_unreadable" in second["verify_reasons"]
    assert second["date"] is None
    assert any(u["reason"] == "draw_date_not_parsed" for u in r["unparsed"])
    # Without a second reading of the headers, the dates are not confirmed either.
    r = _one(good, layer=good.replace("Odběr: 1.3.2026 07:00\n", ""))
    assert all("draw_date_unconfirmed" in p["verify_reasons"] for t in r["tests"] for p in t["points"] if p)


def test_unit_never_swallows_the_next_record_or_prose():
    r = _one("S_K: 4,1 mmol/l  S_CL 100 mmol/l [98 ... 107]")
    assert r["counts"]["points"] == 0 and r["unparsed"]
    r = _one("S_K: 4,1\nPoznámka hemolýza [0 ... 5]")
    assert r["counts"]["points"] == 0 and r["unparsed"]


def test_numeric_index_and_prose_are_not_findings():
    r = _one("S_IDXHEMK: 12 j [0 ... 50]\nPET CT: 4 cm [1 ... 2]")
    assert r["counts"]["points"] == 0
    assert [i["code"] for i in r["indices"]] == ["S_IDXHEMK"]
    assert r["unparsed"]  # the PET CT line is lab-like and listed


def test_detection_limit_is_not_plotted_and_missing_words_are_unclear():
    r = _one("Odběr: 1.2.2026 07:00\nS_CRP: <0,5 mg/l [0 ... 5]")
    t = r["tests"][0]
    assert t["values"] == [None] and t["points"][0]["out_of_range"] is None
    r = _one("Odběr: 1.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]", engine="tesseract")
    assert "conf_unknown" in r["tests"][0]["points"][0]["verify_reasons"]


def test_different_test_at_same_place_is_not_refiled():
    r = _one("Odběr: 1.2.2026 07:00\nS_MG: 0,9 mmol/l [0.7 ... 1.0]",
             layer="Odběr: 1.2.2026 07:00\nS_NA: 0,9 mmol/l [0.7 ... 1.0]")
    assert [t["code"] for t in r["tests"]] == ["S_MG"]
    assert "code_differs" in r["tests"][0]["points"][0]["verify_reasons"]


def test_unparsable_header_ends_the_draw():
    layer = "Odběr: 9.3.2026 07:00\nS_NA: 140 mmol/l [136 ... 145]\nOdběr: 15.3.2026 07:00\nS_NA: 150 mmol/l [136 ... 145]"
    for tor, lay in ((layer.replace("Odběr: 15", "Odbér: 15"), layer.replace("Odběr: 15", "Odbèr: 15")),
                     (layer.replace("Odběr: 15", "Odbér: 15"), layer)):
        r = _one(tor, layer=lay)
        pts = {p["value"]: p for t in r["tests"] for p in t["points"] if p}
        assert pts["140"]["date"] == "2026-03-09"
        assert pts["150"]["date"] is None and pts["150"]["certainty"] == "unclear_ocr"
        assert "draw_date_unreadable" in pts["150"]["verify_reasons"]
        assert any(u["reason"] == "draw_date_not_parsed" for u in r["unparsed"])
        notes = [d.get("date_note_cs") for d in r["draws"]]
        assert "Datum odběru nečitelné, ověřte v originálu." in notes
        assert not any("neuvedeno" in (x or "") for x in notes)


def test_record_only_in_second_reading_is_listed():
    full = "Odběr: 1.2.2026 07:00\nS_NA: 140 mmol/l [136 ... 145]\nS_K: 6,9 mmol/l [3.5 ... 5.1]"
    r = _one(full.replace("S_K: 6,9 mmol/l [3.5 ... 5.1]", ""), layer=full)
    only = [u for u in r["unparsed"] if u["reason"] == "only_second_reading"]
    assert len(only) == 1 and only[0]["code"] == "S_K" and only[0]["quote"] == "S_K: 6,9 mmol/l [3.5 ... 5.1]"
    assert only[0]["in"] == "text_layer" and r["counts"]["only_second_reading"] == 1 and only[0]["reason_cs"]


def test_impossible_date_misread_time_and_continuation_page():
    r = _one("Odběr: 31.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]")
    p = r["tests"][0]["points"][0]
    assert p["date"] is None and "draw_date_unreadable" in p["verify_reasons"]
    assert r["draws"][0]["date_note_cs"] == "Datum odběru nečitelné, ověřte v originálu."
    r = _one("Odběr: 1.2.2026 07:2O\nS_K: 4,1 mmol/l [3.5 ... 5.1]")
    p, d = r["tests"][0]["points"][0], r["draws"][0]
    assert p["date"] == "2026-02-01" and p["time"] is None and "draw_time_unreadable" in p["verify_reasons"]
    assert d["datetime"] == "2026-02-01" and "None" not in d["datetime"]
    r = _one("Odběr: 1.2.2026\nS_K: 4,1 mmol/l [3.5 ... 5.1]")
    assert r["draws"][0]["datetime"] == "2026-02-01" and r["draws"][0]["time"] is None
    p1 = {"n": 1, "text": "Odběr: 1.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]", "readability_level": "good", "engine": "vision"}
    p2 = {"n": 2, "text": "S_NA: 140 mmol/l [136 ... 145]", "readability_level": "good", "engine": "vision"}
    for pg in (p1, p2):
        pg["layer_text"] = pg["text"]
    r = labs.parse([p1, p2], doc_id="x")
    na = [p for t in r["tests"] if t["code"] == "S_NA" for p in t["points"] if p][0]
    assert na["date"] is None and "draw_on_previous_page" in na["verify_reasons"]
    assert "Datum odběru je na předchozí straně; ověřte v originálu." in [d.get("date_note_cs") for d in r["draws"]]


def test_missing_readability_level_is_not_readable():
    text = "Odběr: 1.2.2026 07:00\nS_K: 4,1 mmol/l [3.5 ... 5.1]"
    r = labs.parse([{"n": 1, "text": text, "layer_text": text, "engine": "vision"}], doc_id="x")
    assert r["tests"][0]["points"][0]["verify_reasons"] == ["readability_unknown"]


def test_flag_letter_is_kept_apart_from_the_unit():
    r = _one("Odběr: 1.2.2026 07:00\nS_K: 5,8 H mmol/l [3.5 ... 5.1]")
    p = r["tests"][0]["points"][0]
    assert p["unit"] == "mmol/l" and p["flag_as_written"] == "H" and p["flagged_in_document"] is True
    assert p["out_of_range"] == "high"


SAMPLES = PAGES.parents[2] / "samples/derived/pages"


def test_s03_urea_line_is_listed_not_dropped():
    """S03's scan reads S_UREA as ". S. ÚUŘEA: 7,9 mmolll (2.9. 82:": Czech capitals in the code, "(" for "[" and
    the range dots lost. No record parses it, and it must be listed, never dropped."""
    text = (SAMPLES / "S03_pacient/p3.tess.txt").read_text()
    _, _, spans = labs.parse_text(text)
    quotes = [text[u["start"]:u["end"]] for u in labs.unparsed_lines(text, spans) if u["reason"] == "lab_like_not_parsed"]
    assert any("ÚUŘEA" in q for q in quotes), quotes


@pytest.mark.parametrize("line", [
    ". S. ÚUŘEA: 7,9 mmolll (2.9. 82:",  # S03: Czech capitals, "(" and one dot
    "S UREA 7,9 mmol/l",  # colon and range lost
    "- B „LKC 8,24 10*9/l (4 ... 10",  # a quote mark for the underscore, round bracket, no colon
    "S_ALB 41,2 g/l",  # an NČLP code with its underscore, colon and range lost
    "U_BIL: negat",  # a qualitative value RECORD does not take
    "S. ŠODIK: 139 mmol/l",  # a misread code with a Czech capital, range lost
])
def test_lab_like_lines_are_listed(line):
    text = f"Odběr: 1.2.2026 07:00\n{line}\n"
    records, _, spans = labs.parse_text(text)
    assert not records
    assert [u["reason"] for u in labs.unparsed_lines(text, spans)] == ["lab_like_not_parsed"]


@pytest.mark.parametrize("line", [
    "CEA 9,6 ug/l, CA 19-9 27,8 kU/I, Hb 124 g/l",  # lab values quoted in a letter (stage 9 reads them)
    "KPS 80 %, ECOG 1. Výška 178 cm, hmotnost 84 kg",
    "Do 2. linie léčby indikován sunitinib 50mg denně",
    "Pacient přijat (10.3.2026) k operaci.",
    "Intrakraniální průběh AC;I bez změny",
])
def test_prose_is_not_lab_like(line):
    _, _, spans = labs.parse_text(line)
    assert labs.unparsed_lines(line, spans) == []


CODE_LINE = re.compile(r"^[\W_]{0,4}[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{1,5}[ _.\-„]{1,4}[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{2,}\W{0,3}\d")


def test_no_lab_line_vanishes_on_the_calibration_pages():
    """Sweep: every line of a lab sheet in data/derived and samples/derived that starts with a code and a number
    (as the sheets print a result) is parsed or listed. This is the class of S03's dropped S_UREA."""
    missed = []
    for d in [*PAGES.iterdir(), *SAMPLES.iterdir()]:
        for p in d.glob("p*.tess.txt"):
            text = p.read_text()
            if not labs.DRAW_LIKE.search(text):
                continue  # not a lab sheet
            _, _, spans = labs.parse_text(text)
            listed = {u["line_no"] for u in labs.unparsed_lines(text, spans)}
            covered = bytearray(len(text))
            for s, e in spans:
                covered[s:e] = b"\x01" * (e - s)
            pos = 0
            for no, line in enumerate(text.split("\n"), 1):
                rest = "".join(" " if covered[pos + k] else ch for k, ch in enumerate(line)).strip()
                pos += len(line) + 1
                if no not in listed and CODE_LINE.search(rest):
                    missed.append((d.name, p.name, no))
    assert not missed, missed
