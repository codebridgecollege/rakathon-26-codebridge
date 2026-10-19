// Documents added to a case by hand (PRODUCT.md F-34: "Dokumenty" in "Projednání na MDT", and the documents tab's
// upload dialog). Each file goes to POST /cases/:id/documents as its own
// request. The server keeps the content of a prepared synthetic document only and lists any other file by name and
// size, so every file shows as "Nahráno". A row appears at once and takes the server's answer when it comes; a file the
// server did not take (unreachable, busy) stays listed in this tab only, so the meeting never sees an upload error.
import { defineStore } from "pinia";
import { reactive } from "vue";
import { ApiError, type DocAlert, type DocPart, type UploadDoc, type WithdrawReason } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { msgId } from "../lib/msg";
import { refused } from "../lib/refused";
import { clock } from "../lib/format";
import { useSessionStore } from "./session";
import { useToastStore } from "./toast";

// A row of the list: the server's document, or a local row (id "local-...") until the server answers.
export type UploadRow = Partial<UploadDoc> & { parts?: DocPart[]; alerts?: DocAlert[] } & { id: string; name: string; size: number | null; uploaded_by: string | null; when?: string; local?: boolean };
export type UploadList = { docs: UploadRow[]; loaded: boolean; loading: boolean; retryAt: number };
// The case a list belongs to: the list row's file (the key of every per-case map) and the server's case id.
export type UploadCase = { file: string; id: string };

const RETRY_MS = 5000;

export const useUploadsStore = defineStore("uploads", () => {
  const lists = reactive(new Map<string, UploadList>());
  // Bumped on reset, so a load or an upload of the previous user cannot write into the new lists.
  let gen = 0;
  // Cases whose list is to be read again once the running load ends.
  const again = new Set<string>();

  function listOf(file: string): UploadList {
    let u = lists.get(file);
    if (!u) {
      lists.set(file, { docs: [], loaded: false, loading: false, retryAt: 0 });
      u = lists.get(file)!;
    }
    return u;
  }

  // The rows of a case for a view, without creating an entry.
  const docsOf = (file: string): UploadRow[] => lists.get(file)?.docs ?? [];

  // Reads the case's uploaded documents once (GET /cases/:id/documents, an access-log row on the server). A failure
  // leaves the panel usable and is retried after a pause, on the next view.
  async function load(p: UploadCase, force = false) {
    const u = listOf(p.file);
    // A forced load during a running one (two readings ending close together) runs once more afterwards, so the later
    // state is not lost to a list read before it.
    if (u.loading && force) {
      again.add(p.file);
      return;
    }
    if (u.loading || (u.loaded && !force) || Date.now() < u.retryAt) return;
    u.loading = true;
    const g = gen;
    try {
      const r = await useApi().documents(p.id);
      if (g !== gen) return;
      const server = r.documents.filter((d) => d.origin === "upload");
      const ids = new Set(server.map((d) => d.id));
      // Rows this tab added meanwhile (local, or answered after the list was read) stay.
      u.docs = [...server, ...u.docs.filter((d) => !ids.has(d.id))];
      u.loaded = true;
    } catch {
      if (g === gen) u.retryAt = Date.now() + RETRY_MS;
    } finally {
      if (g === gen) u.loading = false;
    }
    if (g === gen && again.delete(p.file)) await load(p, true);
  }

  async function add(p: UploadCase, files: File[]) {
    if (!files.length) return;
    const u = listOf(p.file);
    const g = gen;
    const when = clock(Date.now(), document.documentElement.lang || "cs");
    const who = useSessionStore().me?.user.name ?? null;
    const rows: UploadRow[] = files.map((f) => ({ id: `local-${useApi().newKey()}`, name: f.name, size: f.size, uploaded_by: who, when, local: true }));
    u.docs.push(...rows);
    useToastStore().show(msgId("uploads-added", { n: files.length }));
    for (const [i, f] of files.entries()) {
      const rowId = rows[i]!.id;
      let d: UploadDoc;
      try {
        d = (await useApi().uploadDocument(p.id, f, f.name)).data.document;
      } catch (e) {
        if (e instanceof ApiError && e.code === "data_reset") return;
        continue;
      }
      if (g !== gen) return;
      const at = u.docs.findIndex((x) => x.id === rowId);
      // Removed while it was on its way: the server's copy goes too.
      if (at < 0) {
        if (!u.docs.some((x) => x.id === d.id)) void useApi().deleteDocument(d.id).catch(() => {});
        continue;
      }
      // The server answers a repeat with the document it already lists; a seeded document is the case's own record and
      // not part of this list.
      if (d.origin !== "upload" || u.docs.some((x) => x.id === d.id)) u.docs.splice(at, 1);
      else u.docs.splice(at, 1, d);
      if (d.identity === "conflicts" && d.identity_cs) useToastStore().show({ text: d.identity_cs });
    }
  }

  async function remove(p: UploadCase, id: string) {
    const u = listOf(p.file);
    if (!id.startsWith("local-")) {
      try {
        await useApi().deleteDocument(id);
      } catch (e) {
        refused(e);
        return;
      }
    }
    u.docs = u.docs.filter((d) => d.id !== id);
  }

  // A processed upload leaves the case; the row stays with its reason (the server's answer replaces it).
  async function withdraw(p: UploadCase, id: string, reason: WithdrawReason) {
    const u = listOf(p.file);
    try {
      const r = await useApi().withdrawDocument(id, reason);
      u.docs = u.docs.map((d) => (d.id === id ? { ...d, ...r.data.document } : d));
    } catch (e) {
      refused(e);
    }
  }

  // Files the phone sent into a case (phone store), once each.
  function addPhoneDocs(file: string, docs: UploadDoc[]) {
    const u = listOf(file);
    for (const d of docs) if (!u.docs.some((x) => x.id === d.id)) u.docs.push(d);
  }

  // A user switch: the lists were read under the previous user's access.
  function reset() {
    gen++;
    lists.clear();
  }

  return { lists, docsOf, listOf, load, add, remove, withdraw, addPhoneDocs, reset };
});
