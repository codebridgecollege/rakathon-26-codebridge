# Czech, the patient detail screen (S-3): header, brief, MDT question, alerts, timeline and the tabs.
# Message IDs start with "patient-" so they never collide with another area's file. The catalog holds interface
# text only: no patient names, quotes or values.

## Fixed clinical wording (CLAUDE.md). Defined once as terms, so the screens cannot drift apart. A clinician signs
## off every translation of these.

-gap-not-stated = neuvedeno v dostupné dokumentaci
# The feminine form, for "otázka" (Výslovná otázka neuvedena v dostupné dokumentaci).
-gap-not-stated-f = neuvedena v dostupné dokumentaci
-trust-verify-reading = ověřit čtení
-trust-negation = zápor v dokumentu
-trust-observation = pozorování asistenta
-trust-observation-cap = Pozorování asistenta

patient-gap-not-stated = { -gap-not-stated }

## Dates and slots

patient-date-dmy = { $d }. { $m }. { $y }
patient-weekday-short = { $weekday ->
    [0] Ne
    [1] Po
    [2] Út
    [3] St
    [4] Čt
    [5] Pá
   *[6] So
}
patient-slot = { patient-weekday-short } { $d }. { $m }. { $y } · { $from }-{ $to }
patient-slot-none = nenaplánováno

## Doctor edits

patient-edit-button = Upravit
patient-edit-tag = upraveno
patient-edit-tag-tooltip = Upravil(a) { $by }, { $when }. Původně: { $orig }

## Certainty marks (tooltips of the small icons next to a fact)

patient-mark-ocr = Ověřit čtení: { $note }
patient-mark-ocr-default = text mohl být špatně přečten
patient-mark-inferred = { -trust-observation-cap }, v dokumentu výslovně není
patient-mark-planned = Plánováno, dokument neuvádí, že se stalo
patient-mark-planned-note = Plánováno, dokument neuvádí, že se stalo: { $note }
patient-mark-note = Poznámka asistenta: { $note }
patient-mark-conflict = Rozpor mezi dokumenty
patient-mark-conflict-note = Rozpor mezi dokumenty: { $note }

## Certainty tags (written out, on lab values)

patient-tag-negated = { -trust-negation }
patient-tag-ocr = { -trust-verify-reading }
patient-tag-inferred = { -trust-observation }

## Sources

patient-src-open = Otevřít zdroj
patient-src-page = s.{" "}{ $page }
patient-src-quote = „{ $quote }“
patient-src-link-label = Otevřít zdroj, strana { $page }: { $quote }
patient-src-list = { $label } ({ $n })
patient-src-list-label = Zdroje
patient-src-list-page = , s. { $page }:{" "}
patient-src-unavailable = Původní dokument není v maketě k dispozici.

## Page frame and tabs

patient-back = ‹ Databáze pacientů
patient-loading = Načítám podklady případu…
patient-load-failed = Podklady případu se nepodařilo načíst.
patient-retry = Zkusit znovu
patient-close = Zavřít
patient-tab-overview = Přehled
patient-tab-anamnesis = Anamnéza
patient-tab-documents = Dokumenty
patient-tab-labs = Laboratoř
patient-tab-alerts = Upozornění
patient-tab-next = Navrhovaný postup
patient-tab-dev = Retrospektivní odchylky
patient-tab-prognosis = Prognóza

## Case header

patient-synthetic = syntetický pacient
patient-synthetic-tooltip = Fiktivní pacient vytvořený týmem CodeBridge (vlastní syntetická dokumentace), ne z dat FNO
patient-header-rc = RČ:
patient-header-age = Věk:
patient-header-verify-identity = Ověřit identitu:
patient-header-name-note = Pozn.:
patient-header-owner = Vlastník:
patient-header-dept = Pracoviště:
patient-header-next-mdt = Příští MDT:
patient-action-schedule = Naplánovat
patient-action-reschedule = Změnit termín
patient-action-start-mdt = Zahájit MDT
patient-action-fhir = Export FHIR
patient-action-report = Stáhnout report (PDF)

## Case status (lifecycle: Nový, Naplánován, Připraven, Projednán, Uzavřen; Vyžaduje pozornost is a side state)

patient-status-new = Nový
patient-status-scheduled = Naplánován
patient-status-attention = Vyžaduje pozornost
patient-status-ready = Připraven
patient-status-done = Projednán
patient-status-closed = Uzavřen
patient-status-menu = Stav případu
patient-status-tooltip = Kliknutím zobrazíte stav a historii.
patient-status-tooltip-last = Naposledy změnil(a) { $by }, { $when }. Kliknutím zobrazíte historii.
patient-status-reopen = Znovu otevřít ({ $status })
patient-status-close = Uzavřít případ
patient-status-back = Vrátit na: { $status }
patient-status-change = Změnit na: { $status }
patient-status-unapproved-draft = Případ má neschválený koncept závěru.
patient-status-help = Naplánován nastaví rezervace termínu, Projednán schválení závěru MDT.
patient-status-read-only = Stav mění lékař nebo koordinátorka; správce jen čte.
patient-status-history = Historie stavu
patient-status-no-history = V této relaci beze změn.
patient-status-closed-toast = Případ uzavřen
patient-status-closed-slot-freed = Případ uzavřen, termín { $slot } uvolněn
patient-status-reopened-toast = Případ znovu otevřen
patient-status-changed-toast = Stav změněn na { $status }

## The MDT question

patient-question-title = Otázka pro MDT
patient-question-edit = Upravit otázku
patient-question-none = Výslovná otázka { -gap-not-stated-f }.
patient-question-confirm = Potvrdit otázku
patient-question-confirmed = Otázka potvrzena
# The label of a question the assistant drafted (the referral states none), shown until a doctor confirms or edits it;
# the same words as the chip over the assistant's drafted tasks (discussion-sugg-chip).
patient-question-draft = Návrh asistenta
# Its tooltip; { $basis } is the passages the draft rests on, quoted verbatim with their pages (patient-fhir-basis).
patient-question-draft-tip = Žádanka výslovnou otázku neuvádí. Otázku navrhl asistent; platí, až ji lékař potvrdí nebo upraví. { $basis }

## Edit dialog

patient-edit-dialog = Upravit údaj
patient-edit-original = Původně (z dokumentu nebo od asistenta)
patient-edit-note = Úprava se uloží jako změna od { $user } s časem. Původní dokument se nemění a původní hodnota zůstane v historii případu.
patient-edit-revert = Vrátit původní
patient-edit-save = Uložit
patient-edit-saved = Úprava uložena
patient-edit-reverted = Vrácen původní údaj

## Brief ("Stručný souhrn")

patient-brief-title = Stručný souhrn
patient-brief-from-list = Souhrn ze seznamu pacientů, bez odkazů na zdroj.
patient-brief-source = Zdroj: { $file }, { $pages } s.
patient-unprocessed = Nezpracováno
patient-processed = Zpracováno: { $parts }
patient-processed-documents = dokumenty
patient-processed-missing = chybějící podklady
patient-processed-labs = laboratoř
patient-processed-anamnesis = anamnéza
patient-processed-findings = nálezy

