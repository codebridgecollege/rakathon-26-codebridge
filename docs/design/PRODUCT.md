# Product - CodeBridge

What we build, for whom, and in which order. FNO's own checklist
(Fakultní nemocnice Ostrava, the challenge owner) is in
[`REQUIREMENTS.md`](../agent/REQUIREMENTS.md); this doc adds our design on
top of it. An MDT (multidisciplinary team meeting) is a meeting where
specialists decide together on one patient's next steps; see
[`INDEX.md`](../agent/INDEX.md#what-an-mdt-meeting-is). Operating rules
are in [`CLAUDE.md`](../../CLAUDE.md).

## Purpose and vision

FNO's goal: "Nechceme další systém, ve kterém bude lékař hledat
informace. Chceme nástroj, který informace najde, uspořádá a připraví k
rozhodnutí." (We do not want another system where the doctor searches for
information. We want a tool that finds the information, organizes it, and
prepares it for the decision.) [FNO deck slide 9]

Vision: the referring doctor uploads a case's documents once. The
assistant reads them, flags what it could not read and what is missing,
and prepares a two-line brief, expandable sections, and a timeline, each
fact linked to its source. At the meeting the team works from that view
on a shared screen, records who was present and what was decided, and the
app produces the PDF report and the follow-up tasks. When the patient
returns, the new decision is added to the history and never replaces it.

Scope as Soňa set it: oncology only, and for the specialist content only
neuro-oncology [design-1 00:28:12, 00:41:13]; imaging viewing left out
[design-1 00:20:52]. Soňa and Juro agreed on text documents first, with
2D images at most later [design-2 00:03:23]. Soňa also said the
challenge is case summarization and the guideline comparison is an
add-on [chatgpt P 12:15].

## People

| Who | What they do | What they need from the app |
|---|---|---|
| Referring doctor, also the case owner | Registers the case with a question for the MDT, prepares it, presents it. Soňa: the owner and the referring doctor are the same person [design-1 00:38:30; chatgpt P 14:36]. | A condensed summary instead of reading about 12 documents [design-1 00:21:06]; missing documents flagged before the meeting [design-1 00:36:13]; for rare cases, help finding what other teams did [design-3 00:01:58]. |
| MDT members by specialty (neuro-oncology records neurosurgery and neuroanaesthesia at the start of the day [design-1 00:41:13]; radiologist and pathologist comment on their own reports [design-1 00:42:56]) | Read the case before or at the meeting, discuss, decide. | A two-line introduction [design-1 00:25:19], a click through to detail when they have questions [FNO spec], access the evening before [design-1 00:16:16], a comparison of the current and previous exam [design-1 00:43:21]. |
| MDT coordinator | Collects documents that arrive by email or from the NIS (the hospital information system) and uploads them [design-2 00:07:19, 00:08:19]; after the MDT tells the patient what comes next [design-1 00:33:10; chatgpt P 14:51]. | A non-binding checklist of what to upload [design-2 00:08:25]; a task list per MDT day [design-1 00:49:33]. |

## Decisions

All made by the team on 2026-10-16.

