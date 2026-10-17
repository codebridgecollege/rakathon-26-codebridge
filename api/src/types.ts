import type { Viewer } from "./domain/access";
import type { Stores } from "./store/types";

// Who is calling, as the auth middleware established it. Demo mode has no login, so it carries no identity; the
// data routes then resolve the person from the page's user picker (see middleware/viewer.ts).
export type User = { mode: "demo"; email: null; sub: null } | { mode: "access"; email: string; sub: string };

export type AppEnv = { Bindings: Env; Variables: { user: User; viewer: Viewer; stores: Stores } };

export type RateLimitName = "RL_STT_TOKEN" | "RL_STT_BATCH" | "RL_LLM";
