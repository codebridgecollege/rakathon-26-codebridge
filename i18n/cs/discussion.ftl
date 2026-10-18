# Czech, the running MDT and the discussion record: the session bar (S-4), "Projednání na MDT" (S-5), the AI
# recording ("AI záznam") and the report dialog with its PDF. Message IDs start with "discussion-" so they never
# collide with another area's file. The catalog holds interface text only: no patient names, quotes or values.

## Discussion card "Projednání na MDT" (S-5), session bar (S-4)

discussion-approve-wait-data = Podklady případu se nepodařilo včas načíst, schvalte prosím znovu.
discussion-approve-wait-guide = Doporučení se nepodařilo včas načíst, schvalte prosím znovu.
discussion-approve-conflict-first = Nejdřív rozhodněte o souběžné úpravě konceptu (lišta v části Projednání na MDT).
discussion-approve-recording-partial = Část záznamu se nepodařilo uložit; rozlišení mluvčích proběhne z uloženého zvuku.
discussion-approved = Závěr schválen
discussion-switch-unsaved = Koncept se nepodařilo uložit; uživatele změňte, až bude uložen.
discussion-approved-with-tasks =Závěr schválen, koordinátorce { $n ->
    [one] odeslána 1 úloha
    [few] odeslány { $n } úlohy
   *[other] odesláno { $n } úloh
}

