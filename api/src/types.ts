import type { Viewer } from "./domain/access";
import type { Stores } from "./store/types";

// Who is calling, as the auth middleware established it. Demo mode has no login, so it carries no identity; the
// data routes then resolve the person from the page's user picker (see middleware/viewer.ts).
export type User = { mode: "demo"; email: null; sub: null } | { mode: "access"; email: string; sub: string };

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
