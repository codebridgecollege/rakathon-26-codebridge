import { test, expect, App } from "../fixtures";
import { Discussion } from "../discussion";

// Concurrent edits: two people editing the same draft are told, and choose whose text stays (autosave conflict bar).

test("two people editing the same draft: the later one is told and chooses whose text stays", async ({ app, page, browser, baseURL }) => {
  await app.open("patient/10/overview");
  const mine = new Discussion(app);
  await mine.expand();

  // A colleague (another browser, another doctor) saves a draft first.
  const otherCtx = await browser.newContext({ baseURL, locale: "cs-CZ", viewport: { width: 1440, height: 900 } });
  try {
    const otherPage = await otherCtx.newPage();
    const other = new App(otherPage);
    await other.open();
    await other.loginAs("MUDr. Malá");
    await other.open("patient/10/overview");
    const theirs = new Discussion(other);
    await theirs.expand();
    await theirs.typeAndSave(theirs.notes, "Poznámka kolegyně.");

    // My save is refused as a conflict; the page says who changed it and offers both choices.
    await mine.notes.fill("Moje poznámka.");
    await mine.notes.blur();
    const bar = mine.card.getByRole("alert").filter({ hasText: /Koncept mezitím upravil\(a\)/ });
    await expect(bar).toContainText("MUDr. Malá");
    await bar.getByRole("button", { name: "Načíst uloženou verzi" }).click();
    await expect(mine.notes).toHaveValue("Poznámka kolegyně.");
  } finally {
    await otherCtx.close();
  }
  await page.reload();
  await new Discussion(app).expand();
  await expect(new Discussion(app).notes).toHaveValue("Poznámka kolegyně.");
});
