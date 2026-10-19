# Slovak, the patient detail screen (S-3): header, brief, MDT question, alerts, timeline and the tabs. Translated
# from i18n/cs/patient.ftl (the source); same message IDs, same placeholders. The catalog holds interface text only:
# no patient names, quotes or values.

## Glossary (Czech -> Slovak), for review by a Slovak clinician. The fixed clinical wording (terms below) needs
## sign-off before release (docs/design/I18N.md).
# neuvedeno v dostupné dokumentaci -> neuvedené v dostupnej dokumentácii (feminine: neuvedená ...)
# ověřit čtení -> overiť čítanie
# zápor v dokumentu -> zápor v dokumente
# pozorování asistenta -> pozorovanie asistenta
# vyšetření -> vyšetrenie; zobrazovací vyšetření -> zobrazovacie vyšetrenia
# nález -> nález; odběr -> odber; datum odběru -> dátum odberu
# referenční mez -> referenčný interval (short: ref. interval)
# lékař -> lekár; pracoviště -> pracovisko; rodné číslo (RČ) -> rodné číslo (RČ)
# léčba -> liečba; systémová protinádorová léčba -> systémová protinádorová liečba
# radioterapie -> rádioterapia; chirurgie a výkony -> chirurgia a výkony
# patologie a molekulární vyšetření -> patológia a molekulové vyšetrenia
# ostatní medikace -> ostatná medikácia; stadium -> štádium
# průběh onemocnění -> priebeh ochorenia; stručný souhrn -> stručné zhrnutie
# upozornění -> upozornenie (plural upozornenia); rozpor -> rozpor; chybí -> chýba
# závěr MDT -> záver MDT; koncept závěru -> koncept záveru; projednán -> prerokovaný
# doporučení / doporučené postupy (guidelines) -> odporúčanie / odporúčané postupy
# síla doporučení -> sila odporúčania; stupeň doporučení -> stupeň odporúčania
# odchylka -> odchýlka; závažnost -> závažnosť
# čitelnost -> čitateľnosť; přepis stránky -> prepis strany; začernění -> začiernenie
# celkové přežití (OS) -> celkové prežívanie; přežití bez progrese (PFS) -> prežívanie bez progresie
# podíl léčebných odpovědí (ORR) -> miera objektívnej odpovede
# pravděpodobnost přežití -> pravdepodobnosť prežitia (a probability, unlike prežívanie as an endpoint)
# výkonnostní stav -> výkonnostný stav; mozkové metastázy -> mozgové metastázy
# anamnéza (osobní, rodinná, pracovní, sociální, farmakologická, alergologická, epidemiologická) -> anamnéza
#   (osobná, rodinná, pracovná, sociálna, farmakologická, alergologická, epidemiologická)
# preventivní vyšetření -> preventívne prehliadky; balíčkoroky -> balíčkoroky; abúzus -> abúzus
# maketa -> ukážka; vlastník -> vlastník; schválil(a), potvrdil(a), upravil(a) -> the same "(a)" forms

## Fixed clinical wording (CLAUDE.md). Defined once as terms, so the screens cannot drift apart. A clinician signs
## off every translation of these.

-gap-not-stated = neuvedené v dostupnej dokumentácii
# The feminine form, for "otázka" (Výslovná otázka neuvedená v dostupnej dokumentácii).
-gap-not-stated-f = neuvedená v dostupnej dokumentácii
-trust-verify-reading = overiť čítanie
-trust-negation = zápor v dokumente
-trust-observation = pozorovanie asistenta
-trust-observation-cap = Pozorovanie asistenta

patient-gap-not-stated = { -gap-not-stated }

## Dates and slots

patient-date-dmy = { $d }. { $m }. { $y }
patient-weekday-short = { $weekday ->
    [0] Ne
    [1] Po
    [2] Ut
    [3] St
    [4] Št
    [5] Pi
   *[6] So
}
patient-slot = { patient-weekday-short } { $d }. { $m }. { $y } · { $from }-{ $to }
patient-slot-none = nenaplánované

## Doctor edits

patient-edit-button = Upraviť
patient-edit-tag = upravené
patient-edit-tag-tooltip = Upravil(a) { $by }, { $when }. Pôvodne: { $orig }

## Certainty marks (tooltips of the small icons next to a fact)

patient-mark-ocr = Overiť čítanie: { $note }
patient-mark-ocr-default = text mohol byť zle prečítaný
patient-mark-inferred = { -trust-observation-cap }, v dokumente výslovne nie je
patient-mark-planned = Plánované, dokument neuvádza, že sa uskutočnilo
patient-mark-planned-note = Plánované, dokument neuvádza, že sa uskutočnilo: { $note }
patient-mark-note = Poznámka asistenta: { $note }
patient-mark-conflict = Rozpor medzi dokumentmi
patient-mark-conflict-note = Rozpor medzi dokumentmi: { $note }

## Certainty tags (written out, on lab values)

patient-tag-negated = { -trust-negation }
patient-tag-ocr = { -trust-verify-reading }
patient-tag-inferred = { -trust-observation }

## Sources

patient-src-open = Otvoriť zdroj
patient-src-page = s.{" "}{ $page }
patient-src-quote = „{ $quote }“
patient-src-link-label = Otvoriť zdroj, strana { $page }: { $quote }
patient-src-list = { $label } ({ $n })
patient-src-list-label = Zdroje
patient-src-list-page = , s. { $page }:{" "}
patient-src-unavailable = Pôvodný dokument nie je v ukážke k dispozícii.

## Page frame and tabs

patient-back = ‹ Databáza pacientov
patient-loading = Načítavam podklady prípadu…
patient-load-failed = Podklady prípadu sa nepodarilo načítať.
patient-retry = Skúsiť znova
patient-close = Zavrieť
patient-tab-overview = Prehľad
patient-tab-anamnesis = Anamnéza
patient-tab-documents = Dokumenty
patient-tab-labs = Laboratórium
patient-tab-alerts = Upozornenia
patient-tab-next = Navrhovaný postup
patient-tab-dev = Retrospektívne odchýlky
patient-tab-prognosis = Prognóza

## Case header

patient-synthetic = syntetický pacient
patient-synthetic-tooltip = Fiktívny pacient vytvorený tímom CodeBridge (vlastná syntetická dokumentácia), nie z údajov FNO
patient-header-rc = RČ:
patient-header-age = Vek:
patient-header-verify-identity = Overiť identitu:
patient-header-name-note = Pozn.:
patient-header-owner = Vlastník:
patient-header-dept = Pracovisko:
patient-header-next-mdt = Najbližšie MDT:
patient-action-schedule = Naplánovať
patient-action-reschedule = Zmeniť termín
patient-action-start-mdt = Začať MDT
patient-action-fhir = Export FHIR
patient-action-report = Stiahnuť report (PDF)

