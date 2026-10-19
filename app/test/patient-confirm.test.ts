// A doctor's confirmation of the facts behind a line (ConfirmMark), the list of confirmations and edits the current
// run cannot show (OrphanList), and an empty section's check (CheckNote), against case 10's converted run. Synthetic
// values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { FactConfirmation } from "@codebridge/api-client";
import { confirmedContent } from "@codebridge/domain/confirmations";
import ConfirmMark from "../app/components/patient/ConfirmMark.vue";
import OrphanList from "../app/components/patient/OrphanList.vue";
import CheckNote from "../app/components/patient/CheckNote.vue";
import { fmtWhen } from "../app/lib/dates";
import { mountInCase, setupPatient, type PatientSetup } from "./patient";
import { docsOf, edit, runOf } from "./helpers";

// Two of case 10's comorbidities, standing in for a line composed of two facts.
const HT = "f-ffa5e9d3";
const HLP = "f-71e20468";
const WHEN = "2026-10-18T08:00:00.000Z";
const reply = { data: {}, data_epoch: 1, state: {} };

// The hash the server stores with a confirmation, computed as lib/confirm.ts does in the browser.
async function shaOf(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const factOf = (id: string) => runOf("NO-010").facts.find((f) => f.id === id)!;
const confirmation = async (fact_id: string, content = confirmedContent(factOf(fact_id))): Promise<FactConfirmation> => ({
  fact_id,
  action: "confirm",
  value_sha256: await shaOf(content),
  run_id: "run-old",
  who: "MUDr. A",
  when: WHEN,
});

const setup = (s: PatientSetup = {}) => setupPatient({ extraction: runOf("NO-010"), documents: docsOf("NO-010"), ...s });
// The hashes are computed asynchronously after mounting.
const mountMark = async (s: ReturnType<typeof setup>) => {
  const w = mountInCase(ConfirmMark, s, { factIds: [HT, HLP], text: "Hypertenzní nemoc; hyperlipoproteinémie" });
  await vi.waitFor(() => expect(w.find("button, .chip").exists()).toBe(true));
  return w;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ConfirmMark", () => {
  it("lets a doctor confirm a line: one request per fact, each against the state the page saw", async () => {
    const s = setup({ routes: { [`/cases/NO-010/facts/${HT}/confirmations`]: reply, [`/cases/NO-010/facts/${HLP}/confirmations`]: reply } });
    const w = await mountMark(s);
    const btn = w.get("button.cfbtn");
    expect(btn.text()).toBe("Potvrdit");
    expect(btn.attributes("aria-label")).toBe("Potvrdit údaj: Hypertenzní nemoc; hyperlipoproteinémie");
    await btn.trigger("click");
    await flushPromises();
    const posts = s.calls.filter((c) => c.url.includes("/confirmations"));
    expect(posts.map((c) => [c.url, c.init.method, JSON.parse(String(c.init.body))])).toEqual([
      [`/api/cases/NO-010/facts/${HT}/confirmations`, "POST", { action: "confirm", expected_state: "unconfirmed" }],
      [`/api/cases/NO-010/facts/${HLP}/confirmations`, "POST", { action: "confirm", expected_state: "unconfirmed" }],
    ]);
  });

  it("shows a line confirmed when every fact is, with who and when, and offers the doctor to withdraw it", async () => {
    const s = setup({ wf: { confirmations: [await confirmation(HT), await confirmation(HLP)] } });
    const w = await mountMark(s);
    expect(w.get(".chip.st-ready").text()).toBe(`potvrzeno: MUDr. A, ${fmtWhen(WHEN)}`);
    expect(w.get("button").text()).toBe("Zrušit potvrzení");
    const coord = await mountMark(setup({ role: "coordinator", wf: { confirmations: [await confirmation(HT), await confirmation(HLP)] } }));
    expect(coord.find("button").exists()).toBe(false);
  });

  it("shows a confirmation of another value as changed, with both values, and confirms again only that fact", async () => {
    // The doctor confirmed the lipid disorder when the run worded it differently.
    const earlier = { ...factOf(HLP), value: { text: "Hyperlipidémie" } };
    const s = setup({
      wf: { confirmations: [await confirmation(HT), await confirmation(HLP, confirmedContent(earlier))] },
      routes: { [`/cases/NO-010/runs/run-old/facts/${HLP}`]: { run_id: "run-old", fact: earlier }, [`/cases/NO-010/facts/${HLP}/confirmations`]: reply },
    });
    const w = await mountMark(s);
    await flushPromises();
    expect(w.get(".confirm.changed .chip").text()).toBe(`Potvrzeno dříve v jiném znění (MUDr. A, ${fmtWhen(WHEN)})`);
    expect(w.get(".confirm.changed").text()).toContain("Dříve: Hyperlipidémie; Nyní: Hyperlipoproteinémie, na dietě");
    await w.findAll("button").find((b) => b.text() === "Potvrdit nové znění")!.trigger("click");
    await flushPromises();
    const posts = s.calls.filter((c) => c.url.includes("/confirmations"));
    expect(posts.map((c) => [c.url, JSON.parse(String(c.init.body))])).toEqual([[`/api/cases/NO-010/facts/${HLP}/confirmations`, { action: "confirm", expected_state: "changed" }]]);
  });
});

