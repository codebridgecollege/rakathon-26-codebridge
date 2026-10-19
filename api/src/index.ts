import { Hono } from "hono";
import type { AppEnv } from "./types";
import { onError, notFound } from "./http/errors";
import { sameOrigin } from "./http/origin";
import { auth } from "./auth/middleware";
import { health } from "./routes/health";
import { summarize } from "./routes/summarize";
import { stt } from "./routes/stt";
import { viewer } from "./middleware/viewer";
import { directory } from "./routes/directory";
import { cases } from "./routes/cases";
import { pages } from "./routes/pages";
import { work } from "./routes/work";
import { admin } from "./routes/admin";
import { writeGuard } from "./middleware/write-guard";
import { writeCases } from "./routes/write-cases";
import { writeWork } from "./routes/write-work";
import { writeStaff } from "./routes/write-staff";
import { demo } from "./routes/demo";
import { transcript } from "./routes/transcript";
import { documents } from "./routes/documents";
import { intake } from "./routes/intake";
import { pipeline } from "./routes/pipeline";
import { nis } from "./routes/nis";
import { phoneUpload, uploadSessions } from "./routes/upload-sessions";
import { sweep } from "./scheduled";
import { authRoutes } from "./routes/auth";
import { session } from "./routes/session";

export { SpeakerPassWorkflow } from "./workflows/speaker-pass";
export { ProcessDocumentWorkflow } from "./workflows/process-document";
export { ExtractDocumentWorkflow } from "./workflows/extract-document";
export { ProcessCaseWorkflow } from "./workflows/process-case";

// The data routes (step 2) resolve the person from the directory first; listed by path so an unknown /api path
// still answers the plain JSON 404 instead of touching the database.
// Hono's "/x/*" also matches "/x", so each prefix is listed once; a second pattern would run the middleware twice.
const DATA_PATHS = [
  "/me", "/staff/*", "/patients", "/cases/*", "/documents/*", "/tasks/*", "/calendar", "/admin/*",
  "/workflow", "/audit/*", "/suggestions/*", "/notifications/*", "/sessions/*", "/attendance/*", "/recordings/*", "/jobs/*", "/fhir/*",
  "/upload-sessions/*", "/demo/*",
];

// Static files (the built app) are served by the assets binding before this code runs; only /api/* and /auth/* reach it
// (wrangler.jsonc, run_worker_first).
const app = new Hono<AppEnv>().basePath("/api");
// Nothing under /api may be cached by the browser or an intermediary: answers can carry case text.
app.use("*", async (c, next) => {
  await next();
  // A route may set its own private policy (page images); everything else is never stored.
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
  // Page images and uploaded originals come from here too: the browser must take the declared type, never guess one.
  // The static files get the same header from .assets/_headers (scripts/headers.mjs).
  c.header("X-Content-Type-Options", "nosniff");
});
app.route("/health", health); // public: no data, tells the page which features this host has
// The phone of an upload session is not logged in; its token is the credential (routes/upload-sessions.ts). Its two
// routes answer before the login and viewer middleware, which would otherwise act as the default demo user.
app.route("/", phoneUpload);
app.use("*", auth()); // everything below needs a user (demo: anonymous demo user)
app.use("*", sameOrigin()); // non-GET from another origin is refused (CSRF and quota abuse)
// The org and role switches of a login session (OIDC mode); they act on the session, not on case data.
app.route("/", session);
app.route("/summarize", summarize);
app.route("/stt", stt);
for (const p of DATA_PATHS) app.use(p, viewer());
// Step 4: every data write (POST, PUT, PATCH, DELETE) checks JSON, size and the demo's data epoch, and logs refusals.
for (const p of DATA_PATHS) app.use(p, writeGuard());
app.route("/", directory);
app.route("/", cases);
app.route("/", pages);
app.route("/", work);
app.route("/", admin);
app.route("/", writeCases);
app.route("/", writeWork);
app.route("/", writeStaff);
app.route("/", demo);
app.route("/", transcript);
app.route("/", documents);
app.route("/", intake);
app.route("/", pipeline);
app.route("/", nis);
app.route("/", uploadSessions);
app.notFound(notFound);
app.onError(onError);

// The login (docs/design/AUTH.md): redirects and a few fixed pages, no JSON data, so it sits apart from /api.
const login = new Hono<AppEnv>().basePath("/auth").route("/", authRoutes);
login.notFound(notFound);
login.onError(onError);

// fetch serves the login and the API; scheduled runs the sweeps (audio, step 5; expired sessions).
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => (new URL(req.url).pathname.startsWith("/auth/") ? login : app).fetch(req, env, ctx),
  scheduled: (_ev: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(sweep(env).then(() => undefined)),
} satisfies ExportedHandler<Env>;
