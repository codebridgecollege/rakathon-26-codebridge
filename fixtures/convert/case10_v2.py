"""Case 10 (10_pacient.pdf, FNO's synthetic patient) as codebridge.extraction/2 fact specs, written by hand from
today's fixture (fixtures/data/mock-case-10.json and mock-case-10-extra.json) and checked against the page text.

Every view item of today's case view maps to the facts below (convert_v2.py reports any that does not). Rules followed:
- one fact per statement: the plan line, the vital signs and "ECOG PS 1, bez klin. známek mozkových mts" are split;
- a negation stays a negated fact ("bez nádorových změn", "neguje závratě"), never silence;
- dates stay as written (partial dates partial, "22,5,2026" as the OCR has it);
- `negated` is true when the whole statement is a negative finding (a symptom denied, a metastasis excluded, "bez
  plicní embolie"); an exam line that mixes findings ("eupnoe, bez cyanózy, ...") keeps its negations in `text` and is
  not negated as a whole;
- values the OCR misread keep the misreading in the quote and get the "ověřit" mark with the reason, unless today's
  fixture records that the Tesseract and AI readings agree on the corrected token (ocr_check rule "agree", the view's
  rule since round 25): then the source keeps that reading check and the fact is clear ("lmg/kg", "l,Og");
- `text` fields carry today's wording of the line, so the view can show the same line from the fact.
Quotes refer to today's shared refs array (R) or give the passage directly (Q). Page parts follow
extra.documents: 0 outpatient report p1-3, 1 labs p3, 2 outpatient report p4-5, 3 MR 14.9.2026, 4 CT 10.11.2025,
5 CT 16.1.2026, 6 CT AG 10.2.2026, 7 internal exam 10.2.2026, 8 ECHO, 9 CT 28.4.2026, 10 pulmonary exam 22.5.2026,
11 UZ 30.7.2026, 12 CT 26.8.2026.
"""

import json
from pathlib import Path

from spec import (
    AlertSpec,
    Q,
    Spec,
    ae,
    code,
    comor,
    contra,
    dec,
    dx,
    exam,
    hist,
    img,
    med,
    meta,
    perf,
    plan,
    visit,
    proc,
    prog,
    req,
    resp,
    risk,
    stage,
    sym,
    ther,
    verify,
    vital,
)

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "fixtures/data"
CASE = json.loads((DATA / "mock-case-10.json").read_text(encoding="utf-8"))
EXTRA = json.loads((DATA / "mock-case-10-extra.json").read_text(encoding="utf-8"))

CASE_ID = "NO-010"
DOCUMENT = "10_pacient"
# The part a page belongs to when a quote names none: the outpatient report (pages 1-3, then 4-5).
DEFAULT_PART = {1: 0, 2: 0, 3: 0, 4: 2, 5: 2}

# Two passages of today's refs array are not the page text: an OCR variant ("j izvy" for "jizvy") and a character the
# fixture replaced with U+FFFD ("nep�ibyla" for "nepJibyla"). The page text wins; the fact keeps the reading.
REF_FIX = {115: "ST. LOC . .  : jizvy pod pravým i levým obloukem žeberním klidné.", 62: "Nová ložiska nepJibyla."}
# The same OCR variant in the older sections list, used only to map that view item to its fact in the report.
OLD_QUOTE_FIX = {"j izvy pod pravým i levým obloukem žeberním klidné": "jizvy pod pravým i levým obloukem žeberním klidné"}


def R(n: int, part: int | None = None, cited: bool | None = None) -> Q:
    ref = EXTRA["refs"][n]
    return Q(int(ref["page"]), REF_FIX.get(n, ref["quote"]), part, cited)


U = ["date"]  # not_stated for the undated outpatient visit (status praesens, p4)
# The nephrectomy line with the histology under it: the date 2.6.2022 is on the first line, so a fact dated by it quotes both.
NEPH = Q(1, "2.6.2022 - stp. transperitoneálni nefrektomii vpravo s retroperitoneálni lymfadenektomii Histol. světlobuněčný renální adenokarcinom G2, pT2a pN1(3+/5) MO")

