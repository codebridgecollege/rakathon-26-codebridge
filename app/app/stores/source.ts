// The source viewer's data: each page comes from the
// Worker right before the viewer shows it, every time, because each view of a page is an access the server records.
// Only the pages the viewer showed are held, in memory, never in browser storage.
import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { ApiError } from "@codebridge/api-client";
import { docIdOf, type SourceRef } from "@codebridge/domain/case-data";
import { useApi } from "../lib/api";
import { toast } from "../lib/toast";
import { errorText } from "../lib/writes";
import { useOverlayStore, type SourceOverlay } from "./overlay";
import { usePatientViewStore } from "./patientView";
import { useSessionStore } from "./session";

type T = (id: string, args?: Record<string, string | number>) => string;
// GET /documents/:id/pages/:n as it comes: the page (image, size, text, words, verify items, redacted image) plus the
// document's page list. Typed loosely: the viewer reads it by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PageReply = Record<string, any>;
export type DocPages = { file: string; case_id: string | null; pages: { n: number; empty?: boolean }[] };

export const useSourceStore = defineStore("source", () => {
  const pages = shallowReactive(new Map<string, PageReply>());
  const docs = shallowReactive(new Map<string, DocPages>());

  async function fetchPage(file: string, n: number) {
    const pg = await useApi().page(docIdOf(file), n);
    pages.set(`${file}|${n}`, pg);
    docs.set(file, { file, case_id: (pg.case_id as string) || null, pages: (pg.pages as DocPages["pages"]) || [] });
  }

  const pageOf = (file: string, n: number) => pages.get(`${file}|${n}`) ?? null;
  const docOf = (file: string) => docs.get(file) ?? null;

  // Opens a reference: a reference without a file points into the open case. The cited page loads first; a cited page
  // the document does not have opens its first page.
  async function openSource(t: T, r: SourceRef, fallbackFile: string) {
    const ov = useOverlayStore();
    const o: SourceOverlay = { kind: "source", cite: r, file: r.file || fallbackFile, page: Number(r.page) || 1, tab: usePatientViewStore().srcTab, zoom: "fit", redacted: false, loading: true };
    ov.open(o);
    try {
      try {
        await fetchPage(o.file, o.page);
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "page_not_found" || o.page === 1) throw e;
        o.page = 1;
        await fetchPage(o.file, 1);
      }
    } catch (e) {
      if (ov.isOpen(o)) ov.close();
      toast(e instanceof ApiError && e.code === "page_not_found" ? t("patient-src-unavailable") : errorText(t, e));
      return;
    }
    // A late reply for a viewer the doctor already closed is dropped.
    if (!ov.isOpen(o)) return;
    // A document without page images cannot be shown; say so instead of opening an empty viewer.
    if (!docOf(o.file)?.pages.length) {
      ov.close();
      toast(t("patient-src-unavailable"));
      return;
    }
    ov.update(o, { loading: false });
  }

  async function gotoPage(t: T, o: SourceOverlay, n: number) {
    const ov = useOverlayStore();
    ov.update(o, { loading: true });
    try {
      await fetchPage(o.file, n);
    } catch (e) {
      ov.update(o, { loading: false });
      toast(errorText(t, e));
      return;
    }
    ov.update(o, { loading: false, page: n });
  }

  // A user switch: what the previous user saw goes with it, and a viewer open over the case closes.
  function reset() {
    pages.clear();
    docs.clear();
  }
  useSessionStore().onBeforeUserSwitch(() => {
    reset();
    useOverlayStore().close();
  });

  return { pages, docs, pageOf, docOf, openSource, gotoPage, reset };
});
