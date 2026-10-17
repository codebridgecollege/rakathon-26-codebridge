// What the access log says for each write and view event. The lines carry no patient text: no names, no conclusion,
// no quotes, no file names. Allowed details: status names, slot day and time, the edit key, the alert kind, counts.

// View events the page reports for data it already holds (POST /audit/events). The page sends a code, never text.
export const VIEW_EVENTS: Record<string, { what: (target: number | null) => string; caseScoped: boolean }> = {
  slot_detail_viewed: { what: () => "zobrazil(a) detail termínu", caseScoped: true },
  guide_opened: { what: () => "otevřel(a) doporučení", caseScoped: true },
  prognosis_source_opened: { what: () => "otevřel(a) zdroj prognózy", caseScoped: true },
  prognosis_sources_opened: { what: () => "otevřel(a) zdroje prognózy", caseScoped: true },
  source_viewed: { what: (n) => (n ? `zobrazil(a) zdroj s. ${n}` : "zobrazil(a) zdroj"), caseScoped: true },
  fhir_exported: { what: () => "exportoval(a) případ jako FHIR", caseScoped: true },
  fhir_imported: { what: () => "importoval(a) žádost o konzultaci z FHIR", caseScoped: false },
  report_downloaded: { what: () => "stáhl(a) report", caseScoped: true },
  recording_on: { what: () => "zapnul(a) AI záznam diskuse", caseScoped: true },
  recording_off: { what: () => "vypnul(a) AI záznam diskuse", caseScoped: true },
  recording_stopped_all_approved: { what: () => "AI záznam se zastavil, všechny případy semináře mají schválený závěr", caseScoped: true },
  recording_speaker_pass: { what: () => "AI záznam: rozlišení mluvčích po schválení závěru, zvuk smazán", caseScoped: true },
  recording_summary: { what: () => "AI záznam: shrnutí diskuse", caseScoped: true },
  recording_audio_deleted: { what: () => "AI záznam: zvuk smazán bez rozlišení mluvčích", caseScoped: true },
  upload_added: { what: (n) => `nahrál(a) dokumenty k projednání (${n ?? 1})`, caseScoped: true },
  upload_removed: { what: () => "odebral(a) nahraný dokument", caseScoped: true },
};

export const refusedLine = (action: string) => `odmítnuto: ${action}`;
