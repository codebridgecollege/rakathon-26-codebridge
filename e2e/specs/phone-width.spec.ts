import { test, expect, type App } from "../fixtures";

// Phone width (PRODUCT.md F-36; CLAUDE.md asks for no horizontal page scroll at phone width). The main screens must
// not overflow sideways at 400 px; wide tables scroll inside their own box.

test.use({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });

// scrollWidth is a property of the document element, not of the app.
async function expectNoSidewaysScroll(app: App): Promise<void> {
  await expect
    .poll(() => app.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
}

test("patients list, calendar and tasks fit the phone width", async ({ app }) => {
  await app.open();
  await expectNoSidewaysScroll(app);
  await app.nav("Kalendář MDT").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
  await expectNoSidewaysScroll(app);
  await app.nav(/^Moje úlohy/).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await expectNoSidewaysScroll(app);
});

test("the patient view and its tabs fit the phone width", async ({ app }) => {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 2, name: /^Onkologický souhrn/ })).toBeVisible();
  await expectNoSidewaysScroll(app);
  for (const tab of ["Dokumenty", "Laboratoř", "Upozornění", "Retrospektivní odchylky"]) {
    await app.openTab(tab);
    await expectNoSidewaysScroll(app);
  }
});
