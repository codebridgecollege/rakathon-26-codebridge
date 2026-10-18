# English, translated from the Czech source catalog (i18n/cs/lists.ftl, docs/design/I18N.md): the list screens.
# Patient list (S-1), MDT calendar (S-2), tasks (S-6), administration (S-7) and staff (S-8). Message IDs are the same as in
# Czech. The catalog holds interface text only: no patient names or examples, synthetic or not.
#
## Glossary (Czech -> English), for clinician review
# neuvedeno v dostupné dokumentaci -> not stated in the available documentation (fixed wording, pending sign-off)
# ověřit čtení -> verify reading (fixed wording, pending sign-off)
# RČ (rodné číslo) -> Birth no. (birth number, the Czech national personal ID)
# Vlastník -> Owner (the doctor responsible for the case)
# Odesílající pracoviště -> Referring department
# Příští MDT -> Next MDT
# Podáno -> Submitted
# Stav: Nový, Naplánován, Vyžaduje pozornost, Připraven, Projednán, Uzavřen
#   -> New, Scheduled, Needs attention, Ready, Discussed, Closed
# Neuroonkologický seminář -> Neuro-oncology meeting
# Zahájit MDT -> Start MDT
# Naplánovat / Uvolnit termín -> Schedule / Free the slot
# Přítomní lékaři -> Doctors present
# Odpovídá -> Responsible
# návrh asistenta -> assistant's draft
# Závěr MDT -> MDT conclusion
# Záznam přístupů -> Access log
# primář -> head of department

## Shared by the list screens

# Case statuses (code -> label); the code is shown when the server sends one this catalog does not know.
lists-status-new = New
lists-status-scheduled = Scheduled
lists-status-attention = Needs attention
lists-status-ready = Ready
lists-status-done = Discussed
lists-status-closed = Closed
lists-status-unknown = { $code }
# Short weekday names, as the calendar and the slot labels write them.
lists-weekday-sun = Sun
lists-weekday-mon = Mon
lists-weekday-tue = Tue
lists-weekday-wed = Wed
lists-weekday-thu = Thu
lists-weekday-fri = Fri
lists-weekday-sat = Sat
# "Thu 22/10"; $date is the day and month formatted by Intl.
lists-day-label = { $weekday } { $date }
# "Thu 22/10 2026"
lists-day-year = { $day } { $year }
# A booked MDT slot: "Thu 22/10 2026 · 14:00-14:10".
lists-slot-text = { $day } { $year } · { $from }-{ $to }
lists-slot-none = not scheduled
# The fixed wording for a gap in the documentation (CLAUDE.md); on screen a "-" carries it as its tooltip.
lists-gap-not-stated = not stated in the available documentation
lists-dialog-close = Close
lists-dialog-cancel = Cancel

## Patient database (S-1)

patients-title = Patient database
patients-subtitle = Patients referred for discussion at the neuro-oncology MDT
patients-new = + New patient
patients-search-placeholder = Search ID, name, diagnosis
patients-search-label = Search
patients-submitted-from = Submitted from
patients-submitted-to = to
patients-count = { $shown } of { $total }
patients-clear-filters = Clear filters ({ $n })
patients-col-id = ID
patients-col-patient = Patient
patients-col-rc = Birth no.
patients-col-age = Age
patients-col-diagnosis = Diagnosis
patients-col-owner = Owner
patients-col-dept = Referring department
patients-col-slot = Next MDT
patients-col-status = Status
patients-col-submitted = Submitted
patients-column-resize = Drag to change the column width
# The column filter popover's accessible name: "Filter Status".
patients-filter-dialog = Filter { $column }
patients-filter-all = (All)
patients-filter-done = Done
patients-verify-identity = verify identity
patients-synthetic = synthetic patient
patients-synthetic-tooltip = Fictional patient created by the CodeBridge team (own synthetic documentation), not from FNO data
patients-rc-missing = Birth number not stated in the available documentation
patients-age-computed = calculated from the date of birth
patients-book = Schedule
patients-none = No patient matches the filter.
patients-shown-all = Showing all { $n }
patients-shown-range = Showing { $from }-{ $to } of { $total }
patients-paged = Paginate
patients-page-prev = ‹ Previous
patients-page-next = Next ›
patients-show-all = Show all (+{ $n })

