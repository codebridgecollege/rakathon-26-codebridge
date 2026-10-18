// Type-level checks only (nothing here runs or is bundled): the objects the Worker builds must fit the reply types in
// @codebridge/domain/wire, which the browser client (@codebridge/api-client) is typed with. A server change that
// breaks the page's contract then fails `npm run typecheck` here instead of failing in the browser.
import type * as W from "@codebridge/domain/wire";
import type { patientRow } from "./domain/rows";
import type { StaffDirectory } from "./store/types";
import type { AttSet, CaseState, Session, taskOut } from "./store/work";
import type { docOut } from "./routes/documents";

type Fits<A extends B, B> = A;

export type WireChecks = [
  Fits<ReturnType<typeof patientRow>, W.PatientRow>,
  Fits<StaffDirectory, W.StaffDirectory>,
  Fits<ReturnType<typeof taskOut>, W.Task>,
  Fits<CaseState, W.CaseState>,
  Fits<AttSet, W.AttSet>,
  Fits<Session, W.Session>,
  Fits<ReturnType<typeof docOut>, W.UploadDoc>,
];
