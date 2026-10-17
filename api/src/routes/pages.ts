import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { audit } from "../middleware/audit";
import { isEmptyPage } from "../domain/rows";
import { openCase } from "./access-check";

type StoredPage = {
  n: number;
  size: [number, number];
  text: string;
  engine: string;
  words: unknown[];
  mean_conf: number | null;
  low_conf_words: number | null;
  verify: unknown[];
  redacted: { count: number; reasons: string[] } | null;
};

// Resolves document and page, then checks access to the case the document belongs to (clinical content).
async function openPage(c: Context<AppEnv>) {
  const docId = c.req.param("id")!;
  const n = Number(c.req.param("n"));
  if (!Number.isInteger(n) || n < 1) throw E.pageNotFound();
  const doc = await c.var.stores.cases.documentById(docId);
  if (!doc) throw E.pageNotFound();
  await openCase(c, doc.case_id, "clinical");
  const pages = await c.var.stores.cases.pages(docId);
  const page = pages.find((p) => p.n === n);
  if (!page) throw E.pageNotFound();
  return { doc, pages, page, n };
}

const imageUrl = (docId: string, n: number, redacted = false) =>
  `/api/documents/${encodeURIComponent(docId)}/pages/${n}/image${redacted ? "?redacted=1" : ""}`;

export const pages = new Hono<AppEnv>()
  // One page for the source viewer: the same object srcApi.page() built in the browser, plus the page list.
  // The quote is matched in the browser on this page's words, so it never reaches the server or its logs.
  .get("/documents/:id/pages/:n", async (c) => {
    const { doc, pages: all, page, n } = await openPage(c);
    await audit(c, { action: "source.view", case_id: doc.case_id, document_id: doc.id, page_n: n, what_cs: `zobrazil(a) zdroj s. ${n}` });
    const pg = await c.var.stores.blobs.getJson<StoredPage>(page.json_r2_key);
    if (!pg) throw E.dataUnavailable();
    return c.json({
      file: doc.file_name,
      document_id: doc.id,
      case_id: doc.case_id,
      n,
      of: all.length,
      doc_title: doc.parts.find((p) => p.pages.includes(n))?.title_cs ?? null,
      image: imageUrl(doc.id, n),
      size: pg.size,
      text: pg.text,
      engine: pg.engine,
      empty: isEmptyPage(pg.text),
      mean_conf: pg.mean_conf,
      low_conf_words: pg.low_conf_words,
      words: pg.words,
      // Raw: the page applies verifyOf() as it did on the embedded data.
      verify: pg.verify,
      redacted: pg.redacted && page.redacted_r2_key ? { image: imageUrl(doc.id, n, true), ...pg.redacted } : null,
      pages: all.map((p) => ({ n: p.n, empty: p.is_empty === 1 })),
    });
  })
  .get("/documents/:id/pages/:n/image", async (c) => {
    const { doc, page, n } = await openPage(c);
    const redacted = c.req.query("redacted") === "1";
    const key = redacted ? page.redacted_r2_key : page.image_r2_key;
    if (!key) throw E.pageNotFound();
    await audit(c, {
      action: "source.image",
      case_id: doc.case_id,
      document_id: doc.id,
      page_n: n,
      what_cs: `načetl(a) obrázek s. ${n}${redacted ? " (začerněná verze)" : ""}`,
    });
    const o = await c.var.stores.blobs.getStream(key);
    if (!o) throw E.dataUnavailable();
    // The viewer re-renders its <img> on every zoom or tab change; a short private cache keeps that from fetching
    // (and logging) the same image again. Only this browser may keep it, and only for five minutes.
    return c.body(o.body, 200, { "Content-Type": o.contentType, "Cache-Control": "private, max-age=300" });
  });
