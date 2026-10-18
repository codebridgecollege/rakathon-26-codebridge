// "Nový pacient" (PRODUCT.md F-02): the three-step dialog and the intake on the server.
// - Step 1, the referral: the form's checks before any request, the FHIR import through the server, a birth number
//   already in the list warns with a link and needs "Přesto vytvořit nový záznam" (never a silent second record).
//   "Pokračovat" creates the case open for intake (POST /cases, intake: true), visible only to this user until done.
// - Step 2, the documents: every file is listed at once as "Nahráno" and goes to the intake as its own upload; the
//   server keeps a prepared synthetic document's content and lists any other file by name and size, so nothing is
//   refused in the demo. A document of another patient is flagged on its row.
// - Step 3, processing: the stages tick by while the uploads finish, then the server's verdict (GET .../intake) decides
//   the closing sentence, and "Přidat do databáze" completes the intake.
// Closing the dialog, going back to the referral, navigating away or switching the user discards the open intake and
// its files on the server.
import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef } from "vue";
import { ApiError, type IntakeStatus, type NewCaseBody, type UploadDoc } from "@codebridge/api-client";
import { duplicateOf, normalizeRc, referralProblems } from "@codebridge/domain/referral";
import { useApi } from "../lib/api";
import { errMsg, msgId, type Msg } from "../lib/msg";
import { refused } from "../lib/refused";
import type { IntakeDemo, IntakeHint } from "../lib/intake-demo";
import { usePatientsStore } from "./patients";
import { useSessionStore } from "./session";
import { useToastStore } from "./toast";
import { usePhoneStore } from "./phone";

// The form's fields under fixed ids (nf0...), which are also the field names the server's FHIR import answers
// with (FORM_FIELD in packages/domain/src/fhir.ts).
export type IntakeForm = {
  nf0: string; nf1: string; nf2: string; nf3: string; nf4: string; nf5: string; nf6: string; nf7: string; nfa: string; nfq: string;
  nfg: boolean;
};
export type FieldId = keyof IntakeForm;
export type IntakeFile = { key: number; name: string; size: number; doc?: UploadDoc };

const emptyForm = (): IntakeForm => ({ nf0: "", nf1: "", nf2: "", nf3: "", nf4: "", nf5: "", nf6: "", nf7: "", nfa: "", nfq: "", nfg: false });
// The server's field names in its refusals, mapped to the form's ids.
const NF_FIELD: Record<string, FieldId> = { first_name: "nf0", last_name: "nf1", birth_number: "nf2", consent: "nfg", question: "nfq", owner: "nf4", dept: "nf5" };
const PROBLEM_MSG = {
  first_name: { missing: "intake-error-first-name" },
  last_name: { missing: "intake-error-last-name" },
  birth_number: { missing: "intake-error-birth-number", format: "intake-error-birth-number-format" },
  consent: { missing: "intake-error-consent" },
} as const;
export const PIPELINE_STAGES = 4;
const rcKey = (v: string) => normalizeRc(v.trim());

// Where the dialog sends the user afterwards. The patient screens are ported separately; they replace these with
// their own navigation (setNavigation), so this store never depends on them.
export type IntakeNavigation = { openPatient: (file: string) => void; showList: () => void };

