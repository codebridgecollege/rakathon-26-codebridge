"""Build mocks/src/data/mock-case-S01.json from the synthetic patient S01 (samples/S01_pacient).

Usage: python3 mocks/src/extract/build_case_s01.py  (after scripts/render_samples.py and scripts/ocr_pages.py)

Every quote is checked to be verbatim in the page's vision text and, up to line wrapping, in the PDF text
layer; every lab value's out-of-range flag is checked against the bold print on the sheet, and every test must
keep one unit and one reference range across draws, so the trend compares like with like.
"""
import json, re
from pathlib import Path
R = Path(__file__).resolve().parents[3]  # repository root
D = R / "data/derived/pages/S01_pacient"
F = "S01_pacient.pdf"
layer = {n: (D / f"p{n}.layer.txt").read_text() for n in range(1, 8)}
vision = {n: (D / f"p{n}.vision.md").read_text() for n in range(1, 8)}

def flat(s):
    return re.sub(r"\s+", " ", s.replace("**", ""))

def src(page, quote):
    # Verbatim in the vision text (what the viewer marks) and, up to line wrapping, in the PDF's text layer.
    assert quote in vision[page].replace("**", ""), (page, quote)
    assert flat(quote) in flat(layer[page]), (page, quote)
    return {"file": F, "page": page, "quote": quote}

NAMES = {"B_LKC": "Leukocyty", "B_NEU": "Neutrofily (abs.)", "B_LYMFO": "Lymfocyty (abs.)", "B_HB": "Hemoglobin",
         "B_PLT": "Trombocyty", "S_GLC": "Glukóza", "S_UREA": "Urea", "S_CREAE": "Kreatinin",
         "PT(KIDN)_EGFRCKDE": "eGFR CKD-EPI", "S_ALT": "ALT", "S_AST": "AST", "S_NA": "Sodík", "S_K": "Draslík"}
LAB_PAGES = [7, 5, 4, 3]  # chronological: 8.1., 12.5., 4.8., 6.10.2026
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

Q = ("Otázka na MDT: Je u progrese GBM indikována reresekce, případně reiradiace, nebo systémová léčba 2. linie (lomustin)? "
     "Prosím též o doporučení k další antikoagulaci (enoxaparin v plné dávce) vzhledem k trombocytopenii a klesající eGFR.")
