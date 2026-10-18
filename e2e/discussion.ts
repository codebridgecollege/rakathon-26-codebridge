import { expect, type Locator } from "@playwright/test";
import type { App } from "./fixtures";

// A conclusion that names three next steps with timings, so approval drafts three tasks.
export const CONCLUSION =
  "Stereotaktická radioterapie ložiska v mozečku, kontrolní MR mozku za 3 měsíce, kontrola na onkologii za 4 týdny.";

// The discussion card "Projednání na MDT" on the patient view, found by its heading as a user finds it.
export class Discussion {
  constructor(readonly app: App) {}

  get heading(): Locator {
    return this.app.main.getByRole("heading", { level: 2, name: "Projednání na MDT" });
  }

  // The card is a disclosure group; its body holds the h3 sections.
  get card(): Locator {
    // `has` is resolved inside each group, so it takes a locator without the main landmark in front.
    const heading = this.app.page.getByRole("heading", { level: 2, name: "Projednání na MDT" });
    // The innermost group holding the heading is the card itself, also if the page wraps it in more groups.
    return this.app.main.getByRole("group").filter({ has: heading }).last();
  }

  get conclusion(): Locator {
    return this.app.main.getByRole("textbox", { name: /^Závěr a další postup, píše lékař/ });
  }

  get notes(): Locator {
    return this.card.getByRole("textbox", { name: "Průběžné poznámky" });
  }

  get approveButton(): Locator {
    return this.card.getByRole("button", { name: "Schválit závěr MDT" });
  }

  async expand(): Promise<void> {
    // Decide only once the case has rendered: the card opens by itself when a draft exists, and a click on the
    // heading of an open card would close it.
    await expect(this.app.main.getByRole("tablist")).toBeVisible();
    const section = this.card.getByRole("heading", { level: 3, name: "Záznam diskuse" });
    if (!(await section.isVisible())) await this.heading.click();
    await expect(section).toBeVisible();
  }

  // Types into a field and waits for the autosave the page sends when the field loses focus (PUT .../protocol).
  // There is no visible "saved" mark, so the request's answer is the only signal a user-level test can wait for.
  async typeAndSave(field: Locator, text: string): Promise<void> {
    const saved = this.app.page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/api\/cases\/[^/]+\/protocol$/.test(new URL(r.url()).pathname) && r.ok(),
    );
    await field.fill(text);
    await field.blur();
    await saved;
  }

  async approve(text: string): Promise<void> {
    await this.conclusion.fill(text);
    await this.expand();
    await this.approveButton.click();
    await expect(this.app.main.getByText(/Platný závěr č\. \d+ · schválil\(a\)/)).toBeVisible();
  }
}
