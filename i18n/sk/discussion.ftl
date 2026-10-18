# Slovak, the running MDT and the discussion record: the session bar (S-4), "Prerokovanie na MDT" (S-5), the AI
# recording ("AI záznam") and the report dialog with its PDF. Translated from i18n/cs/discussion.ftl (the source);
# same message IDs, same placeholders. The catalog holds interface text only: no patient names, quotes or values.
# The glossary is at the top of i18n/sk/patient.ftl; extra terms used here: projednání -> prerokovanie,
# přítomní -> prítomní, mluvčí -> rečník, přepis -> prepis, souběžná úprava -> súbežná úprava.
# The fixed clinical wording (the gap term, the report legend and its tags) needs sign-off from a Slovak clinician
# before release (docs/design/I18N.md).

## Discussion card "Prerokovanie na MDT" (S-5), session bar (S-4)

discussion-approve-wait-data = Podklady prípadu sa nepodarilo včas načítať, schváľte prosím znova.
discussion-approve-wait-guide = Odporúčania sa nepodarilo včas načítať, schváľte prosím znova.
discussion-approve-conflict-first = Najprv rozhodnite o súbežnej úprave konceptu (lišta v časti Prerokovanie na MDT).
discussion-approve-recording-partial = Časť záznamu sa nepodarilo uložiť; rozlíšenie rečníkov prebehne z uloženého zvuku.
discussion-approved = Záver schválený
discussion-switch-unsaved = Koncept sa nepodarilo uložiť; používateľa zmeňte, až bude uložený.
discussion-approved-with-tasks =Záver schválený, koordinátorke { $n ->
    [one] odoslaná 1 úloha
    [few] odoslané { $n } úlohy
    [many] odoslaných { $n } úloh
   *[other] odoslaných { $n } úloh
}

