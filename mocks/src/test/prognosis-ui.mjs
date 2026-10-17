// UI checks focus on clinical labels, unsafe model strings and late replies across patients/dates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const saved = JSON.parse(readFileSync(new URL('../data/prognosis-case-10.json', import.meta.url), 'utf8'));
const code = readFileSync(new URL('../prognosis.js', import.meta.url), 'utf8').replace('/*PROGNOSIS_DATA*/', JSON.stringify([saved]));
const calls = [], renders = [];
const patients = { a: { file: 'a', slot: { day:'2026-10-22' } }, b: { file:'b', slot:{ day:'2026-10-23' } } };
const context = vm.createContext({
  S: { view:'patient', tab:'prognosis', pid:'a' },
  P: id => patients[id],
  esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]),
  URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
  fmtDate: x => x,
  logAccess: () => {},
  render: () => renders.push(context.S.pid),
  fetch: (url, options) => new Promise((resolve, reject) => { calls.push({ url, options, resolve }); options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }),
});
vm.runInContext(code + '\nglobalThis.api = { PROGNOSIS, pgEntry, pgSearch, pgMetric, pgSimilarity, pgStudyRow, pgUrl, tabPrognosis, pgJson, pgLoadSaved, pgLoad };', context);
const { api } = context;
api.PROGNOSIS.config = { configured:true, models:[{ id:'model1', label:'Model 1' }] };
api.pgEntry(patients.a).profile = { available:true, facts:[] };
const request = api.pgSearch();
assert.equal(calls.length, 1);
await api.pgSearch();
assert.equal(calls.length, 1, 'Double click must not send a second paid search');
assert.equal(JSON.parse(calls[0].options.body).scheduled_date, '2026-10-22');
context.S.pid = 'b';
calls[0].resolve({ ok:true, headers:{ get:() => 'application/json' }, json:async () => ({ rows:[], scheduled_date:'2026-10-22' }) });
await request;
assert.equal(renders.length, 1, 'Late patient A result must not rerender patient B');
assert.equal(api.pgEntry(patients.b).result, null);
context.S.pid = 'a';
await api.pgSearch();
assert.equal(calls.length, 1, 'Showing stored results must not submit another request');
context.S.pid = 'b';
patients.a.slot.day = '2026-10-24';
assert.equal(api.pgEntry(patients.a).result, null, 'Rescheduling must use a distinct result entry');

