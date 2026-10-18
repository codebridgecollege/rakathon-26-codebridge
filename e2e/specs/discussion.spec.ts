import { test, expect } from "../fixtures";
import { Discussion, CONCLUSION } from "../discussion";

// The discussion card "Projednání na MDT" (PRODUCT.md F-22, F-23, F-24, F-12): notes autosave, attendance, next steps,
// approval as an append-only history, a new version, and closing and reopening the case. Patient NO-010.

test.beforeEach(async ({ app }) => {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
});

test("the card shows its sections and approval needs a conclusion", async ({ app }) => {
  const d = new Discussion(app);
  await d.expand();
  for (const name of ["Záznam diskuse", "Další kroky", "Přítomní (0)", "Schválení závěru"]) {
    await expect(d.card.getByRole("heading", { level: 3, name })).toBeVisible();
  }
  await expect(d.card.getByText("asistent závěr nenavrhuje", { exact: false })).toBeVisible();
  await expect(d.approveButton).toBeDisabled();
  await expect(d.card.getByText("schvaluje za tým: MUDr. Svobodová")).toBeVisible();
  await d.conclusion.fill("Kontrolní MR mozku za 3 měsíce.");
  // A typed conclusion is a draft until a doctor approves it.
  await expect(app.main.getByText("Koncept, zatím neschváleno.", { exact: false })).toBeVisible();
  await expect(d.approveButton).toBeEnabled();
});

test("notes and the conclusion draft are autosaved and survive a reload", async ({ app, page }) => {
  const d = new Discussion(app);
  await d.expand();
  await d.typeAndSave(d.notes, "Radiolog: ložisko 3 mm, bez edému.");
  await d.typeAndSave(d.conclusion, "Koncept: zvážit stereotaktickou radiochirurgii.");
  await page.reload();
  await d.expand();
  await expect(d.notes).toHaveValue("Radiolog: ložisko 3 mm, bez edému.");
  await expect(d.conclusion).toHaveValue("Koncept: zvážit stereotaktickou radiochirurgii.");
});

test("attendance is picked per department and is kept for the seminar", async ({ app, page }) => {
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: "Upravit", exact: true }).click();
  const dlg = app.dialog("Přítomní lékaři");
  await dlg.getByRole("combobox", { name: "Neurochirurgie" }).first().selectOption({ label: "MUDr. Novák" });
  await dlg.getByRole("combobox", { name: "Radiologie" }).first().selectOption({ label: "MUDr. Šimek" });
  await dlg.getByRole("button", { name: "Hotovo" }).click();
  await expect(d.card.getByRole("heading", { level: 3, name: "Přítomní (2)" })).toBeVisible();
  await page.reload();
  await d.expand();
  await expect(d.card.getByRole("heading", { level: 3, name: "Přítomní (2)" })).toBeVisible();
  await expect(d.card.getByText(/MUDr\. Novák/)).toBeVisible();
});

test("a next step is added and kept after a reload", async ({ app, page }) => {
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: "+ Přidat úlohu" }).click();
  const step = d.card.getByRole("textbox", { name: "Úloha" }).last();
  await d.typeAndSave(step, "Objednat kontrolní MR mozku");
  await expect(d.card.getByText("1 úloha", { exact: true })).toBeVisible();
  await page.reload();
  await d.expand();
  await expect(d.card.getByRole("textbox", { name: "Úloha" }).last()).toHaveValue("Objednat kontrolní MR mozku");
});

test("approval records the doctor, sets Projednán, and a new version supersedes without erasing", async ({ app, page }) => {
  const d = new Discussion(app);
  await d.approve(CONCLUSION);
  await expect(app.main.getByText(/Platný závěr č\. 1 · schválil\(a\) MUDr\. Svobodová/)).toBeVisible();
  await expect(app.main.getByRole("button", { name: "Projednán ▾" })).toBeVisible();
  // The approver joins the attendance.
  await expect(d.card.getByRole("heading", { level: 3, name: /^Přítomní \([1-9]\d*\)$/ })).toBeVisible();
  await expect(d.approveButton).toHaveCount(0);
  await page.reload();
  await expect(app.main.getByText(/Platný závěr č\. 1 · schválil\(a\) MUDr\. Svobodová/)).toBeVisible();

  await d.expand();
  await d.card.getByRole("button", { name: "Nový závěr (nahradí platný)" }).click();
  // The old page shows this label next to the field without tying it to it, so the field keeps its usual name.
  await expect(app.main.getByText("Koncept nového závěru (nahradí platný až po schválení)")).toBeVisible();
  const draft = d.conclusion;
  await expect(draft).toBeVisible();
  // The valid conclusion stays until the new one is approved.
  await expect(app.main.getByText(/Platný závěr č\. 1/).first()).toBeVisible();
  await draft.fill("Stereotaktická radiochirurgie ložiska v mozečku.");
  await d.approveButton.click();
  await expect(app.main.getByText(/Platný závěr č\. 2 · schválil\(a\) MUDr\. Svobodová/)).toBeVisible();
  await expect(app.main.getByText(/Předchozí závěry \(1\)/)).toBeVisible();
});

test("a discussed case is closed from the card and reopened from the status menu", async ({ app, page }) => {
  const d = new Discussion(app);
  await d.approve(CONCLUSION);
  await d.expand();
  await d.card.getByRole("button", { name: "Uzavřít případ" }).click();
  await expect(app.main.getByRole("button", { name: "Uzavřen ▾" })).toBeVisible();
  await expect(app.main.getByText("Případ je uzavřen; znovu ho otevřete v menu stavu.").first()).toBeVisible();
  await page.reload();
  await app.main.getByRole("button", { name: "Uzavřen ▾" }).click();
  await app.dialog("Stav případu").getByRole("button", { name: /^Znovu otevřít/ }).click();
  await expect(app.main.getByRole("button", { name: "Uzavřen ▾" })).toHaveCount(0);
  // The approved decision stays valid after reopening.
  await expect(app.main.getByText(/Platný závěr č\. 1/).first()).toBeVisible();
});

test("the coordinator and the administrator cannot approve", async ({ app }) => {
  for (const user of ["Bc. Marková (koordinátorka MDT)", "Ing. Kovář (správce systému)"]) {
    await app.loginAs(user);
    await app.openPatient("Poláček Daniel");
    const d = new Discussion(app);
    await d.expand();
    await expect(d.approveButton).toBeDisabled();
    await expect(d.card.getByText("schvaluje lékař", { exact: true })).toBeVisible();
  }
});