## Missing-document signal (always on, CLAUDE.md) and the brief's alert panel

patient-missing-unchecked = ⚠ Chybějící podklady nezkontrolovány (případ nezpracován)
patient-missing-failed = ⚠ Chybějící podklady nelze ověřit (načtení selhalo)
patient-gaps-toggle = ⚠ Upozornění
patient-gaps-toggle-missing = ⚠ Upozornění · chybí podklady
patient-gaps-title = Upozornění
patient-gaps-for-question = Upozornění k dotazu na MDT
patient-gaps-all = Všechna upozornění
patient-gaps-none = Žádná aktivní upozornění.
patient-gaps-documents = Chybějící a nejasné podklady

## Alerts (the assistant's observations; they never block the discussion)

patient-alerts-disclaimer = { -trust-observation-cap }, ne klinický závěr. Upozornění neblokují projednání.
patient-alerts-title = Upozornění
patient-alerts-for-question = K dotazu na MDT
patient-alerts-other = Ostatní upozornění
patient-alerts-more-contradiction = Rozpor, další
patient-alerts-more-missing = Chybí, další
patient-alerts-more-chronology = Chronologie, další
patient-alerts-more-unclear = Nejasné, další
patient-alerts-more-poor-copy = Špatná kopie, další
patient-alerts-more-identity = Jiný pacient, další
patient-alert-kind-missing = Chybí
patient-alert-kind-contradiction = Rozpor
patient-alert-kind-chronology = Chronologie
patient-alert-kind-unclear = Nejasné
patient-alert-kind-poor-copy = Špatná kopie
patient-alert-kind-identity = Jiný pacient
patient-alert-ack = Vzít na vědomí
patient-alert-resolve = Vyřešeno
patient-alert-reopen = Vrátit
patient-alert-acked-by = Vzal(a) na vědomí { $who }, { $when }
patient-alert-resolved-by = Vyřešil(a) { $who }, { $when }
patient-alert-reopened-by = Vrátil(a) mezi otevřená { $who }, { $when }
patient-alert-hist-ack = vzal(a) na vědomí
patient-alert-hist-resolved = vyřešil(a)
patient-alert-hist-reopen = vrátil(a) mezi otevřená
patient-alert-history = Historie ({ $n })
patient-alert-archive = Vyřešené / vzaté na vědomí ({ $n })

## Conclusion ("Závěr MDT"): approved conclusions are an append-only history

patient-concl-title = Závěr MDT
patient-concl-valid = Platný závěr č. { $n } · schválil(a) { $by }, { $when }
patient-concl-earlier = Předchozí závěry ({ $n })
patient-concl-number = Závěr č. { $n }
patient-concl-superseded = nahrazen
patient-concl-report = Schválený report
patient-concl-none = Zatím neprojednáno.
patient-concl-unapproved = Neschválený koncept:
patient-concl-closed = Případ je uzavřen; znovu ho otevřete v menu stavu.
patient-concl-ident = { $name } · RČ: { $rc } · věk: { $age } · ID { $id }

## Timeline ("Průběh onemocnění")

patient-tl-title = Průběh onemocnění
patient-tl-help = Události jsou seřazeny podle data a označeny ikonou a názvem kategorie. Lze vybrat více kategorií současně. Odškrtnutím kategorii skryjete; Vše zapne nebo vypne všechny kategorie. Čárkovaný kroužek znamená plán. Kliknutím na událost otevřete její zdroj; datum a nejistota zůstávají podle dokumentace.
patient-tl-categories = Kategorie událostí
patient-tl-all = Vše
# "z 16 událostí": genitive after "z"; one event reads "z 1 události".
patient-tl-status = Zobrazeno { $shown } z { $all ->
    [one] { $all } události
    [few] { $all } událostí
    [many] { $all } události
   *[other] { $all } událostí
} · { $cats } z { $total } kategorií
patient-tl-region = Časová osa průběhu onemocnění
patient-tl-undated = Bez data
patient-tl-planned = {" "}· plán
patient-tl-all-hidden = Všechny kategorie jsou skryté. Zaškrtněte kategorii nebo Vše.
patient-tl-none-in-selection = Ve vybraných kategoriích nejsou zaznamenané události.
patient-cat-imaging = Zobrazovací vyšetření
patient-cat-systemic = Systémová protinádorová léčba
patient-cat-medication = Ostatní medikace
patient-cat-mdt = MDT a rozhodnutí
patient-cat-surgery = Chirurgie a výkony
patient-cat-pathology = Patologie a molekulární vyšetření
patient-cat-radiotherapy = Radioterapie
patient-cat-laboratory = Laboratorní vyšetření
patient-cat-clinical = Klinický stav a ostatní

## Overview: oncology summary and current state

patient-onco-title = Onkologický souhrn
patient-onco-pin-help = Ikona u data označuje stejnou kategorii jako na časové ose. Název kategorie ukáže najetí myší nebo zaměření klávesnicí. Čárkovaný kroužek znamená plánováno.
patient-onco-region = Onkologický souhrn, posuvný obsah
# The TNM in the headline is the stage at diagnosis, never the current stage (CLAUDE.md).
patient-onco-ptnm = (pTNM při diagnóze, { $month })
patient-onco-start = zahájení léčby
patient-onco-planned-suffix = , plánováno
patient-state-title = Aktuální stav pacienta
patient-state-subjective = Subjektivně:
patient-state-objective = Objektivně:
patient-state-tkp = TK/P
patient-state-tt = TT
patient-state-ps = PS (ECOG)
patient-state-exam-undated = datum neuvedeno

## "+ Nahrát dokument" (a demonstration dialog: it stores nothing)

patient-upload-title = Nahrát dokument
patient-upload-heading = Nahrát dokument · { $id }
patient-upload-drop = Přetáhněte PDF, DOCX nebo fotografii zprávy
patient-upload-pick = Vybrat soubory
patient-upload-done-label = Nahráno:
patient-upload-done = kontrola čitelnosti proběhla, dokument se přidá do seznamu. V maketě se nic neukládá.
patient-upload-note = Po nahrání proběhne kontrola čitelnosti; při špatné kvalitě aplikace požádá o lepší kopii.

## Break-the-glass (a doctor outside the case's team, with a stated reason)

patient-bg-title = Otevřít mimo tým
patient-bg-heading = Otevřít mimo tým · { $id }
patient-bg-intro = Nejste v týmu tohoto případu. Lékař mimo tým může případ otevřít s uvedením důvodu.
patient-bg-reason = Důvod přístupu (10 až 500 znaků)
patient-bg-reason-invalid = Uveďte důvod přístupu (10 až 500 znaků).
patient-bg-note = Přístup se zapíše do záznamu přístupů i s důvodem a platí omezenou dobu.
patient-bg-back = Zpět na seznam
patient-bg-granted = Přístup mimo tým zapsán do záznamu přístupů

