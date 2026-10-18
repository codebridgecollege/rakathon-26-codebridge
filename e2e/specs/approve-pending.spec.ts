import type { Route } from "@playwright/test";
import { test, expect } from "../fixtures";
import { Discussion, CONCLUSION } from "../discussion";

// A doctor types the conclusion and clicks "Schválit závěr MDT" at once, while something the approval depends on is
// still on its way: the autosave that leaving the field starts, or the guideline layer the case view loads. The click
// must end in an approval after that load, never be dropped (PRODUCT.md F-24). Each test holds the answer until the
// click has happened, so the order is fixed without sleeps. The answers of our own API are held back, never
// changed (allowed in e2e/README.md for this): there is no other way to make a load arrive after a click. Patient NO-010.

// Holds every matching request until release() is called; the requests then go to the Worker as usual.
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((res) => (open = res));
  return {
    handler: async (route: Route) => {
      await opened;
      await route.continue();
    },
    release: () => open(),
  };
}

const approvedLine = /Platný závěr č\. 1 · schválil\(a\) MUDr\. Svobodová/;

test("approve right after typing waits for the autosave the click started, then approves", async ({ app, page }) => {
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  const d = new Discussion(app);
  await d.expand();
  const save = gate();
  await page.route(/\/api\/cases\/[^/]+\/protocol$/, (route) => (route.request().method() === "PUT" ? save.handler(route) : route.continue()));
  const order: string[] = [];
  page.on("requestfinished", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === "PUT" && p.endsWith("/protocol")) order.push("save");
    if (r.method() === "POST" && p.endsWith("/decisions")) order.push("approve");
  });
  await d.conclusion.fill(CONCLUSION);
  // No wait: the click itself takes focus off the field, which starts the autosave.
  await d.approveButton.click();
  await expect(d.card.getByRole("button", { name: "Schvaluji…" })).toBeDisabled();
  save.release();
  await expect(app.main.getByText(approvedLine)).toBeVisible();
  // The request events may come a moment after the screen shows the approval.
  await expect.poll(() => order).toEqual(["save", "approve"]);
  // The stored conclusion is the typed one, also after a reload.
  await page.reload();
  await expect(app.main.getByText(approvedLine)).toBeVisible();
  await expect(app.main.getByText(CONCLUSION).first()).toBeVisible();
});

test("approve while the guideline layer is still loading waits for it, then approves", async ({ app, page }) => {
  const guide = gate();
  await page.route(/\/api\/cases\/[^/]+\/guidance$/, guide.handler);
  await app.open("patient/10/overview");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  const d = new Discussion(app);
  await d.expand();
  await d.conclusion.fill(CONCLUSION);
  await d.approveButton.click();
  await expect(d.card.getByRole("button", { name: "Schvaluji…" })).toBeDisabled();
  // The doctor approves the text they clicked on: it cannot change while the approval waits.
  await expect(d.conclusion).not.toBeEditable();
  guide.release();
  await expect(app.main.getByText(approvedLine)).toBeVisible();
});
