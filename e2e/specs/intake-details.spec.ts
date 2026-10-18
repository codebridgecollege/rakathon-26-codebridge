import { test, expect } from "../fixtures";
import { CONSENT, dropZone, importFhirSample, newPatientDialog, openNewPatient } from "../intake";
import { chooseFiles, syntheticFile } from "../files";

// More of "Nový pacient" (PRODUCT.md F-02) and "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md) than
// new-patient.spec.ts checks: a file that is not the demo patient's, files dropped on the zone, the other ways to
// discard an intake, a route change, the administrator, and a phone upload into the intake. These checks ran on the new
// app's development harness while the patient list was not ported; they now run on the real screens.

test.beforeEach(async ({ app }) => {
  await app.open();
});

test("a file that is not the demo patient's is listed and the record stays without extraction", async ({ app, page }) => {
  const dlg = await openNewPatient(app);
  await dlg.getByRole("textbox", { name: "Jméno *" }).fill("Test");
  await dlg.getByRole("textbox", { name: "Příjmení *" }).fill("Testová");
  await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill("111111/1111");
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await chooseFiles(page, dropZone(dlg), [syntheticFile("zprava.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]);
  await expect(dlg.getByText("Nahráno", { exact: true })).toHaveCount(1);
  await dlg.getByRole("button", { name: "Odebrat zprava.docx" }).click();
  await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeDisabled();
  await chooseFiles(page, dropZone(dlg), [syntheticFile("zprava.pdf")]);
  await dlg.getByRole("button", { name: "Zpracovat" }).click();
  await expect(dlg.getByText(/^Hotovo\. Dokumenty jsou nahrané\. Maketa zpracovává jen připravené dokumenty ukázkového pacienta/)).toBeVisible();
  await dlg.getByRole("button", { name: "Přidat do databáze" }).click();
  await expect(page.getByText(/^Pacient NO-\d{3} přidán do databáze$/)).toBeVisible();
  await expect(dlg).toBeHidden();
});

test("files dropped on the zone are listed", async ({ app, page }) => {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  // A drop as the browser delivers it: a DataTransfer holding one file (built in the page, no app state touched).
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["%PDF-1.4\n%%EOF\n"], "pretazeny.pdf", { type: "application/pdf" }));
    return d;
  });
  const zone = dlg.getByText("Přetáhněte dokumenty sem");
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(dlg.getByText("pretazeny.pdf")).toBeVisible();
});

test("Escape and Zpět discard the intake too, so the birth number is free again", async ({ app }) => {
  for (const how of ["escape", "back"] as const) {
    const dlg = await openNewPatient(app);
    await importFhirSample(dlg);
    await dlg.getByRole("checkbox", { name: CONSENT }).check();
    await dlg.getByRole("button", { name: "Pokračovat" }).click();
    await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeVisible();
    if (how === "escape") await app.page.keyboard.press("Escape");
    else {
      await dlg.getByRole("button", { name: "Zpět" }).click();
      await expect(dlg.getByRole("button", { name: "Pokračovat" })).toBeVisible();
      await dlg.getByRole("button", { name: "Zavřít" }).click();
    }
    await expect(dlg).toBeHidden();
    await expect(app.patientRows()).toHaveCount(11);
  }
  const again = await openNewPatient(app);
  await importFhirSample(again);
  await again.getByRole("checkbox", { name: CONSENT }).check();
  await again.getByRole("button", { name: "Pokračovat" }).click();
  await expect(again.getByRole("button", { name: "Zpracovat" })).toBeVisible();
  await expect(again.getByText(/Pacient s tímto rodným číslem už v databázi je/)).toHaveCount(0);
});

test("moving to another screen by its address closes the dialog", async ({ app }) => {
  const dlg = await openNewPatient(app);
  // The dialog covers the navigation, so the move comes from the address (a link, the browser's back button).
  await app.page.goto("./#calendar");
  await expect(dlg).toBeHidden();
});

test("the administrator gets a note instead of the dialog", async ({ app, page }) => {
  await app.loginAs("Ing. Kovář (správce systému)");
  await app.nav("Databáze pacientů").click();
  await app.main.getByRole("button", { name: "+ Nový pacient" }).click();
  await expect(page.getByText("Pacienta zakládá lékař nebo koordinátorka.")).toBeVisible();
  await expect(newPatientDialog(app)).toHaveCount(0);
});

test("from the intake: the phone's file joins the new patient's documents; Escape closes only the phone dialog", async ({ app, page, browser, baseURL }) => {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/upload-sessions");
  await dlg.getByRole("button", { name: "Nahrát z telefonu" }).click();
  const token = ((await (await created).json()) as { data: { token: string } }).data.token;
  const phoneDlg = app.dialog("Nahrát z telefonu");
  await expect(phoneDlg.getByRole("img", { name: "QR kód pro nahrání z telefonu" })).toBeVisible();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: "cs-CZ" });
  try {
    const phone = await phoneCtx.newPage();
    await phone.goto(new URL(`/u#${token}`, baseURL).toString());
    await phone.getByLabel("Vyfotit nebo vybrat soubory").setInputFiles([syntheticFile("foto-zadanky.jpg", "image/jpeg")]);
    await expect(phoneDlg.getByText("foto-zadanky.jpg")).toBeVisible();
  } finally {
    await phoneCtx.close();
  }
  await page.keyboard.press("Escape");
  await expect(phoneDlg).toBeHidden();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(/foto-zadanky\.jpg/)).toBeVisible();
  await expect(dlg.getByText(/kB · z telefonu$/)).toBeVisible();
});