## Case status (lifecycle: Nový, Naplánovaný, Pripravený, Prerokovaný, Uzavretý; Vyžaduje pozornosť is a side state)

patient-status-new = Nový
patient-status-scheduled = Naplánovaný
patient-status-attention = Vyžaduje pozornosť
patient-status-ready = Pripravený
patient-status-done = Prerokovaný
patient-status-closed = Uzavretý
patient-status-menu = Stav prípadu
patient-status-tooltip = Kliknutím zobrazíte stav a históriu.
patient-status-tooltip-last = Naposledy zmenil(a) { $by }, { $when }. Kliknutím zobrazíte históriu.
patient-status-reopen = Znova otvoriť ({ $status })
patient-status-close = Uzavrieť prípad
patient-status-back = Vrátiť na: { $status }
patient-status-change = Zmeniť na: { $status }
patient-status-unapproved-draft = Prípad má neschválený koncept záveru.
patient-status-help = Stav Naplánovaný nastaví rezervácia termínu, stav Prerokovaný schválenie záveru MDT.
patient-status-read-only = Stav mení lekár alebo koordinátorka; správca len číta.
patient-status-history = História stavu
patient-status-no-history = V tejto relácii bez zmien.
patient-status-closed-toast = Prípad uzavretý
patient-status-closed-slot-freed = Prípad uzavretý, termín { $slot } uvoľnený
patient-status-reopened-toast = Prípad znova otvorený
patient-status-changed-toast = Stav zmenený na { $status }

## The MDT question

patient-question-title = Otázka pre MDT
patient-question-edit = Upraviť otázku
patient-question-none = Výslovná otázka { -gap-not-stated-f }.
patient-question-confirm = Potvrdiť otázku
patient-question-confirmed = Otázka potvrdená
patient-question-draft = Návrh asistenta
patient-question-draft-tip = Žiadanka výslovnú otázku neuvádza. Otázku navrhol asistent; platí, až keď ju lekár potvrdí alebo upraví. { $basis }

## Edit dialog

patient-edit-dialog = Upraviť údaj
patient-edit-original = Pôvodne (z dokumentu alebo od asistenta)
patient-edit-note = Úprava sa uloží ako zmena od { $user } s časom. Pôvodný dokument sa nemení a pôvodná hodnota zostane v histórii prípadu.
patient-edit-revert = Vrátiť pôvodné
patient-edit-save = Uložiť
patient-edit-saved = Úprava uložená
patient-edit-reverted = Vrátený pôvodný údaj

## Brief ("Stručné zhrnutie")

patient-brief-title = Stručné zhrnutie
patient-brief-from-list = Zhrnutie zo zoznamu pacientov, bez odkazov na zdroj.
patient-brief-source = Zdroj: { $file }, { $pages } s.
patient-unprocessed = Nespracované
patient-processed = Spracované: { $parts }
patient-processed-documents = dokumenty
patient-processed-missing = chýbajúce podklady
patient-processed-labs = laboratórium
patient-processed-anamnesis = anamnéza
patient-processed-findings = nálezy

## Missing-document signal (always on, CLAUDE.md) and the brief's alert panel

patient-missing-unchecked = ⚠ Chýbajúce podklady neskontrolované (prípad nespracovaný)
patient-missing-failed = ⚠ Chýbajúce podklady nemožno overiť (načítanie zlyhalo)
patient-gaps-toggle = ⚠ Upozornenia
patient-gaps-toggle-missing = ⚠ Upozornenia · chýbajú podklady
patient-gaps-title = Upozornenia
patient-gaps-for-question = Upozornenia k otázke pre MDT
patient-gaps-all = Všetky upozornenia
patient-gaps-none = Žiadne aktívne upozornenia.
patient-gaps-brief = Chýbajúce a nejasné údaje v stručnom zhrnutí
patient-gaps-documents = Chýbajúce a nejasné podklady

## Alerts (the assistant's observations; they never block the discussion)

patient-alerts-disclaimer = { -trust-observation-cap }, nie klinický záver. Upozornenia neblokujú prerokovanie.
patient-alerts-title = Upozornenia
patient-alerts-for-question = K otázke pre MDT
patient-alerts-other = Ostatné upozornenia
patient-alerts-more-contradiction = Rozpor, ďalšie
patient-alerts-more-missing = Chýba, ďalšie
patient-alerts-more-chronology = Chronológia, ďalšie
patient-alerts-more-unclear = Nejasné, ďalšie
patient-alert-kind-missing = Chýba
patient-alert-kind-contradiction = Rozpor
patient-alert-kind-chronology = Chronológia
patient-alert-kind-unclear = Nejasné
patient-alert-ack = Vziať na vedomie
patient-alert-resolve = Vyriešené
patient-alert-reopen = Vrátiť
patient-alert-acked-by = Vzal(a) na vedomie { $who }, { $when }
patient-alert-resolved-by = Vyriešil(a) { $who }, { $when }
patient-alert-reopened-by = Vrátil(a) medzi otvorené { $who }, { $when }
patient-alert-hist-ack = vzal(a) na vedomie
patient-alert-hist-resolved = vyriešil(a)
patient-alert-hist-reopen = vrátil(a) medzi otvorené
patient-alert-history = História ({ $n })
patient-alert-archive = Vyriešené / vzaté na vedomie ({ $n })

## Conclusion ("Záver MDT"): approved conclusions are an append-only history

patient-concl-title = Záver MDT
patient-concl-valid = Platný záver č. { $n } · schválil(a) { $by }, { $when }
patient-concl-earlier = Predchádzajúce závery ({ $n })
patient-concl-number = Záver č. { $n }
patient-concl-superseded = nahradený
patient-concl-report = Schválený report
patient-concl-none = Zatiaľ neprerokované.
patient-concl-unapproved = Neschválený koncept:
patient-concl-closed = Prípad je uzavretý; znova ho otvoríte v menu stavu.
patient-concl-ident = { $name } · RČ: { $rc } · vek: { $age } · ID { $id }

## Timeline ("Priebeh ochorenia")

