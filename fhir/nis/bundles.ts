// Synthetic NIS test data: FHIR R4 transaction Bundles for the local test server (fhir/nis/README.md). NIS is the
// hospital information system; these Bundles stand for what FNO's NIS would answer over FHIR, so the connector and the
// patient match can be built and tested without a hospital.
//
// Built from committed synthetic data only (fixtures/data, samples/, data/rakathon-26), never from private/. Values,
// units, reference ranges and dates are the ones the documents state; where a document states nothing, the resource
// leaves the element out instead of guessing (case 10's lab sheet has no draw date, so its Observations have none).
//
// Test-only identity: S01's and case 10's documents print no birth number, and the failure patients F01-F04 exist
// only here, so their birth numbers (TEST_ONLY_BIRTH_NUMBERS) are invented for the test server. A real NIS holds one
// for every patient; the app's own patient rows keep NULL where the documents state none.
//
// Node only (the build CLI and api/vitest.config.ts run it); the test server itself (memory-server.ts) is runtime
// neutral and receives these Bundles as JSON.
import { createHash } from "node:crypto";

type R = Record<string, any>;
export type Bundle = { resourceType: "Bundle"; type: "transaction"; entry: { fullUrl: string; resource: R; request: { method: "PUT"; url: string } }[] };

export const SYS = {
  rcis: "https://ncez.mzcr.cz/fhir/sid/rcis",
  kp: "https://ncez.mzcr.cz/fhir/sid/kp",
  mkn10: "https://uzis.cz/terminology/CodeSystem/mkn-10",
  // FNO's own lab codes (S_CREAE, B_PLT), as the challenge data prints them; a placeholder URI until FNO names its code
  // list. NČLP codes would come from FNO's lab system; the documents give none, so none are invented here.
  lab: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/CodeSystem/fno-local-lab-code",
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category",
  condCat: "http://terminology.hl7.org/CodeSystem/condition-category",
  condClin: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  condVer: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  interp: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  v2_0074: "http://terminology.hl7.org/CodeSystem/v2-0074",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  linkType: "http://hl7.org/fhir/link-type",
};

// The base the fullUrls name. A transaction with PUT keeps these ids on HAPI and on the in-memory server alike.
const BASE = "http://nis.test/fhir";

// Invented for the test server only (see the header). Valid in form (10 digits, divisible by 11; women's month + 50).
export const TEST_ONLY_BIRTH_NUMBERS: Record<string, string> = {
  "cb-s01": "640312/3001",
  "cb-c10": "610518/3007",
  "cb-f01-a": "720905/3005",
  "cb-f02": "785203/3002",
  "cb-f03": "670114/3009",
  "cb-f04": "805822/3008",
};

export type Fixtures = {
  case10: R; // fixtures/data/mock-case-10.json
  s01: R; // fixtures/data/mock-case-S01.json
  s02: R; // fixtures/data/mock-case-S02.json
  s02Referral: R; // samples/S02_pacient/upload/zadost-fhir.json
  // The PDF bytes for a DocumentReference; null leaves the Binary out (the tests do not need the bytes).
  pdf: (path: string) => Uint8Array | null;
};

