import json, re
S = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "data") + "/"
ocr = json.load(open(S + "ocr.json"))
def e(file, name, age, problem, q, q_explicit, summary, note=None, insurer=None):
    d = {"file": file, "name": name, "age_or_birth": age, "insurer": insurer, "main_problem_cs": problem,
         "mdt_question_cs": q, "mdt_question_explicit": q_explicit, "one_line_summary_cs": summary,
         "page_count": len(ocr[file])}
    if note: d["note"] = note
    return d
L = [
 e("2_pacient.pdf", "Jaroslava Kotěrová", None, "High grade gliový tumor temporálně vpravo, dle pooperační MR GBM",
   "Vzhledem k rozsahu tumoru (propagace do thalamu a mesencephala) symptomatická terapie?", True,
   "Po kolapsu nalezena objemná expanze T vpravo s šířením do inzuly, thalamu a mesencefala; resekce 7.8.2026, histol. high grade gliový tumor (Ki67 až 70 %), pooperačně rozsáhlé reziduum; levostranná hemiparéza a neglect.",
   note="Jméno v dokumentu zapsáno 'Kotěrova Jaroslava'.", insurer="205"),
 e("9_pacient.pdf", "Zdena Zábělská", "nar. 13.10.1961", "Invazivní karcinom NST levého prsu, G2, pT2 N1mi(1+/3sn) M0 (2023); MTS do skeletu",
   "Nález na PET/CT bude prezentován na NCH semináři k posouzení indikace NCH intervence.", False,
   "Ca levého prsu (2023, stp. mastektomii, RT, letrozol); 9/2026 progrese s mnohočetnými převážně osteolytickými MTS skeletu, patologická komprese Th2 až vertebra plana s měkkotkáňovou složkou do páteřního kanálu; od 7.9.2026 fulvestrant, od 22.9.2026 abemaciklib.",
   note="Str. 4 nemá textovou vrstvu (prázdná nebo jen obraz). Jako otázku uvádíme větu o NCH semináři, výslovná otázka chybí.", insurer="111"),
 e("11_pacient.pdf", "Lenka Kabátová", None, "V.s. neurinom akustiku vlevo, Koos I; drobný meningeom F parafalcinně vlevo, do 6 mm",
   None, False,
   "Náhlé vertigo se zvracením a zhoršením sluchu vlevo; MR mozku s KL: intrameatální tumor do 7 mm charakteru schwannomu n. VIII vlevo a drobný parafalcinní meningeom F vlevo do 6 mm; Fazekas III, atrofie.",
   note="Formulář bez rodného čísla a bez otázky pro MDT.", insurer="205"),
 e("13_pacient.pdf", "Patricie Moučková", None, "Kalcifikovaný meningeom parietálně vlevo, 12 x 9 mm",
   "Prosím laskavě o konzultaci CT mozku a srovnání s MRI.", True,
   "CT mozku 19.8.2026 (při akutní závrati): kalcifikovaný meningeom parietálně vlevo 12 x 9 mm, bez průkazu MTS; MR 8/2025 ložisko 10x6 mm, stacionární proti 10/2023; v anamnéze ca prsu (2002 až 2004, t.č. remise).",
   note="Velikost ložiska se liší mezi CT 8/2026 (12 x 9 mm) a MR 8/2025 (10x6 mm); jde o různé modality, proto to samo o sobě není rozpor. Právě srovnání je předmětem dotazu.", insurer="211"),
 e("15_pacient.pdf", "Luděk Zápotocký", None, "V.s. ependymom či subependymom postranní komory vpravo, 7x6 mm",
   None, False,
   "MR mozku: FLAIR hypersignální léze 7x6 mm na vnitřní stěně pravé postranní komory bez sycení, stacionární obraz v.s. ependymomu či subependymomu, bez poruchy cirkulace likvoru.",
   note="Jen radiologický popis, bez data vyšetření, anamnézy a otázky. Číslo '111' je v poli pro pojišťovnu nebo RČ, přiřazení nejisté.", insurer="111 (nejisté)"),
 e("17_pacient.pdf", "Otakar Jelen", None, "Intraoseální ložisko kalvy F vpravo, DD intraoseální meningeom x MTS",
   "Žádost o doporučení dalšího postupu: MDT doporučilo konzultaci NCH, MR mozku a scintigrafii skeletu, zatím nedoplněno, 'vyčkáme Vašeho doporučení'.", False,
   "Ca cekoascendens pT3 pN0 cM0, stp. pravostranné hemikolektomii, susp. Lynch syndrom; CT mozku 13.9.2026 při vestibulárním syndromu: intraoseální ložisko F vpravo s extraaxiální propagací 13x7 mm, DD intraoseální meningeom x MTS.",
   note="Jméno a příjmení ve formuláři prohozené: 'Jméno pacienta: Jelen', 'Příjmení pacienta: Otakar'. Otakar je křestní jméno, příjmení Jelen."),
 e("18_pacient.pdf", "Libor Opletal", "53 let", "Syringomyelie Th4-Th12, drobný ependymom v oblasti konu nelze vyloučit",
   None, False,
   "Opakované silné lumbalgie se zhoršením; MR Th páteře s KL: cystické okrsky míchy Th4 až Th12, rozšíření míchy max. v oblasti konu 15x17 mm se sytícími okrsky do 4,5x4 mm (drobný ependymom nelze vyloučit); protruze L3 až L5.",
   note="Formulář bez RČ, pojišťovny a otázky pro MDT; data vyšetření neuvedena."),
 e("19_pacient.pdf", "Martina Palajová", None, "Dvě výdutě ACI vlevo pod bazí lební, cca 2 a 3 mm; fraktura baze dens axis",
   None, False,
   "Přijata 29.9. pro odeznělou monoparézu LHK po vysazení antikoagulace; fraktura baze dens axis po pádu 27.9. (konzervativně dle NCH); CTAG 13.10.2026: vlevo dvě výdutě ACI 2 a 3 mm pod bazí lební.",
   note="OCR text je na pravém okraji useknutý (věty nedokončené). Formulář bez RČ, pojišťovny a otázky."),
 e("20_pacient.pdf", "Richard Potužný", "69 let", "Infiltrace obratlových těl C6-Th1, DD spondylodiscitida x maligní infiltrace",
   None, False,
   "4 měsíce po TURP (ca prostaty 5/2026) a sepsi; MR Cp 14.9.26: infiltrace obratlových těl C6/C7/Th1 se stenózou kanálu bez komprese míchy; scintigrafie: osteolytická ložiska C páteře, susp. okrsky kalvy, Th6 a LS-S1; NCH doporučilo nahlásit na NOCO a doplnit CT hrudníku a břicha.",
   note="Výslovná otázka chybí; dokument uvádí jen doporučení NCH 'nahlásit na NOCO'. Formulář bez RČ a pojišťovny."),
]
# Draft MDT question when the referral states none (team decision 2026-10-17, after Sona's review). The draft is
# always shown as a draft until a doctor confirms it. "document_purpose": the document's own purpose sentence already
# is a task, rephrased as a question; "assistant_inference": the assistant's reading of what the referrer wants to know.
# A draft names only treatment options the doctor suggested in her review or a document states (round 24 review).
# question_basis lists the passages the draft rests on: the purpose sentence first (role "purpose", if any), then each
# finding the draft cites (role "finding"). Every quote is verbatim from the OCR text and is checked below, so a draft
# never rests on an invented sentence.
norm = lambda s: re.sub(r"\s+", " ", s).strip()
P, F = "purpose", "finding"
DRAFTS = {
 "9_pacient.pdf": ("Je indikována neurochirurgická intervence pro nález na PET/CT (patologická komprese obratle Th2)?", "document_purpose", [
   (P, 3, "Nález na PET/CT vyš. bude prezentován na NCH semináři k posouzení indikace NCH intervence, jinak příště objednáme analgetickou pal. RT."),
   (F, 2, "CAVE patol. komprese obratlového těla Th2")]),
 "11_pacient.pdf": ("Souhlasí radiolog s nálezem tumoru charakteru schwannomu n. VIII vlevo a drobného meningeomu F parafalcinně vlevo? Je indikováno operační řešení, nebo sledování?", "assistant_inference", [
   (F, 2, "charakteru Schwanomu n. VIII sin"),
   (F, 2, "Drobný meningeom F parafalcinně sin")]),
 "15_pacient.pdf": ("Souhlasí radiolog s obrazem v.s. ependymomu či subependymomu postranní komory vpravo? Jaký další postup?", "assistant_inference", [
   (F, 1, "Závěr: Stacionární obraz v.s. ependymomu či subependymomu postranní komory vpravo.")]),
 "17_pacient.pdf": ("Jaký postup doporučuje NCH u intraoseálního ložiska kalvy F vpravo (DD intraoseální meningeom x MTS)?", "document_purpose", [
   (P, 1, "V rámci MDT doporučena konzultace NCH, MR mozku a scinti skeletu (zobrazovací metody zatím nedoplněny, vyčkáme Vašeho doporučení)."),
   (F, 1, "intraoseální ložisko vpravo F s propagací intrakraniálně extraaxiálně- v diff.dg. intraoseální meningeom x meta ložisko v rámci zákl dg.")]),
 "18_pacient.pdf": ("Jde o nádor míchy (drobný ependymom v oblasti konu nelze vyloučit), nebo jsou obtíže degenerativního původu (protruze L3 až L5)? Je indikováno operační řešení?", "assistant_inference", [
   (F, 1, "zde drobný ependymom v terénu výrazné syringomyelie nevyloučím."),
   (F, 1, "V segm. L3/L4 je cirkulární protruze disku do 3 mm"),
   (F, 2, "V segm. L4/L5 je cirkulární protruze plotny, s impresí ventrální plochy durálního vaku")]),
 "19_pacient.pdf": ("Je indikováno endovaskulární řešení (coiling) dvou výdutí ACI vlevo (cca 2 a 3 mm pod bazí lební)?", "assistant_inference", [
   (F, 1, "vlevo dvě sousedící výdutě stěny ACI o vel. cca 2 mm a 3 mm pod bazí lebky")]),
 "20_pacient.pdf": ("Je indikováno neurochirurgické řešení infiltrace obratlových těl C6 až Th1 (resekce, náhrada obratlových těl)? Povaha infiltrace zatím nejasná (zánětlivé změny vs. maligní infiltrace).", "assistant_inference", [
   (P, 1, "Dle rekonzultace NCH - nahlásit na NOCO a doplnit CT hrudníku a břicha s kontrastem."),
   (F, 1, "MR Cp 14.9.26 - Výrazná infiltrace obr. těl C6/C7/Thl vč. pediklů a neuroforamin vpravo, postkontrastně se sytící, parc. až kompletní zánik meziobr. prostor C6-Thl."),
   (F, 1, "Dif.dg.: susp. rozsáhlé zánětlivé změny (spondylodiscitis?) / maligní infiltrace?")]),
}
for d in L:
    dr = DRAFTS.get(d["file"])
    assert bool(dr) != bool(d["mdt_question_explicit"]), d["file"]
    if dr:
        text, kind, quotes = dr
        for role, page, quote in quotes:
            assert norm(quote) in norm(ocr[d["file"]][page - 1]), (d["file"], quote)
        d["question_draft_cs"] = text
        d["question_kind"] = kind
        d["question_basis"] = [{"role": role, "quote": norm(quote), "source": {"file": d["file"], "page": page}} for role, page, quote in quotes]
    else:
        d["question_draft_cs"] = None
        d["question_kind"] = None
        d["question_basis"] = None
# The 17 form has first name and surname in each other's fields; Otakar is the first name. This is a form error, not
# an identity conflict between documents, so it is a neutral note with its source (Sona's review, round 22).
NAME_NOTES = {"17_pacient.pdf": ("jméno a příjmení ve formuláři prohozené", 1, "Jméno pacienta: Jelen Příjmení pacienta: Otakar")}
for d in L:
    nn = NAME_NOTES.get(d["file"])
    if nn:
        assert norm(nn[2]) in norm(ocr[d["file"]][nn[1] - 1]), d["file"]
        d["name_note_cs"] = nn[0]
        d["name_note_source"] = {"file": d["file"], "page": nn[1], "quote": norm(nn[2])}
out = json.dumps(L, ensure_ascii=False, indent=1)
assert "—" not in out
open(S + "mock-patient-list.json", "w").write(out)
print(len(L))