patient-tl-title = Priebeh ochorenia
patient-tl-help = Udalosti sú zoradené podľa dátumu a označené ikonou a názvom kategórie. Možno vybrať viac kategórií súčasne. Odškrtnutím kategóriu skryjete; Všetko zapne alebo vypne všetky kategórie. Čiarkovaný krúžok znamená plán. Kliknutím na udalosť otvoríte jej zdroj; dátum a neistota zostávajú podľa dokumentácie.
patient-tl-categories = Kategórie udalostí
patient-tl-all = Všetko
# "z 16 udalostí": genitive after "z"; one event reads "z 1 udalosti".
patient-tl-status = Zobrazené: { $shown } z { $all ->
    [one] { $all } udalosti
    [few] { $all } udalostí
    [many] { $all } udalosti
   *[other] { $all } udalostí
} · { $cats } z { $total } kategórií
patient-tl-region = Časová os priebehu ochorenia
patient-tl-undated = Bez dátumu
patient-tl-planned = {" "}· plán
patient-tl-all-hidden = Všetky kategórie sú skryté. Zaškrtnite kategóriu alebo Všetko.
patient-tl-none-in-selection = Vo vybraných kategóriách nie sú zaznamenané udalosti.
patient-cat-imaging = Zobrazovacie vyšetrenia
patient-cat-systemic = Systémová protinádorová liečba
patient-cat-medication = Ostatná medikácia
patient-cat-mdt = MDT a rozhodnutia
patient-cat-surgery = Chirurgia a výkony
patient-cat-pathology = Patológia a molekulové vyšetrenia
patient-cat-radiotherapy = Rádioterapia
patient-cat-laboratory = Laboratórne vyšetrenia
patient-cat-clinical = Klinický stav a ostatné

## Overview: oncology summary and current state

patient-onco-title = Onkologické zhrnutie
patient-onco-pin-help = Ikona pri dátume označuje rovnakú kategóriu ako na časovej osi. Názov kategórie ukáže prechod myšou alebo zameranie klávesnicou. Čiarkovaný krúžok znamená plánované.
patient-onco-region = Onkologické zhrnutie, posuvný obsah
# The TNM in the headline is the stage at diagnosis, never the current stage (CLAUDE.md).
patient-onco-ptnm = (pTNM pri diagnóze, { $month })
patient-onco-start = začiatok liečby
patient-onco-planned-suffix = , plánované
patient-state-title = Aktuálny stav pacienta
patient-state-subjective = Subjektívne:
patient-state-objective = Objektívne:
patient-state-tkp = TK/P
patient-state-tt = TT
patient-state-ps = PS (ECOG)
patient-state-exam-undated = dátum neuvedený

## "+ Nahrať dokument" (a demonstration dialog: it stores nothing)

patient-upload-title = Nahrať dokument
patient-upload-heading = Nahrať dokument · { $id }
patient-upload-drop = Presuňte PDF, DOCX alebo fotografiu správy
patient-upload-pick = Vybrať súbory
patient-upload-done-label = Nahrané:
patient-upload-done = kontrola čitateľnosti prebehla, dokument sa pridá do zoznamu. V ukážke sa nič neukladá.
patient-upload-note = Po nahraní prebehne kontrola čitateľnosti; pri zlej kvalite aplikácia požiada o lepšiu kópiu.

## Break-the-glass (a doctor outside the case's team, with a stated reason)

patient-bg-title = Otvoriť mimo tímu
patient-bg-heading = Otvoriť mimo tímu · { $id }
patient-bg-intro = Nie ste v tíme tohto prípadu. Lekár mimo tímu môže prípad otvoriť s uvedením dôvodu.
patient-bg-reason = Dôvod prístupu (10 až 500 znakov)
patient-bg-reason-invalid = Uveďte dôvod prístupu (10 až 500 znakov).
patient-bg-note = Prístup sa zapíše do záznamu prístupov aj s dôvodom a platí obmedzený čas.
patient-bg-back = Späť na zoznam
patient-bg-granted = Prístup mimo tímu zapísaný do záznamu prístupov

# Slovak, three tabs of the patient detail screen (S-3): Dokumenty (documents), Anamnéza (anamnesis) and
# Laboratórium (labs). Interface text only: document titles, quotes, lab names, values, units, ranges and codes are
# content and never come from here. Shared wording (gap, sources, certainty tags) is above in this file.

## Anamnéza

patient-anam-title = Anamnéza
patient-anam-section = { $key ->
    [OA] Osobná anamnéza
    [RA] Rodinná anamnéza
    [PA] Pracovná anamnéza
    [SA] Sociálna anamnéza
    [FA] Farmakologická anamnéza
    [AA] Alergologická anamnéza
    [abusus] Abúzus
    [EA] Epidemiologická anamnéza
   *[preventive] Preventívne prehliadky
}
# The chip in front of a drug warning (an interaction or contraindication the documents state).
patient-anam-warning = Pozor
patient-anam-pack-years = Balíčkoroky:{" "}
# The icon legend under the card; each label follows its icon.
patient-anam-legend-label = Ikony:
patient-anam-legend-ocr = { -trust-verify-reading }
patient-anam-legend-planned = plánované
patient-anam-legend-conflict = rozpor medzi dokumentmi
patient-anam-legend-observation = { -trust-observation }
patient-anam-legend-tail = Podrobnosť ukáže prechod myšou. Lieky slúžia na informáciu; pri príjme sa kontrolujú.

## Dokumenty

patient-docs-title = Dokumenty ({ $n })
patient-docs-title-filtered = Dokumenty ({ $shown } z { $n })
patient-docs-source = Zdroj:{" "}
patient-docs-source-uploaded = { $n ->
    [one] { $n } nahrané PDF
    [few] { $n } nahrané PDF
    [many] { $n } nahraného PDF
   *[other] { $n } nahraných PDF
}
patient-docs-source-pages = { $n ->
    [one] , { $n } strana
    [few] , { $n } strany
    [many] , { $n } strany
   *[other] , { $n } strán
}
# The page count of the documentation is not known: a gap dash sits between these two.
patient-docs-source-pages-none = ,{" "}
patient-docs-source-pages-none-unit = {" "}strán
patient-docs-upload = + Nahrať dokument
patient-docs-missing-originals = Chýbajú originály
patient-docs-search = Hľadať v dokumentoch
patient-docs-clear-filters = Zrušiť filtre ({ $n })
patient-docs-col-document = Dokument
patient-docs-col-type = Typ
patient-docs-col-date = Dátum
patient-docs-col-pages = Strany
patient-docs-col-readability = Čitateľnosť
patient-docs-col-year = Rok
patient-docs-year-none = bez dátumu
patient-docs-readability = { $code ->
    [good] Dobre čitateľné
    [fair] Čiastočne čitateľné
   *[poor] Zle čitateľné
}
# After a document the PDF only cites ("citované v ambulantnej správe"): its original is not in the documentation.
patient-docs-original-missing = , originál chýba
patient-docs-open = Otvoriť
patient-docs-none-match = Žiadny dokument nezodpovedá filtru.
patient-docs-readability-hint = Dôvod hodnotenia čitateľnosti ukáže prechod myšou na štítok.

## Column filter (Excel-style list of a column's values)

patient-docs-filter-label = Filter { $title }
patient-docs-filter-all = (Všetko)
patient-docs-filter-done = Hotovo

## Reading a document without AI (the pipeline panel; the result is the assistant's reading, never the case data)

