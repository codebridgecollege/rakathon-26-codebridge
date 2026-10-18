# Czech, the source catalog (docs/design/I18N.md): the list screens. Patient list (S-1), MDT calendar (S-2), tasks
# (S-6), administration (S-7) and staff (S-8). Message IDs are semantic, never the Czech text; the prefixes lists-,
# patients-, calendar-, start-mdt-, tasks-, staff- and admin- belong to this file.
# The catalog holds interface text only: no patient names or examples, synthetic or not.

## Shared by the list screens

# Case statuses (code -> label); the code is shown when the server sends one this catalog does not know.
lists-status-new = Nový
lists-status-scheduled = Naplánován
lists-status-attention = Vyžaduje pozornost
lists-status-ready = Připraven
lists-status-done = Projednán
lists-status-closed = Uzavřen
lists-status-unknown = { $code }
# Short weekday names, as the calendar and the slot labels write them.
lists-weekday-sun = Ne
lists-weekday-mon = Po
lists-weekday-tue = Út
lists-weekday-wed = St
lists-weekday-thu = Čt
lists-weekday-fri = Pá
lists-weekday-sat = So
# "Čt 22. 10."; $date is the day and month formatted by Intl.
lists-day-label = { $weekday } { $date }
# "Čt 22. 10. 2026"
lists-day-year = { $day } { $year }
# A booked MDT slot: "Čt 22. 10. 2026 · 14:00-14:10".
lists-slot-text = { $day } { $year } · { $from }-{ $to }
lists-slot-none = nenaplánováno
# The fixed wording for a gap in the documentation (CLAUDE.md); on screen a "-" carries it as its tooltip.
lists-gap-not-stated = neuvedeno v dostupné dokumentaci
lists-dialog-close = Zavřít
lists-dialog-cancel = Zrušit

## Patient database (S-1)

patients-title = Databáze pacientů
patients-subtitle = Pacienti odeslaní k projednání na neuroonkologickém MDT
patients-new = + Nový pacient
patients-new-refused = Pacienta zakládá lékař nebo koordinátorka.
patients-search-placeholder = Hledat ID, jméno, diagnózu
patients-search-label = Hledat
patients-submitted-from = Podáno od
patients-submitted-to = do
patients-count = { $shown } z { $total }
patients-clear-filters = Zrušit filtry ({ $n })
patients-col-id = ID
patients-col-patient = Pacient
patients-col-rc = RČ
patients-col-age = Věk
patients-col-diagnosis = Diagnóza
patients-col-owner = Vlastník
patients-col-dept = Odesílající pracoviště
patients-col-slot = Příští MDT
patients-col-status = Stav
patients-col-submitted = Podáno
patients-column-resize = Táhnutím změníte šířku sloupce
# The column filter popover's accessible name: "Filtr Stav".
patients-filter-dialog = Filtr { $column }
patients-filter-all = (Vše)
patients-filter-done = Hotovo
patients-verify-identity = ověřit identitu
patients-synthetic = syntetický pacient
patients-synthetic-tooltip = Fiktivní pacient vytvořený týmem CodeBridge (vlastní syntetická dokumentace), ne z dat FNO
patients-rc-missing = Rodné číslo neuvedeno v dostupné dokumentaci
patients-age-computed = vypočteno z data narození
patients-book = Naplánovat
patients-none = Žádný pacient neodpovídá filtru.
patients-shown-all = Zobrazeno všech { $n }
patients-shown-range = Zobrazeno { $from }-{ $to } z { $total }
patients-paged = Stránkovat
patients-page-prev = ‹ Předchozí
patients-page-next = Další ›
patients-show-all = Zobrazit vše (+{ $n })

## MDT calendar (S-2)

