import { test, expect } from "../fixtures";

// The side panel of a running MDT (PRODUCT.md, "During the MDT: the side panel"): it opens with the MDT on a wide
// window, shows the patient at a glance with the PACS stub saying it is one, and a computer can choose the whole window.

test("a running MDT opens the side panel, and the whole window can be chosen instead", async ({ app, page }) => {
  await app.open("patient/10/overview");
  await expect(page.getByRole("complementary", { name: "Přehled pacienta pro MDT" })).toHaveCount(0);
  await app.main.getByRole("button", { name: "Zahájit MDT", exact: true }).click();
  await app.dialog("Zahájit MDT").getByRole("button", { name: "Zahájit MDT ▸" }).click();

  const panel = page.getByRole("complementary", { name: "Přehled pacienta pro MDT" });
  await expect(panel.getByRole("heading", { level: 2, name: "Poláček Daniel" })).toBeVisible();
  await expect(panel.getByRole("heading", { level: 3, name: "Průběh" })).toBeVisible();
  // The values to count with stand beside PS, each opening its source.
  await expect(panel.getByRole("button", { name: "PS 1", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^ACEi při th. everolimem/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: "HBsAg pozitivní" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^eGFR 1,01 ml\/s/ })).toBeVisible();

  // The missing-document signal stays visible, whatever is folded; the summary leads, then the question.
  await expect(panel.getByText("chybí podklady")).toBeVisible();
  const order = await panel.locator("h3, .question").evaluateAll((els) => els.map((e) => e.textContent?.trim().slice(0, 14)));
  expect(order.indexOf("Souhrn")).toBe(0);
  // The radiologist shows PACS and nobody scrolls the panel: on a common laptop screen everything open fits.
  await page.setViewportSize({ width: 1440, height: 800 });
  const fits = await panel.locator("details").first().evaluate((d) => {
    const body = d.parentElement!;
    return body.scrollHeight <= body.clientHeight;
  });
  expect(fits).toBe(true);

  await panel.getByRole("button", { name: "PACS (ukázka)" }).click();
  await expect(page.getByText("PACS zatím není propojený.")).toBeVisible();

  await panel.getByRole("button", { name: "Celé okno" }).click();
  await expect(panel).toHaveCount(0);
  await app.main.getByRole("button", { name: "Boční panel" }).click();
  await expect(panel).toBeVisible();
});