patient-docs-pipe-run = Prečítať bez AI
patient-docs-pipe-rerun = Prečítať znova bez AI
patient-docs-pipe-busy = Čítam…
patient-docs-pipe-failed = Čítanie zlyhalo ({ $code ->
    [start_failed] nespustilo sa
    [stalled] nedokončilo sa
    [encrypted] PDF je zašifrované
    [not_pdf] súbor nie je čitateľné PDF
    [unreadable_pdf] súbor nie je čitateľné PDF
    [too_many_pages] príliš veľa strán
    [page_too_large] strana je príliš veľká
    [pipeline_off] spracovanie nie je zapnuté
    [page_reader_unreachable] služba neodpovedá
   *[other] chyba služby
}).
patient-docs-pipe-reading = Číta sa (
patient-docs-pipe-queued = vo fronte
patient-docs-pipe-reading-end = )…
patient-docs-pipe-readability = :{" "}čitateľnosť{" "}
patient-docs-pipe-verify = { $n ->
    [one] , { $n } miesto na overenie
    [few] , { $n } miesta na overenie
    [many] , { $n } miesta na overenie
   *[other] , { $n } miest na overenie
}
# A missing count from the server is a gap dash between the parts, never an assumed 0.
patient-docs-pipe-labs = , laboratórne hodnoty { $n } (na overenie{" "}
patient-docs-pipe-labs-end = )
patient-docs-pipe-diff = ; oproti vopred pripraveným údajom{" "}
patient-docs-pipe-diff-same = {" "}zhodných,{" "}
patient-docs-pipe-diff-verify = {" "}na overenie
patient-docs-pipe-diff-silent = { $n } inak bez označenia
patient-docs-pipe-diff-missing = nenájdené: { $n }

## Laboratórium

patient-labs-title-values = Laboratórium · Hodnoty z dokumentu
patient-labs-title-trend = Laboratórium · Vývoj v čase
patient-labs-draws = { $n ->
    [one] { $n } odber z dokumentácie
    [few] { $n } odbery z dokumentácie
    [many] { $n } odberu z dokumentácie
   *[other] { $n } odberov z dokumentácie
}
patient-labs-trend-hint = Klik na hodnotu otvorí jej riadok v zdroji, klik na dátum laboratórny list.
patient-labs-col-test = Parameter
patient-labs-col-value = Hodnota
patient-labs-col-unit = Jednotka
patient-labs-col-range-short = Ref. interval
patient-labs-col-range = Referenčný interval
patient-labs-col-date = Dátum odberu
patient-labs-col-source = Zdroj
# Tooltip of a value or draw date: the quoted line it rests on.
patient-labs-src-tip = Zdroj: „{ $quote }“
patient-labs-value-label = { $name } { $date }: { $value } { $unit }, otvoriť zdroj
patient-labs-pick-hint = Kliknite na riadok parametra · zelené pásmo = referenčný interval
patient-labs-chart-label = Vývoj v čase, { $name }
patient-labs-chart-range = ref. { $range }
patient-labs-chart-needs-two = Na graf sú potrebné aspoň dve hodnoty.
patient-labs-sources = Zdroje
# The source button of a value row, with a plain space as the old table printed it.
patient-labs-row-source = s. { $page }
patient-labs-all-values = Pre všetky hodnoty:{" "}
patient-labs-head-date = Dátum odberu:{" "}
patient-labs-head-source = Zdroj:{" "}
patient-labs-head-source-page = , s.{" "}{ $page }
patient-labs-head-click-name = . Klik na názov parametra otvorí jeho riadok v zdroji.
patient-labs-no-trend = Vývoj v čase sa zobrazuje len tam, kde dokumentácia obsahuje aspoň dva datované odbery; tu je jedna sada bez dátumu odberu.

# Slovak, the patient screen's "Navrhovaný postup" and "Retrospektívne odchýlky" tabs and the guideline drawer: the
# proposal box, the guideline layer (F-27 in docs/design/PRODUCT.md), its literature and the deviation tables.
# Interface text only: guideline names, quotes, sections, grades as printed, facts and the assistant's reasons are
# content from the data and never come from here.

## Proposal box

patient-proposal-heading = Navrhovaný ďalší postup
patient-proposal-tag = návrh lekára, nie rozhodnutie MDT
patient-proposal-tag-tooltip = Zapísal(a) { $by }, { $when }
patient-proposal-empty = Čo ďalej navrhuje odosielajúci lekár na rozhodnutie na tomto MDT; asistent postup nenavrhuje.
patient-proposal-add = doplniť

## Guideline layer

patient-guide-heading = Odporúčané postupy k ďalšiemu postupu
patient-guide-layer-toggle = vrstva odporúčaní
patient-guide-off = Vypnuté.
patient-guide-loading = Načítavam odporúčania zo servera…
patient-guide-load-failed = Odporúčania sa nepodarilo načítať.
patient-guide-retry = Skúsiť znova
patient-guide-order-note = Zoradené podľa sily, ktorú uvádza samo odporúčanie, nie poradie možností pre tohto pacienta.
patient-guide-group-oncology = Onkológia
patient-guide-group-other = Ďalšie odbory (pridružené ochorenia)
patient-guide-footer = { -trust-observation-cap }, rozhoduje MDT. Citácie doslovne z uvedených odporúčaní; kliknutím sa rozbalí dôvod, zdroje a pôvodný stupeň.
patient-guide-not-retrieved = Nenačítané zdroje ({ $n })

# The common strength scale (round 19); the code comes from packages/domain/src/guideline.ts.
patient-guide-tier = { $code ->
    [strong] silné
    [moderate] stredné
    [weak] slabé
   *[unstated] neuvedené
}
# A statement graded more than once: from its strongest to its weakest tier.
patient-guide-tier-range = { $from } až { $to }
patient-guide-tier-chip = sila: { $tier }
patient-guide-tier-tooltip = Sila odporúčania na spoločnej škále, prevedená z vlastného stupňa odporúčania; pôvodné označenie je v rozbalenom zázname
patient-guide-clamp-note = (citácia skrátená, rozbaľte)
patient-guide-why = Prečo:
patient-guide-no-source = (zdroj nedohľadaný)
patient-guide-original-grade = pôvodné označenie:
patient-guide-grade-none = neuvedené
patient-guide-grade-chapter-text = text kapitoly, bez stupňa
# ČOS and NCCN categories sort as "neuvedené"; the opened entry says what they mean.
patient-guide-grade-categories = (kategórie { $cats }: dôkazy a zhoda odborníkov, nie sila odporúčania)
patient-guide-page-printed = s. { $page }
patient-guide-page-pdf = s. PDF { $page }
patient-guide-abstract-only = len abstrakt
patient-guide-open = otvoriť v odporúčaní
# The tooltip of "otvoriť v odporúčaní" ends with the page, or says the statement comes from the abstract.
patient-guide-cite-page = s. { $page }
patient-guide-cite-abstract = abstrakt

