// Tells lib/navigation.ts how each route was reached, so the access log can say whether a case was opened by a link
// or the browser history (the server writes that text).
import { defineNuxtPlugin } from "#app";
import { noteNavigation, notePopstate } from "../lib/navigation";

export default defineNuxtPlugin((nuxtApp) => {
  window.addEventListener("popstate", notePopstate);
  nuxtApp.$router.afterEach(() => noteNavigation());
});
