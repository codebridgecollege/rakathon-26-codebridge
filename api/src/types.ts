import type { Viewer } from "@codebridge/domain/access";
import type { Stores } from "./store/types";

// Who is calling, as the auth middleware established it. Demo mode has no login, so it carries no identity; the
// data routes then resolve the person from the app's user picker (see middleware/viewer.ts). OIDC mode carries the
// login session: the person, the org it acts in, the person's own membership there and, after a role switch in a
// demo org, the membership acted as (docs/design/AUTH.md, "Organizations and roles").
export type SessionUser = {
  mode: "oidc";
  userId: string;
  org: string;
  membershipId: string;
  actingMembershipId: string | null;
  isDemoOrg: boolean;
  // The SHA-256 of the session ID, the key of auth_sessions; the ID itself is only in the cookie.
  sessionHash: string;
};
export type User = { mode: "demo" } | SessionUser;

// body, epoch and audit* are set by the write middleware (middleware/write-guard.ts) for POST, PUT, PATCH, DELETE.
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    viewer: Viewer;
    stores: Stores;
    body: Record<string, unknown>;
    epoch: number;
    auditCase: string | null;
    auditLabel: string;
    breakGlass: string | null; // the grant's reason when a doctor reads a case outside the team
  };
};

export type RateLimitName = "RL_STT_TOKEN" | "RL_STT_BATCH" | "RL_LLM" | "RL_AUDIO" | "RL_UPLOAD";
