import { test, expect, type App } from "../fixtures";
import { Discussion } from "../discussion";

// Role-based visibility (docs/design/INTEGRATION.md roles, api/src/domain/roles.ts): the demo has no login, the user
// picker stands in for it, and the page shows each role only the actions it may take. The server checks again.

const DOCTOR = "MUDr. Svobodová";
const COORD = "Bc. Marková (koordinátorka MDT)";
const ADMIN = "Ing. Kovář (správce systému)";

async function openCase10As(app: App, user: string): Promise<void> {
  await app.open();
  await app.loginAs(user);
  await app.openPatient("Poláček Daniel");
  // Wait for the case content: a "no edit button" check on a page still loading would pass for the wrong reason.
  await expect(app.main.getByRole("heading", { level: 2, name: /^Onkologický souhrn/ })).toBeVisible();
  await expect(app.main.getByRole("tablist")).toBeVisible();
}

test("the picker says the demo has no login and lists doctors and the two other roles", async ({ app }) => {
  await app.open();
  await expect(app.page.getByRole("banner").getByText("Uživatel:")).toBeVisible();
  await expect(app.userPicker).toHaveAccessibleName("Aktuální uživatel (maketa bez přihlášení)");
  await expect(app.userPicker.locator("option:checked")).toHaveText(DOCTOR);
  for (const label of [COORD, ADMIN, "MUDr. Novák", "MUDr. Němcová"]) {
    await expect(app.userPicker.getByRole("option", { name: label, exact: true })).toHaveCount(1);
  }
});

test("a doctor may edit facts, confirm the question and approve", async ({ app }) => {
  await openCase10As(app, DOCTOR);
  await expect(app.main.getByRole("button", { name: "Upravit", exact: true }).first()).toBeVisible();
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toBeVisible();
  const d = new Discussion(app);
  await d.conclusion.fill("Kontrolní MR mozku za 3 měsíce.");
  await d.expand();
  await expect(d.approveButton).toBeEnabled();
});

test("the coordinator changes status and schedules but edits no clinical content and cannot approve", async ({ app }) => {
  await openCase10As(app, COORD);
  await expect(app.main.getByRole("button", { name: "Upravit", exact: true })).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "Změnit termín" })).toBeVisible();
  await app.main.getByRole("button", { name: "Připraven ▾" }).click();
  await expect(app.dialog("Stav případu").getByRole("button", { name: "Změnit na: Vyžaduje pozornost" })).toBeVisible();
  await app.dialog("Stav případu").getByRole("button", { name: "Zavřít", exact: true }).click();
  const d = new Discussion(app);
  await d.expand();
  await expect(d.approveButton).toBeDisabled();
  await expect(d.card.getByText("schvaluje lékař", { exact: true })).toBeVisible();
});

test("the administrator only reads: no edits, no status changes, no approval", async ({ app }) => {
  await openCase10As(app, ADMIN);
  await expect(app.main.getByRole("button", { name: "Upravit", exact: true })).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toHaveCount(0);
  await app.main.getByRole("button", { name: "Připraven ▾" }).click();
  const menu = app.dialog("Stav případu");
  await expect(menu.getByText("Stav mění lékař nebo koordinátorka; správce jen čte.")).toBeVisible();
  await expect(menu.getByRole("button", { name: /^Změnit na:|^Vrátit na:|^Uzavřít případ$/ })).toHaveCount(0);
  await menu.getByRole("button", { name: "Zavřít", exact: true }).click();
  const d = new Discussion(app);
  await d.expand();
  await expect(d.approveButton).toBeDisabled();
});

test("switching the user keeps the page usable and the header follows the choice", async ({ app }) => {
  await openCase10As(app, COORD);
  await app.loginAs(DOCTOR);
  await app.openPatient("Poláček Daniel");
  await expect(app.main.getByRole("button", { name: "Potvrdit otázku" })).toBeVisible();
});
