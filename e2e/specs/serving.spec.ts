import { test, expect, isLegacy } from "../fixtures";

// What the Worker serves around the app (api/scripts/stage-assets.sh and headers.mjs): the security headers of the
// page, the app's page under its route paths with the same headers, the phone page, the real 404 for every other
// path, the old page's redirects, and a deep link that survives a reload. The app is at / and today's page at
// /legacy/; the base URL says which one this run checks.

// One address per route prefix the Worker serves the app's page for (APP_ROUTES in api/scripts/app-routes.mjs).
const APP_PATHS = ["/patients", "/calendar", "/calendar/2026-10-22", "/tasks", "/staff", "/admin", "/patient/10", "/patient/10/labs"];
// Paths that are no app route and must stay a real 404, never the app shell: near misses of the routes and the app's
// address during the port (/app/), whose redirect is gone.
const NOT_APP = ["/neexistuje", "/patient", "/patient/", "/patients/", "/tasks/", "/admin/", "/patients/10", "/tasks/x", "/patient/10/labs/x", "/calendar/a/b", "/app", "/app/", "/app/patients"];

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
  // The old page's relative ZIP link, which now resolves under /legacy/.
  const zip = await request.get(new URL("/legacy/ukazka/S02-dokumenty.zip", root).toString(), { maxRedirects: 0 });
  expect(zip.status()).toBe(302);
  expect(zip.headers()["location"]).toBe("/ukazka/S02-dokumenty.zip");
  expect((await request.get(new URL("/ukazka/S02-dokumenty.zip", root).toString())).status()).toBe(200);
});

test("the app's route paths serve its page with the same policy; other paths stay a 404", async ({ request, baseURL }) => {
  const root = new URL("/", baseURL!).toString();
  const home = await request.get(root);
  const page = await home.text();
  const csp = home.headers()["content-security-policy"];
  expect(csp).toBeTruthy();
  for (const path of APP_PATHS) {
    const res = await request.get(new URL(path, root).toString(), { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    // The same page as /, so the policy's script hashes match its inline scripts.
    expect(await res.text(), path).toBe(page);
    expect(res.headers()["content-security-policy"], path).toBe(csp);
    expect(res.headers()["cross-origin-opener-policy"], path).toBe("same-origin");
    expect(res.headers()["x-frame-options"], path).toBe("DENY");
    expect(res.headers()["x-content-type-options"], path).toBe("nosniff");
  }
  for (const path of NOT_APP) {
    const res = await request.get(new URL(path, root).toString(), { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).toContain("Stránka nenalezena.");
  }
  // The API, the phone page and the old page are not the app.
  const health = await request.get(new URL("/api/health", root).toString());
  expect(health.status()).toBe(200);
  expect(health.headers()["content-type"]).toContain("application/json");
  expect((await request.get(new URL("/api/neexistuje", root).toString())).status()).toBe(404);
  const legacy = await request.get(new URL("/legacy/", root).toString());
  expect(legacy.status()).toBe(200);
  expect(await legacy.text()).not.toBe(page);
  expect(legacy.headers()["content-security-policy"]).toBeUndefined();
});

test("a link to a case's tab opens it, also after a reload", async ({ app, page }) => {
  await app.open("patient/10/labs");
  await expect(app.tab("Laboratoř")).toHaveAttribute("aria-selected", "true");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
  await page.reload();
  await expect(app.tab("Laboratoř")).toHaveAttribute("aria-selected", "true");
  await expect(app.main.getByRole("heading", { level: 1, name: /Poláček Daniel/ })).toBeVisible();
});
