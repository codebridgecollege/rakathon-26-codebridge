import json
S = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "data") + "/"
ocr = json.load(open(S + "ocr.json"))
def e(file, name, age, problem, q, q_explicit, summary, note=None, insurer=None):
    d = {"file": file, "name": name, "age_or_birth": age, "insurer": insurer, "main_problem_cs": problem,
         "mdt_question_cs": q, "mdt_question_explicit": q_explicit, "one_line_summary_cs": summary,
         "page_count": len(ocr[file])}
    if note: d["note"] = note
    return d
L = [
 e("2_pacient.pdf", "Jaroslava Kotěrová", None, "Glioblastom (GBM) temporálně vpravo, stp. resekci",
   "Vzhledem k rozsahu tumoru (propagace do thalamu a mesencephala) symptomatická terapie?", True,
   "Po kolapsu nalezena objemná expanze T vpravo s šířením do inzuly, thalamu a mesencefala; resekce 7.8.2026, histol. high grade gliový tumor (Ki67 až 70 %), pooperačně rozsáhlé reziduum; levostranná hemiparéza a neglect.",
   note="Jméno v dokumentu zapsáno 'Kotěrova Jaroslava'.", insurer="205"),
 e("9_pacient.pdf", "Zdena Zábělská", "nar. 13.10.1961", "Karcinom levého prsu s generalizací do skeletu, komprese obratle Th2",
   "Nález na PET/CT bude prezentován na NCH semináři k posouzení indikace NCH intervence.", False,
   "Ca levého prsu (2023, stp. mastektomii, RT, letrozol); 9/2026 progrese s mnohočetnými převážně osteolytickými MTS skeletu, patologická komprese Th2 až vertebra plana s měkkotkáňovou složkou do páteřního kanálu; od 7.9.2026 fulvestrant, od 22.9.2026 abemaciklib.",
   note="Str. 4 nemá textovou vrstvu (prázdná nebo jen obraz). Jako otázku uvádíme větu o NCH semináři, výslovná otázka chybí.", insurer="111"),
 e("11_pacient.pdf", "Lenka Kabátová", None, "Vestibulární schwannom vlevo (Koos I), drobný meningeom F vlevo",
   None, False,
   "Náhlé vertigo se zvracením a zhoršením sluchu vlevo; MR mozku s KL: intrameatální tumor do 7 mm charakteru schwannomu n. VIII vlevo a drobný parafalcinní meningeom F vlevo do 6 mm; Fazekas III, atrofie.",
   note="Formulář bez rodného čísla a bez otázky pro MDT.", insurer="205"),
 e("13_pacient.pdf", "Patricie Moučková", None, "Kalcifikovaný meningeom parietálně vlevo",
   "Prosím laskavě o konzultaci CT mozku a srovnání s MRI.", True,
   "CT mozku 19.8.2026 (při akutní závrati): kalcifikovaný meningeom parietálně vlevo 12 x 9 mm, bez průkazu MTS; MR 8/2025 ložisko 10x6 mm, stacionární proti 10/2023; v anamnéze ca prsu (2002 až 2004, t.č. remise).",
   note="Velikost ložiska se liší mezi CT 8/2026 (12 x 9 mm) a MR 8/2025 (10x6 mm); jde o různé modality, proto to samo o sobě není rozpor. Právě srovnání je předmětem dotazu.", insurer="211"),
 e("15_pacient.pdf", "Luděk Zápotocký", None, "Léze postranní komory vpravo, v.s. ependymom či subependymom",
   None, False,
   "MR mozku: FLAIR hypersignální léze 7x6 mm na vnitřní stěně pravé postranní komory bez sycení, stacionární obraz v.s. ependymomu či subependymomu, bez poruchy cirkulace likvoru.",
   note="Jen radiologický popis, bez data vyšetření, anamnézy a otázky. Číslo '111' je v poli pro pojišťovnu nebo RČ, přiřazení nejisté.", insurer="111 (nejisté)"),
 e("17_pacient.pdf", "Otakar Jelen", None, "Intraoseální ložisko kalvy frontálně vpravo, DD meningeom vs. MTS (ca cekoascendens)",
   "Žádost o doporučení dalšího postupu: MDT doporučilo konzultaci NCH, MR mozku a scintigrafii skeletu, zatím nedoplněno, 'vyčkáme Vašeho doporučení'.", False,
   "Ca cekoascendens pT3 pN0 cM0, stp. pravostranné hemikolektomii, susp. Lynch syndrom; CT mozku 13.9.2026 při vestibulárním syndromu: intraoseální ložisko F vpravo s extraaxiální propagací 13x7 mm, DD intraoseální meningeom x MTS.",
   note="Ve formuláři je 'Jméno: Jelen', 'Příjmení: Otakar', pole jsou pravděpodobně prohozená. Ověřit identitu."),
 e("18_pacient.pdf", "Libor Opletal", "53 let", "Syringomyelie Th4 až Th12, susp. drobný ependymom v oblasti konu",
   None, False,
   "Opakované silné lumbalgie se zhoršením; MR Th páteře s KL: cystické okrsky míchy Th4 až Th12, rozšíření míchy max. v oblasti konu 15x17 mm se sytícími okrsky do 4,5x4 mm (drobný ependymom nelze vyloučit); protruze L3 až L5.",
   note="Formulář bez RČ, pojišťovny a otázky pro MDT; data vyšetření neuvedena."),
 e("19_pacient.pdf", "Martina Palajová", None, "Regredující monoparéza LHK (DD iCMP/TIA vs. epiparoxyzmus), fraktura dens axis, aneuryzmata ACI",
   None, False,
   "Přijata 29.9. pro odeznělou monoparézu LHK po vysazení antikoagulace; fraktura baze dens axis po pádu 27.9. (konzervativně dle NCH); CTAG 13.10.2026: vlevo dvě výdutě ACI 2 a 3 mm pod bazí lební.",
   note="OCR text je na pravém okraji useknutý (věty nedokončené). Formulář bez RČ, pojišťovny a otázky."),
 e("20_pacient.pdf", "Richard Potužný", "69 let", "Infiltrace obratlů C6 až Th1, DD spondylodiscitida vs. maligní infiltrace (ca prostaty)",
   None, False,
   "4 měsíce po TURP (ca prostaty 5/2026) a sepsi; MR Cp 14.9.26: infiltrace obratlových těl C6/C7/Th1 se stenózou kanálu bez komprese míchy; scintigrafie: osteolytická ložiska C páteře, susp. okrsky kalvy, Th6 a LS-S1; NCH doporučilo nahlásit na NOCO a doplnit CT hrudníku a břicha.",
   note="Výslovná otázka chybí; dokument uvádí jen doporučení NCH 'nahlásit na NOCO'. Formulář bez RČ a pojišťovny."),
]
out = json.dumps(L, ensure_ascii=False, indent=1)
assert "—" not in out
open(S + "mock-patient-list.json", "w").write(out)
print(len(L))
