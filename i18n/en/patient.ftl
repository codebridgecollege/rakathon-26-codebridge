# English, the patient detail screen (S-3): header, brief, MDT question, alerts, timeline and the tabs.
# Czech (i18n/cs/patient.ftl) is the source; this file has the same message IDs and placeholders. Interface text
# only: no patient names, quotes or values. Assistant text and source evidence stay in the original language.

# Glossary (Czech -> English), for review by an English-speaking clinician in one place:
#   neuvedeno v dostupné dokumentaci -> not stated in the available documentation (fixed wording, pending sign-off)
#   ověřit čtení -> verify reading (fixed wording, pending sign-off)
#   zápor v dokumentu -> negated in document
#   pozorování asistenta -> assistant's observation
#   RČ / rodné číslo -> Birth no. / birth number
#   pracoviště / odesílající pracoviště -> department / referring department
#   vlastník -> owner (the doctor responsible for the case)
#   Stručný souhrn -> Summary
#   Průběh onemocnění -> Disease course
#   Anamnéza -> History (Past medical, Family, Occupational, Social, Medication history; Allergies; Substance use)
#   Laboratoř / odběr / Referenční mez / Parametr -> Labs / sample (datum odběru -> collection date) / Reference range / Test
#   Upozornění: Chybí, Rozpor, Chronologie, Nejasné -> Alerts: Missing, Contradiction, Chronology, Unclear
#   Vzít na vědomí / Vyřešeno / Vrátit -> Acknowledge / Resolved / Reopen
#   Závěr MDT / koncept / návrh asistenta -> MDT conclusion / draft / assistant's draft
#   Navrhovaný postup -> Proposed management
#   Retrospektivní odchylky -> Retrospective deviations
#   doporučení (doporučený postup) -> guideline; síla doporučení -> strength (strong, moderate, weak, not stated)
#   Zobrazovací vyšetření -> Imaging; Systémová protinádorová léčba -> Systemic anticancer therapy
#   Patologie a molekulární vyšetření -> Pathology and molecular testing
#   stadium -> stage; Balíčkoroky -> Pack-years; Výkonnostní stav -> Performance status
#   OS / PFS / ORR -> overall survival / progression-free survival / objective response rate
#   Stav: Nový, Naplánován, Vyžaduje pozornost, Připraven, Projednán, Uzavřen -> New, Scheduled, Needs attention,
#     Ready, Discussed, Closed
#   Otevřít mimo tým -> Open outside team (break-the-glass access)
#   Přepis stránky / Cenzurovat -> Page transcript / Redact
#   maketa -> demo

## Fixed clinical wording (CLAUDE.md). Defined once as terms, so the screens cannot drift apart. A clinician signs
## off every translation of these.

-gap-not-stated = not stated in the available documentation
# Czech needs a feminine form for "otázka"; English has one form, kept as its own term so the IDs match.
-gap-not-stated-f = not stated in the available documentation
-trust-verify-reading = verify reading
-trust-negation = negated in document
-trust-observation = assistant's observation
-trust-observation-cap = Assistant's observation

patient-gap-not-stated = { -gap-not-stated }

## Dates and slots

patient-date-dmy = { $d }/{ $m }/{ $y }
patient-weekday-short = { $weekday ->
    [0] Sun
    [1] Mon
    [2] Tue
    [3] Wed
    [4] Thu
    [5] Fri
   *[6] Sat
}
patient-slot = { patient-weekday-short } { $d }/{ $m }/{ $y } · { $from }-{ $to }
patient-slot-none = not scheduled

## Doctor edits

patient-edit-button = Edit
patient-edit-tag = edited
patient-edit-tag-tooltip = Edited by { $by }, { $when }. Originally: { $orig }

## Certainty marks (tooltips of the small icons next to a fact)

patient-mark-ocr = Verify reading: { $note }
patient-mark-ocr-default = the text may have been misread
patient-mark-inferred = { -trust-observation-cap }, not stated explicitly in the document
patient-mark-planned = Planned, the document does not say it happened
patient-mark-planned-note = Planned, the document does not say it happened: { $note }
patient-mark-note = Assistant's note: { $note }
patient-mark-conflict = Contradiction between documents
patient-mark-conflict-note = Contradiction between documents: { $note }

## Certainty tags (written out, on lab values)

patient-tag-negated = { -trust-negation }
patient-tag-ocr = { -trust-verify-reading }
patient-tag-inferred = { -trust-observation }

## Sources

patient-src-open = Open source
patient-src-page = p.{" "}{ $page }
patient-src-quote = “{ $quote }”
patient-src-link-label = Open source, page { $page }: { $quote }
patient-src-list = { $label } ({ $n })
patient-src-list-label = Sources
patient-src-list-page = , p. { $page }:{" "}
patient-src-unavailable = The original document is not available in the demo.

## Page frame and tabs

patient-back = ‹ Patient database
patient-loading = Loading case documents…
patient-load-failed = The case documents could not be loaded.
patient-retry = Try again
patient-close = Close
patient-tab-overview = Overview
patient-tab-anamnesis = History
patient-tab-documents = Documents
patient-tab-labs = Labs
patient-tab-alerts = Alerts
patient-tab-next = Proposed management
patient-tab-dev = Retrospective deviations
patient-tab-prognosis = Prognosis

## Case header

