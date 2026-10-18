import { test, expect, type App } from "../fixtures";

// Screen S-2 (Kalendář MDT, PRODUCT.md F-11): week navigation, the mini month, booking and freeing slots by buttons,
// by drag and drop, and opening a case by click or double click. The seeded seminar is Thursday 22. 10. 2026.

const slot = (app: App, who: string, time: string) =>
  app.main.getByRole("button", { name: new RegExp(`^${who}, RČ .*, ${time}$`) });
const freeSlot = (app: App, time: string, outOfHours = false) =>
  app.main.getByRole("button", { name: `Volný termín ${time}${outOfHours ? ", mimo čas semináře" : ""}`, exact: true });
// "Naplánovat" in the patient list picks the patient and opens the calendar to choose a slot. (The calendar's own
// unscheduled list has no list or row roles to tell its "Naplánovat" buttons apart; drag and drop covers it below.)
async function pickFromList(app: App, name: string): Promise<void> {
  await app.nav("Databáze pacientů").click();
  await app.patientRow(name).getByRole("button", { name: "Naplánovat" }).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
}
const unscheduledHeading = (app: App) => app.main.getByRole("heading", { level: 2, name: /^Nenaplánovaní \(\d+\)$/ });

test.beforeEach(async ({ app }) => {
  await app.open();
  await app.nav("Kalendář MDT").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
});

test("shows the seminar week with booked and free slots", async ({ app }) => {
  await expect(app.main.getByText("19. 10. až 23. 10. 2026")).toBeVisible();
  await expect(app.main.getByText("Neuroonkologický seminář 14:00-16:00")).toBeVisible();
  await expect(slot(app, "Poláček Daniel", "14:00")).toBeVisible();
  await expect(slot(app, "Palajová Martina", "15:00")).toBeVisible();
  await expect(freeSlot(app, "15:10")).toBeVisible();
  await expect(freeSlot(app, "16:50", true)).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (4)");
  // The demo's today is 16. 10. 2026 and the mini month marks it.
  await expect(app.main.getByRole("button", { name: "2026-10-16, dnes" })).toBeVisible();
});

test("week arrows, Dnes, the mini month and the browser back button move the week", async ({ app, page }) => {
  await app.main.getByRole("button", { name: "Další týden ›" }).click();
  await expect(app.main.getByText("26. 10. až 30. 10. 2026")).toBeVisible();
  await page.goBack();
  await expect(app.main.getByText("19. 10. až 23. 10. 2026")).toBeVisible();
  await app.main.getByRole("button", { name: "‹ Předchozí týden" }).click();
  await expect(app.main.getByText("12. 10. až 16. 10. 2026")).toBeVisible();
  await app.main.getByRole("button", { name: "Další týden ›" }).click();
  await app.main.getByRole("button", { name: "Další týden ›" }).click();
  await app.main.getByRole("button", { name: "Dnes", exact: true }).click();
  await expect(app.main.getByText("12. 10. až 16. 10. 2026")).toBeVisible();
  await app.main.getByRole("button", { name: "2026-10-29", exact: true }).click();
  await expect(app.main.getByText("26. 10. až 30. 10. 2026")).toBeVisible();
  await app.main.getByRole("button", { name: "Další měsíc" }).click();
  await expect(app.main.getByText("listopad", { exact: true })).toBeVisible();
});

test("a click on a booked slot opens its card, Otevřít případ opens the case", async ({ app }) => {
  await slot(app, "Kotěrová Jaroslava", "14:10").click();
  const card = app.page.getByRole("heading", { level: 2, name: "Kotěrová Jaroslava" });
  await expect(card).toBeVisible();
  await expect(app.page.getByText("Termín: Čt 22. 10. 2026 · 14:10-14:20")).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Uvolnit termín" })).toBeVisible();
  await app.page.getByRole("button", { name: "Otevřít případ" }).click();
  await expect(app.main.getByRole("heading", { level: 1, name: /Kotěrová Jaroslava/ })).toBeVisible();
});

