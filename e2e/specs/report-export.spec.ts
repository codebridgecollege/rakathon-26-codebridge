import { readFile } from "node:fs/promises";
import { test, expect } from "../fixtures";
import { Discussion, CONCLUSION } from "../discussion";

// The report dialog and PDF (PRODUCT.md F-31) and the FHIR export. A draft report says so in its file name; an
// approved report is frozen at approval. Patient NO-010.

test.beforeEach(async ({ app }) => {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
});

test("the report dialog picks sections, previews them and downloads a draft PDF", async ({ app, page }) => {
  await app.main.getByRole("button", { name: "Stáhnout report (PDF)" }).click();
  const dlg = app.dialog("Záznam z MDT");
  await expect(dlg.getByRole("heading", { level: 2, name: "Záznam z MDT · NO-010" })).toBeVisible();
  await expect(dlg.getByText("Zahrnout do PDF")).toBeVisible();
  await expect(dlg.getByRole("checkbox")).toHaveCount(7);
  await expect(dlg.getByRole("checkbox", { name: "NO / onkologický souhrn" })).toBeChecked();
  await expect(dlg.getByText("Závěr zatím není schválený; report se stáhne jako koncept.")).toBeVisible();

  await dlg.getByText("Náhled reportu").click();
  await expect(dlg.getByText(/Koncept/).first()).toBeVisible();
  await expect(dlg.getByText("Alergologická anamnéza: neuvedeno v dostupné dokumentaci")).toHaveCount(0);
  await dlg.getByRole("checkbox", { name: "Anamnéza" }).check();
  // A gap in the printed report uses the full fixed wording.
  await expect(dlg.getByText("Alergologická anamnéza: neuvedeno v dostupné dokumentaci")).toBeVisible();

  const download = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "Stáhnout PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("GLIDE-MDT-NO-010-2026-10-22-koncept.pdf");
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await expect(page.getByText("PDF připraveno ke stažení")).toBeVisible();
});

test("after approval the report is frozen and downloads without the draft mark", async ({ app, page }) => {
  await new Discussion(app).approve(CONCLUSION);
  await app.main.getByRole("button", { name: "Stáhnout report (PDF)" }).click();
  const dlg = app.dialog("Záznam z MDT");
  await expect(dlg.getByText(/^Report je uzamčen ve stavu při schválení/)).toBeVisible();
  for (const box of await dlg.getByRole("checkbox").all()) await expect(box).toBeDisabled();
  await dlg.getByText("Náhled reportu").click();
  await expect(dlg.getByText(/Stereotaktická radioterapie ložiska v mozečku/).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "Stáhnout PDF" }).click();
  expect((await download).suggestedFilename()).toBe("GLIDE-MDT-NO-010-2026-10-22.pdf");
});

test("Export FHIR shows a FHIR R4 bundle and downloads it as JSON", async ({ app, page }) => {
  await app.main.getByRole("button", { name: "Export FHIR" }).click();
  const dlg = app.dialog("Export FHIR");
  await expect(dlg.getByRole("heading", { level: 2, name: "Export FHIR R4 · NO-010" })).toBeVisible();
  await expect(dlg.getByText(/^Případ jako balík FHIR R4 \(Bundle, \d+ záznamů\)/)).toBeVisible();
  // The export carries identity; the dialog says so.
  await expect(dlg.getByText("Export obsahuje identifikaci pacienta.", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "Stáhnout JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  const bundle = JSON.parse(await readFile((await file.path())!, "utf8")) as { resourceType: string; entry: { resource: { resourceType: string } }[] };
  expect(bundle.resourceType).toBe("Bundle");
  const types = new Set(bundle.entry.map((e) => e.resource.resourceType));
  // Every exported fact keeps its provenance.
  for (const t of ["Patient", "Condition", "Observation", "Provenance", "DocumentReference"]) expect(types).toContain(t);
});