describe("OrphanList", () => {
  it("lists an edit under an old position and a confirmation of a fact the run lacks, with who and when", async () => {
    const s = setup({
      wf: {
        edits: {
          "oc:0": edit("Starý řádek", "MUDr. A", { id: 4, orig: "Původní řádek", when: WHEN }),
          // An edit of a fact the run still has stays on its fact and is not listed.
          [`f:${HT}:t`]: edit("Hypertenze", "MUDr. A", { when: WHEN, fact_id: HT }),
        },
        confirmations: [{ fact_id: "f-0000abcd", action: "confirm", value_sha256: "0".repeat(64), run_id: "run-old", who: "MUDr. B", when: WHEN }],
      },
      routes: {
        "/cases/NO-010/edits/oc%3A0": reply,
        // The confirmed fact's text comes from the run the doctor confirmed.
        "/cases/NO-010/runs/run-old/facts/f-0000abcd": { run_id: "run-old", fact: { ...runOf("NO-010").facts.find((f) => f.id === HT)!, id: "f-0000abcd" } },
      },
    });
    const w = mountInCase(OrphanList, s);
    await flushPromises();
    expect(w.get("h2").text()).toBe("Potvrzeno dříve, v novém zpracování chybí");
    const items = w.findAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toBe(`Úprava „Starý řádek“ (MUDr. A, ${fmtWhen(WHEN)}) · původně: Původní řádek · uložena k pozici v dřívějším zobrazeníOdebrat úpravu`);
    expect(items[0]!.get("button").text()).toBe("Odebrat úpravu");
    expect(items[1]!.text()).toBe(`Potvrzený údaj „Hypertenzní nemoc“ (MUDr. B, ${fmtWhen(WHEN)})`);
    // A doctor may clear the orphaned edit, against the edit seen.
    await w.get("li button").trigger("click");
    await flushPromises();
    const del = s.calls.at(-1)!;
    expect([del.url, del.init.method, JSON.parse(String(del.init.body))]).toEqual(["/api/cases/NO-010/edits/oc%3A0", "DELETE", { expected_edit_id: 4 }]);
  });

  it("shows nothing when every edit and confirmation has its place", async () => {
    const w = mountInCase(OrphanList, setup({ wf: { confirmations: [await confirmation(HT)] } }));
    expect(w.find("section").exists()).toBe(false);
  });
});

describe("CheckNote", () => {
  it("says 'nezkontrolováno' for a check that did not run, and the gap dash otherwise, with unreadable pages", () => {
    const s = setup();
    const notRun = mountInCase(CheckNote, s, { check: { result: "not_run", unreadable: [], check_ids: [] } });
    expect(notRun.text()).toBe("nezkontrolováno");
    expect(notRun.get("span").attributes("title")).toBe("Zpracování tuto část v dokumentech nehledalo.");
    expect(notRun.find(".gapq").exists()).toBe(false);
    const page = (n: number) => ({ document_id: "10_pacient", part: null, page: n });
    const nothing = mountInCase(CheckNote, s, { check: { result: "nothing_found", unreadable: [page(4), page(2), page(4)], check_ids: [] } });
    expect(nothing.get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(nothing.text()).toMatch(/^-\s?\(Nečitelné strany: 2, 4\)$/);
    // No check at all (an older payload) is a gap, never "nothing found" said with more certainty.
    expect(mountInCase(CheckNote, s, { check: null }).find(".gapq").exists()).toBe(true);
  });
});
