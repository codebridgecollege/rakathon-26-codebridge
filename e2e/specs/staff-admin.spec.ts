import { test, expect } from "../fixtures";

// Staff (PRODUCT.md F-39, screen S-8) and Administrace (screen S-7): who may edit the staff list, the user picker built
// from it, the access log only the administrator sees, and the demo reset.

const COORD = "Bc. Marková (koordinátorka MDT)";
const ADMIN = "Ing. Kovář (správce systému)";

test("a doctor reads the staff list but cannot change it", async ({ app }) => {
  await app.open();
  await app.nav("Personál").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Personál pracoviště" })).toBeVisible();
  await expect(app.main.getByText("lékař ho jen čte", { exact: false })).toBeVisible();
  await expect(app.main.getByRole("button", { name: "+ Přidat" })).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "Obnovit výchozí (smyšlená jména)" })).toHaveCount(0);
});

test("the coordinator adds a person, who appears in the user picker and survives a reload", async ({ app, page }) => {
  await app.open();
  await app.loginAs(COORD);
  await app.nav("Personál").click();
  await app.main.getByRole("textbox", { name: "Titul před (nová osoba, Radiologie)" }).fill("doc. MUDr.");
  await app.main.getByRole("textbox", { name: "Příjmení (nová osoba, Radiologie)" }).fill("Testová");
  await app.main.getByRole("textbox", { name: "Titul za (nová osoba, Radiologie)" }).fill("Ph.D.");
  await app.main.getByRole("textbox", { name: "Funkce (nová osoba, Radiologie)" }).fill("primářka");
  // Enter in the new person's fields adds them, as "+ Přidat" of that department does.
  await app.main.getByRole("textbox", { name: "Funkce (nová osoba, Radiologie)" }).press("Enter");
  await expect(app.main.getByRole("textbox", { name: "Příjmení: doc. MUDr. Testová, Ph.D." })).toHaveValue("Testová");
  await expect(app.userPicker.getByRole("option", { name: "doc. MUDr. Testová, Ph.D." })).toHaveCount(1);
  await page.reload();
  await expect(app.userPicker.getByRole("option", { name: "doc. MUDr. Testová, Ph.D." })).toHaveCount(1);
});

test("the coordinator renames and removes a person", async ({ app }) => {
  await app.open();
  await app.loginAs(COORD);
  await app.nav("Personál").click();
  const surname = app.main.getByRole("textbox", { name: "Příjmení: MUDr. Veselá" });
  await surname.fill("Veselá-Nová");
  await surname.press("Tab");
  await expect(app.main.getByRole("textbox", { name: "Příjmení: MUDr. Veselá-Nová" })).toBeVisible();
  await expect(app.userPicker.getByRole("option", { name: "MUDr. Veselá-Nová" })).toHaveCount(1);
  await app.main.getByRole("button", { name: "Odebrat MUDr. Šimek" }).click();
  await expect(app.main.getByRole("textbox", { name: "Příjmení: MUDr. Šimek" })).toHaveCount(0);
  await expect(app.userPicker.getByRole("option", { name: "MUDr. Šimek" })).toHaveCount(0);
});

test("only the administrator sees Administrace with the access log", async ({ app }) => {
  await app.open();
  await expect(app.nav("Administrace")).toHaveCount(0);
  await app.openPatient("Poláček Daniel");
  await app.loginAs(COORD);
  await app.nav("Personál").click();
  await expect(app.main.getByRole("button", { name: "Obnovit výchozí (smyšlená jména)" })).toBeVisible();
  await expect(app.nav("Administrace")).toHaveCount(0);
  await app.loginAs(ADMIN);
  await app.nav("Administrace").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Administrace" })).toBeVisible();
  const log = app.main.getByRole("table");
  await expect(log.getByRole("columnheader")).toHaveText(["Čas", "Uživatel", "Případ", "Akce"]);
  // The doctor's opening of NO-010 earlier in this test is in the log, attributed to her.
  await expect(log.getByRole("row").filter({ hasText: "MUDr. Svobodová" }).filter({ hasText: "NO-010" }).first()).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "zobrazil(a) záznam přístupů" }).first()).toBeVisible();
});

test("the administrator resets the demo data from Administrace", async ({ app, page }) => {
  // Change something visible first: book a patient.
  await app.open();
  await app.nav("Kalendář MDT").click();
  await app.main.getByText(/Zápotocký Luděk/).first().dragTo(app.main.getByRole("button", { name: "Volný termín 15:10", exact: true }));
  await expect(app.main.getByRole("heading", { level: 2, name: "Nenaplánovaní (3)" })).toBeVisible();

  await app.loginAs(ADMIN);
  await app.nav("Administrace").click();
  await app.main.getByRole("button", { name: "Obnovit ukázková data" }).click();
  const dlg = app.dialog("Obnovit ukázková data");
  await expect(dlg.getByText("Vrátí případy, závěry, úlohy, docházku, personál a záznam přístupů do výchozího stavu.")).toBeVisible();
  await dlg.getByRole("button", { name: "Obnovit ukázková data" }).click();
  await expect(page.getByText("Data obnovena, stránka se znovu načte.")).toBeVisible();
  // The page reloads itself a moment later, so retry the visible check (a click made just before the reload is lost)
  // instead of waiting for "load".
  await expect(async () => {
    await app.nav("Kalendář MDT").click();
    await expect(app.main.getByRole("heading", { level: 2, name: "Nenaplánovaní (4)" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});