FACTS: list[Spec] = [
    # ----- diagnosis, histology, stage -----
    Spec("dx", "diagnosis", dx("RCC lok. pokročilý", None, True), date="4/2022", quotes=[R(0)],
         codes=[code("mkn-10", "C64", "Zhoubný novotvar ledviny mimo pánvičku")],
         note="Přesný den ani vyšetření, kterým byla diagnóza stanovena, uvedeny nejsou."),
    Spec("h_neph", "histology", hist("nefrektomie vpravo", "světlobuněčný renální adenokarcinom G2", "světlobuněčný renální adenokarcinom", "G2"),
         date="2.6.2022", quotes=[NEPH],
         note="Datum je datum operace; datum histologického nálezu neuvedeno. Původní histologická zpráva v PDF není, jen citace ve zprávě."),
    Spec("stage", "stage", stage("pT2a pN1(3+/5) MO", "pT2a pN1 M0", "pathological", "2.6.2022", True), date="2.6.2022",
         quotes=[NEPH], not_stated=["edition"], **verify("V textu „MO“, čteno jako M0."),
         note="Patologické TNM (pT, pN) z nefrektomie 2.6.2022, 3 z 5 uzlin pozitivní; M0 jen dle vstupní dokumentace. Stadium při diagnóze, ne aktuální stav."),
    Spec("h_ln", "histology", hist("exstirpovaná paraaortální lymfatická uzlina vlevo", "metastáza světlobuněčného renálního karcinomu G2, R0", "světlobuněčný renální karcinom", "G2"),
         date="25.10.2022", quotes=[R(4)], note="Původní histologická zpráva v PDF není, jen citace ve zprávě."),
    Spec("h_chin", "histology", hist("excize ložiska brady vlevo", "kožní metastáza světlobuněčného (konvenčního) karcinomu renálního origa, grade 2 dle ISUP, odstraněna kompletně", "světlobuněčný (konvenční) renální karcinom", "grade 2 dle ISUP"),
         date="21.11.2023", quotes=[R(48), Q(2, "histol. kožní metastáza \nsvětlebuněčného (konvenčního) karcinomu renálního origa, grade 2")],
         note="Původní histologická zpráva v PDF není, jen citace ve zprávě."),
    Spec("h_glab", "histology", hist("excize kožní léze glabely", "sebaceom, kompletně odstraněn, kůže se solární elastózou, bez nádorových změn", "sebaceom", None),
         date="11.2.2025", quotes=[R(19), R(49)], note="Původní histologická zpráva v PDF není, jen citace ve zprávě."),
    # ----- procedures -----
    Spec("p_neph", "procedure", proc("nefrektomie vpravo s retroperitoneální lymfadenektomií", "pravá ledvina", "transperitoneální nefrektomie vpravo s retroperitoneální lymfadenektomií"),
         date="2.6.2022", status="done", quotes=[R(1)]),
    Spec("p_ln", "procedure", proc("exstirpace paraaortální lymfatické uzliny vlevo", "paraaortální lymfatická uzlina vlevo"),
         date="25.10.2022", status="done", quotes=[R(4)]),
    Spec("p_port", "procedure", proc("implantace venózního portu", None, "Medcomp power-port"), date="21.8.2023", status="done",
         quotes=[R(16), R(47)]),
    Spec("p_chin", "procedure", proc("excize ložiska na bradě vlevo", "brada vlevo", "excize suspektního iritovaného intradermálního névu brady vlevo"),
         date="21.11.2023", status="done", quotes=[R(17)]),
    Spec("p_glab", "procedure", proc("excize kožní léze glabely", "glabela"), date="11.2.2025", status="done",
         quotes=[Q(1, "kožní leze v oblasti glabely - stp. excizi 11.2.2025")]),
    # ----- imaging (all cited in the outpatient report; originals are not in the PDF) -----
    Spec("i_ct2209", "imaging", img("CT s kontrastní látkou", "hrudník a břicho", "suspektní metastáza v paraaortální lymfatické uzlině vlevo, 20 mm"),
         date="7.9.2022", status="done", quotes=[R(3)]),
    Spec("i_ct2211", "imaging", img("CT nativně a kontrastně", "břicho a malá pánev", "suspektní lymfokéla po lymfadenektomii, spíše ohraničená kolekce tekutiny do 36 mm vlevo paraaortálně v úrovni L2-3 než nová zvětšená uzlina"),
         date="25.11.2022", status="done", quotes=[R(44)]),
    Spec("i_base", "imaging", img("CT s kontrastní látkou", None, "patologická mediastinální a plicní hilová lymfadenopatie charakteru hypervaskularizovaných metastáz"),
         date="6.3.2023", status="done", quotes=[R(45), Q(4, "base line CT z 03/2023", 4)],
         **verify("Souhrn na str. 2 uvádí toto vyšetření jako „3/2022“, str. 1 jako 6.3.2023 a str. 4 jako 03/2023; rozpor, ověřit.", "date_conflict")),
    Spec("i_base_p2", "imaging", img("", None, "patologická mediastinální a plicní hilová lymfadenopatie charakteru hypervaskularizovaných metastáz"),
         date="3/2022", status="done",
         quotes=[Q(2, "Další restaging. 3/2022, kde patol. mediastinální a plicní hilová lymfadenopatie charakteru hypervaskularizovaných mts.")], not_stated=["modality"],
         **verify("Str. 1 uvádí vstupní CT 6.3.2023, str. 4 vstupní CT 03/2023; „3/2022“ je před diagnózou (4/2022). Ověřit.", "date_conflict")),
    Spec("i_ct2306", "imaging", img("CT", None, "dosaženo iPR", resp("iRECIST", "iPR")), date="6/2023", status="done", quotes=[R(12)]),
    Spec("i_ct2309", "imaging", img("CT", None, "nově útvar do 21x27 mm vlevo ventrálně v mesogastriu, etiologie spíše cystická, jinak bez lymfadenopatie, bez metastáz"),
         date="9/23", status="done",
         quotes=[Q(2, "Při CT vyš. 9/23 popisován nově útvar do 21x27 mm vlevo ventrálně v mesogastriu, etiologie je spíše cystická, jinak bez lymfadenopatie, bez mts")]),
    *[
        Spec(f"i_rs_{d.replace('/', '_')}", "imaging", img("CT", None, "trvá iPR", resp("iRECIST", "iPR")), date=d, status="done", quotes=[R(14)])
        for d in ("11/2023", "2/2024", "6/2024", "10/2024", "2/2025", "6/2025")
    ],
    Spec("i_ct2511", "imaging", img("CT", "plíce a břicho", "oproti vstupnímu CT 3/2023 trvá mírná částečná regrese retroperitoneální lymfadenopatie vlevo, oproti CT 6/2025 mírná progrese velikosti; nově patologická lymfatická uzlina v levém plicním hilu", resp("iRECIST", "PD")),
         date="10.11.2025", status="done", quotes=[R(50, 4), R(51, 4), R(20, 4)]),
    Spec("i_ct2511_p1", "imaging", img("", None, "nově patologická lymfatická uzlina v levém plicním hilu", resp("iRECIST", "iUPD")),
         date="11/2025", status="done", quotes=[R(21)], not_stated=["modality"]),
    Spec("i_ct2601", "imaging", img("CT", "hrudník a břicho", "oproti vstupnímu CT regrese mediastinální a pravostranné hilové lymfadenopatie; v levém hilu velikostní progrese uzlin oproti vstupnímu i předchozímu CT; další progrese jedné lymfatické uzliny v retroperitoneu, jiná uzlina v regresi", resp("iRECIST", "iCPD")),
         date="16.1.2026", status="done",
         quotes=[R(52, 5), R(117, 5), R(22, 5), R(53, 5), R(23, 5), Q(1, "1/2026 iCPD - v levém hilu je velikostní progrese uzlin od baseline i ve srovnáni s minulým CT")]),
    Spec("i_ctag", "imaging", img("CT angiografie", "plicnice", "bez plicní embolie, jen drobná cysta v HL vpravo"),
         date="10.2.2026", status="done", quotes=[R(58, 6), R(27, 6)], **verify("V OCR „cr Ag“, čteno jako CT angiografie.")),
    Spec("i_osteo", "imaging", img("", "přechod hrudní a bederní páteře", "drobná osteoplastická ložiska do průměru 7 mm"),
         quotes=[R(28)], not_stated=["modality", "date"],
         **verify("Věta stojí v textu mezi tabulkou CT 16.1.2026 a závěrem CT angiografie 10.2.2026; ke kterému vyšetření patří, nelze z textu určit. V OCR „osteoplatické“.", "attribution_unclear"),
         note="Hodnocení ložisek ve zprávě chybí; jinde v textu se nezmiňují."),
    Spec("i_echo", "imaging", img("ECHO", "srdce", "normální velikosti srdečních oddílů, normální systolická funkce LK s EF 60 %; dobrá systolická funkce obou komor, bez hemodynamicky významné chlopenní vady"),
         date="20.2.2026", status="done",
         quotes=[Q(5, "ECHO 20.2.2026 NNJ", 8), Q(5, "Normální velikosti srdečních oddílů. Normální systol. fce LK s EF 60%", 8),
                 Q(5, "RES: dobrá systolická funkce obou komor, bez hemodynamicky významné chlop. vady", 8)]),
    Spec("i_ct2604", "imaging", img("CT", "hrudník a břicho", "oproti vstupnímu CT 1/2026 mírná regrese lymfatických uzlin v levém plicním hilu a částečná regrese patologické lymfatické uzliny v retroperitoneu, nová ložiska nepřibyla; regrese sledovaných lézí přibližně o 24 %", resp("iRECIST", "iSD")),
         date="28.4.2026", status="done",
         quotes=[R(59, 9), R(118, 9), R(61, 9), R(62, 9), R(29, 9), R(63, 9),
                 Q(2, "Dle restaging. CT 4/2026 SD - velikostni regrese sledovaných lézi je o cca 24 %.")]),
    Spec("i_uz", "imaging", img("UZ", "tepny dolních končetin", "středně silné sklerotické (ne angiitické) změny; dopplerometrický nález vlevo negativní; vpravo zřetelná, i když ne těžká stenóza v proximálním úseku PDK; sledování vhodné"),
         date="30.7.2026", status="done",
         quotes=[R(79, 11), Q(5, "Dopplerometrický nález je vlevo negativní a velmi dobrý.", 11), R(80, 11)],
         note="Zkratka „PDK“ je v textu nerozepsaná (pravá dolní končetina, nebo podkolenní tepna)."),
    Spec("i_ct2608", "imaging", img("CT", "hrudník, břicho a malá pánev", "oproti CT 4/2026 i vstupnímu CT 1/2026 velikostní progrese lymfatických uzlin v levém plicním hilu a v retroperitoneu paraaortálně vlevo; dle onkologické zprávy PD"),
         date="26.8.2026", status="done", quotes=[R(64, 12), R(119, 12), R(65)],
         note="Kategorie PD pochází z onkologické zprávy; text závěru CT je v dokumentu useknutý („J-“), závěr může pokračovat na chybějící stránce."),
    Spec("i_mr", "imaging", img("MR", "mozek", "solitérní postkontrastně se sytící nodulus v pravé mozečkové hemisféře do 3 mm, suspekce na solitérní metastázu; jiné sytící se léze intrakraniálně nejsou; gliózy supratentoriálně Fazekas gr. III"),
         date="14.9.2026", status="done", quotes=[R(70, 3), R(36, 3), R(71, 3), R(37, 3)],
         note="Původní popis MR v PDF není, jen citace závěru."),
    # ----- metastases (a suspicion stays a suspicion; a negation is a finding) -----
    Spec("m_pa_susp", "metastasis", meta("paraaortální lymfatická uzlina vlevo", "suspected", "imaging", "susp. MTS paraaortální uzlina vlevo 20 mm"),
         date="7.9.2022", quotes=[R(3)]),
    Spec("m_pa", "metastasis", meta("paraaortální lymfatická uzlina vlevo", "confirmed", "histology", "MTS světlobuněčného renálního karcinomu G2, R0"),
         date="25.10.2022", quotes=[R(4)]),
    Spec("m_med", "metastasis", meta("mediastinální a plicní hilové lymfatické uzliny", "suspected", "imaging", "jsou hypervaskularizované mts charakteru"),
         date="6.3.2023", quotes=[R(45)], note="Radiologicky (charakteru metastáz), histologicky neověřeno."),
    Spec("m_chin", "metastasis", meta("kůže brady vlevo", "confirmed", "histology", "kožní metastáza světlobuněčného renálního karcinomu"),
         date="21.11.2023", quotes=[R(48)]),
    Spec("m_cereb", "metastasis", meta("pravá mozečková hemisféra", "suspected", "imaging", "solitérní nodulus do 3 mm, suspekce na solitérní MTS"),
         date="14.9.2026", quotes=[R(36, 3)]),
    Spec("m_intracran_neg", "metastasis", meta("intrakraniálně, jiná sytící se ložiska", "excluded", "imaging", "postkontrastně bez jiných sytících se lézí intrakraniálně"),
         negated=True, date="14.9.2026", quotes=[R(71, 3)]),
    Spec("m_brain_clin_neg", "metastasis", meta("mozek", "excluded", "clinical", "bez klinických známek mozkových metastáz"), negated=True,
         quotes=[R(40)], not_stated=U, note="Negace se týká klinického nálezu, ne zobrazení. MR mozku 14.9.2026 popisuje suspekci na MTS."),
    # ----- systemic therapy, decisions, adverse events -----
    Spec("t_nivoipi", "systemic_therapy", ther("nivolumab 3 mg/kg + ipilimumab 1 mg/kg q3w", None, "27.3.2023", None, None,
                                                "nivolumab 3 mg/kg + ipilimumab 1 mg/kg každé 3 týdny; podány 2 cykly (27.3. a 17.4.2023) ze 4 indikovaných"),
         date="27.3.2023", status="done", quotes=[R(10)], not_stated=["line", "stop", "reason_stopped"],
         note="Pořadí linie zpráva u této léčby neuvádí (sunitinib je ve zprávě 2. linie, everolimus 3. linie). Indikovány 4 cykly, dokumentovány 2; výslovné ukončení kombinace v textu chybí."),
    Spec("t_nivo_maint", "systemic_therapy", ther("nivolumab 240 mg q2w, udržovací", None, "27.6.2023", "29.12.2025", None,
                                                   "udržovací nivolumab 240 mg každé 2 týdny od 27.6.2023 do 29.12.2025"),
         date="27.6.2023", status="stopped", quotes=[R(13), R(12)], not_stated=["reason_stopped"],
         note="Důvod ukončení výslovně neuveden; CT 11/2025 hodnoceno jako progrese."),
    Spec("t_suni", "systemic_therapy", ther("sunitinib 50 mg denně, režim 4/2", 2, "27.1.2026", None, "progrese dle CT 8/2026",
                                             "50 mg denně v režimu 4 týdny léčby a 2 týdny pauza od 27.1.2026; od 25.2.2026 redukce o 1 stupeň na 37,5 mg denně, od 26.3.2026 o 2 stupně na 25 mg denně; ukončen pro progresi dle CT 8/2026"),
         date="27.1.2026", status="stopped", quotes=[R(54), R(24), R(56), R(26), R(31)], not_stated=["stop"],
         note="Přesné datum ukončení sunitinibu neuvedeno."),
    Spec("t_evero", "systemic_therapy", ther("everolimus", 3, "3.9.2026", None, None, "3. paliativní linie everolimus od 3.9.2026"),
         date="3.9.2026", quotes=[R(32)]),
    Spec("d_koc_nivo", "decision", dec("koc", "indikováno podání nivolumabu 3 mg/kg v kombinaci s ipilimumabem 1 mg/kg q3w, 4 cykly; schváleno KOC komisí", "KOC komise"),
         quotes=[R(9)], not_stated=["date"]),
    Spec("d_koc_suni", "decision", dec("koc", "do 2. linie léčby indikován sunitinib 50 mg denně; schváleno KOC komisí", "KOC komise"),
         quotes=[R(55)], not_stated=["date"]),
    Spec("d_koc_evero", "decision", dec("koc", "do 3. paliativní linie léčby indikován everolimus; schváleno KOC komisí", "KOC komise"),
         quotes=[R(33)], not_stated=["date"]),
    *[
        Spec(h, "adverse_event", ae(t, g, "nivolumab + ipilimumab"),
             quotes=[R(46), Q(2, "Po podání 2 cyklů léčby rozvoj GIT toxicity l.st., plicní toxicita= IPP 1.až 2. stupně")], not_stated=["date"])
        for h, t, g in (("ae_git", "gastrointestinální toxicita 1. stupně po 2. cyklu", "1"),
                        ("ae_pneu", "plicní toxicita (IPP) 1.-2. stupně po 2. cyklu", "1-2"))
    ],
    *[
        Spec(h, "adverse_event", ae(t, g, "sunitinib 50 mg denně"), quotes=[R(25)], not_stated=["date"])
        for h, t, g in (("ae_renal", "progrese renální insuficience", None), ("ae_mineral", "minerálová dysbalance", None),
                        ("ae_thrombo", "trombocytopenie", "G2-3"))
    ],
    Spec("ae_hepat", "adverse_event", ae("hepatopatie, důvod redukce dávky od 25.2.2026", "G2", "sunitinib"), quotes=[R(56)], not_stated=["date"]),
    # ----- medication (anamnesis FA) -----
    Spec("med_pred", "medication", med("prednison", "1 mg/kg/den", None, "od 12.5.2023 postupné snižování dávky, ukončen 26.7.2023", "plicní toxicita (IPP)",
                                       "prednison 1 mg/kg/den od 28.4.2023; od 12.5.2023 snižování, ukončen 26.7.2023", "ukončen 26.7.2023"),
         date="28.4.2023", status="stopped", quotes=[R(46), R(11)]),
    # Everolimus in the medication list (page 2) is the anticancer therapy, so systemic_therapy, never medication
    # (EXTRACTION-FORMAT.md). The list entry states the brand and the dosing, which the 3rd-line fact (t_evero, from the
    # oncology history on page 1) does not, so it is its own fact rather than a further source of t_evero; the dose
    # increase from 19.9.2026 is its own planned fact with its own start. Neither entry states the line.
    Spec("t_evero_5", "systemic_therapy", ther("Everolimus Sandoz 5 mg 1-0-0", None, None, None, None, "everolimus 5 mg denně, seznam medikace"),
         quotes=[Q(2, "Everolimus sandoz 5mg 1-0-0")], not_stated=["line", "start"]),
    Spec("t_evero_10", "systemic_therapy", ther("Everolimus Sandoz 5 mg 2-0-0", None, "19.9.2026", None, None,
                                                "navýšení z 1-0-0 na 2-0-0 (10 mg denně) od 19.9.2026; při netoleranci návrat k 1-0-0"),
         date="19.9.2026", status="planned", quotes=[R(67), R(69)], not_stated=["line"], **verify("V OCR „zyyšuji“, čteno jako zvyšuji.")),
    Spec("med_kapidin", "medication", med("Kapidin", "20 mg", "1-0-0"), quotes=[R(85)]),
    Spec("med_spiriva_a", "medication", med("Spiriva (inhalačně)", None, "1-0-1", None, None, "seznam chronické medikace"), quotes=[R(85)],
         **verify("Plicní vyšetření (str. 4 a 5) uvádí Spiriva 2-0-0; dávkování se mezi částmi dokumentu liší.", "sources_disagree")),
    Spec("med_spiriva_b", "medication", med("Spiriva (inhalačně)", None, "2-0-0", None, "CHOPN II/B", "plicní vyšetření"), quotes=[R(87), R(86, 10)],
         note="V textu „Spiriva rest 2-0-0“ (str. 4) a „Spiriva resp. 2-0-0“ (str. 5, plicní vyšetření 22.5.2026); zda „resp.“ označuje jinou lékovou formu, z textu určit nelze.",
         **verify("Seznam chronické medikace (str. 2) uvádí Spiriva 1-0-1; dávkování se mezi částmi dokumentu liší.", "sources_disagree")),
    Spec("med_ventolin", "medication", med("Ventolin N (inhalačně)", None, "dle potřeby"), quotes=[R(85)]),
    Spec("med_neurol", "medication", med("Neurol", "0,25 mg", "dle potřeby", None, "při úzkosti, neklidu"), quotes=[R(88)],
         **verify("V OCR „ltbl.“, čteno jako tbl.")),
    Spec("med_nacl", "medication", med("Natrii chloridi (tobolky)", "1,0 g", "1-0-1"), quotes=[R(89)]),
    Spec("med_calcichew", "medication", med("Calcichew", "1000/[nečitelné] IU", "0-0-1", None, "pro hypokalcémii"), quotes=[R(81)],
         **verify("Za lomítkem nečitelné (OCR „SOOIU“); jednotka u 1000 v textu neuvedena.", "unreadable_part")),
    Spec("med_degan", "medication", med("Degan", "10 mg", "1-1-1", None, "při nevolnosti"), quotes=[R(90)]),
    Spec("med_novetron", "medication", med("Novetron", "8 mg", "1-0-1 á 12 hod.", None, "při nedostatečném efektu nebo zvracení"), quotes=[R(91)],
         note="Podmínka se v dokumentu vztahuje k předchozímu léku (Degan)."),
    Spec("med_imodium", "medication", med("Imodium", "2 mg", "vstupně 2 tobolky, pak 1 tobolka při každé další řídké stolici, nejvýše 8 tobolek denně", None, "při průjmu"),
         quotes=[R(92)]),
    Spec("med_smecta", "medication", med("Smecta", None, "1-1-1", None, "při nedostatečném efektu"), quotes=[R(93)],
         note="Podmínka se v dokumentu vztahuje k předchozímu léku (Imodium)."),
    Spec("med_orcal", "medication", med("Orcal", "10 mg", "1/2-0-0", "nově od interního vyšetření 10.2.2026"), date="10.2.2026", quotes=[R(94, 7)]),
    Spec("med_erdomed", "medication", med("Erdomed", "300 mg", "1-1-0", None, None, "doporučeno plicním vyšetřením 22.5.2026"), date="22,5,2026",
         quotes=[Q(5, "Erdomed 300mg 1-1-0", 10)]),
    Spec("ci_acei", "contraindication", contra("ACE inhibitory při léčbě everolimem, pro zvýšené riziko anafylaxe"), quotes=[R(95)],
         **verify("V OCR „zyýšené“ a „anafylace“, čteno jako zvýšené a anafylaxe."),
         note="Uvedeno v doporučení k everolimu jako léková interakce, ne jako alergie."),
    # ----- comorbidities and risk factors (anamnesis OA, EA, abusus) -----
    Spec("c_hn", "comorbidity", comor("Hypertenzní nemoc"), quotes=[R(72)]),
    Spec("c_copd", "comorbidity", comor("Chronická obstrukční plicní nemoc, u kuřáka; léčba dle anamnézy přerušena pacientem; plicní vyšetření 22.5.2026: stadium II/B, spirometrie lehká obstrukce"),
         quotes=[R(72), R(74, 10), R(75, 10)]),
    Spec("c_ild", "comorbidity", comor("Podezření na intersticiální plicní postižení, stav po kortikoterapii (plicní vyšetření 22.5.2026)"), date="22,5,2026",
         quotes=[R(75, 10)]),
    Spec("c_hlp", "comorbidity", comor("Hyperlipoproteinémie, na dietě"), quotes=[R(72)]),
    Spec("c_hyperglyc", "comorbidity", comor("Hyperglykémie nalačno, anamnesticky"), quotes=[R(73)]),
    Spec("c_kidneycysts", "comorbidity", comor("Korové cysty ledvin"), quotes=[R(73)]),
    Spec("c_livercyst", "comorbidity", comor("Cysta jater v segmentu S2"), quotes=[R(73)]),
    Spec("c_dyspnea", "comorbidity", comor("Dušnost k vyloučení kardiální etiologie (interní vyšetření 10.2.2026); možno na vrub dekorigované hypertenze"),
         date="10.2.2026", quotes=[R(76, 7), Q(5, "možno na vrub dekorigované HT", 7)],
         **verify("V OCR „dekorigované HT“, pravděpodobně dekompenzované, ověřit.", "word_unclear")),
    Spec("c_fazekas", "comorbidity", comor("Gliózy supratentoriálně Fazekas gr. III"), date="14.9.2026", quotes=[R(37, 3)]),
    Spec("c_pad", "comorbidity", comor("Sklerotické změny tepen dolních končetin, středně silné, neangiitické; vpravo zřetelná, i když ne těžká stenóza v proximálním úseku PDK, sledování vhodné"),
         date="30.7.2026", quotes=[R(79, 11), R(80, 11)],
         note="Zkratka „PDK“ je v textu nerozepsaná (pravá dolní končetina, nebo podkolenní tepna)."),
    Spec("c_hypoca", "comorbidity", comor("Hypokalcémie, léčena Calcichew"), quotes=[R(81)]),
    Spec("c_hyperk", "comorbidity", comor("Mírná hyperkalémie, dietní opatření, pacient poučen"), quotes=[R(82)]),
    Spec("dx_pe_neg", "diagnosis", dx("plicní embolie"), negated=True, date="10.2.2026",
         quotes=[Q(5, "Závěr: Bez plicní embolie, jen drobná cysta v HL vpravo.", 6), Q(5, "plicní embolie vyloučena", 7)]),
    Spec("ex_ekg", "exam_finding", exam("srdce", "EKG bez ischemických změn, hs troponin stabilní bez dynamiky"), date="10.2.2026",
         quotes=[Q(5, "EKG bez ischemických změn, hstroponin stabilní bez dynamiky", 7)]),
    Spec("rf_smoking", "risk_factor", risk("smoking", "fumátor (kuřák)"), quotes=[R(96), R(75, 10)], not_stated=["pack_years"],
         note="Aktivní či bývalý kuřák, počet cigaret a délka kouření neuvedeny."),
    Spec("rf_hbsag", "risk_factor", risk("epidemiology", "HBsAg pozitivní"), quotes=[R(83)]),
    Spec("ps_imdc", "prognostic_score", prog("IMDC", "1 faktor - interval méně než 1 rok od diagnózy do započetí systémové léčby", "střední prognóza"),
         quotes=[Q(1, "Dle IMDC střední prognóza - 1 faktor - interval méně než 1 rok od diagnózy do započetí syst. léčby."),
                 Q(2, "Dle IMDC střední prognóza - 1 faktor - interval méně než 1 rok od diagnózy do započetí syst. léčby.")],
         not_stated=["date"]),
    # ----- status praesens of the undated control visit (p4) -----
    Spec("perf_ecog", "performance_status", perf("ECOG", "1", 1), quotes=[R(102)], not_stated=U),
    Spec("ex_mobility", "exam_finding", exam("mobilita a soběstačnost", "chodící, soběstačný (odvozeno z ECOG PS 1)"), quotes=[R(102)],
         origin="assistant", based_on=["perf_ecog"], certainty="inferred", reason=("inferred_from_ecog", "Odvozeno z ECOG PS 1, v textu neuvedeno.")),
    Spec("v_bp", "vital_sign", vital("blood_pressure", "155/70", None, "mmHg", "Tlak S/D [mmHg]"), quotes=[R(101)], not_stated=U),
    Spec("v_pulse", "vital_sign", vital("pulse", "68", 68, "/min", "Pulz [1/mín]"), quotes=[R(101)], not_stated=U),
    Spec("v_resp", "vital_sign", vital("respiratory_rate", "14", 14, "/min", "Dech [1/min]"), quotes=[R(101)], not_stated=U),
    Spec("v_weight", "vital_sign", vital("weight", "87", 87, "kg", "Hmotnost [kg]"), quotes=[R(101)], not_stated=U),
    Spec("v_height", "vital_sign", vital("height", "183", 183, "cm", "Výška [cm]"), quotes=[R(101)], not_stated=U),
    Spec("v_bmi", "vital_sign", vital("bmi", "25.98", 25.98, None, "BMI"), quotes=[R(101)], not_stated=U),
    Spec("v_bsa", "vital_sign", vital("other", "2.09", 2.09, "m2", "Plocha těla [m2]"), quotes=[R(101)], not_stated=U),
    Spec("v_bp_int", "vital_sign", vital("blood_pressure", "174/92", None, "mmHg", "kontrolní TK"), date="10.2.2026",
         quotes=[Q(5, "u nás kontrolní TK 174/92", 7)]),
    Spec("v_bp_home", "vital_sign", vital("other", "kolem 150", None, None, "doma prav. TK (dle pacienta)"), date="10.2.2026",
         quotes=[Q(5, "dle pacienta doma prav. TK kolem 150", 7)]),
    Spec("ex_subj_evero", "exam_finding", exam("subjektivně", "Nově předepsaný everolimus toleruje výborně, nemá s ním žádný problém."), quotes=[R(97)], not_stated=U),
    Spec("sym_gi_neg", "symptom", sym("Nechutenství není, nevolnost také ne, nezvrací, průjem neguje."), negated=True, quotes=[R(98)], not_stated=U),
    Spec("sym_vertigo_neg", "symptom", sym("Na cílený dotaz neguje závratě či poruchy rovnováhy."), negated=True, quotes=[R(39)], not_stated=U),
    Spec("sym_scotoma", "symptom", sym("Někdy během dne mžitky před očima."), quotes=[R(99)], not_stated=U),
    Spec("ex_bp_not_measured", "exam_finding", exam("subjektivně", "Krevní tlak nyní neměřil, protože byl na dovolené."), quotes=[R(100)], not_stated=U),
    Spec("ex_conscious", "exam_finding", exam("vědomí a orientace", "lucidní, orientace správná, spolupracuje"), quotes=[R(103)], not_stated=U),
    Spec("ex_general", "exam_finding", exam("celkově", "eupnoe, bez cyanózy, bez ikteru, normální hydratace"), quotes=[R(104)], not_stated=U),
    Spec("ex_head", "exam_finding", exam("hlava", "poklep nebolestivý, zornice izokorické, správně reagují na osvit, hrdlo zarudlé, hnisavý povlak, tonzily nezvětšené, jazyk vlhký, bez povlaku, plazí středem"),
         quotes=[R(105)], not_stated=U),
    Spec("ex_neck", "exam_finding", exam("krk", "souměrný, šíje bez opozice, štítnice nezvětšená, uzliny nehmatné, pulzace karotid symetrická, bez šelestu, žíly bez kongesce"),
         quotes=[R(106)], not_stated=U),
    Spec("ex_chest", "exam_finding", exam("hrudník", "souměrný, palpačně nebolestivý, prsy bez patologického nálezu, axily, nadklíčky volné, bez lymfatických uzlin, páteř poklepově nebolestivá"),
         quotes=[R(107)], not_stated=U),
    Spec("ex_lungs", "exam_finding", exam("plíce", "poklep plný, jasný, dýchání alveolární, bez vedlejších fenoménů"), quotes=[R(108)], not_stated=U),
    Spec("ex_heart", "exam_finding", exam("srdce", "akce pravidelná, ozvy ohraničené, bez šelestu"), quotes=[R(109)], not_stated=U),
    Spec("ex_abdomen", "exam_finding", exam("břicho", "v niveau, měkké, prohmatné, palpačně nebolestivé, bez patologické rezistence, peristaltika přiměřená, játra v oblouku, slezina nenaráží, tapott bilaterálně negativní"),
         quotes=[R(110)], not_stated=U),
    Spec("ex_genital", "exam_finding", exam("zevní genitál", "nevyšetřen"), quotes=[R(111)], not_stated=U),
    Spec("ex_rectal", "exam_finding", exam("per rectum", "nevyšetřen"), quotes=[R(112)], not_stated=U),
    Spec("ex_limbs", "exam_finding", exam("končetiny", "hybnost v normě, klouby bez deformit"), quotes=[R(113)], not_stated=U),
    Spec("ex_legs", "exam_finding", exam("dolní končetiny", "třísla bez hmatných zvětšených lymfatických uzlin, bez otoků, varixů a flebitid, pulzace hmatné symetricky do periferie"),
         quotes=[R(114)], not_stated=U),
    Spec("ex_scar", "exam_finding", exam("status localis", "jizvy pod pravým i levým obloukem žeberním klidné"), quotes=[R(115)], not_stated=U),
    Spec("sym_chin", "symptom", sym("ložisko na bradě dle pacienta pozoruje cca od 6/23"), date="6/23", quotes=[R(116)]),
    # ----- the latest conclusion (p3) and what it plans -----
    Spec("ex_tolerance", "exam_finding", exam("subjektivně", "Tolerance léčby výborná, laboratorní vyšetření bez zásadní patologie."),
         quotes=[Q(3, "Tolerance léčby vývorná, lab., vyš. bez zásadni patologie")], not_stated=["date"]),
    Spec("ex_discharge", "exam_finding", exam("celkově", "Při odchodu je pacient ve stabilizovaném stavu."),
         quotes=[Q(3, "Při odchodu je pacient ve stabilizovaném ·stavu.")], not_stated=["date"]),
    Spec("req_nch", "request", req("projednání nálezu MR mozku na neurochirurgickém semináři", "consultation"), status="requested",
         quotes=[R(41)], not_stated=["date"], note="Termín ani formulovaná otázka v dokumentu uvedeny nejsou."),
    Spec("pl_ct", "plan", plan("kontrolní CT hrudníku, břicha a malé pánve", "v 9.20hod."), status="planned", quotes=[R(43)], not_stated=["date"],
         note="U kontrolního CT zpráva uvádí jen čas (9.20 hod.), datum ne."),
    Spec("pl_colo", "plan", plan("kontrolní kolonoskopie", "r.2028"), date="r.2028", status="planned", quotes=[R(84)],
         note="Zpráva z předchozí kolonoskopie v dokumentaci není."),
    Spec("pl_bp", "plan", plan("domácí měření TK"), status="planned", quotes=[R(120)], not_stated=["date"]),
    Spec("pl_evero", "plan", plan("navýšení everolimu na 10 mg denně při dobré toleranci"), status="planned", quotes=[R(68)], not_stated=["date"]),
    Spec("pl_cabo", "plan", plan("cabozantinib (paragraf 16) ponechat do 4. linie", "do 4. linie"), status="planned", quotes=[R(66), R(34)], not_stated=["date"]),
]

