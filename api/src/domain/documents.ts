// Uploads (step 6, slice a-1): what a file must be before it is stored, how a registered fixture's patient is compared
// with the case's patient, and the Czech labels of a document's state. Pure: the route reads the body, the registry and
// the case, and passes them in.
import { DomainError, type DomainStatus } from "./errors";

// The shared demo stores only known synthetic files (decision 2026-10-17): once a file is stored it would be data
// without clearance in a database everyone can read. The other policies are for team staging and local work.
export type UploadPolicy = "fixtures_only" | "store_unprocessed";
export const uploadPolicy = (v: string | undefined): UploadPolicy => (v === "store_unprocessed" ? "store_unprocessed" : "fixtures_only");

// The page promises 20 MB; per case, 40 documents is far above any referral we have seen.
export const MAX_DOCUMENTS_PER_CASE = 40;

const u = (status: DomainStatus, code: string, msg: string) => () => new DomainError(status, code, msg);

export const UP = {
  notFixture: u(
    422,
    "upload_not_fixture",
    "Ve sdílené ukázce lze nahrát jen připravené syntetické dokumenty (např. ze složky samples/S02_pacient/upload). Jiný soubor se neuložil, protože by šlo o data bez souhlasu s jejich zpracováním.",
  ),
  tooLarge: u(413, "too_large", "Soubor je větší než 20 MB."),
  empty: u(422, "empty_file", "Soubor je prázdný."),
  lengthRequired: u(411, "length_required", "Chybí velikost souboru (Content-Length)."),
  zip: u(415, "type_not_allowed", "ZIP rozbalte a nahrajte jednotlivé PDF."),
  notPdf: u(415, "type_not_allowed", "Nahrát lze jen PDF. Jiné formáty (Word, obrázky) zatím server nepřijímá."),
  duplicate: u(409, "duplicate", "Tento dokument už je u případu nahraný."),
  nameTaken: u(409, "name_taken", "Soubor se stejným názvem už je u případu nahraný; přejmenujte ho."),
  locked: u(409, "case_locked", "Případ je uzavřený nebo má schválený závěr, nahrávání je uzamčeno."),
  tooMany: u(409, "too_many_documents", `Případ má už ${MAX_DOCUMENTS_PER_CASE} dokumentů, další nelze nahrát.`),
  notFound: u(404, "document_not_found", "Dokument nebyl nalezen."),
  notRemovable: u(409, "document_not_removable", "Odebrat lze jen nahraný dokument, který se zatím nezpracoval."),
  badName: u(422, "invalid_input", "Chybí název souboru (X-File-Name)."),
};

// PDF by its bytes, never by the header or the extension. The PDF standard lets the header start within the first
// 1024 bytes, which some generators use.
export function fileKind(head: Uint8Array): "pdf" | "zip" | "other" {
  const s = new TextDecoder("latin1").decode(head.subarray(0, 1024));
  if (s.startsWith("PK\u0003\u0004")) return "zip";
  return s.includes("%PDF-") ? "pdf" : "other";
}

// The browser sends the name RFC 5987 encoded (encodeURIComponent). Only the base name is kept, without control
// characters; it is display data and never goes to the access log.
export function fileNameOf(header: string | undefined): string {
  let s = header ?? "";
  try {
    s = decodeURIComponent(s.replace(/^UTF-8''/i, ""));
  } catch {
    /* an undecodable name is shown as it came */
  }
  s = s.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  if (!s) throw UP.badName();
  return s;
}

export type Person = { full_name: string; name_as_written?: string | null; birth_number: string | null };
export type Identity = "matches" | "conflicts" | "cannot_verify";

// Names compare without case and order ("Lipenská Věra" is "Věra Lipenská"), with diacritics kept: two different people
// may differ only in them. The same rule as intakeOf() in the page.
export const nameKey = (n: string | null | undefined) =>
  String(n ?? "").toLocaleLowerCase("cs").split(/\s+/).filter(Boolean).sort().join(" ");
const rcKey = (rc: string | null | undefined) => String(rc ?? "").replace(/\D/g, "");

// The registry's patient of a fixture against the case's patient. A conflict is a different birth number or a different
// name where both are known; it is shown as an always-on alert and never resolved by the assistant.
export function compareIdentity(fixture: Person, patient: Person): Identity {
  const fr = rcKey(fixture.birth_number), pr = rcKey(patient.birth_number);
  const fn = nameKey(fixture.full_name);
  const pn = [nameKey(patient.full_name), nameKey(patient.name_as_written)].filter(Boolean);
  const rcKnown = !!fr && !!pr;
  const nameKnown = !!fn && pn.length > 0;
  if ((rcKnown && fr !== pr) || (nameKnown && !pn.includes(fn))) return "conflicts";
  return rcKnown || nameKnown ? "matches" : "cannot_verify";
}

export const IDENTITY_ALERT_CS = "Dokument patří jinému pacientovi: jméno nebo rodné číslo se neshoduje.";

export const STATE_CS: Record<string, string> = {
  stored: "nezpracováno",
  prepared: "připraveno předem (ukázková data)",
  queued: "zpracovává se",
  processing: "zpracovává se",
  processed: "zpracováno",
  failed: "zpracování selhalo",
};

// What the access log keeps of an upload: size and the start of the hash, never the name or the content.
export const sizeCs = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);
export const uploadLine = (size: number, sha: string) => `nahrál(a) dokument k případu (PDF, ${sizeCs(size)}, otisk ${sha.slice(0, 12)})`;
