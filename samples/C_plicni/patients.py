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


# The rest of each patient's documentation: the anamnesis sections, the examination, and what a lab sheet shows differently
# from LAB_BASE, as (earlier draw, latest draw). All invented.
LAB_BASE = [
    ("Krevní obraz", [("B_LKC", "10^9/l", "4", "10", "7,2", "7,4"), ("B_NEUT", "10^9/l", "2", "7", "4,5", "4,6"), ("B_HB", "g/l", "120", "175", "138", "136"), ("B_PLT", "10^9/l", "150", "400", "262", "255")]),
    ("Sérum, plazma - dusík. metab.", [("S_UREA", "mmol/l", "2.9", "8.2", "5,6", "5,8"), ("S_CREAE", "µmol/l", "49", "104", "82", "84"), ("PT(KIDN)_EGFRCKDE", "ml/s", "1", "2", "1,35", "1,31")]),
    ("Sérum - játra", [("S_BILT", "µmol/l", "2", "21", "12", "13"), ("S_ALT", "µkat/l", "0.1", "0.8", "0,42", "0,44"), ("S_AST", "µkat/l", "0.1", "0.7", "0,38", "0,40")]),
    ("Krev - minerály", [("S_NA", "mmol/l", "136", "145", "140", "139"), ("S_K", "mmol/l", "3.5", "5.1", "4,3", "4,4"), ("S_CA", "mmol/l", "2.1", "2.55", "2,31", "2,33")]),
    ("Nádorové markery a zánět", [("S_HSCRP", "mg/l", "0", "5", "3,8", "4,6"), ("S_CEA", "µg/l", "0", "5", "4,1", "4,9")]),
]

