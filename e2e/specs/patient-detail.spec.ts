import { test, expect, type App } from "../fixtures";
import type { Locator } from "@playwright/test";

// Screen S-3 (detail pacienta, PRODUCT.md F-07, F-09, F-12, F-16, F-19, F-38): header, brief, the MDT question,
// doctor edits, alerts and the status menu. Patient NO-010 (Poláček Daniel) is the fully processed demo case.

const PATIENT = "Poláček Daniel";
const QUESTION = /^Jaký postup doporučuje neurochirurgický seminář u solitárního sytícího se ložiska/;
// The label of an MDT question the assistant drafted, shown until a doctor confirms or edits it (app only).
const DRAFT_LABEL = "Návrh asistenta";

// The smallest element that holds both the alert text and its action button: one alert entry.
function alertEntry(scope: Locator, text: string | RegExp, button = "Vyřešeno"): Locator {
  return scope
    .locator("*")
    .filter({ hasText: text })
    .filter({ has: scope.page().getByRole("button", { name: button, exact: true }) })
    .last();
}

async function openCase(app: App, tab = "overview"): Promise<void> {
  await app.open(`patient/10/${tab}`);
  await expect(app.main.getByRole("heading", { level: 1, name: new RegExp(PATIENT) })).toBeVisible();
}

test("header shows the case ID, status, owner, slot and the case actions", async ({ app }) => {
  await app.open();
  await app.openPatient(PATIENT);
  await expect(app.main.getByText("NO-010", { exact: true })).toBeVisible();
  await expect(app.main.getByRole("button", { name: "Připraven ▾" })).toBeVisible();
  await expect(app.main.getByText("Vlastník: MUDr. Svobodová")).toBeVisible();
  await expect(app.main.getByText("Příští MDT: Čt 22. 10. 2026 · 14:00-14:10")).toBeVisible();
  for (const name of ["Změnit termín", "Zahájit MDT", "Export FHIR", "Stáhnout report (PDF)"]) {
    await expect(app.main.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // A missing birth number and age show as a dash whose tooltip is the fixed gap wording, never as a guess.
  const heading = app.main.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("RČ: -");
  await expect(heading.getByTitle("neuvedeno v dostupné dokumentaci", { exact: true }).first()).toHaveText("-");
});

test("brief shows the summary, the current state and the missing-documents warning", async ({ app }) => {
  await openCase(app);
  await expect(app.main.getByRole("heading", { level: 2, name: "Stručný souhrn" })).toBeVisible();
  await expect(app.main.getByRole("button", { name: /^Pacient s metastatickým světlobuněčným renálním karcinomem/ })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 2, name: /^Aktuální stav pacienta/ })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 2, name: /^Onkologický souhrn/ })).toBeVisible();
  // Missing-document alerts are always signalled on the brief; the list sits one click away.
  const gaps = app.main.getByRole("button", { name: "⚠ Upozornění · chybí podklady ▾" });
  await expect(gaps).toBeVisible();
  await gaps.click();
  await expect(app.main.getByRole("button", { name: "⚠ Upozornění · chybí podklady ▴" })).toHaveAttribute("aria-expanded", "true");
  await expect(app.main.getByText("Upozornění k dotazu na MDT")).toBeVisible();
  // Alert text is the run's Fluent message, its fact argument shown as the fact's line.
  await expect(app.main.getByText(/Originální zpráva v dostupné dokumentaci chybí, jen citace: MR mozek/).first()).toBeVisible();
});

