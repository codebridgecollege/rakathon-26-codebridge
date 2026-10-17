// Who is calling. Demo mode has no login, so the user carries no identity; the UI labels roles as a stand-in.
export type User = { mode: "demo"; email: null; sub: null } | { mode: "access"; email: string; sub: string };

export type AppEnv = { Bindings: Env; Variables: { user: User } };

export type RateLimitName = "RL_STT_TOKEN" | "RL_STT_BATCH" | "RL_LLM";
