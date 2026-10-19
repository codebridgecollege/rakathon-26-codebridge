"""S01 and S02 (our synthetic patients) as codebridge.extraction/2 fact specs.

Today these fixtures hold only the documents, the dated lab series and the missing-document gaps, so the runs hold
the same: lab_result facts (built in convert_v2.py from labs_series), and the facts each gap is about. A gap that
names several missing items becomes one alert per item (EXTRACTION-FORMAT.md: two missing items never share an alert).
Every other section is `not_run`: the facts of other kinds here exist only as the basis of an alert, not as an
extraction of that section.
"""

from spec import AlertSpec, Q, Spec, dec, hist, img, meta, proc, req, resp, rt, ther

S01 = {
    "case_id": "NO-S01",
    "file": "mock-case-S01.json",
    "document": "S01_pacient",
    # documents: 0 report 6.10.2026 (p1-2), 1-3 labs (p3, p4, p5), 4 initial report 8.1.2026 (p6), 5 labs (p7)
    "default_part": {1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5},
    "report_parts": [0, 4],
    "facts": [
        Spec("s1_mr", "imaging", img("MR", "mozek", "další progrese sytící se složky v okolí resekční dutiny vlevo F na 24 x 19 mm, nové sytící se ložisko v genu corporis callosi 11 mm, závěr progrese dle RANO", resp("RANO", "progrese")),
             date="29.9.2026", status="done",
             quotes=[Q(1, "MR mozku 29.9.2026 (popis z NIS): další progrese sytící se složky v okolí resekční dutiny vlevo F na 24 x 19 mm, nové sytící se ložisko v genu corporis callosi 11 mm, závěr progrese dle RANO")]),
        Spec("s1_pet", "request", req("PET/CT s 18F-FET", "exam"), date="1.10.2026", status="requested",
             quotes=[Q(1, "1.10.2026 odeslán požadavek na PET/CT s 18F-FET, t.č. výsledek nemáme", cited=False),
                     Q(2, "Doplnit výsledek PET/CT s 18F-FET.", cited=False)]),
        Spec("s1_hist", "histology", hist(None, "glioblastom, IDH-wildtype, CNS WHO grade 4, MGMT promotor metylován, Ki-67 cca 40 %", "glioblastom, IDH-wildtype", "CNS WHO grade 4"),
             date="9.12.2025", not_stated=["specimen"],
             quotes=[Q(6, "Histol. 9.12.2025: glioblastom, IDH-wildtype, CNS WHO grade 4, MGMT promotor metylován, Ki-67 cca 40 %")]),
        Spec("s1_op", "procedure", proc("resekce tumoru vlevo F (neurochirurgie), subtotální resekce", "vlevo frontálně"), date="2.12.2025", status="done",
             quotes=[Q(6, "2.12.2025 stp. resekci tumoru vlevo F (neurochirurgie), subtotální resekce", cited=True)]),
    ],
    "alerts": [
        AlertSpec("original_report_missing", "missing", "s1_mr", ["s1_mr"], {"fact": "s1_mr"}, None, ["data_gaps[0]"]),
        AlertSpec("request_without_result", "missing", "s1_pet", ["s1_pet"], {"fact": "s1_pet"}, None, ["data_gaps[1]"]),
        AlertSpec("original_report_missing", "missing", "s1_hist", ["s1_hist"], {"fact": "s1_hist"}, None, ["data_gaps[2]"]),
        AlertSpec("original_report_missing", "missing", "s1_op", ["s1_op"], {"fact": "s1_op"}, None, ["data_gaps[2]"]),
    ],
    "original_reports": ["s1_mr", "s1_hist", "s1_op"],
}

