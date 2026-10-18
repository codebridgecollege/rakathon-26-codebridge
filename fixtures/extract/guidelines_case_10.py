"""Build fixtures/data/guidelines-case-10.json from the downloaded guideline PDFs and check every quote.

Page text is `pdftotext` (reading order, not -layout, because both guidelines use two columns)
with typographic ligatures (fi, fl) unfolded; nothing else is changed.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "fixtures/data/guidelines-case-10.json"

GUIDELINES = [
    {
        "id": "eano-esmo-2021-bm",
        "name": "EANO-ESMO Clinical Practice Guidelines for diagnosis, treatment and follow-up of patients with brain metastasis from solid tumours",
        "society": "EANO, ESMO",
        "year": 2021,
        "version": "Le Rhun E et al. Ann Oncol 2021;32(11):1332-1347, doi:10.1016/j.annonc.2021.07.016",
        "region": "EU",
        "url": "https://doi.org/10.1016/j.annonc.2021.07.016",
        "pdf_url": "https://www.annalsofoncology.org/article/S0923753421022146/pdf",
        "file": "docs/sources/guidelines/eano-esmo-2021-brain-metastases.pdf",
        "license": "© 2021 European Society for Medical Oncology, published by Elsevier Ltd, 'All rights reserved' (printed on page 1). Free to read (Elsevier open access user license 1.0, http://www.elsevier.com/open-access/userlicense/1.0/, per the Elsevier API record), which allows reading and personal use, not redistribution. Our copy is the publisher PDF from the Sapienza IRIS repository (hdl.handle.net/11573/1676379); OpenAlex tags that repository copy cc-by-nc-nd, which conflicts with the 'All rights reserved' line in the PDF.",
        "republish_ok": False,
    },
    {
        "id": "cos-mk-2026",
        "name": "Modrá kniha České onkologické společnosti",
        "society": "Česká onkologická společnost ČLS JEP",
        "year": 2026,
        "version": "32. aktualizace, platnost od 1. 3. 2026 (ISBN 978-80-86793-63-4)",
        "region": "CZ",
        "url": "https://www.linkos.cz/lekar-a-multidisciplinarni-tym/personalizovana-onkologie/modra-kniha-cos/aktualni-vydani-modre-knihy/",
        "pdf_url": "https://www.linkos.cz/files/modra-kniha/26.pdf",
        "file": "docs/sources/guidelines/cos-modra-kniha-2026.pdf",
        "license": "© Masarykův onkologický ústav, 2026 (imprint, PDF page 3). Published free online on linkos.cz; no licence for redistribution found on linkos.cz or in the PDF. Short quotations with source are allowed under the Czech copyright citation exception; republishing the whole PDF is not granted.",
        "republish_ok": False,
    },
]

NOT_RETRIEVED = [
    {
        "name": "ESMO Clinical Practice Guideline: Renal cell carcinoma (Powles T et al., Ann Oncol 2024;35(8):692-706) a ESMO Living Guideline RCC v1.1 (červen 2025)",
        "society": "ESMO",
        "region": "EU",
        "url": "https://www.esmo.org/guidelines/esmo-clinical-practice-guideline-renal-cell-carcinoma",
        "pdf_url": "https://www.annalsofoncology.org/action/showPdf?pii=S0923-7534%2824%2900676-8",
        "reason": "PDF nelze stáhnout (vydavatel 403, není v PMC, kopie v repozitáři je neveřejná); sada snímků Living Guideline obsahuje jen obrázky bez textu, citace proto nelze ověřit",
    }
]

PDF_PAGE_TO_PRINTED = {
    # EANO-ESMO: PDF page 1 is printed page 1332 (page footers 1333...1347).
    "eano-esmo-2021-bm": lambda p: p + 1331,
    # Modrá kniha: the pages carry no printed number; the table of contents numbering equals the PDF page
    # (chapter 21 listed at 215 starts on PDF page 215).
    "cos-mk-2026": lambda p: p,
}

PT_BM = ["MR mozku 14. 9. 2026: solitární sytící se ložisko v pravé hemisféře mozečku do 3 mm, susp. metastáza",
         "ECOG PS 1, bez klinických známek mozkových metastáz (občasné mžitky před očima)"]
PT_LINES = ["1. linie nivolumab + ipilimumab, progrese (iRECIST potvrzena 1/2026)",
            "2. linie sunitinib 1-8/2026, progrese",
            "od 9/2026 3. linie everolimus 5 mg"]

STATEMENTS = [
    dict(id="eano-srs-1-4", guideline_id="eano-esmo-2021-bm", section="Management - Recommendations - Radiotherapy", pdf_page=7,
         quote="SRS is recommended for patients with a limited number (1-4) of BMs",
         evidence="EANO: I, A; ESMO: I, A",
         applies_because_cs="Jediné ložisko podezřelé z metastázy (počet 1, tedy v rozmezí 1-4). Metastáza zatím není potvrzena.",
         patient_facts=PT_BM[:1], kind="brain_metastasis"),
    dict(id="eano-posterior-fossa", guideline_id="eano-esmo-2021-bm", section="Management - Surgery", pdf_page=4,
         quote="Posterior fossa location often constitutes a surgical indication because of the risk of obstructive hydrocephalus.",
         evidence="bez stupně (text kapitoly, ne doporučení)",
         applies_because_cs="Ložisko je v mozečku (zadní jáma lební). Velikost do 3 mm; věta v textu se týká rizika obstrukčního hydrocefalu.",
         patient_facts=PT_BM[:1], kind="brain_metastasis"),
    dict(id="eano-srs-vs-surgery-factors", guideline_id="eano-esmo-2021-bm", section="Integrated therapeutic approaches", pdf_page=8,
         quote="Factors favouring SRS alone over surgery commonly followed by SRS or systemic therapy include a surgically less accessible location, increased surgical risk and preference for a noninvasive outpatient treatment.",
         evidence="bez stupně (text kapitoly, ne doporučení)",
         applies_because_cs="MDT volí mezi lokální léčbou a sledováním malého ložiska v mozečku.",
         patient_facts=PT_BM, kind="brain_metastasis"),
    dict(id="eano-no-trials-timing", guideline_id="eano-esmo-2021-bm", section="Integrated therapeutic approaches", pdf_page=8,
         quote="For patients with asymptomatic or oligosymptomatic BM, no prospective trials have addressed the question of optimal combined modality treatment with systemic therapy, including TKI or immune checkpoint inhibition, and surgery or SRS.",
         evidence="bez stupně (text kapitoly, ne doporučení)",
         applies_because_cs="Ložisko je bez klinických projevů a pacient je na systémové léčbě (everolimus); otázka načasování lokální léčby vůči systémové.",
         patient_facts=PT_BM + PT_LINES[2:], kind="brain_metastasis"),
    dict(id="eano-bm-board", guideline_id="eano-esmo-2021-bm", section="Integrated therapeutic approaches - Recommendations", pdf_page=8,
         quote="Ideally, therapeutic decisions should be discussed at a dedicated BM board or at a disease-specific tumour board with participation of colleagues experienced in the management of CNS tumours",
         evidence="EANO: IV, n/a; ESMO: V, B",
         applies_because_cs="Pacient je projednáván na MDT kvůli podezření na metastázu v mozečku.",
         patient_facts=PT_BM[:1], kind="brain_metastasis"),
    dict(id="eano-mri-2-3-months", guideline_id="eano-esmo-2021-bm", section="Monitoring and follow-up - Recommendations", pdf_page=12,
         quote="Brain MRI should be carried out every 2-3 months or at any instance of suspected neurological progression [EANO: IV, C; ESMO: IV, B]",
         evidence="EANO: IV, C; ESMO: IV, B",
         applies_because_cs="Doporučení platí pro sledování pacientů s mozkovými metastázami; u pacienta je metastáza zatím jen suspektní (MR 14. 9. 2026).",
         patient_facts=PT_BM, kind="brain_metastasis"),
    dict(id="eano-systemic-prev-treatment", guideline_id="eano-esmo-2021-bm", section="Management - Recommendations - Pharmacotherapy", pdf_page=7,
         quote="Systemic pharmacotherapy based on histological and molecular characteristics of the primary tumour and previous treatment should be considered for most patients with BMs",
         evidence="EANO: IV, n/a; ESMO: IV, B",
         applies_because_cs="Primární nádor: světlobuněčný karcinom ledviny G2; tři předchozí linie systémové léčby.",
         patient_facts=["světlobuněčný renální karcinom G2, nefrektomie vpravo 6/2022, pT2a pN1 M0"] + PT_LINES, kind="systemic_therapy"),
    dict(id="eano-cns-extracns-activity", guideline_id="eano-esmo-2021-bm", section="Management - Pharmacotherapy", pdf_page=5,
         quote="In the situations of multiple systemic treatment options, CNS and extra-CNS disease activity as well as toxicity profile of the respective treatment options should be considered in the decision-making process for the optimal systemic treatment strategy",
         evidence="EANO: IV, A; ESMO: IV, B",
         applies_because_cs="MDT se ptá i na pozdější systémové možnosti; vedle ložiska v mozečku je extrakraniální onemocnění (uzliny, kůže, nejasná ložiska Th/L).",
         patient_facts=PT_BM[:1] + ["histologicky ověřené metastázy (paraaortální uzlina, kůže)", "možná drobná osteoplastická ložiska Th/L (nejasné)"], kind="systemic_therapy"),
    dict(id="cos-3l-after-io-tki", guideline_id="cos-mk-2026", section="21.2.2 Systémová léčba metastatického karcinomu ledviny - Léčebný algoritmus - Léčba mRCC třetí linie - Předchozí léčba IO a inhibitorem VEGF-TKI", pdf_page=217,
         quote="Kabozantinib (2A) Everolimus (2A) Dosud nepoužitý VEGF-TKI (2B) Belzutifan (2B) Lenvatinib a everolimus (2B)",
         evidence="stupeň ČOS u každého léku: 2A, 2A, 2B, 2B, 2B",
         applies_because_cs="Pacient měl IO (nivolumab + ipilimumab) a VEGF-TKI (sunitinib); everolimus ze stejného boxu už dostává. Algoritmus nemá box pro 4. linii.",
         patient_facts=PT_LINES, kind="systemic_therapy"),
    dict(id="cos-lines-not-limited", guideline_id="cos-mk-2026", section="21.2.2 Systémová léčba metastatického karcinomu ledviny - Komentář k léčebným schématům", pdf_page=218,
         quote="Počet linií léčby mRCC by neměl být limitován jinak než stavem nemocného a dostupností léků (2A).",
         evidence="ČOS 2A",
         applies_because_cs="Pacient je ve 3. linii; MDT se ptá na další systémové možnosti. ECOG PS 1.",
         patient_facts=PT_LINES + ["ECOG PS 1"], kind="systemic_therapy"),
    dict(id="cos-clinical-trial", guideline_id="cos-mk-2026", section="21.2.2 Systémová léčba metastatického karcinomu ledviny - Komentář k léčebným schématům", pdf_page=218,
         quote="U nemocných s mRCC by mělo být zvažováno zařazení do klinické studie.",
         evidence="bez stupně",
         applies_because_cs="Metastatický světlobuněčný RCC po vyčerpání IO a VEGF-TKI.",
         patient_facts=PT_LINES, kind="systemic_therapy"),
    dict(id="cos-metastasectomy-sbrt", guideline_id="cos-mk-2026", section="21.2.1 Chirurgická léčba metastatického karcinomu ledviny", pdf_page=216,
         quote="Chirurgická léčba metastáz je doporučena v případě možnosti jejich kompletního odstranění a zvážení přínosu vs. operační zátěže (úroveň důkazů 2A), alternativou může být využití lokálně ablativních metod (např. SBRT).",
         evidence="ČOS 2A",
         applies_because_cs="Věta platí obecně pro metastázy RCC, mozek nejmenuje. MDT zvažuje lokální léčbu ložiska v mozečku.",
         patient_facts=PT_BM[:1], kind="brain_metastasis"),
]


REPEATED_ON_PAGE = {"eano-bm-board"}


def page_text(pdf: Path, page: int) -> str:
    out = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    # Unfold typographic ligatures so the quote can be typed and searched; the words are unchanged.
    return out.replace("ﬁ", "fi").replace("ﬂ", "fl").replace("\f", "")


def norm(s: str) -> str:
    # Join words hyphenated at a line break (same rule for page and quote), then collapse whitespace.
    s = re.sub(r"(\w)-\n(\w)", r"\1\2", s)
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    gl = {g["id"]: g for g in GUIDELINES}
    pages, failures = {}, []
    for st in STATEMENTS:
        key = (st["guideline_id"], st["pdf_page"])
        if key not in pages:
            pages[key] = page_text(REPO / gl[st["guideline_id"]]["file"], st["pdf_page"])
        st["printed_page"] = PDF_PAGE_TO_PRINTED[st["guideline_id"]](st["pdf_page"])
        n = norm(pages[key]).count(norm(st["quote"]))
        # The board sentence appears word for word twice on page 8 (text and recommendation box), same grade.
        if n != 1 and not (n == 2 and st["id"] in REPEATED_ON_PAGE):
            failures.append(f"{st['id']}: quote found {n} times on {key}")
    order = ["id", "guideline_id", "section", "pdf_page", "printed_page", "quote", "evidence", "applies_because_cs", "patient_facts", "kind"]
    data = {
        "guidelines": GUIDELINES,
        "statements": [{k: st[k] for k in order} for st in STATEMENTS],
        "not_retrieved": NOT_RETRIEVED,
        "pages": [{"guideline_id": g, "pdf_page": p, "text": t} for (g, p), t in sorted(pages.items())],
    }
    if failures:
        print("\n".join(failures))
        return 1
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes): {len(STATEMENTS)} statements, {len(pages)} pages; every quote found on its page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
