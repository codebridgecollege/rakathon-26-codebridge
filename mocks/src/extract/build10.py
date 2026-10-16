import json, re, sys
S = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "data") + "/"
ocr = json.load(open(S + "ocr.json"))
pages = ocr["10_pacient.pdf"]
F = "10_pacient.pdf"
norm = lambda s: re.sub(r"\s+", " ", s).strip()
npages = [norm(p) for p in pages]
bad = []

def src(page, quote):
    q = norm(quote)
    if q not in npages[page - 1]:
        bad.append((page, q))
    return {"file": F, "page": page, "quote": q}

def fact(text, date, page, quote, certainty="documented", negated=False, note=None):
    d = {"text_cs": text, "date": date, "source": src(page, quote), "certainty": certainty, "negated": negated}
    if note: d["note"] = note
    return d

sections = {
 "clinical_finding": [
  fact("ECOG PS 1, bez klinických známek mozkových metastáz.", None, 4, "ECOG PS: 1, bez klin. známek mozkových mts", negated=True,
       note="Negace se týká klinického nálezu, ne zobrazení. MR mozku 14.9.2026 popisuje suspekci na MTS."),
  fact("Na cílený dotaz neguje závratě či poruchy rovnováhy; někdy během dne mžitky před očima.", None, 4,
       "Na cílený dotaz neguje závratě či poruchy rovnováhy, jenom jsou někdy během dne mžitky před očima.", negated=True),
  fact("TK 155/70 mmHg, pulz 68/min, hmotnost 87 kg, výška 183 cm, BMI 25.98.", None, 4,
       "Tlak S/D [mmHg]: 155/70, Pulz [1/mín]: 68, Dech [1/min]: 14, Hmotnost [kg]: 87, Výška [cm]: 183, BMI: 25.98"),
  fact("Lucidní, orientace správná, eupnoe, bez cyanózy a ikteru.", None, 4,
       "lucidní, orientace správná, spolupracuje, eupnoe, bez cyanózy, bez ikteru"),
  fact("Hrdlo zarudlé, hnisavý povlak.", None, 4, "hrdlo zarudlé, hnisavý povlak"),
  fact("Krční, axilární, nadklíčkové a tříselné uzliny nehmatné.", None, 4, "uzliny nehmatné"),
  fact("Jizvy pod pravým i levým obloukem žeberním klidné.", None, 4, "j izvy pod pravým i levým obloukem žeberním klidné",
       certainty="unclear_ocr", note="OCR rozdělilo slovo 'jizvy'."),
 ],
 "imaging": [
  fact("MR mozku (NNJ): solitární postkontrastně se sytící nodulus v pravé mozečkové hemisféře do 3 mm, suspekce na solitární MTS; jiné sytící se léze intrakraniálně nejsou.", "14.9.2026", 1,
       "Solitérní nodulus postkontrastně se sytící v pravé mozečkové hemisféře(do 3mm) - suspekce na solitérní MTS, postkontrastně bez jiných, sytících se lézí intrakraniálně."),
  fact("MR mozku: gliózy supratentoriálně Fazekas gr. III.", "14.9.2026", 1, "Gliózy supratentoriálně Fazekas gr. III."),
  fact("CT hrudníku a břicha: susp. MTS paraaortální uzliny vlevo 20 mm.", "7.9.2022", 1,
       "CT hrudník + břicho s KL 7.9.2022 - susp. MTS paraaortálni uzlina vlevo 20mm"),
  fact("CT břicha a malé pánve: spíše lymfokéla po lymfadenektomii (kolekce tekutiny do 36 mm vlevo paraaortálně L2-3) než nová zvětšená uzlina.", "25.11.2022", 1,
       "CT břicha, malé pánve nativně a kontrastně 25.11.2022 susp. lymfokéla po lymfadenektomii spíše ohraničená kolekce tekutiny do 36 mm vlevo paraaortálně v úrovni L2-3 než nová zvětšená uzlina."),
  fact("Baseline CT: patologická mediastinální a plicní hilová lymfadenopatie charakteru hypervaskularizovaných MTS.", "6.3.2023", 1,
       "baseline CT s KL 6.3.2023 patol. mediastinálni a pl. hilová lymfadenopatie - jsou hypervaskularizované mts charakteru"),
  fact("Restaging CT 6/2023: dosaženo iPR.", "6/2023", 2, "Dle restaging. CT 6/2023 dosaženo iPR"),
  fact("CT 9/2023: nový útvar do 21x27 mm vlevo ventrálně v mesogastriu, spíše cystický; bez lymfadenopatie, bez MTS.", "9/23", 2,
       "Při CT vyš. 9/23 popisován nově útvar do 21x27 mm vlevo ventrálně v mesogastriu, etiologie je spíše cystická, jinak bez lymfadenopatie, bez mts"),
  fact("Restaging CT 11/2023, 2/2024, 6/2024, 10/2024, 2/2025, 6/2025: trvá iPR.", "11/2023 až 6/2025", 2,
       "11/2023 + 2/2024 + 6/2024 + 10/2024 + 2/2025 + 6/2025 - trvá iPR"),
  fact("CT plic a břicha: proti baseline 3/2023 trvá mírná parciální regrese retroperitoneální lymfadenopatie vlevo, proti 6/2025 mírná progrese; nově patologická LU v levém plicním hilu; dle iRECIST PD.", "10.11.2025", 4,
       "ve srovnání s base line CT z 03/2023 trvá mírná parc. regrese velikosti retroperitoneální lymfadenopatie vlevo ( ve srovnání s min. CT z 06/2025 je ale mírná progrese velí kosti), navíc nově patol. LU v levém plicním hílu - dle iRECIST tedy PD (progressive disease)."),
  fact("CT hrudníku a břicha: regrese mediastinální a pravostranné hilové lymfadenopatie, progrese uzlin v levém hilu, progrese jedné LU retroperitonea; dle iRECIST iCPD.", "16.1.2026", 4,
       "Ve srovnání s baselíne CT došlo k regresí medíastinální a pravostranné hilové lymfadenopatie, v levém hilu je velikostní progrese uzlin od baseline i ve srovnání s minulým CT."),
  fact("CT AG plicnice: bez plicní embolie, jen drobná cysta v HL vpravo.", "10.2.2026", 5, "Závěr: Bez plicní embolie, jen drobná cysta v HL vpravo."),
  fact("Drobná osteoplastická ložiska do 7 mm v přechodu Th/L páteře.", None, 5, "Drobné osteoplatické ložiska do průměru 7mm v přechodu th/L páteře.",
       certainty="unclear_ocr", note="Ze sazby skenu není jasné, ke kterému vyšetření věta patří (stojí mezi tabulkou iRECIST z CT 16.1.2026 a CT AG 10.2.2026). Jinde v textu se nezmiňuje."),
  fact("ECHO: normální velikost oddílů, EF LK 60 %, bez hemodynamicky významné chlopenní vady.", "20.2.2026", 5,
       "RES: dobrá systolická funkce obou komor, bez hemodynamicky významné chlop. vady"),
  fact("CT hrudníku a břicha: proti baseline 1/2026 mírná regrese LU v levém hilu, parciální regrese LU retroperitonea, bez nových ložisek; regrese sledovaných lézí o cca 24 %, dle iRECIST iSD.", "28.4.2026", 5,
       "Velikostní regrese sledovaných lézi je o cca 24 %. Dle iRECIST • iSD."),
  fact("UZ tepen DKK: středně silné sklerotické změny; vpravo zřetelná, ne těžká stenóza v proximálním úseku PDK.", "30.7.2026", 5,
       "Vpravo zřetelná, i když ne těžká stenosa v prox. úseku PDK."),
  fact("CT hrudníku, břicha a malé pánve: proti 4/2026 i baseline 1/2026 velikostní progrese LU v levém plicním hilu a retroperitoneu paraaortálně vlevo.", "26.8.2026", 5,
       "Ve srovnáni s minulým CT z 4/2026 i s baseline CT z 1/2026 je patrná velikostní progrse LU v levém pl. hilu a v retroperitonu paraaortálně vlevo.",
       note="Text stránky 5 končí za touto větou neúplně ('J-'); závěr může pokračovat na chybějící stránce."),
 ],
 "histology": [
  fact("Nefrektomie vpravo: světlobuněčný renální adenokarcinom G2, pT2a pN1 (3+/5) M0.", "2.6.2022", 1,
       "Histol. světlobuněčný renální adenokarcinom G2, pT2a pN1(3+/5) MO", note="Patologické TNM (pT, pN). Datum je datum operace; datum histologického nálezu neuvedeno. 'MO' v OCR čteno jako M0."),
  fact("Exstirpace paraaortální LU vlevo: MTS světlobuněčného renálního karcinomu G2, R0.", "25.10.2022", 1, "Histol. MTS světlobuněčného renálního karcinomu G2, R0"),
  fact("Excize ložiska brady vlevo: kožní metastáza světlobuněčného (konvenčního) karcinomu renálního origa, ISUP grade 2, odstraněna kompletně.", "21.11.2023", 1,
       "Histol. kožní metastáza světlebuněčného (konvenčního) karcinomu renálního origa v oblasti brady vlevo, grade 2 dle ISUP, odstraněná kompletně"),
  fact("Excize kožní léze glabely: sebaceom, kompletně odstraněn, bez nádorových změn.", "11.2.2025", 1,
       "histol. sebaceom, kompletně odstraněn, kůže se solární elastózou, bez nádorových změn.", negated=True),
  fact("Mozečkové ložisko (MR 14.9.2026) histologicky neověřeno; v dokumentaci jen suspekce.", None, 1, "suspekce na solitérní MTS", certainty="inferred",
       note="Pozorování asistenta: k ložisku v mozečku není v podkladech histologie."),
 ],
 "past_treatment": [
  fact("Transperitoneální nefrektomie vpravo s retroperitoneální lymfadenektomií.", "2.6.2022", 1,
       "2.6.2022 - stp. transperitoneálni nefrektomii vpravo s retroperitoneálni lymfadenektomii"),
  fact("Exstirpace paraaortální LU vlevo.", "25.10.2022", 1, "st.p. exstirpaci paraaortálni LU vlevo 25.10.2022"),
  fact("Nivolumab 3 mg/kg + ipilimumab 1 mg/kg q3w, 1. cyklus.", "27.3.2023", 1, "27.3.2023 1. cyklus nivolumab 3mg/kg + ipilimumab lmg/kg q3w",
       note="OCR čte '1mg/kg' jako 'lmg/kg'."),
  fact("2. cyklus nivolumab + ipilimumab.", "17.4.2023", 1, "17.4.2023 2. cyklus -//-"),
  fact("Po 2. cyklu GIT toxicita 1. st. a plicní toxicita (IPP 1. až 2. st.); prednison 1 mg/kg/den od 28.4.2023 s rychlou regresí, ukončen 26.7.2023.", "28.4.2023", 2,
       "Proto od 12.5.2023 zahájeno postupné snižování dávky kortikoidu, ukončen 26.7.2023."),
  fact("Udržovací nivolumab (240 mg q2w) od 27.6.2023 do 29.12.2025.", "27.6.2023", 1, "udržovací léčba nivolumab od 27.6.2023 do 29.12.2025"),
  fact("Implantace venózního portu (Medcomp power-port).", "21.8.2023", 1, "Implantace venozn1ho portu 21.8.2023"),
  fact("2. paliativní linie: sunitinib 50 mg denně, režim 4/2, start 27.1.2026.", "27.1.2026", 1, "2. pal, linie léčby sunitinib - start 27.1.2026"),
  fact("Při 50 mg progrese renální insuficience, minerálová dysbalance a trombocytopenie G2-3.", None, 1,
       "při dávce 50mg denně progrese renální insuf., minerálová dysbalance a trombocytopenie G2-3"),
  fact("Redukce sunitinibu o 1 stupeň na 37,5 mg (hepatopatie G2).", "25.2.2026", 1, "od 25.2.2026 redukce o 1 stupeň - dávka 37,5mg denně - hepatopatie G2"),
  fact("Redukce sunitinibu o 2 stupně na 25 mg.", "26.3.2026", 1, "od 26.3.2026 redukce o 2 stupně - dávka 25mg denně"),
  fact("Sunitinib ukončen pro PD dle CT 8/2026.", "8/2026", 2, "Proto léčbu sunitinibem ukončuji."),
  fact("3. paliativní linie: everolimus, start 3.9.2026 (schváleno KOC komisí); cabozantinib ponechán do 4. linie.", "3.9.2026", 1, "3, pal, linie léčby everolimus - start 3.9.2026"),
 ],
 "current_state": [
  fact("Everolimus toleruje výborně; nechutenství, nevolnost, zvracení ani průjem nemá.", None, 4,
       "Subj. nově předepsaný everolimus toleruje výbormně, nemá s ním žádný problém.", negated=False),
  fact("Tolerance léčby výborná, laboratoř bez zásadní patologie; everolimus navyšován na 10 mg denně.", None, 3,
       "Tolerance léčby vývorná, lab., vyš. bez zásadni patologie, proto navyšuji Everolimus na 10mg denně."),
  fact("Nález MR mozku zadán k projednání na NCH semináři.", None, 3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři."),
  fact("Plán: kontrola 9.10.2026 s odběrem KO a biochemie; domácí měření TK; kontrola v plicní ambulanci; kontrolní CT H+B+MP (datum v textu chybí).", "9.10.2026", 3,
       "Kontrola zde 9.10.2026 s odběrem KO, biochemie."),
  fact("Při odchodu ve stabilizovaném stavu.", None, 3, "Při odchodu je pacient ve stabilizovaném ·stavu."),
 ],
 "comorbidities": [
  fact("Hypertenze, CHOPN u fumátora (léčba přerušena pacientem), HLP na dietě, anamnesticky hyperglykémie nalačno, korové cysty ledvin, cysta S2 jater.", None, 2,
       "OA: HN, CHOPN u fumátora (anamn. léčba přerušena pacientem), HLP na dietě, hyperglykémie nalačno anam., korové cysty ledvin, cysta S2 jater"),
  fact("HBsAg pozitivní pacient.", None, 1, "HBsAg pozit. pac."),
  fact("Interní vyšetření: plicní embolie vyloučena, EKG bez ischemie, dušnost možno na vrub dekompenzované hypertenze; TK 174/92; nově Orcal 10 mg 1/2-0-0.", "10.2.2026", 5,
       "plicní embolie vyloučena, EKG bez ischemických změn, hstroponin stabilní bez dynamiky- možno na vrub dekorigované HT"),
  fact("Plicní vyšetření: lehká obstrukce, CHOPN II/B fumátor, susp. intersticiální postižení, stp. kortikoterapii.", "22.5.2026", 5,
       "Z: CHOPN II/B fumat., susp. interstic. post1zené, stp. kortikoterapii"),
  fact("Gliózy supratentoriálně Fazekas gr. III (MR mozku).", "14.9.2026", 1, "Gliózy supratentoriálně Fazekas gr. III."),
  fact("Stenóza proximálního úseku PDK vpravo, ne těžká; sledování vhodné.", "30.7.2026", 5, "Sledování vhodné."),
 ],
 "medication": [
  fact("Everolimus Sandoz 5 mg 1-0-0, zvyšováno na 2-0-0 od 19.9.2026 (při netoleranci zpět na 1-0-0).", "19.9.2026", 2,
       "Everolimus sandoz 5mg 1-0-0 zyyšuji na 2-0-0 od 19.9.2026"),
  fact("Kapidin 20 mg 1-0-0, Spiriva inhal. 1-0-1, Ventolin N inhal. dle potřeby.", None, 2, "Chron. medikace: Kapidin 20mg 1-0-0, Spiriva inhal. 1-0-1 + Ventolin N inhal. dlp."),
  fact("Neurol 0,25 mg dle potřeby při úzkosti.", None, 2, "Při úzkosti, neklidu Neurol 0,25mg ltbl. dlp."),
  fact("Natrii chloridum 1,0 g 1-0-1; Calcichew 1000/800 IU 0-0-1 pro hypokalcémii.", None, 2,
       "Cps. Natrii chloridi l,Og 1-0-1, pro hypokalcémii Calcichew 1000/SOOIU 0-0-1.", certainty="unclear_ocr",
       note="OCR: 'l,Og' = 1,0 g, 'SOOIU' pravděpodobně 800 IU."),
  fact("Při nevolnosti Degan 10 mg, případně Novetron 8 mg; při průjmu Imodium, případně Smecta.", None, 2,
       "Při nevolnosti doma užívat Degan 10mg tbl. 1-1-1"),
  fact("Orcal 10 mg 1/2-0-0 (nasazeno na interně).", "10.2.2026", 5, "nově k medikaci Orcal 10 mg tbl 1/2-0-0"),
  fact("Erdomed 300 mg 1-1-0 (doporučení plicní ambulance).", "22.5.2026", 5, "Erdomed 300mg 1-1-0"),
  fact("ACE inhibitory kontraindikovány (riziko anafylaxe při everolimu).", None, 2, "Kontraindikovány jsou ACEi pro zyýšené riziko anafylace."),
  fact("Spiriva: na str. 2 dávkování 1-0-1, na str. 4 a 5 '2-0-0'.", None, 4, "Spiriva rest 2-0-0 + Ventolin dlp", certainty="inferred",
       note="Pozorování asistenta: rozdílně zapsané dávkování téhož léku."),
 ],
}

def ev(date, sort, typ, label, page, quote):
    return {"date": date, "date_sort": sort, "type": typ, "label_cs": label, "source": src(page, quote)}

timeline = [
 ev("4/2022", "2022-04", "diagnosis", "Diagnóza RCC (C64), lokálně pokročilý", 1, "RCC lok. pokročilý diag. 4/2022"),
 ev("2.6.2022", "2022-06-02", "surgery", "Nefrektomie vpravo + retroperitoneální lymfadenektomie; histol. ccRCC G2, pT2a pN1 M0", 1, "2.6.2022 - stp. transperitoneálni nefrektomii vpravo"),
 ev("7.9.2022", "2022-09-07", "imaging", "CT: susp. MTS paraaortální uzliny vlevo 20 mm", 1, "CT hrudník + břicho s KL 7.9.2022"),
 ev("25.10.2022", "2022-10-25", "surgery", "Exstirpace paraaortální LU; histol. MTS ccRCC G2, R0", 1, "st.p. exstirpaci paraaortálni LU vlevo 25.10.2022"),
 ev("25.11.2022", "2022-11-25", "imaging", "CT: spíše lymfokéla než nová uzlina", 1, "CT břicha, malé pánve nativně a kontrastně 25.11.2022"),
 ev("6.3.2023", "2023-03-06", "imaging", "Baseline CT: mediastinální a hilová lymfadenopatie, hypervaskularizované MTS", 1, "baseline CT s KL 6.3.2023"),
 ev("27.3.2023", "2023-03-27", "systemic", "Nivolumab + ipilimumab, 1. cyklus", 1, "27.3.2023 1. cyklus nivolumab"),
 ev("17.4.2023", "2023-04-17", "systemic", "Nivolumab + ipilimumab, 2. cyklus", 1, "17.4.2023 2. cyklus -//-"),
 ev("28.4.2023", "2023-04-28", "other", "Imunitně podmíněná toxicita (GIT, plíce), prednison 1 mg/kg/den", 1, "od 28.4.2023 kortikoterapie prednison lmg/kg/den"),
 ev("6/2023", "2023-06", "imaging", "Restaging CT: iPR", 2, "Dle restaging. CT 6/2023 dosaženo iPR"),
 ev("27.6.2023", "2023-06-27", "systemic", "Start udržovacího nivolumabu", 1, "udržovací léčba nivolumab od 27.6.2023"),
 ev("26.7.2023", "2023-07-26", "other", "Kortikoterapie ukončena", 2, "ukončen 26.7.2023"),
 ev("21.8.2023", "2023-08-21", "other", "Implantace venózního portu", 1, "Implantace venozn1ho portu 21.8.2023"),
 ev("9/23", "2023-09", "imaging", "CT: nový spíše cystický útvar v mesogastriu, bez MTS", 2, "Při CT vyš. 9/23 popisován nově útvar"),
 ev("21.11.2023", "2023-11-21", "histology", "Excize ložiska brady: kožní metastáza ccRCC, ISUP 2", 1, "21.11.2023 excize susp. iritovaného intraderm. névu brady vlevo"),
 ev("11/2023 až 6/2025", "2023-11", "imaging", "Opakované restaging CT: trvá iPR", 2, "11/2023 + 2/2024 + 6/2024 + 10/2024 + 2/2025 + 6/2025 - trvá iPR"),
 ev("11.2.2025", "2025-02-11", "histology", "Excize léze glabely: sebaceom, bez nádorových změn", 1, "kožní leze v oblasti glabely - stp. excizi 11.2.2025"),
 ev("10.11.2025", "2025-11-10", "imaging", "CT: nová patologická LU v levém plicním hilu, iRECIST PD/iUPD", 4, "CI plic+ břicha 10.11.2025"),
 ev("29.12.2025", "2025-12-29", "systemic", "Konec udržovacího nivolumabu", 1, "do 29.12.2025"),
 ev("16.1.2026", "2026-01-16", "imaging", "CT: progrese v levém hilu a retroperitoneu, iRECIST iCPD", 4, "CI hrudník, břicho 16.1.2026"),
 ev("27.1.2026", "2026-01-27", "systemic", "2. linie: sunitinib 50 mg, režim 4/2", 1, "2. pal, linie léčby sunitinib - start 27.1.2026"),
 ev("10.2.2026", "2026-02-10", "visit", "Interní vyšetření pro dušnost; CT AG bez plicní embolie", 5, "Interní wš, 10.2.2026 NNJ"),
 ev("20.2.2026", "2026-02-20", "imaging", "ECHO: EF LK 60 %", 5, "ECHO 20.2.2026 NNJ"),
 ev("25.2.2026", "2026-02-25", "systemic", "Sunitinib redukován na 37,5 mg", 1, "od 25.2.2026 redukce o 1 stupeň"),
 ev("26.3.2026", "2026-03-26", "systemic", "Sunitinib redukován na 25 mg", 1, "od 26.3.2026 redukce o 2 stupně"),
 ev("28.4.2026", "2026-04-28", "imaging", "CT: iSD, regrese sledovaných lézí o cca 24 %", 5, "CT hrudník, břicho 28.4.2026"),
 ev("22.5.2026", "2026-05-22", "visit", "Plicní vyšetření: CHOPN II/B, lehká obstrukce", 5, "Plicní wš, 22,5,2026 MUDr.Hofrová"),
 ev("30.7.2026", "2026-07-30", "imaging", "UZ tepen DKK: stenóza PDK vpravo", 5, "uz tepen DKK 30.7.2026"),
 ev("26.8.2026", "2026-08-26", "imaging", "CT: progrese LU v levém hilu a retroperitoneu (PD)", 5, "CT hrudník, břicho, malá pánev 26.8.2026"),
 ev("3.9.2026", "2026-09-03", "systemic", "3. linie: everolimus", 1, "3, pal, linie léčby everolimus - start 3.9.2026"),
 ev("14.9.2026", "2026-09-14", "imaging", "MR mozku: solitární nodulus v pravé mozečkové hemisféře do 3 mm, susp. MTS", 1, "MR yyš, mozku 14.9.2026 NNJ"),
 ev("19.9.2026", "2026-09-19", "systemic", "Everolimus navýšen na 2-0-0 (10 mg)", 2, "zyyšuji na 2-0-0 od 19.9.2026"),
 ev("datum neuvedeno", None, "mdt", "Nález MR mozku zadán k projednání na NCH semináři", 3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři."),
 ev("9.10.2026", "2026-10-09", "visit", "Plánovaná kontrola s odběrem KO a biochemie", 3, "Kontrola zde 9.10.2026 s odběrem KO, biochemie."),
]

def lab(code, name, value, unit, rng, flag, quote, note=None):
    d = {"code": code, "name_cs": name, "value": value, "unit": unit, "reference_range": rng,
         "out_of_range": flag, "date": None, "source": src(3, quote), "certainty": "documented"}
    if note: d["note"] = note; d["certainty"] = "unclear_ocr"
    return d
labs = [
 lab("S_HSCRP", "hsCRP", "9,5", "mg/l", "0 ... 5", "high", "S_HSCRP: 9,5 mg/1 [O ... 5]", "OCR 'mg/1' = mg/l, 'O' = 0"),
 lab("S_GLC", "Glukóza", "6,7", "mmol/l", "3.9 ... 5.6", "high", "S_GLC: 6,7 mmol/l [3.9 ... 5.6]"),
 lab("S_BIL", "Bilirubin", "4,2", "µmol/l", "0 ... 21", None, "S_BIL: 4,2 µmol/l [O ... 21]"),
 lab("S_UREA", "Urea", "7,0", "mmol/l", "2.9 ... 8.2", None, "S_UREA: 7,0 mmol/1 [2.9 ... 8.2]"),
 lab("S_CREAE", "Kreatinin", "107", "µmol/l", "59 ... 104", "high", "S_CREAE: 107 µmol/1 [59 ... 104]"),
 lab("S_URAT", "Kyselina močová", "301", "µmol/l", "202 ... 417", None, "S_URAT: 301 µmol/l [202 ... 417]"),
 lab("S_ALT", "ALT", "0,48", "µkat/l", "0.17 ... 0.84", None, "S_ALT: 0,48 µkat/l [0.17 ... 0.84]"),
 lab("S_AST", "AST", "0,58", "µkat/l", "0.17 ... 0.84", None, "S....AST: 0,58 µkat/1 [0.17 ... 0.84]"),
 lab("S_ALP", "ALP", "1,30", "µkat/l", "0.67 ... 2.15", None, "S....ALP: 1,30 µkat/1 [0.67 ... 2.15]"),
 lab("S_GGT", "GGT", "0,40", "µkat/l", "0.17 ... 1.19", None, "S_GGT: 0,40 µkat/1 [0.17 ... 1.19]"),
 lab("S_NA", "Na", "140", "mmol/l", "136 ... 145", None, "S_NA: 140 mmol/l [136 ... 145]"),
 lab("S_K", "K", "4,97", "mmol/l", "3.5 ... 5.1", None, "S_K: 4,97 mmol/l [3.5 ... 5.1]"),
 lab("S_CA", "Ca", "2,24", "mmol/l", "2.2 ... 2.55", None, "S_CA: 2,24 mmol/l [2.2 ... 2.55]"),
 lab("S_CL", "Cl", "106", "mmol/l", "98 ... 107", None, "S_CL: 106 mmol/1 [98 ... 107]"),
 lab("S_OSMOLC", "Osmolalita (vypočtená)", "294", "mmol/kg", "275 ... 295", None, "S_OSMOLC: 294 mmol/kg [275 ... 295]"),
 lab("PT(KIDN)_EGFRCKDE", "eGFR CKD-EPI", "1,01", "ml/s/1,73 m2", "1.5 ... 99", "low", "PT(KIDN)_EGFRCKDE: 1,01 ml/s/1,73 m2 [1.5 ... 99]"),
 lab("B_LKC", "Leukocyty", "6,58", "10^9/l", "4 ... 10", None, "B_LKC: 6,58 10A9/l [4 ... 10]", "OCR '10A9' = 10^9"),
 lab("B_ERC", "Erytrocyty", "3,53", "10^12/l", "4 ... 5.8", "low", "B_ERC: 3,53 10Al2/l [4 ... 5.8]", "OCR '10Al2' = 10^12"),
 lab("B_HB", "Hemoglobin", "123", "g/l", "135 ... 175", "low", "B_HB: 123 g/1 [135 ... 175]"),
 lab("B_HCT", "Hematokrit", "0,363", "1", "0.4 ... 0.5", "low", "B_HCT: 0,363 1 [0.4 ... 0.5]"),
 lab("ERC(B)_MCV", "MCV", "102,8", "fl", "82 ... 98", "high", "ERC(B)_MCV: 102,8 fl [82 ... 98]"),
 lab("ERC(B)_MCH", "MCH", "34,8", "pg", "28 ... 34", "high", "ERC(B)_MCH: 34,8 pg [28 ... 34]"),
 lab("B_PLT", "Trombocyty", "156", "10^9/l", "150 ... 400", None, "B_PLT: 156 10A9/l [150 ... 400]"),
 lab("B_NEU", "Neutrofily abs.", "4,130", "10^9/l", "2 ... 7", None, "B_NEU: 4,130 10A9/l [2 ... 7]"),
 lab("B_LYMFO", "Lymfocyty abs.", "1,610", "10^9/l", "0.8 ... 4", None, "B_LYMFO: 1,610 10A9/l [0.8 ..."),
 lab("B_NLR", "NLR", "2,6", "1", "0 ... 4", None, "B_NLR: 2,6 1 [O ... 4]"),
]
labs_note = ("Jeden soubor laboratorních hodnot na str. 3, bez data odběru (pravděpodobně z kontroly kolem 14. až 19.9.2026, to je ale odhad). "
             "Trend nelze ukázat, jiné hodnoty v podkladech nejsou. Neutrofily/lymfocyty v %, PCDW, MPV, PDW, MCHC, RDW, MONO, EOS, BAS jsou v plném textu str. 3. "
             "Hodnoty a jednotky jsou opsány z dokumentu; out_of_range určil asistent porovnáním s uvedeným rozmezím.")

def ref(page, quote): return src(page, quote)
flags = [
 {"kind": "missing", "text_cs": "Chybí výslovně formulovaná otázka pro MDT. Dokument jen uvádí, že nález MR mozku je zadán k projednání na NCH semináři.",
  "based_on": [ref(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři.")],
  "note": "Pozorování asistenta. Formulář FNO má pole 'Otázka na NOCO'."},
 {"kind": "missing", "text_cs": "MR mozku 14.9.2026 je v podkladech jen jako závěr (z NNJ); plný popis, snímky ani předchozí MR mozku ke srovnání nejsou přiloženy.",
  "based_on": [ref(1, "MR yyš, mozku 14.9.2026 NNJ")], "note": "Pozorování asistenta."},
 {"kind": "missing", "text_cs": "Ložisko v mozečku (do 3 mm) je vedeno jako suspekce na MTS, histologické ani jiné ověření v podkladech není.",
  "based_on": [ref(1, "suspekce na solitérní MTS")], "note": "Suspekce, ne diagnóza."},
 {"kind": "missing", "text_cs": "Datum ambulantní zprávy (kontroly) není v OCR textu čitelné; laboratorní hodnoty nemají datum odběru.",
  "based_on": [ref(3, "S_HSCRP: 9,5 mg/1 [O ... 5]")], "note": "Záhlaví str. 4 je v OCR nečitelné. Datum lze jen odhadnout z kontextu (po 14.9.2026)."},
 {"kind": "missing", "text_cs": "Text CT 26.8.2026 na str. 5 končí neúplně; zbytek závěru (a případně další stránka zprávy) chybí.",
  "based_on": [ref(5, "progrse LU v levém pl. hilu a v retroperitonu paraaortálně vlevo. J-")], "note": "Pozorování asistenta."},
 {"kind": "contradiction", "text_cs": "Datum restagingu s mediastinální a hilovou lymfadenopatií: str. 2 uvádí 3/2022, str. 1 uvádí baseline CT 6.3.2023.",
  "based_on": [ref(2, "Další restaging. 3/2022, kde patol. mediastinální a plicní hilová lymfadenopatie"), ref(1, "baseline CT s KL 6.3.2023 patol. mediastinálni a pl. hilová lymfadenopatie")],
  "note": "Pozorování asistenta. 3/2022 by předcházelo diagnóze (4/2022) i operaci (2.6.2022); pravděpodobně překlep za 3/2023, ověřit."},
 {"kind": "unclear", "text_cs": "Hodnocení CT 11/2025: jednou 'PD (progressive disease)', jinde 'iUPD' (nepotvrzená progrese dle iRECIST).",
  "based_on": [ref(1, "11/2025 dle iRECIST iUPD - nově patol. LU v levém plic hilu"), ref(4, "dle iRECIST tedy PD (progressive disease).")],
  "note": "Pozorování asistenta. Nemusí jít o rozpor (první progrese dle iRECIST je iUPD), potvrzena 1/2026 jako iCPD."},
 {"kind": "unclear", "text_cs": "Nivolumab + ipilimumab indikován na 4 cykly, dokumentovány 2 cykly; výslovné ukončení kombinace v textu chybí.",
  "based_on": [ref(2, "Je indikováno podání nivolumab 3mg/kg v kombinaci s ipilimumabem lmg/kg q3w 4 cykly"), ref(1, "17.4.2023 2. cyklus -//-")],
  "note": "Pozorování asistenta; z textu plyne přechod na udržovací nivolumab od 27.6.2023."},
 {"kind": "unclear", "text_cs": "Navýšení everolimu na 10 mg: str. 2 a 3 uvádí navýšení (od 19.9.2026), str. 3 zároveň podmíněně 'při dobré toleranci navýšíme'.",
  "based_on": [ref(2, "Everolimus sandoz 5mg 1-0-0 zyyšuji na 2-0-0 od 19.9.2026"), ref(3, "Při dobré toleranci navýšime everolimus na 10mg denně.")],
  "note": "Pozorování asistenta; možná text ze dvou různých kontrol. Aktuální dávku ověřit."},
 {"kind": "unclear", "text_cs": "Drobná osteoplastická ložiska do 7 mm v přechodu Th/L páteře: není jasné, ke kterému vyšetření patří, a dále se nezmiňují.",
  "based_on": [ref(5, "Drobné osteoplatické ložiska do průměru 7mm v přechodu th/L páteře.")], "note": "Pozorování asistenta; OCR sazba stránky je promíchaná."},
 {"kind": "change", "text_cs": "Progrese na sunitinibu (CT 26.8.2026), od 3.9.2026 everolimus; 14.9.2026 nově suspekce na solitární MTS v mozečku.",
  "based_on": [ref(5, "CT hrudník, břicho, malá pánev 26.8.2026"), ref(1, "3, pal, linie léčby everolimus - start 3.9.2026"), ref(1, "MR yyš, mozku 14.9.2026 NNJ")],
  "note": "Pozorování asistenta, shrnuje dokumentované události."},
 {"kind": "unclear", "text_cs": "Laboratoř: kreatinin 107 µmol/l a eGFR 1,01 ml/s/1,73 m2 mimo rozmezí, Hb 123 g/l pod rozmezím, MCV 102,8 fl nad rozmezím; lékař hodnotí laboratoř jako 'bez zásadní patologie'.",
  "based_on": [ref(3, "S_CREAE: 107 µmol/1 [59 ... 104]"), ref(3, "B_HB: 123 g/1 [135 ... 175]"), ref(3, "lab., vyš. bez zásadni patologie")],
  "note": "Pozorování asistenta: hodnoty mimo referenční rozmezí, bez klinického hodnocení. Bez dřívějších hodnot nelze určit trend."},
]

case = {
 "file": F, "page_count": len(pages),
 "patient": {"name": "Daniel Poláček", "name_as_written": "Poláček Daniel", "birth_date": None, "age": None,
             "sex": "muž", "sex_certainty": "inferred", "sex_note": "Odvozeno z textu ('Pacient po nefrektomii'); pohlaví ani RČ není uvedeno.",
             "birth_number": None, "insurer": None, "source": src(1, "Poláček Daniel"),
             "missing_note": "Datum narození, věk, rodné číslo a pojišťovna v dokumentu nejsou."},
 "mdt_question": {"text_cs": None, "status": "missing",
   "note_cs": "Otázka pro MDT není výslovně formulována. Nejbližší text: nález MR mozku zadán k projednání na NCH semináři.",
   "closest_source": src(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři.")},
 "diagnosis": {"code": "C64", "code_system": "MKN-10 (dle dokumentu)", "text_cs": "Zhoubný novotvar ledviny mimo pánvičku",
   "source": src(1, "C64 Zhoubný novotvar ledviny mimo pánvičku")},
 "summary": [
  {"text_cs": "Pacient se světlobuněčným renálním karcinomem vpravo, diagnostikovaným 4/2022, po nefrektomii s lymfadenektomií 2.6.2022 (G2, pT2a pN1 M0).", "sources": [src(1, "RCC lok. pokročilý diag. 4/2022"), src(1, "Histol. světlobuněčný renální adenokarcinom G2, pT2a pN1(3+/5) MO")]},
  {"text_cs": "Následně histologicky ověřené metastázy v paraaortální uzlině (10/2022) a v kůži brady (11/2023), od 3/2023 mediastinální a hilová lymfadenopatie charakteru MTS.", "sources": [src(1, "Histol. MTS světlobuněčného renálního karcinomu G2, R0"), src(1, "oblasti brady vlevo, grade 2 dle ISUP"), src(1, "baseline CT s KL 6.3.2023")]},
  {"text_cs": "Léčen nivolumabem s ipilimumabem (2 cykly, imunitně podmíněná toxicita) a udržovacím nivolumabem do 29.12.2025 s iPR; po progresi sunitinib od 27.1.2026, při další progresi dle CT 26.8.2026 od 3.9.2026 everolimus.", "sources": [src(1, "27.3.2023 1. cyklus nivolumab"), src(1, "udržovací léčba nivolumab od 27.6.2023 do 29.12.2025"), src(1, "2. pal, linie léčby sunitinib - start 27.1.2026"), src(1, "3, pal, linie léčby everolimus - start 3.9.2026")]},
  {"text_cs": "MR mozku 14.9.2026 popisuje solitární sytící se nodulus do 3 mm v pravé mozečkové hemisféře, suspekce na solitární MTS; nález je zadán k projednání na NCH semináři.", "sources": [src(1, "suspekce na solitérní MTS"), src(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři.")]},
  {"text_cs": "Klinicky ECOG PS 1, bez klinických známek mozkových metastáz, everolimus toleruje dobře.", "sources": [src(4, "ECOG PS: 1, bez klin. známek mozkových mts"), src(4, "everolimus toleruje výbormně")]},
 ],
 "sections": sections,
 "timeline": timeline,
 "labs": labs, "labs_note_cs": labs_note,
 "flags": flags,
 "ocr_quality_note": "Stránky 1, 2, 3 a 5 mají dobrou OCR vrstvu s běžnými chybami (l/1, O/0, 'yyš', 'ver;f;kována'). Záhlaví str. 4 je nečitelné ('Ambulantnf vyletfenf kontrolnf'), tabulky iRECIST na str. 4 a 5 jsou rozsypané. Citace jsou s normalizovanými mezerami (zalomení řádků nahrazena mezerou).",
 "full_text_by_page": [{"page": i + 1, "text": p} for i, p in enumerate(pages)],
}
out = json.dumps(case, ensure_ascii=False, indent=1)
assert "—" not in out
if bad:
    for b in bad: print("BAD", b)
    sys.exit(1)
open(S + "mock-case-10.json", "w").write(out)
print("ok", len(timeline), len(labs), len(flags), sum(len(v) for v in sections.values()))
