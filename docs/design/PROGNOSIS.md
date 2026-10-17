# Prognosis evidence search

Team decision, 2026-10-17: add a Prognóza tab beside proposed management and
retrospective deviations. It searches published outcomes for populations similar
to the selected synthetic patient. The doctor interprets those outcomes. The
feature does not choose treatment or create an MDT conclusion.

## Patient and date

The patient's calendar slot supplies the MDT date. An unscheduled patient must be
scheduled before searching. Moving a slot changes the result key; a late response
for another patient or date cannot replace the displayed search.

The local server constructs the outgoing clinical profile from the supported
synthetic source fixtures. The preview shows the included facts and omissions.
Names, birth numbers and source filenames are excluded from the outgoing profile.
Undated facts and facts after the MDT date are omitted. Partial dates retain their
precision and are included only when their entire interval precedes the cutoff.
Historical findings do not establish current status, and plans remain plans.
This version supports case 10 and S01. Other cases show the tab and explain that
they lack a safely dated profile. Browser edits and uploaded content are not
silently sent to an external service.

## Astra search

One user action sends one OpenRouter request to GPT Astra. The exact model ID is
pinned in the server's gitignored configuration and displayed with the result.
The public model catalog is checked before execution. Web search runs inside the
request. The catalog lookup and internal search requests are additional to the
single model API request. A fresh search explicitly bypasses the memory cache;
a repeated lookup reuses it. There are no automatic paid retries.

Astra receives the minimized profile and checked-in prompt. Sources must have
been published by the earlier of the MDT date and the search date. The search
targets primary studies, trial registries, regulatory assessments and authoritative
cancer registries. It does not establish an exhaustive systematic review.

## Table and interpretation

One row represents a source, population and treatment arm. It contains:

- Study title, publication date, source link, population, treatment and sample size.
- Overall survival at 6 and 12 months and at 3 and 5 years, measured from the
  source's explicit time origin.
- Median progression-free survival (PFS), objective response rate and median
  duration of response.
- Grade 3 or greater toxicity, separately from treatment discontinuation due to
  toxicity.
- Sourced treatment burden: administration, visits, duration, monitoring and
  measured quality of life, without an invented composite burden score.
- Model that found the result and an inspectable population-similarity score.

Missing outcomes remain a dash. The model must not interpolate survival or turn
relative, cancer-specific or progression-free survival into overall survival.
Each supplied outcome has a source passage behind a disclosure control. Model
extraction is labeled as requiring source review, never as a verified clinical
fact. Distinct populations, arms and time origins remain distinct. Conflicting
values are preserved for review and the disputed cell is left blank.

Similarity is a heuristic from 0 to 100 percent over known comparison dimensions:
histology (25), stage (15), biomarkers (15), treatment line (15), prior treatment
(10), performance status (10), brain metastases (5) and age (5). Coverage reports
the fraction of the total weight supported by comparisons. Unknown values do not
count as matches. The doctor can inspect the patient and study passages. Critical
differences remain visible. This score is neither a validated prognostic model
nor an individual probability of survival.

## Running and checking

Run `python3 mocks/build.py`, then `python3 mocks/serve.py`. Open the generated v3
page on port 8766. The local server owns the API key; a static deployment can
display the tab but cannot run this backend. See `prognosis/README.md` for the API,
configuration, retention and verification limits.

Run the Python prognosis tests, the Node prognosis UI checks and timeline category
regressions. Verify the scheduled date, profile, results, partial failures and
navigation in the browser before claiming the search works live.


## Saved results for the demo

The user requested persistent playback for synthetic patient Poláček (case 10).
The six saved Astra result rows are embedded from `prognosis-case-10.json` and
appear automatically after 2000 ms when the Prognóza tab is first opened. Playback
requires the same patient file and MDT date, 2026-10-22. It sends no model request.
The UI labels the saved search and retains its original date; changed clinical
profile facts produce a notice instead of silently presenting the saved evidence
as a new search.
