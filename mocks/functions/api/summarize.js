// Cloudflare Pages Function: POST /api/summarize { transcript } -> { summary }.
// The Azure OpenAI gateway takes its key only in a header and rejects the browser's CORS preflight, so the page
// calls this same-origin function instead; the key stays a Cloudflare secret (AZURE_OPENAI_KEY).
// The prompt lives here, so the endpoint only ever summarizes and cannot be used as a general model proxy.
const BASE = "https://apim-rakathon-q7146n.azure-api.net/openai/v1";
const MODEL = "gpt-6-luna-dz-eu";
const PROMPT = `Jsi asistent multidisciplinárního týmu (MDT). Níže je přepis diskuse o jednom pacientovi.
Shrň ji do 1 až 2 krátkých vět ve stylu závěru MDT: co bylo rozhodnuto a jaké jsou další kroky.
Neuváděj, kdo co řekl. Uveď jen to, co v přepisu zaznělo; nic nedoplňuj ani neodhaduj.
Když žádné rozhodnutí nezaznělo, napiš přesně: "Rozhodnutí v diskusi nezaznělo."
Odpověz jen samotným shrnutím.`;
const MAX_CHARS = 40000; // about an hour of discussion; longer input is refused rather than cut silently

export async function onRequestPost({ request, env }) {
  if (!env.AZURE_OPENAI_KEY) return Response.json({ error: "missing AZURE_OPENAI_KEY" }, { status: 500 });
  let transcript;
  try { ({ transcript } = await request.json()); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (typeof transcript !== "string" || !transcript.trim()) return Response.json({ error: "empty transcript" }, { status: 400 });
  if (transcript.length > MAX_CHARS) return Response.json({ error: "transcript too long" }, { status: 413 });
  // The model accepts only its default temperature; the strict prompt does the work instead.
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "api-key": env.AZURE_OPENAI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_completion_tokens: 400, messages: [{ role: "system", content: PROMPT }, { role: "user", content: transcript }] }),
  });
  if (!r.ok) return Response.json({ error: `model HTTP ${r.status}` }, { status: 502 });
  const d = await r.json();
  return Response.json({ summary: (d.choices?.[0]?.message?.content || "").trim() });
}
