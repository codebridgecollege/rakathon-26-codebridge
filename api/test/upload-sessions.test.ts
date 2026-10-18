// Route tests of upload from a phone (issue #10, docs/design/PHONE-UPLOAD.md) on local D1 and R2: a session is opened by
// a desktop user who may upload to the case, its token is stored only as a hash, the phone can only add files to that
// one case and read its case ID and its own files, the session ends on expiry, close, 30 files, an intake discard and
// reset-demo, and neither the access log nor the Worker log holds a token or a file name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { call, deny, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";
import { sweep } from "../src/scheduled";
import { UPLOAD_SESSION_MAX_FILES, bearerToken, newToken, sessionState, tokenHash } from "../src/domain/upload-sessions";

type Body = { data?: Record<string, any>; error?: { code: string; message_cs: string }; [k: string]: any };
const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;
const log = () => q<{ action: string; what_cs: string; case_id: string | null; actor_name: string; target_id: string | null }>("SELECT * FROM access_log ORDER BY id");

const enc = new TextEncoder();
const pdf = (marker: string) => enc.encode(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const MINE = pdf("fixture of patient A");
const PHOTO = enc.encode("\xff\xd8\xff\xe0 not really a jpeg");

async function registerFixture() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO fixture_patients (fixture_id, full_name, birth_number, data_origin) VALUES ('FX-A', 'Pacientka Testová', '645312/1234', 'codebridge_synthetic')"),
    env.DB.prepare(
      "INSERT INTO fixture_files (sha256, fixture_id, file_name, r2_prefix, kind, size_bytes, title_cs, doc_type, doc_date, page_count, combined_pages_json) VALUES (?1, 'FX-A', 'a.pdf', 'fixtures/FX-A/', 'upload', 1, 'Laboratorní výsledky', 'laboratorní výsledky', '2026-03-10', 1, '[5]')",
    ).bind(await hex(MINE)),
  ]);
}

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", e = testEnv(), headers: Record<string, string> = {}) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1", ...headers }, body: JSON.stringify(body) }, e);
  return { status: r.status, body: (await r.json()) as Body };
}
const get = async (path: string, user = "d2p1") => {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } });
  return { status: r.status, body: (await r.json()) as Body };
};
const open = (caseId = "NO-A", target = "documents", user = "d2p1") => w("POST", "/upload-sessions", { case_id: caseId, target }, user);

// What the phone sends: no demo user, no data epoch, only the token.
async function phoneGet(token: string | null) {
  const r = await call("/api/upload-sessions/current", { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: (await r.json()) as Body };
}
async function phoneSend(token: string, bytes: Uint8Array, name: string, type = "application/pdf", e = testEnv(), extra: Record<string, string> = {}) {
  const r = await call(
    "/api/upload-sessions/current/files",
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type, "x-file-name": encodeURIComponent(name), "content-length": String(bytes.length), ...extra }, body: bytes },
    e,
  );
  return { status: r.status, body: (await r.json()) as Body };
}

