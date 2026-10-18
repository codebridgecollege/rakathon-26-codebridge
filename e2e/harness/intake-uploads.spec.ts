import { test, expect, type App } from "../fixtures";
import { CONSENT, S02_FILES, S02_RC, dropZone, importFhirSample, newPatientDialog } from "../intake";
import { chooseFiles, syntheticFile } from "../files";

// The new app's step 11 components on its development harness (#/dev-intake, built with APP_DEV_PAGES=1), before the
// patient list, the patient view and "Projednání na MDT" are ported. The checks mirror specs/new-patient.spec.ts and
// specs/uploads.spec.ts; what needs the unported screens (the opened patient, its tabs, the discussion card) is left to
// those specs. Run with E2E_APP_HARNESS=1 E2E_BASE_URL=http://localhost:8787/app/ --project app-harness.

async function openHarness(app: App): Promise<void> {
  await app.open("/dev-intake");
  await expect(app.patientRows().first()).toBeVisible();
}

async function openNewPatient(app: App) {
  await app.main.getByRole("button", { name: "+ Nový pacient" }).click();
  const dlg = newPatientDialog(app);
  await expect(dlg.getByRole("heading", { level: 2, name: "Nový pacient" })).toBeVisible();
  return dlg;
}

async function createS02(app: App): Promise<void> {
  const dlg = await openNewPatient(app);
  await importFhirSample(dlg);
  await dlg.getByRole("checkbox", { name: CONSENT }).check();
  await dlg.getByRole("button", { name: "Pokračovat" }).click();
  await dropZone(dlg).setInputFiles(S02_FILES);
  await expect(dlg.getByText("Nahráno", { exact: true })).toHaveCount(7);
  await dlg.getByRole("button", { name: "Zpracovat" }).click();
  await expect(dlg.getByText(/^Hotovo\. Zpracováno 7 dokumentů \(8 s\.\), všechny dobře čitelné\. Chybějící podklady: 4/)).toBeVisible();
  await dlg.getByRole("button", { name: "Přidat do databáze" }).click();
  await expect(dlg).toBeHidden();
}

const uploads = (app: App) => app.main.getByRole("region", { name: "Case uploads" });

test.beforeEach(async ({ app }) => {
  await openHarness(app);
});

