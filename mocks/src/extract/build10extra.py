import json, re, sys

SP = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "data") + "/"
OCR = json.load(open(SP + "ocr.json"))
col = lambda s: re.sub(r"\s+", " ", s).strip()
F10 = "10_pacient.pdf"
errors = []


def S(page, quote, file=F10):
    """Source ref; checked later against OCR."""
    return {"file": file, "page": page, "quote": quote}


def item(text, src, date=None, negated=False, certainty="documented", note=None):
    it = {"text_cs": text, "date": date, "source": src, "negated": negated, "certainty": certainty}
    if note:
        it["note_cs"] = note
    return it


GAP = "neuvedeno v dostupné dokumentaci"
q_oa1 = "OA: HN, CHOPN u fumátora (anamn. léčba přerušena pacientem), HLP na dietě,"
q_oa2 = "hyperglykémie nalačno anam., korové cysty ledvin, cysta S2 jater"
q_chron = "Chron. medikace: Kapidin 20mg 1-0-0, Spiriva inhal. 1-0-1 + Ventolin N inhal. dlp."

anamnesis = {
    "OA": [
        item("Arteriální hypertenze (HN)", S(2, q_oa1)),
        item("CHOPN u kuřáka, léčba dle anamnézy přerušena pacientem", S(2, q_oa1)),
        item("Hyperlipoproteinémie (HLP) na dietě", S(2, q_oa1)),
        item("Hyperglykémie nalačno (anamnesticky)", S(2, q_oa2)),
        item("Korové cysty ledvin", S(2, q_oa2)),
        item("Cysta S2 jater", S(2, q_oa2)),
        item("CHOPN II/B, spirometrie: lehká obstrukce; susp. intersticiální postižení, stav po kortikoterapii (plicní vyš., MUDr. Hofrová)",
             S(5, "Z: CHOPN II/B fumat., susp. interstic. post1zené, stp. kortikoterapii"), date="22.5.2026",
             certainty="unclear_ocr", note="OCR: 'post1zené' čteme jako 'postižení'; datum v OCR zapsáno '22,5,2026'."),
        item("Dušnost: plicní embolie vyloučena, EKG bez ischemických změn; dle interního vyšetření možno na vrub hypertenze, nově Orcal",
             S(5, "plicní embolie vyloučena, EKG bez ischemických změn, hstroponin stabilní bez dynamiky- možno na vrub dekorigované HT"),
             date="10.2.2026", certainty="unclear_ocr",
             note="OCR: 'dekorigované HT' pravděpodobně 'dekompenzované HT', ověřit v originálu."),
        item("UZ tepen DKK: středně silné sklerotické změny, vpravo stenóza v proximálním úseku PDK (ne těžká), doporučeno sledování",
             S(5, "Vpravo zřetelná, i když ne těžká stenosa v prox. úseku PDK. Sledování vhodné."), date="30.7.2026"),
        item("Hypokalcémie (léčena Calcichew)", S(2, "pro hypokalcémii Calcichew 1000/SOOIU 0-0-1")),
        item("Mírná hyperkalémie, dietní opatření, pacient poučen",
             S(2, "Pro mírnou hyperkalémii ve stravě omezit banány, meruňky, broskve")),
    ],
    "RA": [],
    "PA": [],
    "SA": [],
    "FA": [
        item("Everolimus Sandoz 5 mg 1-0-0, zvýšení na 2-0-0 (10 mg denně) od 19.9.2026; při netoleranci návrat k 1-0-0",
             S(2, "Everolimus sandoz 5mg 1-0-0 zyyšuji na 2-0-0 od 19.9.2026,"), date="19.9.2026", certainty="unclear_ocr",
             note="OCR: 'zyyšuji' = 'zvyšuji'. Na str. 3 je zároveň 'navyšuji' i 'Při dobré toleranci navýšime', ověřit, zda navýšení proběhlo."),
        item("Kapidin 20 mg 1-0-0 (chronická medikace)", S(2, q_chron)),
        item("Spiriva inhal. 1-0-1", S(2, q_chron),
             note="Plicní vyšetření (str. 4 a 5) uvádí Spiriva 2-0-0; dávkování se mezi částmi dokumentu liší."),
        item("Ventolin N inhal. dle potřeby", S(2, q_chron)),
        item("Neurol 0,25 mg dle potřeby při úzkosti, neklidu", S(2, "Při úzkosti, neklidu Neurol 0,25mg ltbl. dlp."),
             certainty="unclear_ocr", note="OCR: 'ltbl.' pravděpodobně 'tbl.'."),
        item("Natrii chloridi 1,0 g cps. 1-0-1", S(2, "Cps. Natrii chloridi l,Og 1-0-1"), certainty="unclear_ocr",
             note="OCR: 'l,Og' čteme jako '1,0g'."),
        item("Calcichew 1000/? IU 0-0-1 pro hypokalcémii", S(2, "pro hypokalcémii Calcichew 1000/SOOIU 0-0-1"),
             certainty="unclear_ocr", note="Síla vitaminu D v OCR nečitelná ('SOOIU'), ověřit v originálu."),
        item("Degan 10 mg 1-1-1 při nevolnosti, při nedostatečném efektu nebo zvracení Novetron 8 mg 1-0-1",
             S(2, "Při nevolnosti doma užívat Degan 10mg tbl. 1-1-1")),
        item("Imodium 2 mg při průjmu (max. 8 cps. denně), při nedostatečném efektu Smecta 1-1-1",
             S(2, "Při průjmu užívat Imodium 2mg cps., vstupně 2 cps., pak 1 cps. při každé další řídké stolici")),
        item("Orcal 10 mg 1/2-0-0, nově od interního vyšetření", S(5, "nově k medikaci Orcal 10 mg tbl 1/2-0-0"),
             date="10.2.2026"),
        item("Erdomed 300 mg 1-1-0 (doporučení plicního vyšetření)", S(5, "Erdomed 300mg 1-1-0"), date="22.5.2026"),
        item("Upozornění k everolimu: kontraindikovány ACEi pro zvýšené riziko anafylaxe",
             S(2, "Kontraindikovány jsou ACEi pro zyýšené riziko anafylace."), certainty="unclear_ocr",
             note="Jde o lékovou interakci uvedenou v doporučení, ne o alergii."),
    ],
    "AA": [],
    "abusus": [
        dict(item("Kuřák (fumátor), uvedeno u CHOPN; počet cigaret ani délka kouření uvedeny nejsou",
                  S(2, "CHOPN u fumátora"),
                  note="Stejně i v plicním vyšetření: 'CHOPN II/B fumat'. Zda jde o aktivního či bývalého kuřáka, neuvedeno."),
             pack_years={"value": None, "computed": False,
                         "note_cs": "Nelze spočítat: v dokumentaci chybí počet cigaret denně i počet let kouření."}),
    ],
    "EA": [
        item("HBsAg pozitivní", S(1, "- HBsAg pozit. pac.")),
    ],
    "preventive": [
        item("Kontrolní kolonoskopie plánována na rok 2028 (předchozí kolonoskopie v dokumentaci není)",
             S(3, "Kontrolni kolonoskopie bude r.2028."), date="r.2028"),
    ],
}
anamnesis_empty_text_cs = GAP

