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

// The data routes (step 2) resolve the person from the directory first; listed by path so an unknown /api path
// still answers the plain JSON 404 instead of touching the database.
const DATA_PATHS = ["/me", "/staff", "/patients", "/cases/*", "/documents/*", "/tasks", "/calendar", "/admin/*"];

// Static files (the built mock) are served by the assets binding before this code runs; only /api/* reaches it.
const app = new Hono<AppEnv>().basePath("/api");
// Nothing under /api may be cached by the browser or an intermediary: answers can carry case text.
app.use("*", async (c, next) => {
  await next();
  // A route may set its own private policy (page images); everything else is never stored.
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
});
app.route("/health", health); // public: no data, tells the page which features this host has
app.use("*", auth()); // everything below needs a user (demo: anonymous demo user)
app.use("*", sameOrigin()); // non-GET from another origin is refused (CSRF and quota abuse)
app.route("/summarize", summarize);
app.route("/stt", stt);
for (const p of DATA_PATHS) app.use(p, viewer());
app.route("/", directory);
app.route("/", cases);
app.route("/", pages);
app.route("/", work);
app.route("/", admin);
app.notFound(notFound);
app.onError(onError);

export default app;