calendar-title = Kalendář MDT
# The week shown, Monday to Friday: "19. 10. až 23. 10. 2026".
calendar-week-range = { $d1 }. { $m1 }. až { $d2 }. { $m2 }. { $year }
calendar-week-prev = ‹ Předchozí týden
calendar-week-next = Další týden ›
calendar-today = Dnes
# After a day's label when it is today; the leading space is part of the text.
calendar-today-suffix = { " · dnes" }
# "Neuroonkologický seminář 14:00-16:00"
calendar-seminar-hours = { $name } { $from }-{ $to }
calendar-seminar-neuro = Neuroonkologický seminář
calendar-start-mdt = Zahájit MDT ▸
calendar-slot-title = { $name }, RČ { $rc }. Dvojklik otevře případ
# A booked slot's accessible name: name, birth number (or the gap wording) and time.
calendar-slot-label = { $name }, RČ { $rc }, { $time }
calendar-slot-rc = RČ { $rc }
calendar-out-of-hours = mimo čas semináře
calendar-out-of-hours-title = Mimo čas semináře
calendar-out-of-hours-mark = mimo
calendar-free-slot = Volný termín { $time }
calendar-free-slot-oot = Volný termín { $time }, mimo čas semináře
calendar-free-oot-text = { $time } · mimo čas semináře
calendar-book-here = Naplánovat sem
calendar-full-day-shown = Zobrazen celý den
calendar-trimmed-shown = Zobrazeno { $from }-{ $to }: hodiny semináře a hodina navíc
calendar-trim = Jen kolem semináře
calendar-full-day = Zobrazit celý den
calendar-oot-note = Šrafované sloty jsou mimo čas semináře; lze je obsadit, když se jednání protáhne.
calendar-month-prev = Předchozí měsíc
calendar-month-next = Další měsíc
calendar-year = Rok
# A mini month day's accessible name when it is today: "2026-10-16, dnes".
calendar-day-today = { $iso }, dnes
calendar-unscheduled = Nenaplánovaní ({ $n })
# Accessible name of the waiting list (not shown).
calendar-unscheduled-list = Nenaplánovaní pacienti
# $name is the patient in bold, $cancel the "Zrušit" button.
calendar-pick-hint = Vyberte volný slot pro { $name } v kalendáři. { $cancel }
calendar-pick-cancel = Zrušit
calendar-drag-hint = Přetáhněte pacienta do volného slotu. Přetažením obsazeného slotu sem termín uvolníte.
calendar-rc-label = RČ:
calendar-picked = Vybráno
calendar-move = Přesunout
calendar-book = Naplánovat
calendar-all-booked = Všichni pacienti mají termín.
calendar-lock-why = Případ je na tomto termínu projednán; termín patří k záznamu MDT, nelze ho uvolnit ani přesunout.
calendar-book-refused = Termín plánuje lékař nebo koordinátorka.
calendar-unschedule-refused = Termín uvolňuje lékař nebo koordinátorka.
calendar-pick-first = Nejdřív vyberte pacienta vpravo.
calendar-booked = { $name } naplánován(a) na { $slot }
# $warn is the server's warning or "mimo čas semináře".
calendar-booked-warn = { $name } naplánován(a) na { $slot } ({ $warn })
calendar-slot-freed = Termín pro { $name } uvolněn
calendar-card-patient = Pacient
calendar-card-rc = RČ:
calendar-card-age = Věk:
calendar-card-slot = Termín:
calendar-card-owner = Vlastník:
calendar-card-diagnosis = Diagnóza
calendar-card-question = Otázka pro MDT
calendar-card-question-missing = Výslovná otázka neuvedena v dostupné dokumentaci.
# Suffixes of the diagnosis line and the brief; their leading space or punctuation is part of the text.
calendar-card-edited-suffix = { " (upraveno lékařem)" }
calendar-card-dx-context = ; { $context }
calendar-card-verify-suffix = { " [ověřit čtení]" }
# The start of the case brief, cut for the card.
calendar-card-brief = { $text }…
calendar-card-open = Otevřít případ
calendar-card-move = Změnit termín
calendar-card-unschedule = Uvolnit termín
calendar-card-close = Zavřít kartu
calendar-attendance-none = nezadáno
calendar-attendance-pick = vyberte…
calendar-attendance-add = + další
calendar-attendance-remove = − odebrat
calendar-attendance-remove-row = Odebrat řádek { $dept }

## Starting an MDT from the calendar

start-mdt-dialog-start = Zahájit MDT
start-mdt-dialog-attendance = Přítomní lékaři
start-mdt-heading-start = Zahájit MDT · { $day }
start-mdt-heading-attendance = Přítomní · { $day }
start-mdt-order = Pořadí ({ $n })
start-mdt-present = Přítomní lékaři ({ $n })
start-mdt-applies-day = Platí pro všechny případy tohoto dne; lze upravit i během MDT.
start-mdt-done = Hotovo
start-mdt-go = Zahájit MDT ▸
start-mdt-refused = MDT zahajuje lékař nebo koordinátorka.

## Tasks (S-6)

