// Routes the file-based pages do not cover: today's old links. #present/<nr> and #protocol/<nr> opened the case with
// its MDT discussion, which now sits in the patient view (readHash() in the template), so they open its overview.
// #patient/<nr>/<tab> needs no rule: the hash without its slash already reads as /patient/<nr>/<tab>.
import type { RouterConfig } from "@nuxt/schema";

export default {
  routes: (routes) => [
    ...routes,
    { path: "/present/:nr", redirect: (to) => ({ name: "patient", params: { nr: String(to.params.nr), tab: "overview" } }) },
    { path: "/protocol/:nr", redirect: (to) => ({ name: "patient", params: { nr: String(to.params.nr), tab: "overview" } }) },
  ],
} satisfies RouterConfig;
