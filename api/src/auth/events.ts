// Access-log rows for the login itself: a login, an org switch, a role switch and a logout. Each row names the real
// person; after a role switch it also names the membership acted as (impersonating = 1), as every later row does.
import type { Viewer } from "@codebridge/domain/access";
import { makeStores } from "../store";
import type { MemberRow } from "../store/people";
import { viewerOf } from "../middleware/viewer";
import { staffName } from "../domain/rows";

export async function logSessionEvent(
  env: Env,
  actedAs: MemberRow & { role_id: Viewer["role"] },
  realPerson: MemberRow | null,
  action: string,
  what_cs: string,
  requestId: string | null,
): Promise<void> {
  const stores = makeStores(env, actedAs.org_id);
  const viewer = await viewerOf(stores, actedAs, "oidc");
  if (realPerson && realPerson.user_id !== actedAs.user_id) {
    viewer.impersonating = true;
    viewer.actor = { id: realPerson.user_id, name: staffName(realPerson) };
  }
  await stores.audit.append({ viewer, action, what_cs, request_id: requestId });
}