test("the card labels an assistant's drafted MDT question as a draft", async ({ app }) => {
  test.skip(app.legacy, "today's page shows no draft label since round 22");
  await slot(app, "Poláček Daniel", "14:00").click();
  const card = app.page.getByRole("region", { name: "Poláček Daniel" });
  await expect(card.getByText(/^Jaký postup doporučuje neurochirurgický seminář/)).toBeVisible();
  await expect(card.getByText("Návrh asistenta", { exact: true })).toBeVisible();
});

test("the card closes with its close button", async ({ app }) => {
  await slot(app, "Kotěrová Jaroslava", "14:10").click();
  const card = app.page.getByRole("heading", { level: 2, name: "Kotěrová Jaroslava" });
  await expect(card).toBeVisible();
  await app.page.getByRole("button", { name: "Zavřít kartu" }).click();
  await expect(card).toBeHidden();
});

test("a double click on a booked slot opens the case directly", async ({ app }) => {
  await slot(app, "Zábělská Zdena", "14:20").dblclick();
  await expect(app.main.getByRole("heading", { level: 1, name: /Zábělská Zdena/ })).toBeVisible();
});

test("booking with Naplánovat and a free slot persists after reload", async ({ app, page }) => {
  await pickFromList(app, "Zápotocký Luděk");
  await freeSlot(app, "15:10").click();
  await expect(slot(app, "Zápotocký Luděk", "15:10")).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (3)");
  await page.reload();
  await expect(slot(app, "Zápotocký Luděk", "15:10")).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (3)");
});

test("booking out of the seminar hours marks the slot", async ({ app }) => {
  await pickFromList(app, "Opletal Libor");
  await freeSlot(app, "16:30", true).click();
  const booked = slot(app, "Opletal Libor", "16:30");
  await expect(booked).toBeVisible();
  await expect(booked.getByLabel("mimo čas semináře")).toBeVisible();
});

test("Uvolnit termín frees a slot and the patient returns to Nenaplánovaní", async ({ app, page }) => {
  await slot(app, "Kotěrová Jaroslava", "14:10").click();
  await app.page.getByRole("button", { name: "Uvolnit termín" }).click();
  await expect(freeSlot(app, "14:10")).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (5)");
  await page.reload();
  await expect(freeSlot(app, "14:10")).toBeVisible();
});

test("drag and drop books an unscheduled patient and frees a booked slot", async ({ app }) => {
  await app.main.getByText(/Potužný Richard/).first().dragTo(freeSlot(app, "15:20"));
  await expect(slot(app, "Potužný Richard", "15:20")).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (3)");
  await slot(app, "Jelen Otakar", "14:50").dragTo(unscheduledHeading(app));
  await expect(freeSlot(app, "14:50")).toBeVisible();
  await expect(unscheduledHeading(app)).toHaveText("Nenaplánovaní (4)");
});

test("the coordinator may book, the administrator may not", async ({ app }) => {
  await app.loginAs("Ing. Kovář (správce systému)");
  await app.nav("Kalendář MDT").click();
  await slot(app, "Kotěrová Jaroslava", "14:10").click();
  // The administrator only reads: the server refuses and the page says who may change a slot.
  await app.page.getByRole("button", { name: "Uvolnit termín" }).click();
  await expect(app.page.getByText("Termín uvolňuje lékař nebo koordinátorka.")).toBeVisible();
  await expect(slot(app, "Kotěrová Jaroslava", "14:10")).toBeVisible();
  await app.loginAs("Bc. Marková (koordinátorka MDT)");
  await app.nav("Kalendář MDT").click();
  await pickFromList(app, "Zápotocký Luděk");
  await freeSlot(app, "15:30").click();
  await expect(slot(app, "Zápotocký Luděk", "15:30")).toBeVisible();
});