# ---------------- brief ----------------
brief_refs = [
    S(1, "MR yyš, mozku 14.9.2026 NNJ Závěr: Solitérní nodulus postkontrastně se sytící v pravé mozečkové hemisféře(do 3mm) - suspekce na solitérní MTS"),
    S(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři."),
    S(1, "C64 Zhoubný novotvar ledviny mimo pánvičku RCC lok. pokročilý diag. 4/2022"),
    S(1, "Histol. světlobuněčný renální adenokarcinom G2, pT2a pN1(3+/5) MO"),
    S(1, "st.p. exstirpaci paraaortálni LU vlevo 25.10.2022 Histol. MTS světlobuněčného renálního karcinomu G2, R0"),
    S(1, "baseline CT s KL 6.3.2023 patol. mediastinálni a pl. hilová lymfadenopatie - jsou hypervaskularizované mts charakteru"),
    S(1, "Histol. kožní metastáza světlebuněčného (konvenčního) karcinomu renálního origa v oblasti brady vlevo"),
    S(1, "27.3.2023 1. cyklus nivolumab 3mg/kg + ipilimumab lmg/kg q3w"),
    S(1, "udržovací léčba nivolumab od 27.6.2023 do 29.12.2025"),
    S(1, "2. pal, linie léčby sunitinib - start 27.1.2026"),
    S(5, "CT hrudník, břicho, malá pánev 26.8.2026 Závěr: Ve srovnáni s minulým CT z 4/2026 i s baseline CT z 1/2026 je patrná velikostní progrse"),
    S(1, "3, pal, linie léčby everolimus - start 3.9.2026"),
    S(4, "Statuspraesens:ECOG PS: 1, bez klin. známek mozkových mts"),
]
onco_brief_cs = (
    "Důvod projednání: MR mozku 14.9.2026 popisuje solitérní postkontrastně se sytící nodulus v pravé mozečkové "
    "hemisféře (do 3 mm), suspekce na solitérní MTS [1]; ošetřující lékař nález zadal k projednání na NCH semináři [2]. "
    "Diagnóza C64, renální karcinom diagnostikovaný 4/2022 [3], stav po nefrektomii vpravo 2.6.2022, histologicky "
    "světlobuněčný adenokarcinom G2, pT2a pN1 M0 [4]. "
    "Metastatické postižení: paraaortální uzlina histologicky (exstirpace 25.10.2022, R0) [5], mediastinální a plicní hilová "
    "lymfadenopatie charakteru MTS na baseline CT 6.3.2023 [6] a kožní metastáza brady histologicky (excize 21.11.2023) [7]. "
    "Léčba: nivolumab s ipilimumabem od 27.3.2023 [8], udržovací nivolumab do 29.12.2025 [9], 2. linie sunitinib od 27.1.2026 [10], "
    "po progresi na CT 26.8.2026 [11] 3. linie everolimus od 3.9.2026 [12]. "
    "Při poslední zaznamenané kontrole (datum neuvedeno) ECOG PS 1, bez klinických známek mozkových metastáz [13]."
)

# ---------------- detailed ----------------
refs = []


def R(page, quote):
    refs.append(S(page, quote))
    return len(refs) - 1


onco_detailed = []


def line(label, text, *ref_ids):
    onco_detailed.append({"label_cs": label, "text_cs": text, "refs": list(ref_ids)})


line("Diagnóza", "C64 Zhoubný novotvar ledviny mimo pánvičku; renální karcinom (RCC) lokálně pokročilý, diagnostikován 4/2022.",
     R(1, "C64 Zhoubný novotvar ledviny mimo pánvičku RCC lok. pokročilý diag. 4/2022"))
line("2.6.2022", "Transperitoneální nefrektomie vpravo s retroperitoneální lymfadenektomií; histologie: světlobuněčný renální adenokarcinom G2, pT2a pN1 (3+/5) M0.",
     R(1, "2.6.2022 - stp. transperitoneálni nefrektomii vpravo s retroperitoneálni lymfadenektomii"),
     R(1, "Histol. světlobuněčný renální adenokarcinom G2, pT2a pN1(3+/5) MO"))
line("9-10/2022", "CT 7.9.2022: susp. MTS paraaortální uzliny vlevo 20 mm; exstirpace 25.10.2022, histologie: MTS světlobuněčného renálního karcinomu G2, R0.",
     R(1, "CT hrudník + břicho s KL 7.9.2022 - susp. MTS paraaortálni uzlina vlevo 20mm"),
     R(1, "st.p. exstirpaci paraaortálni LU vlevo 25.10.2022 Histol. MTS světlobuněčného renálního karcinomu G2, R0"))
line("11/2022", "CT 25.11.2022: spíše lymfokéla po lymfadenektomii (kolekce do 36 mm paraaortálně vlevo) než nová zvětšená uzlina.",
     R(1, "susp. lymfokéla po lymfadenektomii spíše ohraničená kolekce tekutiny do 36 mm vlevo paraaortálně"))
line("3/2023", "Baseline CT 6.3.2023: patologická mediastinální a plicní hilová lymfadenopatie charakteru hypervaskularizovaných MTS; dle IMDC střední prognóza (1 faktor). Pozn.: souhrn na str. 2 uvádí tento restaging jako '3/2022', ověřit.",
     R(1, "baseline CT s KL 6.3.2023 patol. mediastinálni a pl. hilová lymfadenopatie"),
     R(1, "Dle IMDC střední prognóza - 1 faktor"),
     R(2, "Další restaging. 3/2022, kde patol. mediastinální a plicní hilová lymfadenopatie"))
line("3-7/2023", "1. linie nivolumab 3 mg/kg + ipilimumab 1 mg/kg q3w, indikovány 4 cykly (schváleno KOC komisí); podány cykly 27.3. a 17.4.2023. Po 2. cyklu GIT toxicita 1. st. a plicní toxicita (IPP) 1.-2. st., prednison od 28.4.2023, snižování od 12.5.2023, ukončen 26.7.2023.",
     R(2, "Je indikováno podání nivolumab 3mg/kg v kombinaci s ipilimumabem lmg/kg q3w 4 cykly - schváleno KOC komisi."),
     R(1, "27.3.2023 1. cyklus nivolumab 3mg/kg + ipilimumab lmg/kg q3w - 17.4.2023 2. cyklus"),
     R(2, "Proto od 12.5.2023 zahájeno postupné snižování dávky kortikoidu, ukončen 26.7.2023."))
line("6/2023-12/2025", "CT 6/2023 iPR; udržovací nivolumab 240 mg q2w od 27.6.2023 do 29.12.2025. Restagingová CT 11/2023 až 6/2025: trvá iPR. CT 9/2023: nový útvar 21x27 mm v mesogastriu, spíše cystický.",
     R(2, "Dle restaging. CT 6/2023 dosaženo iPR, proto pokračujeme v udržovací léčbě nivolumabem 240mg q2w."),
     R(1, "udržovací léčba nivolumab od 27.6.2023 do 29.12.2025"),
     R(2, "CT vyš. 11/2023 + 2/2024 + 6/2024 + 10/2024 + 2/2025 + 6/2025 - trvá iPR"),
     R(2, "Při CT vyš. 9/23 popisován nově útvar do 21x27 mm vlevo ventrálně v mesogastriu, etiologie je spíše cystická"))
line("8/2023", "Implantace venózního portu 21.8.2023 (Medcomp power-port).",
     R(1, "Implantace venozn1ho portu 21.8.2023"))
line("11/2023", "Excize ložiska na bradě vlevo 21.11.2023: kožní metastáza světlobuněčného renálního karcinomu, grade 2 dle ISUP, odstraněna kompletně.",
     R(1, "21.11.2023 excize susp. iritovaného intraderm. névu brady vlevo"),
     R(1, "grade 2 dle ISUP, odstraněná kompletně"))
line("2/2025", "Excize kožní léze glabely 11.2.2025: sebaceom, kompletně odstraněn, bez nádorových změn.",
     R(1, "kožní leze v oblasti glabely - stp. excizi 11.2.2025, histol. sebaceom, kompletně odstraněn"))
line("11/2025", "CT 10.11.2025: nově patologická LU v levém plicním hilu, mírná progrese retroperitoneální lymfadenopatie proti CT 6/2025; dle iRECIST PD (iUPD).",
     R(4, "navíc nově patol. LU v levém plicním hílu - dle iRECIST tedy PD (progressive disease)"),
     R(1, "11/2025 dle iRECIST iUPD - nově patol. LU v levém plic hilu"))
line("1/2026", "CT 16.1.2026: progrese uzlin v levém hilu a jedné LU retroperitonea; dle iRECIST iCPD.",
     R(4, "v levém hilu je velikostní progrese uzlin od baseline i ve srovnání s minulým CT"),
     R(4, "Dle iRECIST iCPD."))
line("1-3/2026", "2. linie sunitinib 50 mg denně v režimu 4/2 od 27.1.2026 (schváleno KOC komisí); pro progresi renální insuficience, minerálovou dysbalanci, trombocytopenii G2-3 a hepatopatii G2 redukce na 37,5 mg od 25.2.2026 a na 25 mg od 26.3.2026.",
     R(2, "Léčbu zahájil od 27.1.2026 v režimu 4/2."),
     R(1, "při dávce 50mg denně progrese renální insuf., minerálová dysbalance a trombocytopenie G2-3"),
     R(1, "od 26.3.2026 redukce o 2 stupně - dávka 25mg denně"))
line("2/2026", "CT AG plicnice 10.2.2026: bez plicní embolie. V textu je dále věta o drobných osteoplastických ložiscích do 7 mm v přechodu Th/L páteře; ke kterému vyšetření patří, nelze z OCR jednoznačně určit.",
     R(5, "Závěr: Bez plicní embolie, jen drobná cysta v HL vpravo."),
     R(5, "Drobné osteoplatické ložiska do průměru 7mm v přechodu th/L páteře."))
line("4/2026", "CT 28.4.2026: mírná regrese LU v levém hilu a v retroperitoneu, nová ložiska nepřibyla, regrese sledovaných lézí o cca 24 %; dle iRECIST iSD.",
     R(5, "Velikostní regrese sledovaných lézi je o cca 24 %."))
line("8/2026", "CT 26.8.2026: progrese LU v levém plicním hilu a retroperitoneu paraaortálně vlevo (PD); sunitinib ukončen.",
     R(5, "je patrná velikostní progrse LU v levém pl. hilu a v retroperitonu paraaortálně vlevo."),
     R(2, "Proto léčbu sunitinibem ukončuji."))
line("9/2026", "3. linie everolimus od 3.9.2026 (schváleno KOC komisí); cabozantinib (par. 16) ponechán do 4. linie. Zvýšení dávky everolimu na 10 mg denně od 19.9.2026.",
     R(1, "3, pal, linie léčby everolimus - start 3.9.2026"),
     R(2, "Do 3. pal. linie léčby indikován everolimus - schváleno KOC komisi."),
     R(3, "par. 16 ponecháme do 4. linie."),
     R(2, "zyyšuji na 2-0-0 od 19.9.2026"))
line("14.9.2026", "MR mozku: solitérní postkontrastně se sytící nodulus v pravé mozečkové hemisféře do 3 mm, suspekce na solitérní MTS; jiné sytící se léze intrakraniálně nejsou; gliózy supratentoriálně Fazekas gr. III.",
     R(1, "Solitérní nodulus postkontrastně se sytící v pravé mozečkové hemisféře(do 3mm) - suspekce na solitérní MTS"),
     R(1, "Gliózy supratentoriálně Fazekas gr. III."))
line("Aktuálně", "Everolimus toleruje velmi dobře, závratě a poruchy rovnováhy neguje; ECOG PS 1, bez klinických známek mozkových MTS (datum kontroly neuvedeno). Nález MR zadán na NCH seminář; kontrola 9.10.2026 s odběrem KO a biochemie; kontrolní CT H+B+MP plánováno, datum v OCR chybí.",
     R(4, "nově předepsaný everolimus toleruje výbormně, nemá s ním žádný problém."),
     R(4, "Na cílený dotaz neguje závratě či poruchy rovnováhy"),
     R(4, "Statuspraesens:ECOG PS: 1, bez klin. známek mozkových mts"),
     R(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři."),
     R(3, "Kontrola zde 9.10.2026 s odběrem KO, biochemie."),
     R(3, "Kontrolní CT H+B+MP bude v 9.20hod. nalačno v NNJ."))

# ---------------- timeline ----------------
def card(date, sort, kind, title, text, detail, status, src):
    assert len(title) <= 40, title
    return {"date": date, "date_sort": sort, "kind": kind, "title_cs": title, "text_cs": text,
            "detail_cs": detail, "status": status, "source": src}


timeline_cards = [
    card("4/2022", "2022-04", "diagnosis", "Diagnóza RCC (C64)", "Renální karcinom lokálně pokročilý, diag. 4/2022.",
         "Dokument uvádí diagnózu C64 Zhoubný novotvar ledviny mimo pánvičku, RCC lokálně pokročilý, diagnostikovaný 4/2022. Přesný den ani vyšetření, kterým byla diagnóza stanovena, uvedeny nejsou.",
         "done", S(1, "RCC lok. pokročilý diag. 4/2022")),
    card("2.6.2022", "2022-06-02", "surgery", "Nefrektomie vpravo", "Nefrektomie vpravo s retroperitoneální lymfadenektomií; ccRCC G2, pT2a pN1 M0.",
         "Transperitoneální nefrektomie vpravo s retroperitoneální lymfadenektomií. Histologie: světlobuněčný renální adenokarcinom G2, pT2a pN1 (3+/5) M0. Původní histologická zpráva v PDF není, jen citace ve zprávě.",
         "done", S(1, "2.6.2022 - stp. transperitoneálni nefrektomii vpravo s retroperitoneálni lymfadenektomii")),
    card("25.10.2022", "2022-10-25", "surgery", "Exstirpace paraaortální LU", "Histologicky MTS ccRCC G2, R0.",
         "CT 7.9.2022 popsalo suspektní MTS paraaortální uzliny vlevo 20 mm. Uzlina exstirpována 25.10.2022, histologicky metastáza světlobuněčného renálního karcinomu G2, R0.",
         "done", S(1, "st.p. exstirpaci paraaortálni LU vlevo 25.10.2022 Histol. MTS světlobuněčného renálního karcinomu G2, R0")),
    card("6.3.2023", "2023-03-06", "imaging", "Baseline CT: lymfadenopatie", "Mediastinální a plicní hilová lymfadenopatie charakteru MTS.",
         "Baseline CT s KL popisuje patologickou mediastinální a plicní hilovou lymfadenopatii charakteru hypervaskularizovaných MTS. Dle IMDC střední prognóza (1 faktor). Souhrn na str. 2 uvádí tento restaging jako 3/2022, pravděpodobně překlep, ověřit.",
         "done", S(1, "baseline CT s KL 6.3.2023 patol. mediastinálni a pl. hilová lymfadenopatie")),
    card("27.3.2023", "2023-03-27", "systemic", "1. linie: nivolumab + ipilimumab", "Zahájen nivolumab 3 mg/kg + ipilimumab 1 mg/kg q3w.",
         "Indikovány 4 cykly, schváleno KOC komisí; dokumentovány 2 cykly (27.3. a 17.4.2023). Po 2. cyklu GIT toxicita 1. st. a plicní toxicita (IPP) 1.-2. st., prednison od 28.4.2023 do 26.7.2023.",
         "done", S(1, "27.3.2023 1. cyklus nivolumab 3mg/kg + ipilimumab lmg/kg q3w")),
    card("27.6.2023", "2023-06-27", "systemic", "Udržovací nivolumab", "Nivolumab 240 mg q2w od 27.6.2023 do 29.12.2025.",
         "Dle CT 6/2023 dosaženo iPR, proto udržovací nivolumab. Restagingová CT 11/2023 až 6/2025 popisují trvající iPR. Léčba ukončena 29.12.2025.",
         "done", S(1, "udržovací léčba nivolumab od 27.6.2023 do 29.12.2025")),
    card("21.11.2023", "2023-11-21", "pathology", "Kožní MTS na bradě", "Excize ložiska brady vlevo: kožní MTS ccRCC, G2 ISUP.",
         "Excize suspektního névu brady vlevo. Histologie: kožní metastáza světlobuněčného (konvenčního) renálního karcinomu, grade 2 dle ISUP, odstraněna kompletně. Dle pacienta ložisko pozoroval cca od 6/2023.",
         "done", S(1, "21.11.2023 excize susp. iritovaného intraderm. névu brady vlevo")),
    card("10.11.2025", "2025-11-10", "imaging", "CT: progrese (iUPD)", "Nová patologická LU v levém plicním hilu.",
         "Proti baseline 3/2023 trvá mírná regrese retroperitoneální lymfadenopatie, proti CT 6/2025 však mírná progrese. Nově patologická LU v levém plicním hilu, dle iRECIST PD (iUPD).",
         "done", S(4, "navíc nově patol. LU v levém plicním hílu - dle iRECIST tedy PD (progressive disease)")),
    card("16.1.2026", "2026-01-16", "imaging", "CT: potvrzená progrese (iCPD)", "Progrese uzlin v levém hilu a LU retroperitonea.",
         "Regrese mediastinální a pravostranné hilové lymfadenopatie, ale velikostní progrese uzlin v levém hilu proti baseline i předchozímu CT a progrese jedné LU retroperitonea. Dle iRECIST iCPD.",
         "done", S(4, "Dle iRECIST iCPD.")),
    card("27.1.2026", "2026-01-27", "systemic", "2. linie: sunitinib", "Sunitinib 50 mg denně v režimu 4/2.",
         "Schváleno KOC komisí. Pro toxicitu (renální insuficience, minerálová dysbalance, trombocytopenie G2-3, hepatopatie G2) redukce na 37,5 mg od 25.2.2026 a na 25 mg od 26.3.2026.",
         "done", S(2, "Léčbu zahájil od 27.1.2026 v režimu 4/2.")),
    card("28.4.2026", "2026-04-28", "imaging", "CT: stabilní nemoc (iSD)", "Regrese sledovaných lézí o cca 24 %.",
         "Proti baseline 1/2026 mírná regrese LU v levém plicním hilu a parciální regrese LU v retroperitoneu, nová ložiska nepřibyla. Dle iRECIST iSD.",
         "done", S(5, "Velikostní regrese sledovaných lézi je o cca 24 %.")),
    card("26.8.2026", "2026-08-26", "imaging", "CT: progrese", "Progrese LU v levém hilu a paraaortálně vlevo.",
         "Proti CT 4/2026 i baseline 1/2026 velikostní progrese LU v levém plicním hilu a v retroperitoneu paraaortálně vlevo. Na základě toho ukončen sunitinib.",
         "done", S(5, "je patrná velikostní progrse LU v levém pl. hilu a v retroperitonu paraaortálně vlevo.")),
    card("3.9.2026", "2026-09-03", "systemic", "3. linie: everolimus", "Everolimus 5 mg denně, od 19.9.2026 10 mg.",
         "Schváleno KOC komisí; cabozantinib ponechán do 4. linie. Pro dobrou toleranci zvýšení dávky na 10 mg denně od 19.9.2026.",
         "done", S(1, "3, pal, linie léčby everolimus - start 3.9.2026")),
    card("14.9.2026", "2026-09-14", "imaging", "MR mozku: susp. MTS mozečku", "Solitérní nodulus v pravé mozečkové hemisféře do 3 mm.",
         "Solitérní postkontrastně se sytící nodulus v pravé mozečkové hemisféře do 3 mm, suspekce na solitérní MTS; jiné sytící se léze intrakraniálně nejsou. Supratentoriálně gliózy Fazekas gr. III. Původní popis MR v PDF není, jen citace závěru.",
         "done", S(1, "Solitérní nodulus postkontrastně se sytící v pravé mozečkové hemisféře(do 3mm) - suspekce na solitérní MTS")),
    card(None, None, "mdt", "NCH seminář: nález MR mozku", "Nález MR mozku zadán k projednání na NCH semináři.",
         "Ošetřující onkolog zadal nález MR mozku k projednání na neurochirurgickém semináři. Termín ani formulovaná otázka v dokumentu uvedeny nejsou.",
         "planned", S(3, "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři.")),
    card("9.10.2026", "2026-10-09", "visit", "Kontrola na onkologii", "Kontrola s odběrem KO a biochemie.",
         "Dokument plánuje kontrolu 9.10.2026 s odběrem krevního obrazu a biochemie a domácí měření TK. Zda kontrola na str. 4 je tato kontrola, dokument neuvádí.",
         "planned", S(3, "Kontrola zde 9.10.2026 s odběrem KO, biochemie.")),
]
for t in timeline_cards:
    if t["date"] is None:
        t["date_note_cs"] = "datum neuvedeno v dostupné dokumentaci"

# ---------------- documents ----------------
documents = [
    {"title_cs": "Ambulantní vyšetření kontrolní (onkologie): onkologická anamnéza, doporučení, plán",
     "type": "ambulantní zpráva", "date": None, "pages": [1, 2, 3],
     "date_note_cs": "Datum vyšetření neuvedeno; obsahuje MR 14.9.2026 a zvýšení everolimu od 19.9.2026.",
     "readability": "fair",
     "reason_cs": "Text je čitelný, ale OCR chyby v datech a zkratkách: 'cr' místo 'CT', '1112023' a '212024' místo '11/2023' a '2/2024', 'PO'/'PP' místo 'PD', 'lmg/kg', 'zyyšuji'. Chybí datum kontrolního CT."},
    {"title_cs": "Laboratorní výsledky (biochemie, krevní obraz)", "type": "jiné", "date": None, "pages": [3],
     "date_note_cs": "Datum odběru neuvedeno.",
     "readability": "fair",
     "reason_cs": "Hodnoty a referenční meze čitelné, ale jednotky a znaky zkomolené: 'mmol/1' místo 'mmol/l', '[O ... 5]' místo '[0 ... 5]', '10A9/l' místo '10^9/l'."},
    {"title_cs": "Ambulantní vyšetření kontrolní: subjektivně, objektivní nález, přehled vyšetření", "type": "ambulantní zpráva",
     "date": None, "pages": [4, 5],
     "date_note_cs": "Datum neuvedeno; pacient již užívá nově předepsaný everolimus.",
     "readability": "poor",
     "reason_cs": "Hlavička nečitelná ('Ambulantnf vyletfenf kontrolnf', znakový šum), tabulky iRECIST rozpadlé do sloupců bez přiřazení hodnot, 'CI'/'cr' místo 'CT', 'wš' místo 'vyš.', 'T-7éze'."},
    {"title_cs": "MR mozku 14.9.2026 NNJ (citovaný závěr)", "type": "radiologie", "date": "14.9.2026", "pages": [1],
     "embedded_in_cs": "citace v ambulantní zprávě, původní popis v PDF není", "readability": "good",
     "reason_cs": "Závěr čitelný, jen 'yyš,' místo 'vyš.'."},
    {"title_cs": "CT plic + břicha 10.11.2025 (citovaný závěr)", "type": "radiologie", "date": "10.11.2025", "pages": [4],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair", "reason_cs": "Závěr čitelný, 'CI' místo 'CT', 'velí kosti'."},
    {"title_cs": "CT hrudník, břicho 16.1.2026 (citovaný závěr a tabulka iRECIST)", "type": "radiologie", "date": "16.1.2026", "pages": [4],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "poor",
     "reason_cs": "Závěr čitelný, tabulka měření lézí rozpadlá, hodnoty nelze spolehlivě přiřadit k lézím."},
    {"title_cs": "CT AG plicnice 10.2.2026 (citovaný závěr)", "type": "radiologie", "date": "10.2.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair",
     "reason_cs": "'cr Ag' místo 'CT AG'; věta o osteoplastických ložiskách stojí uvnitř rozpadlé tabulky a není jasné, ke kterému CT patří."},
    {"title_cs": "Interní vyšetření 10.2.2026 NNJ (dušnost)", "type": "ambulantní zpráva", "date": "10.2.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair", "reason_cs": "'wš' místo 'vyš.', 'dekorigované HT' nejasné."},
    {"title_cs": "ECHO 20.2.2026 NNJ", "type": "jiné", "date": "20.2.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "good", "reason_cs": "Text čitelný, drobné překlepy."},
    {"title_cs": "CT hrudník, břicho 28.4.2026 (závěr a tabulka iRECIST)", "type": "radiologie", "date": "28.4.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair",
     "reason_cs": "Závěr čitelný, tabulka měření rozpadlá do sloupců, 'nep�ibyla'."},
    {"title_cs": "Plicní vyšetření 22.5.2026 MUDr. Hofrová", "type": "ambulantní zpráva", "date": "22.5.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair", "reason_cs": "Datum zapsáno '22,5,2026', 'post1zené'."},
    {"title_cs": "UZ tepen DKK 30.7.2026", "type": "radiologie", "date": "30.7.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "good", "reason_cs": "Text čitelný."},
    {"title_cs": "CT hrudník, břicho, malá pánev 26.8.2026 (citovaný závěr)", "type": "radiologie", "date": "26.8.2026", "pages": [5],
     "embedded_in_cs": "citace v ambulantní zprávě", "readability": "fair",
     "reason_cs": "Závěr čitelný ('progrse'), text na konci stránky useknutý ('J-')."},
]
documents_note_cs = ("PDF neobsahuje originální histologické zprávy (nefrektomie 2.6.2022, exstirpace LU 25.10.2022, "
                     "excize 21.11.2023, excize 11.2.2025) ani originální popis MR mozku 14.9.2026; jsou jen citovány ve zprávách.")

# ---------------- others ----------------
def other(file, dx, dx_src, mkn=None, mkn_src=None, doc=None, dept=None, ctx=None, ctx_src=None, extra=None):
    o = {"file": file, "diagnosis_cs": dx, "diagnosis_source": S(1 if not isinstance(dx_src, tuple) else dx_src[0],
                                                                    dx_src if not isinstance(dx_src, tuple) else dx_src[1], file),
         "mkn10": mkn, "referring_doctor": doc, "referring_department": dept}
    if mkn_src:
        o["mkn10_source"] = S(mkn_src[0], mkn_src[1], file)
    if extra:
        o.update(extra)
    if ctx:
        o["context_note_cs"] = ctx
        o["context_source"] = S(ctx_src[0], ctx_src[1], file)
    return o


others = [
    other("2_pacient.pdf", "High grade gliový tumor temporálně vpravo, dle pooperační MR GBM",
          "Histologie - jde o struktury high grade glialniho tumoru",
          ctx="Odesílající lékař ani pracoviště neuvedeny.", ctx_src=(1, "Kotěrova Jaroslava, poj. 205")),
    other("9_pacient.pdf", "Invazivní karcinom NST levého prsu, G2, pT2 N1mi(1+/3sn) M0 (2023); MTS do skeletu",
          (2, "C509 ZN - prs NS C795 Sekundární ZN kosti a kostní dřeně"),
          mkn="C509", mkn_src=(2, "C509 ZN - prs NS"),
          extra={"mkn10_other": ["C795"]},
          ctx="Odesílající lékař ani pracoviště neuvedeny; jde o kontrolní ambulantní zprávu, léčba schválena KOC komisí.",
          ctx_src=(3, "Nález na PET/CT vyš. bude prezentován na NCH semináři k posouzení indikace NCH intervence")),
    other("11_pacient.pdf", "V.s. neurinom akustiku vlevo, Koos I; drobný meningeom F parafalcinně vlevo, do 6 mm",
          (2, "v.s. neurinom akustiku vlevo- Koos I."),
          ctx="Odesílající lékař ani pracoviště neuvedeny; dokument zmiňuje příjem na neurologickou JIP.",
          ctx_src=(1, "proto příjem na neurologickou JIP")),
    other("13_pacient.pdf", "Kalcifikovaný meningeom parietálně vlevo, 12 x 9 mm",
          "Parietálně vlevo pod calvou kalcifikovaný meningeom vel. 12 x 9 mm.",
          ctx="Odesílající lékař ani pracoviště neuvedeny. MUDr. Walach je uveden u CT vyšetření, MUDr. Cibulková jako 'Vidi', ani jeden výslovně jako odesílající.",
          ctx_src=(1, "Vidi MUDr. Cibulková")),
    other("15_pacient.pdf", "V.s. ependymom či subependymom postranní komory vpravo, 7x6 mm",
          "Závěr: Stacionární obraz v.s. ependymomu či subependymomu postranní komory vpravo.",
          ctx="Dokument obsahuje jen popis MR; odesílající lékař ani pracoviště neuvedeny.",
          ctx_src=(1, "MR mozku nativ+ aplikace k l. bez reakce.")),
    other("17_pacient.pdf", "Intraoseální ložisko kalvy F vpravo, DD intraoseální meningeom x MTS",
          "v diff.dg. intraoseální meningeom x meta ložisko v rámci zákl dg.",
          ctx="Odesílající lékař ani pracoviště výslovně neuvedeny; dokument zmiňuje hospitalizaci na ORL.",
          ctx_src=(1, "Nyní za hospitalizace na ORL doplněno CT mozku")),
    other("18_pacient.pdf", "Syringomyelie Th4-Th12, drobný ependymom v oblasti konu nelze vyloučit",
          "drobný ependymom v terénu výrazné syringomyelie nevyloučím",
          ctx="Odesílající lékař ani pracoviště neuvedeny; pole 'Popisující lékař' je prázdné. Dokument zmiňuje předchozí propuštění z neurologického oddělení.",
          ctx_src=(1, "nedávno propuštěn z neu odd.")),
    other("19_pacient.pdf", "Dvě výdutě ACI vlevo pod bazí lební, cca 2 a 3 mm; fraktura baze dens axis",
          "vlevo dvě sousedící výdutě stěny ACI o vel. cca 2 mm a 3 mm pod bazí lebky",
          ctx="Odesílající lékař ani pracoviště neuvedeny.",
          ctx_src=(1, "Jméno pacienta: Martina")),
    other("20_pacient.pdf", "Infiltrace obratlových těl C6-Th1, DD spondylodiscitida x maligní infiltrace",
          "Dif.dg.: susp. rozsáhlé zánětlivé změny (spondylodiscitis?) / maligní infiltrace? (CAVE pac. s CA prostaty v anamnéze).",
          ctx="Odesílající lékař ani pracoviště výslovně neuvedeny; dokument zmiňuje přijetí na neurologické standardní oddělení.",
          ctx_src=(1, "Přijat na neurologické standardní oddělení")),
]

out = {
    "file": F10,
    "generated_note_cs": "Mock data pro UI, vytvořeno ručně z OCR textu fiktivního pacienta; každá citace je doslovný úsek OCR textu (po sloučení mezer).",
    "anamnesis": anamnesis,
    "anamnesis_empty_text_cs": anamnesis_empty_text_cs,
    "onco_brief_cs": onco_brief_cs,
    "onco_brief_refs": brief_refs,
    "onco_detailed": onco_detailed,
    "refs": refs,
    "timeline_cards": timeline_cards,
    "documents": documents,
    "documents_note_cs": documents_note_cs,
    "others": others,
}

# ---------------- verify ----------------
def walk(o, path=""):
    if isinstance(o, dict):
        if set(["file", "page", "quote"]) <= set(o):
            pages = OCR[o["file"]]
            txt = col(pages[o["page"] - 1])
            if col(o["quote"]) not in txt:
                errors.append((path, o["file"], o["page"], o["quote"]))
            if len(o["quote"]) > 160:
                errors.append(("TOO LONG", path, len(o["quote"])))
        for k, v in o.items():
            walk(v, path + "." + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk(v, path + f"[{i}]")


walk(out)
s = json.dumps(out, ensure_ascii=False, indent=1)
if "—" in s:
    errors.append("EM DASH")
# citation markers match ref count
marks = [int(m) for m in re.findall(r"\[(\d+)\]", onco_brief_cs)]
if marks != list(range(1, len(brief_refs) + 1)) and sorted(set(marks)) != list(range(1, len(brief_refs) + 1)):
    errors.append(("marks", marks))
print("brief marks order:", marks)
print("timeline cards:", len(timeline_cards), "refs:", len(refs))
if errors:
    for e in errors:
        print("ERR", e)
    sys.exit(1)
open(SP + "mock-case-10-extra.json", "w").write(s)
print("OK written")
