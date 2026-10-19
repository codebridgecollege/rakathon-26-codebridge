// Mounting patient-screen components in Vitest: the real Czech catalog through fluent-vue, a fresh Pinia, the stores
// filled with a synthetic case, and the patient context PatientView provides. Synthetic values only.
import { defineComponent, h, type Component } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createFluentVue } from "fluent-vue";
import type { CaseState, ExtractionDocument, PatientRow } from "@codebridge/api-client";
import type { ExtractionRun } from "@codebridge/domain/extraction/types";
import { bundlesFor } from "../app/lib/i18n";
import { setApi } from "../app/lib/api";
import { providePatient } from "../app/composables/usePatient";
import { usePatientsStore } from "../app/stores/patients";
import { useSessionStore } from "../app/stores/session";
import { useCasesStore } from "../app/stores/cases";
import { useWorkflowStore } from "../app/stores/workflow";
import { useToastStore } from "../app/stores/toast";
import { mockApi, row, meOrg } from "./helpers";

export type PatientSetup = {
  p?: Partial<PatientRow>;
  // The case's codebridge.extraction/2 run as the server sends it; null for an unprocessed case.
  extraction?: ExtractionRun | null;
  // The stored documents with their parts that come with the run (none when left out).
  documents?: ExtractionDocument[];
  wf?: Partial<CaseState>;
  role?: "doctor" | "coordinator" | "admin";
  userName?: string;
  routes?: Record<string, unknown>;
  guide?: Record<string, unknown>;
};

export function setupPatient(s: PatientSetup = {}) {
  const pinia: Pinia = createPinia();
  setActivePinia(pinia);
  document.documentElement.lang = "cs";
  const { api, calls } = mockApi(s.routes ?? {});
  setApi(api);
  const p = row(10, s.p ?? {});
  usePatientsStore().replace([p], 1);
  const session = useSessionStore();
  session.me = { user: { id: "u1", name: s.userName ?? "MUDr. Svobodová", role: s.role ?? "doctor", dept: null }, ...meOrg("u1"), auth_mode: "demo", impersonating: false, notice_cs: null };
  session.phase = "ready";
  const cases = useCasesStore();
  if (s.extraction !== undefined) {
    const e = cases.caseOf(p.file);
    Object.assign(e, { state: "ready", data: { file: p.file, id: p.id, extraction: s.extraction, documents: s.documents ?? [] }, error: null, loadedAt: 1 });
    if (s.guide) e.guide = s.guide;
  }
  if (s.wf) useWorkflowStore().cases[p.id] = { case_id: p.id, file: p.file, ...s.wf };
  return { pinia, p, calls };
}

// The text of the newest toast the screen showed (the toast store; AppToasts draws it in the app).
export function lastToast(): string | undefined {
  const m = useToastStore().items.at(-1)?.msg;
  return m && "text" in m ? m.text : m?.id;
}

const fluent = () => createFluentVue({ bundles: bundlesFor("cs") });

// Mounts `comp` inside a parent that provides the patient context for the case set up by setupPatient().
export function mountInCase(comp: Component, setup: ReturnType<typeof setupPatient>, props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      const f = fluent();
      providePatient({ value: setup.p.file } as never, (id, args) => f.format(id, args));
      return () => h(comp, props);
    },
  });
  return mount(Host, { global: { plugins: [setup.pinia, fluent()] }, attachTo: document.body });
}
