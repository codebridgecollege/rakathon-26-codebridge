"""Lab parser against the hand-checked labs_series of the synthetic patients and FNO's patient 10 printout."""

import pytest

from conftest import LAB_PAGES, PAGES, compare_with_mock, mock_labs, page_input
from pagekit import labs

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
    assert result["counts"]["points"] == 38 and len(result["unparsed"]) == 1  # 39 on the sheet, one listed
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
    assert second["certainty"] == "unclear_ocr" and "draw_date_unconfirmed" in second["verify_reasons"]
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
