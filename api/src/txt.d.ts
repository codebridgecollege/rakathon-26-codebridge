// Plain-text prompt files (src/prompts/*.txt) are imported as text (wrangler.jsonc "rules").
declare module "*.txt" {
  const text: string;
  export default text;
}