assert.equal(api.pgUrl('javascript:alert(1)'), '');
assert.equal(api.pgUrl('https://user:pass@example.org'), '');
assert.equal(api.pgUrl('https://pubmed.ncbi.nlm.nih.gov/123/'), 'https://pubmed.ncbi.nlm.nih.gov/123/');
const metric = api.pgMetric({ value:'<img src=x onerror=alert(1)>', unit:'%', quote:'<script>bad</script>', source_url:'javascript:bad' });
assert.doesNotMatch(metric, /<script>|<img|href="javascript/);
assert.match(metric, /&lt;script&gt;/);
assert.match(api.pgMetric(null), /neuvedeno v dostupné dokumentaci/);
assert.match(api.pgSimilarity({ score:100, coverage:25, dimensions:[] }), /25 % celkové váhy/);
assert.match(api.pgSimilarity({ score:100, coverage:25, dimensions:[] }), /není pravděpodobnost|Nejde o pravděpodobnost/);
const html = api.pgStudyRow({ study_title:'<script>x</script>', source:{url:'javascript:alert(1)'}, endpoints:{}, found_by:['model1'] }, [{id:'model1',label:'Model 1'}]);
assert.doesNotMatch(html, /<script>|href="javascript/);
assert.match(html, /Extrakce modelu · ověřit/);
assert.match(html, /Model 1/);

const response = api.pgJson('/bad');
calls.at(-1).resolve({ ok:false, headers:{get:()=>'application/json'},json:async()=>({error:{message:'Konkrétní chyba'}}) });
await assert.rejects(response, /Konkrétní chyba/);
patients.b.slot = null;
const unscheduled = api.tabPrognosis(patients.b);
assert.match(unscheduled, /Pacient nemá termín MDT/);
assert.match(unscheduled, /data-act="pgsearch" disabled/);
assert.match(unscheduled, /6měsíční OS/);
assert.match(unscheduled, /5leté OS/);
assert.match(unscheduled, /Medián PFS/);
assert.match(unscheduled, /Zátěž léčby/);
assert.match(unscheduled, /Vyhledat studie · Astra/);
assert.doesNotMatch(unscheduled, /3 modely|tří modelů|Fable|Gemini/);
let expire;
context.setTimeout = fn => { expire = fn; return 0; };
context.clearTimeout = () => {};
const timedOut = api.pgJson('/timeout');
expire();
await assert.rejects(timedOut, /Vypršel časový limit/);
const timers = [];
context.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length; };
patients.polacek = { file:saved.patient_id, slot:{day:saved.scheduled_date} };
context.S.pid = 'polacek';
api.pgEntry(patients.polacek).profile = saved.result.profile;
const beforeCalls = calls.length;
api.pgLoadSaved(patients.polacek);
assert.equal(timers.length, 1);
assert.equal(timers[0].delay, 2000);
assert.equal(api.pgEntry(patients.polacek).result, null, 'No saved result before the two-second delay');
assert.equal(api.pgEntry(patients.polacek).savedPending, true);
api.pgLoadSaved(patients.polacek);
assert.equal(timers.length, 1, 'Rerenders must not schedule additional replay timers');
const pending = api.tabPrognosis(patients.polacek);
assert.match(pending, /Načítání uložené rešerše/);
assert.match(pending, /data-act="pgsearch" disabled/);
context.S.pid = 'b';
const beforeRender = renders.length;
timers[0].fn();
assert.equal(renders.length, beforeRender, 'Saved result must not paint over another patient');
const replay = api.pgEntry(patients.polacek).result;
assert.equal(replay.saved, true);
assert.equal(replay.rows.length, saved.result.rows.length);
assert.equal(replay.searched_at, saved.result.searched_at);
assert.equal(calls.length, beforeCalls, 'Replaying a saved result must not make an API call');
patients.wrongDate = { file:saved.patient_id, slot:{day:'2026-10-23'} };
api.pgLoadSaved(patients.wrongDate);
assert.equal(timers.length, 1, 'A different MDT date must not replay the old result');
assert.equal(api.pgEntry(patients.wrongDate).result, null);
api.pgLoadSaved(patients.a);
assert.equal(timers.length, 1, 'Another patient must not receive Polacek results');
// A slow profile preview must not relabel older evidence as current after replay.
api.PROGNOSIS.entries.delete(JSON.stringify([saved.patient_id, saved.scheduled_date]));
context.S.pid = 'polacek';
const timerStart = timers.length;
const callStart = calls.length;
api.pgLoad(patients.polacek);
const savedTimer = timers.slice(timerStart).find(timer => timer.delay === 2000);
assert.ok(savedTimer);
savedTimer.fn();
assert.equal(api.pgEntry(patients.polacek).result.saved_data_changed, false);
const currentFacts = [{text:'Changed current clinical facts'}];
calls.at(-1).resolve({ok:true, headers:{get:()=> 'application/json'}, json:async()=>({profile:{facts:currentFacts}})});
await new Promise(resolve => setImmediate(resolve));
assert.equal(api.pgEntry(patients.polacek).result.saved_data_changed, true);
assert.equal(JSON.stringify(api.pgEntry(patients.polacek).profile.facts), JSON.stringify(saved.result.profile.facts));
assert.ok(calls.slice(callStart).every(call => call.options.method !== 'POST'));
console.log('Prognosis UI and two-second saved replay checks passed.');