# Czech, three tabs of the patient detail screen (S-3): Dokumenty (documents), Anamnéza (anamnesis) and Laboratoř
# (labs). Interface text only: document titles, quotes, lab names, values, units, ranges and codes are content and
# never come from here. Shared wording (gap, sources, certainty tags) is in patient.ftl.

## Anamnéza

patient-anam-title = Anamnéza
patient-anam-section = { $key ->
    [OA] Osobní anamnéza
    [RA] Rodinná anamnéza
    [PA] Pracovní anamnéza
    [SA] Sociální anamnéza
    [FA] Farmakologická anamnéza
    [AA] Alergologická anamnéza
    [abusus] Abúzus
    [EA] Epidemiologická anamnéza
   *[preventive] Preventivní vyšetření
}
# The chip in front of a drug warning (an interaction or contraindication the documents state).
patient-anam-warning = Pozor
patient-anam-pack-years = Balíčkoroky:{" "}
# The icon legend under the card; each label follows its icon.
patient-anam-legend-label = Ikony:
patient-anam-legend-ocr = { -trust-verify-reading }
patient-anam-legend-planned = plánováno
patient-anam-legend-conflict = rozpor mezi dokumenty
patient-anam-legend-observation = { -trust-observation }
patient-anam-legend-tail = Podrobnost ukáže najetí myší. Léky slouží pro informaci; při příjmu se kontrolují.

## Dokumenty

patient-docs-title = Dokumenty ({ $n })
patient-docs-title-filtered = Dokumenty ({ $shown } z { $n })
patient-docs-source = Zdroj:{" "}
patient-docs-source-uploaded = { $n ->
    [one] { $n } nahrané PDF
    [few] { $n } nahraná PDF
    [many] { $n } nahraného PDF
   *[other] { $n } nahraných PDF
}
patient-docs-source-pages = { $n ->
    [one] , { $n } strana
    [few] , { $n } strany
    [many] , { $n } strany
   *[other] , { $n } stran
}
# The page count of the documentation is not known: a gap dash sits between these two.
patient-docs-source-pages-none = ,{" "}
patient-docs-source-pages-none-unit = {" "}stran
patient-docs-upload = + Nahrát dokument
patient-docs-missing-originals = Chybí originály
patient-docs-search = Hledat v dokumentech
patient-docs-clear-filters = Zrušit filtry ({ $n })
patient-docs-col-document = Dokument
patient-docs-col-type = Typ
patient-docs-col-date = Datum
patient-docs-col-pages = Strany
patient-docs-col-readability = Čitelnost
patient-docs-col-year = Rok
patient-docs-year-none = bez data
patient-docs-readability = { $code ->
    [good] Dobře čitelné
    [fair] Částečně čitelné
   *[poor] Špatně čitelné
}
# After a document the PDF only cites ("citováno v ambulantní zprávě"): its original is not in the documentation.
patient-docs-original-missing = , originál chybí
patient-docs-open = Otevřít
patient-docs-none-match = Žádný dokument neodpovídá filtru.
patient-docs-readability-hint = Důvod hodnocení čitelnosti ukáže najetí myší na štítek.

## Column filter (Excel-style list of a column's values)

patient-docs-filter-label = Filtr { $title }
patient-docs-filter-all = (Vše)
patient-docs-filter-done = Hotovo

## Reading a document without AI (the pipeline panel; the result is the assistant's reading, never the case data)

patient-docs-pipe-run = Přečíst bez AI
patient-docs-pipe-rerun = Přečíst znovu bez AI
patient-docs-pipe-busy = Čtu…
patient-docs-pipe-failed = Čtení selhalo ({ $code ->
    [start_failed] nespustilo se
    [stalled] nedokončilo se
    [encrypted] PDF je zašifrované
    [not_pdf] soubor není čitelné PDF
    [unreadable_pdf] soubor není čitelné PDF
    [too_many_pages] příliš mnoho stran
    [page_too_large] stránka je příliš velká
    [pipeline_off] zpracování není zapnuté
    [page_reader_unreachable] služba neodpovídá
   *[other] chyba služby
}).
patient-docs-pipe-reading = Čte se (
patient-docs-pipe-queued = ve frontě
patient-docs-pipe-reading-end = )…
patient-docs-pipe-readability = :{" "}čitelnost{" "}
patient-docs-pipe-verify = { $n ->
    [one] , { $n } místo k ověření
    [few] , { $n } místa k ověření
    [many] , { $n } místa k ověření
   *[other] , { $n } míst k ověření
}
# A missing count from the server is a gap dash between the parts, never an assumed 0.
patient-docs-pipe-labs = , laboratorní hodnoty { $n } (k ověření{" "}
patient-docs-pipe-labs-end = )
patient-docs-pipe-diff = ; proti předem připraveným datům{" "}
patient-docs-pipe-diff-same = {" "}shodných,{" "}
patient-docs-pipe-diff-verify = {" "}k ověření
patient-docs-pipe-diff-silent = { $n } jinak bez označení
patient-docs-pipe-diff-missing = { $n } nenalezeno

## Laboratoř

patient-labs-title-values = Laboratoř · Hodnoty z dokumentu
patient-labs-title-trend = Laboratoř · Vývoj v čase
patient-labs-draws = { $n ->
    [one] { $n } odběr z dokumentace
    [few] { $n } odběry z dokumentace
    [many] { $n } odběru z dokumentace
   *[other] { $n } odběrů z dokumentace
}
patient-labs-trend-hint = Klik na hodnotu otevře její řádek ve zdroji, klik na datum laboratorní list.
patient-labs-col-test = Parametr
patient-labs-col-value = Hodnota
patient-labs-col-unit = Jednotka
patient-labs-col-range-short = Ref. mez
patient-labs-col-range = Referenční mez
patient-labs-col-date = Datum odběru
patient-labs-col-source = Zdroj
# Tooltip of a value or draw date: the quoted line it rests on.
patient-labs-src-tip = Zdroj: „{ $quote }“
patient-labs-value-label = { $name } { $date }: { $value } { $unit }, otevřít zdroj
patient-labs-pick-hint = Klikněte na řádek parametru · zelené pásmo = referenční mez
patient-labs-chart-label = Vývoj v čase, { $name }
patient-labs-chart-range = ref. { $range }
patient-labs-chart-needs-two = Pro graf jsou potřeba alespoň dvě hodnoty.
patient-labs-sources = Zdroje
# The source button of a value row, with a plain space as the old table printed it.
patient-labs-row-source = s. { $page }
patient-labs-all-values = Pro všechny hodnoty:{" "}
patient-labs-head-date = Datum odběru:{" "}
patient-labs-head-source = Zdroj:{" "}
patient-labs-head-source-page = , s.{" "}{ $page }
patient-labs-head-click-name = . Klik na název parametru otevře jeho řádek ve zdroji.
patient-labs-no-trend = Vývoj v čase se ukazuje jen tam, kde dokumentace obsahuje alespoň dva datované odběry; zde je jedna sada bez data odběru.

