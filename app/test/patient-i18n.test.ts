// Every message ID the patient screen names exists in the Czech catalog. The screen passes many IDs through maps
// (status, alert kind, category), so the test collects every "patient-..." literal, not only `$t("...")` calls.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeBundle } from "../app/lib/i18n";

const roots = [path.join(import.meta.dirname, "../app"), path.join(import.meta.dirname, "../../packages/domain/src")];
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));

describe("patient catalog", () => {
  it("has every patient-* message the code names", () => {
    const cs = makeBundle("cs");
    const used = new Set<string>();
    for (const f of roots.flatMap(files).filter((f) => /\.(vue|ts)$/.test(f))) {
      // data-dev="patient-count" in the shell is a test hook, not a message.
      for (const m of readFileSync(f, "utf8").matchAll(/(?<!data-dev=)["'`](patient-[a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((id) => !cs.hasMessage(id))).toEqual([]);
  });

  it("loads without syntax errors or IDs defined twice across the area files", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    makeBundle("cs");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("formats the fixed clinical wording and the Czech plurals", () => {
    const cs = makeBundle("cs");
    const f = (id: string, args: Record<string, string | number>) => cs.formatPattern(cs.getMessage(id)!.value!, args);
    expect(f("patient-gap-not-stated", {})).toBe("neuvedeno v dostupné dokumentaci");
    expect(f("patient-question-none", {})).toBe("Výslovná otázka neuvedena v dostupné dokumentaci.");
    expect(f("patient-tl-status", { shown: 1, all: 1, cats: 9, total: 9 })).toBe("Zobrazeno 1 z 1 události · 9 z 9 kategorií");
    expect(f("patient-tl-status", { shown: 10, all: 16, cats: 8, total: 9 })).toBe("Zobrazeno 10 z 16 událostí · 8 z 9 kategorií");
    expect(f("patient-slot", { weekday: 4, d: 22, m: 10, y: "2026", from: "14:00", to: "14:10" })).toBe("Čt 22. 10. 2026 · 14:00-14:10");
  });
});
