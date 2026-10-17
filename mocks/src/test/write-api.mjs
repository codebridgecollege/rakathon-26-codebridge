// Checks mock v3's write path (step 4, docs/research/backend-steps/step-4.md "As implemented") in jsdom: in API mode
// every change goes to the server and the page shows the server's answer. The fake server below follows that contract.
// Usage: JSDOM_PATH=/path/to/node_modules/jsdom node mocks/src/test/write-api.mjs  (jsdom 24, e.g. npm i jsdom@24.1.0 in a temp folder)
// Rebuild the page first: uv run mocks/build.py
import { createRequire } from "module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const html = readFileSync(new URL("../../v3.html", import.meta.url), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open({ url = "file:///repo/mocks/v3.html", fetchImpl } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (!w.structuredClone) w.structuredClone = structuredClone;
      if (!w.crypto?.randomUUID) Object.defineProperty(w, "crypto", { value: webcrypto });
      // jsdom has no CSS.escape; the staff screen uses it for department ids.
      if (!w.CSS?.escape) w.CSS = { escape: v => String(v).replace(/[^a-zA-Z0-9_-]/g, c => "\\" + c) };
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.fetch = async (u, o) => { if (fetchImpl) return fetchImpl(String(u), o || {}, w); throw new TypeError("offline"); };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50 && /Načítám…/.test(w.document.getElementById("app").innerHTML); i++) await sleep(50);
  // Toasts are collected so a test can read the server's Czech message.
  w.eval(`toast = (o => m => { (window.__toasts = window.__toasts || []).push(m); o(m); })(toast)`);
  // Objects cross from the jsdom realm as JSON, so deepEqual compares values, not prototypes.
  return { w, ev: s => w.eval(s), evj: s => JSON.parse(w.eval(`JSON.stringify(${s})`) ?? "null"), errors, toasts: () => JSON.parse(w.eval("JSON.stringify(window.__toasts || [])")) };
}

// The page's own embedded data gives the fake server its seed, as in case-store.mjs.
const harvest = await open();
const H = JSON.parse(harvest.ev(`JSON.stringify({ patients: S.patients.map(p => ({ ...p, processing: p.full ? "full" : SYN.some(s => s.file === p.file) ? "partial" : "none" })),
  staff: defaultStaff(), user: S.user, userId: userIdOf(S.user), coordId: "coord", coord: COORD,
  c10: { case: CASE, extra: EXTRA }, syn: SYN })`));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => structuredClone(body) });
const RESET_AT = "2026-10-17T08:00:00Z";

/* A server that follows the contract for the routes these tests touch. `hook(method, path, body, headers)` may answer
   first (to inject a conflict); every write is recorded with its headers. */