# Today's 26 lab values (case.labs) become lab_result facts in convert_v2.py: one undated panel on page 3, part 1.
LAB_PART = 1
# The view's lab note ("šipky doplnil asistent porovnáním s uvedeným rozmezím") becomes out_of_range_origin "assistant".
LAB_FLAG_ORIGIN = "assistant"
# Today's refs cut B_LYMFO's range at a line break; the page has the whole range.
LAB_QUOTE_FIX = {"B_LYMFO": "B_LYMFO: 1,610 10A9/l [0.8 ... 4]"}

ALERTS: list[AlertSpec] = [
    AlertSpec("mdt_question_missing", "missing", "mdt_question", ["req_nch"], {"fact": "req_nch"},
              "Výslovná otázka pro MDT ani navrhovaný postup v dokumentaci nejsou.", ["flags[0]", "data_gaps_v3[3]"]),
    AlertSpec("consultation_form_missing", "missing", "consultation_form", ["req_nch"], {},
              "Formulář FNO má pole „Otázka na NOCO“.", ["flags[0]"]),
    AlertSpec("original_report_missing", "missing", "i_mr", ["i_mr"], {"fact": "i_mr"},
              "MR mozku 14.9.2026 je v podkladech jen jako závěr (z NNJ); plný popis a snímky nenalezeny.", ["flags[1]"]),
    AlertSpec("comparison_imaging_missing", "missing", "i_mr", ["i_mr"], {"fact": "i_mr"},
              "Předchozí MR mozku ke srovnání v podkladech nenalezeno.", ["flags[1]"]),
    # documents_note_cs: the PDF holds the histology reports only as citations. Missing-document alerts are always on.
    *[
        AlertSpec("original_report_missing", "missing", h, [h], {"fact": h}, None, ["documents_note_cs"])
        for h in ("h_neph", "h_ln", "h_chin", "h_glab")
    ],
    AlertSpec("suspicion_not_verified", "missing", "m_cereb", ["m_cereb", "i_mr"], {"fact": "m_cereb"}, "Suspekce, ne diagnóza.", ["flags[2]"]),
    AlertSpec("document_date_not_stated", "missing", "10_pacient/p2", ["vis_control", "perf_ecog"], {"document": "10_pacient/p2"},
              "Záhlaví str. 4 je v OCR nečitelné, datum zprávy na str. 3 začerněné; datum lze jen odhadnout z kontextu (po 14.9.2026).", ["flags[3]", "data_gaps_v3[5]"]),
    AlertSpec("lab_draw_date_not_stated", "missing", "10_pacient/p1", ["@labs"], {"document": "10_pacient/p1"}, None, ["flags[3]"]),
    AlertSpec("reading_uncertain", "unclear", "stage", ["stage"], {"fact": "stage"},
              "M0 jen dle vstupní dokumentace; v textu zapsáno „MO“, ověřit čtení.", ["data_gaps_v3[0]"]),
    AlertSpec("patient_field_missing", "missing", "age", [], {"field": "age"}, None, ["data_gaps_v3[1]"]),
    AlertSpec("patient_field_missing", "missing", "birth_number", [], {"field": "birth_number"}, None, ["data_gaps_v3[1]"]),
    AlertSpec("request_without_result", "missing", "req_nch", ["req_nch"], {"fact": "req_nch"}, None, ["data_gaps_v3[2]"]),
    AlertSpec("exam_attribution_unclear", "unclear", "i_osteo", ["i_osteo"], {"fact": "i_osteo"},
              "OCR sazba stránky je promíchaná; ložiska se dále nezmiňují.", ["data_gaps_v3[4]", "flags[8]"]),
    AlertSpec("date_contradiction", "contradiction", ("i_base", "i_base_p2"), ["i_base", "i_base_p2"], {"fact_a": "i_base", "fact_b": "i_base_p2"},
              "Str. 4 a 5 uvádějí baseline 3/2023, údaj 3/2022 (před diagnózou 4/2022) je pravděpodobně překlep. Ověřit.",
              ["data_gaps_v3[6]", "flags[4]"]),
    AlertSpec("response_assessment_differs", "unclear", ("i_ct2511", "i_ct2511_p1"), ["i_ct2511", "i_ct2511_p1"],
              {"fact_a": "i_ct2511", "fact_b": "i_ct2511_p1"},
              "Nemusí jít o rozpor (první progrese dle iRECIST je iUPD), potvrzena 1/2026 jako iCPD.", ["flags[5]"]),
    AlertSpec("cycles_differ", "unclear", "t_nivoipi", ["t_nivoipi", "d_koc_nivo"], {"fact": "t_nivoipi"},
              "Z textu plyne přechod na udržovací nivolumab od 27.6.2023; výslovné ukončení kombinace v textu chybí.", ["flags[6]"]),
    AlertSpec("page_order_unclear", "chronology", "10_pacient", ["t_evero_10", "pl_evero", "t_evero", "pl_cabo"], {"document": "10_pacient"},
              CASE["flags"][7]["text_cs"] + " " + CASE["flags"][7]["note"], ["flags[7]"]),
    AlertSpec("dosing_differs", "unclear", ("med_spiriva_a", "med_spiriva_b"), ["med_spiriva_a", "med_spiriva_b"],
              {"fact_a": "med_spiriva_a", "fact_b": "med_spiriva_b"},
              "Seznam chronické medikace (str. 2) uvádí Spiriva 1-0-1, plicní vyšetření (str. 4 a 5, 22.5.2026) 2-0-0. Nemusí jít o rozpor (jiná doba, možná jiná léková forma); aktuální dávku ověřit.", []),
]