# Czech, the patient screen's "Navrhovaný postup" and "Retrospektivní odchylky" tabs and the guideline drawer: the
# proposal box, the guideline layer (F-27 in docs/design/PRODUCT.md), its literature and the deviation tables.
# Interface text only: guideline names, quotes, sections, grades as printed, facts and the assistant's reasons are
# content from the data and never come from here.

## Proposal box

patient-proposal-heading = Navrhovaný další postup
patient-proposal-tag = návrh lékaře, ne rozhodnutí MDT
patient-proposal-tag-tooltip = Zapsal(a) { $by }, { $when }
patient-proposal-empty = Co dál navrhuje odesílající lékař k rozhodnutí na tomto MDT; asistent postup nenavrhuje.
patient-proposal-add = doplnit

## Guideline layer

patient-guide-heading = Doporučené postupy k dalšímu postupu
patient-guide-layer-toggle = vrstva doporučení
patient-guide-off = Vypnuto.
patient-guide-loading = Načítám doporučení ze serveru…
patient-guide-load-failed = Doporučení se nepodařilo načíst.
patient-guide-retry = Zkusit znovu
patient-guide-order-note = Seřazeno podle síly, kterou uvádí samo doporučení, ne pořadí možností pro tohoto pacienta.
patient-guide-group-oncology = Onkologie
patient-guide-group-other = Další obory (přidružená onemocnění)
patient-guide-footer = { -trust-observation-cap }, rozhoduje MDT. Citace doslovně z uvedených doporučení; kliknutím se rozbalí důvod, zdroje a původní stupeň.
patient-guide-not-retrieved = Nenačtené zdroje ({ $n })

# The common strength scale (round 19); the code comes from packages/domain/src/guideline.ts.
patient-guide-tier = { $code ->
    [strong] silné
    [moderate] střední
    [weak] slabé
   *[unstated] neuvedeno
}
# A statement graded more than once: from its strongest to its weakest tier.
patient-guide-tier-range = { $from } až { $to }
patient-guide-tier-chip = síla: { $tier }
patient-guide-tier-tooltip = Síla doporučení na společné škále, převedená z vlastního stupně doporučení; původní označení je v rozbaleném záznamu
patient-guide-clamp-note = (citace zkrácena, rozbalte)
patient-guide-why = Proč:
patient-guide-no-source = (zdroj nedohledán)
patient-guide-original-grade = původní označení:
patient-guide-grade-none = neuvedeno
patient-guide-grade-chapter-text = text kapitoly, bez stupně
# ČOS and NCCN categories sort as "neuvedeno"; the opened entry says what they mean.
patient-guide-grade-categories = (kategorie { $cats }: důkazy a shoda odborníků, ne síla doporučení)
patient-guide-page-printed = s. { $page }
patient-guide-page-pdf = s. PDF { $page }
patient-guide-abstract-only = jen abstrakt
patient-guide-open = otevřít v doporučení
# The tooltip of "otevřít v doporučení" ends with the page, or says the statement comes from the abstract.
patient-guide-cite-page = s. { $page }
patient-guide-cite-abstract = abstrakt

## Literature (PubMed), labelled as literature, never as a recommendation

patient-guide-lit-heading = Literatura z PubMed · není doporučení
patient-guide-lit-intro = Pro situace, kde doporučení nestačí. Hledání v PubMed používá jen odborné pojmy, nikdy údaje o pacientovi
patient-guide-lit-queries = ; dotazy:{" "}
patient-guide-lit-intro-end = .
patient-guide-quoted = „{ $text }“
patient-guide-lit-chip = literatura, ne doporučení
patient-guide-lit-author = { $author } et al.
patient-guide-pmid = PMID { $pmid }

## Guideline drawer

patient-guide-drawer-label = Doporučení
patient-guide-drawer-close = Zavřít
patient-guide-drawer-page = strana PDF { $page }
patient-guide-drawer-printed = (tištěná { $page })
patient-guide-drawer-abstract-only = jen abstrakt, plný text nebyl dostupný
patient-guide-drawer-open-pdf = Otevřít PDF online
patient-guide-drawer-open-pdf-page = Otevřít PDF online (str. { $page })
patient-guide-drawer-publisher = Zdroj vydavatele
patient-guide-drawer-grade = Původní označení:
patient-guide-drawer-relation = Vztah k záznamu:
patient-guide-drawer-edition = Vydání { $year }, { $range }
patient-guide-drawer-applies = Platí, protože:
patient-guide-drawer-no-text = Text strany není k dispozici.

## Deviations tab

patient-dev-layer-off = Vrstva doporučení je vypnutá.
patient-dev-loading = Načítání podkladů pro odchylky…
patient-dev-more = Další srovnání minulých rozhodnutí s doporučeními ({ $n })
patient-dev-no-past = K minulým rozhodnutím nejsou pasáže z doporučení.

# The eight columns of both deviation tables.
patient-dev-col-finding = Problém / zjištění
patient-dev-col-area = Oblast
patient-dev-col-severity = Závažnost
patient-dev-col-guideline = Doporučení
patient-dev-col-year = Rok
patient-dev-col-passage = Znění doporučení
patient-dev-col-quote = Citace z dokumentace
patient-dev-col-consequence = Možný klinický důsledek

patient-dev-findings-heading = Odchylky a související zjištění
patient-dev-findings-none = Pro tento případ nejsou zpracovaná zjištění.
# "zjištění" has one form for every count.
patient-dev-findings-count = { $n } zjištění · bez povinné akce
patient-dev-findings-intro = { -trust-observation-cap } z dostupné dokumentace. Dokumentační mezera ani úprava při toxicitě samy o sobě neprokazují nesprávnou péči.
patient-dev-findings-region = Tabulka odchylek a souvisejících zjištění
patient-dev-open-guideline = Otevřít doporučení
# The link next to the risk basis of a finding: the table of the EASL guideline the basis cites.
patient-dev-risk-basis-link = Tabulka 14, s. PDF 42
patient-dev-consequence-note = Možný dopad / omezení posouzení, nikoli doložená komplikace.
patient-dev-findings-footnote = Závažnost není klinicky posouzena. Citace jsou původní znění zdrojů; shrnutí a možné důsledky jsou pozorováním asistenta. Současný stav nelze automaticky odvodit z historického nebo nedatovaného záznamu.

patient-dev-retro-heading = Retrospektivní odchylky
patient-dev-retro-sub = Přehled bez povinného hodnocení nebo potvrzování
patient-dev-retro-intro = { -trust-observation-cap }: srovnání záznamů s doporučeními. Samotné zařazení řádku nepotvrzuje odchylku.
patient-dev-retro-region = Tabulka retrospektivních odchylek
patient-dev-retro-footnote = Závažnost a klinický důsledek nejsou v podkladech stanoveny; chybějící údaje se nedoplňují. Dříve zaznamenaná hodnocení zůstávají pouze ke čtení. Citace vycházejí z vydání platného v době rozhodnutí; online novelizace v průběhu roku nebyly ověřeny.
patient-dev-group-surgery = Chirurgie
patient-dev-group-systemic = Systémová léčba
patient-dev-doc-page = , s. { $page }

## The guideline edition valid at a past decision