patient-synthetic = synthetic patient
patient-synthetic-tooltip = Fictional patient created by the CodeBridge team (own synthetic documentation), not from FNO data
patient-header-rc = Birth no.:
patient-header-age = Age:
patient-header-verify-identity = Verify identity:
patient-header-name-note = Note:
patient-header-owner = Owner:
patient-header-dept = Department:
patient-header-next-mdt = Next MDT:
patient-action-schedule = Schedule
patient-action-reschedule = Reschedule
patient-action-start-mdt = Start MDT
patient-action-fhir = FHIR export
patient-action-report = Download report (PDF)

## Case status (lifecycle: New, Scheduled, Ready, Discussed, Closed; Needs attention is a side state)

patient-status-new = New
patient-status-scheduled = Scheduled
patient-status-attention = Needs attention
patient-status-ready = Ready
patient-status-done = Discussed
patient-status-closed = Closed
patient-status-menu = Case status
patient-status-tooltip = Click to show the status and its history.
patient-status-tooltip-last = Last changed by { $by }, { $when }. Click to show the history.
patient-status-reopen = Reopen ({ $status })
patient-status-close = Close case
patient-status-back = Return to: { $status }
patient-status-change = Change to: { $status }
patient-status-unapproved-draft = The case has an unapproved draft conclusion.
patient-status-help = Booking a slot sets Scheduled; approving the MDT conclusion sets Discussed.
patient-status-read-only = The status is changed by a doctor or the coordinator; the administrator can only read it.
patient-status-history = Status history
patient-status-no-history = No changes in this session.
patient-status-closed-toast = Case closed
patient-status-closed-slot-freed = Case closed, slot { $slot } freed
patient-status-reopened-toast = Case reopened
patient-status-changed-toast = Status changed to { $status }

## The MDT question

patient-question-title = Question for the MDT
patient-question-edit = Edit question
patient-question-none = Explicit question { -gap-not-stated-f }.
patient-question-confirm = Confirm question
patient-question-confirmed = Question confirmed
patient-question-draft = Assistant's draft
patient-question-draft-tip = The referral states no explicit question. The assistant drafted this one; it applies once a doctor confirms or edits it. { $basis }

## Edit dialog

patient-edit-dialog = Edit item
patient-edit-original = Originally (from the document or the assistant)
patient-edit-note = The edit is saved as a change by { $user } with the time. The original document does not change and the original value stays in the case history.
patient-edit-revert = Restore original
patient-edit-save = Save
patient-edit-saved = Edit saved
patient-edit-reverted = Original value restored

## Brief ("Summary")

patient-brief-title = Summary
patient-brief-from-list = Summary from the patient list, without source links.
patient-brief-source = Source: { $file }, { $pages } p.
patient-unprocessed = Not processed
patient-processed = Processed: { $parts }
patient-processed-documents = documents
patient-processed-missing = missing documents
patient-processed-labs = labs
patient-processed-anamnesis = history
patient-processed-findings = findings

## Missing-document signal (always on, CLAUDE.md) and the brief's alert panel

patient-missing-unchecked = ⚠ Missing documents not checked (case not processed)
patient-missing-failed = ⚠ Missing documents cannot be checked (loading failed)
patient-gaps-toggle = ⚠ Alerts
patient-gaps-toggle-missing = ⚠ Alerts · documents missing
patient-gaps-title = Alerts
patient-gaps-for-question = Alerts for the MDT question
patient-gaps-all = All alerts
patient-gaps-none = No active alerts.
patient-gaps-brief = Missing and unclear items in the summary
patient-gaps-documents = Missing and unclear documents

## Alerts (the assistant's observations; they never block the discussion)

patient-alerts-disclaimer = { -trust-observation-cap }, not a clinical conclusion. Alerts do not block the discussion.
patient-alerts-title = Alerts
patient-alerts-for-question = For the MDT question
patient-alerts-other = Other alerts
patient-alerts-more-contradiction = Contradiction, more
patient-alerts-more-missing = Missing, more
patient-alerts-more-chronology = Chronology, more
patient-alerts-more-unclear = Unclear, more
patient-alert-kind-missing = Missing
patient-alert-kind-contradiction = Contradiction
patient-alert-kind-chronology = Chronology
patient-alert-kind-unclear = Unclear
patient-alert-ack = Acknowledge
patient-alert-resolve = Resolved
patient-alert-reopen = Reopen
patient-alert-acked-by = Acknowledged by { $who }, { $when }
patient-alert-resolved-by = Resolved by { $who }, { $when }
patient-alert-reopened-by = Reopened by { $who }, { $when }
patient-alert-hist-ack = acknowledged
patient-alert-hist-resolved = resolved
patient-alert-hist-reopen = reopened
patient-alert-history = History ({ $n })
patient-alert-archive = Resolved / acknowledged ({ $n })

## Conclusion ("MDT conclusion"): approved conclusions are an append-only history

patient-concl-title = MDT conclusion
patient-concl-valid = Current conclusion no. { $n } · approved by { $by }, { $when }
patient-concl-earlier = Earlier conclusions ({ $n })
patient-concl-number = Conclusion no. { $n }
patient-concl-superseded = superseded
patient-concl-report = Approved report
patient-concl-none = Not discussed yet.
patient-concl-unapproved = Unapproved draft:
patient-concl-closed = The case is closed; reopen it from the status menu.
patient-concl-ident = { $name } · Birth no.: { $rc } · age: { $age } · ID { $id }

## Timeline ("Disease course")