discussion-title = Projednání na MDT
discussion-chip-approved = Závěr schválen
discussion-chip-draft = Koncept, neschváleno
discussion-chip-valid = Platný závěr č. { $n }
discussion-chip-live = MDT probíhá
# The version conflict bar: the server's message comes first, then the two choices.
discussion-conflict-theirs = Načíst uloženou verzi
discussion-conflict-mine = Přepsat mou verzí
discussion-record = Záznam diskuse
discussion-mode-manual = Ruční poznámky
discussion-mode-ai = AI záznam
discussion-mode-docs = Dokumenty
discussion-mode-docs-count = Dokumenty ({ $n })
discussion-docs-who = Nahrávat a odebírat dokumenty může lékař nebo koordinátor(ka) MDT.
discussion-notes-label = Průběžné poznámky
discussion-notes-placeholder = Poznámky z diskuse
discussion-steps = Další kroky
discussion-steps-count = { $n ->
    [one] { $n } úloha
    [few] { $n } úlohy
   *[other] { $n } úloh
}
discussion-steps-copy = Kopírovat úlohy
# One copied step: its text, who does it and the due date.
discussion-steps-copy-line = { $text } ({ $who }, do { $due })
discussion-steps-copied = Úlohy zkopírováno
discussion-step-placeholder = Úloha
discussion-step-remove = Odebrat úlohu
discussion-step-add = + Přidat úlohu
discussion-present = Přítomní ({ $n })
discussion-present-edit = Upravit
discussion-present-copy = Kopírovat
discussion-present-copied = Seznam přítomných zkopírováno
discussion-present-none = nezadáno
discussion-present-locked = Uzamčeno schválením závěru { $when }.
# $day is "Čt 22. 10. 2026"; $note says where the names come from.
discussion-present-day = Platí pro celý seminář ({ $day }). { $note }
discussion-present-case = Pacient nemá termín; přítomnost platí jen pro tento případ. { $note }
discussion-staff-fictional = Jména jsou smyšlená.
discussion-staff-list = Jména podle seznamu Personál pracoviště.
discussion-copy-failed = Kopírování není v tomto prohlížeči dostupné
discussion-approval = Schválení závěru
# Followed by the approving doctor's name in bold and the time.
discussion-approved-by = Schválil(a) za tým
discussion-close-case = Uzavřít případ
discussion-close-note = Po vyřízení úloh. Uzavřený případ zmizí z Nenaplánovaných; znovu ho otevře menu stavu v záhlaví.
discussion-new-version = Nový závěr (nahradí platný)
discussion-new-version-note = Platný závěr zůstane v historii; nový začne jako koncept.
discussion-hint-has = Schvaluje se koncept v poli Závěr MDT výše.
discussion-hint-none = Závěr zatím nezapsán. Píše ho lékař v poli Závěr MDT výše; asistent závěr nenavrhuje.
discussion-hint-write = Zapsat závěr
discussion-approve = Schválit závěr MDT
discussion-approving = Schvaluji…
# Followed by the doctor's name in bold.
discussion-approver = schvaluje za tým:
discussion-approver-doctor = schvaluje lékař
discussion-approve-join = Schválením budete doplněn(a) mezi přítomné.
discussion-approve-note = Úlohy a report vzniknou až schválením.
discussion-mails = Odeslané upozornění
discussion-mails-none = Při schválení bez úloh, upozornění se neodesílá.
discussion-sugg-title = Návrh úloh ze schváleného závěru
discussion-sugg-chip = Návrh asistenta
discussion-sugg-draft = Návrh asistenta, nepotvrzeno
discussion-sugg-due = Termín
discussion-sugg-timing = V závěru: „{ $timing }“
# A draft as a non-doctor sees it: who would do it, the due date and the timing the conclusion states.
discussion-sugg-who = Odpovídá: { $who }
discussion-sugg-due-text = termín: { $due }
discussion-sugg-confirmed = Potvrdil(a) { $by }, { $when }; úloha pro { $who }, { $due }
discussion-sugg-due-on = termín { $due }
discussion-sugg-superseded = Nepotvrzený návrh nahrazen novějším schváleným závěrem.
discussion-sugg-dismissed = Zamítl(a) { $by }, { $when }
discussion-sugg-note = Asistent úlohy jen navrhuje z textu schváleného závěru. Úlohou se návrh stane až po potvrzení lékařem.
discussion-sugg-note-doctor-only = Potvrdit nebo zamítnout návrh může jen lékař.
# The conclusion draft under "Závěr MDT" (a doctor's field; the assistant never fills it).
discussion-concl-new-label = Koncept nového závěru (nahradí platný až po schválení)
discussion-concl-placeholder = Závěr a další postup, píše lékař (koncept, schvaluje se níže v části Projednání na MDT)
discussion-concl-draft-note = Koncept, zatím neschváleno. Schvaluje se níže v části Projednání na MDT.
# The banner for an uploaded document that names another patient (never merged silently).
discussion-identity-label = Možná jiný pacient
discussion-identity-text = { $n ->
    [one] U 1 nahraného dokumentu
   *[other] U { $n } nahraných dokumentů
} se jméno nebo rodné číslo neshoduje s pacientem případu. Ověřte, zda dokument patří tomuto pacientovi (Projednání na MDT, Dokumenty).
# The session bar of the running MDT (S-4).
discussion-session-label = Probíhající MDT
discussion-session-title = MDT · { $day }
discussion-session-prev = Předchozí pacient
discussion-session-next = Další pacient
discussion-session-agenda = Pořadí na semináři
# A pill's accessible name: time, surname first, case ID, and whether the conclusion is approved.
discussion-session-pill = { $time } { $name }, { $id }
discussion-session-pill-approved = { $time } { $name }, { $id }, závěr schválen
discussion-session-present = Přítomní ({ $n })
discussion-session-end = Ukončit MDT
discussion-session-ended = MDT ukončeno
discussion-session-rec-stopped = Záznam se zastavil s koncem MDT.
# The attendance dialog for a case without a slot.
discussion-attendance-no-slot = bez termínu
discussion-attendance-case-only = Platí jen pro tento případ.

## AI recording ("AI záznam"); IDs start with "discussion-rec-"

