// Upload from a phone (issue #10, docs/design/PHONE-UPLOAD.md). Two groups of routes:
// - desktop (a logged-in user, behind the viewer and write middleware): open a session for one case, poll what the
//   phone sent, end it;
// - phone (no login; the session token in "Authorization: Bearer" is the only credential): read the case ID and add
//   files. The phone's files go through the same upload path as a desktop upload (receiveUpload), under the desktop
//   user's name, so the case's list, the intake check and reset-demo treat them like any upload.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { ApiError, E } from "../http/errors";
import { sameOrigin } from "../http/origin";
import { DomainError, D } from "@codebridge/domain/errors";
import { staffName } from "../domain/rows";
import { MAX_DOCUMENTS_PER_CASE, UP, fileNameOf } from "../domain/documents";
import {
  CLOSED_CS,
  OPENED_CS,
  UPLOAD_SESSION_MAX_FILES,
  UPLOAD_SESSION_TTL_MS,
  bearerToken,
  isUploadTarget,
  newToken,
  sessionClosed,
  sessionNotFound,
  sessionState,
  tokenHash,
  type SessionRow,
} from "../domain/upload-sessions";
import { limitOrThrow } from "../http/rate-limit";
import { makeStores } from "../store";
import { realActor } from "../store/audio";
import { UNLOCKED_COND, sessionDocuments, uploadContext } from "../store/documents";
import { D1Work } from "../store/work";
import { openCase } from "./access-check";
import { assertUnlocked, docOut, receiveUpload } from "./documents";
import { answer, caseFor, label, newId, now, orgQuery, tx } from "./write-context";
import { orgStmt } from "../store/sql";

const SESSION_COLS = "id, org_id, token_hash, case_id, target, created_by, created_by_actor, created_at, expires_at, closed_at, file_count";

// What the desktop sees of a session. The token is not in it: it is shown once, in the answer that created it.
const sessionOut = (s: SessionRow, nowMs: number) => ({
  id: s.id,
  case_id: s.case_id,
  target: s.target,
  state: sessionState(s, nowMs),
  expires_at: s.expires_at,
  file_count: s.file_count,
  max_files: UPLOAD_SESSION_MAX_FILES,
});

async function ownSession(c: Context<AppEnv>): Promise<SessionRow> {
  const s = await orgQuery(c, `SELECT ${SESSION_COLS} FROM upload_sessions WHERE org_id = ?org AND id = ?1 AND created_by = ?2`, c.req.param("id"), c.var.viewer.id)
    .first<SessionRow>();
  // Another user's session reads as missing, so a session id grants nothing to anyone but its creator.
  if (!s) throw sessionNotFound();
  return s;
}

