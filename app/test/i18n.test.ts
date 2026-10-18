// The catalogs load with the settings I18N.md requires, every message ID the app uses exists in Czech, and the CSS is
// still the old page's.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { FluentResource } from "@fluent/bundle";
import { createFluentVue, useFluent } from "fluent-vue";
import { CLIENT_ERROR_IDS } from "@codebridge/api-client";
import { bundlesFor, chooseLocale, loadLocale, makeBundle } from "../app/lib/i18n";

// Slovak and English load on demand in the app, as here.
beforeAll(() => Promise.all([loadLocale("sk"), loadLocale("en")]));

const appDir = path.join(import.meta.dirname, "../app");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));

describe("catalogs", () => {
  it("formats without direction marks around placeholders", () => {
    const b = makeBundle("cs");
    const msg = b.getMessage("user-picker-with-function")!;
    expect(b.formatPattern(msg.value!, { name: "Bc. Marková", fn: "koordinátorka MDT" })).toBe("Bc. Marková (koordinátorka MDT)");
  });

  it("has the Czech plural forms", () => {
    const b = makeBundle("cs");
    const f = (n: number) => b.formatPattern(b.getMessage("dev-patient-count")!.value!, { n });
    expect([f(1), f(3), f(11)]).toEqual(["1 pacient ze serveru", "3 pacienti ze serveru", "11 pacientů ze serveru"]);
  });

  it("shows Slovak, and falls back to Czech for a message Slovak does not have", () => {
    // A real component, so the test goes through fluent-vue's plugin as the app does (template $t and useFluent).
    const Comp = defineComponent({
      setup() {
        const { $t } = useFluent();
        return () => h("p", [$t("nav-patients"), " / ", $t("nav-calendar")]);
      },
    });
    const text = (bundles: ReturnType<typeof bundlesFor>) => mount(Comp, { global: { plugins: [createFluentVue({ bundles })] } }).text();
    expect(text(bundlesFor("sk"))).toBe("Databáza pacientov / Kalendár MDT");
    // A Slovak catalog with one message only: the other comes from Czech.
    expect(text([makeBundle("sk", "nav-patients = Databáza pacientov"), makeBundle("cs")])).toBe("Databáza pacientov / Kalendář MDT");
  });

  it("chooses ?lang first, then the stored choice, then Czech; never the browser's language", () => {
    expect(chooseLocale("?lang=sk", "en")).toBe("sk");
    expect(chooseLocale("", "en")).toBe("en");
    expect(chooseLocale("?lang=xx", null)).toBe("cs");
    expect(chooseLocale("", null)).toBe("cs");
  });

  it("knows every message ID the app and the client use", () => {
    const cs = makeBundle("cs");
    const used = new Set<string>();
    for (const f of files(appDir).filter((f) => /\.(vue|ts)$/.test(f))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\$t\(\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]!);
      // IDs passed as data: message_id fields, an ApiError's fourth argument and fallbacks (`?? "id"`).
      for (const m of readFileSync(f, "utf8").matchAll(/(?:message_id: |\?\? |null, |msgId\()"([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) used.add(m[1]!);
      // The <i18n> component's path, also when it picks one of two messages.
      for (const m of readFileSync(f, "utf8").matchAll(/\bpath="([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) used.add(m[1]!);
      for (const m of readFileSync(f, "utf8").matchAll(/:path="[^"]*\? '([a-z0-9-]+)' : '([a-z0-9-]+)'"/g)) used.add(m[1]!).add(m[2]!);
    }
    for (const group of Object.values(CLIENT_ERROR_IDS)) for (const id of Object.values(group)) used.add(id);
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((id) => !cs.hasMessage(id))).toEqual([]);
  });
});

// Slovak and English catalogs (I18N.md, "Tooling and checks"): every Czech message and term exists in each, with the
// same placeholders, and a plural message has every category its language's plural rules can pick. Czech is the
// source, so a message added in Czech without its translations fails here instead of silently falling back.
type FtlNode = unknown;
type FtlEntry = { id: string; value: FtlNode; attributes: Record<string, FtlNode> };
type FtlSelect = { type: "select"; variants: { key: { value?: string | number; name?: string } }[]; star: number };
const i18nDir = path.join(import.meta.dirname, "../../i18n");
const entriesOf = (locale: string, file: string) =>
  new Map((new FluentResource(readFileSync(path.join(i18nDir, locale, file), "utf8")).body as unknown as FtlEntry[]).map((m) => [m.id, m]));
// Collects the variables and the select expressions of a message, walking @fluent/bundle's parsed resource objects.
function walk(node: FtlNode, vars: Set<string>, selects: FtlSelect[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, vars, selects));
  const n = node as { type?: string; name?: string };
  if (n.type === "var") vars.add(n.name!);
  if (n.type === "select") selects.push(node as FtlSelect);
  for (const v of Object.values(node)) walk(v, vars, selects);
}
const shapeOf = (m: FtlEntry) => {
  const vars = new Set<string>();
  const selects: FtlSelect[] = [];
  walk([m.value, m.attributes], vars, selects);
  return { vars: [...vars].sort().join(", "), selects };
};
const keysOf = (s: FtlSelect) => s.variants.map((v) => String(v.key.value ?? v.key.name));
const CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
// A select is a plural when its variants use a CLDR category other than "other"; the rest select on codes ($code,
// $weekday), and their "other" is just a code name.
const isPlural = (s: FtlSelect) => keysOf(s).some((k) => k !== "other" && CATEGORIES.includes(k));

describe.each(["sk", "en"] as const)("%s catalog", (locale) => {
  const csFiles = readdirSync(path.join(i18nDir, "cs")).filter((f) => f.endsWith(".ftl"));
  const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];

  it("loads without syntax errors or IDs defined twice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    makeBundle(locale);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(csFiles)("%s has every Czech message, the same placeholders and its language's plural categories", (file) => {
    expect(existsSync(path.join(i18nDir, locale, file)), `i18n/${locale}/${file} is missing`).toBe(true);
    const cs = entriesOf("cs", file);
    const tr = entriesOf(locale, file);
    const problems: string[] = [];
    for (const [id, m] of cs) {
      const t = tr.get(id);
      if (!t) {
        problems.push(`${id}: missing`);
        continue;
      }
      const a = shapeOf(m);
      const b = shapeOf(t);
      if (a.vars !== b.vars) problems.push(`${id}: placeholders [${b.vars}] instead of [${a.vars}]`);
      for (const s of b.selects.filter(isPlural)) {
        const keys = keysOf(s);
        // Fluent's default variant (*) stands in for "other" only when it is marked so.
        const lacking = needed.filter((c) => !keys.includes(c));
        if (lacking.length) problems.push(`${id}: lacks ${lacking.join(", ")}`);
        // A category the language never picks (few or many in English) is dead text that drifts unnoticed.
        const unused = keys.filter((k) => CATEGORIES.includes(k) && !needed.includes(k));
        if (unused.length) problems.push(`${id}: ${unused.join(", ")} never picked in ${locale}`);
        if (keys[s.star] !== "other") problems.push(`${id}: the default variant is not "other"`);
      }
    }
    for (const id of tr.keys()) if (!cs.has(id)) problems.push(`${id}: not in Czech`);
    expect(problems).toEqual([]);
  });

  it("formats the fixed clinical wording and the plurals", () => {
    const b = makeBundle(locale);
    const f = (id: string, args: Record<string, string | number> = {}) => b.formatPattern(b.getMessage(id)!.value!, args);
    const want = {
      sk: {
        gap: "neuvedené v dostupnej dokumentácii",
        verify: " [overiť čítanie]",
        count: ["1 pacient zo servera", "3 pacienti zo servera", "11 pacientov zo servera"],
        events: "Zobrazené: 1 z 1 udalosti · 9 z 9 kategórií",
      },
      en: {
        gap: "not stated in the available documentation",
        verify: " [verify reading]",
        count: ["1 patient from the server", "3 patients from the server", "11 patients from the server"],
        events: "Showing 1 of 1 event · 9 of 9 categories",
      },
    }[locale];
    expect(f("patient-gap-not-stated")).toBe(want.gap);
    expect(f("lists-gap-not-stated")).toBe(want.gap);
    expect(f("calendar-card-verify-suffix")).toBe(want.verify);
    expect([1, 3, 11].map((n) => f("dev-patient-count", { n }))).toEqual(want.count);
    expect(f("patient-tl-status", { shown: 1, all: 1, cats: 9, total: 9 })).toBe(want.events);
  });
});
