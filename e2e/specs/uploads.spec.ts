import { test, expect } from "../fixtures";
import { Discussion } from "../discussion";
import { chooseFiles, syntheticFile } from "../files";
import { S02_FILES } from "../intake";

// Uploads in "Projednání na MDT" (PRODUCT.md F-34) and "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md): any file is
// listed at once as "Nahráno"; the phone page at /u sends files into the case through a one-time link from the QR
// dialog. Patient NO-S01. Files are generated synthetic bytes, never patient documents.

async function openDocsSegment(app: import("../fixtures").App): Promise<Discussion> {
  await app.open("patient/S01/documents");
  await expect(app.main.getByRole("heading", { level: 1, name: /Křemínek Radovan/ })).toBeVisible();
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ }).click();
  await expect(d.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ })).toHaveAttribute("aria-pressed", "true");
  return d;
}

test("files chosen in the discussion card are listed as Nahráno and stay after a reload", async ({ app, page }) => {
  const d = await openDocsSegment(app);
  const zone = d.card.getByRole("button", { name: /^Přetáhněte soubory sem/ });
  await chooseFiles(page, zone, [syntheticFile("kontrola-mr.pdf"), syntheticFile("poznamka.txt", "text/plain")]);
  await expect(page.getByText("Nahráno: 2 soubory")).toBeVisible();
  await expect(d.card.getByText("kontrola-mr.pdf")).toBeVisible();
  await expect(d.card.getByText("Nahráno", { exact: true })).toHaveCount(2);
  // With the document pipeline off there is no "read without AI" action and no failure chip.
  await expect(app.main.getByRole("button", { name: "Přečíst bez AI" })).toHaveCount(0);
  await expect(app.main.getByText(/nezpracováno|zpracování selhalo|nepodařilo/)).toHaveCount(0);

  await page.reload();
  const again = new Discussion(app);
  await again.expand();
  await again.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ }).click();
  await expect(again.card.getByText("kontrola-mr.pdf")).toBeVisible();
  await again.card.getByRole("button", { name: "Odebrat kontrola-mr.pdf" }).click();
  await expect(again.card.getByText("kontrola-mr.pdf")).toHaveCount(0);
});

test("a document of another patient is flagged, never merged silently", async ({ app, page }) => {
  const d = await openDocsSegment(app);
  // A prepared document of synthetic patient S02 uploaded into the case of S01: the server compares the identities.
  await chooseFiles(page, d.card.getByRole("button", { name: /^Přetáhněte soubory sem/ }), [S02_FILES[0]]);
  await expect(d.card.getByText("01-ambulantni-zprava-2026-10-08.pdf")).toBeVisible();
  const row = d.card.getByRole("listitem").filter({ hasText: "01-ambulantni-zprava-2026-10-08.pdf" });
  await expect(row.getByRole("alert")).toHaveText(
    "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu; ověřte, zda dokument patří tomuto pacientovi.",
  );
});

test("the administrator gets no upload zone", async ({ app }) => {
  await app.open();
  await app.loginAs("Ing. Kovář (správce systému)");
  await app.open("patient/S01/documents");
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ }).click();
  // The segment is open (so an absent zone means "not offered", not "not rendered yet").
  await expect(d.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(d.card.getByRole("button", { name: /^Přetáhněte soubory sem/ })).toHaveCount(0);
});

test("phone upload: the QR dialog's link opens /u on a phone, a sent file arrives on the desktop", async ({ app, page, browser, baseURL }) => {
  const d = await openDocsSegment(app);
  // The link is only inside the QR image (the page never prints the token), so the test reads it from the answer to
  // the request that created the upload session, the same answer the page builds the QR code from.
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/upload-sessions");
  await d.card.getByRole("button", { name: "Nahrát z telefonu" }).click();
  const token = ((await (await created).json()) as { data: { token: string } }).data.token;
  const dlg = app.dialog("Nahrát z telefonu");
  await expect(dlg.getByRole("heading", { level: 2, name: "Nahrát z telefonu · NO-S01" })).toBeVisible();
  await expect(dlg.getByRole("img", { name: "QR kód pro nahrání z telefonu" })).toBeVisible();
  await expect(dlg.getByText(/^Platí 15 minut \(do \d{1,2}:\d{2}\), jen pro nahrání k případu NO-S01\.$/)).toBeVisible();
  await expect(dlg.getByRole("status")).toHaveText("Čekám na soubory z telefonu…");
  // The token is a credential: it never shows as text.
  await expect(dlg).not.toContainText(token);

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "cs-CZ", timezoneId: "Europe/Prague" });
  try {
    const phone = await phoneCtx.newPage();
    await phone.goto(new URL(`/u#${token}`, baseURL).toString());
    await expect(phone.getByRole("heading", { level: 1, name: "Nahrát dokumenty z telefonu" })).toBeVisible();
    await expect(phone.getByText("NO-S01")).toBeVisible();
    // The page moves the token out of the address bar.
    await expect(phone).not.toHaveURL(new RegExp(token));
    await phone.getByLabel("Vyfotit nebo vybrat soubory").setInputFiles([syntheticFile("foto-zpravy.jpg", "image/jpeg")]);
    await expect(phone.getByRole("list", { name: "Odeslané soubory" }).getByText("✓ Odesláno")).toBeVisible();
    await expect(phone.getByRole("status").filter({ hasText: /^Odesláno: 1 soubor/ })).toBeVisible();

    await expect(dlg.getByText("Přijato z telefonu (1)")).toBeVisible();
    await expect(dlg.getByText("foto-zpravy.jpg")).toBeVisible();
    // Hotovo ends the session on the server (DELETE); wait for that answer so the phone's next try cannot race it.
    const ended = page.waitForResponse((r) => r.request().method() === "DELETE" && /^\/api\/upload-sessions\/[^/]+$/.test(new URL(r.url()).pathname));
    await dlg.getByRole("button", { name: "Hotovo" }).click();
    await expect(dlg).toBeHidden();
    expect((await ended).ok()).toBe(true);
    await expect(d.card.getByText("foto-zpravy.jpg")).toBeVisible();
    await expect(d.card.getByText(/z telefonu/).first()).toBeVisible();

    // Closing the dialog ends the session: the phone's next file is refused with a clear message.
    await phone.getByLabel("Vyfotit nebo vybrat soubory").setInputFiles([syntheticFile("druha.jpg", "image/jpeg")]);
    await expect(phone.getByRole("alert")).toHaveText("Platnost odkazu skončila, naskenujte kód znovu.");
  } finally {
    await phoneCtx.close();
  }
});