export const uploadSessions = new Hono<AppEnv>()
  .post("/upload-sessions", async (c) => {
    const { case_id: caseId, target } = c.var.body as { case_id?: unknown; target?: unknown };
    if (typeof caseId !== "string" || !caseId || caseId.length > 64 || !isUploadTarget(target)) throw D.invalidInput();
    label(c, "nahrávání z telefonu", caseId);
    // The same rule as the desktop's own upload: role, membership, an intake only for its creator, an unlocked case.
    const { breakGlass } = await caseFor(c, caseId, "document.upload");
    const u = await uploadContext(c.env.DB, c.var.viewer.org, caseId);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    await limitOrThrow(c, "RL_UPLOAD");
    const token = newToken();
    const id = `us-${newId()}`;
    const at = now();
    const expires = new Date(at.getTime() + UPLOAD_SESSION_TTL_MS).toISOString();
    const t = tx(c, breakGlass);
    t.guard("unlocked", UNLOCKED_COND, [caseId, caseId], () => UP.locked());
    t.run(
      `INSERT INTO upload_sessions (org_id, id, token_hash, case_id, target, created_by, created_by_actor, created_at, expires_at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?8, ?6, ?7)`,
      id, await tokenHash(token), caseId, target, c.var.viewer.id, at.toISOString(), expires, c.var.viewer.actor?.id ?? null,
    );
    t.audit({ action: "upload_session.open", what_cs: OPENED_CS, case_id: caseId, target_type: "upload_session", target_id: id });
    await t.commit();
    const row = await orgQuery(c, `SELECT ${SESSION_COLS} FROM upload_sessions WHERE org_id = ?org AND id = ?1`, id).first<SessionRow>();
    return answer(c, { ...sessionOut(row!, at.getTime()), token }, {}, 201);
  })
  // The desktop's poll, every 1.5 s while the dialog is open. Not logged per poll: it returns only the files this
  // user's own session added, and opening the session is in the access log. It answers after the end too, so the
  // desktop's last look finds a file whose upload finished just after "Hotovo".
  .get("/upload-sessions/:id", async (c) => {
    const s = await ownSession(c);
    const nowMs = now().getTime();
    try {
      await openCase(c, s.case_id, "header");
    } catch (e) {
      // A discarded intake: the session simply reads as ended.
      if (e instanceof ApiError && e.code === "case_not_found") return c.json({ ...sessionOut({ ...s, closed_at: s.closed_at ?? new Date(nowMs).toISOString() }, nowMs), documents: [] });
      throw e;
    }
    return c.json({ ...sessionOut(s, nowMs), documents: (await sessionDocuments(c.env.DB, c.var.viewer.org, s.id)).map(docOut) });
  })
  .delete("/upload-sessions/:id", async (c) => {
    const s = await ownSession(c);
    label(c, "ukončení nahrávání z telefonu", s.case_id);
    // Ending twice is one end: the second call changes nothing and logs nothing.
    if (s.closed_at) return answer(c, sessionOut(s, now().getTime()));
    const at = now().toISOString();
    const t = tx(c);
    t.run("UPDATE upload_sessions SET closed_at = ?1 WHERE org_id = ?org AND id = ?2 AND closed_at IS NULL", at, s.id);
    t.audit({ action: "upload_session.close", what_cs: CLOSED_CS, case_id: s.case_id, target_type: "upload_session", target_id: s.id });
    await t.commit();
    return answer(c, sessionOut({ ...s, closed_at: at }, now().getTime()));
  });

// ---------- the phone ----------

// The session behind the request's token, open or not; an unknown token reads as an ended link.
async function sessionOfToken(c: Context<AppEnv>): Promise<SessionRow> {
  const token = bearerToken(c.req.header("authorization"));
  if (!token) throw sessionClosed();
  // The token is the credential and its hash a unique key across orgs; the session row then names its org.
  const s = await c.env.DB.prepare(`SELECT ${SESSION_COLS} FROM upload_sessions WHERE token_hash = ?1 /* org-scope: any org, the token picks the session */`)
    .bind(await tokenHash(token))
    .first<SessionRow>();
  if (!s) throw sessionClosed();
  return s;
}