# Original reports the PDF does not contain (documents_note_cs, flags[1]): each a check that looked and found nothing.
ORIGINAL_REPORTS = ["i_mr", "h_neph", "h_ln", "h_chin", "h_glab"]

# The brief (onco_summary_v3_cs) sentence by sentence, with the facts each states; the "[n]" markers are dropped and
# the view numbers the references itself. convert_v2.py checks that every marker's passage rests on a listed fact.
BRIEF_FACTS = [
    ["dx", "m_pa", "p_neph", "h_neph", "stage"],
    ["m_pa", "h_ln", "m_chin", "h_chin", "m_med", "i_base"],
    ["t_nivoipi", "t_nivo_maint", "i_ct2511_p1", "i_ct2601", "t_suni", "i_ct2608"],
    ["t_evero"],
    ["i_mr", "m_cereb", "m_intracran_neg"],
    ["perf_ecog", "m_brain_clin_neg", "sym_vertigo_neg", "sym_scotoma"],
    ["req_nch"],
]

# Today's composed lines with the facts each states, in today's order and wording (views.onco_lines, views.timeline,
# views.other_diagnoses; EXTRACTION-FORMAT.md "Composed views"). Started from the passages each line cites (the
# --report view map) and completed where a line states a fact its passages do not show: the 5 mg dose of line 12,
# the planned pulmonary visit of line 15. The validator checks every date, number, negation and side against them.
ONCO_LINES = [
    ["h_neph", "stage", "p_neph"],
    ["h_ln", "p_ln", "m_pa"],
    ["i_base", "m_med", "i_base_p2"],
    ["t_nivoipi", "d_koc_nivo", "ps_imdc", "ae_git", "ae_pneu", "med_pred"],
    ["t_nivo_maint", "i_ct2306", "i_rs_11_2023", "i_rs_2_2024", "i_rs_6_2024", "i_rs_10_2024", "i_rs_2_2025", "i_rs_6_2025"],
    ["p_chin", "h_chin", "m_chin"],
    ["i_ct2511", "i_ct2511_p1"],
    ["i_ct2601"],
    ["t_suni", "d_koc_suni", "ae_renal", "ae_mineral", "ae_thrombo", "ae_hepat", "i_ct2608"],
    ["i_ctag", "dx_pe_neg", "i_osteo"],
    ["i_ct2604"],
    ["i_ct2608"],
    ["t_evero", "d_koc_evero", "pl_cabo", "t_evero_5"],
    ["i_mr", "m_cereb", "m_intracran_neg", "c_fazekas"],
    ["t_evero_5", "t_evero_10", "pl_evero"],
    ["req_nch", "vis_next", "pl_ct", "vis_pulm_next", "pl_colo"],
]
TIMELINE_CARDS = [
    ["dx"],
    ["h_neph", "stage", "p_neph"],
    ["i_ct2209", "m_pa_susp", "h_ln", "p_ln", "m_pa"],
    ["i_base", "m_med", "ps_imdc", "i_base_p2"],
    ["d_koc_nivo", "t_nivoipi", "ae_git", "ae_pneu", "med_pred"],
    ["i_ct2306", "t_nivo_maint", "i_rs_11_2023", "i_rs_2_2024", "i_rs_6_2024", "i_rs_10_2024", "i_rs_2_2025", "i_rs_6_2025"],
    ["p_chin", "h_chin", "m_chin", "sym_chin"],
    ["i_ct2511", "i_ct2511_p1"],
    ["i_ct2601"],
    ["d_koc_suni", "t_suni", "ae_renal", "ae_mineral", "ae_thrombo", "ae_hepat", "i_ct2608"],
    ["i_ct2604"],
    ["i_ct2608", "t_suni"],
    ["t_evero", "d_koc_evero", "pl_cabo", "t_evero_5", "t_evero_10", "pl_evero"],
    ["i_mr", "m_cereb", "m_intracran_neg", "c_fazekas"],
    ["req_nch"],
    ["vis_next", "pl_bp"],
]
OTHER_DX = ["rf_hbsag", "c_hn", "c_copd", "c_hlp", "rf_smoking", "c_dyspnea", "dx_pe_neg", "ex_ekg", "med_orcal", "c_hyperglyc",
            "c_kidneycysts", "c_livercyst", "c_ild", "i_uz", "c_pad", "med_calcichew", "c_hypoca", "c_hyperk"]

