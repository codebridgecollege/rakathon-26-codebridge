"""Build fixtures/data/mock-case-S02.json from the synthetic patient S02 (samples/S02_pacient).

Usage: python3 fixtures/extract/build_case_s02.py  (after scripts/render_samples.py and scripts/ocr_pages.py)

Same checks as build_case_s01.py: every quote is verbatim in the page's vision text and, up to line wrapping,
in the PDF text layer; every lab value's out-of-range flag matches the bold print, and every test keeps one unit
and one reference range across draws. S02 is the intake demo patient: the presenter imports the FHIR referral
(samples/S02_pacient/upload/zadost-fhir.json, embedded here as fhir_referral) and uploads one PDF per document,
so each document names its upload file and the case stays hidden until it is created via "Nový pacient".
"""
import json, re
from pathlib import Path
R = Path(__file__).resolve().parents[2]  # repository root
D = R / "data/derived/pages/S02_pacient"
UP = R / "samples/S02_pacient/upload"
F = "S02_pacient.pdf"
PAGES = range(1, 9)
layer = {n: (D / f"p{n}.layer.txt").read_text() for n in PAGES}
vision = {n: (D / f"p{n}.vision.md").read_text() for n in PAGES}

def flat(s):
    return re.sub(r"\s+", " ", s.replace("**", ""))

def src(page, quote):
    # Verbatim in the vision text (what the viewer marks) and, up to line wrapping, in the PDF's text layer.
    assert quote in vision[page].replace("**", ""), (page, quote)
    assert flat(quote) in flat(layer[page]), (page, quote)
    return {"file": F, "page": page, "quote": quote}

NAMES = {"B_LKC": "Leukocyty", "B_NEU": "Neutrofily (abs.)", "B_LYMFO": "Lymfocyty (abs.)", "B_HB": "Hemoglobin",
         "B_PLT": "Trombocyty", "S_UREA": "Urea", "S_CREAE": "Kreatinin", "S_NA": "Sodík", "S_K": "Draslík",
         "S_BIL": "Bilirubin celkový", "S_ALT": "ALT", "S_AST": "AST", "S_GGT": "GGT", "S_ALP": "ALP",
         "S_ALB": "Albumin", "S_HSCRP": "CRP", "S_CEA": "CEA", "S_CA199": "CA 19-9"}
LAB_PAGES = [5, 6, 7, 8]  # chronological: 10.3., 2.6., 15.9., 6.10.2026
line = re.compile(r"^(\S+): (\**)([\d,]+)\** (.+?) \[([\d.]+) \.\.\. ([\d.]+)\]$")
draws, tests = [], {}
for k, p in enumerate(LAB_PAGES):
    m = re.search(r"Odběr: (\d+)\.(\d+)\.(\d{4}) (\d\d:\d\d)", layer[p])
    d, mo, y, t = m.groups()
    draws.append({"datetime": f"{y}-{int(mo):02d}-{int(d):02d} {t}", "date": f"{y}-{int(mo):02d}-{int(d):02d}", "time": t,
                  "source": src(p, m.group(0)), "requisition_quote": re.search(r"Č\. žádanky: \S+", layer[p]).group(0)})
    for ln in vision[p].splitlines():
        mm = line.match(ln)
        if not mm:
            continue
        code, bold, val, unit, lo, hi = mm.groups()
        quote = f"{code}: {val} {unit} [{lo} ... {hi}]"
        num = float(val.replace(",", "."))
        out = "high" if num > float(hi) else "low" if num < float(lo) else None
        assert bool(bold) == bool(out), (p, code, val)  # the sheet's bold matches the range check
        t_ = tests.setdefault(code, {"code": code, "name_cs": NAMES[code], "unit": unit, "reference_range": f"{lo} ... {hi}",
                                     "reference_low": float(lo), "reference_high": float(hi), "values": [None] * len(LAB_PAGES), "points": [None] * len(LAB_PAGES)})
        assert t_["unit"] == unit and t_["reference_range"] == f"{lo} ... {hi}", (code, p)  # like with like across draws
        t_["values"][k] = num
        t_["points"][k] = {"value": val, "out_of_range": out, "flagged_in_document": bool(bold),
                           "date": draws[-1]["date"], "time": draws[-1]["time"], "certainty": "documented", "source": src(p, quote)}