## Literature (PubMed), labelled as literature, never as a recommendation

patient-guide-lit-heading = Literatúra z PubMed · nie je odporúčanie
patient-guide-lit-intro = Pre situácie, kde odporúčania nestačia. Vyhľadávanie v PubMed používa len odborné pojmy, nikdy údaje o pacientovi
patient-guide-lit-queries = ; dopyty:{" "}
patient-guide-lit-intro-end = .
patient-guide-quoted = „{ $text }“
patient-guide-lit-chip = literatúra, nie odporúčanie
patient-guide-lit-author = { $author } et al.
patient-guide-pmid = PMID { $pmid }

## Guideline drawer

patient-guide-drawer-label = Odporúčanie
patient-guide-drawer-close = Zavrieť
patient-guide-drawer-page = strana PDF { $page }
patient-guide-drawer-printed = (tlačená { $page })
patient-guide-drawer-abstract-only = len abstrakt, plný text nebol dostupný
patient-guide-drawer-open-pdf = Otvoriť PDF online
patient-guide-drawer-open-pdf-page = Otvoriť PDF online (str. { $page })
patient-guide-drawer-publisher = Zdroj vydavateľa
patient-guide-drawer-grade = Pôvodné označenie:
patient-guide-drawer-relation = Vzťah k záznamu:
patient-guide-drawer-edition = Vydanie { $year }, { $range }
patient-guide-drawer-applies = Platí, pretože:
patient-guide-drawer-no-text = Text strany nie je k dispozícii.

## Deviations tab

patient-dev-layer-off = Vrstva odporúčaní je vypnutá.
patient-dev-loading = Načítavanie podkladov pre odchýlky…
patient-dev-more = Ďalšie porovnania minulých rozhodnutí s odporúčaniami ({ $n })
patient-dev-no-past = K minulým rozhodnutiam nie sú pasáže z odporúčaní.

# The eight columns of both deviation tables.
patient-dev-col-finding = Problém / zistenie
patient-dev-col-area = Oblasť
patient-dev-col-severity = Závažnosť
patient-dev-col-guideline = Odporúčanie
patient-dev-col-year = Rok
patient-dev-col-passage = Znenie odporúčania
patient-dev-col-quote = Citácia z dokumentácie
patient-dev-col-consequence = Možný klinický dôsledok

patient-dev-findings-heading = Odchýlky a súvisiace zistenia
patient-dev-findings-none = Pre tento prípad nie sú spracované zistenia.
# Czech "zjištění" has one form for every count; Slovak "zistenie" inflects, so it takes plural variants.
patient-dev-findings-count = { $n ->
    [one] { $n } zistenie
    [few] { $n } zistenia
    [many] { $n } zistenia
   *[other] { $n } zistení
} · bez povinnej akcie
patient-dev-findings-intro = { -trust-observation-cap } z dostupnej dokumentácie. Dokumentačná medzera ani úprava pri toxicite samy osebe nepreukazujú nesprávnu starostlivosť.
patient-dev-findings-region = Tabuľka odchýlok a súvisiacich zistení
patient-dev-open-guideline = Otvoriť odporúčanie
# The link next to the risk basis of a finding: the table of the EASL guideline the basis cites.
patient-dev-risk-basis-link = Tabuľka 14, s. PDF 42
patient-dev-consequence-note = Možný dopad / obmedzenie posúdenia, nie doložená komplikácia.
patient-dev-findings-footnote = Závažnosť nie je klinicky posúdená. Citácie sú pôvodné znenie zdrojov; zhrnutia a možné dôsledky sú pozorovaním asistenta. Súčasný stav nemožno automaticky odvodiť z historického alebo nedatovaného záznamu.

patient-dev-retro-heading = Retrospektívne odchýlky
patient-dev-retro-sub = Prehľad bez povinného hodnotenia alebo potvrdzovania
patient-dev-retro-intro = { -trust-observation-cap }: porovnanie záznamov s odporúčaniami. Samotné zaradenie riadku nepotvrdzuje odchýlku.
patient-dev-retro-region = Tabuľka retrospektívnych odchýlok
patient-dev-retro-footnote = Závažnosť a klinický dôsledok nie sú v podkladoch stanovené; chýbajúce údaje sa nedopĺňajú. Skôr zaznamenané hodnotenia zostávajú len na čítanie. Citácie vychádzajú z vydania platného v čase rozhodnutia; online novelizácie v priebehu roka neboli overené.
patient-dev-group-surgery = Chirurgia
patient-dev-group-systemic = Systémová liečba
patient-dev-doc-page = , s. { $page }

## The guideline edition valid at a past decision

patient-dev-edition-range = platné od { $from } do { $to }
patient-dev-edition-until-now = doteraz
patient-dev-past-label = Odporúčanie platné v čase rozhodnutia
patient-dev-past-not-checked = Pasáž z vydania platného v čase rozhodnutia nebola dohľadaná; citácia z neskoršieho vydania sa nezobrazuje.
patient-dev-past-edition = vydanie { $year }
patient-dev-past-chosen-for = vydanie vybrané k dátumu { $date } (výkon alebo začiatok liečby podľa dokumentácie)
patient-dev-past-not-found = vydanie platné v čase rozhodnutia pasáž neobsahuje
patient-dev-past-more = Ďalšia pasáž z toho istého vydania ({ $n })
patient-dev-open-pdf = otvoriť PDF vydania { $year }
patient-dev-open-pdf-page = otvoriť PDF vydania { $year }, { $page }

# Slovak, the Prognóza tab of the patient screen and its two drawers (the source list and the similarity
# explanation). The tab shows study results for similar patient groups that the assistant's search found; it is no
# individual prognosis. Message IDs start with "patient-pg-". Study titles, arms, populations, values, quotes and the
# server's warnings are content and never come from here.

## The tab

patient-pg-title = Prognóza
patient-pg-subtitle = Výsledky štúdií pre podobné skupiny pacientov · rešerš asistenta
patient-pg-as-of = K dátumu MDT { $date }
patient-pg-intro = Porovnanie výsledkov jednotlivých štúdií. Uvedené percentá opisujú skúmané skupiny; individuálnu prognózu posudzuje lekár.
patient-pg-no-slot = Pacient nemá termín MDT. Na vyhľadávanie najprv vyberte deň v kalendári.
patient-pg-schedule = Naplánovať MDT
patient-pg-loading-profile = Načítavanie profilu a nastavení…
patient-pg-retry = Skúsiť pripojenie znova
patient-pg-not-configured = Vyhľadávanie nie je nakonfigurované. Doplňte API kľúč a model Astra v serverovom .env.
patient-pg-profile-unavailable = Pre tento prípad nie sú k dátumu MDT dostupné dostatočné štruktúrované podklady.

