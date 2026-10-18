// The catalogs load with the settings I18N.md requires, every message ID the app uses exists in Czech, and the CSS is
// still the old page's.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createFluentVue, useFluent } from "fluent-vue";
import { CLIENT_ERROR_IDS } from "@codebridge/api-client";
import { bundlesFor, chooseLocale, makeBundle } from "../app/lib/i18n";

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

  it("falls back to Czech for a message Slovak does not have yet", () => {
    // A real component, so the test goes through fluent-vue's plugin as the app does (template $t and useFluent).
    const Comp = defineComponent({
      setup() {
        const { $t } = useFluent();
        return () => h("p", [$t("nav-patients"), " / ", $t("user-picker-with-function", { name: "A", fn: "B" })]);
      },
    });
    const w = mount(Comp, { global: { plugins: [createFluentVue({ bundles: bundlesFor("sk") })] } });
    expect(w.text()).toBe("Databáze pacientů / A (B)");
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
      for (const m of readFileSync(f, "utf8").matchAll(/(?:message_id: |\?\? |null, )"([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) used.add(m[1]!);
    }
    for (const group of Object.values(CLIENT_ERROR_IDS)) for (const id of Object.values(group)) used.add(id);
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((id) => !cs.hasMessage(id))).toEqual([]);
  });
});

describe("page CSS", () => {
  it("is the old page's CSS unchanged (node app/scripts/sync-css.mjs to refresh)", () => {
    expect(() => execFileSync(process.execPath, [path.join(import.meta.dirname, "../scripts/sync-css.mjs"), "--check"])).not.toThrow();
  });
});
