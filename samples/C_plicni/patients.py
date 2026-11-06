"""Ten fictional lung cancer patients for demo org C ("Plicní MDT"). Everything here is invented: the people, the
birth numbers, the doctors and the values. Each patient is one outpatient report; scripts/add_lung_org.py prints it
to a PDF and sends it through the real reading pipeline. The cases are chosen to exercise the side panel's value chips
and the failure cases in CLAUDE.md (a suspicion without histology, a request without a result, a negated finding,
a family history that is not the patient's)."""

PATIENTS = [
    dict(no="C01", first="Bořivoj", last="Klenovský", birth="7.11.1957", sex="muž", slot="14:00", dept="Pneumologie",
         question="Lobektomie, nebo stereotaktická radioterapie u adenokarcinomu pravého horního laloku cT2a cN0 cM0 při CHOPN?",
         body="""Diagnózy: C34.1 Zhoubný novotvar horního laloku plíce; J44.9 Chronická obstrukční plicní nemoc

Onkologická anamnéza:
8/2026 kašel, hemoptýza. Bronchoskopie s biopsií 11.9.2026.
Histologie 14.9.2026: adenokarcinom, EGFR wt, ALK negativní, PD-L1 TPS 60 %.
CT hrudníku a břicha 16.9.2026: tumor pravého horního laloku 38 mm, bez zvětšených uzlin, bez vzdálených metastáz.
PET/CT 22.9.2026: akumulace jen v primárním tumoru. Stadium cT2a cN0 cM0.

Komorbidity: Chronická obstrukční plicní nemoc, kuřák 40 balíčkoroků. Arteriální hypertenze.
Funkční vyšetření: Spirometrie 23.9.2026: FEV1 1,41 l (52 % n. h.), DLCO 48 % n. h. Echokardiografie 24.9.2026: EF 60 %.
Medikace: Spiriva 1-0-0, Bisoprolol 2,5 mg 1-0-0.
Stav: ECOG PS 1. Laboratoř 21.9.2026: eGFR 1,3 ml/s, trombocyty 240.
"""),
    dict(no="C02", first="Jarmila", last="Hrubá", birth="14.3.1961", sex="žena", slot="14:10", dept="Klinická onkologie",
         question="Pembrolizumab v 1. linii u adenokarcinomu IV. stadia s PD-L1 80 % při primární biliární cholangitidě?",
         body="""Diagnózy: C34.3 Zhoubný novotvar dolního laloku plíce; K74.3 Primární biliární cholangitida

Onkologická anamnéza:
Histologie 2.10.2026: adenokarcinom plic, EGFR wt, ALK negativní, ROS1 negativní, PD-L1 TPS 80 %.
CT 5.10.2026: tumor levého dolního laloku 52 mm, metastázy v játrech a nadledvině vlevo. Stadium cT3 cN2 cM1c.

Komorbidity: Primární biliární cholangitida od 2019, na kyselině ursodeoxycholové, gastroenterologie kontroly po 6 měsících. Autoimunitní tyreoiditida na substituci.
Funkční vyšetření: Spirometrie 7.10.2026: FEV1 82 % n. h., DLCO 76 % n. h. Echokardiografie 7.10.2026: EF 62 %.
Medikace: Ursosan 250 mg 2-0-2, Letrox 75 ug 1-0-0.
Stav: ECOG PS 1. Laboratoř 6.10.2026: bilirubin 19 umol/l, eGFR 1,4 ml/s.
"""),
    dict(no="C03", first="Miroslav", last="Štěpánek", birth="30.6.1955", sex="muž", slot="14:20", dept="Hrudní chirurgie",
         question="Operace, nebo konkomitantní chemoradioterapie u dlaždicobuněčného karcinomu IIIA při snížené EF?",
         body="""Diagnózy: C34.1 Zhoubný novotvar horního laloku plíce; I50.2 Srdeční selhání

Onkologická anamnéza:
Histologie 18.9.2026: dlaždicobuněčný karcinom, PD-L1 TPS 10 %.
CT 21.9.2026: tumor levého horního laloku 61 mm. PET/CT 25.9.2026: akumulace v ipsilaterálních mediastinálních uzlinách. Stadium cT3 cN2 cM0.

Komorbidity: Stav po infarktu myokardu 2023, ischemická choroba srdeční, srdeční selhání NYHA II. Diabetes mellitus 2. typu.
Funkční vyšetření: Echokardiografie 29.9.2026: EF 30 %. Spirometrie 28.9.2026: FEV1 71 % n. h., DLCO 65 % n. h.
Medikace: Eliquis 5 mg 1-0-1, Entresto 1-0-1, Metformin 1000 mg 1-0-1.
Stav: ECOG PS 1. Laboratoř 27.9.2026: eGFR 1,1 ml/s.
"""),
    dict(no="C04", first="Alena", last="Machová", birth="2.2.1958", sex="žena", slot="14:30", dept="Klinická onkologie",
         question="Cisplatina, nebo karboplatina s etoposidem a radioterapií u malobuněčného karcinomu limitovaného stadia?",
         body="""Diagnózy: C34.8 Zhoubný novotvar plíce přesahující více oblastí; N18.3 Chronické onemocnění ledvin

Onkologická anamnéza:
Histologie 6.10.2026: malobuněčný karcinom plic.
CT 8.10.2026: tumor pravého hilu 44 mm, zvětšené mediastinální uzliny. MR mozku 9.10.2026 bez metastáz. Limitované stadium.

Komorbidity: Chronické onemocnění ledvin 3. stupně, nefrologie. Periferní neuropatie při diabetu.
Funkční vyšetření: Echokardiografie 10.10.2026: EF 58 %. Spirometrie 10.10.2026: FEV1 74 % n. h., DLCO 69 % n. h.
Medikace: Gliclazid 60 mg 1-0-0, Ramipril 5 mg 1-0-0.
Stav: ECOG PS 1. Laboratoř 9.10.2026: eGFR 0,68 ml/s (ref. 1,0-2,0), kreatinin 128 umol/l, neutrofily 4,2.
"""),
    dict(no="C05", first="Tomáš", last="Vaněk", birth="19.8.1969", sex="muž", slot="14:40", dept="Klinická onkologie",
         question="Osimertinib při EGFR mutaci u adenokarcinomu IV. stadia při podezření na intersticiální plicní postižení?",
         body="""Diagnózy: C34.3 Zhoubný novotvar dolního laloku plíce

Onkologická anamnéza:
Histologie 24.9.2026: adenokarcinom, EGFR exon 19 delece, PD-L1 TPS 5 %.
CT 26.9.2026: tumor pravého dolního laloku 33 mm, mnohočetné plicní metastázy, retikulace bazálně oboustranně. Stadium cT2a cN1 cM1a.

Komorbidity: Podezření na intersticiální plicní postižení, plicní konzilium dosud neproběhlo. Nekuřák.
Funkční vyšetření: Spirometrie 30.9.2026: FEV1 78 % n. h., DLCO 55 % n. h. Echokardiografie nebyla dosud provedena, žádanka odeslána 1.10.2026.
Medikace: bez trvalé medikace.
Stav: ECOG PS 0. Laboratoř 29.9.2026: eGFR 1,5 ml/s.
"""),
    dict(no="C06", first="Růžena", last="Kadlecová", birth="11.1.1944", sex="žena", slot="14:50", dept="Pneumologie",
         question="Paliativní systémová léčba, nebo symptomatická péče u 82leté pacientky s adenokarcinomem IV. stadia?",
         body="""Diagnózy: C34.9 Zhoubný novotvar plíce, NS

Onkologická anamnéza:
Histologie 1.10.2026: adenokarcinom, EGFR wt, ALK negativní, PD-L1 TPS 30 %.
CT 3.10.2026: tumor levého horního laloku 47 mm, pleurální výpotek, metastázy v kostech. Stadium cT3 cN2 cM1c.

Komorbidity: Fibrilace síní. Demence lehkého stupně. Osteoporóza.
Funkční vyšetření: Echokardiografie 5.10.2026: EF 55 %. Spirometrie pro stav neprovedena.
Medikace: Xarelto 15 mg 1-0-0, Betaloc 50 mg 1-0-0.
Stav: Karnofsky 60 %. Laboratoř 2.10.2026: eGFR 0,9 ml/s, hemoglobin 102 g/l.
"""),
    dict(no="C07", first="Pavel", last="Doležel", birth="23.5.1963", sex="muž", slot="15:00", dept="Pneumologie",
         question="Transthorakální biopsie, nebo rovnou resekce solitárního plicního uzlu s vysokou akumulací na PET/CT?",
         body="""Diagnózy: R91 Solitární plicní uzel, podezření na malignitu

Onkologická anamnéza:
CT 15.9.2026: uzel pravého horního laloku 19 mm se spikulami. PET/CT 29.9.2026: SUVmax 8,4, bez dalších ložisek. Suspektní z karcinomu plic, histologie dosud není.
Bronchoskopie 2.10.2026 bez záchytu.

Komorbidity: Bez významných komorbidit. Otec: revmatoidní artritida, matka: srdeční selhání. Bez autoimunitního onemocnění.
Funkční vyšetření: Spirometrie 5.10.2026: FEV1 94 % n. h., DLCO 88 % n. h. Echokardiografie 5.10.2026: EF 65 %.
Medikace: bez trvalé medikace.
Stav: ECOG PS 0. Laboratoř 1.10.2026: eGFR 1,6 ml/s.
"""),
    dict(no="C08", first="Hana", last="Benešová", birth="9.12.1972", sex="žena", slot="15:10", dept="Radiační onkologie",
         question="Stereotaktická radiochirurgie dvou mozkových metastáz před zahájením alektinibu u ALK pozitivního karcinomu?",
         body="""Diagnózy: C34.1 Zhoubný novotvar horního laloku plíce; C79.3 Sekundární zhoubný novotvar mozku

Onkologická anamnéza:
Histologie 11.9.2026: adenokarcinom, ALK pozitivní, PD-L1 TPS 40 %.
CT 14.9.2026: tumor pravého horního laloku 29 mm. MR mozku 20.9.2026: dvě metastázy, frontálně vlevo 9 mm a parietálně vpravo 6 mm. Stadium cT1c cN1 cM1c.

Komorbidity: Stav po plicní embolii 8/2026 na antikoagulaci. Migréna.
Funkční vyšetření: Echokardiografie 16.9.2026: EF 64 %. Spirometrie 16.9.2026: FEV1 88 % n. h., DLCO 81 % n. h.
Medikace: Eliquis 5 mg 1-0-1, Dexamed 4 mg 1-0-0.
Stav: ECOG PS 1. Laboratoř 15.9.2026: eGFR 1,7 ml/s.
"""),
    dict(no="C09", first="Oldřich", last="Pospíchal", birth="4.4.1952", sex="muž", slot="15:20", dept="Klinická onkologie",
         question="Konsolidační durvalumab po chemoradioterapii IIIB při pozitivitě HBsAg a kardiostimulátoru?",
         body="""Diagnózy: C34.2 Zhoubný novotvar středního laloku plíce

Onkologická anamnéza:
Histologie 3.5.2026: dlaždicobuněčný karcinom, PD-L1 TPS 25 %. Stadium cT4 cN2 cM0.
Konkomitantní chemoradioterapie 6-8/2026, 60 Gy, cisplatina. Radiační pneumonitida 1. stupně 9/2026.
CT 2.10.2026: parciální regrese, tumor 24 mm.

Komorbidity: HBsAg pozitivní, hepatologie, HBV DNA nedetekovatelná. Kardiostimulátor 2021 pro AV blok. Chronická obstrukční plicní nemoc.
Funkční vyšetření: Spirometrie 4.10.2026: FEV1 58 % n. h., DLCO 51 % n. h. Echokardiografie 4.10.2026: EF 52 %.
Medikace: Entekavir 0,5 mg 1-0-0, Spiriva 1-0-0.
Stav: ECOG PS 2. Laboratoř 1.10.2026: eGFR 1,0 ml/s, trombocyty 148.
"""),
    dict(no="C10", first="Věra", last="Sýkorová", birth="28.10.1966", sex="žena", slot="15:30", dept="Hrudní chirurgie",
         question="Adjuvantní léčba po pravostranné lobektomii adenokarcinomu pT2b pN1 cM0?",
         body="""Diagnózy: C34.3 Zhoubný novotvar dolního laloku plíce

Onkologická anamnéza:
Pravostranná dolní lobektomie s lymfadenektomií 4.9.2026.
Histologie 10.9.2026: adenokarcinom, pT2b pN1 (2 z 14 uzlin), R0, EGFR wt, ALK negativní, PD-L1 TPS 55 %.
CT 2.10.2026 bez známek recidivy. Metastázy neprokázány.

Komorbidity: Arteriální hypertenze. Neguje autoimunitní onemocnění. Bez srdečního selhání.
Funkční vyšetření: Spirometrie 1.10.2026: FEV1 69 % n. h., DLCO 66 % n. h. Echokardiografie 1.10.2026: EF 63 %.
Medikace: Prestarium 5 mg 1-0-0.
Stav: ECOG PS 0. Laboratoř 30.9.2026: eGFR 1,4 ml/s, bilirubin 11 umol/l.
"""),
]
