// The study search of the Prognóza tab on the Worker: where it may run and what a failed job says. The search itself
// (services/prognosis-search.ts) calls an outside service (OpenRouter, with web search) with a clinical profile that
// holds no name or birth number, so it is off unless the team switches an org on AND the key is set (CLAUDE.md: ask
// before sending data to an external service; DATA-PROTECTION.md).

// The orgs the search may run for ("*": all). Empty: off everywhere. Set by the team in wrangler.jsonc, together with the
// OPENROUTER_API_KEY secret; real patients need FNO's clearance for any cloud model first.
export function prognosisOrgOn(env: { PROGNOSIS_ORGS?: string }, org: string): boolean {
  const list = String(env.PROGNOSIS_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes("*") || list.includes(org);
}

// At most this many searches a day per org, so a stuck button or a script cannot burn the account's tokens.
export const prognosisDailyMax = (env: { PROGNOSIS_DAILY_MAX?: string }): number => {
  const n = Number(env.PROGNOSIS_DAILY_MAX);
  return Number.isInteger(n) && n > 0 ? n : 20;
};

// A job not touched for this long while queued or running is taken as dead (the search's own limit is 240 seconds).
export const PROGNOSIS_STALE_MS = 12 * 60_000;

// What a job that ended in error tells the doctor. The job row holds only the code; provider text is never kept.
const MESSAGES: Record<string, string> = {
  missing_key: "Na serveru chybí klíč OpenRouter.",
  models_not_configured: "Na serveru chybí ID modelu pro hledání studií.",
  model_unavailable: "Nakonfigurovaný model není v katalogu OpenRouter.",
  busy: "Již probíhá hledání. Vyčkejte na výsledek.",
  start_failed: "Hledání se nepodařilo spustit. Zkuste to znovu.",
  draft_missing: "Podklady hledání už nejsou k dispozici. Spusťte hledání znovu.",
  stalled: "Hledání se nedokončilo. Spusťte ho znovu.",
  search_failed: "Hledání se nepodařilo dokončit. Spusťte ho znovu.",
  search_empty: "Hledání nenašlo použitelné výsledky. Uložený výsledek zůstává.",
};
export const prognosisMessage = (code: string | null): string | null => (code ? (MESSAGES[code] ?? MESSAGES.search_failed!) : null);