1. **Guideline layer is in scope, as an option.** Treatment suggestions
   and checking the MDT's plan against guidelines stay in as an optional
   layer the team can switch on or off. Where the line falls (what the
   assistant may suggest) is an open question to explore. `CLAUDE.md`
   allows it as the one exception to "does not recommend a treatment";
   see [Conflicts](#conflicts-with-claudemd).
2. **Listening live to the meeting is a stretch goal.**
3. **MDT decisions are an append-only history, like git.** A new decision
   supersedes an earlier one and never erases it; the MDT can discuss the
   same patient many times. This is the data model for repeated MDTs.
4. **The first UI is a throwaway static HTML mock**, kept simple, to check
   the direction.
5. **FNO's spec anchors the Demo tier**: the presentation app and the PDF
   report built from the fields ticked in it
   ([`REQUIREMENTS.md`](../agent/REQUIREMENTS.md)).
6. **The next mock is designed properly** (Juro's instruction, after the
   first feedback round): it includes the discussed features, Pitch and
   Later ones too, and follows healthcare app best practice. Much of the
   negative feedback came from asking for a simple first mock. The build
   tiers below stay as they are except where the feedback changed them.

## Flows

### Before the MDT: prepare a case

1. The referring doctor (or coordinator) adds the patient in the database,
   or opens an existing one (F-01).
2. They fill in the consultation request, including the question for the
   MDT, and upload the documents as PDFs (F-02).
3. The app checks each document for readability, wrong patient, and
   duplicates (F-03, F-04).
4. Before any text goes to the AI, the app replaces the name, birth
   number, and other identifiers with a case ID; identity stays in the
   app, because the MDT needs it (F-37).
5. The AI turns the free text into dated, structured facts (F-05, F-06).
6. The app shows missing, conflicting, and outdated information and the
   readiness checklist (F-07 to F-09). The case can go ahead with gaps.
7. The doctor puts the case in a slot on an MDT day (F-11); the status
   moves to Ready (F-12). Members can open it beforehand.

### During the MDT: present, discuss, record

1. The coordinator or chair sets the attendance once for the session
   (F-22).
2. The day agenda lists the cases in order (F-11). Opening a case shows
   the brief first (F-16).
3. The presenter expands items, the timeline, or a source as questions
   come (F-17 to F-20).
4. The team decides; someone types the conclusion for the explicitly
   selected patient (F-23), and a named doctor confirms it (F-24).
5. The status moves to Completed; the next case opens.

### After the MDT: report and tasks

1. The doctor ticks the fields for the report and exports the PDF (F-31).
2. Tasks for the coordinator are created from the confirmed conclusion
   (F-32).
3. New documents re-run the checks without overwriting the confirmed
   content (F-33). When the patient returns, the Patient Detail shows what
   changed since the last MDT (F-13).

## Screens

From Juro's sketches [paper-notes], Soňa's screens [chatgpt P 14:02,
P 16:01], her ChatGPT designs [ui-shot], and the first feedback round
(see [Feedback round 1](#feedback-round-1-2026-10-16)). The visual brief
names three main screens, Patient Database, MDT Calendar, and Patient
Workspace [chatgpt pt2]; the Patient Workspace is now split into Patient
Detail, MDT Presentation, and MDT Protocol.

Information flow [ui-shot 17.06.14 (3)]: Patient Database + MDT Calendar
(owner, referring workplace, status, filters) -> Patient Detail (full
anamnesis, documents, oncology timeline, MRI comparison) -> MDT
Presentation (30 to 60 second summary, clinical question, expandable
findings) -> MDT Protocol (anamnéza, onkologický súhrn, prítomní, dotaz,
záver, next steps, schválenie).

| # | Screen | Content |
|---|---|---|
| S-1 | Patient Database | First item in the header, with an obvious "add patient" [design-4 00:01:36]. Columns: patient ID, name, birth date, diagnosis (MKN-10, the Czech ICD-10), owner, referring department, next MDT date and whether the patient is already scheduled [design-4 00:02:30], MDT status, last data update [ui-shot 17.06.15 (2)]; Excel-style filters in the column headers [design-5 00:00:03]. Round 3: name surname first, birth number (RČ) and age columns instead of birth date, diagnosis as histology plus TNM with a small second line (TNM at diagnosis, current reason, MKN-10) [juro-round3]. |
| S-2 | MDT Calendar | Week view with 10-minute slots, each showing its time [design-5 00:01:28]; week arrows, "Dnes", and a month grid with a year picker [design-5 00:01:00]. A slot shows case ID and name [design-5 00:02:50]; clicking it opens a patient card in the right third [design-5 00:02:05]. Move to another slot or free it. |
| S-3 | Patient Detail | Tabs. Overview: one block with the MDT brief, the question and the current conclusion; then the detailed oncology summary (diagnosis headline, dated rows), the current state of the patient, the alerts for the question, and the horizontal timeline [design-4 00:04:08; design-5 00:03:21, 00:17:06]. Other tabs: anamnesis, documents (upload via a dialog), labs (matrix and chart), all alerts, history (MDT conclusions, doctor edits, documents over time) [design-5]. |
| S-4 | MDT Presentation | For the shared screen: identity, the 30 to 60 second summary, the question for the MDT, expandable findings with numbered references [1], and the day's remaining cases in a collapsible side panel. |
| S-5 | MDT Protocol | MDT Session with tabs "Manual notes" and "AI recording" (planned; the demo does not record) [ui-shot 17.06.14 (1), (2)]; attendance; after the discussion: draft conclusion, extract next steps and assign them, physician review and approval; then the ticked fields and the PDF report. |
| S-7 | Administrace | The access log across all cases, visible only to the administrator user [design-5 00:16:26]. |
| S-6 | My Tasks | The coordinator's open tasks across patients with assignee, due date, completed count, and copy [ui-shot 17.06.14, 17.07.06 (1)]. |

## Visual direction

Soňa likes the style of the GLIDE website
(https://www.glideanalysis.com) because it looks serious and
convincing to board-certified doctors. She endorsed this brief, called
"GLIDE-inspired Clinical Workspace", for the three main screens
[chatgpt pt2]:

- A serious clinical tool an experienced oncologist, neurosurgeon, or
  radiologist would trust, not a startup AI dashboard. GLIDE is a
  presentation website; the MDT workspace is a tool used daily, so the
  layout must be practical.
- Show the source record, the question to assess, the guideline, and the
  clinical context side by side.
- Palette: off-white background, white surface, dark slate primary text,
  muted teal-green accent, pale soft accent.
- Type: Manrope for headings, DM Sans for text. Very light background,
  dark type, fine dividing lines, minimal shadows.
- Readable and high-contrast on a projector during the MDT.
- Avoid big colourful cards, gradients, emoji, many icons, and flashy AI
  animations. Use warning colours only where they mean something.
- "A tool made by doctors for doctors": calm, trustworthy, clearly
  structured.

## Reconciling Soňa's sections with FNO's items

Soňa wants five sections: anamnéza (history), onkologický súhrn (oncology
summary), prítomní (attendees), dotaz (question), záver (conclusion)
[chatgpt P 14:00]. FNO's spec lists identity, a short summary, and
expandable items [FNO spec]. Our proposal, to confirm with Soňa (see
[`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md#ask-soňa)):

| Element (Patient Detail, MDT Presentation, MDT Protocol) | FNO spec | Soňa's section |
|---|---|---|
| Identity header | patient identification | (database fields) |
| MDT brief, two lines | short case summary | shortest level of the oncology summary |
| Anamnéza | (not listed; the consultation form has it) | anamnéza |
| Klinický nález (current clinical state) | clinical finding | (not separate) |
| Zobrazovací metody | imaging | part of the oncology summary |
| Histologie | histology | part of the oncology summary |
| Prodělaná léčba | past treatment | part of the oncology summary |
| Dotaz na MDT | current question for the MDT | dotaz |
| Prítomní | (report only) | prítomní; set per session, printed in the report |
| Záver | (report only) | záver; stored in the decision history, printed in the report |

The detailed oncology summary (a dated list, one line per exam) is the
"detail" level behind the brief, and the imaging, histology, and treatment
items and the timeline are filtered views of it.

## Feedback round 1 (2026-10-16)

Soňa reviewed mock v1 with Juro [design-4]. She also showed the designs
she had made with ChatGPT [ui-shot].

| # | Feedback | Who | Source | What changes |
|---|---|---|---|---|
| 1 | Patient names must not go to the AI. Free text becomes structured data after anonymization or pseudonymization. The MDT itself needs to know who the patient is. Juro: the interface runs on the hospital's internal servers. | Soňa; Juro on hosting | [design-4 00:00:03 to 00:01:23] | New F-37 and a flow step; where the model runs is an open question. |
| 2 | The calendar needs time slots, rows of about 15 minutes; a slot need not show the patient until clicked. | Soňa | [design-4 00:01:36] | S-2, F-11. |
| 3 | Patient Database first in the header, with an obvious way to add a patient. | Soňa | [design-4 00:01:36] | S-1, F-01, F-15. |
| 4 | The database shows whether the patient is already scheduled. | Soňa | [design-4 00:02:30] | S-1, F-01. |
| 5 | Too many assistant alerts: overwhelming and confusing. A separate tab? Undecided. | Soňa; Juro asked about the tab | [design-4 00:02:30 to 00:04:53] | F-07, F-09 show fewer, prioritized alerts; the tab is an open question. |
| 6 | Source chips inside the summary text disturb reading, and their monospace font is hard to follow. Use numbered references [1] as in papers. | Juro proposed, Soňa agreed | [design-4 00:03:28 to 00:04:08] | F-18. |
| 7 | The overview shows the case summary and the patient-history timeline; clicking an event (for example an outpatient finding of 29.4.) shows its detail. | Soňa | [design-4 00:04:08 to 00:04:49] | S-3, F-16, F-19. |
| 8 | The timeline is horizontal and scrollable, with bigger points labeled directly on the line (like a company-history timeline), not dots with a separate list and a years-only axis. | Juro described the style, Soňa asked for horizontal | [design-4 00:04:53 to 00:06:20] | F-19; the orientation question is closed. |
| 9 | The conclusion screen in mock v1 is disliked; her ChatGPT design is preferred. | Soňa | [design-4 00:06:35; ui-shot 17.06.14 (1), (2)] | S-5, F-23. |
| 10 | Attendance should use dropdowns per department, not a checklist. | Juro, recalling an earlier discussion | [design-4 00:06:55] | F-22; her own design ticks doctors, so an open question. |
| 11 | The next mock should include the discussed features, designed properly. | Juro | instruction, 2026-10-16 | Decision 6. |

## Feedback round 2 (2026-10-16)

Soňa reviewed mock v2 with Juro [design-5]. Mock v3 (`mocks/v3.html`)
applies it. Where her wish clashes with a `CLAUDE.md` rule, the last
column says what the mock does; those points are also in
[Conflicts with CLAUDE.md](#conflicts-with-claudemd).

| # | Feedback | Who | Source | What changes |
|---|---|---|---|---|
| 1 | Database filters as in Excel: a filter in each column header, not filter buttons above the table. | Soňa; Juro restated | [design-5 00:00:03 to 00:00:56] | S-1, F-12: column-header filters with value checkboxes; the status buttons are gone. |
| 2 | Calendar navigation like Google Calendar: move by month, pick a year, not twelve clicks of "next week". | Soňa; Juro restated | [design-5 00:01:00 to 00:01:28] | S-2, F-11: week arrows, "Dnes", a month grid with a year picker; seminars repeat weekly (example schedule). |
| 3 | Show the times of the slots, and make slots 10 minutes, not 15. | Soňa | [design-5 00:01:28 to 00:01:49] | S-2, F-11: every row and free slot shows its time; 10-minute slots. |
| 4 | Clicking a patient in the calendar opened a small panel that was easy to miss; the patient card should take the right third. | Juro, after Soňa missed it | [design-5 00:01:49 to 00:02:30] | S-2: a wide patient card (identity, diagnosis, question, brief) in the right third. |
| 5 | The calendar should show real names, not just the case ID. | Soňa | [design-5 00:02:50] | S-2: slots show case ID and name. Privacy trade-off, see the conflicts table. |
| 6 | The brief belongs on the first screen: MDT brief, then the question, then the conclusion; the detailed summary below. | Soňa | [design-5 00:03:21 to 00:04:05; 00:14:57 to 00:15:22] | S-3, F-16: Overview opens with one block (brief, question, current conclusion), then the detailed summary. |
| 7 | Diagnosis: no "Diagnóza:" label; the first line, bold and larger, is the histology with grade and TNM ("světlobuněčný renální karcinom G2, pT2a pN1 M0"); the MKN-10 code goes below because it is for reporting. | Soňa | [design-5 00:04:07 to 00:06:32] | F-16: diagnosis headline. The TNM is labeled as the stage at diagnosis, not the current stage (`CLAUDE.md` "Compare like with like"). |
| 8 | In the oncology summary: date, then the event in bold (for example "Implantace venózního portu"), then the details in normal font. | Soňa | [design-5 00:17:06] | F-16: dated rows with a bold event name. |
| 9 | Drugs: name, strength, dosing (1-0-0) and a dose change with its date; no date column, no "verify" text, no note on where it was found. Drugs are checked again at admission anyway. | Soňa | [design-5 00:07:30] | F-06: a drug table with a "when / indication" column (so "1-1-1 při nevolnosti" is not read as regular dosing); uncertainty is an icon with a tooltip. Deliberate deviation: the planned everolimus increase still says "plánováno, ověřit" in its change cell, because a planned dose shown as given is a known failure case. |
| 10 | Do not write "fumátor"; use "kuřák". Unknown pack-years should stay empty, not say "unknown". | Soňa | [design-5 00:07:30] | F-06: "Kuřák" (the quote keeps "fumátor"). Pack-years: the fixed gap wording kept, in a quiet style; see the conflicts table. |
| 11 | Fold the source list away (closed by default); it gets in the way. | Soňa; Juro restated | [design-5 00:07:30 to 00:08:55] | F-18: every source list is a closed "Zdroje (n)" panel; the [n] numbers stay. |
| 12 | The grey OCR and method comments in the anamnesis are unnecessary for a doctor. Juro: they point out real misreads; maybe an icon with the detail on hover. Soňa: a doctor just wants to trust it. | Soňa; Juro proposed the icon | [design-5 00:08:55 to 00:10:04; 00:10:05] | F-06: comments replaced by small icons (! verify reading, – recorded negative, ? planned, ≠ conflict, i assistant's observation) with the detail on hover. Method notes ("strukturováno z volného textu") removed. |
| 13 | No unexplained abbreviations (she did not recognize "HN", which in Czech is "hypertenzní nemoc"); write the diagnosis out. Diagnoses in the personal history should stand out (bold), the rest plain text. Also in the PDF report. | Soňa | [design-5 00:10:05; 00:21:35 to 00:22:30] | F-06, F-31: "Hypertenzní nemoc" etc. in bold, qualifiers plain, in the app and the report. |
| 14 | The source text of page 4 shows strange characters. | Juro | [design-5 00:10:48 to 00:11:26] | F-18: unreadable OCR characters (U+FFFD) are shown as a marked "?" with a note that the page has unreadable characters. |
| 15 | Documents tab is cramped; the upload area need not be always visible: an upload button in the card's corner opens a dialog. The "Zpracování" panel is unclear. | Juro; Soňa agreed | [design-5 00:11:46 to 00:13:32] | S-3: full-width table, "+ Nahrát dokument" opens a dialog, the processing panel is gone. Readability reason moved to a tooltip. |
| 16 | Labs: rows are tests, columns are draw dates and times; click a test to see its trend as a chart. The date matters. | Soňa | [design-5 00:13:43 to 00:14:34] | F-21: lab matrix and chart, on a clearly labeled synthetic series (the documents have one undated set, shown in a second view). |
| 17 | Drop the MRI comparison tab for now; she would maybe drop the history tab too. | Soňa; Juro agreed on the MRI tab | [design-5 00:14:57 to 00:15:37] | S-3: MRI tab removed; F-20 stays Pitch. Deliberate deviation: the history tab stays, reworked per row 18, because the append-only MDT decisions and the doctor edits need a place. |
| 18 | "Historie" reads as the patient's history or past documents, not an audit log (Juro). Soňa: the audit log need not be visible to users; it can stay on the backend and be pulled from the database. Juro: administrators could get a fourth top-navigation item. | Juro; Soňa | [design-5 00:15:37 to 00:17:06] | S-3: "Historie" holds MDT conclusions, doctor edits and the document history; S-7 Administrace (audit log) appears only for the administrator user. |
| 19 | The current state of the patient (subjective and objective finding from the last doctor: walking or bed-bound, self-sufficient, oriented) is missing; it belongs on the first screen. | Soňa | [design-5 00:17:06 to 00:18:39] | S-3, F-16: "Aktuální stav pacienta" on the Overview, from the latest exam; mobility and self-sufficiency are shown as the assistant's inference from ECOG PS 1; what the record does not state (speech, Karnofsky index) shows the gap wording. |
| 20 | Back and forward should work. | Soňa; Juro: hash-based history | [design-5 00:18:39 to 00:19:27] | All screens: the URL hash holds view, patient and tab, so browser back and forward work. |
| 21 | Everything should be editable, for example filling in a missing MDT question, or fixing a typo or an untrue statement. | Soňa; Juro asked what should be editable | [design-5 00:19:27 to 00:20:46] | New F-38. |
| 22 | Attendance per department is good; once filled in for a day, it should hold for the whole day. | Soňa | [design-5 00:21:35] | F-22: attendance is stored per seminar day. Closes the open attendance question. |
| 23 | The coordinator can tick off tasks: good. | Juro | [design-5 00:20:56] | No change. |
| 24 | She does not like how the overviews look yet; the team will keep working on them with her. | Soňa | [design-5 00:20:14] | Open: the overview design needs another round with her. |

## Feedback round 3 (2026-10-16)

Written feedback on mock v3, passed on by Juro in the chat with
screenshots [juro-round3].

| # | Feedback | What changes |
|---|---|---|
| 1 | The calendar shows no identifier other than the patient's name and birth number (RČ): no case ID. A slot starts with the surname, then the RČ. | S-2: slots, the patient card and the unscheduled list show "Surname First · RČ"; the case ID is gone from the calendar. No document in the challenge data contains an RČ, so it shows "neuvedeno" (never invented). |
| 2 | All slots are grey except the time of this MDT (for example Thursday 14:00-16:00), so it is clear when the meeting runs. | S-2: one seminar a week, Thursday 14:00-16:00 (example), white; every other slot grey; the grid shows 12:00-17:00. |
| 3 | A double click on a patient in the calendar opens the case full screen. A single click still opens the card. | S-2. |
| 4 | Diagnoses read like "světlobuněčný karcinom ledviny, pT2a N1 (3/5) M0". | S-1: histology and TNM as the document writes them ("pT2a pN1 (3+/5) M0"); a small second line says the TNM is from diagnosis and gives the current reason and the MKN-10 code. |
| 5 | Birth number instead of "Narozen / věk", or perhaps age. | S-1, S-3, report: separate RČ and Věk; age from a document's stated age, or computed from a stated birth date (marked "vyp."). |
| 6 | Otherwise the calendar is nice. | No change. |

## Features

Tiers: **Demo** is in the working demo; **Pitch** is shown as a mock or a
labeled stub; **Later** is roadmap only. "FNO" names the
[`REQUIREMENTS.md`](../agent/REQUIREMENTS.md) item served.

Demo is trimmed to what 24 hours can build and check against the sample
documents: the path from upload to the presented case and the PDF report;
everything else is Pitch or Later.

### Before the MDT

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-01 | Patient database | A list of all patients with diagnosis (MKN-10 code and name), referring doctor (case owner), department, MDT date, status; "add patient". A patient can return to many MDTs. | Pitch | Patient identification | [design-1 00:38:30; chatgpt P 14:02, P 14:33, P 14:36] | Owner and referring doctor are the same person, so one field (Soňa, design-1 00:38:30 "je to isté"; chatgpt P 14:36); ChatGPT's field table still lists both [ui-shot 17.06.15 (2)], and Soňa's statement wins. Feedback: first in the header, obvious "add patient", a "scheduled" indicator, last data update [design-4 00:01:36, 00:02:30]. ChatGPT's "after login" dropped (no login). |
| F-02 | Case intake | Fill in FNO's consultation request (identity, history, imaging, current state, referring doctor, question for the MDT) and upload PDFs. Identity read from documents; disagreements shown. | Demo | Case's entry point; inputs | [design-1 00:05:41, 00:07:13, 00:30:02; chatgpt R 12:27, R 10:29] | Upload replaces the hospital API in the prototype. The question for the MDT decides which checklist items matter [chatgpt R 10:29]. |
| F-03 | Readability check and re-upload request | Each document gets a reading certainty; a poor photo or scan gets a warning and a request to upload a better copy; unreadable parts are marked. | Demo (basic) | PŘEČÍST (read) | [design-2 00:02:36; chatgpt P 15:00] | Judge the text itself, not whether a text layer exists: FNO's PDFs have text layers with poor OCR ("1112023" for 11/2023, "MO" for M0, "lmg/kg"), and such misreads change dates, stages, and doses. Soňa endorsed the check as core. Asking the sender by a deadline [design-2 00:04:59] is Later. |
| F-04 | Wrong-patient and duplicate flag | A document that may belong to another patient, or was uploaded twice, is flagged. | Pitch | - | [chatgpt R 15:00] | ChatGPT only. Serves the "two patients mixed up" failure case. |
| F-05 | Per-document extraction | For each document: exam date, report date, date received, exam type, conclusion, with source. "Latest finding" is not "last uploaded". | Demo | Findings overview; PARAMETRIZOVAT; SEŘADIT | [design-1 00:23:40; chatgpt P 11:54, R 11:54, R 14:36] | Soňa asked to use the latest data; ChatGPT split the three dates. |
| F-06 | Structured anamnesis | Czech sections: osobní, rodinná, pracovní, sociální, farmakologická, alergologická, abusus, epidemiologická, with what to extract for each. Pack-years (cigarettes per day / 20 x years) shown as computed, with inputs, per period when intensity changed. | Pitch | Clinical finding; PARAMETRIZOVAT | [chatgpt P 14:33, P 14:36; ui-shot 17.07.06] | Soňa: "anamnéza super". Round 2 [design-5 00:07:30 to 00:10:31]: diagnoses in bold with qualifiers in plain text, written out in Czech; drugs as a table (name, strength, dosing, when or indication, change), no dates; "kuřák", not "fumátor"; uncertainty as icons with the detail on hover or tap; no method notes. Preventive exams tab Later. No pack-years when start age is missing. |
| F-07 | Missing-documents alert after upload | Right after upload, an alert lists what was not found. Always on, not part of the guideline layer. Few, prioritized alerts: mock v1 showed so many that Soňa found it overwhelming [design-4 00:02:30]. | Demo | Missing documents; ZKONTROLOVAT | [design-1 00:36:13; design-2 00:02:36; chatgpt P 14:57; juro-notes] | Juro wants "done but not available" apart from "not done"; from documents we can usually only say "not found". |
| F-08 | Readiness checklist | Per case: pathology, radiology, staging, comorbidities, previous treatment, other findings; each available, missing, needs review, or not applicable; the doctor can change it. Also shown as the upload checklist. | Pitch | Missing documents | [chatgpt P 15:52, P 15:54; design-2 00:08:25] | Informs, never blocks [chatgpt P 15:54]. Diagnosis-specific items (glioma markers) are ChatGPT's and unverified [chatgpt R 15:52]. |
| F-09 | Conflicting and outdated alerts | Two sources that disagree, or a value that may be too old for this MDT, each with "view source". Ranked by relevance to the question. | Demo (conflicting); Pitch (outdated) | Contradictions | [chatgpt P 09:24, R 14:57] | Change over time is not a contradiction. |
| F-10 | Ordered test vs needed markers | When a broad test was done ("biochemie"), check the result has the specific markers the decision needs. | Later | Missing documents; lab trends | [juro-notes] | Needs synthetic labs; FNO data has none. |
| F-11 | MDT calendar | Put a case in a 10-minute slot on a seminar day; each slot shows its time, the case ID and the name; week arrows, "Dnes", and a month grid with a year picker; clicking a case opens its card in the right third; move or free a slot. | Pitch | - | [design-1 00:05:41, 00:08:18; design-4 00:01:36; chatgpt P 10:29, P 14:02; paper-notes ui_scribbles] | Round 2: 10-minute slots, times shown, names shown, month and year navigation [design-5 00:01:00 to 00:02:50]. Round 1 asked for about 15-minute slots [design-4 00:01:36]; earlier 5 minutes [design-1 00:05:41] and 10 to 15 [paper-notes more_notes]; time per patient stays an open question. Members open cases the evening before [design-1 00:16:16]. |
| F-12 | Case status and filters | New, Scheduled, Needs attention, Ready, Completed; Excel-style filters in the column headers (owner, department, next MDT, status) and a search box [design-5 00:00:03]. | Pitch | - | [design-1 00:16:16; paper-notes more_notes; chatgpt P 14:04, P 14:08] | Status belongs to one MDT consultation, not to the patient. "Needs attention" is for problems needing action, not for gaps. |
| F-13 | What changed since the last MDT | For a returning patient: new events since the last MDT, the previous conclusion, and its tasks. | Pitch | Significant changes | [chatgpt R 14:33, R 14:51] | ChatGPT only; follows from decision 3. |
| F-14 | Stubbed hospital systems | A labeled stub showing where data would come from (NIS, LIS, PACS, INTELIPAT, genetics) and how it is searched. | Pitch | NAJÍT; inputs | [juro-notes; paper-notes ui_scribbles; design-1 00:06:47] | Real integration is Vision. |
| F-38 | Doctor edits | A doctor can correct any extracted or drafted value and fill in a missing one (for example the question for the MDT). The edit is stored next to the original with who and when, marked "upraveno" / "doplněno lékařem", listed in the case history, and can be reverted. The source document never changes. | Pitch | - | [design-5 00:19:27 to 00:20:46] | `CLAUDE.md`: the original text stays findable and unchanged; new documents never silently change confirmed content. Coordinators cannot edit clinical content in the mock. |
| F-37 | Pseudonymization before AI | Before text goes to the AI, the name, birth number, and other identifiers are replaced with a case ID; the doctor still sees who the patient is. | Demo | - | [design-4 00:00:03 to 00:01:23] | Soňa's first feedback point; `CLAUDE.md` "Expose as little as possible". Demo because it is a small step and the jury will ask. Hosting on the hospital's servers (Juro, [design-4 00:01:17]) is Pitch. |

### During the MDT

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-15 | Navigation and layout | Header with Patient Database first, then MDT Calendar; in a case, the day's remaining cases sit in a collapsible side panel; panes close and expand. | Demo | Schematic, readable | [design-1 00:07:43, 00:18:16; design-2 00:17:42; paper-notes ui_scribbles; chatgpt P 16:01] | Juro's spoken left/right is mirrored; his sketch (list on the left) wins. Header order from [design-4 00:01:36]. |
| F-16 | Case summary with levels | The Patient Detail overview shows the case summary with the timeline [design-4 00:04:08]; the MDT Presentation opens on the two-line brief. Round 2 [design-5 00:03:21 to 00:06:32, 00:17:06]: the Overview opens with the MDT brief, then the question, then the current conclusion; below it the detailed summary: a diagnosis headline (histology, grade, TNM labeled as the stage at diagnosis; MKN-10 code smaller below) and dated rows with the event in bold; then the current state of the patient. The brief/detailed switch stays in the MDT Presentation [ui-shot 17.06.15, 17.06.15 (1)]. Relevant other diagnoses listed. | Demo | Short case summary | [design-1 00:01:52, 00:22:08, 00:25:52, 00:41:44; chatgpt P 14:33, R 14:33, P 16:01; juro-notes] | Keeps the documents' status (suspicion vs confirmed by histology). Age appears only when a document states it (3 of the 10 FNO patients); otherwise the brief leaves age out and the identity header shows "věk neuveden v dostupné dokumentaci". Unrelated visits and private data hidden [juro-notes]. |
| F-17 | Expandable items | Anamnéza, clinical state, imaging, histology, past treatment, question for the MDT; each expands to detail with links. Each can be ticked for the report. | Demo | Expandable items; wiki links; ticking | [FNO spec; chatgpt P 14:00; juro-notes] | See the reconciliation above. |
| F-18 | Source view | Every fact carries a numbered reference [1], as in a paper; clicking it opens the passage in the original document. | Demo | Wiki-style links | [design-1 00:42:20; design-4 00:03:45 to 00:04:00; juro-notes; chatgpt R 01:17] | Mock v1's inline source chips in a monospace font disturbed reading [design-4 00:03:55, 00:04:00]. Round 2: the source list under each card is folded away by default [design-5 00:08:47]; unreadable OCR characters are marked in the source view [design-5 00:11:10]. |
| F-19 | Timeline with tracks | A horizontal, scrollable timeline with parallel tracks per kind of event, like git branches. Bigger points carry their label (date, type, title) directly on the line; clicking one shows its detail and source. Oncology milestones highlighted. | Demo | Timeline view; SEŘADIT | [design-1 00:24:05, 00:42:05; design-2 00:15:58, 00:16:54; design-4 00:04:31, 00:05:16, 00:06:17; ui-shot 17.04.50; juro-notes; chatgpt P 14:33] | Horizontal, decided in feedback [design-4 00:06:17]. Soňa's ChatGPT design is vertical cards (icon, date, type, title, one line, expandable) [ui-shot 17.04.50]; its card content carries over. Not dots with a separate list and a years-only axis (mock v1). Long intervals shown as facts. Opening video or images is Later. |
| F-20 | Compare current and previous exam | Two reports side by side (for example two MRI reports) with the differences listed as the assistant's observation. | Pitch (text); Later (images) | Significant changes; POROVNAT | [design-1 00:11:45, 00:43:21; paper-notes more_notes; chatgpt P 11:54, R 11:54] | Compare like with like; any computed change (ChatGPT's "34.4% decrease") is labeled. |
| F-21 | Lab value trends | A matrix of tests (rows) by draw date and time (columns), original units and ranges; clicking a test shows its trend chart [design-5 00:13:43]. | Pitch | Lab value trends | [FNO spec; challenge] | Not discussed in the design sessions. The only lab values in the data are one undated set in patient 10's PDF, so a trend needs synthetic labs (open question with FNO). Mock v3 opens on the real undated values; a second view shows the matrix and chart on a synthetic series, labeled as such inside the chart. |
| F-22 | Attendance | Specialties per department (neurochirurgie, klinická onkologie, radiační onkologie, radiologie, neurologie, patologie) with their doctors pre-filled; set who is present once per session; count present; copy; per-case exceptions. | Pitch | (report) | [design-1 00:14:16, 00:40:26, 00:41:13; chatgpt P 11:54, P 14:33, P 14:36] | Soňa: "jj super attendance" [chatgpt P 14:36]. Decided in round 2: one dropdown per department, filled in once per seminar day [design-5 00:21:35]. Approving a conclusion freezes the attendance in that protocol. |
| F-23 | Conclusion entry | An MDT Session panel for the selected patient with tabs "Manual notes" (typed live notes and conclusion, edited into the final protocol) and "AI recording"; after the discussion: draft conclusion, extract next steps and assign them, physician review and approval. | Demo (manual notes) | (report) | [design-1 00:44:31, 00:46:27; design-4 00:06:35; ui-shot 17.06.14 (1), (2); chatgpt P 12:16, P 14:51] | Replaces the mock v1 conclusion screen, which Soňa disliked [design-4 00:06:35]. Explicit patient selection prevents mixing patients. |
| F-24 | Decision history | Each conclusion is confirmed by a named doctor and stored; a later decision supersedes it, never erases it. | Demo | (report; timeline) | [juro-notes; chatgpt P 12:16, R 14:04] | Decision 3. |
| F-25 | Live listening | Record the discussion per patient, transcribe it with names, draft the conclusion for the doctors to confirm. In the mock: the "AI recording" tab, labeled as a planned feature that needs participants' consent and does not record [ui-shot 17.06.14 (1)]. | Pitch (stretch Demo) | - | [design-1 00:46:27; juro-notes; paper-notes more_notes; chatgpt P 10:14, P 14:51] | Decision 2. Opt-in and consent; patient data. Voice enrolment for names is Later (biometric data). Raw transcript fixed, summary editable [design-1 00:43:31], undecided. |
| F-26 | Query mode | Doctors ask the assistant questions about the case; answers cite sources or say "not found". | Pitch | - | [juro-notes] | |
| F-27 | Guideline layer | A switch turns on: (a) review of the path so far for information missing for a decision, (b) guideline-supported options for the next treatment, (c) review of the MDT conclusion. Each finding shows patient evidence, guideline name, society, year, section, uncertainty, and the doctor's review. | Pitch | - (beyond the challenge) | [design-1 00:35:08, 00:46:00; design-2 00:00:36; chatgpt P 12:16, P 14:56, P 16:01, R 14:56, R 16:01; juro-notes] | Decision 1; the line is open. Soňa wants it in ("ja to tam riadne chcem", chatgpt P 12:16), framed later as "možno by sme chceli" (P 14:56); the on/off switch was her idea (P 14:56). Part (a)'s missing-information check is F-07/F-08. Use a small curated, versioned guideline set [chatgpt R 14:56]. Kept apart from the MDT conclusion. |
| F-28 | AI engagement levels | Passive (summarize), on demand (when asked), proactive (an independent assessment formed before the discussion). | Later | - | [juro-notes; chatgpt P 10:14, P 10:27] | Soňa moved from on-demand to proactive because the doctors, as experts, would bias the AI [chatgpt P 10:14]. ChatGPT put it in the roadmap tier [chatgpt R 12:15]. |
| F-29 | Rare-case support | A small warning that a case looks unusual from past MDTs; help finding guidelines and case reports beforehand. | Later | - | [design-3 00:00:52, 00:02:18] | Soňa's answer on flagging is unclear; open question. Literature support is our reading of her need. |
| F-30 | Agenda priority | Facts that could order the agenda (for example days since biopsy). | Later | - | [juro-notes] | Facts only, no ranking verdict. |

### After the MDT

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-31 | PDF report | A PDF with identity, the ticked items, attendees (once F-22 exists), and the confirmed conclusion, usable as a report for the record. Also kept in our app. | Demo | Output 2 | [FNO spec; design-1 00:33:39, 00:33:55; chatgpt R 12:15, R 12:27, R 14:00] | Pre-MDT briefing and post-MDT protocol are separate [chatgpt R 12:15]. Nothing is written back to the hospital record. FNO also wants the report usable as a request for further examination or treatment; nothing produces request text yet (gap). |
| F-32 | Coordinator task list | Action items drawn from the approved conclusion, each with assignee and due date, a completed count, and copy; a coordinator "My Tasks" screen across patients; an email "MDT - nové úlohy na spracovanie" with only the case ID, the task count, and a link. | Pitch; Later (email) | - | [design-1 00:33:10, 00:49:33; chatgpt P 14:51; ui-shot 17.06.14, 17.07.06 (1)] | "Order MRI" is not "MRI ordered". Not a requisition system. |
| F-33 | Re-check on new upload | New documents re-run the checks and update drafts; confirmed content is never silently changed. | Pitch | - | [chatgpt R 14:57] | ChatGPT only. |
| F-34 | Extra documents for a session | Attach material by hand, for example a photo of paper notes. | Later | - | [design-1 00:16:16] | |

### Cross-cutting

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-35 | Retry an AI output | A button to rerun a section. | Later | - | [design-1 00:32:35] | Conflicts with reproducible outputs; keep both versions. |
| F-36 | Mobile web | Works in a phone browser; no app to install. | Later | - | [design-2 00:12:53] | Juro's point. |

## FNO requirements coverage

How the tiers above cover each item in
[`REQUIREMENTS.md`](../agent/REQUIREMENTS.md). "Gap" means no Demo feature
delivers it.

| FNO requirement | Features | Demo covers it? |
|---|---|---|
| Patient identification | F-02 (from the documents), F-01 (Pitch) | Yes |
| Short case summary | F-16 | Yes |
| Expandable items (clinical finding, imaging, histology, past treatment, question) | F-17 | Yes |
| Wiki-style links | F-18 | Yes |
| Switchable timeline view | F-19 | Yes |
| Schematic, readable on a shared screen | F-15, [visual direction](#visual-direction) | Yes |
| Fields ticked for the report | F-17 | Yes |
| PDF report with identity and ticked fields | F-31 | Yes |
| Report usable as a request for further examination or treatment | F-31 | Gap: nothing produces request text. |
| Lab value trends | F-21 (Pitch) | Gap: one undated lab set (patient 10) in the data; a trend needs synthetic labs. |
| Findings overview | F-05, F-17 | Yes |
| Significant changes | F-20 (Pitch), F-13 (Pitch), F-19 shows events | Partial: events are shown, nothing in Demo labels a change. |
| Contradictions | F-09 | Yes (conflicting values) |
| Missing documents | F-07 | Yes |
| NAJÍT (find in the source systems) | F-14 (Pitch stub) | Gap: the demo takes uploads. |
| PŘEČÍST (read) | F-03, F-05 | Yes |
| POSKLÁDAT (put together) | F-16, F-19 | Yes |
| POROVNAT (compare current and previous) | F-20 (Pitch), F-09 | Partial: only conflicting values. |
| SEŘADIT (order in time) | F-19 | Yes |
| ZKONTROLOVAT (check nothing is missing) | F-07 | Yes |
| PARAMETRIZOVAT (free text to values) | F-05 | Yes |
| Inputs: medical reports, imaging, pathology | F-02, F-05 (uploaded text) | Yes |
| Inputs: lab results (LIS) | F-21 (Pitch) | Gap, as for lab trends. |
| Inputs: genetics | none | Gap: no genetics data and no feature. |
| Read the consultation request's fields | F-02 | Yes |

## Vision

Ideas for after the hackathon; none is planned for the demo.

- Import patients from the NIS and other systems, FHIR integration
  [design-1 00:06:47, 00:29:49; paper-notes ui_scribbles; chatgpt R 01:17].
- An admin layer: groups, organizations, cohorts, team definitions, access
  control, login [design-1 00:18:16; paper-notes ui_scribbles].
- Retrieval and prompt emphasis set per department or doctor
  [design-1 00:28:29].
- Imaging: 2D images (X-ray, ECG), a PACS plugin, side-by-side image
  scrolling [design-1 00:11:45, 00:20:52; design-2 00:03:23].
- The AI reads the pathology slide directly [juro-notes].
- Pathways under several guideline sets (US, EU) [juro-notes].
- Recording verbal claims as unconfirmed until verified [chatgpt R 10:14];
  tracking how the assessment changed during the discussion [chatgpt
  R 10:27].
- "Decision readiness" per clinical question [chatgpt R 10:05].
- A workflow platform: tracked next steps, reminders, link to booking;
  event hooks that start actions such as the coordinator email
  [chatgpt R 11:54; design-1 00:49:46].
- Analytics on MDT recommendations [design-1 00:34:18] (Soňa: "next
  phase").
- The summary as a standalone module beyond MDTs [design-1 00:26:10].
- A workload calculator and success measures (time saved, extraction
  accuracy, missed contradictions), only with FNO's numbers
  [chatgpt R 10:29, R 12:15].

Rejected: ranking doctors [design-1 00:14:16]; asking everyone to
introduce themselves for voice matching (Soňa: too complicated)
[design-1 00:48:08].

## Conflicts with CLAUDE.md

`CLAUDE.md` now has rules for most of what the design discussion raised.
This table says which feature each rule touches and what is still open.

| Feature or idea | CLAUDE.md rule | Status |
|---|---|---|
| Guideline layer: treatment options and review of the MDT's plan (F-27, F-28) | "The assistant prepares, the doctor decides", with the guideline layer as the one exception | Allowed as an explored option. How far it may go and whether it is on by default are open (`OPEN_QUESTIONS.md`). |
| Recording and transcribing the meeting (F-25) | "Meeting audio is patient data" | Covered by the rule. Needs explicit opt-in, participants' consent, and FNO clearance for any speech-to-text service; stretch goal. |
| Voice enrolment to name speakers (F-25 notes) | "Meeting audio is patient data": no voiceprints in the prototype | Not in the prototype; Later at most. |
| Login and the admin layer | "Skip login, OAuth, and scaling"; keep the simple access log | No login: a user picker stands in. Mock v3 has an Administrace screen (S-7) with the access log, shown only when the administrator user is picked; a real admin layer stays Vision. |
| Patient Database and brief show name, birth number, age (F-01, F-02, F-16) | "Expose as little as possible, and protect what is exposed" | Mock v3 shows full names in the database and, at Soňa's request, in the calendar slots (see the calendar row below); case numbers are used in the presentation agenda and the coordinator email. Identifiers never go to the AI (F-37; Soňa [design-4 00:00:03]); the MDT screens show identity because the team needs it [design-4 00:00:57]. Which other screens need name and birth number is still open. |
| Calendar slots show the patient's name and birth number (S-2) [design-5 00:02:50; juro-round3] | "Show identifiers only where the user needs them" | Mock v3 shows surname, first name and RČ in the slots, as asked: the calendar is used by the MDT team, who need to recognize the patient. The RČ is a strong identifier, so this exposes more than a case ID would. Trade-off: anyone who can open the calendar sees the names of the week's patients. Open: should the coordinator or a projected calendar show initials instead? |
| Hiding "verify" and OCR comments (F-06) [design-5 00:07:30, 00:08:55] | "Show uncertainty wherever the extraction was not clear-cut" | Kept, but quiet: an icon with a tooltip instead of grey text. Removing the marker entirely would break the rule, because a misread dose or negation is exactly what the doctor must see. |
| Unknown pack-years left blank (F-06) [design-5 00:07:30] | "Use fixed Czech wording for gaps" | Kept the wording "neuvedeno v dostupné dokumentaci" in a quiet small style; a blank cell would be indistinguishable from "not extracted". Open question for Soňa. |
| Everything editable (F-38) [design-5 00:19:27] | "The original text stays findable and unchanged"; "never silently change content a doctor confirmed" | Edits are stored as overrides with who and when, marked in the UI and listed in the history; the source and the extracted value are kept and can be restored. |
| Readability check (F-03) | "Check that a document is readable before using it" | Covered: the rule now judges reading certainty from the text itself, not from whether a text layer exists. |
| Missing and gap wording (F-06, F-07, F-16) | "Use fixed Czech wording for gaps" | Covered: "neuvedeno v dostupné dokumentaci", never "neguje". |
| Alerts (F-07 to F-09) | "Alerts inform, they never block" | Covered. |
| Conclusions, tasks, and re-checks (F-23, F-24, F-32, F-33) | "A draft is never shown as approved"; "MDT decisions are an append-only history" | Covered. |
| Coordinator tasks and email (F-32) | "Notifications carry a link, not medical data"; "Do not build our own requisition system" | Covered: tasks come from the confirmed conclusion, ordering is stubbed, the email carries a link. |
| Retry button (F-35) | Reproducible outputs, cached demo outputs | Later; keep both versions with sources. |
| Prompts written per department (Vision) | Prompts live in the repository | Vision only. |
| "PET should have been done instead of CT" alerts [design-1 00:36:13] | Intervals and facts, not verdicts | Phrase as "checklist item has no matching document". |
| "FHIR later if time" [design-1 00:30:35] | Decide FHIR early | Open; a team question in `OPEN_QUESTIONS.md`. |
| Juro: "privacy can wait until the visual demo" [design-2 00:13:10] | "Patient data and privacy - non-negotiable" | Resolved: the mock uses synthetic data and follows the privacy rules from the start. |

## Sources and speaker mapping

The design discussion of 2026-10-16 is in
[`docs/sources/design/`](../sources/design/README.md). People: Juro Oravec
(software engineer) and Soňa (oncologist; the product is based on her
experience, and her statements outweigh ChatGPT's).

| Citation | File | Speakers |
|---|---|---|
| `[design-1 hh:mm:ss]` | `Rakathon 1.elevenlabs.md` | speaker_0 Juro, speaker_1 Soňa, speaker_2 event film crew |
| `[design-2 hh:mm:ss]` | `Rakathon 2.elevenlabs.md` | speaker_0 Juro, speaker_1 Soňa |
| `[design-3 hh:mm:ss]` | `Rakathon 3.elevenlabs.md` | speaker_0 Soňa, speaker_1 Juro, speaker_2 passer-by |
| `[chatgpt P hh:mm]`, `[chatgpt R hh:mm]` | `2026-10-16-chatgpt-brainstorm-sona.md` | P is Soňa's prompt, R is ChatGPT's response |
| `[design-4 hh:mm:ss]` | `Rakathon 4 - first UI feedback.elevenlabs.md` | speaker_0 Juro, speaker_1 Soňa, speaker_2 passer-by |
| `[design-5 hh:mm:ss]` | `Rakathon 5 - second UI feedback.elevenlabs.md` | speaker_0 Soňa, speaker_1 Juro |
| `[ui-shot <time label>]` | `ui-screenshots/WhatsApp Image 2026-10-16 at <time label>.jpeg` | Soňa's screen designs made with ChatGPT |
| `[chatgpt pt2]` | `2026-10-16-chatgpt-brainstorm-sona-pt2.jpeg` | Screenshot of a later part of the same conversation |
| `[juro-notes]` | `2026-10-16-juro-notes.md` | Juro |
| `[paper-notes]` | `2026-10-16-juro-paper-notes.md` and the three photos | Juro |
| `[juro-round3]` | Written feedback on mock v3 in the Claude Code session, 2026-10-16 (no file) | Juro, passing on the team's feedback |

`[FNO spec]` is FNO's output specification and `[FNO deck slide N]` its
challenge deck, both listed in [`REQUIREMENTS.md`](../agent/REQUIREMENTS.md).

Where the rest went: domain facts are in
[`INDEX.md`](../agent/INDEX.md#from-soňas-experience), open questions in
[`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