QUESTION_BASIS = [("purpose", ["req_nch"]), ("finding", ["i_mr", "m_cereb"]), ("finding", ["t_evero", "d_koc_evero"])]

# Sections the view shows, each with what this fixture covered. All 13 parts were read by hand when the fixture was
# made, so a section with no facts is "nothing_found" (today's "neuvedeno v dostupné dokumentaci"), not "not_run".
NOTHING_FOUND_KINDS = ["allergy", "family_history", "radiotherapy"]
NOT_RUN_KINDS = ["interval"]
EXTRA_CHECKS = [
    # (id, looks_for, result, parts or None for all)
    ("chk-social-history", "social_history", "nothing_found", None),
    ("chk-work-history", "work_history", "nothing_found", None),
    ("chk-status-speech", "exam_finding:speech", "nothing_found", [2]),
    ("chk-status-karnofsky", "performance_status:karnofsky", "nothing_found", [2]),
    ("chk-mdt-question", "mdt_question", "nothing_found", None),
    ("chk-visit-date", "document_date", "nothing_found", [2]),
    ("chk-lab-draw-date", "lab_draw_date", "nothing_found", [1]),
]

# Pages that are partly unreadable, by the check they affect: the header of page 4 (the visit's date) and the iRECIST
# tables of the CT 16.1.2026 (page 4) and CT 28.4.2026 (page 5), whose values cannot be assigned to lesions.
UNREADABLE = {
    "chk-visit-date": [(4, 2)],
    "chk-imaging": [(4, 5), (5, 9)],
}

