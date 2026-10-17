# Step 3: per-case data in the frontend

Design for step 3 of the backend migration
(`docs/research/2026-10-17-backend-migration.md`, "Frontend changes" item 3 and
"Migration plan" row 3). Read-only research on branch `backend`, 2026-10-17. All
line numbers refer to `mocks/src/v3-template.html` (3,898 lines) unless another
file is named.

Terms: **case data** is everything the assistant extracted for one MDT case
(summary, record, labs, alerts, documents); **list row** is the patient entry in
`S.patients` (identity, status, slot, one-line summary); **embedded mode** is the
page on Pages with data inlined by `mocks/build.py`; **API mode** is the page on
the Worker after `GET /api/health` answered.

## Goal

Any case whose extraction exists can be shown in the full patient view, loaded on
demand per case, instead of only case 10. The patient view becomes one
data-driven view: it shows each section the case's data holds and says plainly
which parts are missing, loading or failed. The same build keeps working on
Pages with the embedded data.

## Scope / out of scope

In scope:
- A per-case store (`caseStore`) with states, fetch functions, a stale-reply
  guard and re-render on completion.
- Rewriting every read of `CASE`, `EXTRA`, `SYN_BY_FILE`, `BRIEF_CS`,
  `BRIEF_REFS`, `DXH`, `R3`, `A3` and `p.full` to take the case data as a
  parameter.
- Merging `viewPatient` and `viewPatientLite` into one view driven by which
  sections the data has.
- Loading and error UI in Czech; the embedded data as the initial cache content
  in embedded mode.
- Guidance (`GUIDE`, `loadGuidance`) moving into the same store, keyed per case.
- Updating the tests that read `CASE`/`EXTRA` directly, and one new store test.

Out of scope (other steps):
- The read endpoints and the loader for `/me`, `/staff`, `/patients` (step 2).
  This step assumes their response shapes only through one normalizer function.
- The source viewer's page data (`SERVER_PAGES`, `srcApi`, lines 888-1022): step
  2 moves it to `GET /api/documents/:id/pages/:n`. This step only changes how
  `srcApi.page` finds a document title (through the store).
- Writes (alerts, edits, decisions, attendance) and removing client
  `logAccess` calls (step 4). Alert keys stay `f.<index>` / `gap:<index>` here.
- Prognosis (`prognosis.js` keeps its own keyed `PROGNOSIS.entries` map, which is
  already per case; `SAVED_PROGNOSIS` moves to `/cases/:id/prognosis` later).
- New patients created in the browser (`newdone`, line 3650) and the intake demo
  (`intakeOf`, line 3272): they keep using the embedded `SYN` fixtures until
  uploads exist (step 6).
- Splitting the template into ES modules (frontend item 1). The design is written
  so the store can become `case-store.js` unchanged when that happens.

## As implemented (issue #4)

Implemented on `backend` in seven commits following the refactor plan below.
Where the code differs from this design, because step 2 shipped different
endpoints than this design assumed:

- **One request per case.** Step 2 serves the whole stored extraction from
  `GET /api/cases/:id/extraction` (`{ case, extra }` for case 10, `{ syn }` for
  a synthetic patient, `data: null` without a run), so `loadCase` makes that one
  request and `fromApi(p, ex)` maps it with the same `fromFullExtraction` and
  `fromSyn` the embedded seed uses. There are no separate brief, record, labs,
  alerts and documents routes, so there are no per-part errors: a failed load
  fails the whole case (error card, "Zkusit znovu", "Chybějící podklady nelze
  ověřit (načtení selhalo)"). The header read (`GET /api/cases/:id`, the
  "case.open" access-log row) stays in `caseOpened`, as step 2 wrote it.
- **No request for an unprocessed case** (`processing: "none"` on the list row)
  or for a patient created in the browser (`p.local`, set by "Nový pacient");
  the intake demo patient S02 shows its embedded fixture in both modes.
- **Signatures kept where the case is at hand:** `reportHtml(p, pr, present)`
  and `fhirBundle(p, cd = readyData(p))` read the case data themselves, so
  `report-pdf.js` did not change. The report reads its own case's guidance.
- **Calendar card in API mode** shows the list row's diagnosis and summary
  until the case has been opened, because the card never loads case data.
- **Approval** waits for the case data and, for a case with the guideline
  layer, for the guidance; a failed load does not block it and the frozen
  report names the failure.
- **Still inlined:** the Worker serves the same built page, so every
  fixture is still in the page source in API mode. The view no longer reads
  it there (except the intake demo patient), but it is not hidden from a
  reader of the source until the page stops embedding data (migration step 5).
- **Tests:** `mocks/src/test/case-store.mjs` (jsdom) covers the embedded seed,
  the tab sets, a copy of S01 with a brief and finding groups, and API mode
  against a fake server. Every refactor commit was checked by a jsdom render
  of all views of case 10, S01, S02 after intake and patient 2, in embedded
  mode and against local `wrangler dev`, before and after.

## Design

### 1. The case data shape (`CaseData`)

One internal shape for every case, whatever produced it (embedded JSON or API).
Each part is `null` when the case has no such data; `null` means "not in the
extraction", never "nothing found".

