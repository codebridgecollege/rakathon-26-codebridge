import { Hono } from "hono";
import type { AppEnv } from "./types";
import { onError, notFound } from "./http/errors";
import { sameOrigin } from "./http/origin";
import { auth } from "./auth/middleware";
import { health } from "./routes/health";
import { summarize } from "./routes/summarize";
import { stt } from "./routes/stt";

// Static files (the built mock) are served by the assets binding before this code runs; only /api/* reaches it.
const app = new Hono<AppEnv>().basePath("/api");
// Nothing under /api may be cached by the browser or an intermediary: answers can carry case text.
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.route("/health", health); // public: no data, tells the page which features this host has
app.use("*", auth()); // everything below needs a user (demo: anonymous demo user)
app.use("*", sameOrigin()); // non-GET from another origin is refused (CSRF and quota abuse)
app.route("/summarize", summarize);
app.route("/stt", stt);
app.notFound(notFound);
app.onError(onError);

export default app;