order = list(NAMES)
assert set(tests) == set(order) and all(None not in t["values"] for t in tests.values())


Q = ("Otázka na MDT: Je po neoadjuvantní CHRT a nízké přední resekci rekta (ypT2 ypN0, R0) indikována adjuvantní chemoterapie? "
     "Jak dále došetřit vzestup CEA na 9,6 µg/l, je indikováno PET/CT? Kdy je vhodné zrušení protektivní ileostomie?")
fhir = json.loads((UP / "zadost-fhir.json").read_text())
# The referral and the report must ask the same question, or the imported form would disagree with the document.
sr = next(e["resource"] for e in fhir["entry"] if e["resource"]["resourceType"] == "ServiceRequest")
assert sr["reasonCode"][0]["text"] == Q.removeprefix("Otázka na MDT: ")
pat = next(e["resource"] for e in fhir["entry"] if e["resource"]["resourceType"] == "Patient")
RC = "585614/4019"
assert pat["identifier"][0]["value"] == RC and int(RC.replace("/", "")) % 11 == 0 and all(RC in vision[n] for n in PAGES)

DOCS = [  # title, type, date, pages, upload file
    ("Ambulantní vyšetření kontrolní (chirurgie) s otázkou na MDT", "ambulantní zpráva", "2026-10-08", [1, 2], "01-ambulantni-zprava-2026-10-08.pdf"),
    ("Bioptický histologický nález - biopsie tumoru rekta", "histologie", "2026-03-12", [3], "02-histologie-biopsie-2026-03-12.pdf"),
    ("Bioptický histologický nález - resekát rekta po neoadjuvanci", "histologie", "2026-08-21", [4], "03-histologie-resekat-2026-08-21.pdf"),
    ("Výsledky laboratorních vyšetření (KO, biochemie, nádorové markery)", "laboratorní výsledky", "2026-03-10", [5], "04-laborator-2026-03-10.pdf"),
    ("Výsledky laboratorních vyšetření (KO, biochemie, nádorové markery)", "laboratorní výsledky", "2026-06-02", [6], "05-laborator-2026-06-02.pdf"),
    ("Výsledky laboratorních vyšetření (KO, biochemie, nádorové markery)", "laboratorní výsledky", "2026-09-15", [7], "06-laborator-2026-09-15.pdf"),
    ("Výsledky laboratorních vyšetření (KO, biochemie, nádorové markery)", "laboratorní výsledky", "2026-10-06", [8], "07-laborator-2026-10-06.pdf"),
]
assert sorted(p.name for p in UP.glob("*.pdf")) == [d[4] for d in DOCS]  # every document has its upload PDF
out = {
    "file": F,
    "synthetic_patient": True,
    "intake_demo": True,
    "note_cs": "Fiktivní pacientka vytvořená týmem CodeBridge (samples/S02_pacient), ne z dat FNO. Hodnoty jsou z její syntetické dokumentace a každá má zdroj.",
    "dev_note": "Generated by fixtures/extract/build_case_s02.py from data/derived/pages/S02_pacient/p<n>.layer.txt; every quote is a verbatim substring of that page's text. See samples/README.md.",
    "list_entry": {
        "file": F, "name": "Věra Lipenská", "age_or_birth": "nar. 14.6.1958", "rc": RC, "insurer": "111",
        "main_problem_cs": "Adenokarcinom rekta G2, pMMR, cT3b cN1 cM0, po neoadjuvanci ypT2 ypN0 (0/14), R0",
        "mdt_question_cs": Q.removeprefix("Otázka na MDT: "),
        "mdt_question_explicit": True,
        "mdt_question_source": src(2, Q),
        "one_line_summary_cs": "Adenokarcinom rekta diag. 3/2026 (biopsie 12.3.2026: G2, pMMR), před léčbou cT3b cN1 cM0; neoadjuvantní CHRT 50,4 Gy/28 fr. + kapecitabin (7.4.-18.5.2026); nízká přední resekce s TME a protektivní ileostomií 11.8.2026, histologie 21.8.2026 ypT2 ypN0 (0/14), R0, TRG 2; CEA 14,8 -> 5,8 -> 2,9 -> 9,6 µg/l (6.10.2026), CT vyžádáno 7.10.2026, výsledek chybí.",
        "page_count": 8,
        "note": "Syntetická pacientka týmu CodeBridge, ne z dat FNO. Popis MR pánve 16.3.2026 je jen převzatý v ambulantní zprávě (originál chybí); výsledek CT hrudníku, břicha a pánve chybí (žádanka odeslána 7.10.2026).",
        "question_draft_cs": None, "question_kind": None, "question_basis": None,
        "status": "new", "status_note_cs": "Příklad: případ zadaný, zatím bez termínu.",
        "owner": "MUDr. Ondřej Habrman", "owner_note_cs": "Fiktivní lékař, podepsaný pod ambulantní zprávou.",
    },
    "others_entry": {
        "file": F,
        "diagnosis_cs": "Adenokarcinom rekta G2, pMMR",
        "diagnosis_source": src(1, "Adenokarcinom rekta (horní okraj 11 cm, dolní okraj 6 cm od anu), G2, pMMR, diag. 3/2026"),
        "histology_source": src(3, "Adenokarcinom rekta, G2 (středně diferencovaný, low grade dle WHO 2019), pMMR."),
        "mkn10": "C20",
        "mkn10_source": src(1, "C20 Zhoubný novotvar konečníku"),
        "referring_doctor": "MUDr. Ondřej Habrman",
        "referring_department": "Chirurgická ambulance - koloproktologická poradna",
        "context_source": src(2, "MUDr. Ondřej Habrman, chirurgická ambulance"),
    },
    "documents": [
        {"title_cs": t, "type": ty, "date": d, "pages": p, "readability": "good", "reason_cs": "Syntetický tištěný text.", "upload_name": u}
        for t, ty, d, p, u in DOCS
    ],
    "data_gaps": [
        {"kind": "missing", "text_cs": "Popis MR pánve 16.3.2026 (staging cT3b cN1) je jen převzatý v ambulantní zprávě, originální nález radiologa chybí.",
         "source": src(1, "MR pánve 16.3.2026 (popis z NIS)")},
        {"kind": "missing", "text_cs": "CT hrudníku, břicha a pánve: žádanka odeslána 7.10.2026 pro vzestup CEA, výsledek v dokumentaci není.",
         "source": src(1, "7.10.2026 odeslána žádanka na CT hrudníku, břicha a pánve pro vzestup CEA, t.č. výsledek nemáme")},
        {"kind": "missing", "text_cs": "Koloskopie 9.3.2026, stagingové CT 17.3.2026, restagingová MR pánve 20.7.2026 a operační protokol 11.8.2026 jsou jen převzaté v ambulantní zprávě, originály chybí.",
         "source": src(1, "11.8.2026 nízká přední resekce rekta s TME, staplerová anastomóza, protektivní ileostomie (operační protokol v NIS)")},
        {"kind": "missing", "text_cs": "Záznam MDT 20.3.2026 (indikace neoadjuvance) a závěrečná zpráva radioterapie / onkologie o neoadjuvantní CHRT v dokumentaci nejsou, CHRT je jen převzatá v ambulantní zprávě.",
         "source": src(1, "20.3.2026 MDT: indikována neoadjuvantní chemoradioterapie")},
    ],
    "labs_series": {
        "synthetic": False,
        "synthetic_patient": True,
        "note_cs": "Hodnoty ze 4 laboratorních listů v dokumentaci (fiktivní pacientka). Každá hodnota má zdroj.",
        "name_note": "name_cs is our display label; the sheets print only the code.",
        "draws": draws,
        "tests": [tests[c] for c in order],
    },
    "fhir_referral": fhir,
}
# The CEA story the demo relies on: high at diagnosis, falling after CRT and surgery, rising again before the MDT.
assert tests["S_CEA"]["values"] == [14.8, 5.8, 2.9, 9.6]
target = R / "fixtures/data/mock-case-S02.json"
target.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print("wrote", target)
for c in order:
    t = tests[c]; print(f"{c:20} {t['unit']:14} {t['reference_range']:14}", " | ".join(p["value"] + ("↑" if p["out_of_range"] == "high" else "↓" if p["out_of_range"] == "low" else " ") for p in t["points"]))