patient-tl-title = Disease course
patient-tl-help = Events are sorted by date and marked with an icon and the category name. Several categories can be selected at once. Untick a category to hide it; All turns every category on or off. A dashed circle means planned. Click an event to open its source; the date and its uncertainty stay as documented.
patient-tl-categories = Event categories
patient-tl-all = All
# "of 16 events"; one event reads "of 1 event".
patient-tl-status = Showing { $shown } of { $all ->
    [one] { $all } event
   *[other] { $all } events
} · { $cats } of { $total } categories
patient-tl-region = Disease course timeline
patient-tl-undated = Undated
patient-tl-planned = {" "}· planned
patient-tl-all-hidden = All categories are hidden. Tick a category or All.
patient-tl-none-in-selection = No events recorded in the selected categories.
patient-cat-imaging = Imaging
patient-cat-systemic = Systemic anticancer therapy
patient-cat-medication = Other medication
patient-cat-mdt = MDT and decisions
patient-cat-surgery = Surgery and procedures
patient-cat-pathology = Pathology and molecular testing
patient-cat-radiotherapy = Radiotherapy
patient-cat-laboratory = Laboratory tests
patient-cat-clinical = Clinical status and other

## Overview: oncology summary and current state

patient-onco-title = Oncology summary
patient-onco-pin-help = The icon next to a date marks the same category as on the timeline. Hover or keyboard focus shows the category name. A dashed circle means planned.
patient-onco-region = Oncology summary, scrollable content
# The TNM in the headline is the stage at diagnosis, never the current stage (CLAUDE.md).
patient-onco-ptnm = (pTNM at diagnosis, { $month })
patient-onco-start = start of treatment
patient-onco-planned-suffix = , planned
patient-state-title = Current patient status
patient-state-subjective = Subjective:
patient-state-objective = Objective:
patient-state-tkp = BP/HR
patient-state-tt = Temp
patient-state-ps = PS (ECOG)
patient-state-exam-undated = date not stated

## "+ Upload document" (a demonstration dialog: it stores nothing)

patient-upload-title = Upload document
patient-upload-heading = Upload document · { $id }
patient-upload-drop = Drag a PDF, DOCX or a photo of the report here
patient-upload-pick = Choose files
patient-upload-done-label = Uploaded:
patient-upload-done = readability check done, the document will be added to the list. The demo stores nothing.
patient-upload-note = After upload a readability check runs; if the quality is poor, the app asks for a better copy.

## Break-the-glass (a doctor outside the case's team, with a stated reason)

patient-bg-title = Open outside team
patient-bg-heading = Open outside team · { $id }
patient-bg-intro = You are not on this case's team. A doctor outside the team can open the case by stating a reason.
patient-bg-reason = Reason for access (10 to 500 characters)
patient-bg-reason-invalid = State the reason for access (10 to 500 characters).
patient-bg-note = The access is written to the access log with its reason and is valid for a limited time.
patient-bg-back = Back to the list
patient-bg-granted = Access outside the team written to the access log

# English, three tabs of the patient detail screen (S-3): Documents, History (anamnesis) and Labs. Interface text
# only: document titles, quotes, lab names, values, units, ranges and codes are content and never come from here.
# Shared wording (gap, sources, certainty tags) is in patient.ftl.

## History (anamnesis)

patient-anam-title = History
patient-anam-section = { $key ->
    [OA] Past medical history
    [RA] Family history
    [PA] Occupational history
    [SA] Social history
    [FA] Medication history
    [AA] Allergies
    [abusus] Substance use
    [EA] Epidemiological history
   *[preventive] Preventive screening
}
# The chip in front of a drug warning (an interaction or contraindication the documents state).
patient-anam-warning = Caution
patient-anam-pack-years = Pack-years:{" "}
# The icon legend under the card; each label follows its icon.
patient-anam-legend-label = Icons:
patient-anam-legend-ocr = { -trust-verify-reading }
patient-anam-legend-planned = planned
patient-anam-legend-conflict = contradiction between documents
patient-anam-legend-observation = { -trust-observation }
patient-anam-legend-tail = Hover for details. Medications are for information; they are checked on admission.

## Documents

patient-docs-title = Documents ({ $n })
patient-docs-title-filtered = Documents ({ $shown } of { $n })
patient-docs-source = Source:{" "}
patient-docs-source-uploaded = { $n ->
    [one] { $n } uploaded PDF
   *[other] { $n } uploaded PDFs
}
patient-docs-source-pages = { $n ->
    [one] , { $n } page
   *[other] , { $n } pages
}
# The page count of the documentation is not known: a gap dash sits between these two.
patient-docs-source-pages-none = ,{" "}
patient-docs-source-pages-none-unit = {" "}pages
patient-docs-upload = + Upload document
patient-docs-missing-originals = Originals missing
patient-docs-search = Search documents
patient-docs-clear-filters = Clear filters ({ $n })
patient-docs-col-document = Document
patient-docs-col-type = Type
patient-docs-col-date = Date
patient-docs-col-pages = Pages
patient-docs-col-readability = Readability
patient-docs-col-year = Year
patient-docs-year-none = undated
patient-docs-readability = { $code ->
    [good] Readable
    [fair] Partly readable
   *[poor] Poorly readable
}
# After a document the PDF only cites ("cited in an outpatient report"): its original is not in the documentation.
patient-docs-original-missing = , original missing
patient-docs-open = Open
patient-docs-none-match = No document matches the filter.
patient-docs-readability-hint = Hover over the label to see why the readability was rated so.

## Column filter (Excel-style list of a column's values)

patient-docs-filter-label = Filter { $title }
patient-docs-filter-all = (All)
patient-docs-filter-done = Done

## Reading a document without AI (the pipeline panel; the result is the assistant's reading, never the case data)

