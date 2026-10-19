"""Unreadable regions: ink with no confidently read word (handwriting, signatures, stamps), on synthetic scribbles
drawn with Pillow over our clean print, and on the calibration pages, where there is none."""

import re

import pytest
from PIL import Image, ImageDraw

from conftest import PAGES, REPO
from page_reader import page_index as pi, readability as rd, redact

S02_P5 = PAGES / "S02_pacient"  # page 5 is a lab sheet with blank paper below the results


def _scribble(img, x=150, y=1350, w=500, rows=3):
    """Handwriting-like lines (150 dpi): a stroke 3 px wide going up and down 40 px every 12 px, as cursive
    letters do, with 55 px from one line to the next. The box is x, y, w, rows * 55 - 15."""
    draw = ImageDraw.Draw(img)
    for row in range(rows):
        yy = y + row * 55
        pts = [(x + k * 12, yy + (40 if k % 2 else 0)) for k in range(w // 12 + 1)]
        draw.line(pts, fill=0, width=3)
    return img


def _page():
    img = Image.open(S02_P5 / "p5.png").convert("L")
    return img, pi.tess_words(S02_P5 / "p5.tess.tsv")


def test_clean_page_has_no_region():
    img, words = _page()
    assert redact.unreadable_regions(img, words) == []


def test_scribble_is_a_no_text_region():
    img, words = _page()
    regions = redact.unreadable_regions(_scribble(img), words)
    assert len(regions) == 1 and regions[0]["reason"] == "no_text"
    x, y, w, h = regions[0]["b"]
    # The three lines are one region: x 150 to 642 (the last stroke point), y 1350 to 1350 + 2 * 55 + 40.
    assert x <= 150 and y <= 1350 and x + w >= 636 and y + h >= 1492  # boxes are found at quarter size: 4 px steps


def test_low_confidence_guess_over_a_scribble_is_low_conf():
    img, words = _page()
    guess = {"t": "Kkhl", "c": 23, "b": [300, 1400, 120, 30]}  # what Tesseract makes of handwriting
    regions = redact.unreadable_regions(_scribble(img), words + [guess])
    assert [r["reason"] for r in regions] == ["low_conf"]
    # A word Tesseract is sure of explains its ink: that is print, not an unreadable region.
    sure = [dict(w, c=95) for w in words]
    assert redact.unreadable_regions(Image.open(S02_P5 / "p5.png").convert("L"), sure) == []


def test_ink_marks_are_unchanged_by_the_shared_detection():
    """ink_marks (redaction) and unreadable_regions share the ink detection; ink_marks still blacks out each line
    of the note on its own, and every one lies inside the one joined unreadable region."""
    img, words = _page()
    img = _scribble(img)
    hits = redact.ink_marks(img, words)
    (region,) = redact.unreadable_regions(img, words)
    assert len(hits) == 3 and all(h["reason"].startswith("podpis") for h in hits)
    assert all(redact._within(h["box"], region["b"]) for h in hits)


def _calibration_pages():
    for d in sorted(PAGES.iterdir()):
        for png in sorted(d.glob("p*.png")):
            if re.fullmatch(r"p\d+\.png", png.name):
                yield d.name, png


@pytest.mark.parametrize("doc,png", list(_calibration_pages()), ids=lambda x: getattr(x, "name", x))
def test_calibration_pages_have_no_region(doc, png):
    """Ordinary print is never flagged: none of the 35 pages of data/derived has a region (2026-10-19)."""
    words = pi.tess_words(png.with_name(png.name.replace(".png", ".tess.tsv")))
    assert redact.unreadable_regions(Image.open(png), words) == []


def test_words_in_a_region_are_marked_and_the_page_is_fair():
    img, words = _page()
    text = (S02_P5 / "p5.tess.txt").read_text()
    regions = redact.unreadable_regions(_scribble(img), words)
    # The words of the first result line, as if they sat in the region: they get "ověřit" with reason unreadable.
    first = next(w for w in words if w["t"].startswith("B_LKC") or w["t"].startswith("B"))
    region = {"b": [first["b"][0] - 2, first["b"][1] - 2, first["b"][2] + 4, first["b"][3] + 4], "reason": "low_conf"}
    rec = pi.tesseract_page(5, list(img.size), text, words, (S02_P5 / "p5.layer.txt").read_text())
    before = len(rec["verify"])
    pi.mark_unreadable(rec, regions + [region])
    assert rec["unreadable"] == regions + [region]
    marked = [v for v in rec["verify"] if v["reason"] == "unreadable"]
    assert marked and all(text[v["start"]:v["end"]] == v["tess"] for v in marked)
    assert len(rec["verify"]) == before + len(marked)
    assert [v["start"] for v in rec["verify"]] == sorted(v["start"] for v in rec["verify"])
    r = rd.assess(5, words, text, rec["verify"], rec["second_reading"], unreadable=rec["unreadable"], size=list(img.size))
    assert r["level"] in ("fair", "poor") and r["metrics"]["unreadable_regions"] == 2
    reason = [x for x in r["reasons_cs"] if "nelze přečíst" in x]
    assert reason == ["s. 5: 2 oblasti, které nelze přečíst (např. rukopis, podpis nebo razítko)"]
    # Unreadable marks do not count as disagreements of the two readings.
    plain = rd.assess(5, words, text, [v for v in rec["verify"] if v["reason"] != "unreadable"], rec["second_reading"])
    assert r["metrics"]["verify_share"] == plain["metrics"]["verify_share"]


def test_region_reasons_and_levels():
    words = [{"t": "slovo", "c": 95, "b": [0, 0, 10, 10]}] * 50
    text = "Ambulantní zpráva pacienta, kontrola po léčbě. " * 10
    good = rd.assess(2, words, text, unreadable=[], size=[1240, 1755])
    assert good["level"] == "good" and good["metrics"]["unreadable_regions"] == 0
    one = rd.assess(2, words, text, unreadable=[{"b": [100, 1500, 300, 120], "reason": "no_text"}], size=[1240, 1755])
    assert one["level"] == "fair"
    assert one["reasons_cs"] == ["s. 2: oblast, kterou nelze přečíst (např. rukopis, podpis nebo razítko)"]
    # Handwriting over a fifth of the page: poor, a better copy (or a typed version) is needed.
    big = rd.assess(2, words, text, unreadable=[{"b": [100, 300, 1000, 450], "reason": "low_conf"}], size=[1240, 1755])
    assert big["level"] == "poor"
    # Not looked at (no page image): no rule, and the metrics say so.
    unknown = rd.assess(2, words, text)
    assert unknown["metrics"]["unreadable_regions"] is None and unknown["level"] == "good"


def test_handwriting_only_page_is_empty_with_the_region_reason():
    r = rd.assess(1, [], "", unreadable=[{"b": [100, 100, 900, 1200], "reason": "no_text"}], size=[1240, 1755])
    assert r["level"] == "empty"
    assert any("nelze přečíst" in x for x in r["reasons_cs"])


def test_scripts_do_not_use_the_region_rule():
    """scripts/ reproduce data/derived byte for byte; the region rule lives only in the container's path."""
    for script in (REPO / "scripts").glob("*.py"):
        assert "unreadable_regions" not in script.read_text(), script