patient-dev-edition-range = platné od { $from } do { $to }
patient-dev-edition-until-now = dosud
patient-dev-past-label = Doporučení platné v době rozhodnutí
patient-dev-past-not-checked = Pasáž z vydání platného v době rozhodnutí nebyla dohledána; citace z pozdějšího vydání se nezobrazuje.
patient-dev-past-edition = vydání { $year }
patient-dev-past-chosen-for = vydání vybráno k datu { $date } (výkon nebo zahájení léčby dle dokumentace)
patient-dev-past-not-found = vydání platné v době rozhodnutí pasáž neobsahuje
patient-dev-past-more = Další pasáž z téhož vydání ({ $n })
patient-dev-open-pdf = otevřít PDF vydání { $year }
patient-dev-open-pdf-page = otevřít PDF vydání { $year }, { $page }

# Czech, the Prognóza tab of the patient screen and its two drawers (the source list and the similarity explanation).
# The tab shows study results for similar patient groups that the assistant's search found; it is no individual
# prognosis. Message IDs start with "patient-pg-". Study titles, arms, populations, values, quotes and the server's
# warnings are content and never come from here.

## The tab

patient-pg-title = Prognóza
patient-pg-subtitle = Výsledky studií pro podobné skupiny pacientů · rešerše asistenta
patient-pg-as-of = K datu MDT { $date }
patient-pg-intro = Porovnání výsledků jednotlivých studií. Uvedená procenta popisují studované skupiny; individuální prognózu posuzuje lékař.
patient-pg-no-slot = Pacient nemá termín MDT. Pro vyhledání nejprve vyberte den v kalendáři.
patient-pg-schedule = Naplánovat MDT
patient-pg-loading-profile = Načítání profilu a nastavení…
patient-pg-retry = Zkusit připojení znovu
patient-pg-not-configured = Vyhledávání není nakonfigurováno. Doplňte API klíč a model Astra v serverovém .env.
patient-pg-profile-unavailable = Pro tento případ nejsou k datu MDT dostupné dostatečné strukturované podklady.

## The search profile (the structured facts the search was given)

patient-pg-profile-summary = { $n ->
    [one] Klinický profil pro hledání ({ $n } podklad)
    [few] Klinický profil pro hledání ({ $n } podklady)
    [many] Klinický profil pro hledání ({ $n } podkladu)
   *[other] Klinický profil pro hledání ({ $n } podkladů)
}
patient-pg-profile-note = Původní strukturované syntetické podklady k datu MDT. Neobsahuje jméno, rodné číslo ani místní úpravy textů v prohlížeči.

## Search controls and states

patient-pg-loading-saved = Načítání uložené rešerše…
patient-pg-search-pending = Probíhá rešerše…
patient-pg-show-saved = Zobrazit uloženou rešerši
patient-pg-search = Vyhledat studie · Astra
patient-pg-refresh = Nové vyhledání · 1 požadavek
patient-pg-abbreviations = OS = celkové přežití · PFS = přežití bez progrese · ORR = podíl léčebných odpovědí
patient-pg-busy = Astra vyhledává studie a jejich výsledky. Hledání může trvat několik minut.
patient-pg-saved-stale = Uložená rešerše vychází ze starších podkladů. Pro aktuální profil spusťte nové vyhledání.
# Followed by the time of the search as the server sends it.
patient-pg-found = { $n ->
    [one] Nalezena { $n } populace / rameno ·{" "}
    [few] Nalezeny { $n } populace / ramena ·{" "}
    [many] Nalezeno { $n } populace / ramene ·{" "}
   *[other] Nalezeno { $n } populací / ramen ·{" "}
}
patient-pg-found-saved = {" "}· uložená rešerše
patient-pg-found-cached = {" "}· z mezipaměti

## Errors the client raises itself (the prognosis server is a separate local server)

patient-pg-error-no-server = Vyhledávání vyžaduje spuštěný lokální server Prognózy (python3 prognosis/serve.py).
patient-pg-error-timeout = Vypršel časový limit. Další vyhledávání se nespustí automaticky.
patient-pg-error-request-failed = Požadavek se nepodařilo dokončit.

## The study table

patient-pg-table-label = Studie a prognostické ukazatele
patient-pg-col-study = Studie / zdroj
patient-pg-col-population = Populace a léčba
patient-pg-col-similarity = Podobnost pacienta
patient-pg-col-model = Našel model
# The short two-line headers of the OS columns; the full name is the column's accessible name.
patient-pg-col-os-6 = 6 měs.
patient-pg-col-os-12 = 12 měs.
patient-pg-col-os-36 = 3 roky
patient-pg-col-os-60 = 5 let
patient-pg-col-os = OS
patient-pg-ep-os-6 = 6měsíční OS
patient-pg-ep-os-12 = 12měsíční OS
patient-pg-ep-os-36 = 3leté OS
patient-pg-ep-os-60 = 5leté OS
patient-pg-ep-pfs = Medián PFS
patient-pg-ep-response = Odpověď a trvání odpovědi
patient-pg-ep-toxicity = Závažná toxicita a ukončení léčby
patient-pg-ep-burden = Zátěž léčby
patient-pg-empty-pending = Čekáme na výsledky Astry.
patient-pg-empty-no-rows = Astra nevrátila použitelné výsledky. Zkontrolujte stav rešerše a zdroje.
patient-pg-empty-start = Studie se zobrazí po spuštění vyhledávání.
patient-pg-footnotes-label = Poznámky k rešerši
patient-pg-footnote = Každý řádek zachovává populaci, léčbu a počátek sledování zdroje. Chybějící hodnoty se nedopočítávají. Rešerše nezaručuje úplnost dostupné literatury. Podobnost je orientační shoda populace, nikoli pravděpodobnost přežití. Extrahované údaje vyžadují kontrolu ve zdroji.

## A study row

patient-pg-untitled = Zdroj bez názvu
patient-pg-link-pubmed = PubMed { $id }
patient-pg-link-doi = DOI { $id }
patient-pg-verify = Extrakce modelu · ověřit
patient-pg-sample-size = n = { $n }
patient-pg-time-origin = Počátek sledování:{" "}
patient-pg-unit-months = měsíců
patient-pg-name-orr = ORR
patient-pg-name-dor-median = Medián trvání odpovědi
patient-pg-name-grade3 = Stupeň ≥3
patient-pg-name-discontinuation = Ukončení pro toxicitu
patient-pg-name-conflict-dor = Trvání odpovědi
patient-pg-name-conflict-grade3 = Toxicita stupně ≥3
patient-pg-conflicts = Rozdílné extrahované hodnoty ({ $n })
patient-pg-conflicts-note = Sporné hodnoty se nezobrazují v hlavní buňce. Ověřte populaci, rameno a analýzu.

## Similarity (an orientation score of the population match, not a survival probability)

