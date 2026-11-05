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
  await expect(panel.getByRole("heading", { level: 3, name: "Léčba" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "ACE inhibitory při léčbě everolimem" })).toBeVisible();

  // The summary leads, then the question, then the treatment modalities with the facts that bear on them.
  const order = await panel.locator("h3, .question").evaluateAll((els) => els.map((e) => e.textContent?.trim().slice(0, 14)));
  expect(order.indexOf("Souhrn")).toBe(0);
  const mods = panel.locator('[data-test="modality-checks"]');
  await expect(mods.getByRole("heading", { level: 3, name: "Léčebné modality" })).toBeVisible();
  await expect(mods.getByText("Pozorování asistenta z dokumentace, ne doporučení")).toBeVisible();
  await expect(mods.getByText("Imunoterapie", { exact: true })).toBeVisible();
  await expect(mods.getByText("Operace", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Otevřít v PACS (ukázka)" }).click();
  await expect(page.getByText("PACS zatím není propojený.")).toBeVisible();

  await panel.getByRole("button", { name: "Celé okno" }).click();
  await expect(panel).toHaveCount(0);
  await app.main.getByRole("button", { name: "Boční panel" }).click();
  await expect(panel).toBeVisible();
});