const ipKey = (c: Context<AppEnv>) => `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;

async function limit(c: Context<AppEnv>, key: string) {
  const { success } = await c.env.RL_UPLOAD.limit({ key });
  if (!success) throw E.rateLimited();
}

// The phone acts for the desktop user who opened the session, with their membership in the session's org (never a
// role of theirs in another org): the access log and the document list name that person, and their role and team are
// checked again for every request. A user who may no longer upload to the case (or a case that is gone) ends the link.
async function actAsCreator(c: Context<AppEnv>, s: SessionRow): Promise<string | null> {
  const stores = makeStores(c.env, s.org_id);
  c.set("stores", stores);
  const row = await stores.dir.userById(s.created_by);
  if (!row || row.active !== 1 || row.role_id === ("staff" as string)) throw sessionClosed();
  c.set("viewer", {
    id: row.id,
    name: staffName(row),
    role: row.role_id,
    dept: await stores.dir.firstDeptOf(row.id),
    authMode: c.env.AUTH_MODE === "oidc" ? "oidc" : "demo",
    org: s.org_id,
    membershipId: row.membership_id,
    // Opened under a role switch: the rows name the person logged in, as the desktop's own rows did (AUTH.md).
    ...(await realActor(c.env.DB, s.created_by, s.created_by_actor)),
  });
  c.set("breakGlass", null);
  try {
    return (await caseFor(c, s.case_id, "document.upload")).breakGlass;
  } catch (e) {
    if (e instanceof DomainError && (e.status === 404 || e.status === 403)) throw sessionClosed();
    throw e;
  }
}

// Mounted before the login middleware: the phone is not logged in (when Cloudflare Access is on, /u and these routes
// bypass it; api/AGENTS.md). Same-origin still applies to the upload, as for every other write. The middleware is per
// path, because this app is mounted at the root, where a "*" would run for every API route; Hono's "/x/*" also matches
// "/x", so one pattern covers both routes once.
const dataOn: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.DATA_API !== "on" || !c.env.DB || !c.env.DOCS) throw E.notConfigured();
  return next();
};
export const phoneUpload = new Hono<AppEnv>();
phoneUpload.use("/upload-sessions/current/*", dataOn, sameOrigin());
phoneUpload
  .get("/upload-sessions/current", async (c) => {
    await limit(c, ipKey(c));
    const s = await sessionOfToken(c);
    if (sessionState(s, now().getTime()) !== "open") throw sessionClosed();
    await actAsCreator(c, s);
    // The case ID and the names and sizes of the files sent with this code: nothing about the patient or the case's
    // other documents.
    const files = (await sessionDocuments(c.env.DB, c.var.viewer.org, s.id)).map((d) => ({ name: d.file_name, size: d.size_bytes, uploaded_at: d.created_at }));
    return c.json({ case_id: s.case_id, expires_at: s.expires_at, max_files: UPLOAD_SESSION_MAX_FILES, files });
  })
  .post("/upload-sessions/current/files", async (c) => {
    // The IP limit first, so unknown tokens cannot make the server query D1 without bound.
    await limit(c, ipKey(c));
    const s = await sessionOfToken(c);
    if (sessionState(s, now().getTime()) !== "open") throw sessionClosed();
    await limit(c, `us:${s.id}`);
    // One slot per file, claimed atomically, so parallel requests cannot pass the cap or a close that already landed.
    const claimed = await orgStmt(
      c.env.DB,
      s.org_id,
      "UPDATE upload_sessions SET file_count = file_count + 1 WHERE org_id = ?org AND id = ?1 AND closed_at IS NULL AND expires_at > ?2 AND file_count < ?3 RETURNING file_count",
      s.id,
      now().toISOString(),
      UPLOAD_SESSION_MAX_FILES,
    ).first<{ file_count: number }>();
    if (!claimed) throw sessionClosed();
    // The session's org's demo state: a reset there ends the upload, a reset of another org does not.
    const st = await new D1Work(c.env.DB, s.org_id).epoch();
    if (!st) throw E.notConfigured();
    if (st.reset_in_progress) throw D.resetting();
    c.set("epoch", st.data_epoch);
    const breakGlass = await actAsCreator(c, s);
    label(c, "nahrání dokumentu z telefonu", s.case_id);
    const u = await uploadContext(c.env.DB, c.var.viewer.org, s.case_id);
    if (!u) throw sessionClosed();
    assertUnlocked(u);
    if (u.doc_count >= MAX_DOCUMENTS_PER_CASE) throw UP.tooMany();
    const sent = fileNameOf(c.req.header("x-file-name"));
    const r = await receiveUpload(c, s.case_id, u, breakGlass, { source: "phone", sessionId: s.id });
    // The phone gets back what it sent: never the name of a document already in the case, its identity result or details.
    return c.json({ data: { name: sent, size: r.document.size } }, r.status);
  });
