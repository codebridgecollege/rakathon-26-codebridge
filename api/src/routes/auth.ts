// The login routes under /auth (docs/design/AUTH.md, "How login works"): GET /auth/login, GET /auth/callback and
// POST /auth/logout. They answer with redirects and the fixed pages of auth/pages.ts, never with JSON data.
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { sameOrigin } from "../http/origin";
import { authPage, pageLocale, type PageKind, type PageLocale } from "../auth/pages";
import {
  authorizationUrl,
  discover,
  endSessionUrl,
  exchangeCode,
  OidcError,
  oidcConfig,
  pkceChallenge,
  randomToken,
  TOKEN_SHAPE,
  userinfoEmail,
  verifyIdToken,
  type OidcConfig,
} from "../auth/oidc";
import {
  clearCookie,
  cookie,
  createSession,
  deleteSession,
  isoAt,
  isTxCookie,
  openTx,
  safeReturnPath,
  sealTx,
  SESSION_COOKIE,
  SESSION_MAX_MS,
  sessionOf,
  TX_MAX_AGE_S,
  txCookieName,
} from "../auth/session";
import { actsInApp, activeMembershipsOfUser, hasOtherIdentity, linkIdentity, personOfEmail, personOfIdentity } from "../store/people";
import { logSessionEvent } from "../auth/events";

const redirect = (location: string, cookies: string[] = [], status: 302 | 303 = 302) => {
  const h = new Headers({ location, "cache-control": "no-store", "referrer-policy": "same-origin" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status, headers: h });
};

function page(kind: PageKind, locale: PageLocale, retryTo: string | null, cookies: string[] = []): Response {
  const link =
    kind === "no_access"
      ? { href: "/auth/login?prompt=login", textId: "auth-no-access-other" }
      : retryTo !== null
        ? { href: `/auth/login?to=${encodeURIComponent(retryTo)}`, textId: "auth-retry" }
        : null;
  const r = authPage(kind, locale, link);
  for (const c of cookies) r.headers.append("set-cookie", c);
  return r;
}

// The log line of a failed login: the kind and a short code only, never a token, an e-mail or a subject.
const logFailure = (c: Context<AppEnv>, e: OidcError) => console.log(JSON.stringify({ route: c.req.path, auth: e.kind, reason: e.reason }));