let logged: string[] = [];
beforeEach(async () => {
  await loadFixture();
  await env.DB.prepare("DELETE FROM upload_sessions").run();
  await registerFixture();
  logged = [];
  for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("the token", () => {
  it("is 256 random bits in base64url and is stored only as its SHA-256", async () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(await tokenHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(t)).toBeNull();
    expect(bearerToken("Bearer short")).toBeNull();
    expect(sessionState({ closed_at: null, expires_at: new Date(Date.now() + 1000).toISOString(), file_count: UPLOAD_SESSION_MAX_FILES }, Date.now())).toBe("full");
  });

  it("is answered once, at creation; the database and the poll never hold it", async () => {
    const r = await open();
    expect(r.status).toBe(201);
    const { token, id } = r.body.data!;
    expect(r.body.data).toMatchObject({ case_id: "NO-A", target: "documents", state: "open", file_count: 0, max_files: 30 });
    const row = await one("SELECT * FROM upload_sessions WHERE id = ?1", id);
    expect(row.token_hash).toBe(await tokenHash(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const poll = await get(`/upload-sessions/${id}`);
    expect(poll.status).toBe(200);
    expect(JSON.stringify(poll.body)).not.toContain(token);
    expect(JSON.stringify(poll.body)).not.toContain(row.token_hash);
    // About 15 minutes.
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(15 * 60_000);
  });
});

describe("opening a session", () => {
  it("follows the desktop's upload rule: doctors of the team and the coordinator, an unlocked case", async () => {
    expect((await open("NO-A", "documents", "coord")).status).toBe(201);
    expect((await open("NO-A", "documents", "admin")).status).toBe(403);
    // d1p1 is not in NO-A's team.
    expect((await open("NO-A", "documents", "d1p1")).status).toBe(403);
    expect((await open("NO-X")).status).toBe(404);
    expect((await open("NO-A", "elsewhere")).status).toBe(422);
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'").run();
    expect((await open()).body.error?.code).toBe("case_locked");
  });

  it("logs the opening and the end under the desktop user's name; a second end changes nothing", async () => {
    const { id } = (await open()).body.data!;
    expect((await w("DELETE", `/upload-sessions/${id}`)).status).toBe(200);
    expect((await w("DELETE", `/upload-sessions/${id}`)).status).toBe(200);
    const lines = (await log()).filter((l) => l.action.startsWith("upload_session."));
    expect(lines.map((l) => [l.action, l.what_cs, l.actor_name, l.case_id])).toEqual([
      ["upload_session.open", "otevřel(a) nahrávání z telefonu", "MUDr. Svobodová", "NO-A"],
      ["upload_session.close", "ukončil(a) nahrávání z telefonu", "MUDr. Svobodová", "NO-A"],
    ]);
  });

  it("belongs to its creator: another user can neither poll nor end it", async () => {
    const { id } = (await open("NO-A", "documents", "d2p1")).body.data!;
    expect((await get(`/upload-sessions/${id}`, "coord")).status).toBe(404);
    expect((await w("DELETE", `/upload-sessions/${id}`, {}, "coord")).status).toBe(404);
    expect((await one("SELECT closed_at FROM upload_sessions WHERE id = ?1", id)).closed_at).toBeNull();
  });
});

describe("the phone", () => {
  it("sees the case ID and its own files only, nothing about the patient", async () => {
    const { token } = (await open()).body.data!;
    const r = await phoneGet(token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ case_id: "NO-A", files: [], max_files: 30 });
    expect(Object.keys(r.body).sort()).toEqual(["case_id", "expires_at", "files", "max_files"]);
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${FAKE_NAME}|645312|Diagnóza|A_pacient`));
  });

  it("an upload goes through the normal path: a fixture is stored and recognised, a photo is listed, both show on the desktop", async () => {
    const { token, id } = (await open()).body.data!;
    const a = await phoneSend(token, MINE, "lab z telefonu.pdf");
    expect(a.status).toBe(201);
    expect(a.body.data).toEqual({ name: "lab z telefonu.pdf", size: MINE.length });
    const b = await phoneSend(token, PHOTO, "image.jpg", "image/jpeg");
    expect(b.status).toBe(201);
    const poll = await get(`/upload-sessions/${id}`);
    expect(poll.body).toMatchObject({ state: "open", file_count: 2 });
    expect(poll.body.documents.map((d: any) => [d.name, d.source, d.fixture, d.content_stored, d.uploaded_by, d.identity])).toEqual([
      ["lab z telefonu.pdf", "phone", true, true, "MUDr. Svobodová", "matches"],
      ["image.jpg", "phone", false, false, "MUDr. Svobodová", null],
    ]);
    // The case's own list has them too, as any upload.
    const list = await get("/cases/NO-A/documents");
    expect(list.body.documents.filter((d: any) => d.source === "phone")).toHaveLength(2);
    expect((await env.DOCS.list({ prefix: "uploads/NO-A/" })).objects).toHaveLength(1);
    const lines = (await log()).filter((l) => l.action === "document.upload").map((l) => l.what_cs);
    expect(lines[0]).toMatch(/^nahrál\(a\) dokument k případu z telefonu \(PDF, 1 kB, otisk [0-9a-f]{12}\)$/);
    expect(lines[1]).toBe("nahrál(a) soubor k případu z telefonu (uložen jen název a velikost, 1 kB)");
    // The phone lists its own files on a reload.
    expect((await phoneGet(token)).body.files.map((f: any) => f.name)).toEqual(["lab z telefonu.pdf", "image.jpg"]);
  });

  it("can only add: no other route opens with the token, and the token never reaches another case", async () => {
    const { token } = (await open("NO-A")).body.data!;
    await phoneSend(token, PHOTO, "foto.jpg", "image/jpeg");
    expect((await q("SELECT case_id FROM documents WHERE source = 'phone'")).map((r) => r.case_id)).toEqual(["NO-A"]);
    for (const [m, p] of [["DELETE", "/api/upload-sessions/current"], ["PUT", "/api/upload-sessions/current/files"], ["GET", "/api/upload-sessions/current/files"], ["DELETE", "/api/upload-sessions/current/files"]] as const) {
      const r = await call(p, { method: m, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(m === "GET" ? {} : { body: "{}" }) });
      // These fall through to the desktop routes, which refuse them (no epoch, no session called "current").
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect((await phoneGet(token)).status).toBe(200);
    expect(await q("SELECT id FROM documents WHERE source = 'phone'")).toHaveLength(1);
  });

  it("is refused from another site", async () => {
    const { token } = (await open()).body.data!;
    expect((await phoneSend(token, PHOTO, "x.jpg", "image/jpeg", testEnv(), { origin: "https://evil.test" })).status).toBe(403);
  });

  it("an unknown, missing, expired or closed token reads as an ended link, with one message", async () => {
    const MSG = { code: "upload_session_closed", message_cs: "Platnost odkazu skončila, naskenujte kód znovu." };
    expect((await phoneGet(null)).body.error).toEqual(MSG);
    expect((await phoneGet(newToken())).status).toBe(410);
    const s1 = (await open()).body.data!;
    await env.DB.prepare("UPDATE upload_sessions SET expires_at = ?1 WHERE id = ?2").bind(new Date(Date.now() - 1000).toISOString(), s1.id).run();
    expect((await phoneGet(s1.token)).body.error).toEqual(MSG);
    expect((await phoneSend(s1.token, PHOTO, "x.jpg")).status).toBe(410);
    expect((await get(`/upload-sessions/${s1.id}`)).body.state).toBe("expired");
    const s2 = (await open()).body.data!;
    await w("DELETE", `/upload-sessions/${s2.id}`);
    expect((await phoneSend(s2.token, PHOTO, "x.jpg")).body.error).toEqual(MSG);
    expect(await q("SELECT id FROM documents WHERE source = 'phone'")).toEqual([]);
  });

  it("takes at most 30 files, also when they arrive at once", async () => {
    const { token, id } = (await open()).body.data!;
    await env.DB.prepare("UPDATE upload_sessions SET file_count = ?1 WHERE id = ?2").bind(UPLOAD_SESSION_MAX_FILES - 1, id).run();
    const rs = await Promise.all([1, 2, 3].map((i) => phoneSend(token, enc.encode(`foto ${i}`), `foto-${i}.jpg`, "image/jpeg")));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 410, 410]);
    expect((await one("SELECT file_count FROM upload_sessions WHERE id = ?1", id)).file_count).toBe(UPLOAD_SESSION_MAX_FILES);
    expect((await get(`/upload-sessions/${id}`)).body.state).toBe("full");
  });

  it("is rate limited per session and per IP before a slot is used", async () => {
    const { token, id } = (await open()).body.data!;
    const keys: string[] = [];
    // The IP passes, the session's own limit refuses.
    const spy = { limit: async (o: { key: string }) => (keys.push(o.key), { success: o.key.startsWith("ip:") }) };
    const r = await phoneSend(token, PHOTO, "x.jpg", "image/jpeg", testEnv({ RL_UPLOAD: spy }));
    expect(r.status).toBe(429);
    expect(keys).toEqual(["ip:unknown", `us:${id}`]);
    expect((await phoneSend(token, PHOTO, "x.jpg", "image/jpeg", testEnv({ RL_UPLOAD: deny }))).status).toBe(429);
    expect((await one("SELECT file_count FROM upload_sessions WHERE id = ?1", id)).file_count).toBe(0);
  });

  it("acts for the desktop user: once that user may no longer upload to the case, the link has ended", async () => {
    const { token } = (await open("NO-A", "documents", "d2p1")).body.data!;
    await env.DB.prepare("DELETE FROM case_members WHERE case_id = 'NO-A'").run();
    expect((await phoneSend(token, PHOTO, "x.jpg")).status).toBe(410);
    // Nor can the phone still read the names of what it sent.
    expect((await phoneGet(token)).status).toBe(410);
  });

  it("a photo named like an earlier one in another session or from the desktop is a new file, not a repeat", async () => {
    const s1 = (await open()).body.data!;
    expect((await phoneSend(s1.token, enc.encode("photo one"), "image.jpg", "image/jpeg")).status).toBe(201);
    await w("DELETE", `/upload-sessions/${s1.id}`);
    const s2 = (await open()).body.data!;
    const r = await phoneSend(s2.token, enc.encode("photo two"), "image.jpg", "image/jpeg");
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ name: "image.jpg", size: 9 });
    expect((await get(`/upload-sessions/${s2.id}`)).body.documents.map((d: any) => d.name)).toEqual(["image (2).jpg"]);
    // Within one session the same name is still one file (a resent request after a timeout).
    expect((await phoneSend(s2.token, enc.encode("photo three"), "foto.jpg", "image/jpeg")).status).toBe(201);
    expect((await phoneSend(s2.token, enc.encode("photo three"), "foto.jpg", "image/jpeg")).status).toBe(200);
    expect((await get(`/upload-sessions/${s2.id}`)).body.documents).toHaveLength(2);
  });

  it("a repeat of a document already in the case answers with the name the phone sent, never the stored one", async () => {
    const r0 = await call("/api/cases/NO-A/documents", {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-demo-user": "d2p1", "x-data-epoch": "1", "x-file-name": encodeURIComponent("Testova propousteci zprava.pdf"), "content-length": String(MINE.length) },
      body: MINE,
    });
    expect(r0.status).toBe(201);
    const { token } = (await open()).body.data!;
    const r = await phoneSend(token, MINE, "x.pdf");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ name: "x.pdf", size: MINE.length });
  });

  it("a file to a case approved meanwhile is not stored and gets no ended-link answer", async () => {
    const { token } = (await open()).body.data!;
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'").run();
    const r = await phoneSend(token, PHOTO, "x.jpg");
    expect(r.body.error?.code).toBe("case_locked");
    expect(await q("SELECT id FROM documents WHERE source = 'phone'")).toEqual([]);
  });
});

describe("the intake from a phone", () => {
  let key = 0;
  const startIntake = (user = "d2p1") =>
    w("POST", "/cases", { first_name: "Věra", last_name: "Lipenská", birth_number: "585614/4019", consent: true, intake: true }, user, testEnv(), { "idempotency-key": `phone-intake-${++key}-aaaaaaaa` });

  it("files reach the open intake; only its creator opens a session; a discard ends the link", async () => {
    const ik = await startIntake();
    expect(ik.status).toBe(200);
    const caseId = ik.body.data!.case_id as string;
    expect((await open(caseId, "intake", "coord")).status).toBe(404);
    const { token, id } = (await open(caseId, "intake")).body.data!;
    expect((await phoneSend(token, PHOTO, "foto.jpg", "image/jpeg")).status).toBe(201);
    expect((await get(`/upload-sessions/${id}`)).body.documents).toHaveLength(1);
    expect((await w("DELETE", `/cases/${caseId}/intake`)).status).toBe(200);
    expect((await one("SELECT closed_at FROM upload_sessions WHERE id = ?1", id)).closed_at).not.toBeNull();
    expect((await phoneSend(token, PHOTO, "foto2.jpg", "image/jpeg")).status).toBe(410);
    expect((await get(`/upload-sessions/${id}`)).body).toMatchObject({ state: "closed", documents: [] });
  });
});

describe("clean-up", () => {
  it("reset-demo's flag removes every session; the sweep removes sessions a day after expiry", async () => {
    const a = (await open()).body.data!;
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE id = 1").run();
    expect(await q("SELECT id FROM upload_sessions")).toEqual([]);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE id = 1").run();
    expect((await phoneGet(a.token)).status).toBe(410);
    const b = (await open()).body.data!;
    await sweep(env);
    expect((await q("SELECT id FROM upload_sessions")).map((r) => r.id)).toEqual([b.id]);
    await sweep(env, Date.now() + 15 * 60_000 + 25 * 3600_000);
    expect(await q("SELECT id FROM upload_sessions")).toEqual([]);
  });
});

describe("privacy", () => {
  it("no token, token hash or file name in the access log or the Worker log", async () => {
    const { token, id } = (await open()).body.data!;
    await phoneSend(token, MINE, "Testova lab.pdf");
    await phoneSend(token, PHOTO, "rentgen Testova.jpg", "image/jpeg");
    await phoneGet(token);
    await phoneSend(newToken(), PHOTO, "x.jpg");
    await w("DELETE", `/upload-sessions/${id}`);
    const hash = await tokenHash(token);
    const text = JSON.stringify(await q("SELECT * FROM access_log")) + "\n" + logged.join("\n");
    for (const bad of [token, hash, "Testova", "lab.pdf", "rentgen", ".jpg", FAKE_NAME]) expect(text).not.toContain(bad);
  });
});
