import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator } from "@playwright/test";
import type { App } from "./fixtures";

// Synthetic patient S02 (samples/S02_pacient): the FHIR referral and the seven PDFs the server knows as prepared
// fixtures. Only committed synthetic files are uploaded.
const here = path.dirname(fileURLToPath(import.meta.url));
export const S02_DIR = path.resolve(here, "../samples/S02_pacient/upload");
export const S02_FILES = [
  "01-ambulantni-zprava-2026-10-08.pdf",
  "02-histologie-biopsie-2026-03-12.pdf",
  "03-histologie-resekat-2026-08-21.pdf",
  "04-laborator-2026-03-10.pdf",
  "05-laborator-2026-06-02.pdf",
  "06-laborator-2026-09-15.pdf",
  "07-laborator-2026-10-06.pdf",
].map((f) => path.join(S02_DIR, f));
export const S02_RC = "585614/4019";
export const CONSENT = /^Souhlasím, aby FNO použila uvedené osobní údaje/;

export function newPatientDialog(app: App): Locator {
  return app.dialog("Nový pacient");
}

export async function openNewPatient(app: App): Promise<Locator> {
  await app.nav("Databáze pacientů").click();
  await app.main.getByRole("button", { name: "+ Nový pacient" }).click();
  const dlg = newPatientDialog(app);
  await expect(dlg.getByRole("heading", { level: 2, name: "Nový pacient" })).toBeVisible();
  return dlg;
}

// Step 1 filled from the built-in FHIR sample (the S02 referral), as a user does with "Vložit ukázku".
export async function importFhirSample(dlg: Locator): Promise<void> {
  await dlg.getByRole("button", { name: "Import z FHIR" }).click();
  await dlg.getByRole("button", { name: "Vložit ukázku" }).click();
  await dlg.getByRole("button", { name: "Načíst", exact: true }).click();
  await expect(dlg.getByRole("status").filter({ hasText: /^Načteno z FHIR/ })).toBeVisible();
}

// The file input sits inside the drop zone's label, so its accessible name is the zone's text.
export function dropZone(scope: Locator): Locator {
  return scope.getByLabel(/Přetáhněte (dokumenty|soubory) sem/);
}

// The whole S02 intake: FHIR import, consent, seven PDFs, processing, "Přidat do databáze". Ends on the new patient.
export async function createS02(app: App): Promise<void> {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await dropZone(dlg).setInputFiles(S02_FILES);
  await expect(dlg.getByText("Nahráno", { exact: true })).toHaveCount(7);
  await dlg.getByRole("button", { name: "Zpracovat" }).click();
  await expect(dlg.getByText(/^Hotovo\. Zpracováno 7 dokumentů/)).toBeVisible();
  await dlg.getByRole("button", { name: "Přidat do databáze" }).click();
  await expect(dlg).toBeHidden();
  await expect(app.main.getByRole("heading", { level: 1, name: /Lipenská Věra/ })).toBeVisible();
}
