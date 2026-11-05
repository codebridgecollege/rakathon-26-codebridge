// The Prognóza tab and its drawers: the saved search for the MDT day, the states around it, missing values, the
// reference list and the similarity explanation. Synthetic values only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import TabPrognosis from "../app/components/patient/TabPrognosis.vue";
import PgRefsDrawer from "../app/components/patient/PgRefsDrawer.vue";
import PgPanelDrawer from "../app/components/patient/PgPanelDrawer.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { usePatientsStore } from "../app/stores/patients";
import { deferred, row } from "./helpers";
import { mountInCase, setupPatient } from "./patient";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const DAY = "2026-10-22";
const SLOT = { day: DAY, time: "14:00" };
const QUOTE = "The estimated median progression-free survival was 7.4 months (95% CI, 5.6 to 9.1).";

// A saved search shaped like api/seed/out/objects/prognosis/NO-010/saved-2026-10-22.json, cut down.
const savedFor = (day: string) => ({
  patient_id: "10_pacient.pdf",
  scheduled_date: day,
  result: {
    profile: { available: true, facts: [{ text: "Diagnóza RCC (C64)", date: "4/2022", source: "s. 1" }], warnings: [] },
    models: [{ id: "m1", label: "GPT Astra", warnings: ["Výběr studií není vyčerpávající."] }],
    searched_at: "2026-10-17T09:25:36Z",
    cache_hit: true,
    warnings: [],
    rows: [
      {
        study_title: "Cabozantinib versus Everolimus in Advanced Renal-Cell Carcinoma",
        arm: "Cabozantinib",
        population: "METEOR: pokročilý RCC po VEGFR-TKI.",
        sample_size: 187,
        time_origin: "Randomizace",
        source: { url: "https://www.nejm.org/doi/full/10.1056/NEJMoa1510016", pmid: "26406150", published_date: "2015-09-25" },
        endpoints: { os_6: null, pfs: { value: 7.4, unit: "months", ci: "95% CI 5,6–9,1", quote: QUOTE, source_url: "https://www.nejm.org/doi/full/10.1056/NEJMoa1510016" } },
        found_by: ["m1"],
        similarity: {
          score: 71,
          coverage: 35,
          method: "Heuristická shoda mezi známými údaji.",
          dimensions: [{ key: "histology", status: "match", explanation: "Shodná světlobuněčná histologie.", patient_quote: "ccRCC G2", study_quote: "clear-cell component" }],
          critical_mismatches: [],
        },
      },
      {
        study_title: "Cabozantinib versus Everolimus in Advanced Renal-Cell Carcinoma",
        arm: "Everolimus",
        source: { url: "http://insecure.example/x", pmid: "26406150" },
        endpoints: { pfs: { value: 3.8, unit: "months", quote: QUOTE, source_url: "https://www.nejm.org/doi/full/10.1056/NEJMoa1510016" } },
        found_by: ["m1"],
        similarity: null,
      },
    ],
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// The Worker has no prognosis routes: the mocked API answers them with its JSON 404, as the Worker does.
const caseRoutes = (saved: unknown) => ({ "/cases/NO-010/prognosis": saved, "/audit/events": { data: {}, state: {} } });

describe("Prognóza tab", () => {
  it("shows the saved search for the MDT day after its delay, marked as saved", async () => {
    const s = setupPatient({ p: { slot: SLOT }, routes: caseRoutes({ saved: [savedFor("2026-10-29"), savedFor(DAY)] }) });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.text()).toContain("K datu MDT 22. 10. 2026");
    expect(w.get(".pg-busy").text()).toBe("Načítání uložené rešerše…");
    expect(w.get(".pg-controls .btn.primary").text()).toBe("Načítání uložené rešerše…");
    // The missing prognosis server is expected while a saved search is on its way: no error.
    expect(w.find("[role=alert]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(w.find("tbody tr td.pg-empty").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const status = w.findAll("[role=status]").find((x) => x.text().startsWith("Nalezeny 2 populace / ramena"));
    expect(status?.text()).toBe("Nalezeny 2 populace / ramena · 2026-10-17T09:25:36Z · uložená rešerše");
    expect(w.find("[role=alert]").exists()).toBe(false);
    expect(w.get(".pg-controls .btn.primary").text()).toBe("Zobrazit uloženou rešerši");
    expect(w.get("[role=region]").attributes("aria-label")).toBe("Studie a prognostické ukazatele");
    const link = w.get("tbody a");
    expect(link.text()).toBe("PubMed 26406150");
    expect(link.attributes()).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    // An http link is no link: the label stays as text.
    expect(w.findAll("tbody tr")[1]!.findAll("a")).toHaveLength(0);
    expect(w.findAll("tbody tr")[1]!.text()).toContain("PubMed 26406150");
    expect(w.get("tbody tr").text()).toContain("25. 9. 2015");
    expect(w.text()).toContain("Výběr studií není vyčerpávající.");
    expect(s.calls.filter((c) => c.url.includes("/cases/NO-010/prognosis"))).toHaveLength(1);
  });

  it("without an MDT day needs no calendar: as of today, the latest saved search shows", async () => {
    const s = setupPatient({ routes: caseRoutes({ saved: [savedFor(DAY)] }) });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.text()).toContain("Ke dnešnímu dni");
    expect(w.text()).not.toContain("K datu MDT");
    expect(w.text()).not.toContain("Naplánovat MDT");
    expect(w.text()).toContain("uložená rešerše");
  });

  it("says the search has not been started, and reports a server without it", async () => {
    const w = mountInCase(TabPrognosis, setupPatient({ routes: caseRoutes({ saved: [] }) }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.get("[role=alert]").text()).toContain("Vyhledávání studií zatím není na tomto serveru zapnuté");
    expect(w.get("tbody td.pg-empty").text()).toBe("Hledání zatím nebylo spuštěno. Spusťte ho tlačítkem.");
  });

  it("says there is not enough data only when the search cannot start", async () => {
    const routes = { ...caseRoutes({ saved: [] }), "/prognosis/config": { configured: true, models: [{ id: "m", label: "Astra" }] }, "/prognosis/profile": { profile: { available: false, reason: "Nedostatek údajů: případ zatím není zpracovaný, klinický profil nelze sestavit." } } };
    const w = mountInCase(TabPrognosis, setupPatient({ routes }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.get("tbody td.pg-empty").text()).toBe("Nedostatek údajů: hledání studií nelze spustit.");
    expect(w.text()).toContain("Nedostatek údajů: případ zatím není zpracovaný");
    expect(w.get(".pg-controls .btn.primary").attributes("disabled")).toBeDefined();
  });

  it("starts the search from the button, waits for the job and shows its result", async () => {
    let asked = 0;
    const routes = {
      "/cases/NO-010/prognosis": () => {
        asked++;
        // 1: opening the tab, nothing yet. 2: the job runs. 3: it is done and the result is saved.
        if (asked === 1) return { saved: [], run: null };
        if (asked === 2) return { saved: [], run: { id: "pg-1", state: "running", phase: "search", error_code: null, message_cs: null, updated_at: "x" } };
        return { saved: [savedFor("2026-11-05")], run: { id: "pg-1", state: "done", phase: null, error_code: null, message_cs: null, updated_at: "x" } };
      },
      "/audit/events": { data: {}, state: {} },
      "/prognosis/config": { configured: true, models: [{ id: "m", label: "Astra" }] },
      "/prognosis/profile": { profile: { available: true, facts: [{ text: "Diagnóza RCC (C64)", date: "4/2022", source: "s. 1" }], warnings: [] } },
      "/prognosis": [202, { job: { id: "pg-1", state: "queued" }, scheduled_date: "2026-11-05" }],
    };
    const s = setupPatient({ routes });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.get("tbody td.pg-empty").text()).toBe("Hledání zatím nebylo spuštěno. Spusťte ho tlačítkem.");
    expect(w.text()).toContain("stojí tokeny");
    const btn = w.get(".pg-controls .btn.primary");
    expect(btn.text()).toBe("Spustit hledání studií");
    await btn.trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    // It runs for a while: busy, and no second request is started by the button.
    expect(w.get(".pg-busy").text()).toContain("Hledání může trvat několik minut");
    expect(w.get(".pg-controls .btn.primary").attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(4000);
    expect(w.find(".pg-busy").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(w.find(".pg-busy").exists()).toBe(false);
    expect(w.text()).toContain("Nalezeny 2 populace / ramena");
    const post = s.calls.filter((c) => c.url === "/api/prognosis" && c.init.method === "POST");
    expect(post).toHaveLength(1);
    // No day, so no date is sent: the server searches as of today.
    expect(JSON.parse(String(post[0]!.init.body))).toEqual({ patient_id: "10_pacient.pdf", refresh: false });
  });

  it("shows why a search failed, in the server's words", async () => {
    let asked = 0;
    const routes = {
      "/cases/NO-010/prognosis": () => (++asked === 1 ? { saved: [], run: null } : { saved: [], run: { id: "pg-1", state: "error", phase: null, error_code: "missing_key", message_cs: "Na serveru chybí klíč OpenRouter.", updated_at: "x" } }),
      "/audit/events": { data: {}, state: {} },
      "/prognosis/config": { configured: true, models: [{ id: "m", label: "Astra" }] },
      "/prognosis/profile": { profile: { available: true, facts: [], warnings: [] } },
      "/prognosis": [202, { job: { id: "pg-1", state: "queued" } }],
    };
    const w = mountInCase(TabPrognosis, setupPatient({ routes }));
    await vi.advanceTimersByTimeAsync(2000);
    await w.get(".pg-controls .btn.primary").trigger("click");
    await vi.advanceTimersByTimeAsync(4000);
    expect(w.get("[role=alert]").text()).toBe("Na serveru chybí klíč OpenRouter.");
    expect(w.find(".pg-busy").exists()).toBe(false);
  });

  it("shows a missing value as a dash with the gap wording, never a number", async () => {
    const w = mountInCase(TabPrognosis, setupPatient({ p: { slot: SLOT }, routes: caseRoutes({ saved: [savedFor(DAY)] }) }));
    await vi.advanceTimersByTimeAsync(2000);
    const cells = w.get("tbody tr").findAll("td");
    // Column 4 is 6-month OS, which the study does not report.
    expect(cells[3]!.text()).toBe("-");
    expect(cells[3]!.get("span.muted").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(cells[8]!.text()).toBe("ORR: -Medián trvání odpovědi: -");
    expect(cells[7]!.text()).toContain("7.4 měsíců");
    expect(cells[7]!.text()).toContain("95% CI 5,6–9,1");
  });

  it("numbers the same passage once, and a reference opens the source list with an audit event", async () => {
    const s = setupPatient({ p: { slot: SLOT }, routes: caseRoutes({ saved: [savedFor(DAY)] }) });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(2000);
    const refs = w.findAll("button.ref");
    expect(refs.map((b) => b.text())).toEqual(["[1]", "[1]"]);
    await refs[1]!.trigger("click");
    await flushPromises();
    const ov = useOverlayStore().current;
    expect(ov).toEqual({ kind: "pgrefs", hit: 1 });
    const audit = s.calls.find((c) => c.url === "/api/audit/events")!;
    expect(JSON.parse(String(audit.init.body))).toEqual({ code: "prognosis_sources_opened", case_id: "NO-010" });

    const d = mountInCase(PgRefsDrawer, s, { o: ov });
    expect(d.get("aside").attributes("aria-label")).toBe("Zdroje prognózy");
    expect(d.get("h2").text()).toBe("Zdroje (1)");
    const li = d.get("li#pgref-1");
    expect(li.classes()).toContain("hit");
    expect(li.text()).toContain("Cabozantinib, Medián PFS: 7.4 měsíců · Everolimus, Medián PFS: 3.8 měsíců");
    expect(li.get("blockquote").text()).toBe(QUOTE);
    expect(li.get("a").attributes("href")).toBe("https://www.nejm.org/doi/full/10.1056/NEJMoa1510016");
  });

  it("opens the similarity explanation of a study", async () => {
    const s = setupPatient({ p: { slot: SLOT }, routes: caseRoutes({ saved: [savedFor(DAY)] }) });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.get(".pg-score").text()).toBe("71 %");
    await w.findAll("button").find((b) => b.text() === "Vysvětlení podobnosti")!.trigger("click");
    await flushPromises();
    const ov = useOverlayStore().current;
    expect(ov).toEqual({ kind: "pgpanel", panel: 0 });
    expect(JSON.parse(String(s.calls.find((c) => c.url === "/api/audit/events")!.init.body)).code).toBe("prognosis_source_opened");
    const d = mountInCase(PgPanelDrawer, s, { o: ov });
    expect(d.get("aside").attributes("aria-label")).toBe("Vysvětlení podobnosti");
    expect(d.get(".label").text()).toBe("Prognóza · Vysvětlení podobnosti");
    expect(d.get("header .muted.small").text()).toBe("Orientační shoda 71 %");
    expect(d.text()).toContain("Pokrytí známými údaji: 35 % celkové váhy");
    expect(d.get("li").text()).toBe("Histologie: shoda · Shodná světlobuněčná histologie.Pacient: ccRCC G2Studie: clear-cell component");
  });

  it("drops a late saved search for another day: the new day keeps its own state", async () => {
    const late = deferred<unknown>();
    let n = 0;
    // The first request (for 22. 10.) answers late; the second (for 29. 10.) at once, with nothing saved for that day.
    const s = setupPatient({ p: { slot: SLOT }, routes: { "/cases/NO-010/prognosis": () => (n++ === 0 ? late.promise : { saved: [savedFor(DAY)] }) } });
    const w = mountInCase(TabPrognosis, s);
    await vi.advanceTimersByTimeAsync(0);
    // The case moves to another day before the reply for the first day comes back.
    usePatientsStore().replace([row(10, { slot: { day: "2026-10-29", time: "14:00" } })], 1);
    await vi.advanceTimersByTimeAsync(0);
    late.resolve({ saved: [savedFor(DAY)] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.text()).toContain("K datu MDT 29. 10. 2026");
    expect(w.text()).not.toContain("uložená rešerše");
    expect(w.find("button.ref").exists()).toBe(false);
    expect(w.get("tbody td.pg-empty").text()).toBe("Hledání zatím nebylo spuštěno. Spusťte ho tlačítkem.");
    // The late reply landed in its own day: back on 22. 10. its search is there, without a new request.
    usePatientsStore().replace([row(10, { slot: SLOT })], 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.text()).toContain("uložená rešerše");
    expect(s.calls.filter((c) => c.url.includes("/cases/NO-010/prognosis"))).toHaveLength(2);
  });
});
