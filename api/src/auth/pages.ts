// The few pages the Worker serves itself during a login (docs/design/AUTH.md): "Nemáte přístup", a failed login, the
// IdP unreachable, a misconfigured server, and the end of a login in a second window. Fixed pages, never a redirect
// back to the login, so a failure cannot loop. Text comes from the shared catalogs (i18n/<lang>/auth.ftl).
import cs from "../../../i18n/cs/auth.ftl";
import sk from "../../../i18n/sk/auth.ftl";
import en from "../../../i18n/en/auth.ftl";

export const PAGE_LOCALES = ["cs", "sk", "en"] as const;
export type PageLocale = (typeof PAGE_LOCALES)[number];
export const pageLocale = (x: unknown): PageLocale => ((PAGE_LOCALES as readonly unknown[]).includes(x) ? (x as PageLocale) : "cs");

// The login pages use single-line messages without placeables, so this reads the subset of Fluent they need; the
// catalog test (test/oidc.test.ts) fails when a message of auth.ftl falls outside it.
export function parseCatalog(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9-]*) = (.+)$/.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}
const CATALOGS: Record<PageLocale, Map<string, string>> = { cs: parseCatalog(cs), sk: parseCatalog(sk), en: parseCatalog(en) };

// Falls back to Czech message by message, as the app does.
export const msg = (locale: PageLocale, id: string) => CATALOGS[locale].get(id) ?? CATALOGS.cs.get(id) ?? id;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export type PageKind = "no_access" | "failed" | "unavailable" | "misconfigured" | "done";
const TEXT: Record<PageKind, [title: string, body: string]> = {
  no_access: ["auth-no-access-title", "auth-no-access-body"],
  failed: ["auth-failed-title", "auth-failed-body"],
  unavailable: ["auth-unavailable-title", "auth-unavailable-body"],
  misconfigured: ["auth-misconfigured-title", "auth-misconfigured-body"],
  done: ["auth-done-title", "auth-done-body"],
};
const STATUS: Record<PageKind, 200 | 400 | 403 | 500 | 503> = { no_access: 403, failed: 400, unavailable: 503, misconfigured: 500, done: 200 };

// No script at all, styles inline: the policy allows nothing else, and the page is never framed or cached.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

export function authPage(kind: PageKind, locale: PageLocale, link: { href: string; textId: string } | null): Response {
  const [t, b] = TEXT[kind];
  const title = msg(locale, t);
  const a = link ? `<p><a class="btn" href="${esc(link.href)}">${esc(msg(locale, link.textId))}</a></p>` : "";
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - ${esc(msg(locale, "auth-page-app"))}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f5f7fa;color:#1d2733}
main{max-width:34rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #d6dde6;border-radius:8px}
h1{font-size:1.4rem;margin:0 0 1rem}p{line-height:1.5}
.btn{display:inline-block;padding:.55rem 1rem;border-radius:6px;background:#1f5fa8;color:#fff;text-decoration:none}
.btn:focus-visible{outline:3px solid #f0a500;outline-offset:2px}
</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(msg(locale, b))}</p>${a}</main></body></html>`;
  return new Response(html, {
    status: STATUS[kind],
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
    },
  });
}
