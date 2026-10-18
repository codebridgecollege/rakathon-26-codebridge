import { test as base, expect, type Page, type Locator } from "@playwright/test";
import { resetDemo } from "./reset";

// Helpers drive the app only through what a user sees: roles, accessible names, labels and Czech text. They never
// read page globals or data-* attributes, so the same helpers work on the ported app as long as the wording stays.

type Fixtures = {
  // Auto fixture: resets the shared demo before every test and fails the test on an uncaught page error or a content
  // security policy violation.
  fresh: void;
  app: App;
};

export const test = base.extend<Fixtures>({
  fresh: [
    async ({ page, baseURL }, use) => {
      await resetDemo(baseURL!);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // Chromium reports every blocked load, script, style or connection as a console error naming the policy; a
      // violation means a screen depends on something the Worker's policy (api/scripts/headers.mjs) does not allow.
      const violations: string[] = [];
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
    await use(new App(page));
  },
});

export { expect };

export class App {
  constructor(readonly page: Page) {}

  get main(): Locator {
    return this.page.getByRole("main");
  }

  get userPicker(): Locator {
    return this.page.getByRole("combobox", { name: /Aktuální uživatel/ });
  }

  nav(name: string | RegExp): Locator {
    return this.page.getByRole("navigation", { name: "Hlavní oblasti" }).getByRole("button", { name });
  }

  // Opens the app at a hash route and waits until the patient list or the route's screen has data. The path is relative
  // to the base URL, so the same specs run against today's page (E2E_BASE_URL=http://host/) and the new app under
  // /app/ (E2E_BASE_URL=http://host/app/). The hash keeps today's form (#calendar/2026-10-22); the new app redirects it.
  async open(hash = ""): Promise<void> {
    await this.page.goto("./" + (hash ? "#" + hash : ""));
    await expect(this.userPicker).toBeVisible();
    if (!hash) await expect(this.patientRows().first()).toBeVisible();
  }

  // The demo has no login: the user picker in the header stands in for it.
  async loginAs(label: string): Promise<void> {
    await this.userPicker.selectOption({ label });
    await expect(this.userPicker.getByRole("option", { selected: true })).toHaveText(label);
  }

  patientTable(): Locator {
    return this.main.getByRole("table").first();
  }

  // Body rows of the patient table (the header row is the first row of the table).
  patientRows(): Locator {
    return this.patientTable().getByRole("row").filter({ has: this.page.getByRole("cell") });
  }

  patientRow(name: string): Locator {
    return this.patientRows().filter({ hasText: name });
  }

  async openPatient(name: string): Promise<void> {
    await this.nav("Databáze pacientů").click();
    await this.patientRow(name).getByRole("cell", { name, exact: false }).first().click();
    await expect(this.main.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible();
  }

  tab(name: string): Locator {
    return this.main.getByRole("tab", { name, exact: true });
  }

  async openTab(name: string): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute("aria-selected", "true");
  }

  dialog(name?: string | RegExp): Locator {
    return name ? this.page.getByRole("dialog", { name }) : this.page.getByRole("dialog");
  }
}
