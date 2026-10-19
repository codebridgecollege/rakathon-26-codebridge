// A mock OIDC identity provider for the browser suite (docs/design/AUTH.md, "Tests"): run-parallel.mjs starts it next to
// a local Worker in AUTH_MODE=oidc, so the real login flow runs in CI without Zitadel and without any real password.
// It behaves like an IdP where the Worker can tell: discovery, signed RS256 ID tokens from a key generated at start,
// the code flow with S256 PKCE checked at the token endpoint, codes valid once, client_secret_basic, registered
// redirect and post-logout addresses only, and a single sign-on cookie, so a second login (the lost-login dialog's
// second window) passes without the form, and the IdP's logout really logs out.
//
// Its login page takes an e-mail and no password. Every account it signs in has a verified e-mail; the Worker decides
// whether that e-mail belongs to a provisioned person.
//
// Usage: node mock-oidc.mjs --port 8861 --client e2e-client --secret e2e-secret --app http://127.0.0.1:8851
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const port = Number(arg("port", "8861"));
const clientId = arg("client", "e2e-client");
const clientSecret = arg("secret", "e2e-secret");
// The Worker's origin: its callback and its post-logout address are the only ones registered, as in Zitadel.
const app = arg("app", "http://127.0.0.1:8851");
const issuer = `http://127.0.0.1:${port}`;
const redirectUri = `${app}/auth/callback`;
const postLogout = `${app}/`;
const SSO = "mock_idp_sso";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const b64url = (b) => Buffer.from(b).toString("base64url");

function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify({ iss: issuer, aud: clientId, iat: now, exp: now + 300, ...claims }));
  const sig = sign("sha256", Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}

// code -> what the token endpoint checks and signs. Codes expire after a minute and work once.
const codes = new Map();
// SSO session id -> e-mail.
const sso = new Map();
const subjectOf = (email) => "mock-" + createHash("sha256").update(email).digest("hex").slice(0, 20);

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "content-type": "application/json" });
const redirect = (res, to, headers = {}) => send(res, 302, "", { location: to, ...headers });
const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

function issueCode(p, email) {
  const code = randomBytes(24).toString("base64url");
  codes.set(code, { email, nonce: p.nonce, challenge: p.code_challenge, redirect: p.redirect_uri, at: Date.now() });
  const to = new URL(p.redirect_uri);
  to.searchParams.set("code", code);
  to.searchParams.set("state", p.state);
  return to.toString();
}

// The authorization request as an IdP checks it; a wrong one is answered with an error page, never a redirect.
function checkAuthorize(p) {
  if (p.client_id !== clientId) return "unknown client_id";
  if (p.redirect_uri !== redirectUri) return "redirect_uri not registered";
  if (p.response_type !== "code") return "response_type must be code";
  if (p.code_challenge_method !== "S256" || !p.code_challenge) return "S256 PKCE required";
  if (p.response_mode && p.response_mode !== "query") return "response_mode must be query";
  if (!p.state || !p.nonce) return "state and nonce required";
  return null;
}

const loginPage = (p, email = "") => `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Mock IdP</title></head>
<body><main><h1>Mock IdP: přihlášení</h1>
<form method="post" action="/login">
${Object.entries(p)
  .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
  .join("\n")}
<label>E-mail <input name="email" type="email" value="${esc(email)}" autocomplete="off"></label>
<button type="submit">Přihlásit se u IdP</button>
</form></main></body></html>`;

const server = createServer(async (req, res) => {
  const u = new URL(req.url, issuer);
  try {
    if (req.method === "GET" && u.pathname === "/.well-known/openid-configuration")
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
        end_session_endpoint: `${issuer}/end_session`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (req.method === "GET" && u.pathname === "/keys") return json(res, 200, { keys: [jwk] });
    if (req.method === "GET" && u.pathname === "/authorize") {
      const p = Object.fromEntries(u.searchParams);
      const bad = checkAuthorize(p);
      if (bad) return send(res, 400, `invalid request: ${bad}`, { "content-type": "text/plain" });
      const known = sso.get(cookies(req)[SSO]);
      // Single sign-on: an IdP session goes straight back, unless the app asked for a new login.
      if (known && p.prompt !== "login") return redirect(res, issueCode(p, known));
      const { prompt: _drop, ...rest } = p;
      return send(res, 200, loginPage(rest), { "content-type": "text/html; charset=utf-8" });
    }
    if (req.method === "POST" && u.pathname === "/login") {
      const p = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const { email, ...rest } = p;
      const bad = checkAuthorize(rest);
      if (bad || !email) return send(res, 400, `invalid request: ${bad ?? "e-mail required"}`, { "content-type": "text/plain" });
      const sid = randomBytes(16).toString("hex");
      sso.set(sid, email.trim().toLowerCase());
      return redirect(res, issueCode(rest, email.trim().toLowerCase()), { "set-cookie": `${SSO}=${sid}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (req.method === "POST" && u.pathname === "/token") {
      const auth = req.headers.authorization ?? "";
      const [id, secret] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString().split(":").map(decodeURIComponent);
      if (!auth.startsWith("Basic ") || id !== clientId || secret !== clientSecret) return json(res, 401, { error: "invalid_client" });
      const f = new URLSearchParams(await readBody(req));
      const c = codes.get(f.get("code") ?? "");
      codes.delete(f.get("code") ?? "");
      if (!c || Date.now() - c.at > 60_000 || f.get("grant_type") !== "authorization_code" || f.get("redirect_uri") !== c.redirect) return json(res, 400, { error: "invalid_grant" });
      if (createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") !== c.challenge) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, {
        token_type: "Bearer",
        access_token: randomBytes(16).toString("hex"),
        expires_in: 300,
        id_token: idToken({ sub: subjectOf(c.email), email: c.email, email_verified: true, nonce: c.nonce }),
      });
    }
    if (req.method === "GET" && u.pathname === "/end_session") {
      if (u.searchParams.get("post_logout_redirect_uri") !== postLogout || !u.searchParams.get("id_token_hint")) return send(res, 400, "invalid logout request", { "content-type": "text/plain" });
      sso.delete(cookies(req)[SSO]);
      return redirect(res, postLogout, { "set-cookie": `${SSO}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }
    send(res, 404, "not found", { "content-type": "text/plain" });
  } catch (e) {
    send(res, 500, `mock IdP error: ${e?.message ?? e}`, { "content-type": "text/plain" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`mock OIDC IdP at ${issuer} for ${app}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
