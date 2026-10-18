# Slovak, translated from the Czech source catalog (i18n/cs/lists.ftl, docs/design/I18N.md): the list screens. Patient
# list (S-1), MDT calendar (S-2), tasks (S-6), administration (S-7) and staff (S-8). Message IDs are the same as in Czech.
# The catalog holds interface text only: no patient names or examples, synthetic or not.
#
## Glossary (Czech -> Slovak), for clinician review
# neuvedeno v dostupné dokumentaci -> neuvedené v dostupnej dokumentácii (fixed wording, pending clinician sign-off)
# ověřit čtení -> overiť čítanie (fixed wording, pending clinician sign-off)
# RČ (rodné číslo) -> RČ (rodné číslo)
# Vlastník -> Vlastník (the doctor responsible for the case)
# Odesílající pracoviště -> Odosielajúce pracovisko
# Diagnóza -> Diagnóza
# Příští MDT -> Najbližšie MDT
# Podáno -> Podané
# Stav: Nový, Naplánován, Vyžaduje pozornost, Připraven, Projednán, Uzavřen
#   -> Nový, Naplánovaný, Vyžaduje pozornosť, Pripravený, Prerokovaný, Uzavretý
# Neuroonkologický seminář -> Neuroonkologický seminár
# Zahájit MDT -> Začať MDT
# Naplánovat / Uvolnit termín -> Naplánovať / Uvoľniť termín
# Přítomní lékaři -> Prítomní lekári
# Úloha, Odpovídá, Termín -> Úloha, Zodpovedá, Termín
# návrh asistenta -> návrh asistenta
# Závěr MDT -> Záver MDT
# Personál pracoviště -> Personál pracoviska
# Titul před / za -> Titul pred / za
# primář -> primár
# Záznam přístupů -> Záznam prístupov
# Ukázková data -> Ukážkové údaje

## Shared by the list screens

# Case statuses (code -> label); the code is shown when the server sends one this catalog does not know.
lists-status-new = Nový
lists-status-scheduled = Naplánovaný
lists-status-attention = Vyžaduje pozornosť
lists-status-ready = Pripravený
lists-status-done = Prerokovaný
lists-status-closed = Uzavretý
lists-status-unknown = { $code }
# Short weekday names, as the calendar and the slot labels write them.
lists-weekday-sun = Ne
lists-weekday-mon = Po
lists-weekday-tue = Ut
lists-weekday-wed = St
lists-weekday-thu = Št
lists-weekday-fri = Pi
lists-weekday-sat = So
# "Št 22. 10."; $date is the day and month formatted by Intl.
lists-day-label = { $weekday } { $date }
# "Št 22. 10. 2026"
lists-day-year = { $day } { $year }
# A booked MDT slot: "Št 22. 10. 2026 · 14:00-14:10".
lists-slot-text = { $day } { $year } · { $from }-{ $to }
lists-slot-none = nenaplánované
# The fixed wording for a gap in the documentation (CLAUDE.md); on screen a "-" carries it as its tooltip.
lists-gap-not-stated = neuvedené v dostupnej dokumentácii
lists-dialog-close = Zavrieť
lists-dialog-cancel = Zrušiť

## Patient database (S-1)

patients-title = Databáza pacientov
patients-subtitle = Pacienti odoslaní na prerokovanie na neuroonkologickom MDT
patients-new = + Nový pacient
patients-search-placeholder = Hľadať ID, meno, diagnózu
patients-search-label = Hľadať
patients-submitted-from = Podané od
patients-submitted-to = do
patients-count = { $shown } z { $total }
patients-clear-filters = Zrušiť filtre ({ $n })
patients-col-id = ID
patients-col-patient = Pacient
patients-col-rc = RČ
patients-col-age = Vek
patients-col-diagnosis = Diagnóza
patients-col-owner = Vlastník
patients-col-dept = Odosielajúce pracovisko
patients-col-slot = Najbližšie MDT
patients-col-status = Stav
patients-col-submitted = Podané
patients-column-resize = Ťahaním zmeníte šírku stĺpca
# The column filter popover's accessible name: "Filter Stav".
patients-filter-dialog = Filter { $column }
patients-filter-all = (Všetko)
patients-filter-done = Hotovo
patients-verify-identity = overiť identitu
patients-synthetic = syntetický pacient
patients-synthetic-tooltip = Fiktívny pacient vytvorený tímom CodeBridge (vlastná syntetická dokumentácia), nie z údajov FNO
patients-rc-missing = Rodné číslo neuvedené v dostupnej dokumentácii
patients-age-computed = vypočítané z dátumu narodenia
patients-book = Naplánovať
patients-none = Filtru nezodpovedá žiadny pacient.
patients-shown-all = Zobrazené všetky ({ $n })
patients-shown-range = Zobrazené: { $from }-{ $to } z { $total }
patients-paged = Stránkovať
patients-page-prev = ‹ Predchádzajúca
patients-page-next = Ďalšia ›
patients-show-all = Zobraziť všetko (+{ $n })