## MDT calendar (S-2)

calendar-title = MDT calendar
# The week shown, Monday to Friday: "19/10 to 23/10/2026".
calendar-week-range = { $d1 }/{ $m1 } to { $d2 }/{ $m2 }/{ $year }
calendar-week-prev = ‹ Previous week
calendar-week-next = Next week ›
calendar-today = Today
# After a day's label when it is today; the leading space is part of the text.
calendar-today-suffix = { " · today" }
# "Neuro-oncology meeting 14:00-16:00"
calendar-seminar-hours = { $name } { $from }-{ $to }
calendar-seminar-neuro = Neuro-oncology meeting
calendar-start-mdt = Start MDT ▸
calendar-slot-title = { $name }, birth no. { $rc }. Double-click opens the case
# A booked slot's accessible name: name, birth number (or the gap wording) and time.
calendar-slot-label = { $name }, birth no. { $rc }, { $time }
calendar-slot-rc = Birth no. { $rc }
calendar-out-of-hours = outside meeting hours
calendar-out-of-hours-title = Outside meeting hours
calendar-out-of-hours-mark = outside
calendar-free-slot = Free slot { $time }
calendar-free-slot-oot = Free slot { $time }, outside meeting hours
calendar-free-oot-text = { $time } · outside hours
calendar-book-here = Schedule here
calendar-full-day-shown = Showing the whole day
calendar-trimmed-shown = Showing { $from }-{ $to }: meeting hours plus one hour
calendar-trim = Meeting hours only
calendar-full-day = Show the whole day
calendar-oot-note = Hatched slots are outside meeting hours; they can be booked when the meeting runs over.
calendar-month-prev = Previous month
calendar-month-next = Next month
calendar-year = Year
# A mini month day's accessible name when it is today: "2026-10-16, today".
calendar-day-today = { $iso }, today
calendar-unscheduled = Not scheduled ({ $n })
# Accessible name of the waiting list (not shown).
calendar-unscheduled-list = Patients not scheduled
# $name is the patient in bold, $cancel the "Cancel" button.
calendar-pick-hint = Choose a free slot for { $name } in the calendar. { $cancel }
calendar-pick-cancel = Cancel
calendar-drag-hint = Drag a patient into a free slot. Drag a booked slot here to free it.
calendar-rc-label = Birth no.:
calendar-picked = Selected
calendar-move = Move
calendar-book = Schedule
calendar-all-booked = All patients have a slot.
calendar-lock-why = The case was discussed in this slot; the slot belongs to the MDT record and cannot be freed or moved.
calendar-book-refused = Slots are booked by a doctor or the coordinator.
calendar-unschedule-refused = Slots are freed by a doctor or the coordinator.
calendar-pick-first = First choose a patient on the right.
calendar-booked = { $name } scheduled for { $slot }
# $warn is the server's warning or "outside meeting hours".
calendar-booked-warn = { $name } scheduled for { $slot } ({ $warn })
calendar-slot-freed = Slot for { $name } freed
calendar-card-patient = Patient
calendar-card-rc = Birth no.:
calendar-card-age = Age:
calendar-card-slot = Slot:
calendar-card-owner = Owner:
calendar-card-diagnosis = Diagnosis
calendar-card-question = Question for the MDT
calendar-card-question-missing = Explicit question not stated in the available documentation.
# Suffixes of the diagnosis line and the brief; their leading space or punctuation is part of the text.
calendar-card-edited-suffix = { " (edited by a doctor)" }
calendar-card-dx-context = ; { $context }
calendar-card-verify-suffix = { " [verify reading]" }
# The start of the case brief, cut for the card.
calendar-card-brief = { $text }…
calendar-card-open = Open case
calendar-card-move = Reschedule
calendar-card-unschedule = Free the slot
calendar-card-close = Close card
calendar-attendance-none = not entered
calendar-attendance-pick = choose…
calendar-attendance-add = + another
calendar-attendance-remove = − remove
calendar-attendance-remove-row = Remove row { $dept }

