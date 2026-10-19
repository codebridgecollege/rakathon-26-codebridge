import { test, expect } from "../fixtures";
import { createS02 } from "../intake";
import { resetDemo } from "../reset";

// Organizations (docs/design/AUTH.md, "Keeping orgs apart"): the seed has two demo orgs. Demo org A ("Ukázková
// nemocnice A") holds the hackathon demo. Demo org B ("Ukázková nemocnice B") holds no patient data, only its
// departments and four people; the team puts its own test data there. Every screen works for that empty org, a doctor
// of org B sees none of org A's patients, cases, tasks, calendar, staff or access log, a link to an org A case leads
// nowhere, and a patient created in org B stays in org B. The fixture resets both orgs before every test.

const B_DOCTOR = "MUDr. Vlčková";
const B_COORD = "Bc. Holubová (koordinátorka MDT)";
const B_ADMIN = "Ing. Pospíšil (správce systému)";
const A_DOCTOR = "MUDr. Svobodová";
// Org A's patients, its people and a seeded task: none of them may show in org B.
const A_PATIENTS = ["Poláček Daniel", "Palajová Martina", "Křemínek Radovan"];
const A_PEOPLE = ["MUDr. Svobodová", "Bc. Marková"];
// The patient the S02 intake creates (samples/S02_pacient); org A's seed does not hold it either.
const S02_NAME = "Lipenská Věra";

// The grouping itself (one optgroup per org) is checked by app/test/picker.test.ts: a closed select does not expose its
// groups to the accessibility tree the suite reads.
test("the picker offers the demo users of both orgs", async ({ app }) => {
  await app.open();
  for (const label of [B_DOCTOR, "MUDr. Zeman", B_COORD, B_ADMIN])
    await expect(app.userPicker.getByRole("option", { name: label, exact: true })).toHaveCount(1);
});

test("an org B doctor sees an empty patient list, and an org A case link leads back to it", async ({ app }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await app.nav("Databáze pacientů").click();
  await expect(app.main.getByText("Zatím žádný pacient.", { exact: true })).toBeVisible();
  for (const name of A_PATIENTS) await expect(app.patientRow(name)).toHaveCount(0);
  await expect(app.main.getByRole("button", { name: "+ Nový pacient" })).toBeVisible();

  // Org A's case 10 by its address: not there for org B, so the page goes back to the list.
  await app.open("patient/10/overview");
  await expect(app.main.getByText("Zatím žádný pacient.", { exact: true })).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček/ })).toHaveCount(0);
});

test("an org B doctor's calendar has free slots and none of org A's bookings", async ({ app }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await app.nav("Kalendář MDT").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
  // A free slot at a time org A books shows that the calendar rendered with org B's (empty) bookings.
  await expect(app.main.getByRole("button", { name: "Volný termín 14:00", exact: true }).first()).toBeVisible();
  for (const name of A_PATIENTS) await expect(app.main.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
});

test("org B's coordinator has no tasks, and none of org A's", async ({ app }) => {
  await app.open();
  await app.loginAs(B_COORD);
  await app.nav(/^Moje úlohy/).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await app.main.getByRole("button", { name: "Všechny", exact: true }).click();
  // Rendered first, so the absence check below cannot pass on a list still loading.
  await expect(app.main.getByText(/^(0 otevřených|Žádné otevřené úlohy\.)$|^Zatím žádné úlohy\./).first()).toBeVisible();
  // Org A's seeded task for its coordinator.
  await expect(app.main.getByText("doplnit pooperační MR do podkladů")).toHaveCount(0);
});

test("org B's staff screen lists org B's departments and people only", async ({ app }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await app.nav("Personál").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Personál pracoviště" })).toBeVisible();
  await expect(app.main.getByText("Onkologie", { exact: true }).first()).toBeVisible();
  await expect(app.main.getByText("Radiologie", { exact: true }).first()).toBeVisible();
  await expect(app.main.getByText(/Vlčková/).first()).toBeVisible();
  await expect(app.main.getByText(/Zeman/).first()).toBeVisible();
  for (const name of ["Svobodová", "Marková", "Neurochirurgie"]) await expect(app.main.getByText(name, { exact: false })).toHaveCount(0);
});

test("org B's administrator opens Administrace with org B's access log only", async ({ app }) => {
  await app.open();
  // An org A doctor opens a case, so org A's log has a case view org B must not show.
  await app.openPatient("Poláček Daniel");
  await app.loginAs(B_ADMIN);
  await app.nav("Administrace").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Administrace" })).toBeVisible();
  const log = app.main.getByRole("table");
  await expect(log.getByRole("row").filter({ hasText: "zobrazil(a) záznam přístupů" }).first()).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "NO-010" })).toHaveCount(0);
  for (const name of A_PEOPLE) await expect(log.getByText(name, { exact: false })).toHaveCount(0);
});

test("a patient created in org B stays in org B, and org B's reset empties it again", async ({ app, page, baseURL }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await createS02(app);
  await app.nav("Databáze pacientů").click();
  await expect(app.patientRow(S02_NAME)).toHaveCount(1);
  for (const name of A_PATIENTS) await expect(app.patientRow(name)).toHaveCount(0);

  // Org A's doctor: org A's list without the new patient.
  await app.loginAs(A_DOCTOR);
  await app.nav("Databáze pacientů").click();
  await expect(app.patientRow("Poláček Daniel")).toHaveCount(1);
  await expect(app.patientRow(S02_NAME)).toHaveCount(0);

  // Org B's reset removes the patient with its uploaded documents and prepared data: org B is empty again.
  await resetDemo(baseURL!, "b-admin");
  await page.reload();
  await app.loginAs(B_DOCTOR);
  await app.nav("Databáze pacientů").click();
  await expect(app.main.getByText("Zatím žádný pacient.", { exact: true })).toBeVisible();
});
