// Fluent bundles for the app (docs/design/I18N.md). The catalogs are the shared .ftl files at the repository root
// (i18n/<locale>/<area>.ftl), the same files the old page and the Worker read. One file per area keeps parallel work on
// different screens from colliding in one catalog. Czech is the source; Slovak and English fall back to it message by
// message until they are translated.
import { FluentBundle, FluentResource } from "@fluent/bundle";

export const LOCALES = ["cs", "sk", "en"] as const;
export type Locale = (typeof LOCALES)[number];
// The deployment's default language: Czech today, Slovak for a Slovak hospital.
export const DEFAULT_LOCALE: Locale = "cs";

// Every area file of a locale, joined in file-name order; a message ID must be unique across the files of a locale.
const FILES = import.meta.glob("../../../i18n/*/*.ftl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sourceOf = (locale: Locale) =>
  Object.keys(FILES)
    .filter((p) => p.includes(`/i18n/${locale}/`))
    .sort()
    .map((p) => FILES[p])
    .join("\n");
const SOURCES: Record<Locale, string> = { cs: sourceOf("cs"), sk: sourceOf("sk"), en: sourceOf("en") };
const STORAGE_KEY = "lang";

const isLocale = (x: unknown): x is Locale => typeof x === "string" && (LOCALES as readonly string[]).includes(x);

export function makeBundle(locale: Locale, source = SOURCES[locale]): FluentBundle {
  // useIsolating off: otherwise every placeholder is wrapped in invisible direction marks, which break copy-paste and
  // text comparisons in tests.
  const b = new FluentBundle(locale, { useIsolating: false });
  const errors = b.addResource(new FluentResource(source));
  // A syntax error in a catalog is a build mistake; it is reported, and the broken message falls back to Czech.
  if (errors.length) console.warn(`i18n: ${errors.length} errors in ${locale}.ftl`);
  return b;
}

// The fallback chain fluent-vue walks: the chosen language first, then Czech.
export function bundlesFor(locale: Locale): FluentBundle[] {
  return locale === "cs" ? [makeBundle("cs")] : [makeBundle(locale), makeBundle("cs")];
}

// Order of choice (I18N.md): ?lang= in the address, then the stored choice, then the deployment default. The
// browser's language does not decide, so a jury laptop set to English still opens the demo the presenter knows.
export function chooseLocale(search: string, stored: string | null): Locale {
  const q = new URLSearchParams(search).get("lang");
  if (isLocale(q)) return q;
  if (isLocale(stored)) return stored;
  return DEFAULT_LOCALE;
}

export function storedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private window or blocked storage: the default applies.
    return null;
  }
}