## The search profile (the structured facts the search was given)

patient-pg-profile-summary = { $n ->
    [one] Klinický profil na vyhľadávanie ({ $n } podklad)
    [few] Klinický profil na vyhľadávanie ({ $n } podklady)
    [many] Klinický profil na vyhľadávanie ({ $n } podkladu)
   *[other] Klinický profil na vyhľadávanie ({ $n } podkladov)
}
patient-pg-profile-note = Pôvodné štruktúrované syntetické podklady k dátumu MDT. Neobsahuje meno, rodné číslo ani miestne úpravy textov v prehliadači.

## Search controls and states

patient-pg-loading-saved = Načítavanie uloženej rešerše…
patient-pg-search-pending = Prebieha rešerš…
patient-pg-show-saved = Zobraziť uloženú rešerš
patient-pg-search = Vyhľadať štúdie · Astra
patient-pg-refresh = Nové vyhľadávanie · 1 požiadavka
patient-pg-abbreviations = OS = celkové prežívanie · PFS = prežívanie bez progresie · ORR = miera objektívnej odpovede
patient-pg-busy = Astra vyhľadáva štúdie a ich výsledky. Vyhľadávanie môže trvať niekoľko minút.
patient-pg-saved-stale = Uložená rešerš vychádza zo starších podkladov. Pre aktuálny profil spustite nové vyhľadávanie.
# Followed by the time of the search as the server sends it.
patient-pg-found = { $n ->
    [one] Nájdená { $n } populácia / rameno ·{" "}
    [few] Nájdené { $n } populácie / ramená ·{" "}
    [many] Nájdené { $n } populácie / ramena ·{" "}
   *[other] Nájdených { $n } populácií / ramien ·{" "}
}
patient-pg-found-saved = {" "}· uložená rešerš
patient-pg-found-cached = {" "}· z vyrovnávacej pamäte

## Errors the client raises itself (the prognosis server is a separate local server)

patient-pg-error-no-server = Vyhľadávanie vyžaduje spustený lokálny server Prognózy (python3 prognosis/serve.py).
patient-pg-error-timeout = Vypršal časový limit. Ďalšie vyhľadávanie sa nespustí automaticky.
patient-pg-error-request-failed = Požiadavku sa nepodarilo dokončiť.

## The study table

patient-pg-table-label = Štúdie a prognostické ukazovatele
patient-pg-col-study = Štúdia / zdroj
patient-pg-col-population = Populácia a liečba
patient-pg-col-similarity = Podobnosť pacienta
patient-pg-col-model = Našiel model
# The short two-line headers of the OS columns; the full name is the column's accessible name.
patient-pg-col-os-6 = 6 mes.
patient-pg-col-os-12 = 12 mes.
patient-pg-col-os-36 = 3 roky
patient-pg-col-os-60 = 5 rokov
patient-pg-col-os = OS
patient-pg-ep-os-6 = 6-mesačné OS
patient-pg-ep-os-12 = 12-mesačné OS
patient-pg-ep-os-36 = 3-ročné OS
patient-pg-ep-os-60 = 5-ročné OS
patient-pg-ep-pfs = Medián PFS
patient-pg-ep-response = Odpoveď a trvanie odpovede
patient-pg-ep-toxicity = Závažná toxicita a ukončenie liečby
patient-pg-ep-burden = Záťaž liečby
patient-pg-empty-pending = Čakáme na výsledky Astry.
patient-pg-empty-no-rows = Astra nevrátila použiteľné výsledky. Skontrolujte stav rešerše a zdroje.
patient-pg-empty-start = Štúdie sa zobrazia po spustení vyhľadávania.
patient-pg-footnotes-label = Poznámky k rešerši
patient-pg-footnote = Každý riadok zachováva populáciu, liečbu a začiatok sledovania zdroja. Chýbajúce hodnoty sa nedopočítavajú. Rešerš nezaručuje úplnosť dostupnej literatúry. Podobnosť je orientačná zhoda populácie, nie pravdepodobnosť prežitia. Extrahované údaje vyžadujú kontrolu v zdroji.

## A study row

patient-pg-untitled = Zdroj bez názvu
patient-pg-link-pubmed = PubMed { $id }
patient-pg-link-doi = DOI { $id }
patient-pg-verify = Extrakcia modelu · overiť
patient-pg-sample-size = n = { $n }
patient-pg-time-origin = Začiatok sledovania:{" "}
patient-pg-unit-months = mesiacov
patient-pg-name-orr = ORR
patient-pg-name-dor-median = Medián trvania odpovede
patient-pg-name-grade3 = Stupeň ≥3
patient-pg-name-discontinuation = Ukončenie pre toxicitu
patient-pg-name-conflict-dor = Trvanie odpovede
patient-pg-name-conflict-grade3 = Toxicita stupňa ≥3
patient-pg-conflicts = Rozdielne extrahované hodnoty ({ $n })
patient-pg-conflicts-note = Sporné hodnoty sa nezobrazujú v hlavnej bunke. Overte populáciu, rameno a analýzu.

## Similarity (an orientation score of the population match, not a survival probability)

patient-pg-percent = { $v } %
patient-pg-sim-label = Orientačná zhoda populácie
patient-pg-sim-coverage = Pokrytie { $v } % váhy údajov
patient-pg-sim-critical = Zásadný rozdiel: { $list }
patient-pg-sim-explain = Vysvetlenie podobnosti
patient-pg-sim-variants = Odlišné posúdenia zhody
patient-pg-dim-histology = Histológia
patient-pg-dim-stage = Štádium
patient-pg-dim-biomarkers = Biomarkery
patient-pg-dim-treatment-line = Línia liečby
patient-pg-dim-prior-treatment = Predchádzajúca liečba
patient-pg-dim-performance-status = Výkonnostný stav
patient-pg-dim-brain-metastases = Mozgové metastázy
patient-pg-dim-age = Vek
patient-pg-status-match = zhoda
patient-pg-status-mismatch = nezhoda
patient-pg-status-unknown = nezistené
patient-pg-status-partial = čiastočná zhoda

## The similarity drawer

patient-pg-panel-label = Prognóza · Vysvetlenie podobnosti
patient-pg-panel-sub = Orientačná zhoda { $v } %
patient-pg-panel-disclaimer = Skóre zhody so skúmanou populáciou. Nejde o pravdepodobnosť prežitia ani validovaný prognostický model.
patient-pg-panel-coverage = Pokrytie známymi údajmi: { $v } % celkovej váhy
patient-pg-panel-patient = Pacient:{" "}
patient-pg-panel-study = Štúdia:{" "}
patient-pg-panel-critical = Zásadné rozdiely: { $list }

## The source list drawer

patient-pg-refs-label = Zdroje prognózy
patient-pg-refs-title = Zdroje ({ $n })
patient-pg-refs-no-quote = Pasáž nebola dodaná.
patient-pg-close = Zavrieť