discussion-rec-start = ● Spustit záznam
discussion-rec-stop = ■ Zastavit záznam
discussion-rec-probing = Ověřuji server pro přepis…
discussion-rec-unavailable = AI záznam v této kopii aplikace není dostupný (chybí server pro přepis).
discussion-rec-unavailable-manual = AI záznam v této kopii aplikace není dostupný (chybí server pro přepis). Závěr lze zapsat ručně.
discussion-rec-state-connecting = Připojuji…
discussion-rec-state-off = Záznam je vypnutý.
discussion-rec-state-recording = Nahrávám.
discussion-rec-state-approved = Záznam běží, závěr pacienta je schválen.
discussion-rec-state-off-agenda = Záznam běží, pacient není na programu MDT.
discussion-rec-state-running = Záznam běží.
# $reason: the server's Czech message, a browser message about the microphone, or another catalog message.
discussion-rec-start-failed = Záznam se nespustil: { $reason }
discussion-rec-token-failed = Server nevydal přístup k přepisu (HTTP { $status })
discussion-rec-socket-failed = Spojení s přepisem opakovaně selhalo, záznam se zastavil.
# $reason: the speech service's own error text or message type, shown as received.
discussion-rec-stt-error = Přepis hlásí chybu: { $reason }
discussion-rec-all-approved = Všechny případy semináře mají schválený závěr, záznam se sám zastavil.
discussion-rec-stopped-user-switch = Záznam se zastavil se změnou uživatele.
discussion-rec-diarizing = Rozlišuji mluvčí…
discussion-rec-purged = Zvuk byl smazán bez rozlišení mluvčích.
# $reason: the server's purge reason, shown as received.
discussion-rec-purged-why = Zvuk byl smazán bez rozlišení mluvčích ({ $reason }).
discussion-rec-pass-start-failed = Zpracování se nespustilo.
discussion-rec-retry = Zkusit znovu
discussion-rec-pass-failed = Rozlišení mluvčích selhalo ({ $reason }).
discussion-rec-audio-gone = Zvuk byl smazán, zůstává živý přepis.
discussion-rec-summarizing = Shrnuji diskusi…
discussion-rec-summary-failed = Shrnutí selhalo ({ $reason }).
discussion-rec-summary-chip = Shrnutí AI · návrh
discussion-rec-summary-live-only = (ze živého přepisu bez rozlišení mluvčích)
discussion-rec-transcript = Přepis diskuse
# Speakers are numbered per case and pass, never named (naming them would need voiceprints).
discussion-rec-speaker = Mluvčí { $n }:
# The words the service has not committed yet.
discussion-rec-partial = { $text }…
discussion-rec-pill-case = Záznam · { $id } · Zastavit
discussion-rec-pill-unsaved = Záznam běží, přepis se nikam neukládá · Zastavit
discussion-rec-pill-title = Zastavit záznam
# Codes the server or the speaker pass report (REC_ERR_IDS in packages/domain/src/recording.ts).
discussion-rec-err-eleven-429 = služba přepisu je přetížená
discussion-rec-err-eleven-5xx = chyba služby přepisu
discussion-rec-err-eleven-4xx = služba přepisu záznam odmítla
discussion-rec-err-network = spojení se službou selhalo
discussion-rec-err-audio-missing = zvuk chybí
discussion-rec-err-audio-purged = zvuk byl smazán
discussion-rec-err-start-failed = zpracování se nespustilo
discussion-rec-err-workflow-errored = zpracování selhalo
discussion-rec-err-workflow-terminated = zpracování bylo ukončeno
discussion-rec-err-workflow-incomplete = zpracování nedoběhlo
discussion-rec-err-transcript-too-long = přepis je příliš dlouhý ke shrnutí
discussion-rec-err-azure-429 = jazykový model je přetížený
discussion-rec-err-azure-5xx = chyba jazykového modelu
discussion-rec-err-azure-4xx = jazykový model požadavek odmítl
discussion-rec-err-internal = vnitřní chyba
discussion-rec-err-unknown = neznámá chyba

## Report dialog and PDF; IDs start with "discussion-report-"

# The dialog "Záznam z MDT" behind the header's "Stáhnout report (PDF)" (F-31).
discussion-report-dialog-label = Záznam z MDT
discussion-report-dialog-title = Záznam z MDT · { $id }
discussion-report-close = Zavřít
discussion-report-pick-label = Zahrnout do PDF
# A tick in the dialog; the finding groups are also the headings of their sections in the report.
discussion-report-pick = { $key ->
    [summary] NO / onkologický souhrn
    [anamnesis] Anamnéza
    [clinical_finding] Klinický nález
    [imaging] Zobrazovací vyšetření
    [histology] Histologie
    [past_treatment] Prodělaná léčba
   *[current_state] Aktuální stav
}
discussion-report-preview = Náhled reportu
# $when is the approval time.
discussion-report-locked = Report je uzamčen ve stavu při schválení ({ $when }). Pozdější úpravy se do něj nepromítnou; změna vyžaduje nový závěr.
discussion-report-draft-note = Závěr zatím není schválený; report se stáhne jako koncept.
discussion-report-download = Stáhnout PDF
discussion-report-busy = Připravuji PDF…
# $message is one of the PDF errors below.
discussion-report-error = PDF se nepodařilo vytvořit: { $message }
discussion-report-ready = PDF připraveno ke stažení
discussion-report-failed = PDF se nepodařilo vytvořit. Zkuste to znovu.
discussion-report-unavailable = PDF export není dostupný. Obnovte stránku a zkuste to znovu.
discussion-report-no-content = Chybí obsah reportu.