patient-docs-pipe-run = Read without AI
patient-docs-pipe-rerun = Read again without AI
patient-docs-pipe-busy = Reading…
patient-docs-pipe-failed = Reading failed ({ $code ->
    [start_failed] did not start
    [stalled] did not finish
    [encrypted] the PDF is encrypted
    [not_pdf] the file is not a readable PDF
    [unreadable_pdf] the file is not a readable PDF
    [too_many_pages] too many pages
    [page_too_large] a page is too large
    [pipeline_off] processing is not switched on
    [page_reader_unreachable] the service does not respond
   *[other] service error
}).
patient-docs-pipe-reading = Reading (
patient-docs-pipe-queued = queued
patient-docs-pipe-reading-end = )…
patient-docs-pipe-readability = :{" "}readability{" "}
patient-docs-pipe-verify = { $n ->
    [one] , { $n } spot to verify
   *[other] , { $n } spots to verify
}
# A missing count from the server is a gap dash between the parts, never an assumed 0.
patient-docs-pipe-labs = , lab values { $n } (to verify{" "}
patient-docs-pipe-labs-end = )
patient-docs-pipe-diff = ; against the prepared data{" "}
patient-docs-pipe-diff-same = {" "}matching,{" "}
patient-docs-pipe-diff-verify = {" "}to verify
patient-docs-pipe-diff-silent = { $n } differing without a mark
patient-docs-pipe-diff-missing = { $n } not found

## Labs

patient-labs-title-values = Labs · Values from the document
patient-labs-title-trend = Labs · Trend over time
patient-labs-draws = { $n ->
    [one] { $n } sample from the documentation
   *[other] { $n } samples from the documentation
}
patient-labs-trend-hint = Click a value to open its line in the source, click a date for the lab sheet.
patient-labs-col-test = Test
patient-labs-col-value = Value
patient-labs-col-unit = Unit
patient-labs-col-range-short = Ref. range
patient-labs-col-range = Reference range
patient-labs-col-date = Collection date
patient-labs-col-source = Source
# Tooltip of a value or collection date: the quoted line it rests on.
patient-labs-src-tip = Source: “{ $quote }”
patient-labs-value-label = { $name } { $date }: { $value } { $unit }, open source
patient-labs-pick-hint = Click a test row · green band = reference range
patient-labs-chart-label = Trend over time, { $name }
patient-labs-chart-range = ref. { $range }
patient-labs-chart-needs-two = A chart needs at least two values.
patient-labs-sources = Sources
# The source button of a value row, with a plain space as the old table printed it.
patient-labs-row-source = p. { $page }
patient-labs-all-values = For all values:{" "}
patient-labs-head-date = Collection date:{" "}
patient-labs-head-source = Source:{" "}
patient-labs-head-source-page = , p.{" "}{ $page }
patient-labs-head-click-name = . Click a test name to open its line in the source.
patient-labs-no-trend = The trend over time is shown only where the documentation has at least two dated samples; here there is one set without a collection date.

# English, the patient screen's "Proposed management" and "Retrospective deviations" tabs and the guideline drawer:
# the proposal box, the guideline layer (F-27 in docs/design/PRODUCT.md), its literature and the deviation tables.
# Interface text only: guideline names, quotes, sections, grades as printed, facts and the assistant's reasons are
# content from the data and never come from here.

## Proposal box

patient-proposal-heading = Proposed next steps
patient-proposal-tag = doctor's proposal, not an MDT decision
patient-proposal-tag-tooltip = Entered by { $by }, { $when }
patient-proposal-empty = What the referring doctor proposes for this MDT to decide; the assistant does not propose management.
patient-proposal-add = add

## Guideline layer

patient-guide-heading = Guidelines on the next steps
patient-guide-layer-toggle = guideline layer
patient-guide-off = Off.
patient-guide-loading = Loading guidelines from the server…
patient-guide-load-failed = The guidelines could not be loaded.
patient-guide-retry = Try again
patient-guide-order-note = Sorted by the strength the guideline itself states, not a ranking of options for this patient.
patient-guide-group-oncology = Oncology
patient-guide-group-other = Other specialties (comorbidities)
patient-guide-footer = { -trust-observation-cap }, the MDT decides. Quotes verbatim from the guidelines named; click to show the reason, sources and original grade.
patient-guide-not-retrieved = Sources not retrieved ({ $n })

# The common strength scale (round 19); the code comes from packages/domain/src/guideline.ts.
patient-guide-tier = { $code ->
    [strong] strong
    [moderate] moderate
    [weak] weak
   *[unstated] not stated
}
# A statement graded more than once: from its strongest to its weakest tier.
patient-guide-tier-range = { $from } to { $to }
patient-guide-tier-chip = strength: { $tier }
patient-guide-tier-tooltip = Strength of recommendation on a common scale, converted from the guideline's own grade; the original grade is in the expanded entry
patient-guide-clamp-note = (quote shortened, expand)
patient-guide-why = Why:
patient-guide-no-source = (source not found)
patient-guide-original-grade = original grade:
patient-guide-grade-none = not stated
patient-guide-grade-chapter-text = chapter text, no grade
# ČOS and NCCN categories sort as "not stated"; the opened entry says what they mean.
patient-guide-grade-categories = (categories { $cats }: evidence and expert consensus, not strength of recommendation)
patient-guide-page-printed = p. { $page }
patient-guide-page-pdf = PDF p. { $page }
patient-guide-abstract-only = abstract only
patient-guide-open = open in guideline
# The tooltip of "open in guideline" ends with the page, or says the statement comes from the abstract.
patient-guide-cite-page = p. { $page }
patient-guide-cite-abstract = abstract

