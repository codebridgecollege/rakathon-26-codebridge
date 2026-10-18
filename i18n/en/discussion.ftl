# English, the running MDT and the discussion record: the session bar (S-4), "MDT discussion" (S-5), the AI
# recording ("AI recording") and the report dialog with its PDF. Czech (i18n/cs/discussion.ftl) is the source; this
# file has the same message IDs and placeholders. Interface text only: no patient names, quotes or values.
# The glossary is at the top of i18n/en/patient.ftl; extra terms used here:
#   Projednání na MDT -> MDT discussion; AI záznam -> AI recording; Záznam z MDT -> MDT record
#   mluvčí -> speaker; přepis -> transcript; Podklady -> Source material; Přítomní -> Present
# The fixed clinical wording (the gap term, the report legend and its tags) needs sign-off from an English-speaking
# clinician before release (docs/design/I18N.md).

## Discussion card "MDT discussion" (S-5), session bar (S-4)

discussion-approve-wait-data = The case material is still loading, approve in a moment.
discussion-approve-wait-guide = The guidelines are still loading, approve in a moment.
discussion-approve-conflict-first = First decide on the concurrent edit of the draft (the bar in the MDT discussion section).
discussion-approve-recording-partial = Part of the recording could not be saved; speakers will be told apart from the saved audio.
discussion-approved = Conclusion approved
discussion-approved-with-tasks = Conclusion approved, { $n ->
    [one] 1 task sent
   *[other] { $n } tasks sent
} to the coordinator

discussion-title = MDT discussion
discussion-chip-approved = Conclusion approved
discussion-chip-draft = Draft, not approved
discussion-chip-valid = Current conclusion no. { $n }
discussion-chip-live = MDT in progress
# The version conflict bar: the server's message comes first, then the two choices.
discussion-conflict-theirs = Load the saved version
discussion-conflict-mine = Overwrite with my version
discussion-record = Discussion record
discussion-mode-manual = Manual notes
discussion-mode-ai = AI recording
discussion-mode-docs = Documents
discussion-mode-docs-count = Documents ({ $n })
discussion-docs-who = Documents can be uploaded and removed by a doctor or the MDT coordinator.
discussion-notes-label = Running notes
discussion-notes-placeholder = Notes from the discussion
discussion-steps = Next steps
discussion-steps-count = { $n ->
    [one] { $n } task
   *[other] { $n } tasks
}
discussion-steps-copy = Copy tasks
# One copied step: its text, who does it and the due date.
discussion-steps-copy-line = { $text } ({ $who }, by { $due })
discussion-steps-copied = Tasks copied
discussion-step-placeholder = Task
discussion-step-remove = Remove task
discussion-step-add = + Add task
discussion-present = Present ({ $n })
discussion-present-edit = Edit
discussion-present-copy = Copy
discussion-present-copied = List of those present copied
discussion-present-none = not entered
discussion-present-locked = Locked by the approval of the conclusion { $when }.
# $day is "Thu 22/10/2026"; $note says where the names come from.
discussion-present-day = Applies to the whole seminar ({ $day }). { $note }
discussion-present-case = The patient has no slot; attendance applies to this case only. { $note }
discussion-staff-fictional = The names are made up.
discussion-staff-list = Names from the Department staff list.
discussion-copy-failed = Copying is not available in this browser
discussion-approval = Approval of the conclusion
# Followed by the approving doctor's name in bold and the time.
discussion-approved-by = Approved on behalf of the team by
discussion-close-case = Close case
discussion-close-note = After the tasks are handled. A closed case disappears from Unscheduled; the status menu in the header reopens it.
discussion-new-version = New conclusion (replaces the current one)
discussion-new-version-note = The current conclusion stays in the history; the new one starts as a draft.
discussion-hint-has = The draft in the MDT conclusion field above is being approved.
discussion-hint-none = No conclusion written yet. A doctor writes it in the MDT conclusion field above; the assistant does not propose a conclusion.
discussion-hint-write = Write the conclusion
discussion-approve = Approve the MDT conclusion
discussion-approving = Approving…
# Followed by the doctor's name in bold.
discussion-approver = approving on behalf of the team:
discussion-approver-doctor = approved by the doctor
discussion-approve-join = Approving adds you to those present.
discussion-approve-note = Tasks and the report are created only by approval.
discussion-mails = Notification sent
discussion-mails-none = When a conclusion is approved without tasks, no notification is sent.
discussion-sugg-title = Suggested tasks from the approved conclusion
discussion-sugg-chip = Assistant's draft
discussion-sugg-draft = Assistant's draft, not confirmed
discussion-sugg-due = Due
discussion-sugg-timing = In the conclusion: “{ $timing }”
# A draft as a non-doctor sees it: who would do it, the due date and the timing the conclusion states.
discussion-sugg-who = Responsible: { $who }
discussion-sugg-due-text = due: { $due }
discussion-sugg-confirmed = Confirmed by { $by }, { $when }; task for { $who }, { $due }
discussion-sugg-due-on = due { $due }
discussion-sugg-superseded = Unconfirmed draft replaced by a newer approved conclusion.
discussion-sugg-dismissed = Dismissed by { $by }, { $when }
discussion-sugg-note = The assistant only suggests tasks from the text of the approved conclusion. A draft becomes a task only after a doctor confirms it.
discussion-sugg-note-doctor-only = Only a doctor can confirm or dismiss a draft.
# The conclusion draft under "MDT conclusion" (a doctor's field; the assistant never fills it).
discussion-concl-new-label = Draft of a new conclusion (replaces the current one only after approval)
discussion-concl-placeholder = Conclusion and further management, written by a doctor (draft, approved below in the MDT discussion section)
discussion-concl-draft-note = Draft, not yet approved. It is approved below in the MDT discussion section.
# The banner for an uploaded document that names another patient (never merged silently).
discussion-identity-label = Possibly another patient
discussion-identity-text = { $n ->
    [one] For 1 uploaded document
   *[other] For { $n } uploaded documents
} the name or birth number does not match the patient of the case. Check that the document belongs to this patient (MDT discussion, Documents).
# The session bar of the running MDT (S-4).
discussion-session-label = MDT in progress
discussion-session-title = MDT · { $day }
discussion-session-prev = Previous patient
discussion-session-next = Next patient
discussion-session-agenda = Order at the seminar
# A pill's accessible name: time, surname first, case ID, and whether the conclusion is approved.
discussion-session-pill = { $time } { $name }, { $id }
discussion-session-pill-approved = { $time } { $name }, { $id }, conclusion approved
discussion-session-present = Present ({ $n })
discussion-session-end = End MDT
discussion-session-ended = MDT ended
discussion-session-rec-stopped = The recording stopped when the MDT ended.
# The attendance dialog for a case without a slot.
discussion-attendance-no-slot = no slot
discussion-attendance-case-only = Applies to this case only.