patient-pg-percent = { $v } %
patient-pg-sim-label = Orientační shoda populace
patient-pg-sim-coverage = Pokrytí { $v } % váhy údajů
patient-pg-sim-critical = Zásadní rozdíl: { $list }
patient-pg-sim-explain = Vysvětlení podobnosti
patient-pg-sim-variants = Odlišná posouzení shody
patient-pg-dim-histology = Histologie
patient-pg-dim-stage = Stádium
patient-pg-dim-biomarkers = Biomarkery
patient-pg-dim-treatment-line = Linie léčby
patient-pg-dim-prior-treatment = Předchozí léčba
patient-pg-dim-performance-status = Výkonnostní stav
patient-pg-dim-brain-metastases = Mozkové metastázy
patient-pg-dim-age = Věk
patient-pg-status-match = shoda
patient-pg-status-mismatch = neshoda
patient-pg-status-unknown = nezjištěno
patient-pg-status-partial = částečná shoda

## The similarity drawer

patient-pg-panel-label = Prognóza · Vysvětlení podobnosti
patient-pg-panel-sub = Orientační shoda { $v } %
patient-pg-panel-disclaimer = Skóre shody se studovanou populací. Nejde o pravděpodobnost přežití ani validovaný prognostický model.
patient-pg-panel-coverage = Pokrytí známými údaji: { $v } % celkové váhy
patient-pg-panel-patient = Pacient:{" "}
patient-pg-panel-study = Studie:{" "}
patient-pg-panel-critical = Zásadní rozdíly: { $list }

## The source list drawer

patient-pg-refs-label = Zdroje prognózy
patient-pg-refs-title = Zdroje ({ $n })
patient-pg-refs-no-quote = Pasáž nebyla dodána.
patient-pg-close = Zavřít

# Czech, the source viewer drawer (F-18 in docs/design/PRODUCT.md): the original page image with the quoted passage,
# the page switcher, zoom, the page transcription and the local redaction demo. Interface text only: document titles,
# file names, case IDs, quotes, the transcription, Tesseract's readings and redaction reasons are content from the
# data and never come from here.

## Drawer

patient-src-dialog = Původní dokument
patient-src-loading-dialog = Zdrojový dokument
patient-src-loading-label = Zdroj
patient-src-loading = Načítám stránku…
patient-src-close = Zavřít
patient-src-kind = Původní dokument · obrázek stránky
patient-src-page-of = strana { $n } z { $of }
# $quote is a slot: the quote is content and sits in its own element.
patient-src-sought = Hledaná citace (s. { $page }): „{ $quote }“
# The page switcher's button; a plain space, as the old viewer had (patient-src-page keeps a no-break space).
patient-src-page-button = s. { $n }
patient-src-page-empty = {" "}(prázdná)
patient-src-page-empty-tooltip = prázdná stránka

## View switch and toolbar

patient-src-tabs = Zobrazení
patient-src-tab-image = Stránka
patient-src-tab-text = Přepis stránky
patient-src-redact = Cenzurovat (demo)
patient-src-zoom-hit = Přiblížit na citaci
patient-src-verify-count = { $n ->
    [one] { $n } místo k ověření
    [few] { $n } místa k ověření
    [many] { $n } místa k ověření
   *[other] { $n } míst k ověření
}
patient-src-engine-vision = Přepis: jazykový model, kontrola: Tesseract
patient-src-engine-tesseract = Přepis: Tesseract
patient-src-engine-conf = { $engine }, průměrná jistota Tesseractu { $conf } %

## How the quote was found

patient-src-note-not-found = Citace nenalezena přesně, zobrazena celá stránka.
patient-src-note-text-only = Na obrázku citaci nelze vyznačit; v přepisu stránky vyznačena je.
patient-src-note-image-only = V přepisu citaci nelze vyznačit; na obrázku stránky vyznačena je.
patient-src-note-spread = Všechna slova citace nalezena, ale mezi nimi stojí další slova.
patient-src-note-approx = Citace nalezena přibližně (shoda { $pct } %): původní citace pochází ze staršího převodu textu s chybami čtení.
patient-src-note-repeated = Citace je na stránce víckrát; zvýrazněn první výskyt.
patient-src-note-similar = Podobná pasáž je na stránce víckrát; zvýrazněna nejlepší shoda, ověřte.

## Page body

patient-src-empty-page = Prázdná stránka: na stránce není žádný text.
patient-src-img-alt = Strana { $n } dokumentu { $file }
patient-src-img-alt-redacted = Strana { $n } po začernění identifikátorů
patient-src-img-failed = Obrázek stránky se nepodařilo načíst. Přepis je v záložce „Přepis stránky“.
patient-src-legend-text = Tečkovaně: číslo, datum nebo stadium, které Tesseract přečetl jinak, s nízkou jistotou, nebo vůbec (četl jen jazykový model). Neoznačený text není ověřený; rozhoduje obrázek stránky.
patient-src-legend-image = Žlutě: citovaná pasáž. Čárkovaně: Tečkovaně: číslo, datum nebo stadium, které Tesseract přečetl jinak, s nízkou jistotou, nebo vůbec (četl jen jazykový model). Neoznačený text není ověřený; rozhoduje obrázek stránky. Místa, která četl jen jazykový model, jsou podtržená v přepisu.
patient-src-unreadable = Nečitelné znaky ({ $n })
patient-src-transcriber-note = Poznámka přepisu, není tištěný text

# A dashed box on the image: why to check the token, then what the transcription has there ($reading is content).
patient-src-vbox = { $why }; přepis: { $reading }

## Why a token is marked "ověřit" ($tess and $layer are the engines' readings, content from the data)

patient-src-verify-only-vision = Četl jen jazykový model; Tesseract zde nic nepřečetl, ověřit
patient-src-verify-tess = Tesseract četl: { $tess }, ověřit
patient-src-verify-tess-low = Tesseract četl: { $tess } (jistota { $conf } %), ověřit
patient-src-verify-only-tesseract = Textová vrstva PDF zde nic nemá, ověřit
patient-src-verify-only-layer = Jen textová vrstva PDF: { $layer }, ověřit
patient-src-verify-layer-low = Tesseract si není jistý (jistota { $conf } %), ověřit
patient-src-verify-layer = Textová vrstva PDF: { $layer }, ověřit

## Local redaction demo (docs/design/DATA-PROTECTION.md)

patient-src-redact-intro = Ukázka místního začernění: takto by stránka odešla do cloudového jazykového modelu.
# $reasons is a slot: the reasons are content and sit in their own element.
patient-src-redact-count = Začerněno { $n ->
    [one] { $n } místo
    [few] { $n } místa
    [many] { $n } místa
   *[other] { $n } míst
} ({ $reasons }) přímo na serveru nemocnice.
patient-src-redact-none = Na této stránce kontrola nic nenašla; kontrola je neúplná, stránku před odesláním zkontrolujte.
patient-src-redact-outro = Data, diagnózy a nálezy zůstávají, proto je stránka stále osobní údaj.

## Zoom

patient-src-zoom = Zvětšení stránky
patient-src-zoom-out = Oddálit
patient-src-zoom-out-tooltip = Oddálit (−)
patient-src-zoom-in = Přiblížit
patient-src-zoom-in-tooltip = Přiblížit (+)
patient-src-zoom-reset = Obnovit zvětšení
patient-src-zoom-reset-tooltip = Obnovit: na šířku (0)
patient-src-zoom-fit = Na šířku
patient-src-zoom-pct = { $z } %