EXTRA = {
    "C01": dict(draws=("24.8.2026 07:30", "21.9.2026 07:40"), labs={"S_CEA": ("6,2", "7,8"), "S_HSCRP": ("8,1", "10,4")},
        ra="Otec: karcinom plic v 70 letech. Matka: arteriální hypertenze.", pa="Důchodce, dříve horník 25 let, expozice prachu.", sa="Ženatý, žije s manželkou, soběstačný.",
        aa="Penicilin: kopřivka.", abusus="Kuřák, 40 balíčkoroků, nekouří od 8/2026. Alkohol příležitostně.", ea="Očkován proti chřipce a pneumokokům. Bez kontaktu s tuberkulózou.", prev="Screening karcinomu plic neabsolvoval, kolonoskopie 2021 bez nálezu.",
        obj="Výška 174 cm, hmotnost 71 kg. TK 138/82, pulz 76/min, SpO2 94 %. Poslechově oslabené dýchání vpravo nahoře, bez vedlejších fenoménů."),
    "C02": dict(draws=("7.9.2026 08:00", "6.10.2026 07:50"), labs={"S_ALT": ("0,92", "1,14"), "S_AST": ("0,81", "0,97"), "S_CEA": ("14,2", "23,7")},
        ra="Matka: revmatoidní artritida. Sestra: karcinom prsu ve 52 letech.", pa="Účetní, stále pracuje.", sa="Vdaná, dvě dospělé děti.",
        aa="Alergie neguje.", abusus="Nekuřačka. Alkohol neguje.", ea="Očkována proti chřipce. HBsAg negativní, anti-HCV negativní.", prev="Mamografie 3/2026 bez nálezu, gynekologická prohlídka 2/2026 bez nálezu.",
        obj="Výška 165 cm, hmotnost 62 kg. TK 124/76, pulz 82/min, SpO2 96 %. Játra 2 cm pod obloukem, sklerální ikterus není."),
    "C03": dict(draws=("24.8.2026 07:20", "27.9.2026 07:30"), labs={"S_CREAE": ("108", "112"), "PT(KIDN)_EGFRCKDE": ("1,12", "1,08")},
        ra="Bratr: infarkt myokardu v 58 letech.", pa="Důchodce, dříve zámečník, expozice azbestu 10 let.", sa="Vdovec, žije sám, dochází pečovatelka.",
        aa="Kontrastní látka: kopřivka po CT v roce 2019, premedikace.", abusus="Bývalý kuřák, 35 balíčkoroků, nekouří od 2023.", ea="Očkován proti chřipce a covid-19.", prev="Kardiologické kontroly po 6 měsících, kolonoskopie neprovedena.",
        obj="Výška 178 cm, hmotnost 84 kg. TK 112/70, pulz 88/min, SpO2 93 %. Otoky dolních končetin do poloviny bérců."),
    "C04": dict(draws=("11.9.2026 07:40", "9.10.2026 07:35"), labs={"S_CREAE": ("126", "128"), "PT(KIDN)_EGFRCKDE": ("0,72", "0,68"), "S_NA": ("131", "129"), "B_HB": ("118", "114")},
        ra="Otec: diabetes mellitus 2. typu.", pa="Důchodkyně, dříve prodavačka.", sa="Vdaná, žije s manželem.",
        aa="Sulfonamidy: exantém.", abusus="Kuřačka, 30 balíčkoroků, stále kouří 10 cigaret denně.", ea="Očkována proti chřipce.", prev="Mamografie 2025 bez nálezu.",
        obj="Výška 160 cm, hmotnost 58 kg. TK 146/84, pulz 90/min, SpO2 95 %. Snížené čití na akrech dolních končetin."),
    "C05": dict(draws=("31.8.2026 07:30", "29.9.2026 07:25"), labs={"S_CEA": ("31,0", "48,5"), "S_HSCRP": ("11,2", "16,4")},
        ra="Rodinná anamnéza onkologicky bez pozoruhodností.", pa="Učitel, kancelářská práce, bez expozice.", sa="Ženatý, dvě nezletilé děti.",
        aa="Alergie neguje.", abusus="Nekuřák. Alkohol příležitostně.", ea="Pobyt v jihovýchodní Asii 2019. Bez kontaktu s tuberkulózou.", prev="Preventivní prohlídka u praktického lékaře 1/2026 bez nálezu.",
        obj="Výška 182 cm, hmotnost 79 kg. TK 128/78, pulz 74/min, SpO2 93 %. Bazálně oboustranně krepitus."),
    "C06": dict(draws=("4.9.2026 08:10", "2.10.2026 08:00"), labs={"S_CREAE": ("118", "124"), "PT(KIDN)_EGFRCKDE": ("0,94", "0,90"), "B_HB": ("110", "102"), "S_CA": ("2,62", "2,71")},
        ra="Sestra: karcinom tlustého střeva.", pa="Důchodkyně, dříve švadlena.", sa="Vdova, žije v domově pro seniory, chodí s chodítkem.",
        aa="Alergie neguje.", abusus="Nikdy nekouřila.", ea="Očkována proti chřipce a pneumokokům.", prev="Bez pravidelných preventivních prohlídek.",
        obj="Výška 155 cm, hmotnost 49 kg. TK 118/68, pulz 96/min nepravidelný, SpO2 91 %. Oslabené dýchání vlevo bazálně, poklep ztemnělý."),
    "C07": dict(draws=("3.9.2026 07:30", "1.10.2026 07:30"), labs={},
        ra="Otec: revmatoidní artritida. Matka: srdeční selhání.", pa="Řidič autobusu.", sa="Ženatý, žije s rodinou.",
        aa="Alergie neguje.", abusus="Bývalý kuřák, 15 balíčkoroků, nekouří od 2018.", ea="Očkován proti chřipce. Bez kontaktu s tuberkulózou, Quantiferon negativní 9/2026.", prev="Pravidelné řidičské prohlídky, kolonoskopie 2024 bez nálezu.",
        obj="Výška 180 cm, hmotnost 88 kg. TK 132/84, pulz 70/min, SpO2 98 %. Poslechový nález bez patologie."),
    "C08": dict(draws=("18.8.2026 07:40", "15.9.2026 07:30"), labs={"S_CEA": ("9,4", "12,8")},
        ra="Rodinná anamnéza neguje nádorová onemocnění.", pa="Lékárnice.", sa="Rozvedená, jedno dítě.",
        aa="Jód: kožní reakce, kontrastní vyšetření s premedikací.", abusus="Nekuřačka. Alkohol neguje.", ea="Očkována proti chřipce a klíšťové encefalitidě.", prev="Gynekologická prohlídka 5/2026 bez nálezu, mamografie 2025 bez nálezu.",
        obj="Výška 168 cm, hmotnost 60 kg. TK 122/74, pulz 78/min, SpO2 97 %. Neurologicky bez ložiskového nálezu, stoj a chůze bez potíží."),
    "C09": dict(draws=("3.9.2026 07:40", "1.10.2026 07:35"), labs={"B_PLT": ("138", "148"), "B_NEUT": ("1,6", "1,9"), "S_CREAE": ("104", "102"), "PT(KIDN)_EGFRCKDE": ("1,02", "1,00"), "S_ALT": ("0,66", "0,71")},
        ra="Bratr: hepatitida B, cirhóza jater.", pa="Důchodce, dříve zedník.", sa="Ženatý, soběstačný s dopomocí.",
        aa="Alergie neguje.", abusus="Kuřák, 45 balíčkoroků, nekouří od 5/2026. Alkohol denně pivo.", ea="HBsAg pozitivní, HBV DNA nedetekovatelná, anti-HCV negativní. Očkován proti chřipce.", prev="Hepatologické kontroly po 6 měsících, ultrazvuk jater 8/2026 bez ložiska.",
        obj="Výška 172 cm, hmotnost 66 kg. TK 136/80, pulz 72/min stimulovaný, SpO2 92 %. Kardiostimulátor vlevo podklíčkově, dýchání oslabené."),
    "C10": dict(draws=("2.9.2026 07:40", "30.9.2026 07:35"), labs={},
        ra="Matka: arteriální hypertenze. Nádorová onemocnění v rodině neguje.", pa="Ředitelka školy, pracuje.", sa="Vdaná, žije s manželem.",
        aa="Alergie neguje.", abusus="Bývalá kuřačka, 10 balíčkoroků, nekouří od 2015.", ea="Očkována proti chřipce a covid-19.", prev="Mamografie 4/2026 bez nálezu, gynekologická prohlídka 4/2026 bez nálezu.",
        obj="Výška 170 cm, hmotnost 68 kg. TK 128/80, pulz 74/min, SpO2 96 %. Jizva po torakotomii vpravo klidná."),
}