## Starting an MDT from the calendar

start-mdt-dialog-start = Start MDT
start-mdt-dialog-attendance = Doctors present
start-mdt-heading-start = Start MDT · { $day }
start-mdt-heading-attendance = Present · { $day }
start-mdt-order = Order ({ $n })
start-mdt-present = Doctors present ({ $n })
start-mdt-applies-day = Applies to all cases of this day; can also be changed during the MDT.
start-mdt-done = Done
start-mdt-go = Start MDT ▸
start-mdt-refused = The MDT is started by a doctor or the coordinator.

## Tasks (S-6)

tasks-title = My tasks
tasks-subtitle = Tasks from approved MDT conclusions across patients · user { $user }
# Accessible name of the scope buttons (not shown).
tasks-scope-label = Which tasks to show
tasks-scope-mine = Mine
tasks-scope-all = All
tasks-scope-mdt = Post-MDT tasks
tasks-list-title = Tasks
tasks-open-count = { $n } open
tasks-done = Done
tasks-done-group = Done ({ $n })
# A task's second line: case ID, who does it, and the due date.
tasks-row-meta = { $id } · { $who } · { $due }
tasks-due-until = by { $due }
tasks-due-none = due date to be set by a person
tasks-due-computed = calculated from the conclusion
tasks-due-manual = entered by { $name }
tasks-due-manual-unknown = entered by a person
tasks-due-with-source = { $date } ({ $source })
tasks-open-case = Open case
tasks-no-open = No open tasks.
tasks-empty-mine = No tasks yet for user { $user }. Tasks appear once an MDT conclusion is approved in the patient's case. The “All” switch shows other people's tasks.
tasks-empty-all = No tasks yet. Tasks appear once an MDT conclusion is approved in the patient's case.
tasks-mdt-title = Post-MDT tasks
tasks-mdt-by-patient = by patient, all cases
tasks-digest-send = Send overview by e-mail
tasks-digest-sent = Overview sent (count and link only)
# A patient's group in "Post-MDT tasks": case ID and surname only.
tasks-group-title = { $id } · { $surname }
tasks-col-task = Task
tasks-col-state = Status
tasks-col-who = Responsible
tasks-col-due = Due
tasks-state-done = done
tasks-state-open = open
tasks-from-draft = from the assistant's draft, confirmed by { $name }
tasks-from-conclusion = From the conclusion: “{ $quote }”
tasks-draft-chip = assistant's draft, not confirmed
tasks-timing-in-conclusion = in the conclusion: “{ $timing }”
tasks-sugg-confirm = Confirm
tasks-sugg-dismiss = Dismiss
tasks-sugg-confirmed = Task confirmed
tasks-sugg-dismissed = Draft dismissed
tasks-wait-doctor = awaiting a doctor's confirmation
tasks-mdt-none = No tasks yet. They appear once an MDT conclusion is approved; a doctor confirms the assistant's drafts.
# $sentence is tasks-waiting with the current count.
tasks-mdt-mail-note = The e-mail to the coordinator contains only the sentence “{ $sentence }” and a link to the app, no names, case IDs or diagnoses: the notification carries a link, not health data. The count includes unconfirmed drafts by the assistant.
# The digest's only sentence: a count, never names or diagnoses.
tasks-waiting = { $n ->
    [one] { $n } task is waiting
   *[other] { $n } tasks are waiting
} to be done
tasks-mails-title = Sent e-mails
tasks-mails-none = After an MDT conclusion is approved, the coordinator gets an e-mail with only the case ID and a link; the task overview goes out with only a count and a link.
tasks-mail-digest-subject = ✉ GLIDE MDT - task overview
tasks-mail-digest-to = To: { $to } · sent by { $by }
tasks-mail-digest-note = Only the task count and a link, no names or diagnoses. Sample internal address; the demo sends nothing.
tasks-mail-approval-subject = ✉ MDT - new tasks to handle
tasks-mail-approval-to = To: { $to }
# [0] keeps the old page's wording for an approval without tasks.
tasks-mail-approval-body = Case { $id } { $n ->
    [0] has { $n } new tasks assigned
    [one] has { $n } new task assigned
   *[other] has { $n } new tasks assigned
}. Open the secure GLIDE MDT app and confirm the handover.
tasks-mail-link = Link:
tasks-mail-example-address = (sample internal address)
tasks-mail-approval-note = The e-mail contains only the case ID and a link, no health data.