export const useIntakeStore = defineStore("intake", () => {
  const isOpen = ref(false);
  const step = ref<0 | 1 | 2>(0);
  const form = reactive<IntakeForm>(emptyForm());
  const errs = ref<Partial<Record<FieldId, Msg>>>({});
  // A birth number already in the database: the existing row's file (a case this user sees) or only its case id
  // (the server found one this user may not see).
  const dup = ref<string | null>(null);
  const dupId = ref<string | null>(null);
  // The confirmed second record, for the birth number it was given only.
  let override: { birth_number: string } | null = null;
  let dupOk: string | null = null;
  const fhirOpen = ref(false);
  const fhirText = ref("");
  const fhirMsg = ref<Msg | null>(null);
  let referralSha: string | null = null;
  const caseId = ref<string | null>(null);
  const files = ref<IntakeFile[]>([]);
  const verdict = ref<IntakeStatus | { ready: false } | null>(null);
  const progress = ref(0);
  const busy = ref(false);
  const completed = ref(false);
  // Loaded with the dialog: the demo patient's hints and the FHIR sample (lib/intake-demo.ts).
  const demo = shallowRef<{ INTAKE_DEMO: IntakeDemo; intakeHint: typeof import("../lib/intake-demo").intakeHint; fhirSampleText: () => Promise<string> } | null>(null);
  let idem: string | null = null;
  let idemSig: string | null = null;
  // Uploads and removals run one after another; "Zpracovat" and "Přidat do databáze" wait for them.
  let pending: Promise<unknown> = Promise.resolve();
  // A new referral waits for the discard of the previous intake, so it never meets its own discarded draft.
  let discarding: Promise<unknown> | null = null;
  // The POST /cases on its way, if any.
  let creating: Promise<unknown> | null = null;
  let fileSeq = 0;
  // Bumped on every open and close, so a timer or reply of an earlier dialog cannot write into this one.
  let gen = 0;

  let nav: IntakeNavigation = { openPatient: () => {}, showList: () => {} };
  function setNavigation(n: IntakeNavigation) {
    nav = n;
  }

  const hint = computed<IntakeHint | null>(() =>
    demo.value ? demo.value.intakeHint(form, files.value.map((f) => f.name), usePatientsStore().rows.map((r) => r.file), demo.value.INTAKE_DEMO) : null,
  );
  const dupRow = computed(() => (dup.value ? usePatientsStore().byFile(dup.value) ?? null : null));

  // Only doctors and the coordinator create patients; anyone else gets a note instead of the dialog.
  async function open(): Promise<boolean> {
    const role = useSessionStore().me?.user.role;
    if (role !== "doctor" && role !== "coordinator") {
      useToastStore().show(msgId("intake-only-doctor-or-coordinator"));
      return false;
    }
    if (isOpen.value) return true;
    gen++;
    Object.assign(form, emptyForm());
    errs.value = {};
    dup.value = dupId.value = null;
    override = null;
    dupOk = null;
    fhirOpen.value = false;
    fhirText.value = "";
    fhirMsg.value = null;
    referralSha = null;
    caseId.value = null;
    files.value = [];
    verdict.value = null;
    progress.value = 0;
    busy.value = false;
    completed.value = false;
    idem = idemSig = null;
    pending = Promise.resolve();
    step.value = 0;
    isOpen.value = true;
    if (!demo.value) demo.value = await import("../lib/intake-demo");
    return true;
  }

  // Closing discards the open intake (the server removes an abandoned one after 24 hours anyway).
  function close() {
    if (!isOpen.value) return;
    discard();
    gen++;
    isOpen.value = false;
  }

  function discard() {
    if (!caseId.value || completed.value) return;
    const id = caseId.value;
    caseId.value = null;
    files.value = [];
    verdict.value = null;
    pending = Promise.resolve();
    const phone = usePhoneStore();
    if (phone.current?.caseId === id) phone.close();
    discarding = useApi().discardIntake(id).catch(() => {});
  }

  // A user switch: the open intake belongs to the user who opened it, so it goes first, and the switch waits for it.
  async function closeForUserSwitch() {
    if (!isOpen.value) return;
    // A referral on its way is answered first, so its case is discarded under the user who made it.
    const inFlight = creating;
    close();
    await inFlight;
    await discarding;
  }

  // ---------- step 1: the referral ----------

  function setFhirOpen(on: boolean) {
    fhirOpen.value = on;
    fhirMsg.value = null;
  }

  async function fhirSample() {
    if (!demo.value) demo.value = await import("../lib/intake-demo");
    fhirText.value = await demo.value.fhirSampleText();
  }

  // The server reads the bundle and logs the import; the form takes the fields it found and never the consent.
  async function fhirImport(text: string) {
    fhirText.value = text;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      fhirMsg.value = msgId("intake-fhir-bad-json");
      return;
    }
    const g = gen;
    try {
      const r = await useApi().fhirReferral(json);
      if (g !== gen) return;
      for (const [k, v] of Object.entries(r.data.fields)) if (k in form && k !== "nfg") (form as Record<string, unknown>)[k] = v;
      referralSha = r.data.referral_sha256;
      fhirOpen.value = false;
      fhirText.value = "";
      const found = r.data.found.join(", ");
      fhirMsg.value = r.data.missing_cs.length
        ? msgId("intake-fhir-loaded-missing", { found, missing: r.data.missing_cs.join(", ") })
        : msgId("intake-fhir-loaded", { found });
    } catch (e) {
      if (g === gen) fhirMsg.value = errMsg(e);
    }
  }

  // "Pokračovat" on the referral. Returns the first refused field, so the dialog can focus it.
  async function next(): Promise<FieldId | null> {
    if (step.value === 0) return submitReferral();
    if (step.value === 1) startProcessing();
    return null;
  }

  async function submitReferral(): Promise<FieldId | null> {
    // Typed values are kept, trimmed.
    for (const k of Object.keys(form) as FieldId[]) if (k !== "nfg") (form as Record<string, unknown>)[k] = (form[k] as string).trim();
    const problems = referralProblems({ first_name: form.nf0, last_name: form.nf1, birth_number: form.nf2, consent: form.nfg });
    const e: Partial<Record<FieldId, Msg>> = {};
    for (const [field, why] of problems) e[NF_FIELD[field]!] = msgId((PROBLEM_MSG[field] as Record<string, string>)[why]!);
    errs.value = e;
    if (problems.length) {
      dup.value = dupId.value = null;
      return NF_FIELD[problems[0]![0]]!;
    }
    const rc = rcKey(form.nf2);
    const d = duplicateOf(form.nf2, usePatientsStore().rows);
    if (d && dupOk !== rc) {
      dup.value = d.file;
      return null;
    }
    dup.value = dupId.value = null;
    if (!caseId.value) await createCase();
    else step.value = 1;
    return null;
  }

  function caseBody(): NewCaseBody {
    // The override holds only for the birth number it was given; a changed number is checked again.
    const ov = override && override.birth_number === rcKey(form.nf2) ? override : null;
    return {
      first_name: form.nf0,
      last_name: form.nf1,
      birth_number: form.nf2,
      consent: !!form.nfg,
      ...(form.nfq ? { question: form.nfq } : {}),
      ...(form.nf4 ? { owner: form.nf4 } : {}),
      ...(form.nf5 ? { dept: form.nf5 } : {}),
      intake: true,
      ...(referralSha ? { referral_sha256: referralSha } : {}),
      ...(ov ? { duplicate_override: ov } : {}),
    };
  }

  async function createCase() {
    if (busy.value) return;
    const g = gen;
    if (discarding) {
      busy.value = true;
      await discarding;
      discarding = null;
      busy.value = false;
      if (g !== gen) return;
    }
    const body = caseBody();
    const sig = JSON.stringify(body);
    // One key per referral; a retry of the same referral after a lost answer reuses it, a changed one gets a new key.
    if (idemSig !== sig) {
      idem = useApi().newKey();
      idemSig = sig;
    }
    busy.value = true;
    try {
      const req = useApi().createCase(body, idem!);
      creating = req.catch(() => {});
      const r = await req;
      if (g !== gen) {
        // The dialog was closed while the case was being made: it goes at once.
        if (r.data.intake) discarding = useApi().discardIntake(r.data.case_id).catch(() => {});
        return;
      }
      busy.value = false;
      caseId.value = r.data.case_id;
      step.value = 1;
      files.value = [];
      verdict.value = null;
      completed.value = false;
      dup.value = dupId.value = null;
    } catch (e) {
      if (g !== gen) return;
      busy.value = false;
      if (e instanceof ApiError && e.status) idem = idemSig = null;
      if (e instanceof ApiError && e.code === "duplicate_birth_number") {
        const cur = (e.current ?? {}) as { case_id?: string };
        step.value = 0;
        dup.value = (cur.case_id && usePatientsStore().byId(cur.case_id)?.file) || null;
        dupId.value = cur.case_id || "";
        override = null;
        errs.value = {};
        return;
      }
      if (e instanceof ApiError && e.fields) {
        const fe: Partial<Record<FieldId, Msg>> = {};
        for (const [k, m] of Object.entries(e.fields)) fe[NF_FIELD[k] ?? (k as FieldId)] = { text: m };
        errs.value = fe;
        step.value = 0;
        useToastStore().show(errMsg(e));
        return;
      }
      refused(e);
    }
  }

  // "Přesto vytvořit nový záznam": a second record for this birth number, made knowingly; the server logs it.
  async function confirmDuplicate() {
    const rc = rcKey(form.nf2);
    override = { birth_number: rc };
    // The server found the duplicate (a case this user may not see): the form is complete, so continue from here.
    if (!dup.value && dupId.value) {
      dupId.value = null;
      dupOk = rc;
      await createCase();
      return;
    }
    dupOk = rc;
    await next();
  }

  // The link in the duplicate warning: the existing patient instead of a new record.
  function openDuplicate() {
    const f = dup.value;
    close();
    if (f) nav.openPatient(f);
  }

  // ---------- step 2: the documents ----------

  const chain = (fn: () => Promise<unknown>) => {
    pending = pending.then(fn).catch(() => {});
  };

  // Every file is listed at once; a file with a name already listed is skipped with a note. Each goes to the intake
  // on the server as its own upload; a file the server did not take stays listed here only.
  function addFiles(list: File[]) {
    if (!isOpen.value || !list.length) return;
    const have = new Set(files.value.map((f) => f.name));
    const fresh = list.filter((f) => !have.has(f.name));
    const rows = fresh.map((f) => ({ key: ++fileSeq, name: f.name, size: f.size }));
    files.value.push(...rows);
    if (fresh.length < list.length) useToastStore().show(msgId("intake-already-uploaded", { names: list.filter((f) => have.has(f.name)).map((f) => f.name).join(", ") }));
    if (caseId.value && fresh.length) upload(fresh, rows.map((r) => r.key));
  }

  function upload(list: File[], keys: number[]) {
    const id = caseId.value!;
    chain(async () => {
      for (const [i, f] of list.entries()) {
        if (caseId.value !== id) return;
        let d: UploadDoc;
        try {
          d = (await useApi().uploadDocument(id, f, f.name)).data.document;
        } catch {
          continue;
        }
        if (caseId.value !== id) return;
        const at = files.value.findIndex((x) => x.key === keys[i]);
        // The same file under two names is one document on the server: one row.
        const twin = files.value.find((x) => x.key !== keys[i] && x.doc?.id === d.id);
        if (at >= 0 && !twin) Object.assign(files.value[at]!, { doc: d, size: d.size ?? files.value[at]!.size });
        else if (twin) {
          if (at >= 0) files.value.splice(at, 1);
        }
        // Removed while it was on its way: the server's copy goes too.
        else await useApi().deleteDocument(d.id).catch(() => {});
      }
    });
  }

  function removeFile(key: number) {
    const at = files.value.findIndex((x) => x.key === key);
    if (at < 0) return;
    const [f] = files.value.splice(at, 1);
    const id = caseId.value;
    if (f?.doc && id) chain(() => (caseId.value === id ? useApi().deleteDocument(f.doc!.id) : Promise.resolve()));
  }

  // Files the phone sent into this intake (phone store), once each.
  function addPhoneDocs(forCase: string, docs: UploadDoc[]) {
    if (!isOpen.value || caseId.value !== forCase) return;
    for (const d of docs) if (!files.value.some((f) => f.doc?.id === d.id)) files.value.push({ key: ++fileSeq, name: d.name, size: d.size || 0, doc: d });
  }

  // "Zpět" to the referral: the open intake and its files go, so a changed form starts a new one.
  function back() {
    if (step.value === 1) {
      discard();
      idem = idemSig = null;
    }
    if (step.value > 0) step.value = (step.value - 1) as 0 | 1;
  }

  // ---------- step 3: processing ----------

  function startProcessing() {
    if (!files.value.length) return;
    step.value = 2;
    verdict.value = null;
    progress.value = 0;
    const g = gen;
    const id = caseId.value;
    // The uploads finish first, then the server's verdict decides the closing sentence.
    void pending.then(async () => {
      if (g !== gen || !id || caseId.value !== id) return;
      let v: IntakeStatus | { ready: false };
      try {
        v = await useApi().intake(id);
      } catch {
        v = { ready: false };
      }
      if (g === gen && caseId.value === id) verdict.value = v;
    });
    // The stages illustrate the server's steps; they tick by while the uploads finish.
    const tick = () => {
      if (g !== gen) return;
      progress.value++;
      if (progress.value < PIPELINE_STAGES) setTimeout(tick, 550);
    };
    setTimeout(tick, 450);
  }

  const done = computed(() => step.value === 2 && progress.value >= PIPELINE_STAGES && verdict.value !== null);
  // The prepared record attaches: the server says so, and the referral is the demo patient's.
  const prepared = computed(() => !!(verdict.value?.ready && hint.value));

  // "Přidat do databáze": completes the intake; the new patient opens when the prepared record attached.
  async function complete() {
    if (busy.value || !caseId.value) return;
    const id = caseId.value;
    const g = gen;
    busy.value = true;
    // A removal made after "Zpracovat" lands before the intake is completed.
    await pending;
    // Closed meanwhile: the intake was discarded, so it is not completed behind the user's back.
    if (g !== gen) return;
    let r;
    try {
      r = await useApi().completeIntake(id);
    } catch (e) {
      if (g !== gen) return;
      busy.value = false;
      refused(e);
      return;
    }
    // Closed while the answer was on its way: the list shows what the server holds, without a note or a navigation.
    if (g !== gen) {
      useSessionStore().applyState(r.state);
      return;
    }
    completed.value = true;
    useSessionStore().applyState(r.state);
    const pr = r.state?.patient;
    const p = pr ? usePatientsStore().rows.find((x) => x.file === pr.file || x.id === pr.id) : undefined;
    busy.value = false;
    close();
    useToastStore().show(msgId("intake-added", { id: p?.id || r.data.case_id }));
    if (p && r.data.attached) nav.openPatient(p.file);
    else nav.showList();
  }

  return {
    isOpen, step, form, errs, dup, dupId, dupRow, fhirOpen, fhirText, fhirMsg, caseId, files, verdict, progress, busy, completed, hint, done, prepared,
    open, close, closeForUserSwitch, setNavigation, setFhirOpen, fhirSample, fhirImport, next, back, confirmDuplicate, openDuplicate,
    addFiles, removeFile, addPhoneDocs, complete,
  };
});
