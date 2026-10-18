// The app's route paths (Vue Router history mode, app/nuxt.config.ts). headers.mjs makes the Worker's assets serve the
// app's page (/) under each of them, by a 200 rewrite in _redirects, with the page's security headers, and only under
// them: any other path keeps the real 404 page (not_found_handling: 404-page), so a mistyped or retired address never
// looks alive. A splat covers the route's parameters (/calendar/<Monday>, /patient/<nr>/<tab>). A new page in
// app/app/pages/ needs its prefix here; app/test/routes.test.ts fails until it has one.
export const APP_ROUTES = ["/patients", "/calendar", "/calendar/*", "/tasks", "/staff", "/admin", "/patient/*"];
