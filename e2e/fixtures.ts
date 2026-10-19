import { test as base, expect, type Page, type Locator } from "@playwright/test";
import { ORG_ADMINS, resetDemo } from "./reset";
import { BASE_URLS } from "./servers";

// Helpers drive the app only through what a user sees: roles, accessible names, labels and Czech text. They never
// read page globals or data-* attributes, so a change to markup that keeps what a user sees keeps the tests green.

type Fixtures = {
  // Auto fixture: resets both demo orgs of this test's Worker before every test and fails the test on an uncaught page
  // error or a content security policy violation.
  fresh: void;
  app: App;
};

export const test = base.extend<Fixtures>({
  // Each Playwright worker talks to its own Worker (servers.ts): parallelIndex is the worker's slot, from 0 to
  // workers - 1, and a replacement worker after a failure takes over the slot, so no two running tests share a
  // database. page, context and request all read this base URL.
  baseURL: async ({}, use, testInfo) => {
    await use(BASE_URLS[testInfo.parallelIndex % BASE_URLS.length]);
  },
  fresh: [
    async ({ page, baseURL }, use) => {
      // Both demo orgs: org B starts empty (people and departments only), and a test that writes there (orgs.spec.ts)
      // must not leave its patient for the next test on this Worker.
      for (const admin of ORG_ADMINS) await resetDemo(baseURL!, admin);
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

export class App {
  constructor(
    readonly page: Page,
    readonly baseURL: string,
  ) {}

  // The address of a route relative to the base URL ("./patient/10/labs").
  url(route = ""): string {
    return "./" + route;
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
  // has data. The first call loads the page. Later calls change the address without a page load, because the demo
  // user picked in the header lives in the page and a load starts again as the default user. That is the browser's
  // own history API (pushState and the popstate the router listens to), not app state; a spec that needs a real load
  // (a reload, a link opened anew) calls page.reload() or goto().
  async open(route = ""): Promise<void> {
    const target = new URL(this.url(route), this.baseURL).href;
    if (this.page.url().startsWith(new URL("./", this.baseURL).href)) {
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
    // A switch reloads the new user's data; the role the page acts on is set once that is in, and the page shows no
    // signal for it, so the suite waits for the last read of the switch (the workflow) when the user really changes.
    const selected = await this.userPicker.getByRole("option", { selected: true }).textContent();
    const loaded = selected?.trim() === label ? null : this.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/workflow");
    await this.userPicker.selectOption({ label });
    await loaded;
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
