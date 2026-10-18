// The source viewer drawer (F-18): the page image with the quoted passage, the page switcher, the transcription tab,
// zoom, the redaction demo and late replies. The page replies are synthetic: page 4 of case 10 comes from the
// committed synthetic page index (data/derived/page-index.json), shaped as GET /documents/:id/pages/:n returns it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useFluent } from "fluent-vue";
import SourceViewer from "../app/components/patient/SourceViewer.vue";
import { useOverlayStore, type SourceOverlay } from "../app/stores/overlay";
import { useSourceStore } from "../app/stores/source";
import { usePatientViewStore } from "../app/stores/patientView";
import { deferred } from "./helpers";
import { mountInCase, setupPatient } from "./patient";

const QUOTE = "Subj. nově předepsaný everolimus toleruje výbormně, nemá s ním žádný problém.";
const INDEX = JSON.parse(readFileSync(resolve(process.cwd(), "../data/derived/page-index.json"), "utf8"));
const PAGES = [1, 2, 3, 4, 5].map((n) => ({ n, empty: false }));

// One page as the Worker answers it; `extra` overrides fields.
function reply(n: number, extra: Record<string, unknown> = {}) {
  const pg = INDEX["10_pacient.pdf"].pages.find((p: { n: number }) => p.n === n);
  return {
    file: "10_pacient.pdf",
    document_id: "10_pacient",
    case_id: "NO-010",
    n,
    of: 5,
    doc_title: n === 4 ? "Ambulantní vyšetření kontrolní" : "Propouštěcí zpráva",
    image: `/api/documents/10_pacient/pages/${n}/image`,
    size: pg.size,
    text: pg.text,
    engine: pg.engine,
    empty: false,
    mean_conf: pg.mean_conf,
    low_conf_words: pg.low_conf_words,
    words: pg.words,
    verify: pg.verify,
    redacted: { image: `/api/documents/10_pacient/pages/${n}/image?redacted=1`, count: 2, reasons: ["jméno", "rodné číslo"] },
    pages: PAGES,
    ...extra,
  };
}

const routes = (over: Record<string, unknown> = {}) => ({
  "/documents/10_pacient/pages/2": reply(2),
  "/documents/10_pacient/pages/4": reply(4),
  ...over,
});

// The drawer as OverlayHost draws it, without the teleport, plus a way to call openSource with the real catalog.
async function openViewer(page: number | string = 4, quote: string | undefined = QUOTE, over: Record<string, unknown> = {}) {
  const s = setupPatient({ routes: routes(over) });
  let open!: (p: number | string, q?: string) => Promise<void>;
  const Host = defineComponent({
    setup() {
      const { $t } = useFluent();
      const ov = useOverlayStore();
      open = (p, q) => useSourceStore().openSource((id, a) => $t(id, a), { page: p, quote: q }, "10_pacient.pdf");
      return () => (ov.current?.kind === "source" ? h(SourceViewer, { o: ov.current as SourceOverlay }) : null);
    },
  });
  const w = mountInCase(Host, s);
  const done = open(page, quote);
  await flushPromises();
  await done;
  await nextTick();
  return { w, s, open };
}

const btn = (w: Awaited<ReturnType<typeof openViewer>>["w"], text: string) => w.findAll("button").find((b) => b.text() === text)!;

