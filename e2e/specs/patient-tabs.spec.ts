import { test, expect, type App } from "../fixtures";

// The patient tabs (PRODUCT.md F-03, F-05, F-06, F-21, F-27, prognosis): each renders its key content from the server.

async function openCase(app: App, nr: string, tab: string, name: RegExp): Promise<void> {
  await app.open(`patient/${nr}/${tab}`);
  await expect(app.main.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("case 10 shows all eight tabs and a click selects one", async ({ app }) => {
  await openCase(app, "10", "overview", /Poláček Daniel/);
  const tabs = app.main.getByRole("tablist").getByRole("tab");
  await expect(tabs).toHaveText([
    "Přehled",
    "Anamnéza",
    "Dokumenty",
    "Laboratoř",
    "Upozornění",
    "Navrhovaný postup",
    "Retrospektivní odchylky",
    "Prognóza",
  ]);
  await app.openTab("Anamnéza");
  // The tab is in the address as a path (/patient/10/anamnesis).
  await expect(app.page).toHaveURL(/^[^#]*\/patient\/10\/anamnesis$/);
});

test("the synthetic patient shows only the tabs its data supports", async ({ app }) => {
  await openCase(app, "S01", "documents", /Křemínek Radovan/);
  await expect(app.main.getByRole("tablist").getByRole("tab")).toHaveText(["Dokumenty", "Laboratoř", "Upozornění", "Prognóza"]);
});

test("Anamnéza lists the personal history with edit buttons", async ({ app }) => {
  await openCase(app, "10", "anamnesis", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Anamnéza" })).toBeVisible();
  await expect(app.main.getByText("Osobní anamnéza")).toBeVisible();
  const item = app.main.getByRole("listitem").filter({ hasText: "Hypertenzní nemoc" }).first();
  await expect(item.getByRole("button", { name: "Upravit" })).toBeVisible();
});

test("Dokumenty lists the documents with readability, and the column filter narrows them", async ({ app }) => {
  await openCase(app, "10", "documents", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Dokumenty (13)" })).toBeVisible();
  // Documents the PDF only cites are reported as missing originals.
  await expect(app.main.getByText("Chybí originály")).toBeVisible();
  const table = app.main.getByRole("table");
  const rows = table.getByRole("row").filter({ has: app.page.getByRole("cell") });
  await expect(rows).toHaveCount(13);
  await expect(rows.first().getByRole("cell", { name: /čitelné$/ })).toBeVisible();
  await app.main.getByRole("button", { name: "Čitelnost", exact: true }).click();
  const filter = app.page.getByRole("dialog", { name: "Filtr Čitelnost" });
  await filter.getByRole("checkbox", { name: "Částečně čitelné" }).uncheck();
  await filter.getByRole("button", { name: "Hotovo" }).click();
  await expect.poll(() => rows.count()).toBeLessThan(13);
  await expect(rows.getByRole("cell", { name: "Částečně čitelné", exact: true })).toHaveCount(0);
  await app.main.getByRole("button", { name: /^Zrušit filtry/ }).click();
  await expect(rows).toHaveCount(13);
  await app.main.getByRole("textbox", { name: "Hledat v dokumentech" }).fill("Laboratorní");
  await expect(rows.first()).toContainText("Laboratorní výsledky");
});

test("Laboratoř of case 10 shows the undated panel without a trend", async ({ app }) => {
  await openCase(app, "10", "labs", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Laboratoř · Hodnoty z dokumentu" })).toBeVisible();
  const row = app.main.getByRole("row", { name: /^Kreatinin S_CREAE/ });
  // Original value, unit and reference range are kept as the document gives them.
  await expect(row.getByRole("cell", { name: "107 ↑" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "µmol/l" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "59 ... 104" })).toBeVisible();
  // One undated panel is no series: no chart is drawn.
  await expect(app.main.getByRole("img", { name: /^Vývoj v čase/ })).toHaveCount(0);
});

test("Laboratoř of S01 shows four draws, the chart follows the picked test, and a value opens its source", async ({ app, page }) => {
  await openCase(app, "S01", "labs", /Křemínek Radovan/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Laboratoř · Vývoj v čase" })).toBeVisible();
  await expect(app.main.getByText("4 odběry z dokumentace")).toBeVisible();
  const plt = app.main.getByRole("row", { name: /^Trombocyty B_PLT/ });
  await expect(plt.getByRole("button", { name: "Trombocyty 12. 5. 2026: 54 10^9/l, otevřít zdroj" })).toHaveText("54 ↓");
  await expect(app.main.getByRole("img", { name: "Vývoj v čase, Leukocyty" })).toBeVisible();
  await plt.getByRole("cell", { name: /^Trombocyty B_PLT/ }).click();
  await expect(app.main.getByRole("img", { name: "Vývoj v čase, Trombocyty" })).toBeVisible();
  await plt.getByRole("button", { name: "Trombocyty 12. 5. 2026: 54 10^9/l, otevřít zdroj" }).click();
  const viewer = page.getByRole("dialog").filter({ has: page.getByRole("tab", { name: "Přepis stránky" }) });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: "s. 5" })).toHaveAttribute("aria-pressed", "true");
});

test("Upozornění groups the alerts and labels them as the assistant's observations", async ({ app }) => {
  await openCase(app, "10", "alerts", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 3, name: "K dotazu na MDT" })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 3, name: "Ostatní upozornění" })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 4, name: "Rozpor, další" })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 4, name: "Chronologie, další" })).toBeVisible();
  await expect(app.main.getByText(/Nejnovější ambulantní závěr je tedy na s\. 3/)).toBeVisible();
});