```js
CaseData = {
  file, id,               // list-row keys: file is S.pid, id is the API case ID ("NO-010")
  level,                  // "full" | "partial" | "none", from the case header
  refs: [],               // index-addressed sources (today EXTRA.refs; R3(i) reads it)
  brief: {                // GET /cases/:id/brief
    text_cs, refs,        // EXTRA.onco_summary_v3_cs || onco_brief_v3_cs || onco_brief_cs (+ _refs)
    reason_cs, reason_refs,   // EXTRA.mdt_reason_v3_cs / _refs
    dx_headline,          // EXTRA.diagnosis_headline
    summary_items,        // CASE.summary (report and FHIR fallback)
  } | null,
  record: {               // GET /cases/:id/record
    onco_compact, onco_detailed,   // EXTRA.onco_compact_v3, onco_detailed_v3
    status_praesens,      // EXTRA.status_praesens
    timeline,             // EXTRA.timeline_cards_v3 || timeline_cards || CASE.timeline mapped
    anamnesis,            // EXTRA.anamnesis_v3
    sections,             // CASE.sections (report finding groups, FHIR)
    patient, diagnosis, mdt_question, ocr_quality_note,   // CASE.* used by FHIR export
  } | null,
  labs: { values, note_cs, series } | null,   // CASE.labs, CASE.labs_note_cs; SYN labs_series (if real, >= 2 draws)
  alerts: { flags, gaps } | null,             // CASE.flags + EXTRA.data_gaps_v3; SYN data_gaps
  documents: { documents, pages, note } | null,   // EXTRA.documents; SYN documents
  guidance: GuidanceData | null,              // lazy, see section 5
}
```

`normalizeCase(file, id, parts)` builds this from either source. Two producers:
- `fromEmbedded()` for case 10 (`CASE` + `EXTRA`) and each `SYN` entry. It keeps
  the parsed objects by reference (no clone), so tests that mutate
  `EXTRA.data_gaps_v3` keep working during the transition (see Refactor plan).
