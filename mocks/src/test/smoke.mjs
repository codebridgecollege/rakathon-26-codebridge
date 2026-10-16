import { JSDOM } from "jsdom";
import fs from "fs";
const html = fs.readFileSync(process.argv[2], "utf8");
const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window, doc = w.document;
const errs = []; w.addEventListener("error", e => errs.push(e.message));
w.HTMLElement.prototype.scrollIntoView = () => {}; w.scrollTo = () => {};
const click = sel => { const el = doc.querySelector(sel); if (!el) { errs.push("missing " + sel); return; } el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); };
const steps = [
  ['[data-nav="calendar"]'], ['[data-pick]'], ['[data-free]'], ['[data-nav="patients"]'], ['[data-act="newpatient"]'],
  ['[data-close]'], ['[data-open="10_pacient.pdf"]'], ['[data-brief="detailed"]'], ['.ref'], ['[data-close]'],
  ['[data-tl]'], ['[data-tab="anamnesis"]'], ['[data-tab="documents"]'], ['[data-tab="labs"]'], ['[data-tab="alerts"]'], ['[data-ack]'],
  ['[data-tab="compare"]'], ['[data-tab="history"]'], ['[data-go="present"]'], ['[data-go="protocol"]'], ['[data-act="addstep"]'], ['[data-mode="ai"]'], ['[data-mode="manual"]'],
];
for (const [s] of steps) { click(s); }
// fill protocol and approve
const sel = doc.querySelector('[data-att="Klinická onkologie"]'); sel.value = "MUDr. Svobodová"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
const c = doc.getElementById("concl"); c.value = "Test závěr"; c.dispatchEvent(new w.Event("input", { bubbles: true }));
const st = doc.querySelector('[data-step="0"][data-f="text"]'); st.value = "Objednat MR"; st.dispatchEvent(new w.Event("input", { bubbles: true }));
console.log("report live:", doc.getElementById("rep-concl")?.textContent);
click('[data-act="approve"]');
console.log("approved:", doc.body.textContent.includes("Schváleno"), "mail:", doc.body.textContent.includes("nové úlohy"));
click('[data-nav="tasks"]'); click('[data-scope="all"]'); console.log("tasks has new:", doc.body.textContent.includes("Objednat MR"));
click('[data-open="10_pacient.pdf"]'); click('[data-go="protocol"]'); console.log("still approved:", doc.body.textContent.includes("Schváleno")); click('[data-act="newversion"]'); console.log("new draft:", doc.body.textContent.includes("Koncept nového závěru"));
click('[data-nav="calendar"]'); click('[data-slot]'); click('[data-nav="patients"]'); click('[data-open="17_pacient.pdf"]'); console.log("identity warn:", doc.body.textContent.includes("Ověřit identitu"));
click('[data-open="2_pacient.pdf"]');
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no errors");