# Slovak, the source viewer drawer (F-18 in docs/design/PRODUCT.md): the original page image with the quoted
# passage, the page switcher, zoom, the page transcription and the local redaction demo. Interface text only:
# document titles, file names, case IDs, quotes, the transcription, Tesseract's readings and redaction reasons are
# content from the data and never come from here.

## Drawer

patient-src-dialog = Pôvodný dokument
patient-src-loading-dialog = Zdrojový dokument
patient-src-loading-label = Zdroj
patient-src-loading = Načítavam stranu…
patient-src-close = Zavrieť
patient-src-kind = Pôvodný dokument · obrázok strany
patient-src-page-of = strana { $n } z { $of }
# $quote is a slot: the quote is content and sits in its own element.
patient-src-sought = Hľadaná citácia (s. { $page }): „{ $quote }“
# The page switcher's button; a plain space, as the old viewer had (patient-src-page keeps a no-break space).
patient-src-page-button = s. { $n }
patient-src-page-empty = {" "}(prázdna)
patient-src-page-empty-tooltip = prázdna strana

## View switch and toolbar

patient-src-tabs = Zobrazenie
patient-src-tab-image = Strana
patient-src-tab-text = Prepis strany
patient-src-redact = Začierniť (demo)
patient-src-zoom-hit = Priblížiť na citáciu
patient-src-verify-count = { $n ->
    [one] { $n } miesto na overenie
    [few] { $n } miesta na overenie
    [many] { $n } miesta na overenie
   *[other] { $n } miest na overenie
}
patient-src-engine-vision = Prepis: jazykový model, kontrola: Tesseract
patient-src-engine-tesseract = Prepis: Tesseract
patient-src-engine-conf = { $engine }, priemerná istota Tesseractu { $conf } %

## How the quote was found

patient-src-note-not-found = Citácia nenájdená presne, zobrazená celá strana.
patient-src-note-text-only = Na obrázku citáciu nemožno vyznačiť; v prepise strany je vyznačená.
patient-src-note-image-only = V prepise citáciu nemožno vyznačiť; na obrázku strany je vyznačená.
patient-src-note-spread = Všetky slová citácie nájdené, ale medzi nimi stoja ďalšie slová.
patient-src-note-approx = Citácia nájdená približne (zhoda { $pct } %): pôvodná citácia pochádza zo staršieho prevodu textu s chybami čítania.
patient-src-note-repeated = Citácia je na strane viackrát; zvýraznený prvý výskyt.
patient-src-note-similar = Podobná pasáž je na strane viackrát; zvýraznená najlepšia zhoda, overte.

## Page body

patient-src-empty-page = Prázdna strana: na strane nie je žiadny text.
patient-src-img-alt = Strana { $n } dokumentu { $file }
patient-src-img-alt-redacted = Strana { $n } po začiernení identifikátorov
patient-src-img-failed = Obrázok strany sa nepodarilo načítať. Prepis je v záložke „Prepis strany“.
patient-src-legend-text = Bodkovane: číslo, dátum alebo štádium, ktoré Tesseract prečítal inak, s nízkou istotou, alebo vôbec (čítal len jazykový model). Neoznačený text nie je overený; rozhoduje obrázok strany.
patient-src-legend-image = Žlto: citovaná pasáž. Čiarkovane: Bodkovane: číslo, dátum alebo štádium, ktoré Tesseract prečítal inak, s nízkou istotou, alebo vôbec (čítal len jazykový model). Neoznačený text nie je overený; rozhoduje obrázok strany. Miesta, ktoré čítal len jazykový model, sú podčiarknuté v prepise.
patient-src-unreadable = Nečitateľné znaky ({ $n })
patient-src-transcriber-note = Poznámka prepisu, nie je tlačený text

# A dashed box on the image: why to check the token, then what the transcription has there ($reading is content).
patient-src-vbox = { $why }; prepis: { $reading }

## Why a token is marked "overiť" ($tess and $layer are the engines' readings, content from the data)

patient-src-verify-only-vision = Čítal len jazykový model; Tesseract tu nič neprečítal, overiť
patient-src-verify-tess = Tesseract čítal: { $tess }, overiť
patient-src-verify-tess-low = Tesseract čítal: { $tess } (istota { $conf } %), overiť
patient-src-verify-only-tesseract = Textová vrstva PDF tu nič nemá, overiť
patient-src-verify-only-layer = Len textová vrstva PDF: { $layer }, overiť
patient-src-verify-layer-low = Tesseract si nie je istý (istota { $conf } %), overiť
patient-src-verify-layer = Textová vrstva PDF: { $layer }, overiť

## Local redaction demo (docs/design/DATA-PROTECTION.md)

patient-src-redact-intro = Ukážka miestneho začiernenia: takto by strana odišla do cloudového jazykového modelu.
# $reasons is a slot: the reasons are content and sit in their own element.
patient-src-redact-count = { $n ->
    [one] Začiernené { $n } miesto
    [few] Začiernené { $n } miesta
    [many] Začierneného { $n } miesta
   *[other] Začiernených { $n } miest
} ({ $reasons }) priamo na serveri nemocnice.
patient-src-redact-none = Na tejto strane kontrola nič nenašla; kontrola je neúplná, stranu pred odoslaním skontrolujte.
patient-src-redact-outro = Dátumy, diagnózy a nálezy zostávajú, preto strana stále obsahuje osobné údaje.

## Zoom

patient-src-zoom = Zväčšenie strany
patient-src-zoom-out = Oddialiť
patient-src-zoom-out-tooltip = Oddialiť (−)
patient-src-zoom-in = Priblížiť
patient-src-zoom-in-tooltip = Priblížiť (+)
patient-src-zoom-reset = Obnoviť zväčšenie
patient-src-zoom-reset-tooltip = Obnoviť: na šírku (0)
patient-src-zoom-fit = Na šírku
patient-src-zoom-pct = { $z } %

# Slovak, the FHIR R4 export of a case (the "Export FHIR" dialog and the Bundle's own labels). FHIR is the HL7
# standard for exchanging health records as linked JSON records called resources. Message IDs start with
# "patient-fhir-". The Bundle translates only our labels and section titles (I18N.md, "PDF and FHIR"); names, quotes,
# codes and values come from the documents and never from this file.

## The dialog

patient-fhir-dialog-label = Export FHIR
patient-fhir-dialog-title = Export FHIR R4 · { $id }
# $n: the number of entries in the Bundle; $counts: "Patient 1, Observation 30, ..." (resource names are FHIR code).
patient-fhir-dialog-counts = Prípad ako balík FHIR R4 (Bundle, { $n } { $n ->
        [one] záznam
        [few] záznamy
        [many] záznamu
       *[other] záznamov
    }): { $counts }. Každý údaj má záznam Provenance s dokumentom, stranou a citáciou. Všetko je návrh asistenta, neoverený lekárom. Uložená kópia prešla oficiálnym validátorom HL7 bez chýb (fhir/README.md).