## MDT calendar (S-2)

calendar-title = Kalendár MDT
# The week shown, Monday to Friday: "19. 10. až 23. 10. 2026".
calendar-week-range = { $d1 }. { $m1 }. až { $d2 }. { $m2 }. { $year }
calendar-week-prev = ‹ Predchádzajúci týždeň
calendar-week-next = Ďalší týždeň ›
calendar-today = Dnes
# After a day's label when it is today; the leading space is part of the text.
calendar-today-suffix = { " · dnes" }
# "Neuroonkologický seminár 14:00-16:00"
calendar-seminar-hours = { $name } { $from }-{ $to }
calendar-seminar-neuro = Neuroonkologický seminár
calendar-start-mdt = Začať MDT ▸
calendar-slot-title = { $name }, RČ { $rc }. Dvojklik otvorí prípad
# A booked slot's accessible name: name, birth number (or the gap wording) and time.
calendar-slot-label = { $name }, RČ { $rc }, { $time }
calendar-slot-rc = RČ { $rc }
calendar-out-of-hours = mimo času seminára
calendar-out-of-hours-title = Mimo času seminára
calendar-out-of-hours-mark = mimo
calendar-free-slot = Voľný termín { $time }
calendar-free-slot-oot = Voľný termín { $time }, mimo času seminára
calendar-free-oot-text = { $time } · mimo seminára
calendar-book-here = Naplánovať sem
calendar-full-day-shown = Zobrazený celý deň
calendar-trimmed-shown = Zobrazené { $from }-{ $to }: hodiny seminára a hodina navyše
calendar-trim = Len okolo seminára
calendar-full-day = Zobraziť celý deň
calendar-oot-note = Šrafované sloty sú mimo času seminára; možno ich obsadiť, keď sa rokovanie predĺži.
calendar-month-prev = Predchádzajúci mesiac
calendar-month-next = Ďalší mesiac
calendar-year = Rok
# A mini month day's accessible name when it is today: "2026-10-16, dnes".
calendar-day-today = { $iso }, dnes
calendar-unscheduled = Nenaplánovaní ({ $n })
# Accessible name of the waiting list (not shown).
calendar-unscheduled-list = Nenaplánovaní pacienti
# $name is the patient in bold, $cancel the "Zrušiť" button.
calendar-pick-hint = Vyberte voľný slot pre { $name } v kalendári. { $cancel }
calendar-pick-cancel = Zrušiť
calendar-drag-hint = Presuňte pacienta do voľného slotu. Presunutím obsadeného slotu sem termín uvoľníte.
calendar-rc-label = RČ:
calendar-picked = Vybrané
calendar-move = Presunúť
calendar-book = Naplánovať
calendar-all-booked = Všetci pacienti majú termín.
calendar-lock-why = Prípad je na tomto termíne prerokovaný; termín patrí k záznamu MDT, nemožno ho uvoľniť ani presunúť.
calendar-book-refused = Termín plánuje lekár alebo koordinátorka.
calendar-unschedule-refused = Termín uvoľňuje lekár alebo koordinátorka.
calendar-pick-first = Najprv vyberte pacienta vpravo.
calendar-booked = { $name } naplánovaný(-á) na { $slot }
# $warn is the server's warning or "mimo času seminára".
calendar-booked-warn = { $name } naplánovaný(-á) na { $slot } ({ $warn })
calendar-slot-freed = Termín pre { $name } uvoľnený
calendar-card-patient = Pacient
calendar-card-rc = RČ:
calendar-card-age = Vek:
calendar-card-slot = Termín:
calendar-card-owner = Vlastník:
calendar-card-diagnosis = Diagnóza
calendar-card-question = Otázka pre MDT
calendar-card-question-missing = Výslovná otázka neuvedená v dostupnej dokumentácii.
# Suffixes of the diagnosis line and the brief; their leading space or punctuation is part of the text.
calendar-card-edited-suffix = { " (upravené lekárom)" }
calendar-card-dx-context = ; { $context }
calendar-card-verify-suffix = { " [overiť čítanie]" }
# The start of the case brief, cut for the card.
calendar-card-brief = { $text }…
calendar-card-open = Otvoriť prípad
calendar-card-move = Zmeniť termín
calendar-card-unschedule = Uvoľniť termín
calendar-card-close = Zavrieť kartu
calendar-attendance-none = nezadané
calendar-attendance-pick = vyberte…
calendar-attendance-add = + ďalší
calendar-attendance-remove = − odobrať
calendar-attendance-remove-row = Odobrať riadok { $dept }

## Starting an MDT from the calendar