- `fromApi(header, brief, record, labs, alerts, documents)` for API mode. Step 2
  defines the response bodies; if they are the same sub-objects as the fixture
  JSON (which "case 10's extraction is loaded into the existing CASE/EXTRA
  globals" suggests), this is a field mapping. All knowledge of the response
  shapes lives in this one function (Mechanism 3: one place to update).

Identity (name, birth number, birth date) is not part of `CaseData`. It stays on
the list row `p` from `/api/patients`, which matches the planned split of
`patients` from case data. The FHIR export (section 7) reads identity from `p`.

### 2. The store

```js
/* Case data per case, loaded on demand. Keyed by the list row's file (S.pid), because every
   per-case map in S (edits, protos, alertHist, qConfirm, retro) is keyed by it too. */
const caseStore = {
  mode: null,              // "embedded" | "api", set once by initCaseStore()
  entries: new Map(),      // file -> Entry
  byDocFile: new Map(),    // document file -> case file, for docTitle on refs
};
Entry = {
  state: "absent" | "loading" | "ready" | "error",
  data: CaseData | null,
  error: { code, message_cs } | null,
  partErrors: {},          // part -> { code, message_cs }, when the header loaded but a part failed
  gen: 0,                  // request generation, for the stale-reply guard
  seeded: false,           // true for embedded entries: never evicted, never refetched
  loadedAt: 0,             // for the small LRU below
};
```

Functions:
- `initCaseStore(mode)`: called once by the step 2 loader after the health
  check decides the mode, before the first render of a patient view. In
  embedded mode it calls `seedEmbedded()`; in API mode it seeds nothing (the
  server is the source of truth, and a case the user may not open must not show
  from inlined data).
- `seedEmbedded()`: puts case 10 and every `SYN` entry in the map as `ready`,
  `seeded: true`, and fills `byDocFile`. Levels: case 10 `full`, a `SYN` entry
  `partial`.
- `caseOf(p)`: returns the entry for `p.file`, creating an `absent` one. Pure; no
  side effects, so it is safe in any render function.
- `ensureCase(p)`: idempotent; starts a load when the entry is `absent` (or
  `error` after a retry click). In embedded mode an absent case resolves
  synchronously to `ready` with `level: "none"` and all parts `null`, so FNO's
  nine unprocessed patients need no network. A patient created in the browser
  (`p.file` ends in `_novy`, or a `p.local` flag set by `newdone`) is treated the
  same way in API mode until step 4 posts it to the server.
- `loadCase(p)`: the fetch.

```js
async function loadCase(p) {
  const e = caseOf(p), gen = ++e.gen;
  e.state = "loading"; e.error = null; e.partErrors = {};
  try {
    const header = await apiJson(`/api/cases/${encodeURIComponent(p.id)}`);
    const names = ["brief", "record", "labs", "alerts", "documents"];
    const settled = await Promise.allSettled(names.map(n => apiJson(`/api/cases/${encodeURIComponent(p.id)}/${n}`)));
    /* A reply for an older request (a retry, a user switch, a reset) must not overwrite newer state. */
    if (e.gen !== gen) return;
    const parts = {};
    settled.forEach((r, i) => r.status === "fulfilled" ? parts[names[i]] = r.value : e.partErrors[names[i]] = r.reason);
    e.data = fromApi(p, header, parts); e.state = "ready"; e.loadedAt = Date.now();
    indexDocs(e.data); evictOld();
  } catch (err) {
    if (e.gen !== gen) return;
    e.state = "error"; e.error = err;
  }
  /* Render only when the reply still matters to the screen: the case is open. A reply for a case
     the user left stays in the cache (it was opened, so loading it was an access anyway) but
     does not re-render someone else's screen. */
  if (S.view === "patient" && S.pid === p.file) render();
}
```

Notes on the guard and render:
- One render per load, after all parts settle. Six progressive renders would
  rebuild `#app` six times; a doctor typing in `#concl` would lose focus each
  time. The loading view (section 4) has no editable fields, so the single
  render cannot interrupt typing.
- A `404` on a part (the case has no labs) is read as "part absent" (`null`), not
  as an error. Step 2 should return `404` with `code: "not_extracted"` or `200`
  with `null`; either is handled in `fromApi`.
- `apiJson(path)`: `fetch` with `credentials: "same-origin"`, `Accept:
  application/json`, a 20 s `AbortController` timeout, and error mapping to the
  foundations' `{ error: { code, message_cs } }`. A non-JSON reply or a network
  failure becomes `{ code: "network", message_cs: "Server neodpovídá. Zkuste to
  znovu." }`. No automatic retry loop: these are D1/R2 reads, a 429 shows the
  server's message and the retry button.
- Invalidation: `caseStore.reset()` bumps `gen` on every non-seeded entry and
  deletes them. It runs when the user in `#user` changes (in API mode the
  server's answer depends on the user's role and case membership), and later on
  "reset demo".
- Memory: keep at most 5 API-loaded entries (drop the oldest `loadedAt`, never
  the open case, never seeded ones). This bounds how much patient data one tab
  holds; nothing goes to `localStorage`. A privacy-for-convenience trade-off:
  a larger cache would make switching during a session faster.
- No prefetch. Opening the calendar card or the session agenda does not load
  case data, because every API read is an audited access (`access_log`); a
  prefetch would log "opened" for cases nobody opened. Switching cases during a
  session therefore shows the loading state briefly. If that is too slow in the
  demo, prefetch the next agenda case only while a session runs, and say so in
  the access log entry ("načteno předem pro MDT").

Where loads start: `openPatient` (line 3460) and `readHash` (line 3440) call
`ensureCase(P(S.pid))` before `render()`; `viewPatient` also calls it, so any
other path into the view (session pills, `data-open`) is covered. This follows
the `loadGuidance` pattern (line 1024) but fixes its gaps: `loadGuidance` has no
error branch (a rejected promise leaves `GUIDE = { loading: true }` forever) and
one global `GUIDE`, which would show case A's guidance on case B if two cases
had guidance.

### 3. One data-driven view

`p.full` (set only on case 10, line 1159) and `SYN_BY_FILE[p.file]` today pick
one of three views. They are replaced by what the case data holds:

```js
/* Which parts of the patient view this case can show; decided by its data, not by which patient it is. */
const sectionsOf = cd => ({
  brief: !!cd.brief?.text_cs,
  reason: !!cd.brief?.reason_cs,
  dx: !!cd.brief?.dx_headline,
  onco: !!(cd.record?.onco_compact || cd.record?.onco_detailed?.length),
  status: !!cd.record?.status_praesens,
  timeline: (cd.record?.timeline || []).length > 0,
  anamnesis: !!cd.record?.anamnesis,
  documents: !!cd.documents,
  labs: !!(cd.labs?.series || cd.labs?.values?.length),
  alerts: !!cd.alerts,                  // the missing-document check ran
  record: !!cd.record?.sections,        // report finding groups and FHIR export
  guidance: cd.level === "full",        // see section 5
});
```

Tabs, in today's order, each shown when its condition holds:

| Tab | Shown when | Today |
|---|---|---|
| Přehled | `onco` or `status` | case 10 only |
| Anamnéza | `anamnesis` | case 10 only |
| Dokumenty | `documents` | case 10, S01, S02 |
| Laboratoř | `labs` | case 10, S01, S02 |
| Upozornění | `alerts` | case 10 only (S01/S02 show alerts only under the brief toggle) |
| Navrhovaný postup | `guidance` | case 10 only |
| Retrospektivní odchylky | `guidance` | case 10 only |
| Prognóza | always | all cases |

The brief block (`briefBlock`, line 1865, plus the lite block at 2330) becomes
one block:
- Prose: `cd.brief.text_cs` with linked sources when `brief`; otherwise the list
  row's `p.summary` with a muted line "Souhrn ze seznamu pacientů, bez odkazů na
  zdroj." (today the lite note says "Plně zpracovaný je v maketě případ
  NO-010", which stops being true).
- Processing chip, built from the sections: "Zpracováno: dokumenty, chybějící
  podklady, laboratoř" lists what exists; "Nezpracováno" when nothing does. This
  replaces both the fixed S01 chip and "V maketě nezpracováno".
- Alerts: `gapsToggle(p, cd)` when `alerts`; `uncheckedSignal()` when not
  (unchanged wording "Chybějící podklady nezkontrolovány (případ nezpracován)").
  The open list is `gapsBox(cd)` for every case; `synGapsBox` (line 2341) is
  deleted.
- Question, timeline (when `timeline`), sources, conclusion and the MDT card as
  today.

Visible changes this causes (state them in the commit and to the team):
- S01 and S02 gain the "Upozornění" tab (their data gaps were only under the
  toggle). Consistent with "missing-document alerts are always on".
- The S01/S02 chip wording and the lite note change as above.
- Any future case with a fuller extraction shows more tabs with no code change.

The tab fallback (`if (!tabs.some(...)) S.tab = ...`, lines 2218 and 2326) runs
only when the entry is `ready`. While loading, `S.tab` is kept, so a deep link
such as `#patient/S01/labs` lands on Laboratoř once the data arrives, and a
session switch keeps "a tab supported by both cases" (v3.mjs line 159).

### 4. Loading and error UI

All text Czech; the header always renders from the list row, so the doctor sees
whose case it is at once.

| State | What the view shows |
|---|---|
| `loading` | `patientHeader(p, headerActions(p, null))` (FHIR and report buttons hidden), then a card `<p class="muted" role="status">Načítám podklady případu…</p>`. No tabs, no editable fields. |
| `error` | Header, then `<div class="question missing" role="alert"><b>Podklady případu se nepodařilo načíst.</b> {message_cs}</div>` and `<button class="btn" data-act="caseretry">Zkusit znovu</button>`. The missing-document place shows an amber `Chybějící podklady nelze ověřit (načtení selhalo)`: a failed load is not "nothing missing" and not "unprocessed". The conclusion and MDT card stay available (an MDT can run without documents), but see "Report" below. |
| `ready`, a part failed | The view renders; the failed part's section says `{název části} se nepodařilo načíst. <button data-act="caseretry">Zkusit znovu</button>` in place of its content (for example in the Laboratoř tab). If `alerts` failed, the amber "nelze ověřit" signal replaces the Upozornění button. |
| `ready`, `level: "none"` | Header, list summary, "Nezpracováno" chip, the unchecked signal, conclusion, MDT card, Prognóza tab. Same as today's lite view for FNO patients. |

`caseretry` sets the entry back to `absent` and calls `ensureCase`.

`hasMissing(p)` keeps its contract (`true`/`false` for a checked case, `null`
when the check has not run) and gains the reason: `missingState(p)` returns
`"yes" | "no" | "unchecked" | "loading" | "failed"`, so the signal can say which.

**Report and approval.** Approval freezes `reportHtml` into `pr.reportSnap`
(line 3748). If the case data is `loading` or `error` at that moment, the frozen
report would claim "Dokumentace případu není v maketě zpracovaná", which is
false. `reportHtml` therefore prints, per part, "nepodařilo se načíst ze
serveru" for a failed part and "načítá se" is never frozen: the approve button
waits for `ready` (disabled with the title "Podklady případu se načítají"), which
takes a moment. On `error` approval stays possible (alerts and missing data never
block) and the frozen report states the failed parts.

### 5. Guidance into the store

`api.guidance` (line 878) returns `SERVER_GUIDANCE` for `"NO-010"`. It becomes a
lazily loaded part of the entry: `ensureGuidance(p)` with the same `gen` guard,
called where `loadGuidance(p)` is called today (lines 1981, 2215), but only when
`sectionsOf(cd).guidance`. `GUIDE` stops being a global: the helpers `GL`,
`STMTS`, `PAST`, `anyStmt`, `factRefs` (lines 1030-1033, 1807) read
`guideOf(S.pid)`.

This keeps one implicit "current case" read, a documented exception to "take the
case as a parameter": every guidance view renders only for the open case, and
threading a parameter through some 20 small helpers in the guideline layer would
double the diff for no behavior change. `deviationFindings(p)` (line 2250)
already checks `GUIDE.deviation_case_file === p.file` and keeps that check.

Guidance states: `loading` shows today's "Načítám doporučení ze serveru…";
`error` shows "Doporučení se nepodařilo načíst. Zkusit znovu" (new, today a
rejected promise hangs).

### 6. Every use site and its rewrite

Notation: `cd` is `caseOf(p).data`. A function that takes `cd` is only called
when the entry is `ready`.

**Bootstrap and list (list-level, not case data):**

| Line | Use | Rewrite |
|---|---|---|
| 865, 867 | `const CASE`, `const EXTRA` | Become locals of `seedEmbedded()` and of the embedded list builder. Kept as globals until commit 6 for the tests (see plan). |
| 871-872 | `SYN`, `SYN_BY_FILE` | `SYN` stays (intake demo fixtures, lines 3273, 3619). `SYN_BY_FILE` is deleted; its two list uses move to the list builder. |
| 880 | `api.guidance`: `caseId === "NO-010" ? SERVER_GUIDANCE` | `fetchGuidance(id)`: embedded mode returns `SERVER_GUIDANCE` for the case named by `SERVER_GUIDANCE.deviation_case_file`'s case, else empty; API mode `GET /api/cases/:id/guidance`. |
| 1128 | `extraOthers` from `EXTRA.others` + `SYN.others_entry` | List-level data (diagnosis, referrer of FNO's patients). Stays in the embedded list builder; in API mode the fields come with `/api/patients` (step 2). |
| 1137 | `listPatient`: `synthetic: !!SYN_BY_FILE[o.file]?.synthetic_patient` | `synthetic: !!o.synthetic_patient`, set by the list builder from `SYN`. |
| 1153-1159 | `initialPatients` p10 from `CASE`/`EXTRA`, `full: true` | Embedded list builder only. `full: true` becomes `level: "full"`; SYN rows `level: "partial"`; others `level: "none"`. In API mode `level` comes from the list row. Nothing in the view reads `level` for rendering decisions except the guidance condition; sections decide. |
| 1164 | `SYN` list entries | Unchanged (list builder). |
| 1176 | `S.pid: CASE.file` | `S.pid: initialPatients()[0].file` (or the step 2 loader's first row). |

**Documents and sources:**

| Line | Use | Rewrite |
|---|---|---|
| 1006 | `srcApi.page`: `docsOf(file)` for the title | `docsOfDocFile(file)`: `caseStore.byDocFile.get(file)` then that entry's `documents`; title `null` when not loaded. |
| 1333-1337 | `docsOf(file)`: `CASE`/`EXTRA`/`SYN_BY_FILE` | `docsOf(cd)`: `cd.documents && { file: cd.file, ...cd.documents }`. |
| 1338-1340 | `docTitle(r)`: `docsOf(r.file \|\| CASE.file)` | `docTitle(r)` via `byDocFile`; a ref without `file` is resolved against the open case (`S.pid`). Falls back to `r.file` as today. |
| 2020 | `tabDocuments`: `docsOf(S.pid)` | `tabDocuments(p, cd)` with `docsOf(cd)`; "Zdroj: … stran" from `cd.documents.pages`. |
| 2905 | `openSource`: `r.file \|\| CASE.file` | `r.file \|\| S.pid`. |

**Calendar card:**

| Line | Use | Rewrite |
|---|---|---|
| 1577 | `pop.full ? dxHeadlineText() : pop.diagnosis` | `const pcd = readyData(pop)` (data only if already `ready`, no fetch); `pcd?.brief?.dx_headline ? dxHeadlineText(pop, pcd) : pop.diagnosis`. |
| 1579 | `pop.full ? briefPlain()… edOf("brief", CASE.file)` | `pcd?.brief ? briefPlain(pop, pcd)… edOf("brief", pop.file) : pop.summary`. Fixes a latent bug: today the card reads case 10's edit flag for any full case. |

**Brief and diagnosis:**

| Line | Use | Rewrite |
|---|---|---|
| 1603 | `R3 = i => EXTRA.refs[i]` | `refAt(cd, i)`. |
| 1605-1607 | `BRIEF_CS`, `BRIEF_REFS`, `DXH` | Deleted; `cd.brief.text_cs`, `cd.brief.refs`, `cd.brief.dx_headline`. |
| 1610-1615 | `dxHeadlineText(forReport)`: `CASE.file` four times | `dxHeadlineText(p, cd, forReport)` with `p.file`. |
| 1655 | `briefPlain()`: `BRIEF_CS`, `CASE.file` | `briefPlain(p, cd)`. |
| 1741-1745 | `briefHtml(reg)` | `briefHtml(cd, reg)`. |
| 1748-1752 | `reasonHtml(reg)`: `EXTRA.mdt_reason_v3_*` | `reasonHtml(cd, reg)`. |

**Alerts:**

| Line | Use | Rewrite |
|---|---|---|
| 1680-1681 | `caseDataOf(p)`: `p.full` → `CASE.flags`, `EXTRA.data_gaps_v3`; SYN → gaps | `caseDataOf(p)` = `readyData(p)?.alerts ?? null` (same `{flags, gaps}` shape). |
| 1684 | `hasMissing(p)` | Unchanged body; plus `missingState(p)` (section 4). |
| 1720, 1729, 1736 | `warningEntries`, `alertAct`, `topAlerts` (read through `caseDataOf`) | Unchanged; they already take `p` or `S.pid`. |
| 1859, 2104, 2342 | `gapsBox`, `tabAlerts`, `synGapsBox` | `gapsBox` serves every case; `synGapsBox` deleted. |

**Overview, timeline, anamnesis, labs:**

| Line | Use | Rewrite |
|---|---|---|
| 1875-1889 | `detailedCard(reg)`: `DXH`, `EXTRA.onco_detailed_v3`, `EXTRA.onco_compact_v3`, `R3` | `detailedCard(cd, reg)`. |
| 1895-1901 | `compactRows(reg)`: `EXTRA.onco_compact_v3`, `R3` | `compactRows(cd, reg)`. |
| 1905-1926 | `statusCard()`: `EXTRA.status_praesens`, `R3` | `statusCard(cd)`. |
| 1943-1947 | `timelineEvents()`: `EXTRA.timeline_cards_v3 \|\| …CASE.timeline` | `timelineEvents(cd)` returns `cd.record?.timeline \|\| []`; the old-shape mapping of `CASE.timeline` moves into `fromEmbedded`. |
| 1956 | `timelineCard(inline)` | `timelineCard(cd, inline)`. |
| 3558 | click handler: `timelineEvents()[+d.tl]` | `timelineEvents(readyData(P(S.pid)))[+d.tl]`. Indexes stay into the unsorted array, as `timeline-categories.mjs` checks. |
| 1979-1983 | `tabOverview()`: `p.full` → `loadGuidance` | `tabOverview(p, cd)`; guidance load moves to `viewPatient`. |
| 1986 | `A3 = () => EXTRA.anamnesis_v3` | `cd.record.anamnesis`. |
| 1989-1998 | `termLine`, `medsTable`: `R3` | Add `cd` parameter. |
| 1999 | `tabAnamnesis()` | `tabAnamnesis(cd)`. |
| 2040 | `labSeriesOf(p)`: `SYN_BY_FILE[p.file].labs_series` | `labSeriesOf(cd)` = `cd.labs?.series`. The `!s.synthetic && draws >= 2` test moves into `fromEmbedded`/`fromApi`, so a series that may not be charted never enters `CaseData`. |
| 2077-2097 | `tabLabs()`: `CASE.labs`, `CASE.labs_note_cs` | `tabLabs(cd)`: series when present, else `cd.labs.values` and `cd.labs.note_cs`. The closing sentence "zde je jedna sada bez data odběru" is only true for case 10; it becomes conditional on `oneDate && !labs[0].date`. |

**Views:**

| Line | Use | Rewrite |
|---|---|---|
| 2213-2229 | `viewPatient`: `p.full` | One view (section 3), switching on the entry state (section 4). |
| 2321-2339 | `viewPatientLite`: `SYN_BY_FILE` | Deleted. |
| 2350-2353 | `headerActions(p)`: `p.full` → "Export FHIR" | `headerActions(p, cd)`: FHIR button when `sectionsOf(cd).record`. |
| 3349 | report dialog picks: `p.full ? [Anamnéza, ...FIND]` | `sectionsOf(cd).anamnesis` adds Anamnéza; `record` adds `FIND`. |

**Guideline layer and deviations:**

| Line | Use | Rewrite |
|---|---|---|
| 1023-1033 | `GUIDE`, `loadGuidance`, `GL`, `STMTS`, `PAST`, `anyStmt` | Read `guideOf(S.pid)` (section 5). |
| 1807 | `factRefs`: `R3` | `refAt(readyData(P(S.pid)), i)`. |
| 2275 | `decisionRef`: `R3`, `EXTRA.onco_detailed_v3` | `decisionRef(cd, x)`; `retroList(p)` gets `cd`. |
| 3320 | overlay: `GUIDE.pages` | `guideOf(S.pid).pages`. |

**Report and FHIR:**

| Line | Use | Rewrite |
|---|---|---|
| 2726-2758 | `reportHtml(p, pr, present)`: `A3`, `R3`, `p.full`, `BRIEF_*`, `CASE.summary`, `DXH`, `CASE.sections`, `SYN_BY_FILE[p.file].data_gaps` | `reportHtml(p, cd, pr, present)`, sections by `sectionsOf(cd)`: anamnesis when present, finding groups when `record`, missing documents when `alerts` (from `cd.alerts.gaps`, for every case, not only SYN), failed parts named (section 4). Callers: 2764, 3350, 3748, `report-pdf.js` line 121 (`downloadReport`). |
| 3086-3200 | `fhirBundle(p)`: `const c = CASE` | `fhirBundle(p, cd)`. Patient name, birth number and birth date from `p` (the list row, which will come from the `patients` table); sex and its certainty from `cd.record.patient`. Every loop already tolerates missing arrays (`c.sections \|\| {}`, `c.labs \|\| []`); `c.diagnosis.code` (line 3126) needs a guard, since a partial case may have no diagnosis: no `Condition` then, and the Composition section says "Neuvedeno v dostupné dokumentaci." as it does for empty sections. |
| 3610 | `fhirdlg` action | `fhirBundle(p, readyData(p))`; the button only exists when ready. |

**Unchanged on purpose:** `intakeOf` (3273), `fhirsample` (3619), `newdone`
(3650) read `SYN` as fixtures for the "Nový pacient" flow. `prognosis.js` and
`report-pdf.js` read no case globals (`report-pdf.js` only calls `reportHtml`).

**Tests that read the globals:**

| File:line | Reads | Change |
|---|---|---|
| `v3.mjs` 50 | `"labs_series_synthetic" in EXTRA` | `caseData("10_pacient.pdf")` (a test helper exposed on `window`), check its `labs`. |
| `v3.mjs` 188, 190, 298, 599, 603 | `EXTRA.onco_compact_v3` | `caseData(...).record.onco_compact`. |
| `v3.mjs` 584 | `CASE.labs_note_cs` | `caseData(...).labs.note_cs`. |
| `v3.mjs` 592-593 | `EXTRA.status_praesens`, `EXTRA.diagnosis_headline` | `.record.status_praesens`, `.brief.dx_headline`. |
| `v3.mjs` 598, 607, 622 | `CASE.flags` | `.alerts.flags`. |
| `v3.mjs` 621 | mutates `EXTRA.data_gaps_v3`, calls `hasMissing(P(CASE.file))` | Mutate `caseData(...).alerts.gaps`; `P("10_pacient.pdf")`. |
| `timeline-categories.mjs` 11, 29, 63-64 | vm context with `EXTRA`, `CASE` | Pass a `cd` built by the same `fromEmbedded` code sliced from the template, or a literal `{ record: { timeline } }`; call `timelineEvents(cd)`, `timelineCard(cd, true)`. |
| `deviations.mjs` 28 | vm context with `EXTRA`, `R3` | Provide `refAt` and `readyData`; `decisionRef(cd, x)`. |

### 7. Mode wiring with step 2

- Step 2's loader calls `initCaseStore("api" | "embedded")` once, right after
  the health check and before the first `render()` that can show a patient
  view. If step 2 renders before the check finishes, `caseOf` returns `absent`
  and `viewPatient` shows the loading state; `initCaseStore` then calls
  `render()`.
- Step 2 currently loads case 10 into the `CASE`/`EXTRA` globals in API mode.
  Step 3 removes that special case: case 10 loads through `loadCase` like any
  other. This must land in the same commit that switches API mode to the store
  (commit 7), or case 10 would be loaded twice in two shapes.
- `/api/cases/:id` header must include `level`; asking step 2 for an optional
  `available: ["brief", "record", ...]` list lets the client skip parts the case
  does not have (fewer requests, fewer 404s). Without it the client requests all
  five parts.

## Refactor plan

Each commit keeps the demo working in embedded mode (Pages) and passes the tests
listed for it. Rebuild with `python3 mocks/build.py` before the Playwright tests;
they open `mocks/v3.html`.

1. **Add the store, seeded from embedded data; nothing reads it yet.** Add
   `CaseData`, `fromEmbedded`, `caseStore`, `caseOf`, `readyData`,
   `ensureCase`, `seedEmbedded`, `initCaseStore("embedded")` called at the end
   of the script before `readHash()`. Expose `window.caseData = file =>
   readyData(P(file))` for tests. Add `mocks/src/test/case-store.mjs` (section
   Tests). Run: case-store, v3, timeline-categories, deviations.
2. **Documents, alerts, labs read the store.** `docsOf(cd)`, `docTitle` via
   `byDocFile`, `caseDataOf` from `cd.alerts`, `labSeriesOf(cd)`, `tabLabs(cd)`,
   `tabDocuments(p, cd)`, `openSource` default. Both views still exist; the lite
   view passes `cd` too. Run: v3 (S01 labs and documents, `hasMissing` checks),
   patient-panels.
3. **Brief, diagnosis, calendar card.** Remove `BRIEF_CS`, `BRIEF_REFS`, `DXH`,
   `R3` in favor of `cd`; `dxHeadlineText(p, cd)`, `briefPlain(p, cd)`,
   `briefHtml(cd, reg)`, `reasonHtml(cd, reg)`; calendar card reads
   `readyData(pop)`. Run: v3, patient-panels.
4. **Overview, timeline, anamnesis.** `detailedCard`, `compactRows`,
   `statusCard`, `timelineEvents`, `timelineCard`, the timeline click handler,
   `tabAnamnesis`, `termLine`, `medsTable` take `cd`. Update
   `timeline-categories.mjs` in the same commit. Run: timeline-categories, v3,
   patient-panels.
5. **Guidance into the store; report and FHIR take `cd`.** `ensureGuidance`,
   `guideOf`, `factRefs`, `decisionRef(cd, x)`, `reportHtml(p, cd, ...)` with all
   four callers including `report-pdf.js`, `fhirBundle(p, cd)`, `headerActions(p,
   cd)`. Update `deviations.mjs`. Run: deviations, report-pdf, v3 (FHIR
   Provenance check at line 38), main-preservation, prognosis-ui.
6. **One view; remove `p.full`, `SYN_BY_FILE`, `viewPatientLite`.**
   `sectionsOf`, tab list from data, unified brief block and chip, loading and
   error states, `caseretry`, `missingState`, approval waits for `ready`. Move
   `CASE`/`EXTRA` into the seed and list builder as locals; update `v3.mjs` to
   `caseData(...)`. This is the commit with visible changes (S01/S02 gain
   "Upozornění", new chip text); check them in the browser at 1280 and 400 px.
   Run: all tests.
7. **API mode.** `apiJson`, `loadCase`, `fromApi`, `fetchGuidance` over HTTP,
   `reset()` on user change, the LRU, removal of step 2's case 10 special load,
   `initCaseStore` called from the step 2 loader. Run: all tests in embedded
   mode (must be unchanged), case-store with the fake `fetch`, and a manual pass
   on `wrangler dev`: open case 10, S01, S02 and patient 2; switch cases fast
   (stale guard); stop the Worker mid-load (error card, retry); change user
   (cache cleared).

Commits 1-6 change no behavior in API mode beyond what step 2 already does,
so they can merge to `main` one by one. Commit 7 stays behind the health check,
so Pages is unaffected.

## Tests

What exists, as read (not run in this research):
- `v3.mjs`, `patient-panels.mjs`, `main-preservation.mjs`, `prognosis-ui.mjs`,
  `report-pdf.mjs`: Playwright in Chromium against the built `mocks/v3.html`.
  They need a global `playwright` (`PLAYWRIGHT_PATH`); none is installed in this
  checkout, and the repo has no `package.json` pinning it.
- `timeline-categories.mjs`, `deviations.mjs`: Node `vm` over slices of the
  template. They break as soon as a sliced function's signature changes, so they
  move in the same commit as the code (commits 4 and 5).
- `smoke.mjs` (jsdom) and `w.mjs` (playwright-core, 400 px) target **v2**: they
  click `[data-go="present"]`, `[data-tab="compare"]`, `[data-brief]`, which v3
  does not have. They are not a check for this step. The README (lines 205-208)
  says so.
- `main-preservation.mjs` line 47 writes a screenshot to
  `/workspace/scratch/8d6498bf9494/tmp/...`, a path from another machine; it
  will fail locally on that line. Fix the path (or drop the screenshot) in
  commit 1 so the test can be part of the per-commit run.

New: `mocks/src/test/case-store.mjs`, jsdom (the same setup as `smoke.mjs`,
pointed at `mocks/v3.html`), with no network:
1. Embedded seed: `caseData("10_pacient.pdf")` has brief, record, labs, alerts,
   documents; S01 has documents, alerts, labs.series and `brief === null`;
   `caseData("2_pacient.pdf")` is ready with every part `null` and `level:
   "none"`.
2. `sectionsOf` per case gives the tab lists in section 3; open `#patient/S01`
   and `#patient/2` and compare the rendered tab buttons.
3. Stale reply: set mode `api` with a fake `window.fetch` whose replies resolve
   in a controlled order; open case A, then case B, resolve B then A; assert the
   view shows B, A's entry is `ready` in the cache, and only one render followed
   B's reply (count `render` calls with a wrapper).
4. Retry generation: start a load, call `caseStore.reset()`, resolve the old
   reply; assert nothing was written.
5. Error and partial error: fake a 500 on the header (error card with the
   server's `message_cs`, retry button) and a 500 on `labs` only (Laboratoř tab
   shows the part error; other tabs render; missing-document signal unaffected).
   Fake a 500 on `alerts`: the amber "nelze ověřit" signal, never "chybí
   podklady" or nothing.
6. Deep link while loading: `#patient/S01/labs` with a delayed fake; after the
   reply, `S.tab === "labs"`.
7. Report while loading/failed: approval button disabled while loading; with a
   failed `brief`, `reportHtml` names the failed part and does not print "není
   v maketě zpracovaná".

Per commit: commits 1-3 run case-store, v3, patient-panels; commit 4 adds
timeline-categories; commit 5 adds deviations, report-pdf, main-preservation,
prognosis-ui; commits 6 and 7 run all of them. Commit 6 also gets a manual look
at 1280 and 400 px (S01, S02 after intake, patient 2, case 10), since it changes
what the doctor sees (CLAUDE.md, Mechanism 4: a separate agent reviews the
commit 6 diff before merge).

## Acceptance criteria

- [ ] No reference to `CASE`, `EXTRA`, `SYN_BY_FILE`, `BRIEF_CS`, `BRIEF_REFS`,
      `DXH`, `R3`, `A3` or `p.full` remains outside `seedEmbedded`, the
      embedded list builder and the intake fixtures (`grep` check in the
      commit 6 description).
- [ ] `viewPatientLite` and `synGapsBox` are gone; one `viewPatient` renders
      case 10, S01, S02 and patient 2 from `sectionsOf(cd)`.
- [ ] Case 10 looks and behaves as before (all of `v3.mjs` passes, updated only
      to read data through `caseData`).
- [ ] S01 and S02 show Dokumenty, Laboratoř and Upozornění, with the amber
      "chybí podklady" button; patient 2 shows "Nezpracováno" and the unchecked
      signal.
- [ ] A case whose fixture gains a `brief` or `record` shows the matching
      sections with no code change (checked by adding a `brief` to a copy of S01
      in `case-store.mjs`).
- [ ] On Pages (no `/api/health`), no network request for case data is made
      (checked in `case-store.mjs` with a `fetch` that fails the test if called).
- [ ] In API mode, opening a case shows "Načítám podklady případu…", then the
      data; a failed load shows the Czech error with "Zkusit znovu"; a failed
      alerts part shows "Chybějící podklady nelze ověřit (načtení selhalo)".
- [ ] A late reply for a case no longer open does not re-render or change the
      open case; a reply older than the latest request for the same case is
      dropped.
- [ ] Changing the user clears API-loaded case data; at most 5 API-loaded cases
      stay in memory; nothing is written to `localStorage`.
- [ ] A deep link to a tab (`#patient/S01/labs`) lands on that tab after loading.
- [ ] The approval snapshot never states "not processed" for a case whose data
      failed to load; approval is never blocked by an error.
- [ ] The FHIR export of case 10 still gives every fact a Provenance (`v3.mjs`
      line 38) and takes identity from the list row.
- [ ] `docs/research/2026-10-17-backend-migration.md` and `mocks/README.md`
      updated where they describe the case-10-only view and the tests.

## Risks

- **Silent clinical regressions in the rewrite.** The diff touches every
  renderer of extracted facts. Mitigation: commits 1-5 are mechanical (same
  output for case 10, proven by `v3.mjs`, which asserts many case 10 texts);
  only commit 6 changes visible behavior, and it gets a separate review.
- **"Not loaded" read as "nothing missing" or "not processed".** The most
  dangerous wrong state here. Mitigation: `missingState` with separate
  `loading`/`failed` values, the amber "nelze ověřit" signal, report wording per
  failed part, and tests 5 and 7.
- **Re-render while typing.** Async completion re-renders `#app` and can steal
  focus from `#concl` or an edit dialog. Mitigation: one render per load, no
  editable fields in the loading state; guidance loads (existing behavior) keep
  the risk they already have. A focus-restoring `render()` is a separate small
  fix if the demo shows it.
- **Step 2 shapes unknown here.** If the read endpoints return a different
  shape, only `fromApi` changes; if they split differently (for example timeline
  inside `brief`), the part list in `loadCase` changes. Agree the bodies with the
  step 2 author before commit 7.
- **The `GUIDE` exception.** Guidance helpers still read the open case. A future
  view that shows guidance for a case that is not open (a session overview)
  would need the parameter after all.
- **Tests not runnable locally as checked out.** No Playwright or jsdom is
  installed and nothing pins them. Without a pinned `package.json` for the
  tests, "run after each commit" depends on each machine. Add one in commit 1
  (Playwright and jsdom with exact versions).
- **Audit noise in API mode.** Every case open now fetches six resources; if
  step 2 logs each GET as a separate access, the access log gets six rows per
  open. Step 2 should log one "opened case" per header read and nothing for the
  parts, or the client sends a header naming the view.

## Effort

About 2 days for one developer with agents, inside the 2-3 days the migration
plan gives step 3:
- commits 1-5 (mechanical parameter threading and test updates): 1 day;
- commit 6 (unified view, loading and error states, review): 0.5 day;
- commit 7 (API mode, fake-fetch tests, manual pass on `wrangler dev`): 0.5 day,
  assuming step 2's endpoints are deployed and their bodies agreed.

Stop and report if commits 1-5 take more than 2 days: that would mean the
template's coupling is deeper than this inventory shows.
