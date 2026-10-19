// A doctor's confirmation of facts (POST /cases/:id/facts/:factId/confirmations). The server stores the SHA-256 of
// what the fact said (confirmations.ts confirmedContent); the page computes the same hash of the current run's facts,
// so a confirmation made for another value shows as "changed" and asks again instead of standing for a value nobody
// confirmed.
import { ref, watch, type ComputedRef, type Ref } from "vue";
import type { CaseData } from "@codebridge/domain/case-data";
import { confirmedContent, type ConfirmAction } from "@codebridge/domain/confirmations";
import type { PatientCtx } from "../composables/usePatient";
import { useApi } from "./api";
import { refused } from "./writes";
import { useSessionStore } from "../stores/session";
import type { T } from "./dates";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The confirmed-content hash of every fact the view shows, recomputed when the case data changes. */
export function useFactHashes(cd: ComputedRef<CaseData | null>): Ref<Record<string, string>> {
  const out = ref<Record<string, string>>({});
  watch(
    () => cd.value?.run?.facts,
    async (facts) => {
      if (!facts) {
        out.value = {};
        return;
      }
      try {
        const entries = await Promise.all(Object.values(facts).map(async (f) => [f.id, await sha256Hex(confirmedContent(f))] as const));
        // A newer case data may have arrived meanwhile; only the hashes of the facts shown now are kept.
        if (cd.value?.run?.facts === facts) out.value = Object.fromEntries(entries);
      } catch {
        // No WebCrypto (a page served over plain http): without the hash no confirmation state can be shown honestly,
        // so the confirmation controls stay hidden rather than guessing.
        out.value = {};
      }
    },
    { immediate: true },
  );
  return out;
}

/**
 * Confirms (or withdraws) every fact of a line, one request per fact, each against the state the page showed. A fact
 * already in the asked state is left alone. A refusal stops the rest and says why; the server's state comes back with
 * each answer.
 */
export async function confirmFacts(c: PatientCtx, t: T, factIds: string[], action: ConfirmAction): Promise<void> {
  if (!c.isDoctor.value) return;
  for (const id of factIds) {
    const st = c.confirmOf(id);
    if (!st) continue;
    if (action === "confirm" && st.state === "confirmed") continue;
    if (action === "withdraw" && st.state === "unconfirmed") continue;
    try {
      const r = await useApi().factConfirmation(c.p.value.id, id, { action, expected_state: st.state });
      useSessionStore().applyState(r.state);
    } catch (e) {
      refused(t, e);
      return;
    }
  }
}