## AI recording ("AI recording"); IDs start with "discussion-rec-"

discussion-rec-start = ● Start recording
discussion-rec-stop = ■ Stop recording
discussion-rec-probing = Checking the transcription server…
discussion-rec-unavailable = The AI recording is not available in this copy of the app (the transcription server is missing).
discussion-rec-unavailable-manual = The AI recording is not available in this copy of the app (the transcription server is missing). The conclusion can be written by hand.
discussion-rec-state-connecting = Connecting…
discussion-rec-state-off = Recording is off.
discussion-rec-state-recording = Recording.
discussion-rec-state-approved = Recording is running, this patient's conclusion is approved.
discussion-rec-state-off-agenda = Recording is running, the patient is not on the MDT agenda.
discussion-rec-state-running = Recording is running.
# $reason: the server's Czech message, a browser message about the microphone, or another catalog message.
discussion-rec-start-failed = The recording did not start: { $reason }
discussion-rec-token-failed = The server did not grant access to transcription (HTTP { $status })
discussion-rec-socket-failed = The connection to transcription failed repeatedly, the recording stopped.
# $reason: the speech service's own error text or message type, shown as received.
discussion-rec-stt-error = Transcription reports an error: { $reason }
discussion-rec-all-approved = All cases of the seminar have an approved conclusion, the recording stopped by itself.
discussion-rec-stopped-user-switch = The recording stopped when the user changed.
discussion-rec-diarizing = Telling speakers apart…
discussion-rec-purged = The audio was deleted without telling speakers apart.
# $reason: the server's purge reason, shown as received.
discussion-rec-purged-why = The audio was deleted without telling speakers apart ({ $reason }).
discussion-rec-pass-start-failed = Processing did not start.
discussion-rec-retry = Try again
discussion-rec-pass-failed = Telling speakers apart failed ({ $reason }).
discussion-rec-audio-gone = The audio was deleted, the live transcript remains.
discussion-rec-summarizing = Summarizing the discussion…
discussion-rec-summary-failed = The summary failed ({ $reason }).
discussion-rec-summary-chip = AI summary · draft
discussion-rec-summary-live-only = (from the live transcript, without telling speakers apart)
discussion-rec-transcript = Discussion transcript
# Speakers are numbered per case and pass, never named (naming them would need voiceprints).
discussion-rec-speaker = Speaker { $n }:
# The words the service has not committed yet.
discussion-rec-partial = { $text }…
discussion-rec-pill-case = Recording · { $id } · Stop
discussion-rec-pill-unsaved = Recording is running, the transcript is not saved anywhere · Stop
discussion-rec-pill-title = Stop recording
# Codes the server or the speaker pass report (REC_ERR_IDS in packages/domain/src/recording.ts).
discussion-rec-err-eleven-429 = the transcription service is overloaded
discussion-rec-err-eleven-5xx = transcription service error
discussion-rec-err-eleven-4xx = the transcription service rejected the recording
discussion-rec-err-network = the connection to the service failed
discussion-rec-err-audio-missing = the audio is missing
discussion-rec-err-audio-purged = the audio was deleted
discussion-rec-err-start-failed = processing did not start
discussion-rec-err-workflow-errored = processing failed
discussion-rec-err-workflow-terminated = processing was terminated
discussion-rec-err-workflow-incomplete = processing did not finish
discussion-rec-err-transcript-too-long = the transcript is too long to summarize
discussion-rec-err-azure-429 = the language model is overloaded
discussion-rec-err-azure-5xx = language model error
discussion-rec-err-azure-4xx = the language model rejected the request
discussion-rec-err-internal = internal error
discussion-rec-err-unknown = unknown error

