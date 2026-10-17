// Refusals of the domain rules, with the HTTP status and the Czech message the page shows as is. Pure: the HTTP layer
// (src/http/errors.ts) only copies status, code and message into the response.

export type DomainStatus = 403 | 404 | 409 | 411 | 413 | 415 | 422 | 503;

export class DomainError extends Error {
  constructor(
    public status: DomainStatus,
    public code: string,
    public message_cs: string,
    // Server state on a conflict, so the page can redraw without a second call; field messages for a form.
    public extra: { current?: unknown; fields?: Record<string, string> } = {},
  ) {
    super(code);
  }
}

const err = (status: DomainStatus, code: string, msg: string) => (extra?: DomainError["extra"]) => new DomainError(status, code, msg, extra);

// One factory per refusal; the codes are the API's error codes (lower case, as the step 1 and 2 codes).
export const D = {
  roleForbidden: err(403, "role_forbidden", "Vaše role tuto změnu nemůže provést."),
  notDoctor: err(403, "not_doctor", "Tuto změnu provádí lékař."),
  notDoctorApprove: err(403, "not_doctor", "Závěr schvaluje lékař."),
  notDoctorSuggestion: err(403, "not_doctor", "Návrh úlohy potvrzuje lékař."),
  notDoctorEdit: err(403, "not_doctor", "Údaje upravuje lékař."),
  notMember: err(403, "not_member", "Nejste v týmu tohoto případu. Lékař mimo tým může případ otevřít s uvedením důvodu."),
  caseNotFound: err(404, "case_not_found", "Případ nebyl nalezen."),
  taskNotFound: err(404, "task_not_found", "Úloha nebyla nalezena."),
  suggestionNotFound: err(404, "suggestion_not_found", "Návrh úlohy nebyl nalezen."),
  alertNotFound: err(404, "alert_not_found", "Upozornění nebylo nalezeno."),
  personNotFound: err(404, "person_not_found", "Osoba nebyla nalezena."),
  deptNotFound: err(404, "dept_not_found", "Pracoviště nebylo nalezeno."),
  sessionNotFound: err(404, "session_not_found", "Na tento den neprobíhá žádné MDT."),
  invalidInput: err(422, "invalid_input", "Údaje nejsou vyplněné správně."),
  // status and closing
  statusMoveNotAllowed: err(409, "status_move_not_allowed", "Tuto změnu stavu nelze provést."),
  statusChanged: err(409, "status_changed", "Stav případu mezitím změnil jiný uživatel."),
  // slots
  slotTaken: err(409, "slot_taken", "Termín mezitím obsadil jiný případ. Vyberte jiný."),
  slotLocked: err(409, "slot_locked", "Případ je na tomto termínu projednán; termín patří k záznamu MDT, nelze ho uvolnit ani přesunout."),
  caseClosedBooking: err(409, "case_closed", "Uzavřený případ nelze naplánovat; nejdřív ho znovu otevřete."),
  noSlot: err(409, "no_slot", "Případ nemá rezervovaný termín."),
  slotInvalid: err(422, "slot_invalid", "Termín musí být pracovní den 2024 až 2028 mezi 8:00 a 18:00 v desetiminutovém rastru."),
  // protocol and approval
  protocolConflict: (name: string, current?: unknown) =>
    new DomainError(409, "protocol_conflict", `Koncept mezitím upravil(a) ${name || "jiný uživatel"}.`, { current }),
  protocolLocked: err(409, "protocol_locked", "Závěr je schválen; koncept nelze měnit."),
  caseClosedEdit: err(409, "case_closed", "Uzavřený případ nelze měnit; nejdřív ho znovu otevřete."),
  caseClosedApprove: err(409, "case_closed", "Uzavřený případ nelze projednat; nejdřív ho znovu otevřete."),
  conclusionEmpty: err(422, "conclusion_empty", "Závěr zatím není zapsán."),
  alreadyApproved: err(409, "already_approved", "Závěr už je schválen."),
  attendanceChanged: err(409, "attendance_changed", "Seznam přítomných se mezitím změnil; zkontrolujte ho a schvalte znovu."),
  conclusionChanged: err(409, "conclusion_changed", "Závěr se mezitím změnil; zkontrolujte ho a schvalte znovu."),
  idempotencyMismatch: err(422, "idempotency_mismatch", "Opakovaný požadavek se liší od původního. Obnovte stránku."),
  notApprovedYet: err(409, "not_approved_yet", "Nový závěr lze začít až po schválení platného."),
  decisionChanged: err(409, "decision_changed", "Platný závěr se mezitím změnil; obnovte stránku."),
  // tasks and suggestions
  taskChanged: err(409, "task_changed", "Úlohu mezitím změnil jiný uživatel."),
  suggestionDecided: (name: string | null) =>
    new DomainError(409, "suggestion_decided", `O návrhu už rozhodl(a) ${name || "jiný uživatel"}.`),
  digestTooSoon: err(409, "digest_too_soon", "Přehled jste odeslal(a) před chvílí; další lze za minutu."),
  // question, edits, alerts
  noDraftQuestion: err(409, "no_draft_question", "Případ nemá návrh otázky k potvrzení."),
  questionChanged: err(409, "question_changed", "Návrh otázky se mezitím změnil; přečtěte si ho a potvrďte znovu."),
  questionConfirmed: (name: string) => new DomainError(409, "question_confirmed", `Otázku už potvrdil(a) ${name}.`),
  editConflict: (name: string) => new DomainError(409, "edit_conflict", `Údaj mezitím upravil(a) ${name || "jiný uživatel"}.`),
  alertStateChanged: err(409, "alert_state_changed", "Stav upozornění mezitím změnil jiný uživatel."),
  alertActionNotAllowed: err(422, "alert_action_not_allowed", "Tuto akci u upozornění nelze provést."),
  // sessions and attendance
  sessionRunning: err(409, "session_running", "MDT na tento den už probíhá."),
  noCasesThatDay: err(409, "no_cases_that_day", "Na tento den není naplánován žádný případ."),
  attendanceConflict: (current?: unknown) =>
    new DomainError(409, "attendance_conflict", "Seznam přítomných mezitím upravil jiný uživatel.", { current }),
  attendeeInvalid: err(422, "attendee_invalid", "Osoba není v seznamu personálu tohoto pracoviště."),
  // intake and break-the-glass
  duplicateBirthNumber: (current: unknown) =>
    new DomainError(409, "duplicate_birth_number", "Rodné číslo už v databázi je.", { current }),
  overrideReasonRequired: err(422, "override_reason_required", "Uveďte důvod, proč zakládáte druhý záznam."),
  fixtureUsed: err(409, "fixture_used", "Ukázkový pacient už v databázi je; obnovte ukázková data, chcete-li ho založit znovu."),
  alreadyMember: err(409, "already_member", "Do případu máte přístup; důvod není potřeba."),
  breakGlassReason: err(422, "invalid_input", "Uveďte důvod přístupu (10 až 500 znaků)."),
  // staff
  staffNameTaken: (name: string) => new DomainError(409, "staff_name_taken", `${name} už v seznamu je`),
  surnameRequired: err(422, "surname_required", "Příjmení nelze smazat; osobu odeberte tlačítkem ✕"),
  deptNameRequired: err(422, "invalid_input", "Vyplňte název pracoviště"),
  deptNameTaken: (name: string) => new DomainError(409, "dept_name_taken", `Pracoviště ${name} už v seznamu je`),
  deptNotEmpty: err(409, "dept_not_empty", "Pracoviště má osoby; nejdřív je odeberte."),
  cannotRemoveSelf: err(409, "cannot_remove_self", "Sebe ze seznamu odebrat nelze."),
  staffChanged: err(409, "staff_changed", "Údaj mezitím změnil jiný uživatel."),
  staffInUse: err(409, "staff_in_use", "Výchozí personál nelze obnovit: některé otevřené úlohy patří lidem mimo něj. Použijte obnovu ukázkových dat."),
  // demo
  resetDisabled: err(403, "reset_disabled", "Obnova ukázkových dat je na tomto serveru vypnutá."),
  resetConfirm: err(422, "invalid_input", "Pro obnovu napište OBNOVIT."),
  resetting: err(503, "resetting", "Ukázková data se právě obnovují, zkuste to za chvíli."),
  dataReset: err(409, "data_reset", "Ukázková data byla obnovena, stránka se znovu načte."),
  suggestionSuperseded: err(409, "suggestion_superseded", "Návrh patří k závěru, který nahradil novější; vychází z neplatného textu."),
  // a guard failed and its re-check passed again: a parallel write came and went
  conflict: err(409, "conflict", "Data se mezitím změnila; zkuste to znovu."),
};