## Staff (S-8)

staff-title = Department staff
staff-subtitle = Doctors by department, for MDT attendance and the user picker
staff-reset = Reset to default (made-up names)
staff-reset-done = Default staff restored (made-up names)
staff-edit-note = A removed person stays in the history: earlier conclusions, attendance and the access log keep the name. A rename carries over to open tasks, case owners and attendance not yet locked by an approved conclusion.
staff-read-note = The list is edited by the MDT coordinator or the system administrator; doctors can only read it.
staff-coordinator-title = Oncology MDT coordinator
staff-col-shown = Shown as
staff-field-pre = Title before
staff-field-pre-placeholder = e.g. doc. MUDr.
staff-field-sur = Surname
staff-field-sur-placeholder = Surname
staff-field-post = Title after
staff-field-post-placeholder = e.g. Ph.D.
staff-field-fn = Function
staff-field-fn-placeholder = e.g. head of department
# A person's field: "Surname: MUDr. Veselá".
staff-field-of = { $field }: { $name }
# A field of a department's new person: "Surname (new person, Radiology)".
staff-new-field = { $field } (new person, { $dept })
staff-people-count = { $n ->
    [one] { $n } person
   *[other] { $n } people
}
staff-fn-suffix = · { $fn }
staff-remove-dept = Remove department
staff-remove-dept-label = Remove department { $name }
staff-remove-label = Remove { $name }
staff-remove-title = Remove
staff-nobody = Nobody yet.
staff-new-person = New person
staff-add = + Add
staff-add-dept-title = Add department
staff-dept-placeholder = Department name
staff-dept-label = Name of the new department
staff-add-dept = + Add department
staff-audit-note = Changes to the list are written to the access log (who changed what, no patient data).
staff-surname-required = The surname cannot be deleted; remove the person with the ✕ button
staff-name-taken = { $name } is already in the list
staff-fill-surname = Enter the surname
staff-added = Added: { $name }
staff-removed = Removed: { $name } (stays in the history)
staff-fill-dept = Enter the department name
staff-dept-taken = Department { $name } is already in the list

## Administration (S-7)

admin-only = Administration is for the system administrator only.
admin-title = Administration
admin-subtitle = Access log of all cases · system administrator only
admin-demo-title = Demo data
admin-reset = Reset demo data
admin-reset-what = Resets cases, conclusions, tasks, attendance, staff and the access log to their initial state.
admin-reset-done = Data reset; the page will reload.
admin-col-time = Time
admin-col-user = User
admin-col-case = Case
admin-col-action = Action
admin-log-empty = No access yet.
admin-edits-title = Doctors' edits ({ $n })
admin-edits-note = The original value stays; the list is append-only
admin-edit-confirmed = confirmed the drafted question
admin-edit-draft-unchanged = Assistant's draft unchanged:
admin-edit-reverted = reverted to the original
admin-edit-orig = Originally:
admin-edit-new = New:
admin-edits-none = No edits yet. An entry appears when a doctor corrects a value with the pencil ✎ in a patient's case.
admin-footer = Here the administrator role only previews the log; in a real application the administrator would have no access to the clinical content of cases. In a real application the log would be on the hospital's server, immutable, and kept as long as FNO's rules require.
