import { test, expect } from "../fixtures";

// Organizations (docs/design/AUTH.md, "Keeping orgs apart"): the seed has two demo orgs. Demo org A ("Ukázková
// nemocnice A") holds the hackathon demo, demo org B ("Ukázková nemocnice B") one synthetic patient of its own. A doctor
// of org B sees none of org A's patients, cases, tasks or calendar, and a link to an org A case leads nowhere.

const B_DOCTOR = "MUDr. Vlčková";
const B_COORD = "Bc. Holubová (koordinátorka MDT)";
const B_PATIENT = "Křemínek Radovan";
// Patients only org A has; org A also has Křemínek, under its own record.
const A_ONLY = ["Poláček Daniel", "Palajová Martina"];

// The grouping itself (one optgroup per org) is checked by app/test/picker.test.ts: a closed select does not expose its
// groups to the accessibility tree the suite reads.
test("the picker offers the demo users of both orgs", async ({ app }) => {
  await app.open();
  for (const label of [B_DOCTOR, "MUDr. Zeman", B_COORD, "Ing. Pospíšil (správce systému)"])
    await expect(app.userPicker.getByRole("option", { name: label, exact: true })).toHaveCount(1);
});

test("an org B doctor sees only org B's patient, and an org A case link leads back to the list", async ({ app }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await app.nav("Databáze pacientů").click();
  await expect(app.patientRow(B_PATIENT)).toHaveCount(1);
  await expect(app.patientRows()).toHaveCount(1);
  for (const name of A_ONLY) await expect(app.patientRow(name)).toHaveCount(0);

  // Org A's case 10 by its address: not there for org B, so the page goes back to the list.
  await app.open("patient/10/overview");
  await expect(app.patientRow(B_PATIENT)).toBeVisible();
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček/ })).toHaveCount(0);

  // Org B's own case opens.
  await app.openPatient(B_PATIENT);
});

test("an org B doctor's calendar holds org B's booking at the time org A also uses", async ({ app }) => {
  await app.open();
  await app.loginAs(B_DOCTOR);
  await app.nav("Kalendář MDT").click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Kalendář MDT" })).toBeVisible();
  await expect(app.main.getByRole("button", { name: new RegExp(`^${B_PATIENT}, .*14:00$`) })).toBeVisible();
  for (const name of A_ONLY) await expect(app.main.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
});

test("org B's coordinator has none of org A's tasks", async ({ app }) => {
  await app.open();
  await app.loginAs(B_COORD);
  await app.nav(/^Moje úlohy/).click();
  await expect(app.main.getByRole("heading", { level: 1, name: "Moje úlohy" })).toBeVisible();
  await app.main.getByRole("button", { name: "Všechny", exact: true }).click();
  // Rendered first, so the absence check below cannot pass on a list still loading.
  await expect(app.main.getByText(/^(0 otevřených|Žádné otevřené úlohy\.)$/).first()).toBeVisible();
  // Org A's seeded task for its coordinator.
  await expect(app.main.getByText("doplnit pooperační MR do podkladů")).toHaveCount(0);
});
