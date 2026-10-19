// Generates the JSON Schema of codebridge.extraction/2 from the TypeScript types (src/extraction/types.ts), so the
// types stay the one definition and the Python pipeline validates against the same rules as the Worker.
//
//   npm run schema -w @codebridge/domain           # writes schema/extraction-2.schema.json
//
// The test test/extraction-schema.test.ts regenerates it and fails when the checked-in file is stale.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA_PATH = resolve(root, "schema/extraction-2.schema.json");

export function generateSchema() {
  const schema = createGenerator({
    path: resolve(root, "src/extraction/types.ts"),
    tsconfig: resolve(root, "tsconfig.json"),
    type: "ExtractionRun",
    expose: "export",
    topRef: true,
    jsDoc: "extended",
    // Unknown fields are rejected, so a typo in a producer ("certanity") fails validation instead of being ignored.
    additionalProperties: false,
    skipTypeCheck: true,
  }).createSchema("ExtractionRun");
  return { $id: "https://codebridge.example/schema/codebridge.extraction/2", ...schema };
}

export function schemaText() {
  return JSON.stringify(generateSchema(), null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SCHEMA_PATH, schemaText());
  console.log(`wrote ${SCHEMA_PATH}`);
}
