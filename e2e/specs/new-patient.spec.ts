import { test, expect } from "../fixtures";
import { CONSENT, S02_FILES, S02_RC, createS02, dropZone, importFhirSample, openNewPatient } from "../intake";

// New patient (PRODUCT.md F-02, F-03, F-07): the referral form, FHIR import, the S02 upload of seven PDFs, processing,
// "Přidat do databáze", and a second record for a known birth number.

test.beforeEach(async ({ app }) => {
  await app.open();
});

test("the form requires name, surname, birth number and consent", async ({ app }) => {
  const dlg = await openNewPatient(app);
  await expect(dlg.getByText("1. Žádost o konzultaci")).toBeVisible();
  await dlg.getByRole("textbox", { name: "Odesílající pracoviště" }).fill("Nemocnice Test");
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  for (const msg of ["Vyplňte jméno.", "Vyplňte příjmení.", "Vyplňte rodné číslo.", "Bez souhlasu se zpracováním údajů nelze žádost odeslat."]) {
    await expect(dlg.getByText(msg)).toBeVisible();
  }
  await expect(dlg.getByRole("textbox", { name: "Jméno *" })).toHaveAttribute("aria-invalid", "true");
  // What was typed stays.
  await expect(dlg.getByRole("textbox", { name: "Odesílající pracoviště" })).toHaveValue("Nemocnice Test");
  await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill("12345");
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await expect(dlg.getByText("Rodné číslo zadejte ve tvaru 123456/7890.")).toBeVisible();
});

test("the FHIR sample fills the form but never the consent", async ({ app }) => {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await expect(dlg.getByRole("status")).toContainText("Souhlas s GDPR potvrďte ručně.");
  await expect(dlg.getByRole("textbox", { name: "Jméno *" })).toHaveValue("Věra");
  await expect(dlg.getByRole("textbox", { name: "Příjmení *" })).toHaveValue("Lipenská");
  await expect(dlg.getByRole("textbox", { name: /^Rodné číslo/ })).toHaveValue(S02_RC);
  await expect(dlg.getByRole("combobox", { name: "Pojišťovna" })).toHaveValue("111");
  await expect(dlg.getByRole("textbox", { name: /^Otázka na NOCO/ })).toHaveValue(/^Je po neoadjuvantní CHRT a nízké přední resekci rekta/);
  await expect(dlg.getByRole("checkbox", { name: CONSENT })).not.toBeChecked();
});

test("S02: seven PDFs are uploaded, processed and added; the patient opens with documents, gaps and labs", async ({ app, page }) => {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  // Step 2 accepts files; processing needs at least one.
  await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeDisabled();
  await dropZone(dlg).setInputFiles(S02_FILES);
  await expect(dlg.getByText("Nahráno", { exact: true })).toHaveCount(7);
  await expect(dlg.getByRole("button", { name: "Odebrat 01-ambulantni-zprava-2026-10-08.pdf" })).toBeVisible();
  await dlg.getByRole("button", { name: "Zpracovat" }).click();
  for (const stage of ["Kontrola čitelnosti", "Pseudonymizace", "Extrakce údajů", "Kontrola úplnosti"]) {
    await expect(dlg.getByText(stage)).toBeVisible();
  }
  await expect(dlg.getByText(/^Hotovo\. Zpracováno 7 dokumentů/)).toBeVisible();
  await dlg.getByRole("button", { name: "Přidat do databáze" }).click();
  await expect(page.getByText("Pacient NO-S02 přidán do databáze")).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 1, name: /Lipenská Věra/ })).toBeVisible();

  await app.openTab("Dokumenty");
  // The seven uploaded PDFs are the patient's documents.
  await expect(app.main.getByRole("heading", { level: 2, name: "Dokumenty (7)" })).toBeVisible();
  await app.openTab("Laboratoř");
  // The CEA trend from the four lab sheets: 14,8 -> 5,8 -> 2,9 -> 9,6 µg/l.
  const cea = app.main.getByRole("row", { name: /^CEA/ });
  for (const v of ["14,8", "5,8", "2,9", "9,6"]) await expect(cea.getByRole("button", { name: new RegExp(`: ${v} `) })).toBeVisible();
  await expect(app.main.getByRole("button", { name: /Upozornění · chybí podklady/ })).toBeVisible();

  await app.nav("Databáze pacientů").click();
  await expect(app.patientRow("Lipenská Věra")).toBeVisible();
  await expect(app.patientRows()).toHaveCount(12);
});

test("closing the dialog after step 1 discards the intake", async ({ app }) => {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeVisible();
  await dlg.getByRole("button", { name: "Zavřít" }).click();
  await expect(dlg).toBeHidden();
  await expect(app.patientRows()).toHaveCount(11);
  // A fresh attempt with the same birth number is not a duplicate: the discarded intake left no record.
  const again = await openNewPatient(app);
  await importFhirSample(again);
  await again.getByRole("checkbox", { name: CONSENT }).check();
  await again.getByRole("button", { name: "Pokračovat" }).click();
  await expect(again.getByRole("button", { name: "Zpracovat" })).toBeVisible();
  await expect(again.getByText(/Pacient s tímto rodným číslem už v databázi je/)).toHaveCount(0);
});

test("a known birth number warns, links the existing patient, and can still create a new record", async ({ app }) => {
  await createS02(app);
  const dlg = await openNewPatient(app);
  await dlg.getByRole("textbox", { name: "Jméno *" }).fill("Věra");
  await dlg.getByRole("textbox", { name: "Příjmení *" }).fill("Lipenská");
  // The slash is optional: the same number without it is still the same patient.
  await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill(S02_RC.replace("/", ""));
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  const warning = dlg.getByRole("alert").filter({ hasText: "Pacient s tímto rodným číslem už v databázi je" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button", { name: /Lipenská Věra, NO-S02/ })).toBeVisible();
  await warning.getByRole("button", { name: "Přesto vytvořit nový záznam" }).click();
  await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeVisible();
});

test("the duplicate warning links to the existing patient", async ({ app }) => {
  await createS02(app);
  const dlg = await openNewPatient(app);
  await dlg.getByRole("textbox", { name: "Jméno *" }).fill("Věra");
  await dlg.getByRole("textbox", { name: "Příjmení *" }).fill("Lipenská");
  await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill(S02_RC);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await dlg.getByRole("button", { name: /Lipenská Věra, NO-S02/ }).click();
  await expect(dlg).toBeHidden();
  await expect(app.main.getByRole("heading", { level: 1, name: /Lipenská Věra/ })).toBeVisible();
});
