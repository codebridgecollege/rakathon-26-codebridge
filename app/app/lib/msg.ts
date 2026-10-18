// A message a store hands to the screen: a catalog ID with its arguments, or a text the server worded (its Czech
// message_cs, shown as is because the server's wording is what the doctor must see). Stores hold no UI text.
import { useFluent } from "fluent-vue";
import { ApiError } from "@codebridge/api-client";

export type Msg = { id: string; args?: Record<string, string | number> } | { text: string };

export const msgId = (id: string, args?: Record<string, string | number>): Msg => ({ id, ...(args ? { args } : {}) });

// What a refused or failed request says: the server's message when it sent one, else the client's catalog ID.
export function errMsg(e: unknown): Msg {
  if (e instanceof ApiError) return e.message_cs ? { text: e.message_cs } : { id: e.message_id ?? "api-error-write-failed" };
  return { id: "api-error-write-failed" };
}

// Formats a Msg in the interface language; call in setup.
export function useMsg(): (m: Msg | null | undefined) => string {
  const { $t } = useFluent();
  return (m) => (!m ? "" : "text" in m ? m.text : $t(m.id, m.args));
}