function fakeServer({ hook, workflow } = {}) {
  const st = { epoch: 3, writes: [], audit: [], rows: structuredClone(H.patients), cases: {}, att: {}, sessions: [], mails: [] };
  const roles = Object.fromEntries([...H.staff.depts.flatMap(d => d.people.map(x => [x.id, "doctor"])), ["coord", "coordinator"], ["admin", "admin"]]);
  const caseOf = id => {
    const row = st.rows.find(r => r.id === id);
    return st.cases[id] || (st.cases[id] = { case_id: id, file: row.file, status: row.status, slot: row.slot, updated: row.updated, statusHist: [],
      protocol: { notes: "", concl: "", steps: [], state: "draft", version: 0, updated_by: null, updated_at: null, approver: null, approved_at: null },
      decisions: [], tasks: [], sugg: [], edits: {}, editLog: [], qConfirm: null, draft_sha: null, alertHist: [], clinical: true });
  };
  if (workflow) workflow(st, caseOf);
  const who = hd => hd["X-Demo-User"] === "coord" ? H.coord : H.user;
  const ok = (data, state) => json(200, { data, data_epoch: st.epoch, ...(state ? { state } : {}) });
  const err = (status, code, message_cs, extra = {}) => json(status, { error: { code, message_cs, ...extra } });
  const one = id => ({ cases: { [id]: caseOf(id) } });
  const impl = async (u, o) => {
    const url = new URL(u, "http://localhost/"), path = url.pathname, method = (o.method || "GET").toUpperCase();
    const hd = o.headers || {}, body = o.body ? JSON.parse(o.body) : null;
    if (method !== "GET") st.writes.push({ method, path, body, headers: hd });
    if (hook) { const r = hook(method, path, body, hd, st); if (r) return r; }
    if (method !== "GET" && String(hd["X-Data-Epoch"]) !== String(st.epoch)) return err(409, "data_reset", "Ukázková data byla obnovena.");
    if (path === "/api/health") return json(200, { service: "codebridge-mdt", features: { data: true }, limits: {}, demo: { data_epoch: st.epoch, reset_at: RESET_AT, seed_version: "test", reset_enabled: true } });
    if (path === "/api/me") return json(200, { user: { id: hd["X-Demo-User"] || H.userId, name: who(hd), role: "doctor" }, auth_mode: "demo" });
    if (path === "/api/staff") return json(200, { ...H.staff, admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" }, roles, seq: 0 });
    if (path === "/api/patients") return json(200, { patients: st.rows.map(r => ({ ...r, ...(st.cases[r.id] ? { status: st.cases[r.id].status, slot: st.cases[r.id].slot } : {}) })), total: st.rows.length, page: 0 });
    if (path.startsWith("/api/tasks")) return json(200, { tasks: [] });
    if (path === "/api/workflow") return json(200, { data_epoch: st.epoch, cases: st.cases, att: st.att, sessions: st.sessions, mails: st.mails });
    let m = path.match(/^\/api\/cases\/([^/]+)\/extraction$/);
    if (m) { const p = st.rows.find(r => r.id === decodeURIComponent(m[1])), syn = H.syn.find(s => s.file === p?.file); return json(200, { data: p.file === "10_pacient.pdf" ? H.c10 : syn ? { syn } : null }); }
    if (/^\/api\/cases\/[^/]+\/guidance$/.test(path)) return json(200, { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] });
    if (method === "GET" && /^\/api\/cases\/[^/]+$/.test(path)) return json(200, {});
    if (path === "/api/audit/events" && method === "POST") { st.audit.push(body); return ok({}); }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/protocol$/)) && method === "PUT") {
      const c = caseOf(decodeURIComponent(m[1])), pr = c.protocol;
      // As the real server: `current` is the domain protocol (conclusion, updated_by_name), not the CaseState shape.
      if (body.version !== pr.version) return err(409, "protocol_conflict", `Koncept mezitím upravil(a) ${pr.updated_by || "jiný uživatel"}.`, { current: { notes: pr.notes, conclusion: pr.concl, steps: pr.steps, state: pr.state, version: pr.version, updated_by_name: pr.updated_by } });
      Object.assign(pr, { ...("notes" in body ? { notes: body.notes } : {}), ...("concl" in body ? { concl: body.concl } : {}), ...("steps" in body ? { steps: body.steps } : {}), version: pr.version + 1, updated_by: who(hd), updated_at: new Date().toISOString() });
      return ok({ version: pr.version, updated_at: pr.updated_at, updated_by: pr.updated_by });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/decisions$/)) && method === "POST") {
      const id = decodeURIComponent(m[1]), c = caseOf(id), pr = c.protocol;
      if (pr.state === "approved") return err(409, "already_approved", "Závěr už je schválen.");
      if (body.protocol_version !== pr.version) return err(409, "protocol_conflict", "Koncept mezitím upravil(a) jiný uživatel.", { current: { notes: pr.notes, conclusion: pr.concl, steps: pr.steps, state: pr.state, version: pr.version, updated_by_name: pr.updated_by } });
      const when = new Date().toISOString(), n = c.decisions.length + 1;
      Object.assign(pr, { state: "approved", concl: body.conclusion, approver: who(hd), approved_at: when });
      c.decisions.push({ id: `dec-${id}-${n}`, version: n, text: body.conclusion, by: who(hd), when, slot: c.slot, attSnap: body.attendance_expected, pickSnap: body.picked_sections, reportSnap: body.report_html, supersedes: n > 1 ? `dec-${id}-${n - 1}` : null });
      c.status = "done"; c.statusHist.push({ from: "new", to: "done", by: who(hd), when, how: "automaticky při schválení závěru" });
      c.tasks = pr.steps.filter(s => s.text.trim()).map((s, i) => ({ id: `t-${id}-${i}`, case_id: id, text: s.text, who: s.who, due: s.due, done: false }));
      if (c.tasks.length) st.mails.push({ kind: "approval", case_id: id, n: c.tasks.length, by: who(hd), when });
      return ok({ decision: c.decisions.at(-1) }, { ...one(id), mails: st.mails });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/decisions\/new-version$/)) && method === "POST") {
      const id = decodeURIComponent(m[1]), c = caseOf(id);
      if (c.protocol.state !== "approved") return err(409, "not_approved_yet", "Nový závěr lze začít až po schválení platného.");
      if (body.expected_decision_id !== c.decisions.at(-1)?.id) return err(409, "decision_changed", "Platný závěr se mezitím změnil; obnovte stránku.");
      c.protocol = { notes: "", concl: "", steps: [], state: "draft", version: 0, updated_by: null, updated_at: null, approver: null, approved_at: null };
      c.status = c.slot ? "scheduled" : "new";
      return ok({}, one(id));
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/slot$/)) && method === "PUT") {
      const id = decodeURIComponent(m[1]), c = caseOf(id);
      const holder = st.rows.find(r => r.id !== id && ((st.cases[r.id] ? st.cases[r.id].slot : r.slot)?.day === body.day) && ((st.cases[r.id] ? st.cases[r.id].slot : r.slot)?.time === body.time));
      if (holder) return err(409, "slot_taken", "Termín mezitím obsadil jiný případ. Vyberte jiný.");
      c.slot = { day: body.day, time: body.time }; if (c.status === "new") c.status = "scheduled";
      return ok({}, one(id));
    }
    return err(404, "not_found", "Nenalezeno.");
  };
  return { impl, st };
}
const apiOpen = async srv => {
  const r = await open({ url: "http://localhost/", fetchImpl: srv.impl });
  for (let i = 0; i < 40 && r.ev(`DATA.mode`) !== "api"; i++) await sleep(25);
  assert.equal(r.ev(`DATA.mode`), "api");
  return r;
};
const writes = (srv, re) => srv.st.writes.filter(x => re.test(`${x.method} ${x.path}`));
const typeConcl = (w, text) => { const c = w.document.getElementById("concl"); c.value = text; c.dispatchEvent(new w.Event("input", { bubbles: true })); };