tasks-title = Moje úlohy
tasks-subtitle = Úlohy ze schválených závěrů MDT napříč pacienty · uživatel { $user }
# Accessible name of the scope buttons (not shown).
tasks-scope-label = Které úlohy zobrazit
tasks-scope-mine = Moje
tasks-scope-all = Všechny
tasks-scope-mdt = Úlohy po MDT
tasks-list-title = Úlohy
tasks-open-count = { $n ->
    [one] { $n } otevřená
    [few] { $n } otevřené
    [many] { $n } otevřených
   *[other] { $n } otevřených
}
tasks-done = Hotovo
tasks-done-group = Hotovo ({ $n })
# A task's second line: case ID, who does it, and the due date.
tasks-row-meta = { $id } · { $who } · { $due }
tasks-due-until = do { $due }
tasks-due-none = termín doplní člověk
tasks-due-computed = vypočteno ze závěru
tasks-due-manual = zadal(a) { $name }
tasks-due-manual-unknown = zadal(a) člověk
tasks-due-with-source = { $date } ({ $source })
tasks-open-case = Otevřít případ
tasks-no-open = Žádné otevřené úlohy.
tasks-empty-mine = Pro uživatele { $user } zatím žádné úlohy. Úlohy vzniknou po schválení závěru MDT v případu pacienta. Úlohy ostatních ukáže přepínač „Všechny“.
tasks-empty-all = Zatím žádné úlohy. Úlohy vzniknou po schválení závěru MDT v případu pacienta.
tasks-mdt-title = Úlohy po MDT
tasks-mdt-by-patient = podle pacienta, všechny případy
tasks-digest-send = Odeslat přehled e-mailem
tasks-digest-sent = Přehled odeslán (jen počet a odkaz)
# A patient's group in "Úlohy po MDT": case ID and surname only.
tasks-group-title = { $id } · { $surname }
tasks-col-task = Úloha
tasks-col-state = Stav
tasks-col-who = Odpovídá
tasks-col-due = Termín
tasks-state-done = hotovo
tasks-state-open = otevřená
tasks-from-draft = z návrhu asistenta, potvrdil(a) { $name }
tasks-from-conclusion = Ze závěru: „{ $quote }“
tasks-draft-chip = návrh asistenta, nepotvrzeno
tasks-timing-in-conclusion = v závěru: „{ $timing }“
tasks-sugg-confirm = Potvrdit
tasks-sugg-dismiss = Zamítnout
tasks-sugg-confirmed = Úloha potvrzena
tasks-sugg-dismissed = Návrh zamítnut
tasks-wait-doctor = čeká na potvrzení lékařem
tasks-mdt-none = Zatím žádné úlohy. Vzniknou po schválení závěru MDT; návrhy asistenta potvrzuje lékař.
# $sentence is tasks-waiting with the current count.
tasks-mdt-mail-note = E-mail koordinátorce obsahuje jen větu „{ $sentence }“ a odkaz do aplikace, žádná jména, ID případů ani diagnózy: upozornění nese odkaz, ne zdravotní údaje. Počet zahrnuje i nepotvrzené návrhy asistenta.
# The digest's only sentence: a count, never names or diagnoses.
tasks-waiting = { $n ->
    [one] { $n } úloha čeká
    [few] { $n } úlohy čekají
    [many] { $n } úloh čeká
   *[other] { $n } úloh čeká
} na vyřízení
tasks-mails-title = Odeslané e-maily
tasks-mails-none = Po schválení závěru MDT se koordinátorce odešle e-mail jen s ID případu a odkazem; přehled úloh odejde jen s počtem a odkazem.
tasks-mail-digest-subject = ✉ GLIDE MDT - přehled úloh
tasks-mail-digest-to = Komu: { $to } · odeslal(a) { $by }
tasks-mail-digest-note = Jen počet úloh a odkaz, žádná jména ani diagnózy. Ukázková interní adresa; v maketě se nic neodesílá.
tasks-mail-approval-subject = ✉ MDT - nové úlohy ke zpracování
tasks-mail-approval-to = Komu: { $to }
# [0] keeps the old page's wording for an approval without tasks.
tasks-mail-approval-body = K případu { $id } { $n ->
    [0] byly přiřazeny { $n } nové úlohy
    [one] byla přiřazena { $n } nová úloha
    [few] byly přiřazeny { $n } nové úlohy
    [many] bylo přiřazeno { $n } nových úloh
   *[other] bylo přiřazeno { $n } nových úloh
}. Otevřete zabezpečenou aplikaci GLIDE MDT a potvrďte převzetí.
tasks-mail-link = Odkaz:
tasks-mail-example-address = (ukázková interní adresa)
tasks-mail-approval-note = E-mail obsahuje jen ID případu a odkaz, žádné zdravotní údaje.

