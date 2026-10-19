// The MDT report "Záznam z MDT" (PRODUCT.md F-31) as one escaped HTML string: the dialog's preview, the PDF and the
// snapshot frozen at approval.
// The markup and the printed Czech wording are fixed: the report is a record, and the server accepts only
// that markup (api/src/domain/report.ts validateReportHtml: no other tags or attributes, no patient identity in a
// stored snapshot). Every value is escaped here; nothing in the result comes from the data unescaped.
import type { CaseState, PatientRow } from "@codebridge/api-client";
import { docTitle, fromExtraction, refAt, sectionsOf, type CaseData, type Item, type SourceRef } from "@codebridge/domain/case-data";
import { alertState, ocrCleared, qState, type AlertEvent, type Edit } from "@codebridge/domain/case-view";
import { alertArgs } from "@codebridge/domain/run-view";
import { questionPlain } from "@codebridge/domain/fhir-export";
import logo from "../assets/glide-logo.png?inline";
import { useCasesStore } from "../stores/cases";
import { usePatientsStore } from "../stores/patients";
import { usePatientViewStore } from "../stores/patientView";
import { useReportStore } from "../stores/report";
import { useWorkflowStore } from "../stores/workflow";
import { fmtDate, fmtWhen, slotText, type T } from "./dates";
import { caseStateOf } from "./lists";
import { ageNum, surnameFirst } from "./patientRow";
import { makeBundle } from "./i18n";

// The report is a record in Czech whatever language the doctor's screen uses: the snapshot frozen at approval, the
// preview and the PDF all read the Czech catalog, so one decision never mixes languages and the printed gap wording is
// the fixed Czech one (CLAUDE.md). Built once, on first use.
let csBundle: ReturnType<typeof makeBundle> | null = null;
export const recordT: T = (id, args) => {
  csBundle ??= makeBundle("cs");
  const m = csBundle.getMessage(id);
  return m?.value ? csBundle.formatPattern(m.value, args) : id;
};

export type ReportProto = { state: "draft" | "approved"; concl: string; steps: { text: string; who: string; due: string }[]; approver?: string | null };