# The printed report. It is a record: the wording stays as it was first printed.
discussion-report-title = Záznam z MDT
discussion-report-meta = Datum MDT: { $date } · ID { $id }
discussion-report-meta-draft = Datum MDT: { $date } · ID { $id } · Koncept
discussion-report-gap = { -gap-not-stated }
discussion-report-h-patient = Pacient
discussion-report-h-present = Přítomní
discussion-report-present-none = nezadáno
discussion-report-h-dx = Diagnóza
discussion-report-h-summary = NO
discussion-report-h-anamnesis = Anamnéza
discussion-report-fa-warning = Pozor:
discussion-report-h-question = Prezentován pro
discussion-report-h-concl = Závěr
discussion-report-concl-none = Zatím nezapsán.
discussion-report-h-steps = Další kroky
discussion-report-step = { $text } · { $who } · do { $due }
discussion-report-steps-none = Žádné.
discussion-report-h-dev = Odchylky od doporučení
discussion-report-dev-none = Žádné dřívější posouzení není zaznamenáno.
discussion-report-h-sources = Zdroje
discussion-report-source = { $title }, s. { $page }
discussion-report-source-quote = { $title }, s. { $page }: „{ $quote }“
discussion-report-legend = Údaje sestavil asistent z uvedených dokumentů; čísla v hranatých závorkách odkazují na zdroje. [zápor v dokumentu] = zápor zapsaný lékařem; [ověřit čtení] = text, který mohl být špatně přečten; [pozorování asistenta] = odvozeno asistentem, v dokumentu výslovně není; [upraveno lékařem] = hodnotu změnil lékař, zdroj ji v této podobě neuvádí.
discussion-report-signatures = Místa pro podpis
discussion-report-signature = Jméno a podpis
# Marks after a printed fact; the legend above explains them.
discussion-report-tag-negated = [zápor v dokumentu]
discussion-report-tag-ocr = [ověřit čtení]
discussion-report-tag-inferred = [pozorování asistenta]
discussion-report-tag-conflict = [rozpor mezi dokumenty]
discussion-report-tag-conflict-note = [rozpor mezi dokumenty: { $note }]
discussion-report-tag-planned = [plánováno, neověřeno]
discussion-report-tag-edited = [upraveno lékařem]
# What the report can say about the documents ("Podklady").
discussion-report-h-basis = Podklady
discussion-report-basis-failed = Podklady případu se nepodařilo načíst ze serveru: souhrn, anamnéza, nálezy a chybějící podklady nejsou v tomto reportu. Chybějící podklady nelze ověřit.
discussion-report-basis-none = Dokumentace případu není zpracovaná; anamnéza a nálezy se do reportu netisknou. Chybějící podklady nezkontrolovány.
# $done lists the processed parts (discussion-report-basis-part), or discussion-report-basis-list-only.
discussion-report-basis-partial = { $synthetic ->
    [yes] Syntetický pacient: zpracované
   *[no] Zpracované
} jsou { $done }; anamnéza a nálezy se do reportu netisknou.
discussion-report-basis-part = { $key ->
    [documents] dokumenty
    [alerts] chybějící podklady
   *[labs] laboratoř
}
discussion-report-basis-list-only = jen údaje ze seznamu
discussion-report-h-missing = Chybějící podklady
discussion-report-h-missing-unclear = Chybějící a nejasné podklady
# The kind of a data gap that is not a missing document, before its text.
discussion-report-gap-kind = { $kind ->
    [missing] Chybí
    [contradiction] Rozpor
    [chronology] Chronologie
   *[unclear] Nejasné
}
discussion-report-gap-src = ({ $file }, s. { $page })
# The PDF file's properties, its running head and page footer.
discussion-report-pdf-title = GLIDE MDT - Záznam z MDT - { $id }
discussion-report-pdf-subject = Záznam z multidisciplinárního týmu
discussion-report-pdf-running = GLIDE MDT | Záznam z MDT - { $id }
discussion-report-pdf-page = { $id } | Strana { $i } / { $n }