## Staff (S-8)

staff-title = Personál pracoviště
staff-subtitle = Lékaři podle pracovišť pro docházku na MDT a výběr uživatele
staff-reset = Obnovit výchozí (smyšlená jména)
staff-reset-done = Obnoven výchozí personál (smyšlená jména)
staff-edit-note = Odebraná osoba zůstává v historii: v dřívějších závěrech, docházce a záznamu přístupů se jméno nemění. Přejmenování se promítne do otevřených úloh, vlastníků případů a docházky, kterou ještě neuzamklo schválení závěru.
staff-read-note = Seznam upravuje koordinátorka MDT nebo správce systému; lékař ho jen čte.
staff-coordinator-title = Koordinátorka onkologických MDT
staff-col-shown = Zobrazí se
staff-field-pre = Titul před
staff-field-pre-placeholder = např. doc. MUDr.
staff-field-sur = Příjmení
staff-field-sur-placeholder = Příjmení
staff-field-post = Titul za
staff-field-post-placeholder = např. Ph.D.
staff-field-fn = Funkce
staff-field-fn-placeholder = např. primář
# A person's field: "Příjmení: MUDr. Veselá".
staff-field-of = { $field }: { $name }
# A field of a department's new person: "Příjmení (nová osoba, Radiologie)".
staff-new-field = { $field } (nová osoba, { $dept })
staff-people-count = { $n ->
    [one] { $n } osoba
    [few] { $n } osoby
    [many] { $n } osob
   *[other] { $n } osob
}
staff-fn-suffix = · { $fn }
staff-remove-dept = Odebrat pracoviště
staff-remove-dept-label = Odebrat pracoviště { $name }
staff-remove-label = Odebrat { $name }
staff-remove-title = Odebrat
staff-nobody = Zatím nikdo.
staff-new-person = Nová osoba
staff-add = + Přidat
staff-add-dept-title = Přidat pracoviště
staff-dept-placeholder = Název pracoviště
staff-dept-label = Název nového pracoviště
staff-add-dept = + Přidat pracoviště
staff-audit-note = Změny seznamu se zapisují do záznamu přístupů (kdo co změnil, bez údajů o pacientech).
staff-surname-required = Příjmení nelze smazat; osobu odeberte tlačítkem ✕
staff-name-taken = { $name } už v seznamu je
staff-fill-surname = Vyplňte příjmení
staff-added = Přidáno: { $name }
staff-removed = Odebráno: { $name } (v historii zůstává)
staff-fill-dept = Vyplňte název pracoviště
staff-dept-taken = Pracoviště { $name } už v seznamu je

## Administration (S-7)

admin-only = Administrace je jen pro správce systému.
admin-title = Administrace
admin-subtitle = Záznam přístupů ke všem případům · jen pro správce systému
admin-demo-title = Ukázková data
admin-reset = Obnovit ukázková data
admin-reset-what = Vrátí případy, závěry, úlohy, docházku, personál a záznam přístupů do výchozího stavu.
admin-reset-done = Data obnovena, stránka se znovu načte.
admin-col-time = Čas
admin-col-user = Uživatel
admin-col-case = Případ
admin-col-action = Akce
admin-log-empty = Zatím žádné přístupy.
admin-edits-title = Úpravy lékařů ({ $n })
admin-edits-note = Původní hodnota zůstává; seznam se jen doplňuje
admin-edit-confirmed = potvrdil(a) návrh otázky
admin-edit-draft-unchanged = Návrh asistenta beze změny:
admin-edit-reverted = vráceno na původní
admin-edit-orig = Původně:
admin-edit-new = Nově:
admin-edits-none = Zatím žádné úpravy. Záznam vznikne, když lékař v případu pacienta opraví údaj tužkou ✎.
admin-footer = Role správce zde slouží jen k náhledu záznamu; v reálné aplikaci by správce neměl přístup ke klinickému obsahu případů. V reálné aplikaci by byl na serveru nemocnice, neměnný a s dobou uchování podle předpisů FNO.