discussion-title = Prerokovanie na MDT
discussion-chip-approved = Záver schválený
discussion-chip-draft = Koncept, neschválené
discussion-chip-valid = Platný záver č. { $n }
discussion-chip-live = MDT prebieha
# The version conflict bar: the server's message comes first, then the two choices.
discussion-conflict-theirs = Načítať uloženú verziu
discussion-conflict-mine = Prepísať mojou verziou
discussion-record = Záznam diskusie
discussion-mode-manual = Ručné poznámky
discussion-mode-ai = AI záznam
discussion-mode-docs = Dokumenty
discussion-mode-docs-count = Dokumenty ({ $n })
discussion-docs-who = Nahrávať a odoberať dokumenty môže lekár alebo koordinátor(ka) MDT.
discussion-notes-label = Priebežné poznámky
discussion-notes-placeholder = Poznámky z diskusie
discussion-steps = Ďalšie kroky
discussion-steps-count = { $n ->
    [one] { $n } úloha
    [few] { $n } úlohy
    [many] { $n } úlohy
   *[other] { $n } úloh
}
discussion-steps-copy = Kopírovať úlohy
# One copied step: its text, who does it and the due date.
discussion-steps-copy-line = { $text } ({ $who }, do { $due })
discussion-steps-copied = Úlohy skopírované
discussion-step-placeholder = Úloha
discussion-step-remove = Odobrať úlohu
discussion-step-add = + Pridať úlohu
discussion-present = Prítomní ({ $n })
discussion-present-edit = Upraviť
discussion-present-copy = Kopírovať
discussion-present-copied = Zoznam prítomných skopírovaný
discussion-present-none = nezadané
discussion-present-locked = Uzamknuté schválením záveru { $when }.
# $day is "Št 22. 10. 2026"; $note says where the names come from.
discussion-present-day = Platí pre celý seminár ({ $day }). { $note }
discussion-present-case = Pacient nemá termín; prítomnosť platí len pre tento prípad. { $note }
discussion-staff-fictional = Mená sú vymyslené.
discussion-staff-list = Mená podľa zoznamu Personál pracoviska.
discussion-copy-failed = Kopírovanie nie je v tomto prehliadači dostupné
discussion-approval = Schválenie záveru
# Followed by the approving doctor's name in bold and the time.
discussion-approved-by = Schválil(a) za tím
discussion-close-case = Uzavrieť prípad
discussion-close-note = Po vybavení úloh. Uzavretý prípad zmizne z Nenaplánovaných; znova ho otvorí menu stavu v hlavičke.
discussion-new-version = Nový záver (nahradí platný)
discussion-new-version-note = Platný záver zostane v histórii; nový začne ako koncept.
discussion-hint-has = Schvaľuje sa koncept v poli Záver MDT vyššie.
discussion-hint-none = Záver zatiaľ nie je zapísaný. Píše ho lekár v poli Záver MDT vyššie; asistent záver nenavrhuje.
discussion-hint-write = Zapísať záver
discussion-approve = Schváliť záver MDT
discussion-approving = Schvaľujem…
# Followed by the doctor's name in bold.
discussion-approver = schvaľuje za tím:
discussion-approver-doctor = schvaľuje lekár
discussion-approve-join = Schválením budete doplnený(á) medzi prítomných.
discussion-approve-note = Úlohy a report vzniknú až schválením.
discussion-mails = Odoslané upozornenie
discussion-mails-none = Pri schválení bez úloh sa upozornenie neodosiela.
discussion-sugg-title = Návrh úloh zo schváleného záveru
discussion-sugg-chip = Návrh asistenta
discussion-sugg-draft = Návrh asistenta, nepotvrdené
discussion-sugg-due = Termín
discussion-sugg-timing = V závere: „{ $timing }“
# A draft as a non-doctor sees it: who would do it, the due date and the timing the conclusion states.
discussion-sugg-who = Zodpovedá: { $who }
discussion-sugg-due-text = termín: { $due }
discussion-sugg-confirmed = Potvrdil(a) { $by }, { $when }; úloha pre { $who }, { $due }
discussion-sugg-due-on = termín { $due }
discussion-sugg-superseded = Nepotvrdený návrh nahradený novším schváleným záverom.
discussion-sugg-dismissed = Zamietol(a) { $by }, { $when }
discussion-sugg-note = Asistent úlohy len navrhuje z textu schváleného záveru. Úlohou sa návrh stane až po potvrdení lekárom.
discussion-sugg-note-doctor-only = Potvrdiť alebo zamietnuť návrh môže len lekár.
# The conclusion draft under "Záver MDT" (a doctor's field; the assistant never fills it).
discussion-concl-new-label = Koncept nového záveru (nahradí platný až po schválení)
discussion-concl-placeholder = Záver a ďalší postup, píše lekár (koncept, schvaľuje sa nižšie v časti Prerokovanie na MDT)
discussion-concl-draft-note = Koncept, zatiaľ neschválené. Schvaľuje sa nižšie v časti Prerokovanie na MDT.
# The banner for an uploaded document that names another patient (never merged silently).
discussion-identity-label = Možno iný pacient
discussion-identity-text = { $n ->
    [one] U 1 nahraného dokumentu
    [few] U { $n } nahraných dokumentov
    [many] U { $n } nahraných dokumentov
   *[other] U { $n } nahraných dokumentov
} sa meno alebo rodné číslo nezhoduje s pacientom prípadu. Overte, či dokument patrí tomuto pacientovi (Prerokovanie na MDT, Dokumenty).
# The session bar of the running MDT (S-4).
discussion-session-label = Prebiehajúce MDT
discussion-session-title = MDT · { $day }
discussion-session-prev = Predchádzajúci pacient
discussion-session-next = Ďalší pacient
discussion-session-agenda = Poradie na seminári
# A pill's accessible name: time, surname first, case ID, and whether the conclusion is approved.
discussion-session-pill = { $time } { $name }, { $id }
discussion-session-pill-approved = { $time } { $name }, { $id }, záver schválený
discussion-session-present = Prítomní ({ $n })
discussion-session-end = Ukončiť MDT
discussion-session-ended = MDT ukončené
discussion-session-rec-stopped = Záznam sa zastavil s koncom MDT.
# The attendance dialog for a case without a slot.
discussion-attendance-no-slot = bez termínu
discussion-attendance-case-only = Platí len pre tento prípad.

## AI recording ("AI záznam"); IDs start with "discussion-rec-"

