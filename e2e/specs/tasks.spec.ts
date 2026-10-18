import { test, expect } from "../fixtures";
import { Discussion, CONCLUSION } from "../discussion";

// Tasks (PRODUCT.md F-32, screen S-6): drafts from an approved conclusion that only a doctor confirms or dismisses,
// the coordinator's "Úlohy po MDT" view with the digest e-mail, and the done toggle on "Moje úlohy".

async function approveCase10(app: import("../fixtures").App): Promise<Discussion> {
  await app.open("patient/10/overview");
  const d = new Discussion(app);
  await d.approve(CONCLUSION);
  await d.expand();
  return d;
}

test("approval drafts tasks; a doctor confirms one and dismisses another", async ({ app, page }) => {
  const d = await approveCase10(app);
  await expect(d.card.getByRole("heading", { level: 3, name: "Návrh úloh ze schváleného závěru" })).toBeVisible();
  const drafts = d.card.getByRole("listitem").filter({ hasText: "Návrh asistenta, nepotvrzeno" });
  await expect(drafts).toHaveCount(3);
  // Each draft quotes the clause of the conclusion it comes from.
  await expect(drafts.first()).toContainText("Ze závěru: „");

  const first = drafts.first();
  const firstText = (await first.locator("b").first().innerText()).trim();
  await first.getByRole("button", { name: "Potvrdit" }).click();
  await expect(drafts).toHaveCount(2);
  await expect(d.card.getByText(/Potvrdil\(a\) MUDr\. Svobodová/)).toBeVisible();

  await drafts.first().getByRole("button", { name: "Zamítnout" }).click();
  await expect(drafts).toHaveCount(1);

  await page.reload();
  await d.expand();
  await expect(d.card.getByRole("listitem").filter({ hasText: "Návrh asistenta, nepotvrzeno" })).toHaveCount(1);
  await expect(d.card.getByText(/Potvrdil\(a\) MUDr\. Svobodová/)).toBeVisible();

  // The confirmed task is now a task in "Moje úlohy" (scope "Všechny").
  await app.nav(/^Moje úlohy/).click();
  await app.main.getByRole("button", { name: "Všechny", exact: true }).click();
  await expect(app.main.getByText(firstText, { exact: true }).first()).toBeVisible();
});

test("the coordinator sees drafts read-only in Úlohy po MDT and sends the digest", async ({ app }) => {
  await approveCase10(app);
  await app.loginAs("Bc. Marková (koordinátorka MDT)");
  await app.nav(/^Moje úlohy/).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await app.main.getByRole("button", { name: "Úlohy po MDT", exact: true }).click();
  await expect(app.main.getByRole("heading", { level: 2, name: "Úlohy po MDT" })).toBeVisible();
  const group = app.main.getByText(/^NO-010 · Poláček$/);
  await expect(group).toBeVisible();
  await expect(app.main.getByText("návrh asistenta, nepotvrzeno")).toHaveCount(3);
  await expect(app.main.getByRole("button", { name: "Potvrdit" })).toHaveCount(0);
  await app.main.getByRole("button", { name: "Odeslat přehled e-mailem" }).click();
  await expect(app.page.getByText("Přehled odeslán (jen počet a odkaz)")).toBeVisible();
  // The e-mail carries a count and a link, never patient data.
  await expect(app.main.getByText(/úloh[ay]? (čeká|čekají) na vyřízení/).first()).toBeVisible();
});

test("the coordinator cannot confirm a draft in the case either", async ({ app }) => {
  await approveCase10(app);
  await app.loginAs("Bc. Marková (koordinátorka MDT)");
  await app.openPatient("Poláček Daniel");
  const d = new Discussion(app);
  await d.expand();
  await expect(d.card.getByText("čeká na potvrzení lékařem").first()).toBeVisible();
  await expect(d.card.getByRole("button", { name: "Potvrdit" })).toHaveCount(0);
  await expect(d.card.getByText("Potvrdit nebo zamítnout návrh může jen lékař.", { exact: false })).toBeVisible();
});

test("a task is marked done, stays done after a reload, and can be reopened", async ({ app, page }) => {
  await app.open();
  await app.nav(/^Moje úlohy/).click();
  await app.main.getByRole("button", { name: "Všechny", exact: true }).click();
  // The seed holds one open and one done task.
  await expect(app.main.getByText("1 otevřená", { exact: true })).toBeVisible();
  await expect(app.main.getByText(/^Hotovo \(1\)$/)).toBeVisible();
  // click(), not check(): the page re-renders the list, so the clicked box is replaced by a new one.
  await app.main.getByRole("checkbox", { name: "Hotovo" }).first().click();
  await expect(app.main.getByText("0 otevřených", { exact: true })).toBeVisible();
  await expect(app.main.getByText(/^Hotovo \(2\)$/)).toBeVisible();
  await page.reload();
  await app.main.getByRole("button", { name: "Všechny", exact: true }).click();
  await expect(app.main.getByText(/^Hotovo \(2\)$/)).toBeVisible();
  await app.main.getByText(/^Hotovo \(2\)$/).click();
  await app.main.getByRole("checkbox", { name: "Hotovo", checked: true }).first().click();
  await expect(app.main.getByText("1 otevřená", { exact: true })).toBeVisible();
});