describe("source viewer", () => {
  it("opens the cited page with its header, page of pages and the quote box", async () => {
    const { w } = await openViewer();
    const aside = w.get("aside.drawer.wide");
    expect(aside.attributes("role")).toBe("dialog");
    expect(aside.attributes("aria-label")).toBe("Původní dokument");
    expect(w.get(".vlabel").text()).toBe("Původní dokument · obrázek stránky");
    expect(w.get("header h2").text()).toBe("Ambulantní vyšetření kontrolní");
    expect(w.get("header .muted.small").text()).toBe("10_pacient.pdf · NO-010 · strana 4 z 5");
    expect(w.get(".vquote").text()).toBe(`Hledaná citace (s. 4): „${QUOTE}“`);
    const img = w.get(".pgimg img");
    expect(img.attributes("alt")).toBe("Strana 4 dokumentu 10_pacient.pdf");
    expect(img.attributes("src")).toBe("/api/documents/10_pacient/pages/4/image");
    // The quote is found on the image: yellow boxes, the first one is the scroll target, no "not found" note.
    expect(w.findAll(".hbox").length).toBeGreaterThan(0);
    expect(w.get(".hbox").attributes("id")).toBe("hit");
    expect(w.find(".vnote").exists()).toBe(false);
    expect(w.get(".vengine").text()).toBe("3 místa k ověření" + "i");
    expect(w.get(".vengine .info").attributes("aria-label")).toBe("Přepis: jazykový model, kontrola: Tesseract, průměrná jistota Tesseractu 92,3 %");
    expect(w.text()).toContain("Žlutě: citovaná pasáž.");
    // Pages with aria-pressed on the shown one.
    const pages = w.findAll(".pages button");
    expect(pages.map((b) => b.text())).toEqual(["s. 1", "s. 2", "s. 3", "s. 4", "s. 5"]);
    expect(pages[3]!.attributes("aria-pressed")).toBe("true");
    expect(pages[1]!.attributes("aria-pressed")).toBe("false");
    // Dashed verify boxes carry why and what the transcription reads.
    expect(w.get(".vbox").attributes("title")).toMatch(/^Tesseract četl: .+, ověřit; přepis: /);
  });

  it("switches to the transcription tab with aria-selected and the quote in <mark>", async () => {
    const { w } = await openViewer();
    const [image, text] = w.findAll(".seg [role=tab]");
    expect(image!.attributes("aria-selected")).toBe("true");
    expect(text!.attributes("aria-selected")).toBe("false");
    await text!.trigger("click");
    expect(text!.attributes("aria-selected")).toBe("true");
    expect(text!.attributes("aria-pressed")).toBe("true");
    expect(image!.attributes("aria-selected")).toBe("false");
    expect(usePatientViewStore().srcTab).toBe("text");
    expect(w.find(".pgimg").exists()).toBe(false);
    expect(w.find(".zoomctl").exists()).toBe(false);
    const marks = w.findAll("mark");
    expect(marks.map((m) => m.text()).join("")).toBe(QUOTE);
    expect(marks[0]!.attributes("id")).toBe("hit");
    expect(w.get(".ptext").attributes("lang")).toBe("cs");
    // The heading's Markdown is kept as a heading, its asterisks hidden; a transcriber note is dimmed.
    expect(w.get(".ln.mdh").text()).toBe("Ambulantní vyšetření kontrolní");
    expect(w.get(".vm").text()).toBe("[logo: razítko SK vpravo nahoře]");
    expect(w.get(".vm").attributes("title")).toBe("Poznámka přepisu, není tištěný text");
    expect(w.text()).toContain("Na cílený dotaz neguje závratě či poruchy rovnováhy");
    expect(w.text()).toContain("Neoznačený text není ověřený; rozhoduje obrázek stránky.");
  });

  it("renders the transcription as text, never as markup", async () => {
    const { w } = await openViewer(4, undefined, { "/documents/10_pacient/pages/4": reply(4, { text: "<img src=x onerror=alert(1)> Hb 120", verify: [] }) });
    await btn(w, "Přepis stránky").trigger("click");
    expect(w.find(".ptext img").exists()).toBe(false);
    expect(w.get(".ptext .ln").text()).toBe("<img src=x onerror=alert(1)> Hb 120");
  });

  it("says when the quote is not found and highlights nothing", async () => {
    const { w } = await openViewer(4, "pacient odmítá adjuvantní chemoterapii i radioterapii");
    expect(w.get(".vnote.warn").text()).toBe("Citace nenalezena přesně, zobrazena celá stránka.");
    expect(w.find(".hbox").exists()).toBe(false);
    expect(w.findAll("button").some((b) => b.text() === "Přiblížit na citaci")).toBe(false);
  });

  it("highlights the quote only on the cited page", async () => {
    const { w } = await openViewer();
    await btn(w, "s. 2").trigger("click");
    await flushPromises();
    expect(w.get("header .muted.small").text()).toBe("10_pacient.pdf · NO-010 · strana 2 z 5");
    expect(w.findAll(".pages button")[1]!.attributes("aria-pressed")).toBe("true");
    expect(w.get(".pgimg img").attributes("alt")).toBe("Strana 2 dokumentu 10_pacient.pdf");
    expect(w.find(".hbox").exists()).toBe(false);
    expect(w.find(".vquote").exists()).toBe(false);
    expect(w.find(".vnote").exists()).toBe(false);
  });

  it("zooms with the buttons and keys, and resets to the drawer width", async () => {
    const { w } = await openViewer();
    const zoom = () => w.get(".zoomctl");
    const [out, inn, reset] = zoom().findAll("button");
    expect(zoom().attributes("aria-label")).toBe("Zvětšení stránky");
    expect(zoom().get(".zlvl").text()).toBe("Na šířku");
    expect(reset!.attributes("disabled")).toBeDefined();
    expect(inn!.attributes("disabled")).toBeUndefined();
    await inn!.trigger("click");
    expect(zoom().get(".zlvl").text()).toBe("125 %");
    expect(reset!.attributes("disabled")).toBeUndefined();
    expect(w.get(".pgimg").attributes("style")).toContain("max-width: none");
    for (let i = 0; i < 6; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    await nextTick();
    expect(zoom().get(".zlvl").text()).toBe("400 %");
    expect(inn!.attributes("disabled")).toBeDefined();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    await nextTick();
    expect(zoom().get(".zlvl").text()).toBe("Na šířku");
    await btn(w, "Přiblížit na citaci").trigger("click");
    expect(zoom().get(".zlvl").text()).toBe("100 %");
    await reset!.trigger("click");
    expect(zoom().get(".zlvl").text()).toBe("Na šířku");
  });

  it("swaps in the redacted image and hides the quote in the redaction demo", async () => {
    const { w } = await openViewer();
    const box = w.get("input[type=checkbox]");
    expect(box.element.parentElement!.textContent!.trim()).toBe("Cenzurovat (demo)");
    await box.setValue(true);
    const img = w.get(".pgimg img");
    expect(img.attributes("alt")).toBe("Strana 4 po začernění identifikátorů");
    expect(img.attributes("src")).toBe("/api/documents/10_pacient/pages/4/image?redacted=1");
    expect(w.find(".vquote").exists()).toBe(false);
    expect(w.find(".hbox").exists()).toBe(false);
    expect(w.find(".seg").exists()).toBe(false);
    expect(w.get(".vbody .synth").text()).toBe(
      "Ukázka místního začernění: takto by stránka odešla do cloudového jazykového modelu. Začerněno 2 místa (jméno, rodné číslo) přímo na serveru nemocnice. Data, diagnózy a nálezy zůstávají, proto je stránka stále osobní údaj.",
    );
  });

  it("names the document by its file when neither the server nor the case gives a title", async () => {
    const { w } = await openViewer(4, QUOTE, { "/documents/10_pacient/pages/4": reply(4, { doc_title: null }) });
    expect(w.get("header h2").text()).toBe("10_pacient.pdf");
  });

  it("says when the page image cannot be loaded", async () => {
    const { w } = await openViewer();
    await w.get(".pgimg img").trigger("error");
    expect(w.find(".pgimg img").exists()).toBe(false);
    expect(w.get(".pgimg p.synth").text()).toBe("Obrázek stránky se nepodařilo načíst. Přepis je v záložce „Přepis stránky“.");
  });

  it("shows an empty page as empty", async () => {
    const { w } = await openViewer(4, undefined, { "/documents/10_pacient/pages/4": reply(4, { text: "[prázdná stránka]", empty: true, verify: [], pages: PAGES.map((p) => ({ ...p, empty: p.n === 4 })) }) });
    expect(w.get(".vbody .synth").text()).toBe("Prázdná stránka: na stránce není žádný text.");
    const b = w.findAll(".pages button")[3]!;
    expect(b.text()).toBe("s. 4 (prázdná)");
    expect(b.attributes("title")).toBe("prázdná stránka");
    expect(w.find(".vengine").text()).toBe("i");
  });

  it("shows the loading drawer first and drops a page reply that arrives after close", async () => {
    const late = deferred<unknown>();
    const s = setupPatient({ routes: routes({ "/documents/10_pacient/pages/4": () => late.promise }) });
    const Host = defineComponent({
      setup() {
        const { $t } = useFluent();
        const ov = useOverlayStore();
        void useSourceStore().openSource((id, a) => $t(id, a), { page: 4, quote: QUOTE }, "10_pacient.pdf");
        return () => (ov.current?.kind === "source" ? h(SourceViewer, { o: ov.current as SourceOverlay }) : null);
      },
    });
    const w = mountInCase(Host, s);
    await nextTick();
    const loading = w.get("aside.drawer");
    expect(loading.attributes("aria-label")).toBe("Zdrojový dokument");
    expect(w.get("[role=status]").text()).toBe("Načítám stránku…");
    await btn(w as never, "Zavřít").trigger("click");
    expect(useOverlayStore().current).toBeNull();
    late.resolve(reply(4));
    await flushPromises();
    expect(useOverlayStore().current).toBeNull();
    expect(w.find("aside").exists()).toBe(false);
  });

  it("drops a page switch whose reply arrives after close", async () => {
    const late = deferred<unknown>();
    const { w } = await openViewer(4, QUOTE, { "/documents/10_pacient/pages/2": () => late.promise });
    const o = useOverlayStore().current as SourceOverlay;
    await btn(w, "s. 2").trigger("click");
    // The current page stays on screen while the next one loads.
    expect(w.get("header .muted.small").text()).toContain("strana 4 z 5");
    useOverlayStore().close();
    late.resolve(reply(2));
    await flushPromises();
    expect(useOverlayStore().current).toBeNull();
    expect(o.page).toBe(4);
  });
});
