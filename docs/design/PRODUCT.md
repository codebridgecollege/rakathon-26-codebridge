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

1. **Guideline layer is in scope, as an option.** Decided on
   2026-10-16 (Soňa, via Juro): under the proposed management the layer
   quotes the guideline statements that apply to the patient, verbatim
   with name, society, year, version, section, page and evidence level;
   a click opens the guideline document with the statement highlighted;
   a deviations table lists where the MDT's plan departs from a quoted
   statement, with a read-only comparison and no required rating, reason or confirmation.
   Guidelines in the mock: EANO-ESMO brain metastases, ESMO renal cell
   carcinoma, Czech Oncological Society's Modrá kniha. The layer never
   ranks options or writes the proposal or conclusion. `CLAUDE.md`
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
   moves to "Naplánován" on its own, and to "Připraven" once the documents
   are processed (F-12). Members can open it beforehand.

### During the MDT: present, discuss, record

1. The coordinator or chair starts the MDT from the calendar day
   ("Zahájit MDT"), or from the header of a case on that day, and sets
   the attendance once for the session in the start dialog (F-22).
2. The first case opens in the same patient view the team uses before
   the meeting. The only addition is the session bar at the top: the
   day's cases in order, previous and next, attendance and "Ukončit MDT"
   (F-11, F-15). The brief shows first (F-16).
3. The presenter expands items, the timeline, or a source as questions
   come (F-17 to F-20).
4. The team decides; a doctor types the conclusion in the case's
   "Závěr MDT" field, and the "Projednání na MDT" card below it holds the
   discussion notes, the next steps and the approval, so the conclusion
   is always tied to the patient on screen (F-23). A doctor approves it
   for the team with one button; the app records the doctor's name and
   adds the doctor to the day's attendance if missing (F-24).
5. The status moves to "Projednán" on its own; a click on the next case
   in the session bar opens it on the same tab.

### After the MDT: report and tasks

1. The header's "Stáhnout report (PDF)" opens a dialog where the doctor
   ticks the fields for the report, can open the preview, and downloads
   the PDF (F-31).
2. Tasks for the coordinator are created from the confirmed conclusion
   (F-32): the doctor's own next steps, plus tasks the assistant drafts
   from the approved text, each confirmed or dismissed by a person.
3. New documents re-run the checks without overwriting the confirmed
   content (F-33). When the patient returns, the Patient Detail shows what
   changed since the last MDT (F-13).
4. When the follow-up is done, a doctor or the coordinator closes the case
   ("Uzavřít případ" in the "Projednání na MDT" card, or the status menu
   in the case header); the status becomes "Uzavřen" (F-12).

## Screens