// Central European time as the documents give it (local wall clock); the offset follows the EU summer-time rule
// (last Sunday of March to last Sunday of October), so "6.10.2026 07:30" is +02:00 and "8.1.2026 07:40" +01:00.
function lastSunday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0));
  return d.getUTCDate() - d.getUTCDay();
}
export function pragueDateTime(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const summer = (m > 3 && m < 10) || (m === 3 && d >= lastSunday(y, 2)) || (m === 10 && d < lastSunday(y, 9));
  return `${date}T${time}:00${summer ? "+02:00" : "+01:00"}`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// "4,130" as the sheet prints it; the number for valueQuantity. The written form stays in a note.
const num = (s: string) => Number(String(s).replace(",", "."));

class Builder {
  entries: Bundle["entry"] = [];
  add(r: R): string {
    const ref = `${r.resourceType}/${r.id}`;
    if (!/^[A-Za-z0-9\-.]{1,64}$/.test(r.id)) throw new Error(`bad id ${r.id}`);
    if (this.entries.some((e) => `${e.resource.resourceType}/${e.resource.id}` === ref)) throw new Error(`duplicate ${ref}`);
    this.entries.push({ fullUrl: `${BASE}/${ref}`, resource: r, request: { method: "PUT", url: ref } });
    return ref;
  }
  bundle(): Bundle {
    return { resourceType: "Bundle", type: "transaction", entry: this.entries };
  }
}

const cc = (text: string, coding?: R[]) => (coding ? { coding, text } : { text });
const ref = (r: string, display?: string) => (display ? { reference: r, display } : { reference: r });

function patient(b: Builder, id: string, o: { family: string; given: string[]; gender: "male" | "female"; birthDate?: string; rc: string; extra?: R }) {
  return b.add({
    resourceType: "Patient",
    id,
    identifier: [{ system: SYS.rcis, value: o.rc }],
    active: true,
    name: [{ use: "official", family: o.family, given: o.given }],
    gender: o.gender,
    ...(o.birthDate ? { birthDate: o.birthDate } : {}),
    ...(o.extra ?? {}),
  });
}

function insurer(b: Builder) {
  const id = "cb-org-vzp";
  if (!b.entries.some((e) => e.resource.id === id))
    b.add({ resourceType: "Organization", id, identifier: [{ system: SYS.kp, value: "111" }], name: "Všeobecná zdravotní pojišťovna ČR" });
  return `Organization/${id}`;
}

function coverage(b: Builder, p: string, pt: string) {
  return b.add({ resourceType: "Coverage", id: `${p}-cov`, status: "active", beneficiary: ref(pt), payor: [ref(insurer(b))] });
}

function dept(b: Builder, id: string, name: string) {
  return b.add({ resourceType: "Organization", id, name });
}

function practitionerRole(b: Builder, id: string, prefix: string, given: string, family: string, org: string) {
  const pr = b.add({ resourceType: "Practitioner", id: `${id}-pr`, name: [{ prefix: [prefix], given: [given], family }] });
  return b.add({ resourceType: "PractitionerRole", id, practitioner: ref(pr), organization: ref(org) });
}

function condition(b: Builder, id: string, pt: string, o: { code: string; display: string; onset?: string; confirmed?: boolean; note?: string }) {
  return b.add({
    resourceType: "Condition",
    id,
    clinicalStatus: cc("aktivní", [{ system: SYS.condClin, code: "active" }]),
    verificationStatus: cc(o.confirmed ? "potvrzeno" : "nepotvrzeno", [{ system: SYS.condVer, code: o.confirmed ? "confirmed" : "unconfirmed" }]),
    category: [cc("diagnóza", [{ system: SYS.condCat, code: "encounter-diagnosis" }])],
    // MKN-10 codes without the dot ("C711", as ÚZIS's code system writes them; the documents print "C71.1"). The
    // document's wording goes to text, not to display: display must be ÚZIS's own name, which the documents do not use.
    code: cc(o.display, [{ system: SYS.mkn10, code: o.code }]),
    subject: ref(pt),
    ...(o.onset ? { onsetDateTime: o.onset } : {}),
    ...(o.note ? { note: [{ text: o.note }] } : {}),
  });
}

// A TNM statement as the report writes it. The kind (clinical before treatment, pathological, after neoadjuvance)
// is in code.text, so a consumer compares like with like (CLAUDE.md: a cTNM and a ypTNM are not a contradiction).
function stage(b: Builder, id: string, pt: string, o: { kind: "clinical" | "pathological" | "post_neoadjuvant"; value: string; date: string; status?: string }) {
  const label = { clinical: "Klinické stadium TNM (cTNM)", pathological: "Patologické stadium TNM (pTNM)", post_neoadjuvant: "Stadium po neoadjuvanci (ypTNM)" }[o.kind];
  return b.add({
    resourceType: "Observation",
    id,
    status: o.status ?? "final",
    category: [cc("vyšetření", [{ system: SYS.obsCat, code: "exam" }])],
    code: cc(label),
    subject: ref(pt),
    effectiveDateTime: o.date,
    valueString: o.value,
  });
}

function procedure(b: Builder, id: string, pt: string, text: string, when: { date?: string; start?: string; end?: string }, status = "completed") {
  return b.add({
    resourceType: "Procedure",
    id,
    status,
    code: cc(text),
    subject: ref(pt),
    ...(when.date ? { performedDateTime: when.date } : {}),
    ...(when.start ? { performedPeriod: { start: when.start, ...(when.end ? { end: when.end } : {}) } } : {}),
  });
}

// Medication as written; no ATC or SÚKL code, because the documents give none.
function med(b: Builder, id: string, pt: string, text: string, dosage: string, o: { status: "active" | "completed" | "stopped" | "unknown"; start?: string; end?: string }) {
  return b.add({
    resourceType: "MedicationStatement",
    id,
    status: o.status,
    medicationCodeableConcept: cc(text),
    subject: ref(pt),
    ...(o.start ? { effectivePeriod: { start: o.start, ...(o.end ? { end: o.end } : {}) } } : {}),
    dosage: [{ text: dosage }],
  });
}

function encounter(b: Builder, id: string, pt: string, date: string, org: string, text: string) {
  return b.add({
    resourceType: "Encounter",
    id,
    status: "finished",
    class: { system: SYS.actCode, code: "AMB", display: "ambulatory" },
    type: [cc(text)],
    subject: ref(pt),
    period: { start: date, end: date },
    serviceProvider: ref(org),
  });
}

function serviceRequest(b: Builder, id: string, pt: string, o: { text: string; authoredOn: string; requester?: string; reason?: string; note?: string; status?: string }) {
  return b.add({
    resourceType: "ServiceRequest",
    id,
    status: o.status ?? "active",
    intent: "order",
    code: cc(o.text),
    subject: ref(pt),
    authoredOn: o.authoredOn,
    ...(o.requester ? { requester: ref(o.requester) } : {}),
    ...(o.reason ? { reasonCode: [cc(o.reason)] } : {}),
    ...(o.note ? { note: [{ text: o.note }] } : {}),
  });
}

function report(b: Builder, id: string, pt: string, o: { cat: "LAB" | "PAT" | "RAD"; text: string; date?: string; result?: string[]; conclusion?: string; basedOn?: string; status?: string }) {
  const catName = { LAB: "laboratoř", PAT: "patologie", RAD: "radiologie" }[o.cat];
  return b.add({
    resourceType: "DiagnosticReport",
    id,
    status: o.status ?? "final",
    category: [cc(catName, [{ system: SYS.v2_0074, code: o.cat }])],
    code: cc(o.text),
    subject: ref(pt),
    ...(o.basedOn ? { basedOn: [ref(o.basedOn)] } : {}),
    ...(o.date ? { effectiveDateTime: o.date } : {}),
    ...(o.result ? { result: o.result.map((r) => ref(r)) } : {}),
    ...(o.conclusion ? { conclusion: o.conclusion } : {}),
  });
}

type LabPoint = { code: string; name: string; value: string; unit: string; range: string; low?: number; high?: number; flag?: "high" | "low" | null; date?: string };

function labObs(b: Builder, id: string, pt: string, x: LabPoint) {
  const q = (v: number) => ({ value: v, unit: x.unit });
  return b.add({
    resourceType: "Observation",
    id,
    status: "final",
    category: [cc("laboratoř", [{ system: SYS.obsCat, code: "laboratory" }])],
    code: cc(x.name, [{ system: SYS.lab, code: x.code }]),
    subject: ref(pt),
    ...(x.date ? { effectiveDateTime: x.date } : {}),
    valueQuantity: { value: num(x.value), unit: x.unit },
    // The document's own H/L mark only; a range comparison by us would be an inference, not a NIS fact.
    ...(x.flag ? { interpretation: [cc(x.flag === "high" ? "vysoká" : "nízká", [{ system: SYS.interp, code: x.flag === "high" ? "H" : "L" }])] } : {}),
    referenceRange: [{ ...(x.low !== undefined ? { low: q(x.low) } : {}), ...(x.high !== undefined ? { high: q(x.high) } : {}), text: x.range }],
    note: [{ text: `Hodnota jak je zapsána: ${x.value} ${x.unit} [${x.range}]` }],
  });
}

// One lab panel per draw from a fixture's labs_series: an Observation per test and a DiagnosticReport that groups them.
function labSeries(b: Builder, p: string, pt: string, series: R) {
  series.draws.forEach((d: R, i: number) => {
    const when = pragueDateTime(d.date, d.time);
    const results: string[] = [];
    for (const t of series.tests) {
      const pnt = t.points[i];
      if (!pnt) continue;
      results.push(
        labObs(b, `${p}-lab-${d.date}-${slug(t.code)}`, pt, {
          code: t.code, name: t.name_cs, value: pnt.value, unit: t.unit, range: t.reference_range, low: t.reference_low ?? undefined, high: t.reference_high ?? undefined,
          flag: pnt.flagged_in_document ? pnt.out_of_range : null, date: when,
        }),
      );
    }
    report(b, `${p}-labrep-${d.date}`, pt, { cat: "LAB", text: "Laboratorní vyšetření (KO, biochemie)", date: when, result: results });
  });
}

function sha1b64(bytes: Uint8Array) {
  return createHash("sha1").update(bytes).digest("base64");
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// A document and its file. Without the bytes (tests), the DocumentReference still names a Binary that is not there,
// which is what a NIS answers for a file it cannot serve; the connector must cope with that too.
function document(b: Builder, id: string, pt: string, o: { title: string; date: string; type: string; file?: Uint8Array | null; contentType?: string; status?: string; relatesTo?: R[]; text?: string }) {
  const binId = `${id}-bin`;
  const ct = o.contentType ?? "application/pdf";
  const bytes = o.file ?? (o.text !== undefined ? new TextEncoder().encode(o.text) : null);
  if (bytes) b.add({ resourceType: "Binary", id: binId, contentType: ct, data: b64(bytes) });
  return b.add({
    resourceType: "DocumentReference",
    id,
    status: o.status ?? "current",
    type: cc(o.type),
    subject: ref(pt),
    // The document's own date goes to context.period: DocumentReference.date is an instant (with a time), and the
    // documents give a day only, so no time is invented.
    context: { period: { start: o.date } },
    description: o.title,
    ...(o.relatesTo ? { relatesTo: o.relatesTo } : {}),
    content: [{ attachment: { contentType: ct, url: `Binary/${binId}`, title: o.title, ...(bytes ? { size: bytes.length, hash: sha1b64(bytes) } : {}) } }],
  });
}

function s01(f: Fixtures): Bundle {
  const b = new Builder();
  const p = "cb-s01";
  const pt = patient(b, p, { family: "Křemínek", given: ["Radovan"], gender: "male", birthDate: "1964-03-12", rc: TEST_ONLY_BIRTH_NUMBERS[p]! });
  coverage(b, p, pt);
  const onko = dept(b, "cb-org-onko-neuro", "Onkologická ambulance - neuroonkologie");
  const doc = practitionerRole(b, "cb-role-modrinova", "MUDr.", "Hana", "Modřínová", onko);
  condition(b, `${p}-dg-c711`, pt, { code: "C711", display: "Zhoubný novotvar čelního laloku", onset: "2025-12", confirmed: true, note: "Glioblastom vlevo frontálně, IDH-wildtype, CNS WHO gr. 4, MGMT metylován" });
  condition(b, `${p}-dg-i802`, pt, { code: "I802", display: "Flebitida a tromboflebitida jiných hlubokých cév dolních končetin", onset: "2026-02-24", confirmed: true });
  procedure(b, `${p}-op-2025-12-02`, pt, "Subtotální resekce tumoru vlevo frontálně", { date: "2025-12-02" });
  procedure(b, `${p}-rt-2026-01`, pt, "Konkomitantní chemoradioterapie, RT 60 Gy/30 fr.", { start: "2026-01-12", end: "2026-02-20" });
  // The MRI of 29.9.2026 happened (the report quotes it "popis z NIS") but its report is not in the documents: the
  // failure case "an examination that happened but whose report is missing".
  procedure(b, `${p}-mr-2026-09-29`, pt, "MR mozku", { date: "2026-09-29" });
  med(b, `${p}-med-tmz-konk`, pt, "Temozolomid", "75 mg/m2 denně během RT", { status: "completed", start: "2026-01-12", end: "2026-02-20" });
  med(b, `${p}-med-tmz-adj`, pt, "Temozolomid", "adjuvantně 6 cyklů, od 3. cyklu 150 mg/m2 (300 mg D1-5)", { status: "completed", start: "2026-03-23", end: "2026-08-21" });
  med(b, `${p}-med-enox`, pt, "Enoxaparin", "80 mg s.c. á 12 hod.", { status: "active", start: "2026-02-24" });
  med(b, `${p}-med-dexa`, pt, "Dexamethason", "4 mg 1-0-0", { status: "active", start: "2026-07-15" });
  med(b, `${p}-med-metf`, pt, "Metformin", "500 mg 1-0-1", { status: "active", start: "2026-08-04" });
  med(b, `${p}-med-lev`, pt, "Levetiracetam", "500 mg 1-0-1", { status: "active" });
  encounter(b, `${p}-enc-2026-01-08`, pt, "2026-01-08", onko, "Ambulantní vyšetření vstupní");
  encounter(b, `${p}-enc-2026-10-06`, pt, "2026-10-06", onko, "Ambulantní vyšetření kontrolní");
  // Requested 1.10.2026, "t.č. výsledek nemáme": a sent request is not a done exam.
  serviceRequest(b, `${p}-sr-petct`, pt, { text: "PET/CT s 18F-FET", authoredOn: "2026-10-01", requester: doc });
  serviceRequest(b, `${p}-sr-mdt`, pt, {
    text: "Projednání na neuroonkologickém semináři", authoredOn: "2026-10-06", requester: doc,
    reason: "Je u progrese GBM indikována reresekce, případně reiradiace, nebo systémová léčba 2. linie (lomustin)? Prosím též o doporučení k další antikoagulaci (enoxaparin v plné dávce) vzhledem k trombocytopenii a klesající eGFR.",
  });
  labSeries(b, p, pt, f.s01.labs_series);
  document(b, `${p}-doc-all`, pt, { title: "Dokumentace pacienta (souhrnné PDF)", type: "souhrnná dokumentace", date: "2026-10-06", file: f.pdf("samples/S01_pacient/S01_pacient.pdf") });
  return b.bundle();
}

function s02(f: Fixtures): Bundle {
  const b = new Builder();
  const p = "cb-s02";
  // The referral's identity, so the NIS record and the referral agree (S02 is the "Nový pacient" demo patient).
  const refPt = (f.s02Referral.entry as R[]).find((e) => e.resource.resourceType === "Patient")!.resource;
  const rc = refPt.identifier.find((i: R) => i.system === SYS.rcis).value;
  const pt = patient(b, p, { family: refPt.name[0].family, given: refPt.name[0].given, gender: refPt.gender, birthDate: refPt.birthDate, rc });
  coverage(b, p, pt);
  const chir = dept(b, "cb-org-chir-kolo", "Chirurgická ambulance - koloproktologická poradna");
  const pat = dept(b, "cb-org-patologie", "Ústav patologie");
  const doc = practitionerRole(b, "cb-role-habrman", "MUDr.", "Ondřej", "Habrman", chir);
  practitionerRole(b, "cb-role-rosicky", "MUDr.", "Kamil", "Rosický", pat);
  condition(b, `${p}-dg-c20`, pt, { code: "C20", display: "Zhoubný novotvar konečníku", onset: "2026-03", confirmed: true, note: "Adenokarcinom rekta, G2, pMMR" });
  condition(b, `${p}-dg-z932`, pt, { code: "Z932", display: "Ileostomie", onset: "2026-08-11", confirmed: true });
  // Two stages of different kinds and times: not a contradiction. Each sits in the report it comes from
  // (DiagnosticReport.result), the way a NIS links a finding to its report.
  const stC = stage(b, `${p}-stage-c`, pt, { kind: "clinical", value: "cT3b cN1 cM0", date: "2026-03-17" });
  const stYp = stage(b, `${p}-stage-yp`, pt, { kind: "post_neoadjuvant", value: "ypT2 ypN0 (0/14), R0", date: "2026-08-21" });
  report(b, `${p}-rad-mr-2026-03-16`, pt, { cat: "RAD", text: "MR pánve", date: "2026-03-16", result: [stC], conclusion: "Tumor rekta s šířením do mezorekta 7 mm za muscularis propria, 2 suspektní mezorektální uzliny, MRF negativní, EMVI negativní, závěr cT3b cN1." });
  report(b, `${p}-rad-ct-2026-03-17`, pt, { cat: "RAD", text: "CT hrudníku a břicha", date: "2026-03-17", conclusion: "Bez známek vzdálených metastáz." });
  report(b, `${p}-rad-mr-2026-07-20`, pt, { cat: "RAD", text: "MR pánve", date: "2026-07-20", conclusion: "Regrese tumoru, reziduální ztluštění stěny rekta, bez suspektních uzlin, MRF negativní." });
  // effectiveDateTime is the day the sample was taken ("Odběr"); the documents give the issue day without a time,
  // and DiagnosticReport.issued needs one, so it is left out.
  report(b, `${p}-pat-2026-03-12`, pt, { cat: "PAT", text: "Bioptický histologický nález - biopsie tumoru rekta", date: "2026-03-09", conclusion: "Adenokarcinom rekta, G2 (středně diferencovaný, low grade dle WHO 2019), pMMR. Hloubku invaze nelze v bioptickém vzorku hodnotit." });
  report(b, `${p}-pat-2026-08-21`, pt, { cat: "PAT", text: "Bioptický histologický nález - resekát rekta po neoadjuvanci", date: "2026-08-11", result: [stYp], conclusion: "Reziduální adenokarcinom rekta po neoadjuvantní CHRT, G2, TRG 2. ypT2 ypN0 (0/14), L0 V0 Pn0, R0 (TNM 8. vydání)." });
  procedure(b, `${p}-kolo-2026-03-09`, pt, "Koloskopie s biopsií", { date: "2026-03-09" });
  procedure(b, `${p}-chrt-2026-04`, pt, "Neoadjuvantní chemoradioterapie, RT 50,4 Gy/28 fr.", { start: "2026-04-07", end: "2026-05-18" });
  procedure(b, `${p}-op-2026-08-11`, pt, "Nízká přední resekce rekta s TME, protektivní ileostomie", { date: "2026-08-11" });
  med(b, `${p}-med-cape`, pt, "Kapecitabin", "825 mg/m2 2x denně ve dnech RT", { status: "completed", start: "2026-04-07", end: "2026-05-18" });
  med(b, `${p}-med-peri`, pt, "Perindopril", "4 mg 1-0-0", { status: "active" });
  med(b, `${p}-med-levo`, pt, "Levothyroxin", "75 µg 1-0-0", { status: "active" });
  med(b, `${p}-med-lope`, pt, "Loperamid", "2 mg dle odvodu ze stomie", { status: "active" });
  med(b, `${p}-med-panto`, pt, "Pantoprazol", "20 mg 1-0-0", { status: "active" });
  encounter(b, `${p}-enc-2026-10-08`, pt, "2026-10-08", chir, "Ambulantní vyšetření kontrolní");
  // Requested 7.10.2026, "t.č. výsledek nemáme".
  serviceRequest(b, `${p}-sr-ct`, pt, { text: "CT hrudníku, břicha a pánve", authoredOn: "2026-10-07", requester: doc, reason: "Vzestup CEA" });
  const refSr = (f.s02Referral.entry as R[]).find((e) => e.resource.resourceType === "ServiceRequest")!.resource;
  serviceRequest(b, `${p}-sr-mdt`, pt, { text: "Projednání na MDT kolorektálního karcinomu", authoredOn: refSr.authoredOn, requester: doc, reason: refSr.reasonCode[0].text, note: refSr.note[0].text });
  labSeries(b, p, pt, f.s02.labs_series);
  for (const d of f.s02.documents as R[]) {
    const n = String(d.upload_name).replace(/\.pdf$/, "");
    document(b, `${p}-doc-${n.slice(0, 2)}`, pt, { title: d.title_cs, type: d.type, date: d.date, file: f.pdf(`samples/S02_pacient/upload/${d.upload_name}`) });
  }
  return b.bundle();
}

function case10(f: Fixtures): Bundle {
  const b = new Builder();
  const p = "cb-c10";
  // The documents give the name only (no birth date, no birth number); the birth date and number here are test-only.
  const pt = patient(b, p, { family: "Poláček", given: ["Daniel"], gender: "male", birthDate: "1961-05-18", rc: TEST_ONLY_BIRTH_NUMBERS[p]! });
  const dg = f.case10.diagnosis;
  condition(b, `${p}-dg-c64`, pt, { code: dg.code, display: dg.text_cs, onset: "2022-04", confirmed: true, note: "RCC lokálně pokročilý" });
  const stP = stage(b, `${p}-stage-p`, pt, { kind: "pathological", value: "pT2a pN1 M0", date: "2022-06-02" });
  report(b, `${p}-pat-2022-06-02`, pt, { cat: "PAT", text: "Histologie po nefrektomii vpravo", date: "2022-06-02", result: [stP], conclusion: "ccRCC G2, pT2a pN1 M0" });
  procedure(b, `${p}-op-2022-06-02`, pt, "Nefrektomie vpravo + retroperitoneální lymfadenektomie", { date: "2022-06-02" });
  procedure(b, `${p}-op-2022-10-25`, pt, "Exstirpace paraaortální LU", { date: "2022-10-25" });
  procedure(b, `${p}-port-2023-08-21`, pt, "Implantace venózního portu", { date: "2023-08-21" });
  med(b, `${p}-med-nivo-ipi`, pt, "Nivolumab + ipilimumab", "1. linie", { status: "completed", start: "2023-03-27", end: "2023-04-17" });
  med(b, `${p}-med-nivo`, pt, "Nivolumab", "udržovací", { status: "completed", start: "2023-06-27", end: "2025-12-29" });
  med(b, `${p}-med-suni`, pt, "Sunitinib", "2. linie, 50 mg režim 4/2, redukce na 37,5 mg a 25 mg", { status: "completed", start: "2026-01-27" });
  med(b, `${p}-med-evero`, pt, "Everolimus", "3. linie", { status: "active", start: "2026-09-03" });
  report(b, `${p}-rad-mr-2026-09-14`, pt, { cat: "RAD", text: "MR mozku", date: "2026-09-14", conclusion: "Solitární nodulus v pravé mozečkové hemisféře do 3 mm, susp. MTS." });
  // The lab sheet of 10_pacient.pdf prints no draw date, so neither the Observations nor the report get one.
  const results = (f.case10.labs as R[]).map((l) => {
    const [lo, hi] = String(l.reference_range).split("...").map((s) => Number(s.trim()));
    return labObs(b, `${p}-lab-${slug(l.code)}`, pt, { code: l.code, name: l.name_cs, value: l.value, unit: l.unit, range: l.reference_range, low: lo, high: hi, flag: null });
  });
  report(b, `${p}-labrep`, pt, { cat: "LAB", text: "Laboratorní vyšetření (KO, biochemie)", result: results });
  document(b, `${p}-doc-all`, pt, { title: "Dokumentace pacienta (souhrnné PDF)", type: "souhrnná dokumentace", date: "2026-10-09", file: f.pdf("data/rakathon-26/2_AI asistent MDT/10_pacient.pdf") });
  return b.bundle();
}

// The failure cases CLAUDE.md names, each on its own test patient so the demo patients stay as their documents are.
function failures(): Bundle {
  const b = new Builder();
  // F01: duplicate records for one birth number. b was merged into a by the NIS (link replaced-by / replaces); c is a
  // second, unmerged record with the name typed without diacritics. The app must show all three and merge none.
  const rc1 = TEST_ONLY_BIRTH_NUMBERS["cb-f01-a"]!;
  patient(b, "cb-f01-a", { family: "Zkušební", given: ["Jiří"], gender: "male", birthDate: "1972-09-05", rc: rc1, extra: { link: [{ other: ref("Patient/cb-f01-b"), type: "replaces" }] } });
  b.add({
    resourceType: "Patient", id: "cb-f01-b", identifier: [{ system: SYS.rcis, value: rc1.replace("/", "") }], active: false,
    name: [{ use: "official", family: "Zkušební", given: ["Jiří"] }], gender: "male", birthDate: "1972-09-05",
    link: [{ other: ref("Patient/cb-f01-a"), type: "replaced-by" }],
  });
  patient(b, "cb-f01-c", { family: "Zkusebni", given: ["Jiri"], gender: "male", birthDate: "1972-09-05", rc: rc1 });
  // F02: an amended histology report. v2 replaces v1 (relatesTo replaces); v1 is superseded and says G2, v2 says G3.
  const f2 = patient(b, "cb-f02", { family: "Zkušební", given: ["Marta"], gender: "female", birthDate: "1978-02-03", rc: TEST_ONLY_BIRTH_NUMBERS["cb-f02"]! });
  const v1 = document(b, "cb-f02-doc-histo-v1", f2, { title: "Bioptický histologický nález (původní verze)", type: "histologie", date: "2026-04-02", status: "superseded", contentType: "text/plain", text: "Závěr: invazivní duktální karcinom prsu, G2." });
  document(b, "cb-f02-doc-histo-v2", f2, { title: "Bioptický histologický nález (opravená verze)", type: "histologie", date: "2026-04-06", contentType: "text/plain", text: "Dodatek: oprava gradingu. Závěr: invazivní duktální karcinom prsu, G3.", relatesTo: [{ code: "replaces", target: ref(v1) }] });
  // F03: two pathological stages of the same specimen and time that disagree: a real contradiction. The clinical
  // stage before surgery differs too, which is not one.
  const f3 = patient(b, "cb-f03", { family: "Testovací", given: ["Petr"], gender: "male", birthDate: "1967-01-14", rc: TEST_ONLY_BIRTH_NUMBERS["cb-f03"]! });
  condition(b, "cb-f03-dg-c18", f3, { code: "C187", display: "Zhoubný novotvar esovitého tračníku", onset: "2026-04", confirmed: true });
  stage(b, "cb-f03-stage-c", f3, { kind: "clinical", value: "cT4a cN1 cM0", date: "2026-04-10" });
  stage(b, "cb-f03-stage-p1", f3, { kind: "pathological", value: "pT3 pN0 (0/18)", date: "2026-05-04" });
  stage(b, "cb-f03-stage-p2", f3, { kind: "pathological", value: "pT4a pN1a (1/18)", date: "2026-05-04" });
  // F04: two requests; the MRI has its report, the PET/CT was sent and has none.
  const f4 = patient(b, "cb-f04", { family: "Testovací", given: ["Eva"], gender: "female", birthDate: "1980-08-22", rc: TEST_ONLY_BIRTH_NUMBERS["cb-f04"]! });
  const srMr = serviceRequest(b, "cb-f04-sr-mr", f4, { text: "MR mozku", authoredOn: "2026-09-01", status: "completed" });
  report(b, "cb-f04-rad-mr", f4, { cat: "RAD", text: "MR mozku", date: "2026-09-08", basedOn: srMr, conclusion: "Bez ložiskových změn." });
  serviceRequest(b, "cb-f04-sr-pet", f4, { text: "PET/CT", authoredOn: "2026-09-15" });
  return b.bundle();
}

export function buildBundles(f: Fixtures): Record<string, Bundle> {
  return { "s01": s01(f), "s02": s02(f), "case-10": case10(f), "failure-cases": failures() };
}