discussion-rec-start = ● Spustiť záznam
discussion-rec-stop = ■ Zastaviť záznam
discussion-rec-probing = Overujem server na prepis…
discussion-rec-unavailable = AI záznam v tejto kópii aplikácie nie je dostupný (chýba server na prepis).
discussion-rec-unavailable-manual = AI záznam v tejto kópii aplikácie nie je dostupný (chýba server na prepis). Záver možno zapísať ručne.
discussion-rec-state-connecting = Pripájam…
discussion-rec-state-off = Záznam je vypnutý.
discussion-rec-state-recording = Nahrávam.
discussion-rec-state-approved = Záznam beží, záver pacienta je schválený.
discussion-rec-state-off-agenda = Záznam beží, pacient nie je na programe MDT.
discussion-rec-state-running = Záznam beží.
# $reason: the server's Czech message, a browser message about the microphone, or another catalog message.
discussion-rec-start-failed = Záznam sa nespustil: { $reason }
discussion-rec-token-failed = Server nevydal prístup k prepisu (HTTP { $status })
discussion-rec-socket-failed = Spojenie s prepisom opakovane zlyhalo, záznam sa zastavil.
# $reason: the speech service's own error text or message type, shown as received.
discussion-rec-stt-error = Prepis hlási chybu: { $reason }
discussion-rec-all-approved = Všetky prípady seminára majú schválený záver, záznam sa sám zastavil.
discussion-rec-stopped-user-switch = Záznam sa zastavil so zmenou používateľa.
discussion-rec-diarizing = Rozlišujem rečníkov…
discussion-rec-purged = Zvuk bol zmazaný bez rozlíšenia rečníkov.
# $reason: the server's purge reason, shown as received.
discussion-rec-purged-why = Zvuk bol zmazaný bez rozlíšenia rečníkov ({ $reason }).
discussion-rec-pass-start-failed = Spracovanie sa nespustilo.
discussion-rec-retry = Skúsiť znova
discussion-rec-pass-failed = Rozlíšenie rečníkov zlyhalo ({ $reason }).
discussion-rec-audio-gone = Zvuk bol zmazaný, zostáva živý prepis.
discussion-rec-summarizing = Zhrňujem diskusiu…
discussion-rec-summary-failed = Zhrnutie zlyhalo ({ $reason }).
discussion-rec-summary-chip = Zhrnutie AI · návrh
discussion-rec-summary-live-only = (zo živého prepisu bez rozlíšenia rečníkov)
discussion-rec-transcript = Prepis diskusie
# Speakers are numbered per case and pass, never named (naming them would need voiceprints).
discussion-rec-speaker = Rečník { $n }:
# The words the service has not committed yet.
discussion-rec-partial = { $text }…
discussion-rec-pill-case = Záznam · { $id } · Zastaviť
discussion-rec-pill-unsaved = Záznam beží, prepis sa nikam neukladá · Zastaviť
discussion-rec-pill-title = Zastaviť záznam
# Codes the server or the speaker pass report (REC_ERR_IDS in packages/domain/src/recording.ts).
discussion-rec-err-eleven-429 = služba prepisu je preťažená
discussion-rec-err-eleven-5xx = chyba služby prepisu
discussion-rec-err-eleven-4xx = služba prepisu záznam odmietla
discussion-rec-err-network = spojenie so službou zlyhalo
discussion-rec-err-audio-missing = zvuk chýba
discussion-rec-err-audio-purged = zvuk bol zmazaný
discussion-rec-err-start-failed = spracovanie sa nespustilo
discussion-rec-err-workflow-errored = spracovanie zlyhalo
discussion-rec-err-workflow-terminated = spracovanie bolo ukončené
discussion-rec-err-workflow-incomplete = spracovanie nedobehlo
discussion-rec-err-transcript-too-long = prepis je príliš dlhý na zhrnutie
discussion-rec-err-azure-429 = jazykový model je preťažený
discussion-rec-err-azure-5xx = chyba jazykového modelu
discussion-rec-err-azure-4xx = jazykový model požiadavku odmietol
discussion-rec-err-internal = vnútorná chyba
discussion-rec-err-unknown = neznáma chyba

## Report dialog and PDF; IDs start with "discussion-report-"

# The dialog "Záznam z MDT" behind the header's "Stiahnuť report (PDF)" (F-31).
discussion-report-dialog-label = Záznam z MDT
discussion-report-dialog-title = Záznam z MDT · { $id }
discussion-report-close = Zavrieť
discussion-report-pick-label = Zahrnúť do PDF
# A tick in the dialog; the finding groups are also the headings of their sections in the report.
discussion-report-pick = { $key ->
    [summary] NO / onkologické zhrnutie
    [anamnesis] Anamnéza
    [clinical_finding] Klinický nález
    [imaging] Zobrazovacie vyšetrenia
    [histology] Histológia
    [past_treatment] Prekonaná liečba
   *[current_state] Aktuálny stav
}
discussion-report-preview = Náhľad reportu
# $when is the approval time.
discussion-report-locked = Report je uzamknutý v stave pri schválení ({ $when }). Neskoršie úpravy sa do neho nepremietnu; zmena vyžaduje nový záver.
discussion-report-draft-note = Záver zatiaľ nie je schválený; report sa stiahne ako koncept.
discussion-report-download = Stiahnuť PDF
discussion-report-busy = Pripravujem PDF…
# $message is one of the PDF errors below.
discussion-report-error = PDF sa nepodarilo vytvoriť: { $message }
discussion-report-ready = PDF pripravené na stiahnutie
discussion-report-failed = PDF sa nepodarilo vytvoriť. Skúste to znova.
discussion-report-unavailable = Export PDF nie je dostupný. Obnovte stránku a skúste to znova.
discussion-report-no-content = Chýba obsah reportu.