# Czech, the FHIR R4 export of a case (the "Export FHIR" dialog and the Bundle's own labels). FHIR is the HL7
# standard for exchanging health records as linked JSON records called resources. Message IDs start with
# "patient-fhir-". The Bundle translates only our labels and section titles (I18N.md, "PDF and FHIR"); names, quotes,
# codes and values come from the documents and never from this file.

## The dialog

patient-fhir-dialog-label = Export FHIR
patient-fhir-dialog-title = Export FHIR R4 · { $id }
# $n: the number of entries in the Bundle; $counts: "Patient 1, Observation 30, ..." (resource names are FHIR code).
patient-fhir-dialog-counts = Případ jako balík FHIR R4 (Bundle, { $n } { $n ->
        [one] záznam
        [few] záznamy
        [many] záznamu
       *[other] záznamů
    }): { $counts }. Každý údaj má záznam Provenance s dokumentem, stranou a citací. Vše je návrh asistenta, neověřený lékařem. Uložená kopie prošla oficiálním validátorem HL7 bez chyb (fhir/README.md).
patient-fhir-dialog-identity = Export obsahuje identifikaci pacienta. V pilotu by šel přes FHIR rozhraní nemocnice, ne jako soubor.
patient-fhir-download = Stáhnout JSON
patient-fhir-copy = Kopírovat
patient-fhir-close = Zavřít
patient-fhir-copied = Zkopírováno do schránky
patient-fhir-copy-failed = Kopírování se nepodařilo; označte text ručně

## The Bundle's labels and narrative. Composition text stays Czech while the content is Czech.

patient-fhir-device-name = CodeBridge MDT asistent (maketa)
patient-fhir-device-type = Software pro přípravu podkladů MDT
patient-fhir-doc-text = Dokument { $file }
patient-fhir-patient-text = { $name }, { $id }
patient-fhir-source-ref = { $file }, s. { $page }
patient-fhir-provenance-text = Zdroj: { $refs }
patient-fhir-activity-extracted = Vytěženo asistentem z dokumentu; neověřeno lékařem
patient-fhir-activity-observation = Pozorování asistenta; neověřeno lékařem
patient-fhir-activity-q-draft = Návrh otázky pro MDT asistentem z citovaných pasáží; neověřeno lékařem
patient-fhir-date-in-doc = Datum v dokumentu: { $date }
patient-fhir-dated-line = { $date }: { $text }
patient-fhir-dx-text = { $code } { $text }
patient-fhir-dx-text-dated = { $code } { $text }, diagnóza { $date }
patient-fhir-issue-text = Pozorování asistenta: { $text }
patient-fhir-negated = Negace uvedená v dokumentu.
patient-fhir-obs-clinical = Klinický nález
patient-fhir-obs-current = Aktuální stav
patient-fhir-obs-imaging = Zobrazovací vyšetření
patient-fhir-obs-histology = Histologie
patient-fhir-lab-out-of-range = { $dir ->
        [high] Nad
       *[low] Pod
    } rozmezím (vyhodnotil asistent podle uvedeného rozmezí)
patient-fhir-lab-as-written = V dokumentu: { $value }
patient-fhir-lab-no-date = Datum odběru neuvedeno v dostupné dokumentaci.
patient-fhir-lab-text = { $name }: { $value } { $unit } (ref. { $range })
patient-fhir-gap = Neuvedeno v dostupné dokumentaci.
patient-fhir-comp-text = Podklady pro MDT, { $id }: návrh asistenta, neověřeno lékařem.
patient-fhir-comp-type = Podklady pro multidisciplinární tým (MDT)
patient-fhir-comp-title = Podklady pro MDT, { $id } (návrh asistenta, neověřeno lékařem)
patient-fhir-sec-question = Otázka pro MDT
patient-fhir-sec-summary = Shrnutí
patient-fhir-sec-course = Průběh onemocnění
patient-fhir-sec-conditions = Diagnóza a přidružená onemocnění
patient-fhir-sec-findings = Nálezy
patient-fhir-sec-treatment = Léčba
patient-fhir-sec-medication = Medikace
patient-fhir-sec-drug-flags = Upozornění k lékům
patient-fhir-sec-labs = Laboratoř
patient-fhir-sec-observations = Pozorování asistenta
patient-fhir-sec-notes = Poznámky k podkladům

## The MDT question as plain text (also for the report). A label in brackets says who wrote it.

patient-fhir-q-none = Výslovná otázka neuvedena v dostupné dokumentaci.
# $explicit: "yes" when the referral had its own question that a doctor changed, "no" when the doctor wrote it.
patient-fhir-q-edited = { $explicit ->
        [yes] [upraveno lékařem]
       *[no] [doplněno lékařem]
    }
patient-fhir-q-confirmed = [návrh asistenta, potvrdil(a) { $by }, { $when }]
patient-fhir-q-draft = { $kind ->
        [document_purpose] [otázka podle účelu v dokumentu, návrh asistenta, neověřeno lékařem]
       *[other] [návrh otázky asistentem, neověřeno lékařem]
    }
# One passage a drafted question rests on, quoted verbatim with its page.
patient-fhir-basis = { $role ->
        [purpose] Účel v dokumentu
       *[other] Vychází z
    }: „{ $quote }“ ({ $file }, s. { $page }).

# Czech, "Import z NIS" (issue #22): search the hospital information system (NIS) over FHIR for the case's patient and
# link one record. Message IDs start with "patient-nis-"; the button is patient-action-nis.

patient-action-nis = Import z NIS
patient-nis-title = Import z NIS
patient-nis-heading = Import z NIS · { $id }
# $label: the org's name for its NIS connection, from the server's configuration.
patient-nis-source = Zdroj: { $label } (FHIR R4, jen čtení)
patient-nis-intro = Vyhledá pacienta v NIS podle rodného čísla. Vyberte správný záznam sami; nic se neslučuje automaticky.
patient-nis-rc-label = Rodné číslo
patient-nis-rc-placeholder = 123456/7890
patient-nis-rc-missing = Pacient nemá v CodeBridge rodné číslo. Zadejte ho; propojení pak potvrdíte ručně.
patient-nis-search-own = Vyhledat v NIS podle rodného čísla pacienta
patient-nis-search = Vyhledat v NIS
patient-nis-none = V NIS nebyl nalezen žádný záznam s tímto rodným číslem.
patient-nis-duplicates = V NIS je pro toto rodné číslo více záznamů. Vyberte správný; CodeBridge je neslučuje.
patient-nis-truncated = Zobrazena jen část výsledků z NIS.
# $n: records the NIS sent without the searched birth number; they are never shown.
patient-nis-hidden = { $n ->
        [one] NIS vrátil { $n } záznam bez hledaného rodného čísla; nezobrazuje se.
        [few] NIS vrátil { $n } záznamy bez hledaného rodného čísla; nezobrazují se.
        [many] NIS vrátil { $n } záznamu bez hledaného rodného čísla; nezobrazují se.
       *[other] NIS vrátil { $n } záznamů bez hledaného rodného čísla; nezobrazují se.
    }
