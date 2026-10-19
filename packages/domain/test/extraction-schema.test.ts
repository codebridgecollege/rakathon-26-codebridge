import { describe, expect, it } from "vitest";
import { schemaText } from "../scripts/extraction-schema.mjs";
import checkedIn from "../schema/extraction-2.schema.json";

describe("extraction JSON Schema", () => {
  // The Python pipeline validates against the checked-in file, so it must equal what the TypeScript types generate.
  it("is up to date with src/extraction/types.ts (rerun: npm run schema -w @codebridge/domain)", () => {
    expect(JSON.parse(schemaText())).toEqual(checkedIn);
  }, 60_000);
});
