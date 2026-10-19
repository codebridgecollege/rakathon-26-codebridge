// Uploads (step 6, slice a-1): which files are stored and which are only listed, how a registered fixture's patient is
// compared with the case's patient, and the Czech labels of a document's state. Pure: the route reads the body, the
// registry and the case, and passes them in.
import { DomainError, type DomainStatus } from "@codebridge/domain/errors";
import { LEGACY_ORG } from "./orgs";

// The shared demo stores the content of known synthetic files only (decision 2026-10-17): any other file would be data
// without clearance in a database everyone can read. Such a file is still accepted and listed, by its name, size,
// uploader and time, so the demo never refuses an upload (user decision 2026-10-18). store_unprocessed (team staging and
// local work) also stores unknown PDFs.
//
// Per org: UPLOAD_STORE_ORGS lists the orgs (comma-separated ids) whose uploads keep their content whatever
// UPLOAD_POLICY says. It is the team's switch for demo org B, where the team tests the pipeline on its own synthetic
// files; it stays empty on the deployed host until the team turns it on, because anyone with a demo account can act
// in org B and its demo reset wipes it. Demo org A is never listed: its demo shows unknown files as listed only.
export type UploadPolicy = "fixtures_only" | "store_unprocessed";
export const uploadPolicy = (v: string | undefined, org?: string, storeOrgs?: string): UploadPolicy => {
  const listed = String(storeOrgs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Demo org A is never switched on here, so one typo in the list cannot bring stored content into the live demo.
  if (org && org !== LEGACY_ORG && listed.includes(org)) return "store_unprocessed";
  return v === "store_unprocessed" ? "store_unprocessed" : "fixtures_only";
};

// The page promises 20 MB; per case, 40 documents is far above any referral we have seen.
export const MAX_DOCUMENTS_PER_CASE = 40;

const u = (status: DomainStatus, code: string, msg: string) => () => new DomainError(status, code, msg);

export const UP = {
  lengthRequired: u(411, "length_required", "Chybí velikost souboru (Content-Length)."),
  // Only when two uploads of the same file race; a plain repeat answers with the document already there.
  duplicate: u(409, "duplicate", "Tento dokument už je u případu nahraný."),
  locked: u(409, "case_locked", "Případ je uzavřený nebo má schválený závěr, nahrávání je uzamčeno."),
  tooMany: u(409, "too_many_documents", `Případ má už ${MAX_DOCUMENTS_PER_CASE} dokumentů, další nelze nahrát.`),
  notFound: u(404, "document_not_found", "Dokument nebyl nalezen."),
  notRemovable: u(409, "document_not_removable", "Odebrat lze jen nahraný dokument, který se zatím nezpracoval."),
  notWithdrawable: u(409, "document_not_withdrawable", "Odebrat z případu lze jen nahraný dokument, který k případu ještě patří."),
  badReason: u(422, "invalid_input", "Důvod odebrání musí být „wrong_patient“."),
  preparedNotYet: u(409, "document_prepared", "Dokument s předem připravenými daty zatím nelze odebrat; jeho údaje jsou v souhrnu případu."),
  badName: u(422, "invalid_input", "Chybí název souboru (X-File-Name)."),
};

// Whether the bytes are kept: a registered fixture always, an unknown PDF or a JPEG/PNG image (a phone photo of a
// page) only under store_unprocessed, anything else never. Office files (Word, ODT) stay listed only: converting them
// needs LibreOffice, which would make the page reader image several hundred MB larger; the doctor uploads a PDF
// instead. HEIC photos are not read either (PyMuPDF and Pillow cannot decode them without another library); phones
// send JPEG from a browser's file picker. A file that is not kept leaves only its listing row.
export function keepsContent(policy: UploadPolicy, kind: FileKind | null, fixture: { kind: string } | null): boolean {
  if (kind === "pdf" && fixture) return fixture.kind !== "referral";
  if (kind === "pdf" || kind === "image") return policy === "store_unprocessed";
  return false;
}

export type FileKind = "pdf" | "image" | "zip" | "other";

// The media type a listed file declared, as display data; anything malformed is stored as the generic type.
export const mediaTypeOf = (header: string | undefined) => {
  const t = String(header ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/.test(t) ? t : "application/octet-stream";
};

// PDF by its bytes, never by the header or the extension. The PDF standard lets the header start within the first
// 1024 bytes, which some generators use.
export function fileKind(head: Uint8Array): FileKind {
  const s = new TextDecoder("latin1").decode(head.subarray(0, 1024));
  if (s.startsWith("PK\u0003\u0004")) return "zip";
  if (imageType(head)) return "image";
  return s.includes("%PDF-") ? "pdf" : "other";
}

// JPEG and PNG by their magic bytes; the stored object and its row carry this type, never the declared one.
export function imageType(head: Uint8Array): { mediaType: string; ext: string } | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mediaType: "image/jpeg", ext: ".jpg" };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => head[i] === b)) return { mediaType: "image/png", ext: ".png" };
  return null;
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

// A difference in diacritics is reported too, so the wording states the mismatch, not that it is another person.
export const IDENTITY_ALERT_CS = "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu; ověřte, zda dokument patří tomuto pacientovi.";

// Why a processed upload leaves the case (documents.lifecycle = 'withdrawn', migration 0013): it is another patient's.
// A better scan of the same paper is 'superseded', a different action (EXTRACTION-FORMAT.md, "documents"). The Czech
// text is stored in lifecycle_reason_cs as the doctor reads it.
export const WITHDRAW_REASONS = {
  wrong_patient: "dokument jiného pacienta",
} as const;
export type WithdrawReason = keyof typeof WITHDRAW_REASONS;
export const withdrawReason = (v: unknown): WithdrawReason => {
  if (typeof v === "string" && v in WITHDRAW_REASONS) return v as WithdrawReason;
  throw UP.badReason();
};

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
export const uploadLine = (size: number, sha: string, phone = false, image = false) =>
  `nahrál(a) dokument k případu${phone ? " z telefonu" : ""} (${image ? "obrázek" : "PDF"}, ${sizeCs(size)}, otisk ${sha.slice(0, 12)})`;
export const listedLine = (size: number, phone = false) =>
  `nahrál(a) soubor k případu${phone ? " z telefonu" : ""} (uložen jen název a velikost, ${sizeCs(size)})`;
