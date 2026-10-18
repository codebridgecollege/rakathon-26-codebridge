// "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md), as S.phone and phoneOpen()...phoneEnd() in the old page. The
// server opens an upload session for one case and answers its token once; the QR code carries
// <origin>/u#<token> (the part after "#" never reaches a server, and the token is never shown as text). While the
// dialog is open the page asks every 1.5 s what the phone sent, and the files join the case's upload list (or the
// intake's), marked "z telefonu". Closing the dialog, a closed tab and a user switch end the session.
import { defineStore } from "pinia";
import { shallowRef, reactive } from "vue";
import type { UploadDoc, UploadSessionPoll, UploadTarget } from "@codebridge/api-client";
import { ApiError } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { refused } from "../lib/refused";
import { useIntakeStore } from "./intake";
import { useUploadsStore } from "./uploads";
import { useToastStore } from "./toast";

export const PHONE_POLL_MS = 1500;
// After the end, a file whose upload was already under way still lands; the page looks once more after this pause.
export const PHONE_LAST_LOOK_MS = 3000;

export type PhoneSession = {
  target: UploadTarget;
  caseId: string;
  // The list row's file of the case, for the case's upload list; null for an intake.
  file: string | null;
  state: "loading" | "open" | "full" | "expired" | "closed";
  id: string | null;
  url: string | null;
  expires: number | null;
  docs: UploadDoc[];
  seen: Set<string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


export const usePhoneStore = defineStore("phone", () => {
  const current = shallowRef<PhoneSession | null>(null);
  // Once per store, which the app creates once.
  let unloadHooked = false;

  // Opens the dialog for one case. The caller decides that this user may upload there (the upload zone is shown).
  async function open(target: UploadTarget, caseId: string, file: string | null = null) {
    if (current.value || !caseId) return;
    hookUnload();
    const ph: PhoneSession = reactive({ target, caseId, file, state: "loading", id: null, url: null, expires: null, docs: [], seen: new Set<string>() }) as PhoneSession;
    current.value = ph;
    let r;
    // A short outage at the venue is retried before the dialog gives up.
    for (let i = 0; i < 3 && !r; i++) {
      try {
        r = await useApi().createUploadSession({ case_id: caseId, target });
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        if (status || i === 2) {
          if (current.value === ph) {
            current.value = null;
            refused(e);
          }
          return;
        }
        await sleep(800 * (i + 1));
      }
    }
    if (!r) return;
    // Closed while the code was being made: the session goes at once.
    if (current.value !== ph) {
      void useApi().deleteUploadSession(r.data.id).catch(() => {});
      return;
    }
    Object.assign(ph, { id: r.data.id, url: `${location.origin}/u#${r.data.token}`, expires: Date.parse(r.data.expires_at), state: "open" });
    void poll(ph);
  }

  async function poll(ph: PhoneSession) {
    while (current.value === ph && ph.state === "open") {
      await sleep(PHONE_POLL_MS);
      if (current.value !== ph) return;
      await look(ph);
    }
  }

  async function look(ph: PhoneSession) {
    let d: UploadSessionPoll;
    try {
      d = await useApi().uploadSession(ph.id!);
    } catch {
      return;
    }
    merge(ph, d.documents || []);
    if (current.value !== ph) return;
    // An intake discarded elsewhere ends the session; the dialog simply closes.
    if (d.state === "closed") {
      close();
      return;
    }
    if (d.state !== ph.state) ph.state = d.state;
  }

  // New files from the phone join the list the desktop already shows, once each.
  function merge(ph: PhoneSession, docs: UploadDoc[]) {
    const fresh = docs.filter((d) => !ph.seen.has(d.id));
    if (!fresh.length) return;
    for (const d of fresh) ph.seen.add(d.id);
    ph.docs.push(...fresh);
    if (ph.target === "intake") useIntakeStore().addPhoneDocs(ph.caseId, fresh);
    else if (ph.file) useUploadsStore().addPhoneDocs(ph.file, fresh);
    for (const d of fresh) if (d.identity === "conflicts" && d.identity_cs) useToastStore().show({ text: d.identity_cs });
  }

  // "Hotovo", "Zavřít" and a user switch: the session ends on the server, then the page looks once more.
  function close() {
    const ph = current.value;
    if (!ph) return;
    current.value = null;
    if (ph.id) void end(ph);
  }

  async function end(ph: PhoneSession) {
    // Sent before anything is awaited, so it leaves under the user who opened the session: a user switch changes the
    // demo user right after this call, and the server treats another user's session as missing.
    const ended = useApi().deleteUploadSession(ph.id!).catch(() => {
      // It expires within 15 minutes anyway.
    });
    await ended;
    await look(ph);
    await sleep(PHONE_LAST_LOOK_MS);
    await look(ph);
    if (ph.target !== "intake" && ph.file) void useUploadsStore().load({ file: ph.file, id: ph.caseId }, true);
  }

  // "Nový kód" after the code expired or took the most files.
  function renew() {
    const ph = current.value;
    if (!ph) return;
    current.value = null;
    if (ph.id) void useApi().deleteUploadSession(ph.id).catch(() => {});
    void open(ph.target, ph.caseId, ph.file);
  }

  // A closed tab ends its session too, instead of leaving the code valid for 15 minutes.
  function hookUnload() {
    if (unloadHooked || typeof window === "undefined") return;
    unloadHooked = true;
    window.addEventListener("pagehide", () => {
      const ph = current.value;
      if (ph?.id) useApi().deleteUploadSessionOnUnload(ph.id);
    });
  }

  return { current, open, close, renew };
});