# $id: the record's ID in the NIS.
patient-nis-record = záznam NIS { $id }
patient-nis-born = Narozen(a)
patient-nis-gender-male = muž
patient-nis-gender-female = žena
patient-nis-identity-matches = rodné číslo souhlasí
patient-nis-identity-conflicts = rodné číslo se liší
patient-nis-identity-unverified = rodné číslo nelze ověřit
patient-nis-name-spelling = jméno zapsáno jinak (bez diakritiky)
patient-nis-name-different = jméno se liší
patient-nis-confirm = Potvrzuji, že jde o stejnou osobu
patient-nis-link = Propojit
patient-nis-linked = Propojeno se záznamem NIS { $id }
patient-nis-linked-matches = Rodné číslo souhlasilo.
patient-nis-linked-unverified = Rodné číslo nebylo možné ověřit, propojení potvrdil uživatel.
patient-nis-linked-name-differs = Rodné číslo souhlasilo, jméno se lišilo; propojení potvrdil uživatel.
# $name: who linked it; $at: the day (YYYY-MM-DD).
patient-nis-linked-by = Propojil(a) { $name }, { $at }.
patient-nis-import-note = Import převezme údaje a dokumenty z propojeného záznamu NIS do případu.
patient-nis-unlink = Zrušit propojení
patient-nis-unlink-warning = Zrušením propojení se z případů tohoto pacienta odeberou údaje z NIS i dokumenty převzaté z NIS (jejich obsah se smaže). Opětovné propojení a import je vrátí.
patient-nis-unlink-confirm = Zrušit propojení a odebrat dokumenty z NIS
patient-nis-unlink-cancel = Ponechat propojení
# $withdrawn documents removed, $pending not removable yet (being read, or the case locked), $other cases the user may not act in.
patient-nis-unlinked = Propojení zrušeno. Odebráno dokumentů z NIS: { $withdrawn }.{ $pending ->
        [0] {""}
       *[other] { " " }Zatím nelze odebrat: { $pending } (dokument se zpracovává nebo je případ uzamčen).
    }{ $other ->
        [0] {""}
       *[other] { " " }V případech mimo váš tým zůstaly dokumenty beze změny: { $other }.
    }
patient-nis-register-label = Národní registr (ukázka):

## The extraction run (codebridge.extraction/2): checks per section, negations, confirmations, orphaned edits.
# A section the processing did not look for; "-" with the gap wording stays for "looked, nothing there".
patient-check-not-run = nezkontrolováno
patient-check-not-run-tip = Zpracování tuto část v dokumentech nehledalo.
# $pages: page numbers, comma separated.
patient-check-unreadable = Nečitelné strany: { $pages }
# A fact the document states as absent, when its own text does not say so ("plicní embolie"). Never "neguje".
patient-fact-negated = { $text } (negativní nález)
patient-alert-fact-unavailable = údaj, který aktuální zpracování neukazuje
patient-alert-unresolved = Upozornění odkazuje na údaj, který aktuální zpracování neukazuje.
patient-guide-fact-unresolved = Údaj v aktuálním zpracování chybí.
patient-docs-cited = citace v jiné zprávě
patient-confirm = Potvrdit
# $text: the line being confirmed.
patient-confirm-label = Potvrdit údaj: { $text }
patient-confirm-withdraw = Zrušit potvrzení
patient-confirm-withdraw-label = Zrušit potvrzení údaje: { $text }
patient-confirmed = potvrzeno: { $who }, { $when }
patient-confirm-changed = Potvrzeno dříve v jiném znění ({ $who }, { $when })
patient-confirm-then = Dříve: { $text }
patient-confirm-now = Nyní: { $text }
patient-confirm-again = Potvrdit nové znění
patient-confirm-then-loading = načítám dřívější znění…
patient-confirm-then-unavailable = dřívější znění nelze načíst
patient-orphans-title = Potvrzeno dříve, v novém zpracování chybí
patient-orphans-hint = Tato potvrzení a úpravy patří k údajům, které aktuální zpracování neobsahuje. Žádné se nezahodilo.
patient-orphan-edit = Úprava „{ $text }“ ({ $who }, { $when })
patient-orphan-edit-orig = původně: { $orig }
patient-orphan-position = uložena k pozici v dřívějším zobrazení
patient-orphan-missing = údaj v novém zpracování chybí
patient-orphan-confirmation = Potvrzený údaj „{ $text }“ ({ $who }, { $when })
patient-orphan-not-shown = údaj se v aktuálním zobrazení neukazuje
# A section whose facts exist but none can be shown (a page of another patient holds them back).
patient-check-hidden = údaje nejsou zobrazeny, viz upozornění
patient-orphan-revert = Odebrat úpravu
patient-edit-source-changed = zdroj se změnil
patient-edit-source-changed-tip = Při úpravě zněl údaj: { $then }. Nyní: { $now }.

# Czech, "Záznam z NIS" (issue #22): the source viewer for a fact that rests on a record in the hospital system (NIS)
# instead of a document page. Message IDs start with "patient-nisrec-"; the field labels name the record's fields.

patient-src-nis = záznam z NIS
patient-nisrec-title = Záznam z NIS
# $resource: the record's type and ID in the NIS ("Observation/8812"); $version, $updated: as the fact cites it.
patient-nisrec-cited = Údaj převzat ze záznamu { $resource }:
patient-nisrec-cited-version = verze
patient-nisrec-cited-updated = změněno
patient-src-nis-title = záznam z NIS { $resource }
patient-nisrec-loading = Načítám záznam z NIS…
patient-nisrec-source = Zdroj: { $label } (čteno nyní, jen čtení)
patient-nisrec-changed = Záznam se v NIS od převzetí údaje změnil. Níže je jeho nynější stav; údaj se otevřením nemění.
patient-nisrec-now = Nynější stav záznamu v NIS
patient-nisrec-show-record = Zobrazit celý záznam
patient-nisrec-hide-record = Skrýt celý záznam
patient-nisrec-field-status = Stav
patient-nisrec-field-verification = Ověření
patient-nisrec-field-clinical_status = Klinický stav
patient-nisrec-field-category = Kategorie
patient-nisrec-field-class = Typ kontaktu
patient-nisrec-field-name = Název
patient-nisrec-field-codes = Kódy
patient-nisrec-field-value = Hodnota
patient-nisrec-field-interpretation = Interpretace
patient-nisrec-field-reference_range = Referenční meze
patient-nisrec-field-date = Datum
patient-nisrec-field-onset = Vznik
patient-nisrec-field-abatement = Ukončení
patient-nisrec-field-dosage = Dávkování
patient-nisrec-field-reason = Důvod
patient-nisrec-field-department = Pracoviště
patient-nisrec-field-conclusion = Závěr
patient-nisrec-field-note = Poznámka
patient-nisrec-field-issued = Vydáno
