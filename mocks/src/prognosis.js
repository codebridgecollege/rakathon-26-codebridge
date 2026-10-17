/* Each request belongs to a patient and scheduled day. Late replies never replace another case's results. */
const SAVED_PROGNOSIS = /*PROGNOSIS_DATA*/;
const PROGNOSIS = { config: null, configError: "", configPending: false, entries: new Map() };
const PG_ENDPOINTS = [["os_6", "6měsíční OS"], ["os_12", "12měsíční OS"], ["os_36", "3leté OS"], ["os_60", "5leté OS"], ["pfs", "Medián PFS"], ["response", "Odpověď a trvání odpovědi"], ["toxicity", "Závažná toxicita a ukončení léčby"], ["burden", "Zátěž léčby"]];
const pgKey = p => JSON.stringify([p.file, p.slot?.day || ""]);
function pgEntry(p) {
  const key = pgKey(p);
  if (!PROGNOSIS.entries.has(key)) PROGNOSIS.entries.set(key, { profile: null, profilePending: false, profileError: "", pending: false, result: null, error: "", savedChecked: false, savedPending: false });
  return PROGNOSIS.entries.get(key);
}
function pgRender(key) { if (S.view === "patient" && S.tab === "prognosis" && pgKey(P(S.pid)) === key) render(); }
async function pgJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.method === "POST" ? 330000 : 45000);
  try {
    const response = await fetch(url, { ...options, signal:controller.signal, credentials: "same-origin", headers: { "Accept": "application/json", ...options.headers } });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Vyhledávání vyžaduje spuštěný lokální server Prognózy (python3 mocks/serve.py).");
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message_cs || data.error?.message || "Požadavek se nepodařilo dokončit.");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Vypršel časový limit. Další vyhledávání se nespustí automaticky.");
    throw error;
  } finally { clearTimeout(timer); }
}
/* The saved synthetic case is a recorded search, never a new model response. */
function pgLoadSaved(p) {
  const state = pgEntry(p);
  if (state.savedChecked || state.result) return;
  state.savedChecked = true;
  const saved = SAVED_PROGNOSIS.find(item => item.patient_id === p.file && item.scheduled_date === p.slot?.day);
  if (!saved?.result?.rows?.length) return;
  const key = pgKey(p);
  state.savedPending = true;
  setTimeout(() => {
    state.savedPending = false;
    if (!state.result && !state.pending) {
      const result = JSON.parse(JSON.stringify(saved.result));
      result.saved = true;
      result.saved_data_changed = !!state.profile && JSON.stringify(state.profile.facts) !== JSON.stringify(result.profile?.facts);
      state.result = result;
      state.profile = result.profile;
    }
    pgRender(key);
  }, 2000);
}
function pgLoad(p) {
  pgLoadSaved(p);
  if (!PROGNOSIS.config && !PROGNOSIS.configPending && !PROGNOSIS.configError) {
    PROGNOSIS.configPending = true;
    pgJson("/api/prognosis/config").then(data => { PROGNOSIS.config = data; }).catch(error => { PROGNOSIS.configError = error.message; }).finally(() => {
      PROGNOSIS.configPending = false;
      if (S.view === "patient" && S.tab === "prognosis") render();
    });
  }
  const state = pgEntry(p), key = pgKey(p), day = p.slot?.day;
  if (!day || state.profile || state.profilePending || state.profileError) return;
  state.profilePending = true;
  pgJson("/api/prognosis/profile?" + new URLSearchParams({ patient_id: p.file, scheduled_date: day })).then(data => {
    if (state.result?.saved) state.result.saved_data_changed = JSON.stringify(data.profile?.facts) !== JSON.stringify(state.result.profile?.facts);
    else state.profile = data.profile;
  }).catch(error => { state.profileError = error.message; }).finally(() => { state.profilePending = false; pgRender(key); });
}
async function pgSearch(refresh = false) {
  const p = P(S.pid), state = pgEntry(p), key = pgKey(p), day = p.slot?.day;
  if (!day || state.pending || state.savedPending || !state.profile || state.profile.available === false || !PROGNOSIS.config?.configured) return;
  if (!refresh && state.result) { state.error = ""; render(); return; }
  state.pending = true; state.error = ""; render();
  logAccess(p.file, "spustil(a) rešerši prognózy ze syntetických podkladů");
  try {
    state.result = await pgJson("/api/prognosis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: p.file, scheduled_date: day, refresh }) });
    if (state.result.profile) state.profile = state.result.profile;
  } catch (error) { state.error = error.message; }
  finally { state.pending = false; pgRender(key); }
}
function pgRetry() {
  PROGNOSIS.configError = ""; PROGNOSIS.config = null;
  const state = pgEntry(P(S.pid)); state.profileError = ""; state.profile = null;
  render();
}
function pgUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function pgLink(url, label) { const safe = pgUrl(url); return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label); }
const PG_DIMENSIONS = { histology:"Histologie", stage:"Stádium", biomarkers:"Biomarkery", treatment_line:"Linie léčby", prior_treatment:"Předchozí léčba", performance_status:"Výkonnostní stav", brain_metastases:"Mozkové metastázy", age:"Věk" };
/* Sources and similarity explanations open in the right-hand drawer, like document sources elsewhere. Each render
   rebuilds the list of panels, and a button carries its index into it. */
