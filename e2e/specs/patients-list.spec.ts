import { test, expect } from "../fixtures";

// Screen S-1 (Databáze pacientů, PRODUCT.md F-01, F-12): the list, search, column filters, date filter and paging.

test.beforeEach(async ({ app }) => {
  await app.open();
});

test("lists the seeded patients with their key columns", async ({ app }) => {
  await expect(app.main.getByRole("heading", { level: 1, name: "Databáze pacientů" })).toBeVisible();
  await expect(app.patientRows()).toHaveCount(11);
  await expect(app.main.getByText("11 z 11", { exact: true })).toBeVisible();
  const row = app.patientRow("Poláček Daniel");
  await expect(row.getByRole("cell", { name: "NO-010" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Připraven" })).toBeVisible();
  await expect(row.getByRole("cell", { name: /Čt 22\. 10\. 2026 · 14:00-14:10/ })).toBeVisible();
  // The synthetic patient is marked as such in the list.
  await expect(app.patientRow("Křemínek Radovan")).toContainText("syntetický pacient");
  // A missing birth number is a dash, never an invented value.
  await expect(row.getByRole("cell", { name: "-", exact: true }).first()).toBeVisible();
  // An unscheduled patient offers booking from the list.
  await expect(app.patientRow("Zápotocký Luděk").getByRole("button", { name: "Naplánovat" })).toBeVisible();
});

test("search narrows the rows by name, ID and diagnosis", async ({ app }) => {
  const search = app.main.getByRole("textbox", { name: "Hledat" });
  await search.fill("Kotěrová");
  await expect(app.patientRows()).toHaveCount(1);
  await expect(app.patientRow("Kotěrová Jaroslava")).toBeVisible();
  await search.fill("NO-S01");
  await expect(app.patientRows()).toHaveCount(1);
  await expect(app.patientRow("Křemínek Radovan")).toBeVisible();
  await search.fill("meningeom");
  await expect(app.patientRows()).toHaveCount(3);
  await search.fill("");
  await expect(app.patientRows()).toHaveCount(11);
});

test("the status column filter hides unticked statuses and can be cleared", async ({ app }) => {
  await app.main.getByRole("button", { name: "Stav", exact: true }).click();
  const filter = app.page.getByRole("dialog", { name: "Filtr Stav" });
  await expect(filter).toBeVisible();
  await filter.getByRole("checkbox", { name: "Nový" }).uncheck();
  await filter.getByRole("button", { name: "Hotovo" }).click();
  await expect(filter).toBeHidden();
  // Four patients are "Nový" in the seed; they leave the list.
  await expect(app.patientRows()).toHaveCount(7);
  await expect(app.patientRow("Zápotocký Luděk")).toHaveCount(0);
  await app.main.getByRole("button", { name: /Zrušit filtry \(1\)/ }).click();
  await expect(app.patientRows()).toHaveCount(11);
});

test("the owner filter keeps one owner's patients", async ({ app }) => {
  await app.main.getByRole("button", { name: "Vlastník", exact: true }).click();
  const filter = app.page.getByRole("dialog", { name: "Filtr Vlastník" });
  await filter.getByRole("checkbox", { name: "(Vše)" }).uncheck();
  await filter.getByRole("checkbox", { name: "MUDr. Dvořák" }).check();
  await filter.getByRole("button", { name: "Hotovo" }).click();
  await expect(app.patientRows()).toHaveCount(5);
  for (const text of await app.patientRows().allInnerTexts()) expect(text).toContain("MUDr. Dvořák");
});

test("the submitted-from date filter drops older referrals", async ({ app }) => {
  await app.main.getByLabel("Podáno od").fill("2026-10-01");
  // Referrals submitted 3. 10. 2026 or later stay: NO-010, NO-S01, NO-002, NO-009, NO-011, NO-013.
  await expect(app.patientRows()).toHaveCount(6);
  await expect(app.patientRow("Zápotocký Luděk")).toHaveCount(0);
});

test("paging shows the range and disables the arrows on a single page", async ({ app }) => {
  await expect(app.main.getByText("Zobrazeno 1-11 z 11")).toBeVisible();
  await expect(app.main.getByRole("button", { name: "‹ Předchozí" })).toBeDisabled();
  await expect(app.main.getByRole("button", { name: "Další ›" })).toBeDisabled();
  await expect(app.main.getByRole("button", { name: "1", exact: true })).toBeVisible();
});

test("clicking a row opens the patient and the back button returns", async ({ app }) => {
  await app.openPatient("Poláček Daniel");
  await app.main.getByRole("button", { name: "‹ Databáze pacientů" }).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Databáze pacientů" })).toBeVisible();
});
