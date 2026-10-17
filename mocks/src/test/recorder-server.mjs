// Checks mock v3's AI recorder in server mode (step 5, docs/research/backend-steps/step-5.md "As implemented") in jsdom
// against a fake server: live lines go to the server with client ids, the case's audio goes in parts, approval flushes
// both first and then polls the speaker pass job, and the page shows what the server stored. Embedded mode is covered by
// the other suites (the in-browser path is unchanged).
// Usage: JSDOM_PATH=/path/to/node_modules/jsdom node mocks/src/test/recorder-server.mjs  (jsdom 24)
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
      if (!w.CSS?.escape) w.CSS = { escape: v => String(v).replace(/[^a-zA-Z0-9_-]/g, c => "\\" + c) };
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.fetch = async (u, o) => { if (fetchImpl) return fetchImpl(String(u), o || {}, w); throw new TypeError("offline"); };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50 && /Načítám…/.test(w.document.getElementById("app").innerHTML); i++) await sleep(50);
  w.eval(`toast = (o => m => { (window.__toasts = window.__toasts || []).push(m); o(m); })(toast)`);
  return { w, ev: s => w.eval(s), evj: s => JSON.parse(w.eval(`JSON.stringify(${s})`) ?? "null"), errors };
}

const harvest = await open();
const H = JSON.parse(harvest.ev(`JSON.stringify({ patients: S.patients.map(p => ({ ...p, processing: p.full ? "full" : SYN.some(s => s.file === p.file) ? "partial" : "none" })),
  staff: defaultStaff(), user: S.user, userId: userIdOf(S.user), coord: COORD, c10: { case: CASE, extra: EXTRA }, syn: SYN })`));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => structuredClone(body) });

