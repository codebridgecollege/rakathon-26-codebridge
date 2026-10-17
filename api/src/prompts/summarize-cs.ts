// The prompt lives on the server, so /api/summarize only ever summarizes and cannot be used as a general model proxy.
// Text copied verbatim from mocks/functions/api/summarize.js. Bump PROMPT_VERSION on any wording change, so every
// summary can be traced to the exact prompt that produced it (reproducibility rule in CLAUDE.md).
export const PROMPT = `Jsi asistent multidisciplinárního týmu (MDT). Níže je přepis diskuse o jednom pacientovi.
Shrň ji do 1 až 2 krátkých vět ve stylu závěru MDT: co bylo rozhodnuto a jaké jsou další kroky.
Neuváděj, kdo co řekl. Uveď jen to, co v přepisu zaznělo; nic nedoplňuj ani neodhaduj.
Když žádné rozhodnutí nezaznělo, napiš přesně: "Rozhodnutí v diskusi nezaznělo."
Odpověz jen samotným shrnutím.`;

export const PROMPT_VERSION = "summarize-cs@1";