start-mdt-dialog-start = Začať MDT
start-mdt-dialog-attendance = Prítomní lekári
start-mdt-heading-start = Začať MDT · { $day }
start-mdt-heading-attendance = Prítomní · { $day }
start-mdt-order = Poradie ({ $n })
start-mdt-present = Prítomní lekári ({ $n })
start-mdt-applies-day = Platí pre všetky prípady tohto dňa; dá sa upraviť aj počas MDT.
start-mdt-done = Hotovo
start-mdt-go = Začať MDT ▸
start-mdt-refused = MDT začína lekár alebo koordinátorka.

## Tasks (S-6)

tasks-title = Moje úlohy
tasks-subtitle = Úlohy zo schválených záverov MDT naprieč pacientmi · používateľ { $user }
# Accessible name of the scope buttons (not shown).
tasks-scope-label = Ktoré úlohy zobraziť
tasks-scope-mine = Moje
tasks-scope-all = Všetky
tasks-scope-mdt = Úlohy po MDT
tasks-list-title = Úlohy
tasks-open-count = { $n ->
    [one] { $n } otvorená
    [few] { $n } otvorené
    [many] { $n } otvorených
   *[other] { $n } otvorených
}
tasks-done = Hotovo
tasks-done-group = Hotovo ({ $n })
# A task's second line: case ID, who does it, and the due date.
tasks-row-meta = { $id } · { $who } · { $due }
tasks-due-until = do { $due }
tasks-due-none = termín doplní človek
tasks-due-computed = vypočítané zo záveru
tasks-due-manual = zadal(a) { $name }
tasks-due-manual-unknown = zadal(a) človek
tasks-due-with-source = { $date } ({ $source })
tasks-open-case = Otvoriť prípad
tasks-no-open = Žiadne otvorené úlohy.
tasks-empty-mine = Pre používateľa { $user } zatiaľ žiadne úlohy. Úlohy vzniknú po schválení záveru MDT v prípade pacienta. Úlohy ostatných ukáže prepínač „Všetky“.
tasks-empty-all = Zatiaľ žiadne úlohy. Úlohy vzniknú po schválení záveru MDT v prípade pacienta.
tasks-mdt-title = Úlohy po MDT
tasks-mdt-by-patient = podľa pacienta, všetky prípady
tasks-digest-send = Odoslať prehľad e-mailom
tasks-digest-sent = Prehľad odoslaný (len počet a odkaz)
# A patient's group in "Úlohy po MDT": case ID and surname only.
tasks-group-title = { $id } · { $surname }
tasks-col-task = Úloha
tasks-col-state = Stav
tasks-col-who = Zodpovedá
tasks-col-due = Termín
tasks-state-done = hotovo
tasks-state-open = otvorená
tasks-from-draft = z návrhu asistenta, potvrdil(a) { $name }
tasks-from-conclusion = Zo záveru: „{ $quote }“
tasks-draft-chip = návrh asistenta, nepotvrdený
tasks-timing-in-conclusion = v závere: „{ $timing }“
tasks-sugg-confirm = Potvrdiť
tasks-sugg-dismiss = Zamietnuť
tasks-sugg-confirmed = Úloha potvrdená
tasks-sugg-dismissed = Návrh zamietnutý
tasks-wait-doctor = čaká na potvrdenie lekárom
tasks-mdt-none = Zatiaľ žiadne úlohy. Vzniknú po schválení záveru MDT; návrhy asistenta potvrdzuje lekár.
# $sentence is tasks-waiting with the current count.
tasks-mdt-mail-note = E-mail koordinátorke obsahuje len vetu „{ $sentence }“ a odkaz do aplikácie, žiadne mená, ID prípadov ani diagnózy: upozornenie nesie odkaz, nie zdravotné údaje. Počet zahŕňa aj nepotvrdené návrhy asistenta.
# The digest's only sentence: a count, never names or diagnoses.
tasks-waiting = { $n ->
    [one] { $n } úloha čaká
    [few] { $n } úlohy čakajú
    [many] { $n } úlohy čaká
   *[other] { $n } úloh čaká
} na vybavenie
tasks-mails-title = Odoslané e-maily
tasks-mails-none = Po schválení záveru MDT sa koordinátorke odošle e-mail len s ID prípadu a odkazom; prehľad úloh odíde len s počtom a odkazom.
tasks-mail-digest-subject = ✉ GLIDE MDT - prehľad úloh
tasks-mail-digest-to = Komu: { $to } · odoslal(a) { $by }
tasks-mail-digest-note = Len počet úloh a odkaz, žiadne mená ani diagnózy. Ukážková interná adresa; v ukážke sa nič neodosiela.
tasks-mail-approval-subject = ✉ MDT - nové úlohy na spracovanie
tasks-mail-approval-to = Komu: { $to }
# [0] keeps the old page's wording for an approval without tasks.
tasks-mail-approval-body = K prípadu { $id } { $n ->
    [0] bolo priradených { $n } nových úloh
    [one] bola priradená { $n } nová úloha
    [few] boli priradené { $n } nové úlohy
    [many] bolo priradených { $n } nových úloh
   *[other] bolo priradených { $n } nových úloh
}. Otvorte zabezpečenú aplikáciu GLIDE MDT a potvrďte prevzatie.
tasks-mail-link = Odkaz:
tasks-mail-example-address = (ukážková interná adresa)
tasks-mail-approval-note = E-mail obsahuje len ID prípadu a odkaz, žiadne zdravotné údaje.

