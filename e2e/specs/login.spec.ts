import { test as base, expect, type Page } from "@playwright/test";
import { App } from "../fixtures";
import { Discussion } from "../discussion";

// The real login (docs/design/AUTH.md, "Tests"): a Worker in AUTH_MODE=oidc and the mock IdP of e2e/mock-oidc.mjs, both
// started by run-parallel.mjs, which passes the Worker's address as E2E_OIDC_URL. The flow is the deployed one: the
// app sends the browser to /auth/login, the Worker to the IdP's login page, the IdP back to /auth/callback. The mock
// asks only for an e-mail, so no real account or password is involved. Accounts are the seed's demo accounts.
//
// These tests never reset the demo (the reset needs a login of its own) and touch nothing other specs read: every test
// has its own browser context, so its own login session.

const OIDC = process.env.E2E_OIDC_URL ? new URL(process.env.E2E_OIDC_URL).origin + "/" : null;

type Fixtures = { app: App; guard: void };
const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => {
    await use(OIDC ?? undefined);
  },
  // As fixtures.ts does for the demo specs: no uncaught page error, no content security policy violation.
  guard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const violations: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
      });
      await use();
      expect(errors, "uncaught errors in the page").toEqual([]);
      expect(violations, "content security policy violations").toEqual([]);
    },
    { auto: true },
  ],
  app: async ({ page }, use) => {
    await use(new App(page, OIDC!));
  },
});

test.skip(!OIDC, "needs the login Worker and the mock IdP that run-parallel.mjs starts (E2E_OIDC_URL)");

const DOCTOR_A = "lekar1.a@codebridge.demo";
const ADMIN_A = "admin.a@codebridge.demo";
const DOCTOR_B = "lekar1.b@codebridge.demo";

async function logInAtIdp(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Mock IdP: přihlášení" })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Přihlásit se u IdP" }).click();
}
const account = (page: Page, name: string) => page.getByRole("button", { name: `Účet: ${name}` });
const menu = (page: Page) => page.getByRole("dialog", { name: "Účet" });

test("a login at the IdP returns to the address asked for, with the account menu instead of the picker", async ({ app, page }) => {
  await page.goto("tasks");
  await logInAtIdp(page, DOCTOR_A);
  await expect(page).toHaveURL(new URL("tasks", OIDC!).href);
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await expect(account(page, "MUDr. Svobodová")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Aktuální uživatel/ })).toHaveCount(0);
  await account(page, "MUDr. Svobodová").click();
  await expect(menu(page)).toContainText("Ukázková nemocnice A");
  await expect(menu(page)).toContainText("lékař");
});