// Only the routes the recorder touches, shaped as the Worker answers them.
function fakeServer({ pass = "done", audioKept = false, code = "eleven_4xx" } = {}) {
  const st = { epoch: 3, writes: [], lines: [], parts: [], recs: [], jobs: {}, transcript: null, retries: 0 };
  const cases = {};
  const roles = Object.fromEntries([...H.staff.depts.flatMap(d => d.people.map(x => [x.id, "doctor"])), ["coord", "coordinator"], ["admin", "admin"]]);
  const caseOf = id => {
    const row = H.patients.find(r => r.id === id);
    return cases[id] || (cases[id] = { case_id: id, file: row.file, status: row.status, slot: row.slot, updated: row.updated, statusHist: [],
      protocol: { notes: "", concl: "", steps: [], state: "draft", version: 0, updated_by: null, updated_at: null, approver: null, approved_at: null },
      decisions: [], tasks: [], sugg: [], edits: {}, editLog: [], qConfirm: null, draft_sha: null, alertHist: [], clinical: true });
  };
  const ok = (data, state) => json(200, { data, data_epoch: st.epoch, ...(state ? { state } : {}) });
  const err = (status, code, message_cs) => json(status, { error: { code, message_cs } });
  const impl = async (u, o) => {
    const url = new URL(u, "http://localhost/"), path = url.pathname, method = (o.method || "GET").toUpperCase();
    const hd = o.headers || {};
    const body = o.body && typeof o.body === "string" ? JSON.parse(o.body) : o.body ?? null;
    if (method !== "GET") st.writes.push({ method, path, body, headers: hd, query: Object.fromEntries(url.searchParams) });
    if (path === "/api/health") return json(200, { service: "codebridge-mdt", features: { data: true, stt: true, transcripts: true }, limits: { audio_part_bytes: 64 }, demo: { data_epoch: st.epoch, reset_at: null, seed_version: "test", reset_enabled: true } });
    if (path === "/api/me") return json(200, { user: { id: H.userId, name: H.user, role: "doctor" }, auth_mode: "demo" });
    if (path === "/api/staff") return json(200, { ...H.staff, admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" }, roles, seq: 0 });
    if (path === "/api/patients") return json(200, { patients: H.patients, total: H.patients.length, page: 0 });
    if (path.startsWith("/api/tasks")) return json(200, { tasks: [] });
    if (path === "/api/workflow") return json(200, { data_epoch: st.epoch, cases, att: {}, sessions: [], mails: [] });
    let m = path.match(/^\/api\/cases\/([^/]+)\/extraction$/);
    if (m) { const p = H.patients.find(r => r.id === decodeURIComponent(m[1])), syn = H.syn.find(s => s.file === p?.file); return json(200, { data: p.file === "10_pacient.pdf" ? H.c10 : syn ? { syn } : null }); }
    if (/^\/api\/cases\/[^/]+\/guidance$/.test(path)) return json(200, { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] });
    if (method === "GET" && /^\/api\/cases\/[^/]+$/.test(path)) return json(200, {});
    if (path === "/api/audit/events") return ok({});
    if (path === "/api/recordings" && method === "POST") { st.recs.push(body); return json(201, { data: { recording_id: "rec-1", started_at: new Date().toISOString(), part_bytes: 64 }, data_epoch: st.epoch }); }
    if (/^\/api\/recordings\/[^/]+$/.test(path) && method === "PATCH") return ok({ ended_at: new Date().toISOString() });
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/transcript\/lines$/)) && method === "POST") {
      st.lines.push(...body.lines.map(l => ({ ...l, recording_id: body.recording_id })));
      return ok({ accepted: body.lines.map(l => l.client_line_id), duplicate: [], rejected: [] });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/transcript\/audio\/parts\/(\d+)$/)) && method === "PUT") {
      st.parts.push({ n: +m[2], final: url.searchParams.get("final"), bytes: body.byteLength, segs: JSON.parse(hd["X-Audio-Segments"]), type: hd["Content-Type"] });
      return ok({ part: +m[2] });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/protocol$/)) && method === "PUT") {
      const pr = caseOf(decodeURIComponent(m[1])).protocol;
      Object.assign(pr, { ...("concl" in body ? { concl: body.concl } : {}), version: pr.version + 1, updated_by: H.user, updated_at: new Date().toISOString() });
      return ok({ version: pr.version, updated_at: pr.updated_at, updated_by: pr.updated_by });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/decisions$/)) && method === "POST") {
      const id = decodeURIComponent(m[1]), c = caseOf(id), when = new Date().toISOString();
      Object.assign(c.protocol, { state: "approved", concl: body.conclusion, approver: H.user, approved_at: when });
      c.decisions.push({ id: "dec-1", version: 1, text: body.conclusion, by: H.user, when, slot: c.slot, attSnap: body.attendance_expected, pickSnap: [], reportSnap: body.report_html, supersedes: null });
      c.status = "done";
      st.jobs["sp-dec-1"] = { state: "running", phase: "diarize", polls: 0 };
      return ok({ decision_id: "dec-1", version: 1, tasks_created: 0, suggestions_created: 0, speaker_pass_job_id: "sp-dec-1" }, { cases: { [id]: c } });
    }
    if ((m = path.match(/^\/api\/jobs\/([^/]+)$/)) && method === "GET") {
      const j = st.jobs[m[1]]; j.polls++;
      if (j.polls >= 1) Object.assign(j, pass === "done" ? { state: "done", phase: null } : { state: "error", phase: null, error_code: code });
      return json(200, { id: m[1], kind: "speaker_pass", state: j.state, phase: j.phase, error_code: j.error_code || null });
    }
    if ((m = path.match(/^\/api\/jobs\/([^/]+)\/retry$/)) && method === "POST") { st.retries++; st.jobs[m[1]] = { state: "running", phase: "diarize", polls: 0 }; pass = "done"; return ok({ id: m[1], state: "queued", attempt: 2 }); }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/transcript$/))) {
      const j = st.jobs["sp-dec-1"];
      if (!j) return json(200, { lines: st.lines.map(l => ({ client_line_id: l.client_line_id, source: "live", speaker: null, wall_ms: l.wall_ms, text: l.text })), passes: [], summaries: [] });
      const done = j.state === "done" && pass === "done";
      return json(200, {
        lines: done ? [{ id: "x1", client_line_id: null, source: "speaker_pass", speaker: 0, wall_ms: Date.now() - 5000, text: "Pacientka po resekci." }, { id: "x2", client_line_id: null, source: "speaker_pass", speaker: 1, wall_ms: Date.now() - 4000, text: "Kontrolní CT za tři měsíce." }]
          : st.lines.map(l => ({ client_line_id: l.client_line_id, source: "live", speaker: null, wall_ms: l.wall_ms, text: l.text })),
        passes: [{ id: "sp-dec-1", state: done ? "done" : j.state === "error" ? "error" : "running", error_code: j.error_code || null, purge_reason: null, cutoff_wall_ms: Date.now(), job_id: "sp-dec-1", job_state: j.state, job_phase: j.phase, audio_kept: !done && audioKept }],
        summaries: [{ id: "s1", pass_id: "sp-dec-1", state: "done", basis: done ? "speaker_pass" : "live_only", text: "Kontrolní CT hrudníku za 3 měsíce.", label: "ai_draft" }],
      });
    }
    return err(404, "not_found", "Nenalezeno.");
  };
  return { impl, st };
}
const apiOpen = async srv => {
  const r = await open({ url: "http://localhost/", fetchImpl: srv.impl });
  for (let i = 0; i < 40 && r.ev(`DATA.mode`) !== "api"; i++) await sleep(25);
  assert.equal(r.ev(`DATA.mode`), "api");
  for (let i = 0; i < 40 && !r.ev(`S.api.transcripts`); i++) await sleep(25);
  return r;
};
const typeConcl = (w, text) => { const c = w.document.getElementById("concl"); c.value = text; c.dispatchEvent(new w.Event("input", { bubbles: true })); };
// Records as the page would after "Spustit záznam", without a microphone: the server recording, then lines and audio.
const startFake = ev => ev(`S.rec.on = true; S.rec.status = "on"; S.rec.recId = "rec-1"; S.rec.ses = { t0: Date.now() - 10000, spans: [{ from: 0, pid: S.pid }] }; recLinesTimer();`);
const said = (ev, words) => ev(`recMessage({ message_type: "committed_transcript_with_timestamps", words: ${JSON.stringify(words.map((t, i) => ({ type: "word", text: t, start: 1 + i * 0.2 })))} }, { base: 0, ses: S.rec.ses, recId: "rec-1" })`);

