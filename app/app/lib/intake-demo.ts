// The intake demo patient (synthetic patient S02, samples/S02_pacient): what the "Nový pacient" dialog needs to guide
// the presenter, read from the app's built-in data.
// - Its FHIR referral is the "Vložit ukázku" sample.
// - Its seven PDFs are the upload the server recognises by hash; the dialog counts the ones still missing.
// - The closing sentence names its page count and data gaps once the server says the prepared data will attach.
// The server stays the authority on whether the prepared record attaches (GET /cases/:id/intake); this only words the
// hints. Synthetic data only; it loads with the dialog, not with the app (test/intake-components.test.ts keeps it equal to
// fixtures/data/mock-case-S02.json).
export type IntakeDemo = {
  // The birth number and name of the synthetic patient, to recognise a referral for them.
  rc: string;
  name: string;
  // samples/<folder>/upload holds the files; /ukazka/<zip>-dokumenty.zip is the same files as a ZIP.
  folder: string;
  zip: string;
  uploads: string[];
  pages: number;
  gaps: number;
};

export const INTAKE_DEMO: IntakeDemo = {
  rc: "585614/4019",
  name: "Věra Lipenská",
  folder: "S02_pacient",
  zip: "S02",
  uploads: [
    "01-ambulantni-zprava-2026-10-08.pdf",
    "02-histologie-biopsie-2026-03-12.pdf",
    "03-histologie-resekat-2026-08-21.pdf",
    "04-laborator-2026-03-10.pdf",
    "05-laborator-2026-06-02.pdf",
    "06-laborator-2026-09-15.pdf",
    "07-laborator-2026-10-06.pdf",
  ],
  pages: 8,
  gaps: 4,
};

// The referral as the presenter pastes it: the committed synthetic FHIR Bundle, as text.
export async function fhirSampleText(): Promise<string> {
  const mod = await import("../../../samples/S02_pacient/upload/zadost-fhir.json");
  return JSON.stringify(mod.default, null, 2);
}

const rcKey = (v: string | null | undefined) => String(v || "").replace("/", "");
// The same name in either order, case-insensitive: the birth number alone must never join a differently named person to
// these documents (CLAUDE.md: never merge patients silently).
const nameKey = (v: string) => v.toLocaleLowerCase("cs").split(/\s+/).filter(Boolean).sort().join(" ");

export type IntakeHint = {
  demo: IntakeDemo;
  nameOk: boolean;
  // A patient with the demo's file is already in this user's list.
  exists: boolean;
  missing: string[];
  have: string[];
  ready: boolean;
};

// The hint for a referral and its uploaded file names; null when the referral is not for the demo patient.
export function intakeHint(form: { nf0: string; nf1: string; nf2: string }, fileNames: string[], listedFiles: string[], demo = INTAKE_DEMO): IntakeHint | null {
  const rc = rcKey(form.nf2.trim());
  if (!rc || rc !== rcKey(demo.rc)) return null;
  const names = new Set(fileNames);
  const nameOk = nameKey([form.nf0, form.nf1].join(" ")) === nameKey(demo.name);
  const exists = listedFiles.includes(`${demo.folder}.pdf`);
  const missing = demo.uploads.filter((u) => !names.has(u));
  return { demo, nameOk, exists, missing, have: demo.uploads.filter((u) => names.has(u)), ready: nameOk && !exists && !missing.length };
}
