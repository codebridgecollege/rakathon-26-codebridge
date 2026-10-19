// A reminder, not the guarantee (docs/design/DATABASE.md, "Organizations: shared tables"): every SQL string in the
// Worker's source that reads or writes an org table names org_id. Joins and subqueries can still escape this scan; the
// isolation tests (test/orgs.test.ts) are the proof. A statement that is global by design, or a fragment whose caller
// adds the org condition, says so with a "/* org-scope: <reason> */" comment in its SQL.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ORG_TABLES } from "../src/store/sql";

const TABLE = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(${[...ORG_TABLES].sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/;

// String and template literals of a TypeScript file (comments dropped first, so prose that mentions a table is not SQL).
function literals(src: string): string[] {
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const re = /`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g;
  for (const m of code.matchAll(re)) out.push(m[0]);
  return out;
}

export function unscoped(sources: Record<string, string>) {
  const hits: string[] = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const lit of literals(src)) {
      if (!SQL.test(lit) || !TABLE.test(lit)) continue;
      if (/org_id/.test(lit) || /\/\* org-scope:/.test(lit)) continue;
      hits.push(`${file}: ${lit.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  return hits;
}

describe("org-scoped SQL (reminder)", () => {
  it("names org_id in every statement on an org table", () => {
    expect(Object.keys(env.TEST_SOURCES).length).toBeGreaterThan(20);
    expect(unscoped(env.TEST_SOURCES)).toEqual([]);
  });

  it("flags a statement without org_id", () => {
    expect(unscoped({ "x.ts": 'db.prepare("SELECT * FROM cases WHERE id = ?1")' })).toHaveLength(1);
    expect(unscoped({ "x.ts": 'db.prepare("SELECT * FROM cases WHERE org_id = ?org AND id = ?1")' })).toEqual([]);
    expect(unscoped({ "x.ts": "db.prepare(`SELECT 1 FROM fixture_files WHERE sha256 = ?1`)" })).toEqual([]);
  });
});
