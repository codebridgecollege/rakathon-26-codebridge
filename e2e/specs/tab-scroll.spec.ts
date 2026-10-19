import { test, expect, type App } from "../fixtures";

// Switching a patient tab keeps the scroll position (issue #48); leaving the case still starts a screen at the top.
// The scroll offset is a property of the window, not of the app.

const scrollY = (app: App): Promise<number> => app.page.evaluate(() => Math.round(window.scrollY));

test("a tab change keeps the scroll position, back restores it and another screen starts at the top", async ({ app }) => {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  await expect(app.main.getByRole("tablist")).toBeVisible();
  // Scroll down until the tab bar is near the top of the window: the case header above it is tall, and a click on a
  // tab that is out of view would make Playwright scroll it into view and hide what the test measures.
  const target = await app.page.evaluate(() => {
    const bar = document.querySelector('[role="tablist"]')!;
    return Math.max(0, Math.round(bar.getBoundingClientRect().top + window.scrollY - 150));
  });
  expect(target, "the tab bar must lie below the fold for this test to mean anything").toBeGreaterThan(50);
  await app.page.evaluate((y) => window.scrollTo(0, y), target);
  // The page may end before the target; what matters is a position well below the top.
  await app.page.waitForTimeout(200);
  const before = await scrollY(app);
  expect(before).toBeGreaterThan(50);

  await app.openTab("Anamnéza");
  await expect(app.page).toHaveURL(/\/patient\/10\/anamnesis$/);
  await expect(app.main.getByRole("heading", { level: 2, name: "Anamnéza" })).toBeVisible();
  // Give a wrongly scheduled scroll to the top time to happen before asserting.
  await app.page.waitForTimeout(300);
  expect(await scrollY(app)).toBe(before);

  await app.page.goBack();
  await expect(app.page).toHaveURL(/\/patient\/10\/overview$/);
  await app.page.waitForTimeout(300);
  expect(await scrollY(app)).toBe(before);

  await app.nav("Databáze pacientů").click();
  await expect(app.page).toHaveURL(/\/patients$/);
  await expect.poll(() => scrollY(app)).toBe(0);
});
