# Requirements - CodeBridge

What FNO (Fakultní nemocnice Ostrava, the challenge owner) asks for, as a
checklist. Tick an item when the demo does it. Sources:

- "spec": FNO's output specification,
  [`docs/sources/fno/upresneni-vystupu-ai-asistenta.md`](../sources/fno/upresneni-vystupu-ai-asistenta.md)
- "deck": FNO's challenge deck, `docs/sources/presentations/2 - FN Ostrava
  – AI asistent multidisciplinárního týmu.pptx` (doc. MUDr. Ing. Jakub
  Cvek, Klinika onkologická), cited by slide
- "challenge": the challenge text in [`INDEX.md`](INDEX.md#the-challenge)

Our own feature ideas beyond these go in the product doc, not here.

## The goal in FNO's words

"Nechceme další systém, ve kterém bude lékař hledat informace. Chceme
nástroj, který informace najde, uspořádá a připraví k rozhodnutí." (We do
not want another system where the doctor searches for information. We
want a tool that finds the information, organizes it, and prepares it for
the decision.) (deck, slide 9)

## Output 1: presentation app (used during the MDT)

- [ ] Patient identification. (spec; deck slide 7)
- [ ] Short case summary (stručné shrnutí případu). (spec; deck 7;
  challenge)
- [ ] Expandable items (rozklikávací položky) for: (spec)
  - [ ] clinical finding (klinický nález),
  - [ ] imaging (zobrazovací metody),
  - [ ] histology (histologie),
  - [ ] past treatment (prodělaná léčba),
  - [ ] the current question for the MDT (aktuální dotaz na MDT).
- [ ] "Wiki"-style links: click through to more detail. (spec; deck 7)
- [ ] A switchable timeline view; FNO says "ideally". (spec; deck 7;
  challenge)
- [ ] Schematic and easy to read on a shared screen, so the case can be
  presented and discussed at the meeting. (spec; deck 7)
- [ ] Fields can be ticked for the report. (spec)

## Output 2: report (PDF)

- [ ] Generated automatically as a PDF. (spec; deck 7)
- [ ] Contains the patient identification. (spec)
- [ ] Contains the information from the fields ticked in the presentation
  app. (spec; deck 7)
- [ ] Usable as a report for the medical record, or as a request for a
  further examination or treatment. (spec; deck 7)

## Content the challenge text asks for

- [ ] Lab value trends (vývoj laboratorních hodnot). (challenge)
- [ ] Findings overview (přehled nálezů). (challenge)
- [ ] Highlight significant changes (zásadní změny). (challenge)
- [ ] Highlight contradictions (rozpory). (challenge)
- [ ] Highlight missing documents (chybějící podklady). (challenge;
  deck 4, "ZKONTROLOVAT zda něco důležitého nechybí")

## What the assistant does to the data (deck, slide 4)

Today a doctor or coordinator does each of these by hand; the assistant
should do them:

- [ ] find the information in the different systems (NAJÍT),
- [ ] read the documentation (PŘEČÍST),
- [ ] put it together from the different sources (POSKLÁDAT),
- [ ] compare current and previous results (POROVNAT),
- [ ] order diagnostics and treatment in time (SEŘADIT),
- [ ] check that nothing important is missing (ZKONTROLOVAT),
- [ ] turn free text into structured values (PARAMETRIZOVAT).

## Inputs (deck, slides 2, 3, 6)

The deck lists the order "diagnosis, examinations, lab results, imaging,
pathology, genetics, treatment, current state" (slide 2) and these source
systems (slide 3). Only the documents in `data/` exist for the hackathon;
the systems are stubbed (see `CLAUDE.md`).

- [ ] Medical reports, from NIS (the hospital information system).
- [ ] Lab results, from LIS (the lab system). Not in the challenge data.
- [ ] Imaging reports, from PACS (the imaging archive).
- [ ] Pathology, from INTELIPAT (FNO's pathology system).
- [ ] Genetics, from the genetics lab. Not in the challenge data.

## The case's entry point

Each case arrives as an MDT consultation request; its fields are in
[`konzultace-pacienta-form.json`](../sources/fno/konzultace-pacienta-form.json)
(deck, slide 5).

- [ ] Read the request's fields: patient identity, history, imaging,
  current clinical state, referring doctor, attachments, and the question
  for the MDT.
