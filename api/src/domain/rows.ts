// D1 rows to the objects the page builds today (initialPatients() in mocks/src/v3-template.html), so the frontend
// switch is a change of data source and nothing else. Pure; unit-tested in test/rows.test.ts.

export type CaseJoinRow = {
  id: string;
  source_file: string;
  status: string;
  processing_level: "full" | "partial" | "none";
  question_text: string | null;
  question_explicit: number;
  question_purpose: string | null;
  question_draft: string | null;
  question_kind: string | null;
  question_basis_json: string | null;
  diagnosis_text: string | null;
  diagnosis_note: string | null;
  mkn10: string | null;
  summary_one_line: string | null;
  page_count: number | null;
  referrer_name: string | null;
  referring_dept: string | null;
  referring_dept_is_example: number;
  owner_name: string;
  owner_is_example: number;
  submitted_on: string | null;
  submitted_is_example: number;
  updated_on: string;
  // patients
  full_name: string;
  name_as_written: string | null;
  birth_number: string | null;
  birth_as_written: string | null;
  age_as_written: string | null;
  identity_warning: string | null;
  name_note_cs: string | null;
  name_note_source_json: string | null;
  data_origin: string;
  // slots
  slot_day: string | null;
  slot_time: string | null;
  intake_open?: number; // step 6: 1 while the creator still uploads the documents
  created_by?: string | null;
};

export type StatusHistItem = { from: string; to: string; by: string; when: string; how: string };

const json = (s: string | null): unknown => (s == null ? null : JSON.parse(s));

// Keys absent from today's objects come back as null: the page tests them with !! or ||, so null and undefined
// behave the same there.
export function patientRow(r: CaseJoinRow, statusHist: StatusHistItem[] = [], redactClinical = false) {
  const row = {
    file: r.source_file,
    id: r.id,
    name: r.full_name,
    nameAsWritten: r.name_as_written,
    rc: r.birth_number,
    birth: r.birth_as_written,
    age: r.age_as_written,
    synthetic: r.data_origin === "codebridge_synthetic",
    warn: r.identity_warning,
    nameNote: r.name_note_cs ? { text: r.name_note_cs, src: json(r.name_note_source_json) } : null,
    diagnosis: r.diagnosis_text,
    diagnosisNote: r.diagnosis_note,
    mkn10: r.mkn10,
    question: r.question_text,
    purpose: r.question_purpose,
    explicit: r.question_explicit === 1,
    draft: r.question_draft,
    qkind: r.question_kind,
    basis: json(r.question_basis_json),
    summary: r.summary_one_line,
    pages: r.page_count,
    referrer: r.referrer_name,
    dept: r.referring_dept,
    deptExample: r.referring_dept_is_example === 1,
    owner: r.owner_name,
    ownerExample: r.owner_is_example === 1,
    submitted: r.submitted_on,
    submittedExample: r.submitted_is_example === 1,
    status: r.status,
    slot: r.slot_day && r.slot_time ? { day: r.slot_day, time: r.slot_time } : null,
    updated: r.updated_on,
    full: r.processing_level === "full",
    processing: r.processing_level,
    statusHist,
  };
  if (!redactClinical) return row;
  // The administrator manages the list without clinical content (strict mode only): identity and status stay.
  return {
    ...row,
    diagnosis: null,
    diagnosisNote: null,
    mkn10: null,
    question: null,
    purpose: null,
    draft: null,
    qkind: null,
    basis: null,
    summary: null,
    redacted_for_role: "admin",
  };
}

// The display name rule is shared with the browser (@codebridge/domain/names); re-exported for the row mappers' callers.
export { staffName } from "@codebridge/domain/names";

// The page's isEmptyPage().
export const isEmptyPage = (text: string) => /^\s*\[prázdná stránka\]\s*$/.test(text);