// 1. Lines and audio reach the server; approval flushes both first, then polls the job and shows speaker lines.
{
  const srv = fakeServer();
  const { w, ev, evj, errors } = await apiOpen(srv);
  assert.equal(ev(`recServer()`), true);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "ai"; render()`); await sleep(50);
  startFake(ev);
  said(ev, ["pacientka", "po", "resekci,", "pT2", "N0", "M0"]);
  // 80 samples with 32-sample parts: two full parts at once, the tail only at the flush.
  ev(`recAudioPush(S.pid, new Int16Array(50), true); recAudioPush(S.pid, new Int16Array(30), false)`);
  await sleep(2300);
  assert.equal(srv.st.lines.length, 1, "the committed line went to the server");
  assert.equal(srv.st.lines[0].text, "pacientka po resekci, pT2 N0 M0");
  assert.match(srv.st.lines[0].client_line_id, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(srv.st.lines[0].recording_id, "rec-1");
  assert.deepEqual(srv.st.parts.map(p => [p.n, p.final, p.bytes]), [[1, "0", 64], [2, "0", 64]], "full parts are sent while the case is discussed");
  assert.equal(srv.st.parts[0].type, "application/octet-stream");
  assert.equal(srv.st.parts[0].segs[0].start_sample, 0, "the first part carries the visit mark");
  said(ev, ["doporučuji", "kontrolní", "CT"]);
  typeConcl(w, "Kontrolní CT za 3 měsíce.");
  w.document.querySelector('[data-act="approve"]').click();
  await sleep(300);
  const iDec = srv.st.writes.findIndex(x => /decisions$/.test(x.path));
  const iFinal = srv.st.writes.findIndex(x => /parts\/3$/.test(x.path));
  const iLines = srv.st.writes.map((x, i) => [x, i]).filter(([x]) => /lines$/.test(x.path)).at(-1)[1];
  assert.ok(iFinal >= 0 && iFinal < iDec, "the final part is uploaded before the approval");
  assert.ok(iLines < iDec, "the last lines are stored before the approval");
  assert.equal(srv.st.parts.at(-1).final, "1");
  assert.equal(srv.st.parts.at(-1).bytes, 32, "the tail of 16 samples");
  assert.ok(/Rozlišuji mluvčí/.test(w.document.getElementById("recbody").innerHTML), "the pass shows as running");
  await sleep(2600);
  const body = w.document.getElementById("recbody").innerHTML;
  assert.match(body, /Mluvčí 1:/);
  assert.match(body, /Kontrolní CT za tři měsíce\./);
  assert.match(body, /Shrnutí AI · návrh/, "the summary is labelled a draft");
  assert.doesNotMatch(body, /pacientka po resekci, pT2/, "the speaker lines replace the live lines");
  assert.equal(srv.st.writes.filter(x => /\/api\/stt\/diarize|\/api\/summarize/.test(x.path)).length, 0, "the page no longer calls the old passes");
  assert.equal(srv.st.writes.filter(x => /audit\/events/.test(x.path) && /recording_(speaker_pass|summary|audio_deleted)/.test(JSON.stringify(x.body))).length, 0, "the server logs the passes itself");
  assert.deepEqual(errors, []);
  ev(`recStop()`); ev(`clearInterval(S.rec.timer)`);
}

// 2. A failed pass with kept audio offers "Zkusit znovu", which asks the server to run the job again.
{
  const srv = fakeServer({ pass: "error", audioKept: true });
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "ai"; render()`); await sleep(50);
  startFake(ev);
  said(ev, ["souhlasím"]);
  typeConcl(w, "Adjuvance neindikována.");
  w.document.querySelector('[data-act="approve"]').click();
  await sleep(2900);
  const body = w.document.getElementById("recbody").innerHTML;
  assert.match(body, /Rozlišení mluvčích selhalo \(služba přepisu záznam odmítla\)/);
  assert.match(body, /ze živého přepisu bez rozlišení mluvčích/);
  w.document.querySelector("[data-recretry]").click();
  await sleep(2600);
  assert.equal(srv.st.retries, 1);
  assert.match(w.document.getElementById("recbody").innerHTML, /Mluvčí 2:/);
  assert.deepEqual(errors, []);
  ev(`recStop()`); ev(`clearInterval(S.rec.timer)`);
}

// 3. A start that failed shows "Zpracování se nespustilo" with "Zkusit znovu", never a pass that seems to run.
{
  const srv = fakeServer({ pass: "error", code: "start_failed" });
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  startFake(ev);
  said(ev, ["souhlasím"]);
  typeConcl(w, "Adjuvance neindikována.");
  w.document.querySelector('[data-act="approve"]').click();
  ev(`curProto().mode = "ai"; render()`);
  await sleep(2900);
  const body = w.document.getElementById("recbody").innerHTML;
  assert.match(body, /Zpracování se nespustilo/);
  assert.doesNotMatch(body, /Rozlišuji mluvčí/);
  assert.ok(w.document.querySelector("[data-recretry]"));
  assert.deepEqual(errors, []);
  ev(`recStop()`); ev(`clearInterval(S.rec.timer)`);
}

console.log("Recorder server mode: lines with client ids, audio parts, flush before approval, job polling, speaker lines, draft summary, retry and a failed start passed.");
process.exit(0);
