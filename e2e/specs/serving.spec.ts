import { test, expect } from "../fixtures";

// What the Worker serves around the app (api/scripts/stage-assets.sh and headers.mjs): the security headers of the
// page, the phone page, the real 404, the redirects of the old addresses, and an old hash link. The app is at / and
// today's page at /legacy/; the base URL says which one this run checks.

const isLegacy = (baseURL: string) => new URL(baseURL).pathname.startsWith("/legacy/");

test("the page carries the security headers; the app's policy allows no inline or eval script", async ({ request, baseURL }) => {
  const res = await request.get(baseURL!);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("same-origin");
  if (isLegacy(baseURL!)) {
    // The old page runs inline scripts throughout and gets no policy.
    expect(h["content-security-policy"]).toBeUndefined();
    return;
  }
  const csp = h["content-security-policy"] ?? "";
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "";
  expect(directive("default-src")).toBe("default-src 'none'");
  expect(directive("script-src")).toMatch(/^script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+$/);
  expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  expect(directive("object-src")).toBe("object-src 'none'");
  expect(directive("base-uri")).toBe("base-uri 'none'");
});

test("the phone page, the real 404 and the redirects of old addresses", async ({ request, baseURL }) => {
  const root = new URL("/", baseURL!).toString();
  const phone = await request.get(new URL("/u", root).toString());
  expect(phone.status()).toBe(200);
  expect(await phone.text()).toContain("<title>");
  const missing = await request.get(new URL("/neexistuje", root).toString());
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("Stránka nenalezena.");
  // An unknown path under the app's own folders is a 404 too, never the app shell.
  expect((await request.get(new URL("/_nuxt/neexistuje.js", root).toString())).status()).toBe(404);
  // The new app's address during the port, and the old page's relative ZIP link, which now resolves under /legacy/.
  const app = await request.get(new URL("/app/", root).toString(), { maxRedirects: 0 });
  expect(app.status()).toBe(301);
  expect(app.headers()["location"]).toBe("/");
  const zip = await request.get(new URL("/legacy/ukazka/S02-dokumenty.zip", root).toString(), { maxRedirects: 0 });
  expect(zip.status()).toBe(302);
  expect(zip.headers()["location"]).toBe("/ukazka/S02-dokumenty.zip");
  expect((await request.get(new URL("/ukazka/S02-dokumenty.zip", root).toString())).status()).toBe(200);
});

test("an old hash link opens the case's tab", async ({ app }) => {
  // Today's links have no slash after the hash (#patient/10/labs); the new app's router reads them as well.
  await app.open("patient/10/labs");
  await expect(app.tab("Laboratoř")).toHaveAttribute("aria-selected", "true");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
});
