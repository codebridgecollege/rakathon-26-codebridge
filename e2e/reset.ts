// Demo reset through the Worker's own admin endpoint (api/src/routes/demo.ts). This is the one place the suite talks
// to the API directly: it prepares the world, it never checks what the page shows.

type Health = {
  service?: string;
  features?: { data?: boolean; stt?: boolean; pipeline?: boolean };
  demo?: { data_epoch?: number; reset_enabled?: boolean };
};

async function health(base: string): Promise<Health> {
  const r = await fetch(new URL("/api/health", base));
  if (!r.ok) throw new Error(`GET /api/health answered ${r.status}`);
  return (await r.json()) as Health;
}

export async function checkServer(base: string): Promise<void> {
  let h: Health;
  try {
    h = await health(base);
  } catch (e) {
    throw new Error(`No Worker answers at ${base} (${(e as Error).message}). Start it first, see e2e/README.md.`);
  }
  if (h.service !== "codebridge-mdt" || !h.features?.data) {
    throw new Error(`${base} is not the CodeBridge Worker with the data API on (features.data). See e2e/README.md.`);
  }
  // Every test resets the demo, which wipes what other people did on a shared deployment. A remote base URL therefore
  // needs an explicit yes.
  const host = new URL(base).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!local && process.env.E2E_ALLOW_RESET !== host) {
    throw new Error(`${base} is not local. The suite resets the demo before every test; set E2E_ALLOW_RESET=${host} if that is fine.`);
  }
  // The specs expect no speech or pipeline service: the recorder spec stubs speech itself, and the upload specs
  // expect no pipeline chips. A key in .dev.vars would change what the page shows.
  if (h.features?.stt || h.features?.pipeline) {
    throw new Error(`${base} reports features.stt or features.pipeline; run the suite against a Worker without those keys (e2e/README.md).`);
  }
  if (!h.demo?.reset_enabled) {
    throw new Error(`${base} does not allow reset-demo (DEMO_RESET_ENABLED); the suite needs a resettable demo.`);
  }
}

// Restores the seeded demo: every test starts from the same data whatever the previous one wrote.
export async function resetDemo(base: string): Promise<void> {
  const h = await health(base);
  const r = await fetch(new URL("/api/admin/reset-demo", base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Demo-User": "admin",
      Origin: new URL(base).origin,
      "X-Data-Epoch": String(h.demo?.data_epoch ?? 0),
    },
    body: JSON.stringify({ confirm: "OBNOVIT" }),
  });
  if (r.status !== 200) throw new Error(`reset-demo answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
