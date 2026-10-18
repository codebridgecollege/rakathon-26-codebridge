// Attendance per seminar day ("Přítomní lékaři"), as attFor(), attChanged() and applyAtt() in the old page. A day's
// list applies to every case that day; a case without a slot has its own list, keyed "case:<case id>" as on the
// server. The server's sets live in the workflow store (att); this store holds only rows this page changed and has
// not seen stored yet, plus empty rows added with "+ další", so the server stays the source of what is shown.
// Changes of one set go out one request at a time, each built from the rows when it leaves; a refusal puts back the
// rows the server last stored.
import { defineStore } from "pinia";
import { reactive, watch } from "vue";
import { ApiError, type AttSet } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { errMsg } from "../lib/msg";
import { useToastStore } from "./toast";
import { useSessionStore } from "./session";
import { useStaffStore } from "./staff";
import { useWorkflowStore } from "./workflow";

export type Rows = Record<string, string[]>;
type Queue = { n: number; gen: number; chain: Promise<void> };

export const useAttendanceStore = defineStore("attendance", () => {
  const local = reactive<Record<string, Rows>>({});
  const queues: Record<string, Queue> = {};

  // Every department has at least one (possibly empty) row, so its select can be drawn; a department added on the
  // staff screen after the day's list was started gets an empty row too.
  function withPlaceholders(by: Rows): Rows {
    const out: Rows = {};
    for (const d of useStaffStore().depts) out[d.name] = by[d.name]?.length ? [...by[d.name]!] : [""];
    for (const [d, xs] of Object.entries(by)) if (!out[d] && xs.length) out[d] = [...xs];
    return out;
  }

  // A newer stored set (another user's change, a reload) replaces this page's rows unless a change is still queued.
  watch(
    () => Object.fromEntries(Object.entries(useWorkflowStore().att).map(([k, s]) => [k, s.version])),
    (now, before) => {
      for (const k of Object.keys(now)) if (now[k] !== before?.[k] && !queues[k]?.n) delete local[k];
    },
  );

  const serverSet = (key: string): AttSet | undefined => useWorkflowStore().att[key];
  const rowsOf = (key: string): Rows => local[key] ?? withPlaceholders(serverSet(key)?.byName ?? {});
  const present = (key: string) => Object.values(rowsOf(key)).flat().filter(Boolean);

  function edit(key: string, fn: (rows: Rows) => void): Rows {
    // A plain copy: the rows may be a reactive proxy, which structuredClone refuses.
    const rows: Rows = Object.fromEntries(Object.entries(rowsOf(key)).map(([d, xs]) => [d, [...xs]]));
    fn(rows);
    local[key] = rows;
    return rows;
  }

  // The server knows attendance by department id and user id; the rows hold names, looked up in the staff list.
  function bodyOf(key: string) {
    const rows = rowsOf(key);
    const by: Record<string, string[]> = {};
    for (const d of useStaffStore().depts) {
      const ids = (rows[d.name] ?? []).filter(Boolean).map((n) => d.people.find((x) => x.name === n)?.id).filter((x): x is string => !!x);
      if (ids.length) by[d.id] = ids;
    }
    return { version: serverSet(key)?.version ?? 0, by_dept: by };
  }

  // Sends the set's current rows after any request of the set still on its way. onRefused shows the refusal.
  function changed(key: string, onRefused: (e: unknown) => void) {
    const q = (queues[key] ??= { n: 0, gen: 0, chain: Promise.resolve() });
    q.n++;
    const gen = q.gen;
    q.chain = q.chain.then(async () => {
      // After a refusal the changes queued behind it were made on rows the server no longer holds; they are dropped.
      if (gen !== q.gen) return;
      try {
        const r = await useApi().putAttendance(key, bodyOf(key));
        q.n--;
        useSessionStore().applyState(r.state);
        // Nothing else queued: the stored set is what shows.
        if (!q.n) delete local[key];
      } catch (e) {
        q.n = 0;
        q.gen++;
        delete local[key];
        // A conflict carries the set as the server holds it now (another user's edit): it is shown with the server's
        // message, and nothing else needs reloading.
        if (e instanceof ApiError && e.code === "attendance_conflict" && (e.current as AttSet | undefined)?.byName) {
          useWorkflowStore().applyState({ att: { [key]: e.current as AttSet } });
          useToastStore().show(errMsg(e));
        } else onRefused(e);
      }
    });
  }

  function setRow(key: string, dept: string, k: number, name: string) {
    edit(key, (r) => {
      (r[dept] ??= [""])[k] = name;
    });
  }
  function addRow(key: string, dept: string) {
    edit(key, (r) => {
      (r[dept] ??= [""]).push("");
    });
  }
  // Returns the removed name; an empty row is the page's own placeholder, so only removing a person changes the set.
  function removeRow(key: string, dept: string, k: number): string {
    let was = "";
    edit(key, (r) => {
      was = (r[dept] ?? []).splice(k, 1)[0] ?? "";
    });
    return was;
  }

  // Resolves once every change of the set sent so far is answered; approval waits for it, so the server's list is the
  // one the frozen report names.
  const settled = (key: string): Promise<void> => queues[key]?.chain ?? Promise.resolve();

  return { local, rowsOf, present, setRow, addRow, removeRow, changed, settled };
});