## Literature (PubMed), labelled as literature, never as a recommendation

patient-guide-lit-heading = Literature from PubMed · not a recommendation
patient-guide-lit-intro = For situations where guidelines are not enough. The PubMed search uses clinical terms only, never patient data
patient-guide-lit-queries = ; queries:{" "}
patient-guide-lit-intro-end = .
patient-guide-quoted = “{ $text }”
patient-guide-lit-chip = literature, not a recommendation
patient-guide-lit-author = { $author } et al.
patient-guide-pmid = PMID { $pmid }

## Guideline drawer

patient-guide-drawer-label = Guideline
patient-guide-drawer-close = Close
patient-guide-drawer-page = PDF page { $page }
patient-guide-drawer-printed = (printed { $page })
patient-guide-drawer-abstract-only = abstract only, the full text was not available
patient-guide-drawer-open-pdf = Open PDF online
patient-guide-drawer-open-pdf-page = Open PDF online (p. { $page })
patient-guide-drawer-publisher = Publisher's source
patient-guide-drawer-grade = Original grade:
patient-guide-drawer-relation = Relation to the record:
patient-guide-drawer-edition = Edition { $year }, { $range }
patient-guide-drawer-applies = Applies because:
patient-guide-drawer-no-text = The page text is not available.

## Deviations tab

patient-dev-layer-off = The guideline layer is off.
patient-dev-loading = Loading the data for deviations…
patient-dev-more = More comparisons of past decisions with guidelines ({ $n })
patient-dev-no-past = There are no guideline passages for past decisions.

# The eight columns of both deviation tables.
patient-dev-col-finding = Issue / finding
patient-dev-col-area = Area
patient-dev-col-severity = Severity
patient-dev-col-guideline = Guideline
patient-dev-col-year = Year
patient-dev-col-passage = Guideline text
patient-dev-col-quote = Quote from the documentation
patient-dev-col-consequence = Possible clinical consequence

patient-dev-findings-heading = Deviations and related findings
patient-dev-findings-none = No findings have been processed for this case.
# Czech "zjištění" has one form for every count; English "finding(s)" is written to read for any count.
patient-dev-findings-count = { $n ->
    [one] { $n } finding
   *[other] { $n } findings
} · no action required
patient-dev-findings-intro = { -trust-observation-cap } from the available documentation. A documentation gap or a treatment adjustment for toxicity does not by itself show incorrect care.
patient-dev-findings-region = Table of deviations and related findings
patient-dev-open-guideline = Open guideline
# The link next to the risk basis of a finding: the table of the EASL guideline the basis cites.
patient-dev-risk-basis-link = Table 14, PDF p. 42
patient-dev-consequence-note = Possible impact / limit of the assessment, not a documented complication.
patient-dev-findings-footnote = Severity is not clinically assessed. Quotes are the original wording of the sources; summaries and possible consequences are the assistant's observation. The current state cannot be derived automatically from a historical or undated record.

patient-dev-retro-heading = Retrospective deviations
patient-dev-retro-sub = Overview with no required rating or confirmation
patient-dev-retro-intro = { -trust-observation-cap }: records compared with guidelines. Listing a row does not confirm a deviation.
patient-dev-retro-region = Table of retrospective deviations
patient-dev-retro-footnote = Severity and clinical consequence are not set in the records; missing data are not filled in. Earlier recorded assessments are read-only. Quotes come from the edition valid at the time of the decision; online updates during the year were not checked.
patient-dev-group-surgery = Surgery
patient-dev-group-systemic = Systemic therapy
patient-dev-doc-page = , p. { $page }

## The guideline edition valid at a past decision

patient-dev-edition-range = valid from { $from } to { $to }
patient-dev-edition-until-now = present
patient-dev-past-label = Guideline valid at the time of the decision
patient-dev-past-not-checked = No passage was found in the edition valid at the time of the decision; a quote from a later edition is not shown.
patient-dev-past-edition = edition { $year }
patient-dev-past-chosen-for = edition chosen for { $date } (procedure or start of treatment per the documentation)
patient-dev-past-not-found = the edition valid at the time of the decision has no such passage
patient-dev-past-more = Another passage from the same edition ({ $n })
patient-dev-open-pdf = open PDF of edition { $year }
patient-dev-open-pdf-page = open PDF of edition { $year }, { $page }

# English, the Prognosis tab of the patient screen and its two drawers (the source list and the similarity
# explanation). The tab shows study results for similar patient groups that the assistant's search found; it is no
# individual prognosis. Message IDs start with "patient-pg-". Study titles, arms, populations, values, quotes and the
# server's warnings are content and never come from here.

## The tab

patient-pg-title = Prognosis
patient-pg-subtitle = Study results for similar patient groups · assistant's literature search
patient-pg-as-of = As of the MDT date { $date }
patient-pg-intro = A comparison of results from individual studies. The percentages describe the study groups; the individual prognosis is for the doctor to assess.
patient-pg-no-slot = The patient has no MDT slot. To search, first pick a day in the calendar.
patient-pg-schedule = Schedule MDT
patient-pg-loading-profile = Loading the profile and settings…
patient-pg-retry = Retry connection
patient-pg-not-configured = The search is not configured. Add the API key and the Astra model to the server .env.
patient-pg-profile-unavailable = Not enough structured data is available for this case as of the MDT date.

## The search profile (the structured facts the search was given)

patient-pg-profile-summary = { $n ->
    [one] Clinical profile for the search ({ $n } item)
   *[other] Clinical profile for the search ({ $n } items)
}
patient-pg-profile-note = The original structured synthetic data as of the MDT date. It holds no name, birth number or local text edits made in the browser.