// 1. GET /api/workflow fills the page: decisions, protocols, alert history, attendance, the session, mails, the banner.
{
  const srv = fakeServer({ workflow(st, caseOf) {
    const c10 = caseOf("NO-010"), when = "2026-10-16T12:30:00Z";
    c10.decisions = [{ id: "dec-7", version: 1, text: "Stereotaktická radioterapie ložiska v mozečku.", by: H.user, when, slot: { day: "2026-10-22", time: "14:00" }, attSnap: [H.user], pickSnap: ["summary"], reportSnap: "<article>snapshot</article>", supersedes: null }];
    Object.assign(c10.protocol, { concl: "Stereotaktická radioterapie ložiska v mozečku.", state: "approved", version: 4, approver: H.user, approved_at: when });
    c10.status = "done"; c10.alertHist = [{ i: "0", action: "ack", who: H.coord, when }];
    Object.assign(caseOf("NO-S01").protocol, { concl: "Koncept ze serveru", version: 2, updated_by: H.coord });
    st.att["2026-10-22"] = { key: "2026-10-22", version: 5, byName: { "Klinická onkologie": [H.user] }, byId: { d2: [H.userId] } };
    st.sessions = [{ day: "2026-10-22", started_by: H.coord, started_at: when, ended_at: null }];
    st.mails = [{ kind: "digest", to: H.coord, n: 3, by: H.coord, when }];
  } });
  const { w, ev, evj, errors } = await apiOpen(srv);
  assert.equal(ev(`S.decisions.length`), 1);
  assert.deepEqual(evj(`(({ id, version, pid, text, attSnap, reportSnap }) => ({ id, version, pid, text, attSnap, reportSnap }))(S.decisions[0])`),
    { id: "dec-7", version: 1, pid: "10_pacient.pdf", text: "Stereotaktická radioterapie ložiska v mozečku.", attSnap: [H.user], reportSnap: "<article>snapshot</article>" });
  assert.equal(ev(`ensureProto(P("10_pacient.pdf")).state`), "approved");
  assert.equal(ev(`ensureProto(P("10_pacient.pdf")).reportSnap`), "<article>snapshot</article>", "the approved report is the server's frozen snapshot");
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).concl`), "Koncept ze serveru");
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).version`), 2);
  assert.equal(ev(`alertState("10_pacient.pdf", 0).state`), "ack", "alert keys arrive as text and match the page's numeric flag index");
  assert.deepEqual(evj(`presentList("2026-10-22")`), [H.user]);
  assert.equal(ev(`S.session.day`), "2026-10-22");
  assert.match(ev(`S.mails[0].body`), /3 úlohy čekají na vyřízení/);
  assert.equal(ev(`DATA.epoch`), 3);
  // The banner, on every view, with the last reset time in Czech format.
  const banner = () => w.document.getElementById("demobanner").textContent.trim();
  const expected = `Ukázková data: všechny osoby a případy jsou smyšlené. Změny vidí všichni návštěvníci; správce je může obnovit (naposledy ${new Date(RESET_AT).toLocaleString("cs-CZ")}).`;
  for (const h of ["#patients", "#calendar/2026-10-19", "#tasks", "#patient/10/overview"]) { ev(`location.hash = "${h}"`); await sleep(60); assert.equal(banner(), expected, `banner on ${h}`); }
  ev(`DATA.demo.reset_at = null; render()`);
  assert.equal(banner(), "Ukázková data: všechny osoby a případy jsou smyšlené. Změny vidí všichni návštěvníci; správce je může obnovit.");
  // The approved conclusion shows from the server; "Nový závěr" is offered (the protocol is approved).
  ev(`openPatient("10_pacient.pdf")`); await sleep(80);
  assert.match(w.document.querySelector(".concl.valid").textContent, /Stereotaktická radioterapie ložiska v mozečku\./);
  assert.ok(w.document.querySelector('[data-act="newversion"]'));
  assert.deepEqual(errors, []);
}