test.describe("new patient", () => {
  test("the form requires name, surname, birth number and consent, and keeps what was typed", async ({ app }) => {
    const dlg = await openNewPatient(app);
    await expect(dlg.getByText("1. Žádost o konzultaci")).toBeVisible();
    await dlg.getByRole("textbox", { name: "Odesílající pracoviště" }).fill("Nemocnice Test");
    await dlg.getByRole("button", { name: "Pokračovat" }).click();
    for (const msg of ["Vyplňte jméno.", "Vyplňte příjmení.", "Vyplňte rodné číslo.", "Bez souhlasu se zpracováním údajů nelze žádost odeslat."]) {
      await expect(dlg.getByText(msg)).toBeVisible();
    }
    await expect(dlg.getByRole("textbox", { name: "Jméno *" })).toHaveAttribute("aria-invalid", "true");
    // The first refused field takes the focus.
    await expect(dlg.getByRole("textbox", { name: "Jméno *" })).toBeFocused();
    await expect(dlg.getByRole("textbox", { name: "Odesílající pracoviště" })).toHaveValue("Nemocnice Test");
    await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill("12345");
    await dlg.getByRole("button", { name: "Pokračovat" }).click();
    await expect(dlg.getByText("Rodné číslo zadejte ve tvaru 123456/7890.")).toBeVisible();
  });

  test("the FHIR sample fills the form but never the consent; bad JSON is refused in words", async ({ app }) => {
    const dlg = await openNewPatient(app);
    await importFhirSample(dlg);
    await expect(dlg.getByRole("status")).toContainText("Souhlas s GDPR potvrďte ručně.");
    await expect(dlg.getByRole("textbox", { name: "Jméno *" })).toHaveValue("Věra");
    await expect(dlg.getByRole("textbox", { name: "Příjmení *" })).toHaveValue("Lipenská");
    await expect(dlg.getByRole("textbox", { name: /^Rodné číslo/ })).toHaveValue(S02_RC);
    await expect(dlg.getByRole("combobox", { name: "Pojišťovna" })).toHaveValue("111");
    await expect(dlg.getByRole("textbox", { name: /^Otázka na NOCO/ })).toHaveValue(/^Je po neoadjuvantní CHRT a nízké přední resekci rekta/);
    await expect(dlg.getByRole("checkbox", { name: CONSENT })).not.toBeChecked();
    await dlg.getByRole("button", { name: "Import z FHIR" }).click();
    await dlg.getByRole("textbox", { name: /^Import z FHIR/ }).fill("{nope");
    await dlg.getByRole("button", { name: "Načíst", exact: true }).click();
    await expect(dlg.getByRole("status")).toHaveText("Import se nezdařil: data nejsou platný JSON.");
  });

  test("S02: seven PDFs are uploaded, processed and added", async ({ app, page }) => {
    const dlg = await openNewPatient(app);
    await importFhirSample(dlg);
    await dlg.getByRole("checkbox", { name: CONSENT }).check();
    await dlg.getByRole("button", { name: "Pokračovat" }).click();
    await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeDisabled();
    // The presenter's hint with the ZIP of the seven files.
    await expect(dlg.getByText(/^Ukázkový pacient: nahrajte 7 dokumentů \(PDF\) ze složky samples\/S02_pacient\/upload/)).toBeVisible();
    await expect(dlg.getByRole("link", { name: "stáhněte ZIP" })).toHaveAttribute("href", "/ukazka/S02-dokumenty.zip");
    await dropZone(dlg).setInputFiles(S02_FILES.slice(0, 2));
    await expect(dlg.getByText(/^Ukázkový pacient: chybí ještě 5 z 7 dokumentů/)).toBeVisible();
    await dropZone(dlg).setInputFiles(S02_FILES);
    // A file already listed is not listed twice.
    await expect(page.getByText(/^Už nahráno: 01-ambulantni-zprava-2026-10-08\.pdf, 02-histologie/)).toBeVisible();
    await expect(dlg.getByText("Nahráno", { exact: true })).toHaveCount(7);
    // The server recognises the synthetic document by its bytes and names its kind.
    await expect(dlg.getByText(/Ambulantní vyšetření kontrolní \(chirurgie\) s otázkou na MDT/)).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Odebrat 01-ambulantni-zprava-2026-10-08.pdf" })).toBeVisible();
    await dlg.getByRole("button", { name: "Zpracovat" }).click();
    for (const stage of ["Kontrola čitelnosti", "Pseudonymizace", "Extrakce údajů", "Kontrola úplnosti"]) await expect(dlg.getByText(stage)).toBeVisible();
    await expect(dlg.getByText(/^Hotovo\. Zpracováno 7 dokumentů/)).toBeVisible();
    await dlg.getByRole("button", { name: "Přidat do databáze" }).click();
    await expect(page.getByText("Pacient NO-S02 přidán do databáze")).toBeVisible();
    // The new patient opens (the harness shows where to; the patient view is ported separately).
    await expect(app.main.getByText("Would open: patient S02_pacient.pdf")).toBeVisible();
    await expect(app.patientRow("Lipenská Věra")).toBeVisible();
    await expect(app.patientRows()).toHaveCount(12);
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
    await expect(app.main.getByText("Would open: patient list")).toBeVisible();
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

  test("closing, Escape and Zpět discard the intake, so the birth number is free again", async ({ app }) => {
    for (const how of ["close", "escape", "back"] as const) {
      const dlg = await openNewPatient(app);
      await importFhirSample(dlg);
      await dlg.getByRole("checkbox", { name: CONSENT }).check();
      await dlg.getByRole("button", { name: "Pokračovat" }).click();
      await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeVisible();
      if (how === "close") await dlg.getByRole("button", { name: "Zavřít" }).click();
      else if (how === "escape") await app.page.keyboard.press("Escape");
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

  test("a known birth number warns, links the existing patient, and can still create a new record", async ({ app, page }) => {
    await createS02(app);
    await expect(app.patientRow("Lipenská Věra")).toBeVisible();
    const dlg = await openNewPatient(app);
    await dlg.getByRole("textbox", { name: "Jméno *" }).fill("Věra");
    await dlg.getByRole("textbox", { name: "Příjmení *" }).fill("Lipenská");
    await dlg.getByRole("textbox", { name: /^Rodné číslo/ }).fill(S02_RC.replace("/", ""));
    await dlg.getByRole("checkbox", { name: CONSENT }).check();
    await dlg.getByRole("button", { name: "Pokračovat" }).click();
    const warning = dlg.getByRole("alert").filter({ hasText: "Pacient s tímto rodným číslem už v databázi je" });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("button", { name: /Lipenská Věra, NO-S02/ })).toBeVisible();
    await warning.getByRole("button", { name: "Přesto vytvořit nový záznam" }).click();
    await expect(dlg.getByRole("button", { name: "Zpracovat" })).toBeVisible();
    // The demo patient is in the database already: the second record stays without the prepared documents.
    await expect(dlg.getByText("Ukázkový pacient Věra Lipenská už v databázi je; nový záznam zůstane bez zpracovaných dokumentů.")).toBeVisible();
    await dlg.getByRole("button", { name: "Zavřít" }).click();

    const again = await openNewPatient(app);
    await again.getByRole("textbox", { name: "Jméno *" }).fill("Věra");
    await again.getByRole("textbox", { name: "Příjmení *" }).fill("Lipenská");
    await again.getByRole("textbox", { name: /^Rodné číslo/ }).fill(S02_RC);
    await again.getByRole("checkbox", { name: CONSENT }).check();
    await again.getByRole("button", { name: "Pokračovat" }).click();
    await again.getByRole("button", { name: /Lipenská Věra, NO-S02/ }).click();
    await expect(again).toBeHidden();
    await expect(app.main.getByText("Would open: patient S02_pacient.pdf")).toBeVisible();
  });

  test("the administrator gets a note instead of the dialog", async ({ app, page }) => {
    await app.loginAs("Ing. Kovář (správce systému)");
    await app.main.getByRole("button", { name: "+ Nový pacient" }).click();
    await expect(page.getByText("Pacienta zakládá lékař nebo koordinátorka.")).toBeVisible();
    await expect(newPatientDialog(app)).toHaveCount(0);
  });
});

test.describe("uploads", () => {
  test("chosen files are listed as Nahráno, stay after a reload and can be removed", async ({ app, page }) => {
    const zone = uploads(app).getByRole("button", { name: /^Přetáhněte soubory sem/ });
    await chooseFiles(page, zone, [syntheticFile("kontrola-mr.pdf"), syntheticFile("poznamka.txt", "text/plain")]);
    await expect(page.getByText("Nahráno: 2 soubory")).toBeVisible();
    await expect(uploads(app).getByText("kontrola-mr.pdf")).toBeVisible();
    await expect(uploads(app).getByText("Nahráno", { exact: true })).toHaveCount(2);
    await expect(app.main.getByText(/nezpracováno|zpracování selhalo|nepodařilo/)).toHaveCount(0);
    await page.reload();
    await expect(uploads(app).getByText("kontrola-mr.pdf")).toBeVisible();
    await uploads(app).getByRole("button", { name: "Odebrat kontrola-mr.pdf" }).click();
    await expect(uploads(app).getByText("kontrola-mr.pdf")).toHaveCount(0);
    await expect(uploads(app).getByText("poznamka.txt")).toBeVisible();
  });

  test("a document of another patient is flagged, never merged silently", async ({ app, page }) => {
    await chooseFiles(page, uploads(app).getByRole("button", { name: /^Přetáhněte soubory sem/ }), [S02_FILES[0]!]);
    const row = uploads(app).getByRole("listitem").filter({ hasText: "01-ambulantni-zprava-2026-10-08.pdf" });
    await expect(row.getByRole("alert")).toHaveText(
      "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu; ověřte, zda dokument patří tomuto pacientovi.",
    );
  });

  test("a locked panel offers no upload zone and says so", async ({ app }) => {
    await uploads(app).getByRole("checkbox", { name: "locked" }).check();
    await expect(uploads(app).getByText("Žádné dokumenty nenahrány.")).toBeVisible();
    await expect(uploads(app).getByRole("button", { name: /^Přetáhněte soubory sem/ })).toHaveCount(0);
    await expect(uploads(app).getByRole("button", { name: "Nahrát z telefonu" })).toHaveCount(0);
  });
});

test.describe("phone upload", () => {
  test("the QR dialog's link opens /u on a phone, a sent file arrives on the desktop", async ({ app, page, browser, baseURL }) => {
    const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/upload-sessions");
    await uploads(app).getByRole("button", { name: "Nahrát z telefonu" }).click();
    const token = ((await (await created).json()) as { data: { token: string } }).data.token;
    const dlg = app.dialog("Nahrát z telefonu");
    await expect(dlg.getByRole("heading", { level: 2, name: "Nahrát z telefonu · NO-S01" })).toBeVisible();
    await expect(dlg.getByRole("img", { name: "QR kód pro nahrání z telefonu" })).toBeVisible();
    await expect(dlg.getByText(/^Platí 15 minut \(do \d{1,2}:\d{2}\), jen pro nahrání k případu NO-S01\.$/)).toBeVisible();
    await expect(dlg.getByRole("status")).toHaveText("Čekám na soubory z telefonu…");
    await expect(dlg).not.toContainText(token);

    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "cs-CZ", timezoneId: "Europe/Prague" });
    try {
      const phone = await phoneCtx.newPage();
      await phone.goto(new URL(`/u#${token}`, baseURL).toString());
      await expect(phone.getByRole("heading", { level: 1, name: "Nahrát dokumenty z telefonu" })).toBeVisible();
      await phone.getByLabel("Vyfotit nebo vybrat soubory").setInputFiles([syntheticFile("foto-zpravy.jpg", "image/jpeg")]);
      await expect(phone.getByRole("list", { name: "Odeslané soubory" }).getByText("✓ Odesláno")).toBeVisible();

      await expect(dlg.getByText("Přijato z telefonu (1)")).toBeVisible();
      await expect(dlg.getByText("foto-zpravy.jpg")).toBeVisible();
      const ended = page.waitForResponse((r) => r.request().method() === "DELETE" && /^\/api\/upload-sessions\/[^/]+$/.test(new URL(r.url()).pathname));
      await dlg.getByRole("button", { name: "Hotovo" }).click();
      await expect(dlg).toBeHidden();
      expect((await ended).ok()).toBe(true);
      // Focus returns to the button that opened the dialog.
      await expect(uploads(app).getByRole("button", { name: "Nahrát z telefonu" })).toBeFocused();
      await expect(uploads(app).getByText("foto-zpravy.jpg")).toBeVisible();
      await expect(uploads(app).getByText(/z telefonu/).first()).toBeVisible();

      await phone.getByLabel("Vyfotit nebo vybrat soubory").setInputFiles([syntheticFile("druha.jpg", "image/jpeg")]);
      await expect(phone.getByRole("alert")).toHaveText("Platnost odkazu skončila, naskenujte kód znovu.");
    } finally {
      await phoneCtx.close();
    }
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
});
