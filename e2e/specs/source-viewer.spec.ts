import { test, expect, type App } from "../fixtures";
import type { Locator } from "@playwright/test";

// The source viewer (PRODUCT.md F-18): a reference opens the original page image with the quoted passage, a page
// switcher, zoom, and the page transcription with the passage marked. Every claim must lead back to its source.

const QUOTE = "Subj. nově předepsaný everolimus toleruje výbormně, nemá s ním žádný problém.";

async function openFirstReference(app: App): Promise<Locator> {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 2, name: /^Aktuální stav pacienta/ })).toBeVisible();
  await app.main.getByRole("button", { name: "[1]", exact: true }).click();
  const viewer = app.dialog("Původní dokument");
  await expect(viewer).toBeVisible();
  return viewer;
}

// The page image must really load from the server (/api/documents/:id/pages/:n/image), not only be in the markup.
// naturalWidth is a property of the <img> element itself, not of the app.
async function expectImageLoaded(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

test("a reference opens the page image with the quoted passage", async ({ app }) => {
  const viewer = await openFirstReference(app);
  await expect(viewer.getByRole("heading", { level: 2, name: /^Ambulantní vyšetření kontrolní/ })).toBeVisible();
  await expect(viewer.getByText("10_pacient.pdf · NO-010 · strana 4 z 5", { exact: false })).toBeVisible();
  await expect(viewer.getByText(`„${QUOTE}“`, { exact: false })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "s. 4" })).toHaveAttribute("aria-pressed", "true");
  // The old page does not set aria-selected on the viewer's tabs, so the visible content tells which one is open.
  await expect(viewer.getByRole("tab", { name: "Stránka" })).toBeVisible();
  await expectImageLoaded(viewer.getByRole("img", { name: "Strana 4 dokumentu 10_pacient.pdf" }));
  // The passage was found on the image (the legend explains the yellow box) and no "not found" note shows.
  await expect(viewer.getByText(/^Žlutě: citovaná pasáž\./)).toBeVisible();
  await expect(viewer.getByText("Citace nenalezena přesně, zobrazena celá stránka.")).toHaveCount(0);
  await expect(viewer.getByText("3 místa k ověření")).toBeVisible();
});

test("the transcription tab marks the quoted passage", async ({ app }) => {
  const viewer = await openFirstReference(app);
  await viewer.getByRole("tab", { name: "Přepis stránky" }).click();
  await expect(viewer.getByRole("img", { name: /^Strana 4 dokumentu/ })).toHaveCount(0);
  // <mark> is HTML's own element for highlighted text (role "mark", which Playwright's role typing does not list yet).
  await expect(viewer.locator("mark").filter({ hasText: QUOTE })).toBeVisible();
  await expect(viewer.getByText(/Na cílený dotaz neguje závratě či poruchy rovnováhy/)).toBeVisible();
});

test("the page switcher, zoom and close work", async ({ app }) => {
  const viewer = await openFirstReference(app);
  await viewer.getByRole("button", { name: "s. 2" }).click();
  await expect(viewer.getByRole("button", { name: "s. 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByText("strana 2 z 5", { exact: false })).toBeVisible();
  await expectImageLoaded(viewer.getByRole("img", { name: "Strana 2 dokumentu 10_pacient.pdf" }));

  const zoom = viewer.getByRole("group", { name: "Zvětšení stránky" });
  await expect(zoom.getByRole("button", { name: "Obnovit zvětšení" })).toBeDisabled();
  await zoom.getByRole("button", { name: "Přiblížit" }).click();
  await expect(zoom.getByRole("button", { name: "Obnovit zvětšení" })).toBeEnabled();
  await zoom.getByRole("button", { name: "Obnovit zvětšení" }).click();
  await expect(zoom.getByText("Na šířku")).toBeVisible();

  await viewer.getByRole("button", { name: "Zavřít" }).click();
  await expect(viewer).toBeHidden();
});

test("the redaction demo swaps in the redacted image and hides the quote", async ({ app }) => {
  const viewer = await openFirstReference(app);
  await viewer.getByRole("checkbox", { name: "Cenzurovat (demo)" }).check();
  await expectImageLoaded(viewer.getByRole("img").first());
  await expect(viewer.getByText(`„${QUOTE}“`, { exact: false })).toHaveCount(0);
});

test("an alert's page link opens the cited page", async ({ app }) => {
  await app.open("patient/10/alerts");
  await app.main.getByRole("button", { name: /^Otevřít zdroj, strana 2: Další restaging\. 3\/2022/ }).click();
  const viewer = app.dialog("Původní dokument");
  await expect(viewer.getByRole("button", { name: "s. 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByText("Citace nenalezena přesně, zobrazena celá stránka.")).toHaveCount(0);
});
