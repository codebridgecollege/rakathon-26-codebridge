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
  app: async ({ page, baseURL }, use) => {
    await use(new App(page, baseURL!));
  },
});

export { expect };

// The old page at /legacy/ keeps its hash routes (#patient/10/labs); the app at / uses paths (/patient/10/labs).
export const isLegacy = (baseURL: string) => new URL(baseURL).pathname.startsWith("/legacy/");

export class App {
  constructor(
    readonly page: Page,
    readonly baseURL: string,
  ) {}

  // True when this run checks the old page, which lacks some of the app's additions (for example the draft label on
  // an assistant's drafted MDT question).
  get legacy(): boolean {
    return isLegacy(this.baseURL);
  }

  // The address of a route relative to the base URL: "./patient/10/labs" for the app, "./#patient/10/labs" for the
  // old page.
  url(route = ""): string {
    return "./" + (route ? (this.legacy ? "#" : "") + route : "");
  }

  get main(): Locator {
    return this.page.getByRole("main");
  }

  get userPicker(): Locator {
    return this.page.getByRole("combobox", { name: /Aktuální uživatel/ });
  }

  nav(name: string | RegExp): Locator {
    return this.page.getByRole("navigation", { name: "Hlavní oblasti" }).getByRole("button", { name });
  }

  // Opens a route ("patient/10/labs", "calendar/2026-10-22") and waits until the patient list or the route's screen
  // has data. The address is relative to the base URL (url()), so the same specs run against the app at / and today's
  // page at /legacy/. The first call loads the page. Later calls change the address without a page load, as a hash
  // link does on today's page: the demo user picked in the header lives in the page, and a load starts again as the
  // default user. On the app that is the browser's own history API (pushState and the popstate a router listens to),
  // not app state; a spec that needs a real load (a reload, a link opened anew) calls page.reload() or goto().
  async open(route = ""): Promise<void> {
    const target = new URL(this.url(route), this.baseURL).href;
    if (!this.legacy && this.page.url().startsWith(new URL("./", this.baseURL).href)) {
      await this.page.evaluate((u) => {
        history.pushState(null, "", u);
        dispatchEvent(new PopStateEvent("popstate", { state: null }));
      }, target);
    } else await this.page.goto(target);
    await expect(this.userPicker).toBeVisible();
    if (!route) await expect(this.patientRows().first()).toBeVisible();
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