test("Navrhovaný postup quotes guideline statements that open to their reason and source", async ({ app }) => {
  await openCase(app, "10", "next", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 3, name: "Doporučené postupy k dalšímu postupu" })).toBeVisible();
  await expect(app.main.getByText("ne pořadí možností pro tohoto pacienta", { exact: false })).toBeVisible();
  // The assistant does not propose the management.
  await expect(app.main.getByText("asistent postup nenavrhuje", { exact: false })).toBeVisible();
  const entry = app.main.getByRole("group").filter({ hasText: /SRS is recommended for patients with a limited number/ }).last();
  await expect(entry).toContainText("síla: silné");
  await entry.getByText(/SRS is recommended for patients with a limited number/).first().click();
  await expect(entry.getByText(/^Proč:/)).toBeVisible();
  await expect(entry.getByText("otevřít v doporučení", { exact: true })).toBeVisible();
  // The layer can be switched off and on.
  const layer = app.main.getByRole("checkbox", { name: "vrstva doporučení" });
  await layer.uncheck();
  await expect(app.main.getByText(/SRS is recommended for patients with a limited number/)).toHaveCount(0);
  await layer.check();
  await expect(app.main.getByText(/SRS is recommended for patients with a limited number/).first()).toBeVisible();
});

test("Retrospektivní odchylky is a read-only table with the guideline edition valid at each decision", async ({ app }) => {
  await openCase(app, "10", "dev", /Poláček Daniel/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Odchylky a související zjištění" })).toBeVisible();
  await expect(app.main.getByText("4 zjištění · bez povinné akce")).toBeVisible();
  const table = app.main.getByRole("region", { name: "Tabulka odchylek a souvisejících zjištění" }).getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText([
    "Problém / zjištění",
    "Oblast",
    "Závažnost",
    "Doporučení",
    "Rok",
    "Znění doporučení",
    "Citace z dokumentace",
    "Možný klinický důsledek",
  ]);
  await expect(table.getByText(/Neznamená to, že nebyly provedeny nebo podány/).first()).toBeVisible();
  await expect(app.main.getByText(/platné od 1\. 3\. 2023 do 29\. 2\. 2024/).first()).toBeVisible();
  // Severity is set by doctors, never by the assistant, and the table takes no input.
  await expect(app.main.getByText("Závažnost není klinicky posouzena.", { exact: false })).toBeVisible();
  await expect(table.getByRole("textbox")).toHaveCount(0);
  await expect(table.getByRole("combobox")).toHaveCount(0);
});

test("Prognóza shows the saved study search for the MDT date", async ({ app }) => {
  await openCase(app, "10", "prognosis", /Poláček Daniel/);
  const region = app.main.getByRole("region", { name: "Prognóza" });
  await expect(region.getByRole("heading", { level: 2, name: "Prognóza" })).toBeVisible();
  await expect(region.getByText("K datu MDT 22. 10. 2026", { exact: false })).toBeVisible();
  await expect(region.getByText("individuální prognózu posuzuje lékař", { exact: false })).toBeVisible();
  await expect(region.getByRole("status").filter({ hasText: /Nalezeno 6 populací \/ ramen/ })).toContainText("uložená rešerše");
  const studies = region.getByRole("region", { name: "Studie a prognostické ukazatele" }).getByRole("table");
  await expect(studies.getByRole("row", { name: /^Cabozantinib versus Everolimus in Advanced Renal-Cell Carcinoma/ }).first()).toBeVisible();
  await expect(studies.getByRole("link", { name: "PubMed 26406150" }).first()).toBeVisible();
});