## Search controls and states

patient-pg-loading-saved = Loading the saved search…
patient-pg-search-pending = Search in progress…
patient-pg-show-saved = Show saved search
patient-pg-search = Search studies · Astra
patient-pg-refresh = New search · 1 request
patient-pg-abbreviations = OS = overall survival · PFS = progression-free survival · ORR = objective response rate
patient-pg-busy = Astra is searching for studies and their results. The search may take several minutes.
patient-pg-saved-stale = The saved search is based on older data. Run a new search for the current profile.
# Followed by the time of the search as the server sends it.
patient-pg-found = { $n ->
    [one] Found { $n } population / arm ·{" "}
   *[other] Found { $n } populations / arms ·{" "}
}
patient-pg-found-saved = {" "}· saved search
patient-pg-found-cached = {" "}· from cache

## Errors the client raises itself (the prognosis server is a separate local server)

patient-pg-error-no-server = The search needs the local Prognosis server running (python3 prognosis/serve.py).
patient-pg-error-timeout = The request timed out. Another search will not start automatically.
patient-pg-error-request-failed = The request could not be completed.

## The study table

patient-pg-table-label = Studies and prognostic measures
patient-pg-col-study = Study / source
patient-pg-col-population = Population and treatment
patient-pg-col-similarity = Patient similarity
patient-pg-col-model = Found by model
# The short two-line headers of the OS columns; the full name is the column's accessible name.
patient-pg-col-os-6 = 6 mo
patient-pg-col-os-12 = 12 mo
patient-pg-col-os-36 = 3 yr
patient-pg-col-os-60 = 5 yr
patient-pg-col-os = OS
patient-pg-ep-os-6 = 6-month OS
patient-pg-ep-os-12 = 12-month OS
patient-pg-ep-os-36 = 3-year OS
patient-pg-ep-os-60 = 5-year OS
patient-pg-ep-pfs = Median PFS
patient-pg-ep-response = Response and duration of response
patient-pg-ep-toxicity = Severe toxicity and treatment discontinuation
patient-pg-ep-burden = Treatment burden
patient-pg-empty-pending = Waiting for results from Astra.
patient-pg-empty-no-rows = Astra returned no usable results. Check the search status and the sources.
patient-pg-empty-start = Studies appear once a search is run.
patient-pg-footnotes-label = Notes on the search
patient-pg-footnote = Each row keeps the source's population, treatment and start of follow-up. Missing values are not computed. The search does not guarantee that the available literature is complete. Similarity is an approximate match of the population, not a probability of survival. Extracted data need checking in the source.

## A study row

patient-pg-untitled = Untitled source
patient-pg-link-pubmed = PubMed { $id }
patient-pg-link-doi = DOI { $id }
patient-pg-verify = Model extraction · verify
patient-pg-sample-size = n = { $n }
patient-pg-time-origin = Start of follow-up:{" "}
patient-pg-unit-months = months
patient-pg-name-orr = ORR
patient-pg-name-dor-median = Median duration of response
patient-pg-name-grade3 = Grade ≥3
patient-pg-name-discontinuation = Discontinuation for toxicity
patient-pg-name-conflict-dor = Duration of response
patient-pg-name-conflict-grade3 = Grade ≥3 toxicity
patient-pg-conflicts = Differing extracted values ({ $n })
patient-pg-conflicts-note = Disputed values are not shown in the main cell. Check the population, arm and analysis.

## Similarity (an orientation score of the population match, not a survival probability)

patient-pg-percent = { $v } %
patient-pg-sim-label = Approximate population match
patient-pg-sim-coverage = Covers { $v } % of the data weight
patient-pg-sim-critical = Major difference: { $list }
patient-pg-sim-explain = Similarity explained
patient-pg-sim-variants = Differing match assessments
patient-pg-dim-histology = Histology
patient-pg-dim-stage = Stage
patient-pg-dim-biomarkers = Biomarkers
patient-pg-dim-treatment-line = Line of therapy
patient-pg-dim-prior-treatment = Prior treatment
patient-pg-dim-performance-status = Performance status
patient-pg-dim-brain-metastases = Brain metastases
patient-pg-dim-age = Age
patient-pg-status-match = match
patient-pg-status-mismatch = mismatch
patient-pg-status-unknown = not determined
patient-pg-status-partial = partial match

## The similarity drawer

patient-pg-panel-label = Prognosis · Similarity explained
patient-pg-panel-sub = Approximate match { $v } %
patient-pg-panel-disclaimer = A score of the match with the study population. It is neither a probability of survival nor a validated prognostic model.
patient-pg-panel-coverage = Covered by known data: { $v } % of the total weight
patient-pg-panel-patient = Patient:{" "}
patient-pg-panel-study = Study:{" "}
patient-pg-panel-critical = Major differences: { $list }

## The source list drawer

patient-pg-refs-label = Prognosis sources
patient-pg-refs-title = Sources ({ $n })
patient-pg-refs-no-quote = No passage was supplied.
patient-pg-close = Close

# English, the source viewer drawer (F-18 in docs/design/PRODUCT.md): the original page image with the quoted passage,
# the page switcher, zoom, the page transcription and the local redaction demo. Interface text only: document titles,
# file names, case IDs, quotes, the transcription, Tesseract's readings and redaction reasons are content from the
# data and never come from here.

## Drawer