From Juro's sketches [paper-notes], Soňa's screens [chatgpt P 14:02,
P 16:01], her ChatGPT designs [ui-shot], and the first feedback round
(see [Feedback round 1](#feedback-round-1-2026-10-16)). The visual brief
names three main screens, Patient Database, MDT Calendar, and Patient
Workspace [chatgpt pt2]. The Patient Workspace is one patient view
(S-3), used the same way before, during and after the meeting; during the
meeting it gains the session bar (S-4), and its "Projednání na MDT" card
(S-5) holds the discussion record.

Information flow [ui-shot 17.06.14 (3)]: Patient Database + MDT Calendar
(owner, referring workplace, status, filters) -> Patient Detail (brief,
question, conclusion, anamnesis, documents, oncology timeline, labs) ->
during the MDT the same view with the session bar, and in it the
discussion card (prítomní, záznam diskuse, další kroky, schválenie,
report).

| # | Screen | Content |
|---|---|---|
| S-1 | Patient Database | First item in the header, with an obvious "add patient" [design-4 00:01:36]. Columns: patient ID, name, birth date, diagnosis (MKN-10, the Czech ICD-10), owner, referring department, next MDT date and whether the patient is already scheduled [design-4 00:02:30], MDT status, last data update [ui-shot 17.06.15 (2)]; Excel-style filters in the column headers [design-5 00:00:03]; 20 patients per page (round 25). Closed cases are greyed (round 20). Round 3: name surname first, birth number (RČ) and age columns instead of birth date, diagnosis as histology plus TNM with a small second line (TNM at diagnosis, current reason, MKN-10) [juro-round3]. Round 25: every diagnosis is a short headline in the form of case 10's (entity or histology, site and side, grade, stage or size only as documented, the documents' suspicion wording, "IDH-wt" and MGMT for a glioblastoma only when documented), without narrative. |
| S-2 | MDT Calendar | Week view with 10-minute slots, each showing its time [design-5 00:01:28]; week arrows, "Dnes", and a month grid with a year picker [design-5 00:01:00]. A slot shows case ID and name [design-5 00:02:50]; clicking it opens a patient card in the right third [design-5 00:02:05]. Move to another slot or free it. |
| S-3 | Patient Detail | Tabs. Overview: one block, "Stručný přehled" (named "MDT brief" until round 25), with the short summary, the question and the current conclusion; then the detailed oncology summary (diagnosis headline, dated rows; its body scrolls inside the card, which on wide screens is as tall as the current-state card next to it), the current state of the patient, the alerts for the question, and the horizontal timeline [design-4 00:04:08; design-5 00:03:21, 00:17:06]. The status chip next to the case ID is the status menu with the status history (F-12). Other tabs: anamnesis, documents (upload via a dialog), labs (matrix and chart; explanations in a collapsed "Zdroje"), all alerts (each can be acknowledged or resolved and returned; resolved ones collapse into "Vyřešené"), history (MDT conclusions, doctor edits, documents over time) [design-5]. |
| S-4 | MDT session (in S-3) | Started with "Zahájit MDT" on a calendar day (start dialog: the day's order and the attendance) or from a case header. While it runs, every case on that day's agenda shows a session bar at the top of the patient view, sticky under the top bar on wide screens: the cases as pills (time and surname, the open one highlighted, approved ones ticked), previous and next, "Přítomní (n)" (the attendance dialog) and "Ukončit MDT". A pill opens that case on the same tab. Nothing else in the patient view changes. |
| S-5 | Projednání na MDT (card in S-3) | Directly under the "Závěr MDT" field in the "Stručný přehled" block: the attendance for the case's day as a list with "Upravit"; "Záznam diskuse" with "Ruční poznámky", "AI záznam" [ui-shot 17.06.14 (1), (2)] (off by default; "Spustit záznam" starts at once; one recording runs for the whole meeting and each word is filed under the case open when it was spoken, so moving between cases moves the transcript, append-only, with hh:mm per line; a case with an approved conclusion gets no more words, and when every case of the running seminar is approved the recording stops by itself; after approval the case's audio is transcribed again with speakers numbered "Mluvčí 1, 2", replacing the live text it covers, and then deleted; an LLM then writes a one or two sentence summary ("Shrnutí AI": decisions and next steps; on the Worker labelled "Shrnutí AI · návrh" and stored apart from the conclusion), shown above the transcript; on the Worker the transcript and the audio are stored on the server while the case is discussed, the speaker pass runs there after approval and survives a closed tab, and a failed pass shows its reason with "Zkusit znovu" while the audio is kept (until the case closes, at most 7 days), which folds into a closed panel; the header shows a pill while recording; the demo uses ElevenLabs with fictitious speech, at FNO an in-hospital speech server) and "Dokumenty" (documents brought to the meeting ad hoc, dropped or picked, listed as uploaded with size, who and when; the demo keeps only the file names in the browser and does not read the files); "Další kroky" (tasks with assignee and due date, copy); "Schválení závěru" (one button, "Schválit závěr MDT", with "schvaluje za tým: <doctor>"; after approval "Uzavřít případ" while the case is "Projednán", and "Nový závěr (nahradí platný)"). Collapsed outside a session unless a draft or an approved conclusion exists; open and outlined in a session. The report is not in the card: the header's "Stáhnout report (PDF)" opens a dialog with the fields for the report, the preview and the download. |
| S-7 | Administrace | The access log across all cases, visible only to the administrator user [design-5 00:16:26]. |
| S-8 | Personál pracoviště | The department staff (title before, surname, title after, optional function) and the MDT coordinator, per department, with a way to add a department. The coordinator and the administrator edit it; doctors read it. The attendance grid and the user picker are built from it (round 23). |
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

| Element (Patient Detail and its MDT discussion card) | FNO spec | Soňa's section |
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
| 16 | Labs: rows are tests, columns are draw dates and times; click a test to see its trend as a chart. The date matters. | Soňa | [design-5 00:13:43 to 00:14:34] | F-21: lab matrix and chart, shown only where the documents hold at least two dated draws (synthetic patient S01, round 24); case 10's one undated set is shown as document values only. |
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

## Feedback round 4 (2026-10-16)

Written feedback on mock v3 [juro-round3].

| # | Feedback | What changes |
|---|---|---|
| 1 | The mock data has no birth numbers, which is fine for a mock; in the real system the RČ is a must-have. | Recorded: RČ is required in the real patient identity (F-01, F-02). |
| 2 | Age as a number only. | S-1, S-3: "65", no unit or marker; the tooltip says when it is computed from the birth date. |
| 3 | The MDT brief block (brief, question, conclusion) sits directly under the name and identity; the tabs (Přehled, Anamnéza, ...) come below it. | S-3: the block is shown above the tabs on every tab. |
| 4 | Remove the Historie tab. | S-3: tab removed. Earlier conclusions stay readable in the conclusion box ("Předchozí závěry", with each approved report), so the decision history is still append-only and visible; the doctors' edit log moved to Administrace. |
| 5 | The brief should read like a clinician's summary (example: a dense paragraph with "st.p.", histology, TNM, receptors, treatment lines, current indication), with the staging in the first sentence. | F-16: the v3 brief is rewritten in that style, starting with histology, grade and TNM; every clause keeps its numbered source. |
| 6 | The labs view is liked. | No change. |
| 7 | The documents list should be filterable. | S-3: search plus Excel-style filters on type, readability and year. |

## Feedback round 6 (2026-10-16)

Soňa's written model of the summary block [juro-round3], applied to the
patient detail and recorded as the design for F-16.

- **Separate fields, each prefilled where the documents allow:**
  oncological summary (short, chronological, factual, only what the
  decision needs); reason for presenting at the MDT (one sentence, why
  now); question for the MDT; proposed management; MDT conclusion (only
  after the MDT).
- **Missing or conflicting data is shown next to the summary**, never
  silently filled in (for patient 10: M0 only per the initial
  documentation and read from "MO"; age and birth number missing; the
  neurosurgical seminar's result missing; no explicit question or
  proposal; possible spine lesions of uncertain origin; date of the last
  visit missing).
- **Length follows the clinical question, not the amount of
  documentation.** What the summary holds depends on the type of MDT:
  - new diagnosis: age, diagnosis, histology, TNM, key staging exams,
    clinical state; question: primary strategy;
  - after surgery (adjuvant MDT): diagnosis, procedure, definitive
    histology with risk factors, current state; question: adjuvant
    treatment;
  - recurrence or progression: original diagnosis, main earlier lines,
    response, new findings, current performance status; question: next
    step.
- **Deliberate deviation:** in her example the assistant also drafts the
  question and a proposed management that names a treatment option
  (stereotactic radiotherapy). `CLAUDE.md` does not let the assistant
  recommend treatment outside the guideline layer, so in mock v3 the
  proposed management is a field the referring doctor fills in, labeled
  "návrh lékaře, ne rozhodnutí MDT". Whether the assistant may draft a
  proposal is in `OPEN_QUESTIONS.md`. The question, when the referral
  has none, is drafted by the assistant and labeled as a draft (round 22).

## Feedback: one patient view (2026-10-16)

The product owner's written feedback on mock v3.

| # | Feedback | What changes |
|---|---|---|
| 1 | The view shown at the MDT should be the patient view the team opens from the database, not a different screen. | S-3 is the only patient view; S-4 is a session mode of it. |
| 2 | The discussion record, next steps and approval belong in the patient view once the MDT starts, not on a separate page; the PDF export can sit in the header. | S-5: the "Projednání na MDT" card under the conclusion; "Stáhnout report (PDF)" in the case header. |
| 3 | During the meeting only the header should change, showing the other patients so the team can click between them. | S-4: the session bar with the day's cases; a click keeps the tab. |
| 4 | No separate 30 to 60 second summary. | The brief in S-3 is the summary at the meeting. |

## Feedback round 19 (2026-10-17)

The product owner's written feedback on mock v3, as built.

| # | Feedback | What changes |
|---|---|---|
| 1 | The "MDT Workspace" logo should take you home. | The logo in the top bar opens the patient database. |
| 2 | From the committee's decisions, suggest the to-dos per patient and summarize them for the oncology coordinator, in the app and maybe by email. | After approval, the assistant drafts tasks from the approved conclusion with phrase rules ("kontrolní MR", "odeslat k", "radioterapie", "kontrola za", "doplnit"); a clause with a negation word (není, nejsou, ne, nebude, nelze, bez, nedoporuč-, neindikov-, neprovád-) drafts nothing. Each draft quotes its clause, is labeled "Návrh asistenta, nepotvrzeno", and becomes a task only when a doctor confirms it (who and when are kept); others see it read-only as "čeká na potvrzení lékařem"; a dismissed draft stays in the history. Only "za N dní / týdnů / měsíců" with a single N gives a due date (months by calendar month), labeled "vypočteno ze závěru"; a clause with a date, a month or year, or a range ("za 2-3 měsíce") gets no date, shows its own wording, and is labeled "termín doplní člověk". The label stays on the confirmed task. "Moje úlohy" has a third view, "Úlohy po MDT": every task and draft across patients, grouped by case ID and surname, with status, owner, due date, and a link to the case. "Odeslat přehled e-mailem" records a mail whose body is only "N úloh čeká na vyřízení" and the app link, no names, case IDs, or diagnoses; the screen says so. |
| 3 | Drag a booked patient back to "Nenaplánovaní" to unschedule. | The card highlights as a drop target for a booked patient and frees the slot on drop. Booking and freeing a slot are written to the access log. A discussed case (status "done") keeps its slot: it cannot be dragged, moved, or freed, and its card says why. |
| 4 | Sessions may run longer than the seminar hours. | On a seminar day every slot outside the seminar hours can be booked; such slots are hatched and say "mimo čas semináře", and a booked one shows a "mimo" marker. The default range runs from 30 minutes before to one hour after the seminar. |
| 5 | The editable status text should not be underlined all the time. | The underline shows only on hover or keyboard focus. |
| 6 | The oncology summary is too long, repeats each date, and uses too many colours. | The line text no longer repeats the date in the left column (dates of other events and ranges stay; the plan line keeps "kontrola 9.10.2026" because its row date belongs to that one item); no pastel bands or stripes, only fine dividers; the timeline's category icon (dashed when planned) sits next to the date, and the date of a systemic-therapy row has the tooltip "zahájení léčby"; smaller rows. |
| 7 | No counts in the alert labels. | The toggle, the tab, and the headings say "Upozornění" without numbers. Missing-document alerts stay visible without a click: under the toggle the brief lists the missing items relevant to the MDT question, one line each, under "⚠ Chybí dokumenty a údaje". |
| 8 | Show past decisions next to the guideline edition valid at the time. | A passive eight-column table shows finding, area, severity, guideline name, year, verbatim passage, documentation quote and possible clinical consequence. Source links remain available. No rating, reason or confirmation is required (user decision 2026-10-17). Missing severity and consequences remain missing; existing clinician assessments are read-only. A comparison row alone does not establish a deviation. |
| 9 | Order the recommendations by strength, not by country. | Statements under the proposed management are one list per field (oncology; other fields), strongest first, with a common tier next to the original grade (below). Literature stays separate. |

**Strength tiers.** The tier is read only from the statement's own
grade; the original grade is always shown with it.

| Grading system | silné | střední | slabé |
|---|---|---|---|
| ESMO, EANO (level I-V, grade A-E) | grade A | grade B | grade C |
| GRADE wording (ASTRO, EASL) | strong recommendation | - | conditional or weak recommendation |
| ESC classes | I, III (against) | IIa | IIb |

Chapter text without a grade, an abstract that does not state the
strength, and ESMO grades D and E (not in our data) are "neuvedeno". The
level of evidence (for example EASL "LoE") is not the strength. The
categories of Modrá kniha ČOS and NCCN (1, 2A, 2B, 3) state the level of
evidence and the experts' consensus, not the strength, so they sort as
"neuvedeno"; the chip shows only the tier, and the opened entry names
the category and says it means evidence and consensus (round 21). A
statement graded more than once (EANO and ESMO, or one grade per drug)
shows the range ("střední až slabé") and sorts by its strongest grade,
so the tier never hides a weaker one. The order states the guideline's
own strength, not which option suits the patient; a sentence in normal
text at the top of the list says so. The original grade is in the opened
entry.

## Feedback round 20 (2026-10-16)

The product owner's written feedback on mock v3, as built.

| # | Feedback | What changes |
|---|---|---|
| 1 | The new patient form asks for too much. | Step 1 "Žádost o konzultaci" requires only Jméno, Příjmení, Rodné číslo and the GDPR consent, marked with *. "Import z FHIR" fills the form from a pasted or chosen FHIR Bundle (Patient with the birth number under `https://ncez.mzcr.cz/fhir/sid/rcis`, Coverage with the insurer under `.../sid/kp`, ServiceRequest with requester, note and reason); it lists the fields the data lacks and never ticks the GDPR consent. The referring doctor's name, workplace, e-mail and phone carry `autocomplete` tokens; the patient's fields are `autocomplete="off"`, so the browser never offers the doctor's own name for the patient. "Pokračovat" checks them and shows an inline Czech message next to each missing field (and a format message for a malformed birth number; the hint says "kontroluje se jen formát"); typed values are kept. A birth number that matches an existing patient (ignoring "/") shows an inline warning with a link to that case, and a second record needs "Přesto vytvořit nový záznam", which the access log records, so patients are never duplicated silently. An empty "Odesílající pracoviště" stays empty and shows as "-", never a made-up default. Anamnéza says "nepovinné, asistent ji sestaví z dokumentace"; the MDT question, insurer, doctor, workplace, e-mail and phone are optional (F-02). |
| 2 | How do I change the status, for example close a patient after the MDT? | The lifecycle is explicit: Nový, Naplánován (booking), Připraven, Projednán (approval), Uzavřen (a person closes it). The status chip in the case header is a menu with the allowed moves for doctors and the coordinator and the append-only status history for everyone; the administrator only reads. Each change is in the access log. After approval the "Projednání na MDT" card offers "Uzavřít případ". Closed cases leave "Nenaplánovaní" and are greyed in the database. A closed case takes no new conclusion: the conclusion field, the approve button and "Nový závěr" are replaced by "Případ je uzavřen; znovu ho otevřete v menu stavu", so nothing reopens it silently. Each approved decision stores its slot, and that slot can never be moved or freed, also after "Nový závěr" or closing. Closing a case whose slot has no approved decision frees the slot; the access log and the confirmation say so, and reopening such a case returns it to Nový (F-12). |
| 3 | Approval is getting busy; is a named doctor needed when accepting for the team? | The name stays, because each decision must record which doctor confirmed it (CLAUDE.md). One button, "Schválit závěr MDT", with "schvaluje za tým: <doctor>"; approving adds that doctor to the day's attendance if missing, instead of asking them to mark themselves present. Non-doctors see the button disabled with "schvaluje lékař". A written conclusion is still required, decisions stay append-only with who and when, and the report is frozen at approval (F-24). Typing in the conclusion field never re-renders it (that broke phone keyboards and Czech dead keys); the approve button, the draft note and the card's chip update in place, and a written draft opens the discussion card. |
| 4 | The report picks make the discussion card busy. | The "Report" section left the card. "Stáhnout report (PDF)" in the header opens a dialog with the "Do reportu" ticks (disabled and taken from the snapshot after approval), a collapsed "Náhled reportu", and "Stáhnout" (F-31). The report's source markers now carry their numbers ("[1]"); they printed as empty brackets. |
| 5 | The "Další diagnózy" line should look different from the rows above. | It is set in italics. |

## Feedback round 21 (2026-10-17)

The product owner's written feedback on mock v3, as built.

| # | Feedback | What changes |
|---|---|---|
| 1 | The guideline layer hides behind a toggle and every statement shows everything at once. | "Navrhovaný postup" shows the layer open, with no outer toggle (the "vrstva doporučení" switch stays). One sentence at the top says the order is the strength the guideline itself states, not a ranking of options for the patient. Each entry is a headline: the verbatim quote (on screen a quote over 160 characters is clamped to three lines and marked "(citace zkrácena, rozbalte)", unless it contains a condition word such as if, unless, provided, except, pokud, při, which would be cut off; whole when opened) and one chip with the common tier ("síla: silné"). A click opens "Proč:" with the documented facts the statement rests on, each with links to its source pages, then in small italics the guideline name, society, year, type of guideline, section, page, the original grade as printed ("původní označení", with the meaning of ČOS and NCCN categories) and "otevřít v doporučení". PubMed literature is its own section below, "Literatura z PubMed · není doporučení", with the same entries: a verbatim abstract sentence, the chip "literatura, ne doporučení", and the reason, other sentences and the reference when opened. The fact-to-source links are curated in `mocks/src/data/guideline-fact-refs-case-10.json`; a fact without a curated source says "zdroj nedohledán". |
| 2 | The prospective deviations table belongs with the plan. | The "Odchylky od doporučení" table (MDT plan against the quoted statements) sits in "Navrhovaný postup" below the recommendations. The other tab is "Retrospektivní odchylky" and holds only the retrospective list. |
| 3 | A past decision must be compared with the guideline edition valid when it was made. | Each retrospective item quotes the Modrá kniha edition valid on the decision date (verified verbatim in `mocks/src/data/guidelines-case-10-past-historic.json`), shows the edition, year, version, "platné od ... do ...", the date the edition was chosen for, section, page and original grade, and opens that edition's PDF online at the page. Further passages from the same edition sit behind "Další pasáž z téhož vydání". With no passage in the valid edition the item says "vydání platné v době rozhodnutí pasáž neobsahuje"; with no lookup it shows no quote, never one from a later edition. The note under the list says the edition valid at the time is used and that mid-year online amendments of past editions are not archived and were not checked. |
| 4 | Preserve recorded severity without requiring a rating. | The comparison table is read-only. Missing severity stays missing; previously recorded clinician ratings retain their attribution. |
| 5 | The missing-document list under the brief is too loud. | The inline list is gone. When documents or data are missing, the "Upozornění" button is filled amber and says "⚠ Upozornění · chybí podklady" (no numbers); the list is one click away (CLAUDE.md, team decision 2026-10-17). A case the mock has not processed shows, in place of the button, an amber "Chybějící podklady nezkontrolovány (případ nezpracován)": the check has not run, which is not "nothing missing". |

## Feedback round 22 (2026-10-17)

Soňa reviewed the "Otázka pro MDT" box and the per-patient summaries.
Team decision 2026-10-17: when the referral has no explicit question, the
assistant drafts one (recorded in `CLAUDE.md`, "A draft is never shown as
approved").

| # | Feedback | What changes |
|---|---|---|
| 1 | A document's stated purpose that already is a task ("bude prezentován na NCH semináři k posouzení indikace NCH intervence", "vyčkáme Vašeho doporučení") is the question; showing "Výslovná otázka neuvedena" is wrong. | Kind "document_purpose": the purpose sentence is rephrased as a question that stays faithful to it, labeled "Otázka podle účelu v dokumentu · návrh, ověřte", with the verbatim passage ("Účel v dokumentu: „...“") and a link to its page. Patients 9, 10 and 17. |
| 2 | Where the referral says nothing, the doctor infers the question; the assistant should too, and the doctor corrects it (Opletal: tumour or degenerative, for surgery?; Kabátová: does the radiologist agree, surgery?; Palajová: coiling of the ICA aneurysms?; Potužný: NCH resection or replacement of C6-Th1?). | Kind "assistant_inference": a short question in clinical style, labeled "Návrh otázky (asistent, ověřte)", with the passage it rests on ("Vychází z: „...“"). Disease status keeps the documents' wording (charakteru, v.s., nelze vyloučit). Patients 11, 15, 18, 19 and 20. |
| 3 | Drafts are confirmed by a doctor. | "Potvrdit otázku" (doctors only) stores who and when; the label becomes "otázka potvrzena: <lékař>", and the confirmation goes to the edit and access logs. The pencil edit replaces the draft with the doctor's text ("doplněno lékařem"). An explicit question from the referral is shown as before, without a label. The gap wording "Výslovná otázka neuvedena v dostupné dokumentaci" stays only when there is neither a question nor a draft. The calendar card shows the same label; the report and the FHIR export print a draft as "[... návrh asistenta, neověřeno lékařem]" with the passage, a confirmed draft with who confirmed it. |
| 4 | "Otakar" is a normal Czech first name, so "Jelen Otakar" is correct and "Ověřit identitu" is alarming. | The name stays surname Jelen, first name Otakar everywhere. The identity tag is gone; the header has a neutral note "jméno a příjmení ve formuláři prohozené" with a link to the form. The case is no longer "Vyžaduje pozornost" for this. It is a form error, not an identity conflict between documents. |

The drafts and their source passages are in `mocks/src/extract/buildlist.py`
(patients 2 to 20; each quote is checked against the OCR text when the
list is built) and `mocks/src/extract/build10.py` (patient 10).

## Feedback round 23 (2026-10-17)

Soňa wants to enter the department staff herself, as title and surname
(no first names, for example "doc. MUDr. Novák, Ph.D."), rename them later
and add more people. Design by the team lead.

| # | Feedback | What changes |
|---|---|---|
| 1 | Staff entered by the department, not hardcoded. | New screen S-8 "Personál pracoviště" (nav item "Personál"): per department a list with "Titul před", "Příjmení", "Titul za" and an optional function, plus the MDT coordinator and "Přidat pracoviště". The coordinator and the administrator edit; doctors read it. Attendance (F-22), the user picker and the coordinator's assignments derive from the list at render time (F-39). |
| 2 | Real names must never be in git or in the published page. | The defaults stay fictional; the default radiologist is now "MUDr. Šimek" (the earlier name matched a real FNO radiologist). Typed names are saved only in this browser (localStorage key `mdt-staff-v1`), and the screen says so: "Jména se ukládají jen v tomto prohlížeči; v reálné aplikaci personál spravuje nastavení pracoviště nemocnice." "Obnovit výchozí (smyšlená jména)" restores the defaults and clears the stored list. |
| 3 | Renaming and removing must not rewrite the past. | Decisions, frozen attendance, status history and the access log keep the name they stored. A rename moves open tasks, task drafts, unapproved next steps, case owners and live attendance to the new name; a removal drops the person from live attendance and the picker only. A duplicate name or an empty surname is refused. Every change is logged ("přidal(a) do personálu: Radiologie, ..."), without patient data. |
| 4 | In the attendance grid, an extra row's empty choice read "odebrat", which looks like an option. | Every row's empty choice is "vyberte…"; an extra row has its own ✕ to remove it. |

## Feedback round 24 (2026-10-17)

The product owner and Soňa reviewed the drafts of round 22 and the lab
tab; a separate review agent checked the question drafts.

| # | Feedback | What changes |
|---|---|---|
| 1 | Do not invent data. The lab trend of case 10 ran on an invented series. | The invented series is removed; case 10 shows "Hodnoty z dokumentu" only, with a note that a trend needs at least two dated draws. "Vývoj v čase" is shown only for a patient whose documents hold at least two dated draws. |
| 2 | The trend needs a patient whose documents really hold a series. | Synthetic patient S01 (Křemínek Radovan, case `NO-S01`, [`samples/README.md`](../../samples/README.md)) joins the database after FNO's patients, marked "syntetický pacient" in the list and the header, unscheduled. Its view adds "Dokumenty" (page viewer), "Laboratoř" (four draws; every value and every draw date opens its line on the lab sheet; no "syntetická data" banner, because the values are from its documents) and the amber "chybí podklady" button with the three missing documents. Its explicit MDT question is shown as written. |
| 3 | Reason and question read as two blocks, and the question repeated the finding the reason already states (Soňa). | "Důvod a otázka pro MDT" is one paragraph: the reason, then "Otázka:" and the question; the draft label is a small chip at the end of the paragraph. The plain "Otázka pro MDT" box (cases without a reason) shows the question with the chip at its end. Case 10's draft is shortened to "Jaký postup doporučuje neurochirurgický seminář?". |
| 4 | Drafts named treatment options nobody proposed. | A draft names only options the doctor suggested or a document states: Potužný keeps "resekce, náhrada obratlových těl" without "stabilizace"; Kabátová asks "Je indikováno operační řešení, nebo sledování?"; Jelen asks "Jaký postup doporučuje NCH u intraoseálního ložiska kalvy F vpravo (DD intraoseální meningeom x MTS)?". |
| 5 | A draft showed one passage, though it cites several findings. | `question_basis` lists every passage: the purpose sentence ("Účel v dokumentu"), then each cited finding ("Vychází z"), each verbatim and checked against the OCR text, each with its page link; the report and the FHIR export print them, and the export adds a Provenance for them. |
| 6 | Confirming a draft appeared in the edit list as a text change. | The edit log records `{confirmed: true}`; the admin's list says "potvrdil(a) návrh otázky" and shows the unchanged draft. |
| 7 | Anyone could upload or remove documents in "Projednání na MDT", even after approval. | Only doctors and the coordinator upload or remove, never on a closed case or after approval; other roles see why. |
| 8 | Scissors do not say "operation". | The surgery category uses our own scalpel icon in Lucide's style. |

Mock v2 no longer raises "Ověřit identitu" for Jelen (the swapped name
fields are a form error, round 22).

## Feedback round 25 (2026-10-17)

The team's doctor reviewed mock v3 as built in round 24.

| # | Feedback | What changes |
|---|---|---|
| 1 | The explanation lines of case 10's lab table ("Jediná sada hodnot...", "Pro všechny hodnoty: ...") push the values down. | They sit in a collapsed "Zdroje" at the bottom of the card, as on the other cards. |
| 2 | "Onkologický souhrn" is very long. | Its body scrolls inside the card. On wide screens the card is as tall as "Aktuální stav pacienta" next to it; on narrow screens it keeps the normal flow with a maximum height of 60 % of the screen. |
| 3 | "!" (ověřit čtení) shows on words that are obviously right ("výborně", "nevolnost"). | `mocks/src/extract/ocr_confidence.py` checks every OCR note against the two readings in `data/derived/page-index.json`. The mark is dropped when the vision transcription and Tesseract read the word the same after removing diacritics, case, punctuation and spaces, or when the vision word is a known Czech or medical word and Tesseract differs by one character that is not a digit, a negation prefix or a unit. It stays when the readings differ in a digit (Tesseract "MO" against "M0"), a negation, a unit or meaning, when one engine did not read the word (Tesseract skipped the medication lines of page 2), or when the note itself states a doubt. The known-word list is a stand-in for a real Czech and medical dictionary: the team-reviewed Czech text of the case data plus a few clinical terms. The result is stored as `ocr_check` next to the note, which stays as the record of the old text layer's misreading. In "Aktuální stav pacienta" all five marks went (výbormně, nevolnoist, ná/ez, fenomenu, j izvy: both readings agree; the first two are typos in the document itself). |
| 4 | An alert that has been dealt with should leave the list, reversibly. | "Vyřešeno" per alert next to "Vzít na vědomí"; both can be undone with "Vrátit". Every action is appended to a history with who and when (shown under "Historie") and written to the access log; nothing is edited. Resolved alerts sit in a collapsed "Vyřešené (n)" at the bottom. A missing-document alert can be resolved too, but the brief's "Upozornění" button stays amber while any missing-document alert is unresolved or the brief lists missing data. |
| 5 | "Změna" is a summary of events, not an alert. | The kind is removed. Its content (progression on CT 26.8.2026, everolimus from 3.9.2026, the suspected cerebellar metastasis on MR 14.9.2026) is in the oncology summary and the timeline. |
| 6 | "J-" at the end of page 5 is a handwritten page number, not a cut-off conclusion. | The alert and the two "i" notes about it are removed. The mock has no page-order logic; the handwritten numbers are used only as evidence in item 8. |
| 7 | Double-clicking a booked patient in the calendar no longer opened the case. | Cause: the first click opened the patient card and scrolled it into view, and on narrow screens the re-render reset the grid's sideways scroll; either moved the slot from under the pointer, so the second click hit another slot or nothing. The card now scrolls into view only after the double-click window, and the calendar keeps its scroll position within the same week. Tested with a double click and with two quick clicks at 1280 and 400 px. |
| 8 | The everolimus alert ("možná text ze dvou různých kontrol") should say which record is the latest. | The text shows one report, not records from several visits: the handwritten page numbers (page 4 "1", page 1 "3") give the order 4, 5, 1, 2, 3, and page 2 ends "Cabozantinib na" where page 3 continues "par. 16 ponecháme do 4. linie". The latest (and only) outpatient conclusion is on page 3 (a visit after MR 14.9.2026; the report date is blacked out); it states "proto navyšuji Everolimus na 10mg denně", and the treatment on page 2 the increase to 2-0-0 from 19.9.2026. A "Chronologie" observation replaces the alert and says that the conditional sentence "Při dobré toleranci navýšíme..." on page 3 does not fit this order and that whether it was copied from an earlier visit cannot be told from the document. The summary row, the medication line, the timeline and the guideline facts now say the increase from 19.9.2026 is recorded in the latest conclusion. |
| 9 | Out-of-range labs are not alerts. | The alert "Laboratoř mimo uvedené rozmezí ..." is removed; the lab tab still marks the values. |
| 10 | Zápotocký's draft named "sledování, nebo operační řešení", which nobody proposed. | The draft is "Souhlasí radiolog s obrazem v.s. ependymomu či subependymomu postranní komory vpravo? Jaký další postup?". |
| 11 | In case 10's reason and question, the reason's hidden pencil left a gap before "Otázka:". | The pencil is taken out of the text flow and shown raised on hover, so it takes no room. |
| 12 | The database "Diagnóza" column mixes headlines and narrative. | Every diagnosis is a headline like case 10's, from the documents (sources in `mocks/src/data/mock-case-10-extra.json`, `others[].diagnosis_source`). |
| 13 | Eight patients per page is too few. | 20 per page. |
| 14 | "MDT brief" is not the doctors' word. | The block is "Stručný přehled" everywhere doctors see it, as for unprocessed patients. |

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
| F-02 | Case intake | Fill in FNO's consultation request (identity, history, imaging, current state, referring doctor, question for the MDT) and upload PDFs. Only Jméno, Příjmení, Rodné číslo (format checked) and the GDPR consent are required; "Pokračovat" shows inline Czech messages next to the missing fields. The history is optional because the assistant builds it from the documents, and the MDT question can be added later in the patient view; when the referral has none, the assistant drafts one, labeled as a draft until a doctor confirms or edits it (round 22). Identity read from documents; disagreements shown. A birth number already in the database warns with a link to that case and needs "Přesto vytvořit nový záznam"; on the server (API mode) the access log records that the second record was made knowingly, and the server checks the duplicate again when it saves (an optional reason sent by a client is stored with the case, never in the log). On the Worker the step "Dokumenty" also offers "Nahrát z telefonu": a QR code opens a small upload page on the phone, and its files join the intake's list marked "z telefonu" ([PHONE-UPLOAD.md](PHONE-UPLOAD.md); the same button sits in S-5's "Dokumenty" and in S-3's "+ Nahrát dokument" dialog). | Demo | Case's entry point; inputs | [design-1 00:05:41, 00:07:13, 00:30:02; chatgpt R 12:27, R 10:29] | Upload replaces the hospital API in the prototype. The question for the MDT decides which checklist items matter [chatgpt R 10:29]. |
| F-03 | Readability check and re-upload request | Each document gets a reading certainty; a poor photo or scan gets a warning and a request to upload a better copy; unreadable parts are marked. | Demo (basic) | PŘEČÍST (read) | [design-2 00:02:36; chatgpt P 15:00] | Judge the text itself, not whether a text layer exists: FNO's PDFs have text layers with poor OCR ("1112023" for 11/2023, "MO" for M0, "lmg/kg"), and such misreads change dates, stages, and doses. Soňa endorsed the check as core. Asking the sender by a deadline [design-2 00:04:59] is Later. |
| F-04 | Wrong-patient and duplicate flag | A document that may belong to another patient, or was uploaded twice, is flagged. | Pitch | - | [chatgpt R 15:00] | ChatGPT only. Serves the "two patients mixed up" failure case. |
| F-05 | Per-document extraction | For each document: exam date, report date, date received, exam type, conclusion, with source. "Latest finding" is not "last uploaded". | Demo | Findings overview; PARAMETRIZOVAT; SEŘADIT | [design-1 00:23:40; chatgpt P 11:54, R 11:54, R 14:36] | Soňa asked to use the latest data; ChatGPT split the three dates. |
| F-06 | Structured anamnesis | Czech sections: osobní, rodinná, pracovní, sociální, farmakologická, alergologická, abusus, epidemiologická, with what to extract for each. Pack-years (cigarettes per day / 20 x years) shown as computed, with inputs, per period when intensity changed. | Pitch | Clinical finding; PARAMETRIZOVAT | [chatgpt P 14:33, P 14:36; ui-shot 17.07.06] | Soňa: "anamnéza super". Round 2 [design-5 00:07:30 to 00:10:31]: diagnoses in bold with qualifiers in plain text, written out in Czech; drugs as a table (name, strength, dosing, when or indication, change), no dates; "kuřák", not "fumátor"; uncertainty as icons with the detail on hover or tap; no method notes. Preventive exams tab Later. No pack-years when start age is missing. |
| F-07 | Missing-documents alert after upload | Right after upload, an alert lists what was not found. Always on, not part of the guideline layer. Few, prioritized alerts: mock v1 showed so many that Soňa found it overwhelming [design-4 00:02:30]. | Demo | Missing documents; ZKONTROLOVAT | [design-1 00:36:13; design-2 00:02:36; chatgpt P 14:57; juro-notes] | Juro wants "done but not available" apart from "not done"; from documents we can usually only say "not found". |
| F-08 | Readiness checklist | Per case: pathology, radiology, staging, comorbidities, previous treatment, other findings; each available, missing, needs review, or not applicable; the doctor can change it. Also shown as the upload checklist. | Pitch | Missing documents | [chatgpt P 15:52, P 15:54; design-2 00:08:25] | Informs, never blocks [chatgpt P 15:54]. Diagnosis-specific items (glioma markers) are ChatGPT's and unverified [chatgpt R 15:52]. |
| F-09 | Conflicting and outdated alerts | Two sources that disagree, or a value that may be too old for this MDT, each with "view source". Ranked by relevance to the question. Kinds: Chybí, Rozpor, Chronologie, Nejasné; a summary of events and an out-of-range lab value are not alerts (round 25). Each alert has "Vzít na vědomí" and "Vyřešeno", both reversible with "Vrátit", kept as an append-only history with who and when and written to the access log; resolved alerts sit in a collapsed "Vyřešené (n)" list. | Demo (conflicting); Pitch (outdated) | Contradictions | [chatgpt P 09:24, R 14:57] | Change over time is not a contradiction. |
| F-10 | Ordered test vs needed markers | When a broad test was done ("biochemie"), check the result has the specific markers the decision needs. | Later | Missing documents; lab trends | [juro-notes] | Needs synthetic labs; FNO data has none. |
| F-11 | MDT calendar | Put a case in a 10-minute slot on a seminar day; each slot shows its time, the case ID and the name; week arrows, "Dnes", and a month grid with a year picker; clicking a case opens its card in the right third; move or free a slot. | Pitch | - | [design-1 00:05:41, 00:08:18; design-4 00:01:36; chatgpt P 10:29, P 14:02; paper-notes ui_scribbles] | Round 2: 10-minute slots, times shown, names shown, month and year navigation [design-5 00:01:00 to 00:02:50]. Round 1 asked for about 15-minute slots [design-4 00:01:36]; earlier 5 minutes [design-1 00:05:41] and 10 to 15 [paper-notes more_notes]; time per patient stays an open question. Members open cases the evening before [design-1 00:16:16]. |
| F-12 | Case status and filters | Nový -> Naplánován (set by booking a slot) -> Připraven -> Projednán (set by approving the MDT conclusion) -> Uzavřen (closed by a person); "Vyžaduje pozornost" is a side state for a problem that needs action. The status chip in the case header is a menu: doctors and the coordinator get the allowed moves (Připraven, Vyžaduje pozornost, back to what the slot says, Uzavřít případ; a discussed case can only be closed; a closed case reopens to the status it was closed from, or to Nový when closing freed its slot; closing frees a slot that has no approved decision, and a closed case takes no new conclusion until it is reopened); "Naplánován" and "Projednán" are never picked by hand. The administrator only reads. Every change, automatic or manual, is appended to the case's status history (who, when, how), shown in the menu, and written to the access log. In the mock "Připraven" is set from the menu; a real build would set it when processing finishes. Closed cases leave "Nenaplánovaní" and are greyed in the database, and a closed case cannot be booked until it is reopened (server rule, step 4; open question in `OPEN_QUESTIONS.md`); a slot with an approved conclusion stays locked after closing. Excel-style filters in the column headers (owner, department, next MDT, status) and a search box [design-5 00:00:03]. | Pitch | - | [design-1 00:16:16; paper-notes more_notes; chatgpt P 14:04, P 14:08] | Status belongs to one MDT consultation, not to the patient. "Needs attention" is for problems needing action, not for gaps. |
| F-13 | What changed since the last MDT | For a returning patient: new events since the last MDT, the previous conclusion, and its tasks. | Pitch | Significant changes | [chatgpt R 14:33, R 14:51] | ChatGPT only; follows from decision 3. |
| F-14 | Stubbed hospital systems | A labeled stub showing where data would come from (NIS, LIS, PACS, INTELIPAT, genetics) and how it is searched. | Pitch | NAJÍT; inputs | [juro-notes; paper-notes ui_scribbles; design-1 00:06:47] | Real integration is Vision. |
| F-38 | Doctor edits | A doctor can correct any extracted or drafted value and fill in a missing one (for example the question for the MDT). A drafted MDT question can also be confirmed as written ("Potvrdit otázku"), which stores who and when and shows "otázka potvrzena: <lékař>" (round 22). The edit is stored next to the original with who and when, marked "upraveno" / "doplněno lékařem", listed in the case history, and can be reverted. The source document never changes. | Pitch | - | [design-5 00:19:27 to 00:20:46] | `CLAUDE.md`: the original text stays findable and unchanged; new documents never silently change confirmed content. Coordinators cannot edit clinical content in the mock; on the server (API mode) only a doctor on the case's team, or with a break-the-glass grant, may edit, confirm or revert, and an edit or confirmation made against a changed value is refused instead of overwriting it. |
| F-39 | Staff list | Department staff entered as "<titul před> <příjmení>, <titul za>" with an optional function (shown only on S-8 and as a tooltip); add, rename, remove; the coordinator likewise. Attendance, the user picker, the coordinator and every assignment derive from it. In embedded mode doctors are the people whose title contains "MUDr." and the list is saved only in the browser (localStorage) with fictional defaults and "Obnovit výchozí (smyšlená jména)". In API mode the list lives on the server; a new person's role is set from the title as in embedded mode ("MUDr." makes a doctor, anyone else staff), and the server decides who is a doctor from that stored role. Every change goes to the access log without patient data. | Demo | - | Soňa, round 23 | A real build reads the staff from the NIS (`Practitioner`, `PractitionerRole`; see `INTEGRATION.md`) instead of a list typed in the browser. History keeps the name it stored. |
| F-37 | Pseudonymization before AI | Before text goes to the AI, the name, birth number, and other identifiers are replaced with a case ID; the doctor still sees who the patient is. | Demo | - | [design-4 00:00:03 to 00:01:23] | Soňa's first feedback point; `CLAUDE.md` "Expose as little as possible". Demo because it is a small step and the jury will ask. Hosting on the hospital's servers (Juro, [design-4 00:01:17]) is Pitch. |

### During the MDT

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-15 | Navigation and layout | Header with Patient Database first, then MDT Calendar; during an MDT session, the day's cases sit in the session bar at the top of the patient view (S-4); panes close and expand. | Demo | Schematic, readable | [design-1 00:07:43, 00:18:16; design-2 00:17:42; paper-notes ui_scribbles; chatgpt P 16:01] | Juro's spoken left/right is mirrored; his sketch (list on the left) wins. Header order from [design-4 00:01:36]. |
| F-16 | Case summary with levels | The Patient Detail overview shows the case summary with the timeline [design-4 00:04:08]. Round 2 [design-5 00:03:21 to 00:06:32, 00:17:06]: the Overview opens with the short summary (the "Stručný přehled" block, round 25), then the question, then the current conclusion; below it the detailed summary: a diagnosis headline (histology, grade, TNM labeled as the stage at diagnosis; MKN-10 code smaller below) and dated rows with the event in bold; then the current state of the patient. The same view is shown during the MDT [ui-shot 17.06.15, 17.06.15 (1)]. Relevant other diagnoses listed. | Demo | Short case summary | [design-1 00:01:52, 00:22:08, 00:25:52, 00:41:44; chatgpt P 14:33, R 14:33, P 16:01; juro-notes] | Keeps the documents' status (suspicion vs confirmed by histology). Age appears only when a document states it (3 of the 10 FNO patients); otherwise the brief leaves age out and the identity header shows "věk neuveden v dostupné dokumentaci". Unrelated visits and private data hidden [juro-notes]. |
| F-17 | Expandable items | Anamnéza, clinical state, imaging, histology, past treatment, question for the MDT; each expands to detail with links. The summary and the finding groups are ticked for the report in the dialog behind the header's "Stáhnout report (PDF)". | Demo | Expandable items; wiki links; ticking | [FNO spec; chatgpt P 14:00; juro-notes] | See the reconciliation above. |
| F-18 | Source view | Every fact carries a numbered reference [1], as in a paper; clicking it opens the passage in the original document. | Demo | Wiki-style links | [design-1 00:42:20; design-4 00:03:45 to 00:04:00; juro-notes; chatgpt R 01:17] | Mock v1's inline source chips in a monospace font disturbed reading [design-4 00:03:55, 00:04:00]. Round 2: the source list under each card is folded away by default [design-5 00:08:47]; unreadable OCR characters are marked in the source view [design-5 00:11:10]. Team decision 2026-10-16: the source view shows the actual page image with the passage highlighted, and the extracted text in a separate tab, so source links can point at the text passage; tokens the OCR engines read differently are marked "ověřit" (mock v4). |
| F-19 | Timeline categories | One horizontal, chronological timeline. Every event has one category icon and label. Category checkboxes show counts and allow multiple selections on the same timeline. All categories start selected; unchecking hides only that category. Vše selects or clears all categories and shows a mixed state for a partial selection. Clicking an event opens its original source. Planned events keep a dashed pin and explicit plan label. | Demo | Timeline view; SEŘADIT | Team decision in Codex chat, 2026-10-17; [design-4 00:06:17] | Categories and source-date rules below. Zero-count categories remain selectable. Clearing all categories shows an explicit empty state. |
| F-20 | Compare current and previous exam | Two reports side by side (for example two MRI reports) with the differences listed as the assistant's observation. | Pitch (text); Later (images) | Significant changes; POROVNAT | [design-1 00:11:45, 00:43:21; paper-notes more_notes; chatgpt P 11:54, R 11:54] | Compare like with like; any computed change (ChatGPT's "34.4% decrease") is labeled. |
| F-21 | Lab value trends | A matrix of tests (rows) by draw date and time (columns), original units and ranges; clicking a test shows its trend chart [design-5 00:13:43]. | Pitch | Lab value trends | [FNO spec; challenge] | Not discussed in the design sessions. The only lab values in the data are one undated set in patient 10's PDF, so mock v3 shows them as "Hodnoty z dokumentu" without a trend; no series is invented (product owner, round 24). The trend ("Vývoj v čase") is shown for the team's synthetic patient S01, whose four lab sheets are documents; every value opens its line on its sheet. |
| F-22 | Attendance | Specialties per department (neurochirurgie, klinická onkologie, radiační onkologie, radiologie, neurologie, patologie) with their doctors pre-filled; set who is present once per session; count present; copy; per-case exceptions. | Pitch | (report) | [design-1 00:14:16, 00:40:26, 00:41:13; chatgpt P 11:54, P 14:33, P 14:36] | Soňa: "jj super attendance" [chatgpt P 14:36]. Decided in round 2: one dropdown per department, filled in once per seminar day [design-5 00:21:35]. Set in the start dialog of a session and edited from the session bar or the discussion card. Approving a conclusion freezes the attendance in that report. Round 23: the doctors per department come from the staff list (S-8, F-39); extra rows say "vyberte…" and have their own ✕. |
| F-23 | Conclusion entry | In the patient view: the conclusion in the brief's "Závěr MDT" field, and under it the "Projednání na MDT" card with "Ruční poznámky", "AI záznam" (live transcript per case, speakers after approval) and "Dokumenty" (ad hoc upload by doctors and the coordinator, not on a closed or approved case), next steps with assignees, and physician approval (S-5). A new draft sits under the valid conclusion until it is approved. | Demo (manual notes, live transcript, ad hoc upload) | (report) | [design-1 00:44:31, 00:46:27; design-4 00:06:35; ui-shot 17.06.14 (1), (2); chatgpt P 12:16, P 14:51] | Replaces the mock v1 conclusion screen, which Soňa disliked [design-4 00:06:35]. Explicit patient selection prevents mixing patients. |
| F-24 | Decision history | Each conclusion is confirmed by a named doctor and stored; a later decision supersedes it, never erases it. One button, "Schválit závěr MDT", with the line "schvaluje za tým: <doctor>"; any doctor may approve once a conclusion is written, and approving adds that doctor to the day's attendance if missing (logged). Others see the button disabled with "schvaluje lékař". | Demo | (report; timeline) | [juro-notes; chatgpt P 12:16, R 14:04] | Decision 3. |
| F-25 | Live listening | Record the discussion per patient, transcribe it with names, draft the conclusion for the doctors to confirm. In the mock: the "AI recording" tab, labeled as a planned feature that needs participants' consent and does not record [ui-shot 17.06.14 (1)]. | Pitch (stretch Demo) | - | [design-1 00:46:27; juro-notes; paper-notes more_notes; chatgpt P 10:14, P 14:51] | Decision 2. Opt-in and consent; patient data. Voice enrolment for names is Later (biometric data). Raw transcript fixed, summary editable [design-1 00:43:31], undecided. |
| F-26 | Query mode | Doctors ask the assistant questions about the case; answers cite sources or say "not found". | Pitch | - | [juro-notes] | |
| F-27 | Guideline layer | Under the proposed management: guideline statements that apply to the documented facts, verbatim, with guideline name, society, year, version, section, page and evidence level, and the patient facts they rest on; a click opens the guideline PDF's page with the statement highlighted. Each statement is a collapsed entry (quote and tier chip) that opens to the documented facts with their sources and the full citation with the original grade (feedback round 21). The "Navrhovaný postup" tab contains the proposal and guideline passages. Deviations are a passive comparison table with no required rating, reason or confirmation. The "Retrospektivní odchylky" tab puts past decisions next to passages from the guideline edition valid on the decision date, never a later one, with previously recorded clinician assessments shown read-only and missing severity or consequences left missing (user decision 2026-10-17). Statements are sorted by a common strength tier. Also (a) review of the path so far for missing information. | Pitch | - (beyond the challenge) | [design-1 00:35:08, 00:46:00; design-2 00:00:36; chatgpt P 12:16, P 14:56, P 16:01, R 14:56, R 16:01; juro-notes] | Decision 1; the line was set on 2026-10-16 (quotes, highlighted source, deviations table; no ranking, never the conclusion). Sources (Juro, 2026-10-16): Czech Modrá kniha ČOS first, then ESMO, EANO, ESTRO, ASTRO, ASCO, NCCN, and guidelines of other fields for comorbidities (for example hepatology, cardiology); PubMed literature for rare situations. Architecture: the client asks the server for a case's guidance (`GET /api/cases/{id}/guidance`, sending the case ID, not patient text); the server keeps a curated, versioned library of guideline texts and returns only the matching statements; the guideline PDF opens from the publisher online at the cited page. In mock v3 an API stub returns data embedded in the HTML. Soňa wants it in ("ja to tam riadne chcem", chatgpt P 12:16), framed later as "možno by sme chceli" (P 14:56); the on/off switch was her idea (P 14:56). Part (a)'s missing-information check is F-07/F-08. Use a small curated, versioned guideline set [chatgpt R 14:56]. Kept apart from the MDT conclusion. |
| F-28 | AI engagement levels | Passive (summarize), on demand (when asked), proactive (an independent assessment formed before the discussion). | Later | - | [juro-notes; chatgpt P 10:14, P 10:27] | Soňa moved from on-demand to proactive because the doctors, as experts, would bias the AI [chatgpt P 10:14]. ChatGPT put it in the roadmap tier [chatgpt R 12:15]. |
| F-29 | Rare-case support | A small warning that a case looks unusual from past MDTs; help finding guidelines and case reports beforehand. | Later | - | [design-3 00:00:52, 00:02:18] | Soňa's answer on flagging is unclear; open question. Literature support is our reading of her need. |
| F-30 | Agenda priority | Facts that could order the agenda (for example days since biopsy). | Later | - | [juro-notes] | Facts only, no ranking verdict. |

### After the MDT

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-31 | PDF report | A PDF with identity, the ticked items, attendees (once F-22 exists), and the confirmed conclusion, usable as a report for the record. Also kept in our app. The header's "Stáhnout report (PDF)" opens a dialog with the "Do reportu" ticks, a collapsed "Náhled reportu", and "Stáhnout"; after approval the report is the frozen snapshot and the ticks show the choice at approval, disabled. | Demo | Output 2 | [FNO spec; design-1 00:33:39, 00:33:55; chatgpt R 12:15, R 12:27, R 14:00] | Pre-MDT briefing and post-MDT protocol are separate [chatgpt R 12:15]. Nothing is written back to the hospital record. FNO also wants the report usable as a request for further examination or treatment; nothing produces request text yet (gap). |
| F-32 | Coordinator task list | Action items drawn from the approved conclusion, each with assignee and due date, a completed count, and copy; a coordinator "My Tasks" screen across patients; an email "MDT - nové úlohy na spracovanie" with only the case ID, the task count, and a link. After approval the assistant drafts tasks from the conclusion's text ("Návrh asistenta"), each a draft until a person confirms or dismisses it; "Úlohy po MDT" lists all tasks and drafts grouped by patient (case ID and surname); "Odeslat přehled e-mailem" sends only "N úloh čeká na vyřízení" and the app link. | Pitch; Later (email) | - | [design-1 00:33:10, 00:49:33; chatgpt P 14:51; ui-shot 17.06.14, 17.07.06 (1)] | "Order MRI" is not "MRI ordered". Not a requisition system. |
| F-33 | Re-check on new upload | New documents re-run the checks and update drafts; confirmed content is never silently changed. | Pitch | - | [chatgpt R 14:57] | ChatGPT only. |
| F-34 | Extra documents for a session | Attach material by hand, for example a photo of paper notes. | Later | - | [design-1 00:16:16] | |

### Cross-cutting

| ID | Feature | What the doctor sees | Tier | FNO | Sources | Notes |
|---|---|---|---|---|---|---|
| F-35 | Retry an AI output | A button to rerun a section. | Later | - | [design-1 00:32:35] | Conflicts with reproducible outputs; keep both versions. |
| F-36 | Mobile web | Works in a phone browser; no app to install. | Later | - | [design-2 00:12:53] | Juro's point. |

### Timeline categories

The team agreed on these labels and icons on 17 October 2026:

| Category key | Czech label | Icon |
|---|---|---|
| `imaging` | Zobrazovací vyšetření | `scan-line` |
| `systemic` | Systémová protinádorová léčba | `syringe` |
| `medication` | Ostatní medikace | `pill` |
| `mdt` | MDT a rozhodnutí | `users-round` |
| `surgery` | Chirurgie a výkony | `scalpel` (our own, drawn in Lucide's style; Lucide has none) |
| `pathology` | Patologie a molekulární vyšetření | `microscope` |
| `radiotherapy` | Radioterapie | `target` |
| `laboratory` | Laboratorní vyšetření | `test-tube-diagonal` |
| `clinical` | Klinický stav a ostatní | `stethoscope` |

The category describes the event, not the document that mentions it. It is
stored as display metadata beside the original kind. Unknown categories
fall under `clinical`; uncertainty remains a separate marker. There is no
"K ověření" category. The compact oncology summary uses the same icons.

The mock's 16 timeline cards keep their wording, dates, sources and planned
status. Mixed procedure/histology cards stay combined: an excision date is
not a newly inferred pathology-result date. Planned outpatient control with
blood tests stays clinical, not a completed laboratory event. Filters use
the original event indexes so opening a source cannot select another event.
All categories are selected when switching patients; choices remain while changing tabs
within one patient. Categorization is fixed mock metadata; it is not a new
extraction pipeline or an editable clinical decision.

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
| Lab value trends | F-21 (Pitch) | Partly: FNO's data has one undated lab set (patient 10), shown without a trend; the trend runs on the team's synthetic patient S01 (four dated lab sheets). |
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
| Inputs: lab results (LIS) | F-21 (Pitch) | Gap for FNO's data, as for lab trends; shown on the synthetic patient S01. |
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
| Guideline layer: treatment options and review of the MDT's plan (F-27, F-28) | "The assistant prepares, the doctor decides", with the guideline layer as the one exception | Allowed. Scope decided on 2026-10-16: verbatim statements with full citation under the proposed management, the guideline opened at the passage, and a read-only deviations table; no ranking, no proposal or conclusion written by the assistant. On by default is still open (`OPEN_QUESTIONS.md`). |
| Assistant drafts the MDT question when the referral has none (F-02, F-38) | "A draft is never shown as approved"; "A suspicion is not a diagnosis" | Allowed (team decision 2026-10-17, now in `CLAUDE.md`). The draft is labeled as a draft with the passage it rests on until a doctor confirms or edits it, keeps the documents' disease status, and is printed as a draft. It may name a treatment option as a question (for example "Je indikováno endovaskulární řešení?"); a proposed management stays the referring doctor's (`OPEN_QUESTIONS.md`). |
| Recording and transcribing the meeting (F-25) | "Meeting audio is patient data" | Covered by the rule. Needs explicit opt-in, participants' consent, and FNO clearance for any speech-to-text service; stretch goal. |
| Voice enrolment to name speakers (F-25 notes) | "Meeting audio is patient data": no voiceprints in the prototype | Not in the prototype; Later at most. |
| Login and the admin layer | "Skip login, OAuth, and scaling"; keep the simple access log | No login: a user picker stands in. Mock v3 has an Administrace screen (S-7) with the access log, shown only when the administrator user is picked; a real admin layer stays Vision. |
| Patient Database and brief show name, birth number, age (F-01, F-02, F-16) | "Expose as little as possible, and protect what is exposed" | Mock v3 shows full names in the database and, at Soňa's request, in the calendar slots (see the calendar row below); the MDT session bar shows time and surname (shown on a shared screen, so the room sees the day's surnames; a case ID would expose less but is harder to recognize), and the coordinator email uses the case number. Identifiers never go to the AI (F-37; Soňa [design-4 00:00:03]); the MDT screens show identity because the team needs it [design-4 00:00:57]. Which other screens need name and birth number is still open. |
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
| "FHIR later if time" [design-1 00:30:35] | Decide FHIR early | Decided 2026-10-17: the demo exports a validated FHIR R4 Bundle (`fhir/README.md`); see `docs/agent/HACKATHON.md`, "Team decisions". |
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
| `[juro-round3]` | Written feedback on mock v3 in the Claude Code session, 2026-10-16, rounds 3 and 4 (no file) | Juro, passing on the team's feedback |

`[FNO spec]` is FNO's output specification and `[FNO deck slide N]` its
challenge deck, both listed in [`REQUIREMENTS.md`](../agent/REQUIREMENTS.md).

Where the rest went: domain facts are in
[`INDEX.md`](../agent/INDEX.md#from-soňas-experience), open questions in
[`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).



## Prognosis evidence search

Team decision 2026-10-17: the patient view adds a Prognóza tab beside proposed management and retrospective deviations. The configured GPT Astra model searches outcomes for similar study populations at the scheduled MDT date. The table separates OS at 6/12 months and 3/5 years, PFS, response, toxicity and treatment burden, with sources, model attribution and an explainable heuristic similarity score. Results remain model extractions requiring source review. The local backend supports synthetic cases 10 and S01. See [the prognosis design](PROGNOSIS.md) for date handling, missing values, interpretation and limits.

### Passive deviations for case 10

The synthetic Poláček case has four curated observations: undocumented HBV assessment/prophylaxis, recorded BP above the general guideline target with individual-target caveats, two documented induction cycles with toxicity, and an undocumented NCH seminar result. Each row references the existing documentation and guideline passages. Potential consequences are labeled as assistant observations, not outcomes already experienced. Severity is not inferred. Other historical comparisons remain in a collapsed read-only table.