patient-fhir-dialog-identity = Export obsahuje identifikáciu pacienta. V pilote by išiel cez FHIR rozhranie nemocnice, nie ako súbor.
patient-fhir-download = Stiahnuť JSON
patient-fhir-copy = Kopírovať
patient-fhir-close = Zavrieť
patient-fhir-copied = Skopírované do schránky
patient-fhir-copy-failed = Kopírovanie sa nepodarilo; označte text ručne

## The Bundle's labels and narrative. Composition text stays in the content language while the content is Czech.

patient-fhir-device-name = CodeBridge MDT asistent (ukážka)
patient-fhir-device-type = Softvér na prípravu podkladov MDT
patient-fhir-doc-text = Dokument { $file }
patient-fhir-patient-text = { $name }, { $id }
patient-fhir-source-ref = { $file }, s. { $page }
patient-fhir-provenance-text = Zdroj: { $refs }
patient-fhir-activity-extracted = Extrahované asistentom z dokumentu; neoverené lekárom
patient-fhir-activity-observation = Pozorovanie asistenta; neoverené lekárom
patient-fhir-activity-q-draft = Návrh otázky pre MDT asistentom z citovaných pasáží; neoverený lekárom
patient-fhir-date-in-doc = Dátum v dokumente: { $date }
patient-fhir-dated-line = { $date }: { $text }
patient-fhir-dx-text = { $code } { $text }
patient-fhir-dx-text-dated = { $code } { $text }, diagnóza { $date }
patient-fhir-issue-text = Pozorovanie asistenta: { $text }
patient-fhir-negated = Negácia uvedená v dokumente.
patient-fhir-obs-clinical = Klinický nález
patient-fhir-obs-current = Aktuálny stav
patient-fhir-obs-imaging = Zobrazovacie vyšetrenie
patient-fhir-obs-histology = Histológia
patient-fhir-lab-out-of-range = { $dir ->
        [high] Nad
       *[low] Pod
    } rozmedzím (vyhodnotil asistent podľa uvedeného rozmedzia)
patient-fhir-lab-as-written = V dokumente: { $value }
patient-fhir-lab-no-date = Dátum odberu neuvedený v dostupnej dokumentácii.
patient-fhir-lab-text = { $name }: { $value } { $unit } (ref. { $range })
patient-fhir-gap = Neuvedené v dostupnej dokumentácii.
patient-fhir-comp-text = Podklady pre MDT, { $id }: návrh asistenta, neoverený lekárom.
patient-fhir-comp-type = Podklady pre multidisciplinárny tím (MDT)
patient-fhir-comp-title = Podklady pre MDT, { $id } (návrh asistenta, neoverený lekárom)
patient-fhir-sec-question = Otázka pre MDT
patient-fhir-sec-summary = Zhrnutie
patient-fhir-sec-course = Priebeh ochorenia
patient-fhir-sec-conditions = Diagnóza a pridružené ochorenia
patient-fhir-sec-findings = Nálezy
patient-fhir-sec-treatment = Liečba
patient-fhir-sec-medication = Medikácia
patient-fhir-sec-drug-flags = Upozornenia k liekom
patient-fhir-sec-labs = Laboratórium
patient-fhir-sec-observations = Pozorovania asistenta
patient-fhir-sec-notes = Poznámky k podkladom

## The MDT question as plain text (also for the report). A label in brackets says who wrote it.

patient-fhir-q-none = Výslovná otázka neuvedená v dostupnej dokumentácii.
# $explicit: "yes" when the referral had its own question that a doctor changed, "no" when the doctor wrote it.
patient-fhir-q-edited = { $explicit ->
        [yes] [upravené lekárom]
       *[no] [doplnené lekárom]
    }
patient-fhir-q-confirmed = [návrh asistenta, potvrdil(a) { $by }, { $when }]
patient-fhir-q-draft = { $kind ->
        [document_purpose] [otázka podľa účelu v dokumente, návrh asistenta, neoverený lekárom]
       *[other] [návrh otázky asistentom, neoverený lekárom]
    }
# One passage a drafted question rests on, quoted verbatim with its page.
patient-fhir-basis = { $role ->
        [purpose] Účel v dokumente
       *[other] Vychádza z
    }: „{ $quote }“ ({ $file }, s. { $page }).

# Slovak, "Import z NIS" (issue #22). See the Czech file for what each message is.

patient-action-nis = Import z NIS
patient-nis-title = Import z NIS
patient-nis-heading = Import z NIS · { $id }
patient-nis-source = Zdroj: { $label } (FHIR R4, len čítanie)
patient-nis-intro = Vyhľadá pacienta v NIS podľa rodného čísla. Vyberte správny záznam sami; nič sa nezlučuje automaticky.
patient-nis-rc-label = Rodné číslo
patient-nis-rc-placeholder = 123456/7890
patient-nis-rc-missing = Pacient nemá v CodeBridge rodné číslo. Zadajte ho; prepojenie potom potvrdíte ručne.
patient-nis-search-own = Vyhľadať v NIS podľa rodného čísla pacienta
patient-nis-search = Vyhľadať v NIS
patient-nis-none = V NIS sa nenašiel žiadny záznam s týmto rodným číslom.
patient-nis-duplicates = V NIS je pre toto rodné číslo viac záznamov. Vyberte správny; CodeBridge ich nezlučuje.
patient-nis-truncated = Zobrazená je len časť výsledkov; NIS vrátil príliš veľa záznamov.
patient-nis-record = záznam NIS { $id }
patient-nis-born = Narodený(á)
patient-nis-gender-male = muž
patient-nis-gender-female = žena
patient-nis-identity-matches = rodné číslo súhlasí
patient-nis-identity-conflicts = rodné číslo sa líši
patient-nis-identity-unverified = rodné číslo nemožno overiť
patient-nis-name-spelling = meno zapísané inak (bez diakritiky)
patient-nis-name-different = meno sa líši
patient-nis-confirm = Potvrdzujem, že ide o tú istú osobu
patient-nis-link = Prepojiť
patient-nis-linked = Prepojené so záznamom NIS { $id }
patient-nis-linked-matches = Rodné číslo súhlasilo.
patient-nis-linked-unverified = Rodné číslo nebolo možné overiť, prepojenie potvrdil používateľ.
patient-nis-linked-by = Prepojil(a) { $name }, { $at }.
patient-nis-phase-note = Údaje z NIS sa zatiaľ nenačítavajú; prepojenie je prvý krok importu.
patient-nis-unlink = Zrušiť prepojenie
patient-nis-register-label = Národný register (ukážka):