test("an account without a membership gets 'Nemáte přístup'", async ({ page }) => {
  await page.goto("patients");
  await logInAtIdp(page, "nikdo@codebridge.demo");
  await expect(page.getByRole("heading", { level: 1, name: "Nemáte přístup" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Přihlásit jiným účtem" })).toBeVisible();
});

test("logout ends the session here and at the IdP", async ({ page }) => {
  await page.goto("patients");
  await logInAtIdp(page, DOCTOR_A);
  await account(page, "MUDr. Svobodová").click();
  await menu(page).getByRole("button", { name: "Odhlásit" }).click();
  // The IdP's logout comes back to the app, which has no session and goes to the login: the IdP asks again.
  await expect(page.getByRole("heading", { name: "Mock IdP: přihlášení" })).toBeVisible();
  await page.goto(new URL("patients", OIDC!).href);
  await expect(page.getByRole("heading", { name: "Mock IdP: přihlášení" })).toBeVisible();
});

test("the role switch of a demo org acts as another demo account and the access log names the real person", async ({ app, page }) => {
  await page.goto("patients");
  await logInAtIdp(page, ADMIN_A);
  await expect(app.nav("Administrace")).toBeVisible();
  await account(page, "Ing. Kovář").click();
  await expect(menu(page).getByRole("button", { name: "Ing. Kovář (správce systému)" })).toHaveAttribute("aria-pressed", "true");
  await menu(page).getByRole("button", { name: "MUDr. Svobodová (lékař)" }).click();
  await expect(account(page, "MUDr. Svobodová")).toBeVisible();
  // A doctor has no administration; the acting role decides what the page offers.
  await expect(app.nav("Databáze pacientů")).toBeVisible();
  await expect(app.nav("Administrace")).toHaveCount(0);
  await account(page, "MUDr. Svobodová").click();
  await expect(menu(page)).toContainText("Přihlášen(a): Ing. Kovář");
  await menu(page).getByRole("button", { name: "Ing. Kovář (správce systému)" }).click();
  await expect(account(page, "Ing. Kovář")).toBeVisible();
  await app.nav("Administrace").click();
  // The role switch itself is a row of the log, with the administrator as the person and the doctor's role.
  await expect(app.main.getByRole("cell", { name: "Ing. Kovář (jako MUDr. Svobodová)" }).first()).toBeVisible();
});

test("a lost session with nothing unsaved goes through the login and back to where the user was", async ({ app, page, context }) => {
  await page.goto("patients");
  await logInAtIdp(page, DOCTOR_A);
  await expect(app.patientRows().first()).toBeVisible();
  await context.clearCookies({ name: "__Host-cb_session" });
  // Opening a case reads it from the server, which refuses the request without a session; the page goes through the
  // login. The IdP still has its own session, so the login passes without its page, as with Zitadel.
  const relogin = page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/callback");
  await app.patientRow("Poláček Daniel").getByRole("cell", { name: "Poláček Daniel", exact: false }).first().click();
  await relogin;
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  await expect(page).toHaveURL(/\/patient\/10\//);
  await expect(account(page, "MUDr. Svobodová")).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "__Host-cb_session")).toBe(true);
});

test("a lost session with an unsaved draft keeps the page, logs in in a second window and stores the draft", async ({ app, page, context }) => {
  await page.goto("patient/10/overview");
  await logInAtIdp(page, DOCTOR_A);
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  const d = new Discussion(app);
  await d.expand();
  await context.clearCookies({ name: "__Host-cb_session" });
  const text = "Koncept po vypršení přihlášení: kontrolní MR za 3 měsíce.";
  await d.conclusion.fill(text);
  await d.conclusion.blur();
  const dlg = page.getByRole("alertdialog", { name: "Přihlášení vypršelo" });
  await expect(dlg).toBeVisible();
  await expect(page).toHaveURL(/\/patient\/10\//);
  const [popup] = await Promise.all([context.waitForEvent("page"), dlg.getByRole("button", { name: "Přihlásit se v novém okně" }).click()]);
  await expect(popup.getByRole("heading", { level: 1, name: "Přihlášení obnoveno" })).toBeVisible();
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/cases\/[^/]+\/protocol$/.test(new URL(r.url()).pathname) && r.ok());
  await dlg.getByRole("button", { name: "Zkusit znovu" }).click();
  await saved;
  await expect(dlg).toBeHidden();
  await popup.close();
  await page.reload();
  await d.expand();
  await expect(d.conclusion).toHaveValue(text);
});

test("an org B doctor logged in sees only org B's patient, and an org A case address leads back to the list", async ({ app, page }) => {
  await page.goto("patients");
  await logInAtIdp(page, DOCTOR_B);
  await expect(account(page, "MUDr. Vlčková")).toBeVisible();
  await expect(app.patientRow("Křemínek Radovan")).toHaveCount(1);
  await expect(app.patientRows()).toHaveCount(1);
  await expect(app.patientRow("Poláček Daniel")).toHaveCount(0);
  await page.goto(new URL("patient/10/overview", OIDC!).href);
  await expect(app.patientRow("Křemínek Radovan")).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček/ })).toHaveCount(0);
});
