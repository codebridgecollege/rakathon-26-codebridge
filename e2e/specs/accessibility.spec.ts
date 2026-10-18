import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, type App } from "../fixtures";
import { Discussion } from "../discussion";
import { openNewPatient } from "../intake";

// Automated accessibility checks (axe-core, WCAG 2.1 A and AA rules) on the main screens and dialogs of the new app,
// and keyboard checks for dialogs: focus moves in, Tab stays inside, Escape closes, focus returns to the opener.
// Only violations of serious or critical impact fail a test; the rest are listed in FRONTEND.md ("As implemented
// (step 13)").

// Rules that fail a test only above this impact.
const FAILING = new Set(["serious", "critical"]);

async function expectNoSeriousViolations(page: Page, what: string): Promise<void> {
  // preload off: axe would otherwise fetch the Google Fonts stylesheet itself to read its rules, a request the app never
  // makes and the content security policy (rightly) blocks.
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).options({ preload: false }).analyze();
  const bad = res.violations
    .filter((v) => FAILING.has(v.impact ?? ""))
    .map((v) => `${v.id} (${v.impact}): ${v.help}; ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")}: ${v.nodes[0]?.failureSummary?.replace(/\s+/g, " ")}`);
  // Soft, so one run lists every screen's violations, not only the first.
  expect.soft(bad, `serious or critical accessibility violations on ${what}`).toEqual([]);
}

test("list screens: patients, calendar, tasks, staff, administration", async ({ app, page }) => {
  await app.open();
  await expectNoSeriousViolations(page, "the patient list");
  await app.nav("Kalendář MDT").click();
  await expect(app.main.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "the calendar");
  await app.nav(/^Moje úlohy/).click();
  await expect(app.main.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "the tasks");
  await app.nav("Personál").click();
  await expect(app.main.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "the staff list");
  await app.loginAs("Ing. Kovář (správce systému)");
  await app.nav("Administrace").click();
  await expect(app.main.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "the administration");
});

// Every tab the case shows, for a processed case (NO-010) and the case with lab trends (NO-S01).
for (const [nr, name] of [
  ["10", /Poláček Daniel/],
  ["S01", /Křemínek Radovan/],
] as const) {
  test(`patient ${nr}: every tab, and the discussion card open`, async ({ app, page }) => {
    await app.open(`patient/${nr}/overview`);
    await expect(app.main.getByRole("heading", { level: 1, name })).toBeVisible();
    // allInnerTexts() does not wait: the heading can show before the case's tabs have rendered (seen on a Worker's
    // first request), so wait for them first.
    const tabRow = app.main.getByRole("tablist").getByRole("tab");
    await expect.poll(() => tabRow.count()).toBeGreaterThan(3);
    const tabs = await tabRow.allInnerTexts();
    for (const label of tabs) {
      await app.openTab(label.trim());
      await expectNoSeriousViolations(page, `patient ${nr}, tab ${label.trim()}`);
    }
    const d = new Discussion(app);
    await d.expand();
    await expectNoSeriousViolations(page, `patient ${nr} with the discussion card open`);
  });
}

// Checks a dialog with axe, then the keyboard: focus is inside, Tab cycles inside, Escape closes and focus returns.
async function checkDialog(app: App, open: () => Promise<void>, name: string | RegExp, opener: () => ReturnType<App["page"]["getByRole"]>): Promise<void> {
  const { page } = app;
  await open();
  const dlg = app.dialog(name);
  await expect(dlg).toBeVisible();
  await expectNoSeriousViolations(page, `the dialog ${String(name)}`);
  await expect.poll(() => dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // More presses than the dialog has controls, so a trap that leaks shows up.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
    expect(await dlg.evaluate((el) => el.contains(document.activeElement)), `focus left the dialog ${String(name)} after ${i + 1} presses`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(opener()).toBeFocused();
}

test("dialogs: new patient, report, source viewer, phone upload", async ({ app }) => {
  await app.open();
  await checkDialog(
    app,
    async () => void (await openNewPatient(app)),
    "Nový pacient",
    () => app.main.getByRole("button", { name: "+ Nový pacient" }),
  );

  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  await checkDialog(
    app,
    () => app.main.getByRole("button", { name: "Stáhnout report (PDF)" }).click(),
    "Záznam z MDT",
    () => app.main.getByRole("button", { name: "Stáhnout report (PDF)" }),
  );
  await expect(app.main.getByRole("heading", { level: 2, name: /^Aktuální stav pacienta/ })).toBeVisible();
  await checkDialog(
    app,
    () => app.main.getByRole("button", { name: "[1]", exact: true }).click(),
    "Původní dokument",
    () => app.main.getByRole("button", { name: "[1]", exact: true }),
  );

  await app.open("patient/S01/documents");
  await expect(app.main.getByRole("heading", { level: 1, name: /Křemínek Radovan/ })).toBeVisible();
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: /^Dokumenty( \(\d+\))?$/ }).click();
  await checkDialog(
    app,
    () => d.card.getByRole("button", { name: "Nahrát z telefonu" }).click(),
    "Nahrát z telefonu",
    () => d.card.getByRole("button", { name: "Nahrát z telefonu" }),
  );
});

test("the phone dialog over another dialog keeps Tab and Escape to itself", async ({ app, page }) => {
  await app.open("patient/S01/documents");
  await expect(app.main.getByRole("heading", { level: 1, name: /Křemínek Radovan/ })).toBeVisible();
  await app.main.getByRole("button", { name: "+ Nahrát dokument" }).click();
  const upload = app.dialog("Nahrát dokument");
  await expect(upload).toBeVisible();
  await upload.getByRole("button", { name: "Nahrát z telefonu" }).click();
  const phone = app.dialog("Nahrát z telefonu");
  await expect(phone).toBeVisible();
  await expect.poll(() => phone.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    expect(await phone.evaluate((el) => el.contains(document.activeElement)), `focus left the phone dialog after ${i + 1} presses`).toBe(true);
  }
  // Escape closes the top dialog only.
  await page.keyboard.press("Escape");
  await expect(phone).toBeHidden();
  await expect(upload).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(upload).toBeHidden();
});