test("an unprocessed case says its missing documents were not checked", async ({ app }) => {
  await app.open("patient/2/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Kotěrová Jaroslava/ })).toBeVisible();
  await expect(app.main.getByText("⚠ Chybějící podklady nezkontrolovány (případ nezpracován)")).toBeVisible();
  await expect(app.main.getByRole("button", { name: /Upozornění · chybí podklady/ })).toHaveCount(0);
});

test("a doctor confirms the drafted MDT question and the confirmation survives a reload", async ({ app, page }) => {
  await openCase(app);
  await expect(app.main.getByText("Otázka pro MDT", { exact: true })).toBeVisible();
  await expect(app.main.getByRole("button", { name: QUESTION })).toBeVisible();
  // The app labels the assistant's draft until a doctor confirms it.
  await expect(app.main.getByText(DRAFT_LABEL, { exact: true })).toBeVisible();
  await app.main.getByRole("button", { name: "Potvrdit otázku" }).click();
  await expect(page.getByText("Otázka potvrzena", { exact: true })).toBeVisible();
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toHaveCount(0);
  await expect(app.main.getByText(DRAFT_LABEL, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(app.main.getByRole("button", { name: QUESTION })).toBeVisible();
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toHaveCount(0);
  await expect(app.main.getByText(DRAFT_LABEL, { exact: true })).toHaveCount(0);
});

test("the coordinator cannot confirm the drafted question", async ({ app }) => {
  await app.open();
  await app.loginAs("Bc. Marková (koordinátorka MDT)");
  await app.openPatient(PATIENT);
  // The coordinator reads the question but cannot edit it (plain text, not a button) or confirm it.
  await expect(app.main.getByText(QUESTION)).toBeVisible();
  await expect(app.main.getByRole("button", { name: QUESTION })).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toHaveCount(0);
  // The coordinator sees the draft label too: the question is still unconfirmed.
  await expect(app.main.getByText(DRAFT_LABEL, { exact: true })).toBeVisible();
});

test("a doctor edits the MDT question, the edit persists, and revert restores the original", async ({ app, page }) => {
  await openCase(app);
  await app.main.getByRole("button", { name: QUESTION }).click();
  const dlg = app.dialog("Upravit údaj");
  await expect(dlg.getByRole("heading", { name: "Otázka pro MDT" })).toBeVisible();
  await expect(dlg.getByText("Úprava se uloží jako změna od MUDr. Svobodová s časem.", { exact: false })).toBeVisible();
  await dlg.getByRole("textbox").fill("Je indikována stereotaktická radiochirurgie ložiska v mozečku?");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(dlg).toBeHidden();
  const edited = app.main.getByRole("button", { name: /^Je indikována stereotaktická radiochirurgie ložiska v mozečku\?/ });
  await expect(edited).toBeVisible();
  // A doctor's text is no longer the assistant's draft.
  await expect(app.main.getByText(DRAFT_LABEL, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(edited).toBeVisible();
  await edited.click();
  await app.dialog("Upravit údaj").getByRole("button", { name: "Vrátit původní" }).click();
  await expect(app.main.getByRole("button", { name: QUESTION })).toBeVisible();
});

test("a doctor edits a fact in the oncology summary and reverts it", async ({ app, page }) => {
  await openCase(app);
  const fact = app.main.getByRole("button", { name: /^3\. paliativní linie everolimus 5 mg denně/ });
  // The pencil sits right after the fact's source link (not inside it: no control nested in a control), so it is found
  // in the fact's parent.
  const pencil = (f: typeof fact) => f.locator("..").getByRole("button", { name: "Upravit", exact: true });
  await pencil(fact).click();
  const dlg = app.dialog("Upravit údaj");
  await dlg.getByRole("textbox").fill("3. paliativní linie everolimus 10 mg denně (upřesněno)");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  const edited = app.main.getByRole("button", { name: /^3\. paliativní linie everolimus 10 mg denně \(upřesněno\)/ });
  await expect(edited).toBeVisible();
  await expect(edited).toContainText("upraveno");
  await page.reload();
  await expect(edited).toBeVisible();
  await pencil(edited).click();
  await app.dialog("Upravit údaj").getByRole("button", { name: "Vrátit původní" }).click();
  const original = app.main.getByRole("button", { name: /^3\. paliativní linie everolimus 5 mg denně/ });
  await expect(original).toBeVisible();
  await expect(original).not.toContainText("upraveno");
});

test("alerts: acknowledge, resolve and reopen, and the history survives a reload", async ({ app, page }) => {
  await openCase(app, "alerts");
  await expect(app.main.getByRole("heading", { level: 2, name: "Upozornění" })).toBeVisible();
  await expect(app.main.getByText("Pozorování asistenta, ne klinický závěr. Upozornění neblokují projednání.")).toBeVisible();

  // One alert per missing field (alert IDs follow rule and subject), worded by its Fluent message.
  const age = /Věk: neuvedeno v dostupné dokumentaci/;
  await alertEntry(app.main, age).getByRole("button", { name: "Vyřešeno" }).click();
  const done = app.main.getByText(/^Vyřešené \/ vzaté na vědomí \(1\)$/);
  await expect(done).toBeVisible();

  const chrono = /Požadavek bez výsledku v dostupné dokumentaci: projednání nálezu MR mozku/;
  await alertEntry(app.main, chrono, "Vzít na vědomí").getByRole("button", { name: "Vzít na vědomí" }).click();
  await expect(app.main.getByText(/^Vyřešené \/ vzaté na vědomí \(2\)$/)).toBeVisible();

  await page.reload();
  const summary = app.main.getByText(/^Vyřešené \/ vzaté na vědomí \(2\)$/);
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(app.main.getByText(/Vyřešil\(a\)/).first()).toBeVisible();
  await expect(app.main.getByText(/Vzal\(a\) na vědomí/).first()).toBeVisible();
  await alertEntry(app.main, age, "Vrátit").getByRole("button", { name: "Vrátit" }).click();
  await expect(app.main.getByText(/^Vyřešené \/ vzaté na vědomí \(1\)$/)).toBeVisible();
});

test("the status menu changes the status and records it in the history", async ({ app, page }) => {
  await openCase(app);
  await app.main.getByRole("button", { name: "Připraven ▾" }).click();
  const menu = app.dialog("Stav případu");
  await expect(menu.getByText("V této relaci beze změn.")).toBeVisible();
  await menu.getByRole("button", { name: "Změnit na: Vyžaduje pozornost" }).click();
  await expect(app.main.getByRole("button", { name: "Vyžaduje pozornost ▾" })).toBeVisible();
  await page.reload();
  await app.main.getByRole("button", { name: "Vyžaduje pozornost ▾" }).click();
  await expect(app.dialog("Stav případu")).toContainText("Připraven -> Vyžaduje pozornost");
});

test("the timeline filters events by category", async ({ app }) => {
  await openCase(app);
  const status = app.main.getByRole("status").filter({ hasText: /událostí/ });
  await expect(status).toHaveText("Zobrazeno 16 z 16 událostí · 9 z 9 kategorií");
  const group = app.main.getByRole("group", { name: "Kategorie událostí" });
  await group.getByRole("checkbox", { name: /^Zobrazovací vyšetření/ }).uncheck();
  await expect(status).toHaveText("Zobrazeno 10 z 16 událostí · 8 z 9 kategorií");
  // With some categories off, "Vše" is not ticked; ticking it shows everything, unticking hides everything.
  const all = group.getByRole("checkbox", { name: /^Vše/ });
  await all.check();
  await expect(status).toHaveText("Zobrazeno 16 z 16 událostí · 9 z 9 kategorií");
  await all.uncheck();
  await expect(app.main.getByText("Všechny kategorie jsou skryté", { exact: false })).toBeVisible();
  await all.check();
  await expect(status).toHaveText("Zobrazeno 16 z 16 událostí · 9 z 9 kategorií");
  // Partial dates stay partial: the diagnosis is a month, not a made-up day.
  await expect(app.main.getByRole("region", { name: "Časová osa průběhu onemocnění" }).getByRole("button", { name: /^4\/2022 / })).toBeVisible();
});
