// Readers of the open case's guideline layer (GL, STMTS, PAST, anyStmt, citeOf and factRefs in the template). The
// guidance reply is the server's JSON as it comes; these helpers only look things up in it.
import { computed } from "vue";
import { refAt, type Item, type SourceRef } from "@codebridge/domain/case-data";
import type { PatientCtx } from "../composables/usePatient";
import type { T } from "./dates";

export function useGuide(c: PatientCtx, t: T) {
  const G = computed(() => c.guide.value);
  const GL = (id: string | undefined): Item => ((G.value.guidelines || []) as Item[]).find((g) => g.id === id) || {};
  const stmts = computed(() => (G.value.statements || []) as Item[]);
  const past = computed(() => (G.value.past_statements || []) as Item[]);
  const anyStmt = (id: string) => stmts.value.find((x) => x.id === id) || past.value.find((x) => x.id === id);
  // The full citation of a statement, as the tooltip of "otevřít v doporučení" and the drawer show it.
  const citeOf = (st: Item) => {
    const g = GL(st.guideline_id);
    const where = st.pdf_page ? t("patient-guide-cite-page", { page: String(st.printed_page || st.pdf_page) }) : t("patient-guide-cite-abstract");
    return `${g.name || ""}, ${g.society || ""} ${g.year || ""}${g.version ? `, ${g.version}` : ""}; ${st.section || ""}; ${where}`;
  };
  // The documented facts a statement applies to, each with the case's sources it rests on.
  const factRefs = (fact: string): SourceRef[] =>
    (((G.value.fact_refs || {}) as Record<string, number[]>)[fact] || []).map((i) => refAt(c.cd.value, i)).filter(Boolean) as SourceRef[];
  return { G, GL, stmts, past, anyStmt, citeOf, factRefs };
}

// A page of a guideline: "s. 1338" when the printed page is known, else "s. PDF 7", so nobody looks for a PDF page
// number among the printed ones; "jen abstrakt" when the statement comes from the abstract.
export const pageLabel = (t: T, n: unknown, printed: unknown) =>
  printed ? t("patient-guide-page-printed", { page: String(printed) }) : t("patient-guide-page-pdf", { page: String(n) });
export const pageOf = (t: T, x: Item) => (x.pdf_page ? pageLabel(t, x.pdf_page, x.printed_page) : t("patient-guide-abstract-only"));