q_line = Q
out = {
    "file": F,
    "synthetic_patient": True,
    "note_cs": "Fiktivní pacient vytvořený týmem CodeBridge (samples/S01_pacient), ne z dat FNO. Hodnoty jsou z jeho syntetické dokumentace a každá má zdroj.",
    "dev_note": "Generated from data/derived/pages/S01_pacient/p<n>.layer.txt; every quote is a verbatim substring of that page's text. See samples/README.md.",
    "list_entry": {
        "file": F, "name": "Radovan Křemínek", "age_or_birth": "nar. 12.3.1964", "insurer": "111",
        "main_problem_cs": "Glioblastom vlevo frontálně, IDH-wt, CNS WHO gr. 4, MGMT metylován",
        "mdt_question_cs": Q.removeprefix("Otázka na MDT: "),
        "mdt_question_explicit": True,
        "mdt_question_source": src(2, q_line),
        "one_line_summary_cs": "GBM vlevo F diag. 12/2025, stp. subtotální resekci 2.12.2025 a CHRT dle Stuppa (12.1.-20.2.2026); adjuvantní temozolomid 6 cyklů, od 3. cyklu redukce pro trombocytopenii G2 (PLT 54 dne 12.5.2026); DVT 2/2026 na enoxaparinu; MR 29.9.2026 progrese dle RANO; steroidní hyperglykémie a vzestup kreatininu (142 µmol/l dne 6.10.2026).",
        "page_count": 7,
        "note": "Syntetický pacient týmu CodeBridge, ne z dat FNO. Popis MR 29.9.2026 je jen převzatý v ambulantní zprávě (originál chybí); výsledek PET/CT s 18F-FET chybí (požadavek odeslán 1.10.2026).",
        "question_draft_cs": None, "question_kind": None, "question_basis": None,
        "status": "new", "status_note_cs": "Příklad: případ zadaný, zatím bez termínu.",
        "owner": "MUDr. Hana Modřínová", "owner_note_cs": "Fiktivní lékařka, podepsaná pod ambulantními zprávami.",
    },
    "others_entry": {
        "file": F,
        "diagnosis_cs": "Glioblastom vlevo frontálně, IDH-wt, CNS WHO gr. 4, MGMT metylován",
        "diagnosis_source": src(1, "Glioblastom vlevo frontálně, IDH-wildtype, CNS WHO gr. 4, MGMT metylován, diag. 12/2025"),
        "histology_source": src(6, "Histol. 9.12.2025: glioblastom, IDH-wildtype, CNS WHO grade 4, MGMT promotor metylován, Ki-67 cca 40 %"),
        "mkn10": "C71.1",
        "mkn10_source": src(1, "C71.1 Zhoubný novotvar čelního laloku"),
        "referring_doctor": "MUDr. Hana Modřínová",
        "referring_department": "Onkologická ambulance - neuroonkologie",
        "context_source": src(2, "MUDr. Hana Modřínová, onkologická ambulance"),
    },
    "documents": [
        {"title_cs": "Ambulantní vyšetření kontrolní (onkologie) s otázkou na MDT", "type": "ambulantní zpráva", "date": "2026-10-06", "pages": [1, 2], "readability": "good", "reason_cs": "Syntetický tištěný text."},
        {"title_cs": "Výsledky laboratorních vyšetření (KO, biochemie)", "type": "laboratorní výsledky", "date": "2026-10-06", "pages": [3], "readability": "good", "reason_cs": "Syntetický tištěný text."},
        {"title_cs": "Výsledky laboratorních vyšetření (KO, biochemie)", "type": "laboratorní výsledky", "date": "2026-08-04", "pages": [4], "readability": "good", "reason_cs": "Syntetický tištěný text."},
        {"title_cs": "Výsledky laboratorních vyšetření (KO, biochemie)", "type": "laboratorní výsledky", "date": "2026-05-12", "pages": [5], "readability": "good", "reason_cs": "Syntetický tištěný text."},
        {"title_cs": "Ambulantní vyšetření vstupní (onkologie)", "type": "ambulantní zpráva", "date": "2026-01-08", "pages": [6], "readability": "good", "reason_cs": "Syntetický tištěný text."},
        {"title_cs": "Výsledky laboratorních vyšetření (KO, biochemie)", "type": "laboratorní výsledky", "date": "2026-01-08", "pages": [7], "readability": "good", "reason_cs": "Syntetický tištěný text."},
    ],
    "data_gaps": [
        {"kind": "missing", "text_cs": "Popis MR mozku 29.9.2026 je jen převzatý v ambulantní zprávě, originální nález radiologa chybí.",
         "source": src(1, "MR mozku 29.9.2026 (popis z NIS)")},
        {"kind": "missing", "text_cs": "PET/CT s 18F-FET: požadavek odeslán 1.10.2026, výsledek v dokumentaci není.",
         "source": src(1, "1.10.2026 odeslán požadavek na PET/CT s 18F-FET, t.č. výsledek nemáme")},
        {"kind": "missing", "text_cs": "Histologický nález 9.12.2025 a operační protokol 2.12.2025 jsou jen převzaté v ambulantní zprávě, originály chybí.",
         "source": src(6, "Histol. 9.12.2025: glioblastom, IDH-wildtype, CNS WHO grade 4, MGMT promotor metylován, Ki-67 cca 40 %")},
    ],
    "labs_series": {
        "synthetic": False,
        "synthetic_patient": True,
        "note_cs": "Hodnoty ze 4 laboratorních listů v dokumentaci (fiktivní pacient). Každá hodnota má zdroj.",
        "name_note": "name_cs is our display label; the sheets print only the code.",
        "draws": draws,
        "tests": [tests[c] for c in order],
    },
}
target = R / "mocks/src/data/mock-case-S01.json"
target.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print("wrote", target)
for c in order:
    t = tests[c]; print(f"{c:20} {t['unit']:14} {t['reference_range']:14}", " | ".join(p["value"] + ("↑" if p["out_of_range"] == "high" else "↓" if p["out_of_range"] == "low" else " ") for p in t["points"]))
