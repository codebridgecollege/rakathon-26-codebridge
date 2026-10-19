// The prompts the Worker sends to a model, loaded by ID (CLAUDE.md, "Calling LLMs": the prompt in the repository,
// pinned, reproducible). Each entry has a version that is bumped on any change of its text or schema; the model
// interface records `<id>@<version>` and the SHA-256 of the text and schema with every call and in its cache key, so
// a forgotten bump still changes the cache key and shows in the run's metadata.
import { PROMPT as SUMMARIZE_CS } from "./summarize-cs";
import { TEXT as READ_PAGE_CS } from "./read-page-cs";
import { TEXT as EXTRACT_FACTS_CS } from "./extract-facts-cs";
import { BRIEF_SCHEMA, TEXT as COMPOSE_BRIEF_CS } from "./compose-brief-cs";
import { EXTRACT_SCHEMA } from "../domain/extract/schema";
import { sha256Hex } from "../store/work";

export type PromptDef = {
  version: number;
  text: string;
  // A JSON Schema for structured output (the gateway accepts response_format json_schema with strict: true,
  // docs/research/2026-10-19-azure-gateway-check.md); absent for plain text answers.
  schema?: { name: string; schema: Record<string, unknown> };
  // Whether the prompt takes page images; the model interface refuses images for a prompt that does not.
  images?: boolean;
};

export const PROMPTS = {
  "summarize-cs": { version: 1, text: SUMMARIZE_CS },
  "read-page-cs": { version: 1, text: READ_PAGE_CS, images: true },
  "extract-facts-cs": { version: 8, text: EXTRACT_FACTS_CS, schema: EXTRACT_SCHEMA },
  "compose-brief-cs": { version: 2, text: COMPOSE_BRIEF_CS, schema: BRIEF_SCHEMA },
} satisfies Record<string, PromptDef>;

export type PromptId = keyof typeof PROMPTS;

export type LoadedPrompt = PromptDef & { id: PromptId; ref: string; sha256: string };

export async function loadPrompt(id: PromptId): Promise<LoadedPrompt> {
  const def: PromptDef | undefined = PROMPTS[id];
  if (!def) throw new Error("unknown_prompt");
  const sha256 = await sha256Hex(JSON.stringify({ text: def.text, schema: def.schema ?? null }));
  return { ...def, id, ref: `${id}@${def.version}`, sha256 };
}
