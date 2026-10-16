# Juro's design notes, 16 October 2026

Kept as written (Slovak and English mixed). Processed into the design docs;
do not edit.

```text
edge cases:
- crazy scale
- vizualizacia - ako git - multiple lines for separate conditions, measurements, etc.
- aby to neukazovalo irelevant and private data
- ak je viac pacientov na mdt, ze ktory by mal mat prioritu
- present possible pathways based on different guidelines (US, EU, etc)
- "patolog ti ukazuje sklicko" - in the future, AI could read the sklicko directly
- query/disussion mode - talking with the AI directly

- AI must first summarize patient
  - rozklikable overview osetreni

- along the timeline, you can click on individual events,
  a ked kliknes, tak ti to ukaze kde v sprave / dokumente
  to ukazuje source of truth.

- Decisions can be revoked
  - eg after pacient's stav got worse
  - think of it like git - what was done in the past can't be undone
  - the MDT can be held multiple times.
  - in MDTs, each member does their own reseearch and compiles
    and brings what they learnt to the meeting.
    - How long does the prep stage takes?
    - How long does the MDT meeting itself take? is it single meeting, 
      several meetings, or async? (eg emails thread or Teams threads)
      (or mix of several?)

- Doctors - is it always the same doctors for the patients that already
  have the history with those patients?

- Listen to the discussion, transcribe, summarize, and compare/eval
  if how they are evaluating it is correct against the guidelines.

- AI engagement levels (prefer passive and proactive; on demand may be biased):
  - passive - transcribing, summarizing
  - on demand - when doctor asks
  - proactive - suggest independent review with own suggestions / next steps

- Flag missing info / analyses when compiling the patient data.
  - pod patient summary.
  - warning - there can be 2 cases:
    1. patient DID some analysis / procedure, it's just not availalbe to the system/AI/doctor, or
    2. patient has genuinely NOT done that analysis/procedure
  - How to define what even is "missing info"? - eg from guidelines?
    - or reverse engineer from possible hypotheses and guidelines?

- hierarchical problem:
  - eg someone asks "sprav biochemiu", but "biochemia" consists of
    10s maybe more markers, and it can happen that even tho that patient did get "biochemia", that the needed analysis was not done.
    - so takewaways - even if guidelines or past decisions eg suggested analyses like "spravte biochemiu", we need to recognize whether this action contains
    the metrics we need (or if proactive, consider what metrics need to be measured.)

- How should AI present treatment reco's?
  1. Present guideline-supported treatment options with refs, leaving choice to clinicians
  2. Assess the MDT's proposed treatment and flag potential deviations from guidelines.

- Ideal outcome of the hackathon:
  - (best outcome) Full journney - before/during/after MDT
  - (second best) simulate live MDT

- Hackathon iteration:
  - Let's build the MVP first - what people see, how they'll interact with it
    - This is critical - it blocks the other team members, expressing the ideas
      is more improtant than getting the auth right.
  - the backend can be built later.
  - we can use synthetic / fake data to get things going fast.
  - *how* we obtain the actual data and *how* we plug into hospitals / other medical systems - we should keep this in mind for all data that we suggest to load, but again, it's a separate questions that's downstream of designing the right thing.


- re how to search for data:
  - registry of what data is found in which database/api
  - potentially patient-specific? (eg different patients could have data
    in different places? confirm if true).
  - Go through how the search process happens.
  - always cite sources.


this challenge is specific to neuro-oncological MDT.


- Check for state-of-the-art / latest best practices re MDTs
```