## Report dialog and PDF; IDs start with "discussion-report-"

# The dialog "MDT record" behind the header's "Download report (PDF)" (F-31).
discussion-report-dialog-label = MDT record
discussion-report-dialog-title = MDT record · { $id }
discussion-report-close = Close
discussion-report-pick-label = Include in the PDF
# A tick in the dialog; the finding groups are also the headings of their sections in the report.
discussion-report-pick = { $key ->
    [summary] Oncology summary
    [anamnesis] History
    [clinical_finding] Clinical finding
    [imaging] Imaging
    [histology] Histology
    [past_treatment] Past treatment
   *[current_state] Current status
}
discussion-report-preview = Report preview
# $when is the approval time.
discussion-report-locked = The report is locked in its state at approval ({ $when }). Later changes are not carried into it; a change needs a new conclusion.
discussion-report-draft-note = The conclusion is not yet approved; the report downloads as a draft.
discussion-report-download = Download PDF
discussion-report-busy = Preparing the PDF…
# $message is one of the PDF errors below.
discussion-report-error = The PDF could not be created: { $message }
discussion-report-ready = The PDF is ready to download
discussion-report-failed = The PDF could not be created. Try again.
discussion-report-unavailable = PDF export is not available. Reload the page and try again.
discussion-report-no-content = The report content is missing.

# The printed report. It is a record: the wording stays as the old page printed it.
discussion-report-title = MDT record
discussion-report-meta = MDT date: { $date } · ID { $id }
discussion-report-meta-draft = MDT date: { $date } · ID { $id } · Draft
discussion-report-gap = { -gap-not-stated }
discussion-report-h-patient = Patient
discussion-report-h-present = Present
discussion-report-present-none = not entered
discussion-report-h-dx = Diagnosis
discussion-report-h-summary = Oncology summary
discussion-report-h-anamnesis = History
discussion-report-fa-warning = Warning:
discussion-report-h-question = Presented for
discussion-report-h-concl = Conclusion
discussion-report-concl-none = Not written yet.
discussion-report-h-steps = Next steps
discussion-report-step = { $text } · { $who } · by { $due }
discussion-report-steps-none = None.
discussion-report-h-dev = Deviations from guidelines
discussion-report-dev-none = No earlier assessment is recorded.
discussion-report-h-sources = Sources
discussion-report-source = { $title }, p. { $page }
discussion-report-source-quote = { $title }, p. { $page }: “{ $quote }”
discussion-report-legend = The data were compiled by the assistant from the listed documents; numbers in square brackets refer to the sources. [negated in document] = a negative recorded by the doctor; [verify reading] = text that may have been misread; [assistant's observation] = inferred by the assistant, not stated explicitly in the document; [edited by doctor] = the value was changed by a doctor, the source does not state it in this form.
discussion-report-signatures = Signature lines
discussion-report-signature = Name and signature
# Marks after a printed fact; the legend above explains them.
discussion-report-tag-negated = [negated in document]
discussion-report-tag-ocr = [verify reading]
discussion-report-tag-inferred = [assistant's observation]
discussion-report-tag-conflict = [conflict between documents]
discussion-report-tag-conflict-note = [conflict between documents: { $note }]
discussion-report-tag-planned = [planned, not verified]
discussion-report-tag-edited = [edited by doctor]
# What the report can say about the documents ("Source material").
discussion-report-h-basis = Source material
discussion-report-basis-failed = The case material could not be loaded from the server: the summary, history, findings and missing documents are not in this report. Missing documents cannot be checked.
discussion-report-basis-none = The case documentation has not been processed; the history and findings are not printed in the report. Missing documents not checked.
# $done lists the processed parts (discussion-report-basis-part), or discussion-report-basis-list-only.
discussion-report-basis-partial = { $synthetic ->
    [yes] Synthetic patient: processed
   *[no] Processed
} are { $done }; the history and findings are not printed in the report.
discussion-report-basis-part = { $key ->
    [documents] documents
    [alerts] missing documents
   *[labs] labs
}
discussion-report-basis-list-only = only data from the list
discussion-report-h-missing = Missing documents
discussion-report-h-missing-unclear = Missing and unclear documents
# The kind of a data gap that is not a missing document, before its text.
discussion-report-gap-kind = { $kind ->
    [missing] Missing
    [contradiction] Contradiction
    [chronology] Chronology
   *[unclear] Unclear
}
discussion-report-gap-src = ({ $file }, p. { $page })
# The PDF file's properties, its running head and page footer.
discussion-report-pdf-title = GLIDE MDT - MDT record - { $id }
discussion-report-pdf-subject = Record of the multidisciplinary team
discussion-report-pdf-running = GLIDE MDT | MDT record - { $id }
discussion-report-pdf-page = { $id } | Page { $i } / { $n }
