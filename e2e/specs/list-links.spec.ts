import { test, expect } from "../fixtures";

// Links into the list screens (/patients, /calendar/<day>, /tasks, /staff, /admin; #patients and so on on today's
// page) open their screens, and the patient table's columns can be resized by dragging their edge (FRONTEND.md step
// 3). Both run against today's page and the new app.

test("links open their screens, a calendar link opens that day's week", async ({ app }) => {
  await app.open("calendar/2026-10-28");
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
  await expect(app.main.getByText("26. 10. až 30. 10. 2026")).toBeVisible();
  // A day whose Monday lies in the previous month: the week starts in November, the mini month shows December.
  await app.open("calendar/2026-12-02");
  await expect(app.main.getByText("30. 11. až 4. 12. 2026")).toBeVisible();
  await expect(app.main.getByText("prosinec", { exact: true })).toBeVisible();
  await app.open("tasks");
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await app.open("staff");
  await expect(app.main.getByRole("heading", { level: 1, name: "Personál pracoviště" })).toBeVisible();
  await app.open("patients");
  await expect(app.main.getByRole("heading", { level: 1, name: "Databáze pacientů" })).toBeVisible();
  // Administrace stays the administrator's: a doctor following the link is told so.
  await app.open("admin");
  await expect(app.main.getByText("Administrace je jen pro správce systému.")).toBeVisible();
});

test("dragging a column edge widens the column", async ({ app, page }) => {
  await app.open();
  const head = app.patientTable().getByRole("columnheader", { name: "Diagnóza" });
  const before = (await head.boundingBox())!;
  // The resize handle sits on the header's right edge.
  const x = before.x + before.width - 1;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await head.boundingBox())!.width - before.width)).toBeGreaterThanOrEqual(55);
  // The drag is not a click: no filter opened and no patient opened.
  await expect(app.main.getByRole("heading", { level: 1, name: "Databáze pacientů" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