patient-src-dialog = Original document
patient-src-loading-dialog = Source document
patient-src-loading-label = Source
patient-src-loading = Loading page…
patient-src-close = Close
patient-src-kind = Original document · page image
patient-src-page-of = page { $n } of { $of }
# $quote is a slot: the quote is content and sits in its own element.
patient-src-sought = Quote sought (p. { $page }): “{ $quote }”
# The page switcher's button; a plain space, as the old viewer had (patient-src-page keeps a no-break space).
patient-src-page-button = p. { $n }
patient-src-page-empty = {" "}(empty)
patient-src-page-empty-tooltip = empty page

## View switch and toolbar

patient-src-tabs = View
patient-src-tab-image = Page
patient-src-tab-text = Page transcript
patient-src-redact = Redact (demo)
patient-src-zoom-hit = Zoom to quote
patient-src-verify-count = { $n ->
    [one] { $n } spot to verify
   *[other] { $n } spots to verify
}
patient-src-engine-vision = Transcript: language model, check: Tesseract
patient-src-engine-tesseract = Transcript: Tesseract
patient-src-engine-conf = { $engine }, average Tesseract confidence { $conf } %

## How the quote was found

patient-src-note-not-found = Exact quote not found, the whole page is shown.
patient-src-note-text-only = The quote cannot be marked on the image; it is marked in the page transcript.
patient-src-note-image-only = The quote cannot be marked in the transcript; it is marked on the page image.
patient-src-note-spread = All words of the quote were found, but other words stand between them.
patient-src-note-approx = Quote found approximately ({ $pct } % match): the original quote comes from an older text conversion with reading errors.
patient-src-note-repeated = The quote appears on the page more than once; the first occurrence is highlighted.
patient-src-note-similar = A similar passage appears on the page more than once; the best match is highlighted, verify it.

## Page body

patient-src-empty-page = Empty page: there is no text on this page.
patient-src-img-alt = Page { $n } of document { $file }
patient-src-img-alt-redacted = Page { $n } after blacking out identifiers
patient-src-img-failed = The page image could not be loaded. The transcript is in the “Page transcript” tab.
patient-src-legend-text = Dotted: a number, date or stage that Tesseract read differently, with low confidence, or not at all (read only by the language model). Unmarked text is not verified; the page image decides.
patient-src-legend-image = Yellow: the quoted passage. Dashed: Dotted: a number, date or stage that Tesseract read differently, with low confidence, or not at all (read only by the language model). Unmarked text is not verified; the page image decides. Places read only by the language model are underlined in the transcript.
patient-src-unreadable = Unreadable characters ({ $n })
patient-src-transcriber-note = Transcriber's note, not printed text

# A dashed box on the image: why to check the token, then what the transcription has there ($reading is content).
patient-src-vbox = { $why }; transcript: { $reading }

## Why a token is marked "verify" ($tess and $layer are the engines' readings, content from the data)

patient-src-verify-only-vision = Read only by the language model; Tesseract read nothing here, verify
patient-src-verify-tess = Tesseract read: { $tess }, verify
patient-src-verify-tess-low = Tesseract read: { $tess } (confidence { $conf } %), verify
patient-src-verify-only-tesseract = The PDF text layer has nothing here, verify
patient-src-verify-only-layer = PDF text layer only: { $layer }, verify
patient-src-verify-layer-low = Tesseract is not sure (confidence { $conf } %), verify
patient-src-verify-layer = PDF text layer: { $layer }, verify

## Local redaction demo (docs/design/DATA-PROTECTION.md)

patient-src-redact-intro = A demo of local blacking out: this is how the page would go to a cloud language model.
# $reasons is a slot: the reasons are content and sit in their own element.
patient-src-redact-count = Blacked out { $n ->
    [one] { $n } spot
   *[other] { $n } spots
} ({ $reasons }) directly on the hospital server.
patient-src-redact-none = The check found nothing on this page; the check is incomplete, review the page before sending.
patient-src-redact-outro = Dates, diagnoses and findings remain, so the page is still personal data.

## Zoom

patient-src-zoom = Page zoom
patient-src-zoom-out = Zoom out
patient-src-zoom-out-tooltip = Zoom out (−)
patient-src-zoom-in = Zoom in
patient-src-zoom-in-tooltip = Zoom in (+)
patient-src-zoom-reset = Reset zoom
patient-src-zoom-reset-tooltip = Reset: fit width (0)
patient-src-zoom-fit = Fit width
patient-src-zoom-pct = { $z } %

# English, the FHIR R4 export of a case (the "FHIR export" dialog and the Bundle's own labels). FHIR is the HL7
# standard for exchanging health records as linked JSON records called resources. Message IDs start with
# "patient-fhir-". The Bundle translates only our labels and section titles (I18N.md, "PDF and FHIR"); names, quotes,
# codes and values come from the documents and never from this file.

## The dialog

patient-fhir-dialog-label = FHIR export
patient-fhir-dialog-title = FHIR R4 export · { $id }
# $n: the number of entries in the Bundle; $counts: "Patient 1, Observation 30, ..." (resource names are FHIR code).
patient-fhir-dialog-counts = The case as a FHIR R4 bundle (Bundle, { $n } { $n ->
        [one] entry
       *[other] entries
    }): { $counts }. Every item has a Provenance record with the document, page and quote. Everything is the assistant's draft, not verified by a doctor. The saved copy passed the official HL7 validator with no errors (fhir/README.md).
patient-fhir-dialog-identity = The export contains the patient's identity. In a pilot it would go through the hospital's FHIR interface, not as a file.
patient-fhir-download = Download JSON
patient-fhir-copy = Copy
patient-fhir-close = Close
patient-fhir-copied = Copied to clipboard
patient-fhir-copy-failed = Copying failed; select the text by hand