const callbackUri = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/auth/callback`;

export const authRoutes = new Hono<AppEnv>()
  // The app sends the user here with the path to come back to. A new transaction per call, in its own cookie.
  .get("/login", async (c) => {
    const q = c.req.query();
    const to = safeReturnPath(q.to);
    const locale = pageLocale(q.lang);
    // Demo mode has no login; the app's own picker stands in for it.
    if (c.env.AUTH_MODE !== "oidc") return redirect(to);
    let cfg: OidcConfig;
    try {
      cfg = oidcConfig(c.env);
      const d = await discover(cfg);
      const tx = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), to: q.popup === "1" ? "" : to, popup: q.popup === "1", locale };
      const url = authorizationUrl(d, cfg, {
        redirectUri: callbackUri(c),
        state: tx.state,
        nonce: tx.nonce,
        challenge: await pkceChallenge(tx.verifier),
        // Zitadel's login page has Czech and English; a Slovak user gets Czech, the closer of the two.
        locale: locale === "en" ? "en" : "cs",
        promptLogin: q.prompt === "login",
      });
      // Abandoned logins leave their cookies for ten minutes; past a handful they are cleared, so the cookie header
      // stays small (two tabs logging in at once still keep theirs).
      const stale = Object.keys(getCookie(c)).filter(isTxCookie);
      const drop = stale.length >= 5 ? stale.map(clearCookie) : [];
      return redirect(url, [...drop, cookie(txCookieName(tx.state), await sealTx(tx, cfg.sessionKey), TX_MAX_AGE_S)]);
    } catch (e) {
      if (!(e instanceof OidcError)) throw e;
      logFailure(c, e);
      return page(e.kind === "failed" ? "unavailable" : e.kind, locale, to);
    }
  })

  .get("/callback", async (c) => {
    if (c.env.AUTH_MODE !== "oidc") return redirect("/");
    const q = c.req.query();
    const state = q.state ?? "";
    if (!TOKEN_SHAPE.test(state)) return page("failed", "cs", "/");
    // The transaction cookie is deleted by every answer from here on: it is good for one callback only.
    const drop = [clearCookie(txCookieName(state))];
    let cfg: OidcConfig;
    try {
      cfg = oidcConfig(c.env);
    } catch (e) {
      logFailure(c, e as OidcError);
      return page("misconfigured", "cs", null, drop);
    }
    const tx = await openTx(getCookie(c, txCookieName(state)), state, cfg.sessionKey);
    if (!tx) return page("failed", "cs", "/", drop);
    const locale = pageLocale(tx.locale);
    const retryTo = tx.popup ? "/" : tx.to;
    try {
      // The IdP's own refusal (the user cancelled, the account is locked) comes back as ?error=.
      if (q.error || !q.code) throw new OidcError("failed", q.error ? "idp_error" : "no_code");
      const d = await discover(cfg);
      const tokens = await exchangeCode(d, cfg, { code: q.code, redirectUri: callbackUri(c), verifier: tx.verifier });
      const login = await verifyIdToken(d, cfg, tokens.idToken, tx.nonce);
      let { email, emailVerified } = login;
      if (!email && tokens.accessToken) ({ email, emailVerified } = await userinfoEmail(d, tokens.accessToken, login.subject));
      // Only a verified e-mail links a login to a person, and a login without one is not accepted at all.
      if (!email || !emailVerified) return refuse(c, "unverified_email", locale, drop);

      const db = c.env.DB;
      const linked = await personOfIdentity(db, login.issuer, login.subject);
      let userId = linked?.user_id ?? null;
      if (!userId) {
        const p = await personOfEmail(db, email);
        if (!p || (await hasOtherIdentity(db, p.id, login.issuer, login.subject))) return refuse(c, "no_person", locale, drop);
        userId = p.id;
      }
      // The person's memberships that can act; none means no access, and nothing is linked or created.
      const ms = (await activeMembershipsOfUser(db, userId)).filter(actsInApp);
      const first = ms[0];
      if (!first) return refuse(c, "no_membership", locale, drop);
      const now = Date.now();
      await linkIdentity(db, login.issuer, login.subject, userId, isoAt(now));

      // A login replaces any session this browser had: a new ID every time, so an ID planted before cannot be used.
      const prev = await sessionOf(db, getCookie(c, SESSION_COOKIE));
      if (prev) await deleteSession(db, prev.id_hash);
      // A person with several memberships lands in the first org and switches in the account menu.
      const sid = await createSession(db, { userId, org: first.org_id, membershipId: first.id, idToken: tokens.idToken }, now);
      await logSessionEvent(c.env, first, null, "session.login", "přihlásil(a) se", c.req.header("cf-ray") ?? null);
      const cookies = [...drop, cookie(SESSION_COOKIE, sid, SESSION_MAX_MS / 1000)];
      if (tx.popup) return page("done", locale, null, cookies);
      return redirect(safeReturnPath(tx.to), cookies, 303);
    } catch (e) {
      if (!(e instanceof OidcError)) throw e;
      logFailure(c, e);
      return page(e.kind, locale, retryTo, drop);
    }
  })

  // Same-origin only (CSRF): another site cannot log the user out. Answers JSON with where to go next, because the
  // app's content security policy (form-action 'self') would stop a form post that redirects to the IdP.
  .post("/logout", sameOrigin(), async (c) => {
    const db = c.env.DB;
    const s = c.env.AUTH_MODE === "oidc" ? await sessionOf(db, getCookie(c, SESSION_COOKIE)) : null;
    let next = "/";
    if (s) {
      await deleteSession(db, s.id_hash);
      try {
        const cfg = oidcConfig(c.env);
        next = endSessionUrl(await discover(cfg), cfg, s.id_token, `${new URL(c.req.url).origin}/`) ?? "/";
      } catch (e) {
        // The local session is gone either way; without the IdP's logout the user lands on the app, which logs in.
        if (!(e instanceof OidcError)) throw e;
        logFailure(c, e);
      }
    }
    const r = c.json({ redirect: next });
    r.headers.append("set-cookie", clearCookie(SESSION_COOKIE));
    r.headers.set("cache-control", "no-store");
    return r;
  });

function refuse(c: Context<AppEnv>, reason: string, locale: PageLocale, cookies: string[]): Response {
  logFailure(c, new OidcError("failed", reason));
  return page("no_access", locale, null, cookies);
}