# The brief keeps today's text except where it states more than the documents: the line of nivolumab + ipilimumab is
# not written in the document (the fact says so), so the sentence does not call it the 1st palliative line.
BRIEF_TEXT_FIX = {"V 1. paliativní linii léčen nivolumabem s ipilimumabem": "Léčen nivolumabem s ipilimumabem"}

# Visits and check-ups (kind `visit`). The PDF is one control report whose pages run 4, 5, 1, 2, 3 (flags[7]), so the
# headers on pages 1 and 4 are one visit. The internal and pulmonary exams are cited in it; the planned check-ups
# from the plan line are visits with status planned, not plan facts, so each shows once on the timeline. The pulmonary
# clinic's visits are consultations (a specialty asked by oncology), which also keeps their keys apart from the
# undated oncology control visit's (the key is kind, type and date, not status).
# The extra field `today` lists the view items each visit carries (for the conversion report).
VISITS = [
    (Spec("vis_control", "visit", visit("outpatient", "Ambulantní vyšetření kontrolní"), status="done",
          quotes=[Q(1, "Ambulantní vyšetření kontrolní"), Q(4, "Ambulantnf vyletfenf kontrolnf")], not_stated=["date", "department"],
          note="Datum kontroly v dokumentu není (záhlaví str. 4 nečitelné, datum zprávy na str. 3 začerněné); pacient už užívá everolimus (od 3.9.2026) a zpráva cituje MR 14.9.2026."),
     ["onco_detailed_v3[18]", "status_praesens", "documents[0]", "documents[2]"]),
    (Spec("vis_internal", "visit", visit("consultation", "Interní wš"), date="10.2.2026", status="done",
          quotes=[Q(5, "Interní wš, 10.2.2026 NNJ", 7, True)], not_stated=["department", "reason"]),
     ["timeline[21]", "documents[7]"]),
    (Spec("vis_pulm", "visit", visit("consultation", "Plicní wš"), date="22,5,2026", status="done",
          quotes=[Q(5, "Plicní wš, 22,5,2026 MUDr.Hofrová", 10, True)], not_stated=["department"]),
     ["timeline[26]", "documents[10]"]),
    (Spec("vis_next", "visit", visit("outpatient", "Kontrola zde", None, "s odběrem KO, biochemie"), date="9.10.2026", status="planned",
          quotes=[R(42)], not_stated=["department"]),
     ["timeline_cards_v3[15]", "timeline[33]", "onco_compact.lines[15]", "sections.current_state[3]"]),
    (Spec("vis_pulm_next", "visit", visit("consultation", "Kontrola v plicní amb.", "plicní amb."), status="planned",
          quotes=[Q(3, "Kontrola v plicní amb.")], not_stated=["date"]),
     ["onco_compact.lines[15]", "sections.current_state[3]"]),
    # Planned by the pulmonary exam of 22.5.2026. Whether it is the check-up the oncologist names on page 3 ("Kontrola v
    # plicní amb."), the document does not say, so both stay. The earlier undated pulmonary exam quoted on page 4
    # ("kontrola za 1/2 roku") is not a visit fact: it may be the exam of 22.5.2026, and nothing dates it.
    (Spec("vis_pulm_9_2026", "visit", visit("consultation", "kontrola", None, "spirometrie"), date="9/2026", status="planned",
          quotes=[Q(5, "kontrola \n9/2026 + spirometrie", 10)], not_stated=["department"]),
     []),
]

