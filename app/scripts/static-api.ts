// The static copy's /api (`npm run dev:static`, app/README.md "Static copy"): `nuxt dev` answers every API request from
// the answers app/scripts/record-static.mjs recorded into app/static-demo/, so UI work needs no Worker, database or keys.
// Reads answer as recorded; writes are refused with a Czech message, because nothing here can store them.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

type Entry = { file: string; type: string; status: number };

const DIR = path.join(import.meta.dirname, "..", "static-demo");

export function staticApi() {
  const index = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8")) as Record<string, Entry>;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  // Mounted at /api, so req.url is the rest ("/cases/NO-010?via=link").
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (req.method !== "GET") {
      return json(res, 503, { error: { code: "static_copy", message_cs: "Statická kopie: změny se neukládají (není připojený server)." } });
    }
    // The exact request first, then the same path without its query (a list filtered or paged differently).
    const hit = index[url] ?? index[url.split("?")[0]!];
    if (!hit) return json(res, 404, { error: { code: "not_found", message_cs: "Statická kopie tato data nemá." } });
    res.statusCode = hit.status;
    res.setHeader("content-type", hit.type);
    res.end(readFileSync(path.join(DIR, "api", hit.file)));
  };
}