let PG_PANELS = [], PG_REFS = [], pgCurRow = null;
/* Every reported value gets a reference number, in reading order; the same passage of the same source keeps one
   number. The drawer lists them all, like a paper's reference list, and scrolls to the one clicked. */
function pgRef(metric, name, value) {
  const key = JSON.stringify([pgCurRow?.study_title || "", metric.quote || "", metric.source_url || "", metric.locator || ""]);
  let i = PG_REFS.findIndex(r => r.key === key);
  if (i < 0) i = PG_REFS.push({ key, study: pgCurRow?.study_title || "", what: [], quote: metric.quote || "", url: metric.source_url || "", locator: metric.locator || "" }) - 1;
  const what = `${pgCurRow?.arm ? pgCurRow.arm + ", " : ""}${name ? name + ": " : ""}${value}`; if (!PG_REFS[i].what.includes(what)) PG_REFS[i].what.push(what);
  return i + 1;
}
const pgPanel = (title, sub, html) => PG_PANELS.push({ title, sub, html, study: pgCurRow?.study_title || "" }) - 1;
const pgMissing = () => `<span class="muted" title="neuvedeno v dostupné dokumentaci">-</span>`;
function pgMetric(metric, label = "", name = label) {
  if (!metric || metric.value === null || metric.value === undefined || metric.value === "") return label ? `<div>${esc(label)}: ${pgMissing()}</div>` : pgMissing();
  const unit = metric.unit === "months" ? "měsíců" : metric.unit === "text" ? "" : metric.unit || "";
  const value = `${metric.value}${unit ? " " + unit : ""}`;
  const k = pgRef(metric, name, value);
  return `<div>${label ? `<span class="muted">${esc(label)}: </span>` : ""}<b>${esc(value)}</b><button class="ref" data-pgref="${k}" title="Otevřít zdroj">[${k}]</button>${metric.ci ? `<div class="muted small">${esc(metric.ci)}</div>` : ""}
</div>`;
}
function pgSimilarity(similarity) {
  if (!similarity) return pgMissing();
  const dimensions = Array.isArray(similarity.dimensions) ? similarity.dimensions : Object.entries(similarity.dimensions || {}).map(([name, value]) => ({ name, ...(typeof value === "object" ? value : { status: value }) }));
  const score = Number.isFinite(similarity.score) ? `<span class="pg-score">${esc(similarity.score)} %</span>` : pgMissing();
  return `${score}<div class="muted small">Orientační shoda populace${Number.isFinite(similarity.coverage) ? `<br>Pokrytí ${esc(similarity.coverage)} % váhy údajů` : ""}</div>${(similarity.critical_mismatches || []).length ? `<div class="pg-warning small">Zásadní rozdíl: ${esc(similarity.critical_mismatches.map(key => PG_DIMENSIONS[key] || key).join("; "))}</div>` : ""}<button class="linkbtn small" data-pgpanel="${pgPanel("Vysvětlení podobnosti", Number.isFinite(similarity.score) ? `Orientační shoda ${similarity.score} %` : "", `${similarity.method ? `<p>${esc(similarity.method)}</p>` : ""}<p>Skóre shody se studovanou populací. Nejde o pravděpodobnost přežití ani validovaný prognostický model.</p>
    ${similarity.coverage !== undefined ? `<p>Pokrytí známými údaji: ${esc(typeof similarity.coverage === "object" ? JSON.stringify(similarity.coverage) : similarity.coverage)} % celkové váhy</p>` : ""}
    <ul>${dimensions.map(d => `<li><b>${esc(d.label || PG_DIMENSIONS[d.key] || d.name || d.dimension || "")}</b>: ${esc(({ match:"shoda", mismatch:"neshoda", unknown:"nezjištěno", partial:"částečná shoda" })[d.status] || d.status || "nezjištěno")}${d.reason || d.explanation ? ` · ${esc(d.reason || d.explanation)}` : ""}${d.patient_quote ? `<div>Pacient: ${esc(d.patient_quote)}</div>` : ""}${d.study_quote ? `<div>Studie: ${esc(d.study_quote)}</div>` : ""}</li>`).join("")}</ul>
    ${(similarity.critical_mismatches || []).length ? `<p class="pg-warning">Zásadní rozdíly: ${esc(similarity.critical_mismatches.map(key => PG_DIMENSIONS[key] || key).join("; "))}</p>` : ""}`)}">Vysvětlení podobnosti</button>`;
}
function pgConflicts(conflicts, models) {
  const labels = Object.fromEntries([...PG_ENDPOINTS, ["orr", "ORR"], ["dor", "Trvání odpovědi"], ["toxicity_grade3", "Toxicita stupně ≥3"], ["discontinuation_toxicity", "Ukončení pro toxicitu"]]);
  return `<details class="pg-warning"><summary>Rozdílné extrahované hodnoty (${conflicts.length})</summary><p>Sporné hodnoty se nezobrazují v hlavní buňce. Ověřte populaci, rameno a analýzu.</p>${conflicts.map(conflict => `<div><b>${esc(labels[conflict.field] || conflict.field)}</b>${(conflict.values || []).map(value => `<div>${(value.found_by || []).map(id => esc(models.find(m => m.id === id)?.label || id)).join(", ")}${pgMetric(value, "", labels[conflict.field] || conflict.field)}</div>`).join("")}</div>`).join("")}</details>`;
}
function pgStudyRow(row, models) {
  pgCurRow = row;
  const source = row.source || {}, endpoints = row.endpoints || {};
  const found = (row.found_by || []).map(id => models.find(m => m.id === id)?.label || id);
  return `<tr><td><b>${esc(row.study_title || "Zdroj bez názvu")}</b><div class="small">${esc(source.published_date ? fmtDate(source.published_date) : source.year || "")} ${esc(row.study_type || "")}</div><div>${pgLink(source.url, source.pmid ? `PubMed ${source.pmid}` : source.doi ? `DOI ${source.doi}` : "Otevřít zdroj")}</div>
    <span class="chip plain k-unclear">Extrakce modelu · ověřit</span>${row.conflicts?.length ? pgConflicts(row.conflicts, models) : ""}</td>
    <td><b>${esc(row.arm || "")}</b><p>${esc(row.population || "")}</p>${row.sample_size ? `<div>n = ${esc(row.sample_size)}</div>` : ""}<div class="muted small">Počátek sledování: ${esc(row.time_origin || "neuvedeno v dostupné dokumentaci")}</div></td>
    <td>${pgSimilarity(row.similarity)}${row.similarity_variants?.length ? `<details><summary>Odlišná posouzení shody</summary>${row.similarity_variants.map(variant => `<div>${(variant.found_by || []).map(id => esc(models.find(m => m.id === id)?.label || id)).join(", ")}${pgSimilarity(variant.similarity || variant)}</div>`).join("")}</details>` : ""}</td>
    ${["os_6", "os_12", "os_36", "os_60", "pfs"].map(key => `<td>${pgMetric(endpoints[key], "", PG_ENDPOINTS.find(e => e[0] === key)[1])}</td>`).join("")}
    <td>${pgMetric(endpoints.orr, "ORR")}${pgMetric(endpoints.dor, "Medián trvání odpovědi")}</td>
    <td>${pgMetric(endpoints.toxicity_grade3, "Stupeň ≥3")}${pgMetric(endpoints.discontinuation_toxicity, "Ukončení pro toxicitu")}</td>
    <td>${pgMetric(endpoints.burden, "", "Zátěž léčby")}</td><td>${found.map(m => `<div class="small">${esc(m)}</div>`).join("")}</td></tr>`;
}
function pgProfile(profile) {
  if (!profile) return "";
  const facts = profile.facts || [];
  return `<details class="pg-profile"><summary>Klinický profil pro hledání (${facts.length} podkladů)</summary><p class="muted small">Původní strukturované syntetické podklady k datu MDT. Neobsahuje jméno, rodné číslo ani místní úpravy textů v prohlížeči.</p>
    <ul>${facts.map(f => `<li>${esc(typeof f === "string" ? f : f.text || f.text_cs || "")} <span class="muted small">${esc(f.date || "")}${f.source ? ` · ${esc(typeof f.source === "string" ? f.source : JSON.stringify(f.source))}` : ""}</span></li>`).join("")}</ul>
    ${(profile.warnings || []).map(w => `<p class="pg-warning small">${esc(w)}</p>`).join("")}</details>`;
}
function pgRefsHtml(refs, hit) {
  return `<ol class="pgrefs">${refs.map((r, i) => `<li id="pgref-${i + 1}" class="${i + 1 === hit ? "hit" : ""}"><span class="n">[${i + 1}]</span><div>
    <b>${esc(r.study || "Zdroj bez názvu")}</b><div class="muted small">${esc(r.what.join(" · "))}</div>
    ${r.quote ? `<blockquote>${esc(r.quote)}</blockquote>` : `<p class="muted small">Pasáž nebyla dodána.</p>`}
    ${r.locator ? `<div class="muted small">${esc(r.locator)}</div>` : ""}${r.url ? `<div>${pgLink(r.url, "Otevřít zdroj")}</div>` : ""}</div></li>`).join("")}</ol>`;
}
function tabPrognosis(p = P(S.pid)) {
  pgLoad(p); PG_PANELS = []; PG_REFS = []; pgCurRow = null;
  const state = pgEntry(p), result = state.result, config = PROGNOSIS.config, day = p.slot?.day;
  const models = result?.models || config?.models || [];
  const canSearch = !!day && !state.pending && !state.savedPending && !!state.profile && state.profile.available !== false && !!config?.configured;
  const status = { ok:"Dokončeno", success:"Dokončeno", partial:"Částečné výsledky", error:"Chyba", failed:"Chyba", pending:"Vyhledává", cached:"Z mezipaměti" };
  return `<section class="card" aria-labelledby="pg-title"><div class="head"><div><h2 id="pg-title">Prognóza</h2><div class="muted small">Výsledky studií pro podobné skupiny pacientů · rešerše asistenta</div></div>${day ? `<span class="chip plain">K datu MDT ${esc(fmtDate(day))}</span>` : ""}</div>
    <p>Porovnání výsledků jednotlivých studií. Uvedená procenta popisují studované skupiny; individuální prognózu posuzuje lékař.</p>
    ${!day ? `<p class="pg-warning">Pacient nemá termín MDT. Pro vyhledání nejprve vyberte den v kalendáři.</p><button class="btn" data-sched="${esc(p.file)}">Naplánovat MDT</button>` : ""}
    ${PROGNOSIS.configPending || state.profilePending ? `<div class="muted small" role="status">Načítání profilu a nastavení…</div>` : ""}
    ${(PROGNOSIS.configError || state.profileError) && !result?.saved && !state.savedPending ? `<div role="alert"><p class="pg-warning">${esc(PROGNOSIS.configError || state.profileError)}</p><button class="btn small" data-act="pgretry">Zkusit připojení znovu</button></div>` : ""}
    ${config && !config.configured ? `<p class="pg-warning">${esc(config.error || "Vyhledávání není nakonfigurováno. Doplňte API klíč a model Astra v serverovém .env.")}</p>` : ""}
    ${state.profile?.available === false ? `<p class="pg-warning">${esc(state.profile.reason || "Pro tento případ nejsou k datu MDT dostupné dostatečné strukturované podklady.")}</p>` : ""}
    ${pgProfile(state.profile)}

    <div class="pg-controls"><button class="btn primary" data-act="pgsearch" ${canSearch ? "" : "disabled"}>${state.savedPending ? "Načítání uložené rešerše…" : state.pending ? "Probíhá rešerše…" : result ? "Zobrazit uloženou rešerši" : "Vyhledat studie · Astra"}</button>${result ? `<button class="btn" data-act="pgrefresh" ${canSearch ? "" : "disabled"}>Nové vyhledání · 1 požadavek</button>` : ""}<span class="muted small">OS = celkové přežití · PFS = přežití bez progrese · ORR = podíl léčebných odpovědí</span></div>
    ${state.savedPending ? `<div class="pg-busy" role="status">Načítání uložené rešerše…</div>` : ""}
    ${state.pending ? `<div class="pg-busy" role="status">Astra vyhledává studie a jejich výsledky. Hledání může trvat několik minut.</div>` : ""}
    ${state.error ? `<p class="pg-warning" role="alert">${esc(state.error)}</p>` : ""}
    ${result?.saved_data_changed ? `<p class="pg-warning">Uložená rešerše vychází ze starších podkladů. Pro aktuální profil spusťte nové vyhledání.</p>` : ""}
    ${result ? `<div class="muted small" role="status">Nalezeno ${result.rows?.length || 0} populací / ramen · ${esc(result.searched_at || "")}${result.saved ? " · uložená rešerše" : result.cache_hit ? " · z mezipaměti" : ""}</div>` : ""}
    <div class="scroll" tabindex="0" role="region" aria-label="Studie a prognostické ukazatele"><table class="tbl pg-table"><colgroup><col class="pg-col-study"><col class="pg-col-population"><col class="pg-col-similarity"><col class="pg-col-os" span="4"><col class="pg-col-pfs"><col class="pg-col-response"><col class="pg-col-toxicity"><col class="pg-col-burden"><col class="pg-col-model"></colgroup><thead><tr><th scope="col">Studie / zdroj</th><th scope="col">Populace a léčba</th><th scope="col">Podobnost pacienta</th>${PG_ENDPOINTS.map(([key, label]) => `<th scope="col" aria-label="${esc(label)}">${({os_6:"6 měs.<br>OS",os_12:"12 měs.<br>OS",os_36:"3 roky<br>OS",os_60:"5 let<br>OS"})[key] || esc(label)}</th>`).join("")}<th scope="col">Našel model</th></tr></thead><tbody>${result?.rows?.length ? result.rows.map(row => pgStudyRow(row, models)).join("") : `<tr><td colspan="12" class="pg-empty">${state.savedPending ? "Načítání uložené rešerše…" : state.pending ? "Čekáme na výsledky Astry." : result ? "Astra nevrátila použitelné výsledky. Zkontrolujte stav rešerše a zdroje." : "Studie se zobrazí po spuštění vyhledávání."}</td></tr>`}</tbody></table></div>
    ${models.filter(model => model.error).map(model => `<p class="pg-warning" role="alert">${esc(model.error)}</p>`).join("")}
    <aside class="pg-footnotes" aria-label="Poznámky k rešerši">${[...(result?.warnings || []), ...models.flatMap(model => model.warnings || [])].map(w => `<p>${esc(w)}</p>`).join("")}
    <p>Každý řádek zachovává populaci, léčbu a počátek sledování zdroje. Chybějící hodnoty se nedopočítávají. Rešerše nezaručuje úplnost dostupné literatury. Podobnost je orientační shoda populace, nikoli pravděpodobnost přežití. Extrahované údaje vyžadují kontrolu ve zdroji.</p></aside></section>`;
}