// 2. Approve: everything typed is stored first, then one POST with one Idempotency-Key, even on a double click.
{
  const srv = fakeServer();
  const { w, ev, evj, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  typeConcl(w, "Kontrolní MR za 3 měsíce.");
  const btn = w.document.querySelector('[data-act="approve"]');
  assert.ok(btn && !btn.disabled);
  btn.click(); btn.click(); ev(`action("approve")`);
  await sleep(150);
  const ap = writes(srv, /^POST \/api\/cases\/NO-S01\/decisions$/);
  assert.equal(ap.length, 1, "one approval request for a double click and a second path");
  assert.ok(ap[0].headers["Idempotency-Key"], "approval carries an idempotency key");
  assert.equal(ap[0].headers["X-Demo-User"], H.userId);
  assert.equal(ap[0].headers["X-Data-Epoch"], "3");
  const put = srv.st.writes.findIndex(x => x.method === "PUT" && x.path === "/api/cases/NO-S01/protocol"), post = srv.st.writes.indexOf(ap[0]);
  assert.ok(put >= 0 && put < post, "the conclusion is stored before approval");
  assert.equal(ap[0].body.conclusion, "Kontrolní MR za 3 měsíce.");
  assert.equal(ap[0].body.protocol_version, 1, "approval names the version the autosave stored");
  assert.ok(ap[0].body.attendance_expected.includes(H.user), "the approver is in the expected attendance");
  assert.match(ap[0].body.report_html, /Kontrolní MR za 3 měsíce\./);
  assert.doesNotMatch(ap[0].body.report_html, / · Koncept</, "the frozen report is not labelled a draft");
  // Identity stays out of the stored snapshot; the page fills the placeholder from the patient row when it shows it.
  assert.match(ap[0].body.report_html, /<p class="pt-ident"><\/p>/);
  const ident = ev(`identLine(P("S01_pacient.pdf"))`), sur = ev(`surnameFirst(P("S01_pacient.pdf"))`), rc = ev(`P("S01_pacient.pdf").rc`);
  assert.ok(!ap[0].body.report_html.includes(sur) && (!rc || !ap[0].body.report_html.includes(rc)), "no name or birth number in the snapshot");
  ev(`S.overlay = { kind: "report" }; renderOverlay()`);
  assert.ok(w.document.querySelector("#report .pt-ident").textContent === ident, "the shown snapshot carries the current identity");
  ev(`S.overlay = null; renderOverlay()`);
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).state`), "approved");
  assert.equal(ev(`S.decisions.filter(d => d.pid === "S01_pacient.pdf").length`), 1);
  assert.equal(ev(`P("S01_pacient.pdf").status`), "done");
  assert.equal(w.document.querySelector('[data-act="approve"]'), null, "no approve button once approved");
  ev(`action("approve")`); await sleep(50);
  assert.equal(writes(srv, /decisions$/).length, 1, "an approved record is not approved again");
  // A retry after a lost answer reuses the key, so the server can replay instead of approving twice.
  const srv2 = fakeServer({ hook: (m, p) => m === "POST" && /decisions$/.test(p) && !srv2.lost ? (srv2.lost = true, Promise.reject(new TypeError("Failed to fetch"))) : null });
  const b = await apiOpen(srv2);
  b.ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  typeConcl(b.w, "Závěr k opakování.");
  b.ev(`action("approve")`); await sleep(120);
  assert.match(b.toasts().at(-1), /Server neodpovídá/, "a network failure is told in Czech");
  b.ev(`action("approve")`); await sleep(120);
  const tries = writes(srv2, /decisions$/);
  assert.equal(tries.length, 2);
  assert.equal(tries[0].headers["Idempotency-Key"], tries[1].headers["Idempotency-Key"], "the retry reuses the key");
  assert.equal(b.ev(`ensureProto(P("S01_pacient.pdf")).state`), "approved");
  assert.deepEqual([...errors, ...b.errors], []);
}

// 3. "Nový závěr" only supersedes an approved conclusion; an unapproved draft is never wiped (both modes).
{
  const emb = await open();
  emb.ev(`openPatient("S01_pacient.pdf")`); await sleep(60);
  typeConcl(emb.w, "Neschválený koncept");
  assert.equal(emb.w.document.querySelector('[data-act="newversion"]'), null, "embedded: no button for a draft");
  emb.ev(`action("newversion")`);
  assert.equal(emb.ev(`ensureProto(P("S01_pacient.pdf")).concl`), "Neschválený koncept", "embedded: the draft survives");
  const srv = fakeServer();
  const { w, ev, evj, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  typeConcl(w, "Neschválený koncept");
  assert.equal(w.document.querySelector('[data-act="newversion"]'), null, "API: no button for a draft");
  ev(`action("newversion")`); await sleep(50);
  assert.equal(writes(srv, /new-version/).length, 0, "API: nothing sent for a draft");
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).concl`), "Neschválený koncept");
  // After approval the button appears and asks the server, naming the latest decision.
  ev(`action("approve")`); await sleep(150);
  w.document.querySelector('[data-act="newversion"]').click(); await sleep(100);
  const nv = writes(srv, /new-version/);
  assert.equal(nv.length, 1);
  assert.equal(nv[0].body.expected_decision_id, "dec-NO-S01-1");
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).state`), "draft");
  assert.equal(ev(`S.decisions.filter(d => d.pid === "S01_pacient.pdf").length`), 1, "the earlier decision stays");
  // Drafts of a replaced decision come back "superseded": not offered, not counted as waiting.
  ev(`S.sugg.push({ id: "s-old", pid: "S01_pacient.pdf", text: "Objednat: MR", quote: "MR", who: COORD, due: "", state: "superseded" }); render()`);
  assert.equal(ev(`pendingSugg("S01_pacient.pdf").length`), 0);
  assert.equal(w.document.querySelector('[data-suggok="s-old"]'), null);
  assert.deepEqual([...emb.errors, ...errors], []);
}

// 4. A slot another user took: the server's Czech message, the case stays unscheduled, the calendar shows the holder.
{
  const srv = fakeServer({ hook: (m, p, b, hd, st) => {
    // Another user books NO-002 into 15:10 just before this page tries the same slot.
    if (m === "PUT" && p === "/api/cases/NO-S01/slot") { const r = st.rows.find(x => x.id === "NO-002"); r.slot = { day: "2026-10-22", time: "15:10" }; }
    return null;
  } });
  const { w, ev, evj, errors, toasts } = await apiOpen(srv);
  ev(`S.view = "calendar"; S.schedPick = "S01_pacient.pdf"; render()`);
  w.document.querySelector('[data-free="2026-10-22 15:10"]').click(); await sleep(150);
  assert.equal(toasts().at(-1), "Termín mezitím obsadil jiný případ. Vyberte jiný.");
  assert.equal(ev(`P("S01_pacient.pdf").slot`), null, "the refused booking is not shown");
  assert.equal(w.document.querySelector('[data-free="2026-10-22 15:10"]'), null, "the slot is no longer offered as free");
  assert.equal(w.document.querySelector('[data-slot="2026-10-22 15:10"]')?.dataset.dbl, "2_pacient.pdf", "the calendar shows who holds it now");
  // A free slot books, and the answer's state is shown.
  w.document.querySelector('[data-free="2026-10-22 15:20"]').click(); await sleep(120);
  assert.deepEqual(evj(`P("S01_pacient.pdf").slot`), { day: "2026-10-22", time: "15:20" });
  assert.equal(ev(`P("S01_pacient.pdf").status`), "scheduled");
  assert.deepEqual(errors, []);
}

// 5. A reset on the server: the next write gets data_reset, the page says so and reloads.
{
  const srv = fakeServer();
  const { ev, errors, toasts } = await apiOpen(srv);
  ev(`DATA.reload = () => { window.__reloaded = true; }`);
  srv.st.epoch = 4;
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`statusApi(P("S01_pacient.pdf"), "ready")`); await sleep(100);
  assert.ok(toasts().includes("Ukázková data byla obnovena, stránka se znovu načte."));
  assert.equal(ev(`P("S01_pacient.pdf").status`), "new", "nothing is applied from a refused write");
  await sleep(1600);
  assert.equal(ev(`window.__reloaded`), true);
  assert.deepEqual(errors, []);
}

// 6. View events go to POST /audit/events as codes, never as text; actions with their own route send nothing.
{
  const srv = fakeServer();
  const { ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`logAccess(S.pid, "otevřel(a) doporučení")`);
  ev(`logAccess(S.pid, "odebral(a) nahraný dokument Novakova-zprava.pdf")`);
  ev(`logAccess(S.pid, "nahrál(a) 3 dokumenty k projednání")`);
  ev(`logAccess(null, "importoval(a) žádost o konzultaci z FHIR")`);
  ev(`logAccess(S.pid, "schválil(a) závěr MDT")`);
  ev(`logAccess(S.pid, "změnil(a) stav případu: Nový -> Připraven (ručně)")`);
  await sleep(80);
  assert.deepEqual(srv.st.audit, [
    { code: "guide_opened", case_id: "NO-S01" },
    { code: "upload_removed", case_id: "NO-S01" },
    { code: "upload_added", case_id: "NO-S01", target: "3" },
    { code: "fhir_imported" },
  ]);
  assert.ok(!JSON.stringify(srv.st.writes).includes("Novakova"), "no file name reaches the server");
  assert.equal(ev(`S.access.length`), 0, "the page keeps no log of its own in API mode");
  assert.deepEqual(errors, []);
}

// 7. A version conflict of the discussion record: a bar with both choices, the typed text untouched.
{
  const srv = fakeServer({ workflow(st, caseOf) { Object.assign(caseOf("NO-S01").protocol, { concl: "", version: 0 }); } });
  const { w, ev, evj, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  // A colleague stores a version first.
  Object.assign(srv.st.cases["NO-S01"].protocol, { concl: "Verze kolegy", version: 1, updated_by: H.coord });
  typeConcl(w, "Moje verze");
  await sleep(1000);
  const bar = w.document.getElementById("protoconflict");
  assert.match(bar.textContent, new RegExp(`Koncept mezitím upravil\\(a\\) ${H.coord}\\.`));
  assert.ok(bar.querySelector('[data-act="prototheirs"]') && bar.querySelector('[data-act="protomine"]'));
  assert.equal(w.document.getElementById("concl").value, "Moje verze", "nothing overwritten silently");
  ev(`action("approve")`); await sleep(80);
  assert.equal(writes(srv, /decisions$/).length, 0, "no approval while the conflict waits");
  bar.querySelector('[data-act="protomine"]').click(); await sleep(120);
  assert.equal(srv.st.cases["NO-S01"].protocol.concl, "Moje verze", "overwrite with mine, by an explicit choice");
  assert.equal(w.document.getElementById("protoconflict").textContent.trim(), "");
  // A second conflict, answered with the stored version: the colleague's text replaces the field.
  Object.assign(srv.st.cases["NO-S01"].protocol, { concl: "Druhá verze kolegy", version: srv.st.cases["NO-S01"].protocol.version + 1 });
  typeConcl(w, "Moje druhá verze"); await sleep(1000);
  w.document.querySelector('#protoconflict [data-act="prototheirs"]').click(); await sleep(50);
  assert.equal(w.document.getElementById("concl").value, "Druhá verze kolegy");
  assert.equal(ev(`ensureProto(P("S01_pacient.pdf")).version`), srv.st.cases["NO-S01"].protocol.version);
  // A re-extracted draft question is not shown as confirmed: the confirmation names the text it confirmed.
  ev(`P("S01_pacient.pdf").explicit = false; P("S01_pacient.pdf").draft = "Nový návrh"; S.qConfirm["S01_pacient.pdf"] = { text: "Starý návrh", by: "x", when: "y" }`);
  assert.equal(ev(`qState(P("S01_pacient.pdf")).mode`), "draft");
  assert.deepEqual(errors, []);
}

// 8. Roles: the coordinator gets the discussion record read-only and no approve button (the server refuses both).
{
  const srv = fakeServer();
  const { w, ev, evj, errors } = await apiOpen(srv);
  const sel = w.document.getElementById("user"); sel.value = H.coord; sel.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(120);
  assert.equal(ev(`S.user`), H.coord);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`S.mdtOpen["S01_pacient.pdf"] = true; render()`);
  assert.ok(w.document.getElementById("notes").disabled, "notes read-only for the coordinator");
  assert.equal(w.document.querySelector('[data-act="addstep"]'), null);
  assert.ok(w.document.querySelector('[data-act="approve"]').disabled);
  assert.equal(ev(`isDoctor(COORD)`), false);
  // Doctors come from the server's roles, not from a title.
  assert.equal(ev(`DOCTORS.length`), H.staff.depts.flatMap(d => d.people).length);
  assert.deepEqual(errors, []);
}

// 9. The other writes: attendance by ids with its version, task done rolled back on refusal, alert keys on the wire,
// a new case with a duplicate birth number and a reason, break-the-glass, a new staff member's explicit role.
{
  const answers = {
    "PUT /api/attendance/case%3ANO-S01": (b, st) => ({ att: { "case:NO-S01": { key: "case:NO-S01", version: b.version + 1, byName: { "Klinická onkologie": [H.user] }, byId: b.by_dept } } }),
    "POST /api/cases/NO-010/alerts/gap%3A0/events": () => ({ cases: { "NO-010": { case_id: "NO-010", alertHist: [{ i: "gap:0", action: "ack", who: H.user, when: "2026-10-17T09:00:00Z" }] } } }),
    "POST /api/cases/NO-S01/break-glass": () => null,
  };
  let caseCalls = 0;
  const srv = fakeServer({ hook: (m, p, b, hd, st) => {
    if (m === "GET" && p === "/api/tasks") return json(200, { tasks: [{ id: "t-9", pid: "S01_pacient.pdf", case_id: "NO-S01", text: "Objednat MR", who: H.coord, due: "", done: false }] });
    if (m === "PATCH" && p === "/api/tasks/t-9") return json(409, { error: { code: "task_changed", message_cs: "Úlohu mezitím změnil jiný uživatel." } });
    if (m === "POST" && p === "/api/cases") {
      if (!b.duplicate_override) return json(409, { error: { code: "duplicate_birth_number", message_cs: "Rodné číslo už v databázi je.", current: { case_id: "NO-777" } } });
      return json(200, { data: {}, data_epoch: st.epoch, state: { patient: { ...H.patients[1], file: "21_novy", id: "NO-021", name: "Jana Testová", rc: b.birth_number, status: "new", slot: null, processing: "none" }, cases: {} } });
    }
    if (m === "POST" && /^\/api\/staff\/departments\/d1\/people$/.test(p)) return json(200, { data: {}, data_epoch: st.epoch, state: { staff: { ...H.staff, depts: H.staff.depts.map(d => d.id === "d1" ? { ...d, people: [...d.people, { id: "u-new", pre: "Bc.", sur: "Nová", post: "", fn: "" }] } : d), roles: { "u-new": "staff" } } } });
    if (m === "GET" && /^\/api\/cases\/NO-S01$/.test(p) && caseCalls++ === 0) return json(403, { error: { code: "not_member", message_cs: "Nejste v týmu tohoto případu. Lékař mimo tým může případ otevřít s uvedením důvodu." } });
    const a = answers[`${m} ${p}`];
    if (a) return json(200, { data: {}, data_epoch: st.epoch, ...(a(b, st) ? { state: a(b, st) } : {}) });
    return null;
  } });
  const { w, ev, evj, errors, toasts } = await apiOpen(srv);
  // Break-the-glass: the refusal offers a reason field; a short reason is refused in the page, a valid one is sent.
  ev(`openPatient("S01_pacient.pdf")`); await sleep(120);
  assert.equal(ev(`S.overlay?.kind`), "breakglass");
  w.document.getElementById("bgwhy").value = "krátký"; w.document.querySelector('[data-act="bggo"]').click(); await sleep(30);
  assert.match(w.document.getElementById("overlay").textContent, /10 až 500 znaků/);
  assert.equal(writes(srv, /break-glass/).length, 0);
  w.document.getElementById("bgwhy").value = "Konziliární posouzení na žádost primáře"; w.document.querySelector('[data-act="bggo"]').click(); await sleep(150);
  assert.deepEqual(writes(srv, /break-glass/).map(x => x.body), [{ reason: "Konziliární posouzení na žádost primáře" }]);
  assert.equal(ev(`S.overlay`), null);
  // Attendance: user ids by department id and the set's version.
  ev(`S.overlay = { kind: "start", day: attDay(P("S01_pacient.pdf")), attOnly: true }; renderOverlay()`);
  ev(`(() => { const s = document.querySelector('[data-att="Klinická onkologie"]'); s.value = ${JSON.stringify(H.user)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(80);
  const att = writes(srv, /attendance/);
  assert.equal(att.length, 1);
  assert.deepEqual(att[0].body, { version: 0, by_dept: { d2: [H.userId] } });
  assert.equal(ev(`S.attVer["case:NO-S01"]`), 1);
  // Task done: shown at once, put back when the server refuses.
  ev(`S.view = "tasks"; S.taskScope = "all"; render()`);
  w.document.querySelector('[data-done="t-9"]').click(); await sleep(80);
  assert.equal(ev(`S.tasks.find(t => t.id === "t-9").done`), false, "rolled back");
  assert.equal(toasts().at(-1), "Úlohu mezitím změnil jiný uživatel.");
  assert.deepEqual(writes(srv, /tasks/).at(-1).body, { done: true, expected_done: false });
  // Alert key "gap:0" travels URL-encoded, with the state the page saw.
  ev(`S.pid = "10_pacient.pdf"; S.view = "patient"; render()`); await sleep(100);
  ev(`alertAct("gap:0", "ack")`); await sleep(80);
  assert.deepEqual(writes(srv, /alerts/).map(x => x.body), [{ action: "ack", expected_state: "open" }]);
  assert.equal(ev(`alertState("10_pacient.pdf", "gap:0").state`), "ack");
  // New case: the server finds a duplicate this user cannot see; the second record needs a reason of 10 characters.
  ev(`S.overlay = { kind: "new", step: 2, progress: 4, files: [{ name: "a.pdf", size: 10 }], form: { nf0: "Jana", nf1: "Testová", nf2: "715309/1236", nfg: true } }; renderOverlay()`);
  w.document.querySelector('[data-act="newdone"]').click(); await sleep(100);
  assert.equal(ev(`S.overlay.step`), 0);
  assert.match(w.document.getElementById("overlay").textContent, /Pacient s tímto rodným číslem už v databázi je:\s*NO-777/);
  w.document.getElementById("nfdupwhy").value = "krátce"; w.document.querySelector('[data-act="newdupok"]').click(); await sleep(30);
  assert.match(w.document.getElementById("overlay").textContent, /nejméně 10 znaků/);
  w.document.getElementById("nfdupwhy").value = "Jiná osoba se stejným RČ, ověřeno"; w.document.querySelector('[data-act="newdupok"]').click(); await sleep(30);
  ev(`S.overlay.step = 2; S.overlay.progress = 4; renderOverlay()`);
  w.document.querySelector('[data-act="newdone"]').click(); await sleep(120);
  const cr = writes(srv, /^POST \/api\/cases$/);
  assert.equal(cr.length, 2);
  assert.deepEqual(cr[1].body.duplicate_override, { birth_number: "7153091236", reason: "Jiná osoba se stejným RČ, ověřeno" });
  assert.ok(cr[1].headers["Idempotency-Key"] && cr[1].headers["Idempotency-Key"] !== cr[0].headers["Idempotency-Key"], "a changed request gets a new key");
  assert.ok(ev(`!!P("21_novy")`), "the server's patient row joins the list");
  // Staff: a person without "MUDr." needs an explicit role; the server's roles decide who is a doctor.
  const sel = w.document.getElementById("user"); sel.value = H.coord; sel.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(120);
  ev(`S.view = "staff"; render()`);
  w.document.querySelector('[data-newin="d1"][data-sf="pre"]').value = "Bc."; w.document.querySelector('[data-newin="d1"][data-sf="sur"]').value = "Nová";
  w.document.querySelector('[data-staffadd="d1"]').click(); await sleep(50);
  assert.equal(writes(srv, /staff/).length, 0, "no role chosen, nothing sent");
  assert.match(toasts().at(-1), /Vyberte roli/);
  w.document.querySelector('[data-newin="d1"][data-sf="pre"]').value = "Bc."; w.document.querySelector('[data-newin="d1"][data-sf="sur"]').value = "Nová";
  w.document.querySelector('[data-newrole="d1"]').value = "staff";
  w.document.querySelector('[data-staffadd="d1"]').click(); await sleep(100);
  assert.equal(writes(srv, /staff/)[0].body.role, "staff");
  assert.ok(ev(`DEPTS[0][1].includes("Bc. Nová") && !isDoctor("Bc. Nová")`), "listed, not a doctor");
  assert.doesNotMatch(w.document.getElementById("app").textContent, /neukládají na server/);
  assert.deepEqual(errors, []);
}

console.log("Write API: workflow load, banner, approval (one request, idempotency key, stored first), Nový závěr guard in both modes, slot conflict, data reset reload, view events as codes, protocol conflict bar, coordinator read-only passed.");
process.exit(0);