S02 = {
    "case_id": "NO-S02",
    "file": "mock-case-S02.json",
    "document": "S02_pacient",
    # documents: 0 report 8.10.2026 (p1-2), 1 biopsy histology (p3), 2 resection histology (p4), 3-6 labs (p5-p8)
    "default_part": {1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6},
    "report_parts": [0],
    "facts": [
        Spec("s2_mr1", "imaging", img("MR", "pánev", "tumor rekta s šířením do mezorekta 7 mm za muscularis propria, 2 suspektní mezorektální uzliny, MRF negativní, EMVI negativní, závěr cT3b cN1"),
             date="16.3.2026", status="done",
             quotes=[Q(1, "MR pánve 16.3.2026 (popis z NIS): tumor rekta s šířením do mezorekta 7 mm za muscularis propria, 2 suspektní mezorektální uzliny, MRF negativní, EMVI negativní, závěr cT3b cN1")]),
        Spec("s2_ct", "request", req("CT hrudníku, břicha a pánve", "exam"), date="7.10.2026", status="requested",
             quotes=[Q(1, "7.10.2026 odeslána žádanka na CT hrudníku, břicha a pánve pro vzestup CEA, t.č. výsledek nemáme", cited=False)]),
        Spec("s2_colo", "procedure", proc("koloskopie", "tračník a rektum", "exofytický tumor rekta 6-11 cm od anu, semicirkulární, odebrána biopsie, zbytek tračníku bez patologie"),
             date="9.3.2026", status="done",
             quotes=[Q(1, "9.3.2026 koloskopie (popis z NIS): exofytický tumor rekta 6-11 cm od anu, semicirkulární, odebrána biopsie, zbytek tračníku bez patologie", cited=True)]),
        Spec("s2_ct_staging", "imaging", img("CT", "hrudník a břicho", "bez známek vzdálených metastáz"), date="17.3.2026", status="done",
             quotes=[Q(1, "CT hrudníku a břicha 17.3.2026 (popis z NIS): bez známek vzdálených metastáz")]),
        # The staging CT's negative finding as a negated fact, so "bez známek vzdálených metastáz" is never silence.
        Spec("s2_m_neg", "metastasis", meta("vzdálené metastázy", "excluded", "imaging", "bez známek vzdálených metastáz"), negated=True,
             date="17.3.2026", quotes=[Q(1, "CT hrudníku a břicha 17.3.2026 (popis z NIS): bez známek vzdálených metastáz")]),
        Spec("s2_mr2", "imaging", img("MR", "pánev", "regrese tumoru, reziduální ztluštění stěny rekta, bez suspektních uzlin, MRF negativní"), date="20.7.2026", status="done",
             quotes=[Q(1, "MR pánve 20.7.2026 (popis z NIS): regrese tumoru, reziduální ztluštění stěny rekta, bez suspektních uzlin, MRF negativní")]),
        Spec("s2_op", "procedure", proc("nízká přední resekce rekta s TME, staplerová anastomóza, protektivní ileostomie", "rektum"), date="11.8.2026", status="done",
             quotes=[Q(1, "11.8.2026 nízká přední resekce rekta s TME, staplerová anastomóza, protektivní ileostomie (operační protokol v NIS)", cited=True)]),
        Spec("s2_mdt", "decision", dec("mdt", "indikována neoadjuvantní chemoradioterapie", "MDT"), date="20.3.2026",
             quotes=[Q(1, "20.3.2026 MDT: indikována neoadjuvantní chemoradioterapie", cited=True)]),
        Spec("s2_rt", "radiotherapy", rt("pánev", "50,4 Gy", "28 fr.", "neoadjuvantní CHRT: RT 50,4 Gy/28 fr. na oblast pánve, konkomitantně kapecitabin, bez přerušení"),
             date="7.4.2026 - 18.5.2026", status="done",
             quotes=[Q(1, "7.4.2026 - 18.5.2026 neoadjuvantní CHRT: RT 50,4 Gy/28 fr. na oblast pánve + kapecitabin 825 mg/m2 2x denně ve dnech RT, bez přerušení", cited=True)]),
        Spec("s2_cape", "systemic_therapy", ther("kapecitabin 825 mg/m2 2x denně ve dnech RT", None, "7.4.2026", "18.5.2026", None, "konkomitantně s RT v rámci neoadjuvantní CHRT"),
             date="7.4.2026 - 18.5.2026", status="done",
             quotes=[Q(1, "7.4.2026 - 18.5.2026 neoadjuvantní CHRT: RT 50,4 Gy/28 fr. na oblast pánve + kapecitabin 825 mg/m2 2x denně ve dnech RT, bez přerušení", cited=True)]),
    ],
    "alerts": [
        AlertSpec("original_report_missing", "missing", "s2_mr1", ["s2_mr1"], {"fact": "s2_mr1"}, None, ["data_gaps[0]"]),
        AlertSpec("request_without_result", "missing", "s2_ct", ["s2_ct"], {"fact": "s2_ct"}, None, ["data_gaps[1]"]),
        AlertSpec("original_report_missing", "missing", "s2_colo", ["s2_colo"], {"fact": "s2_colo"}, None, ["data_gaps[2]"]),
        AlertSpec("original_report_missing", "missing", "s2_ct_staging", ["s2_ct_staging"], {"fact": "s2_ct_staging"}, None, ["data_gaps[2]"]),
        AlertSpec("original_report_missing", "missing", "s2_mr2", ["s2_mr2"], {"fact": "s2_mr2"}, None, ["data_gaps[2]"]),
        AlertSpec("original_report_missing", "missing", "s2_op", ["s2_op"], {"fact": "s2_op"}, None, ["data_gaps[2]"]),
        AlertSpec("original_report_missing", "missing", "s2_mdt", ["s2_mdt"], {"fact": "s2_mdt"},
                  "Záznam MDT 20.3.2026 (indikace neoadjuvance) v dokumentaci není, rozhodnutí je jen převzaté v ambulantní zprávě.", ["data_gaps[3]"]),
        AlertSpec("original_report_missing", "missing", "s2_rt", ["s2_rt", "s2_cape"], {"fact": "s2_rt"},
                  "Závěrečná zpráva radioterapie / onkologie o neoadjuvantní CHRT v dokumentaci není, CHRT je jen převzatá v ambulantní zprávě.", ["data_gaps[3]"]),
    ],
    "original_reports": ["s2_mr1", "s2_colo", "s2_ct_staging", "s2_mr2", "s2_op", "s2_mdt", "s2_rt"],
}

SYNTHETIC = [S01, S02]
