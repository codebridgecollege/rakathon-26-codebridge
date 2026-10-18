// Upload from a phone (issue #10, docs/design/PHONE-UPLOAD.md): the rules of an upload session. An upload session is a
// short-lived permission, created by a desktop user, to add files to one case from a phone that is not logged in; its
// token is the random value in the QR code. Pure except for the hashing helpers, which use Web Crypto.
import { ApiError } from "../http/errors";

export const UPLOAD_SESSION_TTL_MS = 15 * 60_000;
export const UPLOAD_SESSION_MAX_FILES = 30;
export const UPLOAD_TARGETS = ["intake", "discussion", "documents"] as const;
export type UploadTarget = (typeof UPLOAD_TARGETS)[number];
export const isUploadTarget = (v: unknown): v is UploadTarget => typeof v === "string" && (UPLOAD_TARGETS as readonly string[]).includes(v);

export type SessionRow = {
  id: string;
  org_id: string; // the org of the case; the phone acts in it and nowhere else
  token_hash: string;
  case_id: string;
  target: UploadTarget;
  created_by: string;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
  file_count: number;
};

export type SessionState = "open" | "expired" | "closed" | "full";

// Closed wins over expired, so a session the desktop ended reads "closed" also after its expiry.
export function sessionState(s: Pick<SessionRow, "closed_at" | "expires_at" | "file_count">, nowMs: number): SessionState {
  if (s.closed_at) return "closed";
  if (Date.parse(s.expires_at) <= nowMs) return "expired";
  if (s.file_count >= UPLOAD_SESSION_MAX_FILES) return "full";
  return "open";
}

// 32 random bytes, base64url: 256 bits, so guessing a live token is not a practical attack within 15 minutes.
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Only the hash is stored and looked up, so a leaked database row or log line of it grants nothing.
export async function tokenHash(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// The token travels as "Authorization: Bearer <token>": never in the URL (the QR code carries it after "#", which the
// browser does not send), and in the header that logging and proxies treat as a credential.
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(header ?? "");
  return m ? m[1]! : null;
}

// The one message the phone shows: an expired, closed, full or unknown link all read the same, so the phone learns
// nothing about which sessions exist.
export const sessionClosed = () => new ApiError(410, "upload_session_closed", "Platnost odkazu skončila, naskenujte kód znovu.");
export const sessionNotFound = () => new ApiError(404, "upload_session_not_found", "Nahrávání z telefonu nebylo nalezeno.");

// Access-log lines: who opened and ended the session (the desktop user), never the token or a file name.
export const OPENED_CS = "otevřel(a) nahrávání z telefonu";
export const CLOSED_CS = "ukončil(a) nahrávání z telefonu";