## Staff (S-8)

staff-title = Personál pracoviska
staff-subtitle = Lekári podľa pracovísk na dochádzku na MDT a výber používateľa
staff-reset = Obnoviť predvolené (vymyslené mená)
staff-reset-done = Obnovený predvolený personál (vymyslené mená)
staff-edit-note = Odobratá osoba zostáva v histórii: v skorších záveroch, dochádzke a zázname prístupov sa meno nemení. Premenovanie sa prejaví v otvorených úlohách, vlastníkoch prípadov a dochádzke, ktorú ešte neuzamklo schválenie záveru.
staff-read-note = Zoznam upravuje koordinátorka MDT alebo správca systému; lekár ho len číta.
staff-coordinator-title = Koordinátorka onkologických MDT
staff-col-shown = Zobrazí sa
staff-field-pre = Titul pred
staff-field-pre-placeholder = napr. doc. MUDr.
staff-field-sur = Priezvisko
staff-field-sur-placeholder = Priezvisko
staff-field-post = Titul za
staff-field-post-placeholder = napr. PhD.
staff-field-fn = Funkcia
staff-field-fn-placeholder = napr. primár
# A person's field: "Priezvisko: MUDr. Veselá".
staff-field-of = { $field }: { $name }
# A field of a department's new person: "Priezvisko (nová osoba, Rádiológia)".
staff-new-field = { $field } (nová osoba, { $dept })
staff-people-count = { $n ->
    [one] { $n } osoba
    [few] { $n } osoby
    [many] { $n } osoby
   *[other] { $n } osôb
}
staff-fn-suffix = · { $fn }
staff-remove-dept = Odobrať pracovisko
staff-remove-dept-label = Odobrať pracovisko { $name }
staff-remove-label = Odobrať { $name }
staff-remove-title = Odobrať
staff-nobody = Zatiaľ nikto.
staff-new-person = Nová osoba
staff-add = + Pridať
staff-add-dept-title = Pridať pracovisko
staff-dept-placeholder = Názov pracoviska
staff-dept-label = Názov nového pracoviska
staff-add-dept = + Pridať pracovisko
staff-audit-note = Zmeny zoznamu sa zapisujú do záznamu prístupov (kto čo zmenil, bez údajov o pacientoch).
staff-surname-required = Priezvisko nemožno vymazať; osobu odoberte tlačidlom ✕
staff-name-taken = { $name } už je v zozname
staff-fill-surname = Vyplňte priezvisko
staff-added = Pridané: { $name }
staff-removed = Odobrané: { $name } (v histórii zostáva)
staff-fill-dept = Vyplňte názov pracoviska
staff-dept-taken = Pracovisko { $name } už je v zozname

## Administration (S-7)

admin-only = Administrácia je len pre správcu systému.
admin-title = Administrácia
admin-subtitle = Záznam prístupov ku všetkým prípadom · len pre správcu systému
admin-demo-title = Ukážkové údaje
admin-reset = Obnoviť ukážkové údaje
admin-reset-what = Vráti prípady, závery, úlohy, dochádzku, personál a záznam prístupov do východiskového stavu.
admin-reset-done = Údaje obnovené, stránka sa znova načíta.
admin-col-time = Čas
admin-col-user = Používateľ
admin-col-case = Prípad
admin-col-action = Akcia
admin-log-empty = Zatiaľ žiadne prístupy.
admin-edits-title = Úpravy lekárov ({ $n })
admin-edits-note = Pôvodná hodnota zostáva; zoznam sa len dopĺňa
admin-edit-confirmed = potvrdil(a) návrh otázky
admin-edit-draft-unchanged = Návrh asistenta bez zmeny:
admin-edit-reverted = vrátené na pôvodné
admin-edit-orig = Pôvodne:
admin-edit-new = Novo:
admin-edits-none = Zatiaľ žiadne úpravy. Záznam vznikne, keď lekár v prípade pacienta opraví údaj ceruzkou ✎.
admin-footer = Rola správcu tu slúži len na náhľad záznamu; v reálnej aplikácii by správca nemal prístup ku klinickému obsahu prípadov. V reálnej aplikácii by bol na serveri nemocnice, nemenný a s dobou uchovávania podľa predpisov FNO.
