// Break-the-glass (INTEGRATION.md): a doctor outside a case's team may open it with a stated reason. The grant is
// time-limited and every use is in the access log with the reason, for later review.
import { D } from "@codebridge/domain/errors";
import { BREAK_GLASS_HOURS } from "@codebridge/domain/config";
import type { Actor } from "@codebridge/domain/roles";

export function grant(actor: Actor, member: boolean, reason: unknown, now: Date): { reason: string; expires_at: string } {
  if (actor.role !== "doctor") throw D.roleForbidden();
  if (member) throw D.alreadyMember();
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 10 || r.length > 500) throw D.breakGlassReason();
  return { reason: r, expires_at: new Date(now.getTime() + BREAK_GLASS_HOURS * 3600_000).toISOString() };
}