## The Bundle's labels and narrative. Composition text stays Czech while the content is Czech.

patient-fhir-device-name = CodeBridge MDT assistant (demo)
patient-fhir-device-type = Software for preparing MDT documents
patient-fhir-doc-text = Document { $file }
patient-fhir-patient-text = { $name }, { $id }
patient-fhir-source-ref = { $file }, p. { $page }
patient-fhir-provenance-text = Source: { $refs }
patient-fhir-activity-extracted = Extracted by the assistant from the document; not verified by a doctor
patient-fhir-activity-observation = Assistant's observation; not verified by a doctor
patient-fhir-activity-q-draft = MDT question drafted by the assistant from the quoted passages; not verified by a doctor
patient-fhir-date-in-doc = Date in the document: { $date }
patient-fhir-dated-line = { $date }: { $text }
patient-fhir-dx-text = { $code } { $text }
patient-fhir-dx-text-dated = { $code } { $text }, diagnosed { $date }
patient-fhir-issue-text = Assistant's observation: { $text }
patient-fhir-negated = Negation stated in the document.
patient-fhir-obs-clinical = Clinical finding
patient-fhir-obs-current = Current status
patient-fhir-obs-imaging = Imaging
patient-fhir-obs-histology = Histology
patient-fhir-lab-out-of-range = { $dir ->
        [high] Above
       *[low] Below
    } range (assessed by the assistant against the stated range)
patient-fhir-lab-as-written = In the document: { $value }
patient-fhir-lab-no-date = Collection date not stated in the available documentation.
patient-fhir-lab-text = { $name }: { $value } { $unit } (ref. { $range })
patient-fhir-gap = Not stated in the available documentation.
patient-fhir-comp-text = MDT documents, { $id }: assistant's draft, not verified by a doctor.
patient-fhir-comp-type = Documents for the multidisciplinary team (MDT)
patient-fhir-comp-title = MDT documents, { $id } (assistant's draft, not verified by a doctor)
patient-fhir-sec-question = Question for the MDT
patient-fhir-sec-summary = Summary
patient-fhir-sec-course = Disease course
patient-fhir-sec-conditions = Diagnosis and comorbidities
patient-fhir-sec-findings = Findings
patient-fhir-sec-treatment = Treatment
patient-fhir-sec-medication = Medication
patient-fhir-sec-drug-flags = Medication alerts
patient-fhir-sec-labs = Labs
patient-fhir-sec-observations = Assistant's observations
patient-fhir-sec-notes = Notes on the documents

## The MDT question as plain text (also for the report). A label in brackets says who wrote it.

patient-fhir-q-none = Explicit question not stated in the available documentation.
# $explicit: "yes" when the referral had its own question that a doctor changed, "no" when the doctor wrote it.
patient-fhir-q-edited = { $explicit ->
        [yes] [edited by a doctor]
       *[no] [added by a doctor]
    }
patient-fhir-q-confirmed = [assistant's draft, confirmed by { $by }, { $when }]
patient-fhir-q-draft = { $kind ->
        [document_purpose] [question from the purpose stated in the document, assistant's draft, not verified by a doctor]
       *[other] [question drafted by the assistant, not verified by a doctor]
    }
# One passage a drafted question rests on, quoted verbatim with its page.
patient-fhir-basis = { $role ->
        [purpose] Purpose in the document
       *[other] Based on
    }: “{ $quote }” ({ $file }, p. { $page }).

# English, "Import z NIS" (issue #22). See the Czech file for what each message is.

patient-action-nis = Import from NIS
patient-nis-title = Import from NIS
patient-nis-heading = Import from NIS · { $id }
patient-nis-source = Source: { $label } (FHIR R4, read only)
patient-nis-intro = Searches the NIS by birth number. Pick the right record yourself; nothing is merged automatically.
patient-nis-rc-label = Birth number
patient-nis-rc-placeholder = 123456/7890
patient-nis-rc-missing = The patient has no birth number in CodeBridge. Enter it; you then confirm the link by hand.
patient-nis-search-own = Search the NIS by the patient's birth number
patient-nis-search = Search the NIS
patient-nis-none = The NIS has no record with this birth number.
patient-nis-duplicates = The NIS holds several records for this birth number. Pick the right one; CodeBridge does not merge them.
patient-nis-truncated = Only part of the results from the NIS is shown.
patient-nis-hidden = { $n ->
        [one] The NIS returned { $n } record without the searched birth number; it is not shown.
       *[other] The NIS returned { $n } records without the searched birth number; they are not shown.
    }
patient-nis-record = NIS record { $id }
patient-nis-born = Born
patient-nis-gender-male = male
patient-nis-gender-female = female
patient-nis-identity-matches = birth number matches
patient-nis-identity-conflicts = birth number differs
patient-nis-identity-unverified = birth number cannot be checked
patient-nis-name-spelling = name written differently (no diacritics)
patient-nis-name-different = name differs
patient-nis-confirm = I confirm this is the same person
patient-nis-link = Link
patient-nis-linked = Linked to NIS record { $id }
patient-nis-linked-matches = The birth number matched.
patient-nis-linked-unverified = The birth number could not be checked; the user confirmed the link.
patient-nis-linked-name-differs = The birth number matched, the name differed; the user confirmed the link.
patient-nis-linked-by = Linked by { $name }, { $at }.
patient-nis-phase-note = Data from the NIS is not loaded yet; the link is the first step of the import.
patient-nis-unlink = Remove link
patient-nis-register-label = National register (demonstration):
