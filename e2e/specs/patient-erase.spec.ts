import { test, expect } from "../fixtures";
import { createS02 } from "../intake";
import { resetDemo } from "../reset";

// Erasing a patient (DATABASE.md, "Erasing a patient"): the button sits at the bottom of the patient view, a wrong word
// changes nothing, the right one removes the patient, and a seeded demo patient cannot be erased.

const B_DOCTOR = "MUDr. Vlčková";
const NAME = "Lipenská Věra";

test("a patient is erased only after typing the word, and leaves the list", async ({ app, page, baseURL }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await createS02(app);
  await app.nav("Databáze pacientů").click();
  await app.patientRow(NAME).click();
  const erase = app.main.getByRole("button", { name: "Smazat pacienta", exact: true });
  await expect(erase).toBeVisible();

  page.once("dialog", (d) => void d.accept("ano"));
  await erase.click();
  await expect(erase).toBeVisible();

  page.once("dialog", (d) => void d.accept("SMAZAT"));
  await erase.click();
  await expect(page.getByText("Pacient je smazaný.")).toBeVisible();
  await expect(app.main.getByText("Zatím žádný pacient.", { exact: true })).toBeVisible();
  await expect(app.patientRow(NAME)).toHaveCount(0);
  await resetDemo(baseURL!, "b-admin");
});

test("a seeded demo patient cannot be erased", async ({ app, page }) => {
  await app.open("patient/10/overview");
  page.once("dialog", (d) => void d.accept("SMAZAT"));
  await app.main.getByRole("button", { name: "Smazat pacienta", exact: true }).click();
  await expect(page.getByText("Ukázkového pacienta nelze smazat", { exact: false })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček/ })).toBeVisible();
});