# ----- guidance re-key (fixtures/data/guideline-*.json, deviations-case-10.json) -----

# Patient-fact texts of the guideline statements -> the facts they state. Keyed by the text exactly as the guideline
# files write it; the converter fails when a statement has a text not listed here.
GUIDE_FACTS = {
    "MR mozku 14. 9. 2026: solitární sytící se ložisko v pravé hemisféře mozečku do 3 mm, susp. metastáza": ["i_mr", "m_cereb"],
    "ECOG PS 1, bez klinických známek mozkových metastáz (občasné mžitky před očima)": ["perf_ecog", "m_brain_clin_neg", "sym_scotoma"],
    "Everolimus 5 mg denně od 3. 9. 2026 (3. linie); dle nejnovějšího ambulantního závěru navýšení na 10 mg denně od 19. 9. 2026": ["t_evero", "t_evero_5", "t_evero_10"],
    "světlobuněčný renální karcinom G2, nefrektomie vpravo 6/2022, pT2a pN1 M0": ["h_neph", "p_neph", "stage"],
    "1. linie nivolumab + ipilimumab, progrese (iRECIST potvrzena 1/2026)": ["t_nivoipi", "i_ct2601"],
    "2. linie sunitinib 1-8/2026, progrese": ["t_suni", "i_ct2608"],
    "histologicky ověřené metastázy (paraaortální uzlina, kůže)": ["m_pa", "h_ln", "m_chin", "h_chin"],
    "CT AG plicnice 10. 2. 2026: drobná osteoplastická ložiska do 7 mm v přechodu Th/L (povaha neuvedena)": ["i_osteo"],
    "ECOG PS 1": ["perf_ecog"],
    "MR mozku 14. 9. 2026: solitární sytící se nodulus v pravé hemisféře mozečku do 3 mm, suspekce na solitérní metastázu": ["i_mr", "m_cereb"],
    "Histologie primárního nádoru: světlobuněčný renální adenokarcinom G2": ["h_neph"],
    "MR mozku 14. 9. 2026: solitární sytící se nodulus v pravé hemisféře mozečku do 3 mm, suspekce na metastázu, jiná sytící se ložiska nejsou": ["i_mr", "m_cereb", "m_intracran_neg"],
    "Na cílený dotaz neguje závratě či poruchy rovnováhy, někdy během dne mžitky před očima": ["sym_vertigo_neg", "sym_scotoma"],
    "MR mozku 14. 9. 2026: solitární ložisko do 3 mm v pravé hemisféře mozečku, suspekce na metastázu": ["i_mr", "m_cereb"],
    "MR mozku 14. 9. 2026: solitární sytící se nodulus v pravé hemisféře mozečku do 3 mm, suspekce na metastázu": ["i_mr", "m_cereb"],
    "HBsAg pozit. pac. (anamnéza v dokumentaci)": ["rf_hbsag"],
    "Sunitinib 1-8/2026 (ukončen)": ["t_suni"],
    "Nivolumab + ipilimumab, udržovací nivolumab do 12/2025 (ukončeno)": ["t_nivoipi", "t_nivo_maint"],
    "HBsAg pozitivní": ["rf_hbsag"],
    "Everolimus od 3. 9. 2026": ["t_evero"],
    "Arteriální hypertenze v osobní anamnéze, chronická medikace Kapidin 20 mg 1-0-0": ["c_hn", "med_kapidin"],
    "TK 174/92 při interním vyšetření 10. 2. 2026 (během léčby sunitinibem)": ["v_bp_int", "t_suni"],
    "TK 155/70 později": ["v_bp"],
    "Sunitinib 1-8/2026": ["t_suni"],
    "TK 174/92 při interním vyšetření 10. 2. 2026, dle pacienta doma prav. TK kolem 150": ["v_bp_int", "v_bp_home"],
    "Od 10. 2. 2026 nově Orcal 10 mg ½-0-0, poučen o domácím měření TK": ["med_orcal"],
    "Chronická medikace: Kapidin 20 mg 1-0-0": ["med_kapidin"],
    "TK 155/70 později; doma tehdy TK neměřil (dovolená)": ["v_bp", "ex_bp_not_measured"],
    "Kontraindikovány jsou ACEi pro zvýšené riziko anafylaxe": ["ci_acei"],
    "Metastatický světlobuněčný karcinom ledviny, progrese po 1. a 2. linii, od 3. 9. 2026 everolimus": ["m_pa", "m_chin", "i_ct2601", "i_ct2608", "t_evero"],
    "CT 8/2026: velikostní progrese uzlin v levém plicním hilu a v retroperitoneu paraaortálně vlevo": ["i_ct2608"],
    "Nález MR mozku zadán k projednání na NCH semináři": ["req_nch"],
}