# The printed report. It is a record: the wording stays as it was first printed.
discussion-report-title = Záznam z MDT
discussion-report-meta = Dátum MDT: { $date } · ID { $id }
discussion-report-meta-draft = Dátum MDT: { $date } · ID { $id } · Koncept
discussion-report-gap = { -gap-not-stated }
discussion-report-h-patient = Pacient
discussion-report-h-present = Prítomní
discussion-report-present-none = nezadané
discussion-report-h-dx = Diagnóza
discussion-report-h-summary = NO
discussion-report-h-anamnesis = Anamnéza
discussion-report-fa-warning = Pozor:
discussion-report-h-question = Prezentovaný na
discussion-report-h-concl = Záver
discussion-report-concl-none = Zatiaľ nezapísaný.
discussion-report-h-steps = Ďalšie kroky
discussion-report-step = { $text } · { $who } · do { $due }
discussion-report-steps-none = Žiadne.
discussion-report-h-dev = Odchýlky od odporúčaní
discussion-report-dev-none = Žiadne skoršie posúdenie nie je zaznamenané.
discussion-report-h-sources = Zdroje
discussion-report-source = { $title }, s. { $page }
discussion-report-source-quote = { $title }, s. { $page }: „{ $quote }“
discussion-report-legend = Údaje zostavil asistent z uvedených dokumentov; čísla v hranatých zátvorkách odkazujú na zdroje. [zápor v dokumente] = zápor zapísaný lekárom; [overiť čítanie] = text, ktorý mohol byť zle prečítaný; [pozorovanie asistenta] = odvodené asistentom, v dokumente výslovne nie je; [upravené lekárom] = hodnotu zmenil lekár, zdroj ju v tejto podobe neuvádza.
discussion-report-signatures = Miesta na podpis
discussion-report-signature = Meno a podpis
# Marks after a printed fact; the legend above explains them.
discussion-report-tag-negated = [zápor v dokumente]
discussion-report-tag-ocr = [overiť čítanie]
discussion-report-tag-inferred = [pozorovanie asistenta]
discussion-report-tag-conflict = [rozpor medzi dokumentmi]
discussion-report-tag-conflict-note = [rozpor medzi dokumentmi: { $note }]
discussion-report-tag-planned = [plánované, neoverené]
discussion-report-tag-edited = [upravené lekárom]
# What the report can say about the documents ("Podklady").
discussion-report-h-basis = Podklady
discussion-report-basis-failed = Podklady prípadu sa nepodarilo načítať zo servera: zhrnutie, anamnéza, nálezy a chýbajúce podklady nie sú v tomto reporte. Chýbajúce podklady nemožno overiť.
discussion-report-basis-none = Dokumentácia prípadu nie je spracovaná; anamnéza a nálezy sa do reportu netlačia. Chýbajúce podklady neskontrolované.
# $done lists the processed parts (discussion-report-basis-part), or discussion-report-basis-list-only.
discussion-report-basis-partial = { $synthetic ->
    [yes] Syntetický pacient: spracované
   *[no] Spracované
} sú { $done }; anamnéza a nálezy sa do reportu netlačia.
discussion-report-basis-part = { $key ->
    [documents] dokumenty
    [alerts] chýbajúce podklady
   *[labs] laboratórium
}
discussion-report-basis-list-only = len údaje zo zoznamu
discussion-report-h-missing = Chýbajúce podklady
discussion-report-h-missing-unclear = Chýbajúce a nejasné podklady
# The kind of a data gap that is not a missing document, before its text.
discussion-report-gap-kind = { $kind ->
    [missing] Chýba
    [contradiction] Rozpor
    [chronology] Chronológia
   *[unclear] Nejasné
}
discussion-report-gap-src = ({ $file }, s. { $page })
# The PDF file's properties, its running head and page footer.
discussion-report-pdf-title = GLIDE MDT - Záznam z MDT - { $id }
discussion-report-pdf-subject = Záznam z multidisciplinárneho tímu
discussion-report-pdf-running = GLIDE MDT | Záznam z MDT - { $id }
discussion-report-pdf-page = { $id } | Strana { $i } / { $n }