// The finding groups the report can print, in a fixed order (FIND); their titles are discussion-report-pick.
export const FIND = ["clinical_finding", "imaging", "histology", "past_treatment", "current_state"] as const;
// The history sections in the order the Czech anamnesis is written (ANAM); labels are patient-anam-section.
const ANAM = ["OA", "RA", "PA", "SA", "FA", "AA", "abusus", "EA", "preventive"] as const;

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The patient line. A snapshot stored on the server holds an empty placeholder instead (identity is not kept in the
// decision record); fillIdent() puts the current list row's identity back whenever the snapshot is shown or printed.
export function identLine(p: PatientRow, t: T): string {
  const gap = t("patient-gap-not-stated");
  return t("patient-concl-ident", { name: surnameFirst(p), rc: p.rc || gap, age: ageNum(p) || gap, id: p.id });
}
export const fillIdent = (html: string | null | undefined, p: PatientRow, t: T) =>
  String(html || "").replace(/<p class="pt-ident"><\/p>/g, () => `<p class="pt-ident">${esc(identLine(p, t))}</p>`);

// Drug line and note as the anamnesis tab writes them.
const drugLine = (m: Item) => [m.drug_cs, m.strength_cs, m.dosing_cs].filter(Boolean).join(" ");
const drugNote = (m: Item) => m.comment_line_cs || [m.indication_cs, m.change_cs].filter(Boolean).join("; ");

// The case data of any case, loaded or not: the report may be for a case other than the open one (approval from the
// session bar), so it reads that case's entry, never the patient context.
function caseDataOf(file: string): CaseData | null {
  const d = useCasesStore().readyData(file);
  return d ? fromExtraction(d.file, d.id, d.extraction, d.documents) : null;
}

// "Podklady": what the report can and cannot say about the documents. A case whose data failed to load is never
// printed as "not processed", and its missing documents are said to be unknown, not absent. The missing-document list
// prints for every case whose check ran.
function reportBasis(t: T, p: PatientRow, cd: CaseData | null, failed: boolean, hist: AlertEvent[]): string {
  const sec = sectionsOf(cd);
  const h = `<h4>${esc(t("discussion-report-h-basis"))}</h4>`;
  if (failed) return `${h}<p>${esc(t("discussion-report-basis-failed"))}</p>`;
  if (!cd || cd.level === "none") return `${h}<p>${esc(t("discussion-report-basis-none"))}</p>`;
  const done = (["documents", "alerts", "labs"] as const).filter((k) => sec[k]).map((key) => t("discussion-report-basis-part", { key }));
  const head = sec.record
    ? ""
    : `${h}<p>${esc(t("discussion-report-basis-partial", { synthetic: p.synthetic ? "yes" : "no", done: done.join(", ") || t("discussion-report-basis-list-only") }))}</p>`;
  // The open missing-document alerts, in the report's language (its fact arguments as the facts' lines).
  const items: Item[] = (cd.alerts?.flags || []).filter((f) => f.kind === "missing" && alertState(hist, f.id).state !== "resolved");
  const src = (g: Item): SourceRef | undefined => (g.based_on || [])[0];
  const label = t("discussion-report-h-missing");
  const li = (g: Item) => {
    const s = src(g);
    const text = t(g.message.id, alertArgs(cd, g as never, t).args);
    return `<li>${esc(text)}${s ? ` ${esc(t("discussion-report-gap-src", { file: String(s.file ?? ""), page: String(s.page ?? "") }))}` : ""}</li>`;
  };
  return head + (items.length ? `<h4>${esc(label)}</h4><ul>${items.map(li).join("")}</ul>` : "");
}

// The report of case `file` for the protocol `pr` and the attendance `present`. It reads the stores itself (the list
// row, the case data, the stored edits and alert history, the guideline layer, the report's ticks), so the dialog's
// preview, the PDF and the approval snapshot are the same text. withIdentity: false prints the empty patient line the
// server stores.
export function reportHtmlFor(t: T, file: string, pr: ReportProto, present: string[], opts: { withIdentity?: boolean } = {}): string {
  const withIdentity = opts.withIdentity ?? true;
  const p = usePatientsStore().byFile(file);
  if (!p) return "";
  const cases = useCasesStore();
  const cs: Partial<CaseState> = caseStateOf(useWorkflowStore().cases, p) ?? {};
  const edits = (cs.edits ?? {}) as Record<string, Edit>;
  const edOf = (k: string) => edits[k];
  const hist: AlertEvent[] = (cs.alertHist ?? []).map((x) => ({ i: x.alert_id, action: x.action, who: x.who, when: x.when }));
  const picked = useReportStore().picked;
  const guideOn = usePatientViewStore().guideOn;
  const cd = caseDataOf(file);
  const sec = sectionsOf(cd);
  const failed = cases.stateOf(file) === "error";
  const pst = ((cases.entries.get(file)?.guide?.statements as Item[] | undefined) || []);
  const gap = t("discussion-report-gap");
  const tag = (id: string) => ` ${t(id)}`;
  // In the report an edited value is marked, so it is never read as if the cited source said it.
  const edRep = (k: string, orig: string) => (edOf(k) ? `${edOf(k)!.text}${tag("discussion-report-tag-edited")}` : orig);

  // Paper-style references: numbered in order of first use while the report is built, in a fixed order
  // (anamnesis, then the brief, then the finding groups).
  const list: SourceRef[] = [];
  const key = (r: SourceRef) => `${r.file}|${r.page}|${r.quote}`;
  const num = (r: SourceRef) => {
    let i = list.findIndex((x) => key(x) === key(r));
    if (i < 0) i = list.push(r) - 1;
    return i + 1;
  };
  const refTxt = (r: SourceRef | undefined | null) => (r ? ` [${num(r)}]` : "");
  // A NIS record is named as such on paper too, never by the case's file.
  const docTitleOf = (r: SourceRef) =>
    r.nis
      ? t("patient-src-nis-title", { resource: r.nis.resource })
      : docTitle(
      r,
      (f) => {
        const c = cases.caseFileOfDoc(f);
        return c ? caseDataOf(c)?.documents ?? null : null;
      },
      file,
    );

  const tagsText = (f: Item) =>
    (f.negated ? tag("discussion-report-tag-negated") : "") + (f.certainty === "unclear_ocr" ? tag("discussion-report-tag-ocr") : "") + (f.certainty === "inferred" ? tag("discussion-report-tag-inferred") : "");
  const line = (f: Item) => `<li>${f.date ? esc(f.date) + ": " : ""}${esc(f.text_cs)}${esc(tagsText(f))}<span class="src">${refTxt(f.source)}</span></li>`;

  // Report anamnesis (Soňa, round 2): diagnoses stand out in bold, qualifiers stay plain text.
  const A = cd?.record?.anamnesis || {};
  const mt = (f: Item) =>
    (f.negated ? tag("discussion-report-tag-negated") : "") +
    ((f.ocr_note_cs || f.certainty === "unclear_ocr") && !ocrCleared(f) ? tag("discussion-report-tag-ocr") : "") +
    (f.certainty === "inferred" ? tag("discussion-report-tag-inferred") : "") +
    (f.certainty === "conflicting" ? ` ${f.note_cs ? t("discussion-report-tag-conflict-note", { note: String(f.note_cs) }) : t("discussion-report-tag-conflict")}` : "") +
    (f.change_status === "planned_unconfirmed" ? tag("discussion-report-tag-planned") : "");
  const rf = (f: Item) => ((f.refs || []) as unknown[]).map((j) => `<span class="src">${refTxt(refAt(cd, j))}</span>`).join("");
  // Edits are keyed by the item's fact ("f:<fact id>" with the part), as the anamnesis tab stores them.
  const anamItem = (k: string, f: Item) =>
    k === "FA"
      ? `${esc(edRep(`${f.key}:line`, drugLine(f)))}${drugNote(f) || edOf(`${f.key}:note`) ? ` (${esc(edRep(`${f.key}:note`, drugNote(f)))})` : ""}${esc(mt(f))}${rf(f)}`
      : `${f.term_cs ? `<b>${esc(edRep(`${f.key}:t`, f.term_cs))}</b>` : ""}${f.comment_cs ? `${f.term_cs ? ", " : ""}${esc(edRep(`${f.key}:c`, f.comment_cs))}` : ""}${esc(mt(f))}${rf(f)}`;
  // An empty section prints what its check says: the gap wording, or that it was not checked.
  const emptySection = (k: string) => (cd?.run?.sections[k]?.result === "not_run" ? t("patient-check-not-run") : gap);
  const withAnam = sec.anamnesis && picked.has("anamnesis");
  // Every section is listed; an empty one prints the gap wording (allergies must never just vanish).
  const anamLines = withAnam
    ? ANAM.map((k) => {
        const xs = A[k] || [];
        const warn = A.FA_warnings || [];
        return `<li><span style="text-decoration:underline">${esc(t("patient-anam-section", { key: k }))}:</span> ${xs.length ? xs.map((f) => anamItem(k, f)).join("; ") : esc(emptySection(k))}${k === "FA" && warn.length ? `<br><b>${esc(t("discussion-report-fa-warning"))}</b> ${warn.map((f) => anamItem("faw", f)).join("; ")}` : ""}</li>`;
      }).join("")
    : "";

  const bf = cd?.brief;
  const withSummary = picked.has("summary");
  const brief =
    sec.brief && withSummary
      ? edOf("brief")
        ? esc(edOf("brief")!.text) + tag("discussion-report-tag-edited")
        : bf?.text_cs
          ? esc(bf.text_cs).replace(/\[(\d+)\]/g, (_m, n: string) => `<span class="src">${refTxt((bf.refs || [])[Number(n) - 1])}</span>`)
          : esc((bf?.summary_items || []).map((x) => x.text_cs).join(" "))
      : "";

  // The diagnosis line: histology, grade and the TNM at diagnosis with its context, or the list row's diagnosis.
  const dxText = () => {
    const d = bf?.dx_headline;
    if (!d) return p.diagnosis ?? "";
    const base = [d.histology_cs, d.grade_cs, d.tnm_cs].filter(Boolean).join(", ");
    return `${edRep("dx", base)}${d.tnm_context_cs ? `; ${d.tnm_context_cs}` : ""}${d.ocr_note_cs && !ocrCleared(d) && !edOf("dx") ? tag("discussion-report-tag-ocr") : ""}`;
  };
  // The question as plain text: a draft says it is a draft, a confirmation says who confirmed it and when.
  const qc = cs.qConfirm as { text?: string | null; by: string; when: string } | null | undefined;
  const question = questionPlain(t, qState(p, edOf("q"), qc ? { ...qc, when: fmtWhen(qc.when) } : qc));

  const findings = sec.record
    ? FIND.filter((k) => picked.has(k))
        .map((k) => `<h4>${esc(t("discussion-report-pick", { key: k }))}</h4><ul>${(cd!.record!.sections![k] || []).map(line).join("") || `<li>${esc(gap)}</li>`}</ul>`)
        .join("")
    : "";
  const steps = pr.steps.filter((x) => x.text.trim());
  const meta = t(pr.state !== "approved" ? "discussion-report-meta-draft" : "discussion-report-meta", { date: p.slot ? slotText(t, p.slot) : gap, id: p.id });
  const quoteOf = (q: string) => (q.length > 70 ? q.slice(0, 70) + "…" : q);

  return `<article class="sheet">
    <div class="hdr"><div class="report-brand"><img src="${logo}" alt="GLIDE"><b>MDT</b></div><h1>${esc(t("discussion-report-title"))}</h1><p class="report-meta">${esc(meta)}</p></div>
    <h4>${esc(t("discussion-report-h-patient"))}</h4>${withIdentity ? `<p>${esc(identLine(p, t))}</p>` : `<p class="pt-ident"></p>`}
    <h4>${esc(t("discussion-report-h-present"))}</h4><p>${esc(present.join(", ") || t("discussion-report-present-none"))}</p>
    <h4>${esc(t("discussion-report-h-dx"))}</h4><p><b>${esc(dxText())}</b>${bf?.dx_headline?.mkn_cs ? `<br>${esc(bf.dx_headline.mkn_cs)}` : ""}</p>
    ${withSummary ? `<h4>${esc(t("discussion-report-h-summary"))}</h4><p>${sec.brief ? brief : esc(p.summary || gap)}</p>` : ""}
    ${withAnam ? `<h4>${esc(t("discussion-report-h-anamnesis"))}</h4><ul>${anamLines}</ul>` : ""}
    ${findings}
    ${reportBasis(t, p, cd, failed, hist)}
    <h4>${esc(t("discussion-report-h-question"))}</h4><p>${esc(question)}</p>
    <h4>${esc(t("discussion-report-h-concl"))}</h4><p id="rep-concl">${esc(pr.concl || t("discussion-report-concl-none"))}</p>
    <h4>${esc(t("discussion-report-h-steps"))}</h4>${steps.length ? `<ul>${steps.map((x) => `<li>${esc(t("discussion-report-step", { text: x.text, who: x.who, due: fmtDate(t, x.due) }))}</li>`).join("")}</ul>` : `<p>${esc(t("discussion-report-steps-none"))}</p>`}
    ${sec.guidance && guideOn && pst.length ? `<h4>${esc(t("discussion-report-h-dev"))}</h4><p>${esc(t("discussion-report-dev-none"))}</p>` : ""}
    ${list.length ? `<h4>${esc(t("discussion-report-h-sources"))}</h4><ol class="src">${list.map((r) => `<li>${esc(r.nis ? docTitleOf(r) : r.quote ? t("discussion-report-source-quote", { title: docTitleOf(r), page: String(r.page ?? ""), quote: quoteOf(r.quote) }) : t("discussion-report-source", { title: docTitleOf(r), page: String(r.page ?? "") }))}</li>`).join("")}</ol>` : ""}
    <p class="src" style="margin-top:14px">${esc(t("discussion-report-legend"))}</p>
    <div class="signatures" aria-label="${esc(t("discussion-report-signatures"))}"><div class="signature">${esc(t("discussion-report-signature"))}</div><div class="signature">${esc(t("discussion-report-signature"))}</div></div></article>`;
}

// The PDF's file name: the case ID, the slot's day (or "bez-data") and "-koncept" for a draft.
export const reportFileName = (id: string, day: string | null | undefined, draft: boolean) => `GLIDE-MDT-${id}-${day || "bez-data"}${draft ? "-koncept" : ""}.pdf`;
