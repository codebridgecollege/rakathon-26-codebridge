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
patient-gaps-brief = Chybějící a nejasné údaje ve stručném souhrnu
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
patient-alert-kind-missing = Chybí
patient-alert-kind-contradiction = Rozpor
patient-alert-kind-chronology = Chronologie
patient-alert-kind-unclear = Nejasné
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