# Past decisions (guidelines-case-10-past.json): the oncology row each decision sits on and the passage of the decision.
# These replace row_index (an index into onco_detailed_v3) and decision_ref (an index into extra.refs).
PAST_ROW = {0: "p_neph", 2: "p_ln", 5: "t_nivoipi", 8: "p_chin", 12: "t_suni", 16: "t_evero"}
PAST_DECISION_REF = {13: "t_nivo_maint", 55: "d_koc_suni", 33: "d_koc_evero"}
PAST_STATEMENTS = {
    "past-nephrectomy": {"row": "p_neph"},
    "past-lymphadenectomy": {"row": "p_neph"},
    "past-metastasectomy-node": {"row": "p_ln"},
    "past-1l-intermediate": {"row": "t_nivoipi", "also": ["ps_imdc"]},
    "past-nivo-ipi-regimen": {"row": "t_nivoipi", "decision": "t_nivo_maint"},
    "past-skin-metastasectomy": {"row": "p_chin"},
    "past-2l-after-io": {"row": "t_suni", "decision": "d_koc_suni"},
    "past-3l-after-io-tki": {"row": "t_evero", "decision": "d_koc_evero"},
}

# Curated deviation observations (deviations-case-10.json): source_refs (indexes into extra.refs) -> facts.
DEVIATION_FACTS = {
    "hbv-prophylaxis-not-documented": ["rf_hbsag", "t_evero", "t_evero_5", "t_evero_10"],
    "blood-pressure-above-general-target": ["c_dyspnea", "v_bp_int", "v_bp_home", "med_orcal", "ex_bp_not_measured", "v_bp", "ci_acei"],
    "shortened-induction-with-toxicity": ["d_koc_nivo", "t_nivoipi", "ae_git", "ae_pneu", "med_pred", "i_ct2306", "t_nivo_maint"],
    "nch-result-not-documented": ["i_mr", "m_cereb", "req_nch"],
}
