// fluent-vue registered in a plain Nuxt plugin, not through unplugin-fluent-vue/nuxt, whose Nuxt integration declares
// @nuxt/kit ^3 (FRONTEND.md, "Risks"). Components get $t and the <i18n> component, and useFluent() in setup.
import { defineNuxtPlugin } from "#app";
import { createFluentVue } from "fluent-vue";
import { bundlesFor, chooseLocale, storedLocale } from "../lib/i18n";

export default defineNuxtPlugin((nuxtApp) => {
  const locale = chooseLocale(location.search, storedLocale());
  const fluent = createFluentVue({
    bundles: bundlesFor(locale),
    // A message missing from every bundle shows its ID; in development the console says which one.
    warnMissing: (key) => {
      if (import.meta.dev) console.warn(`i18n: missing message ${key}`);
    },
  });
  nuxtApp.vueApp.use(fluent);
  // Screen readers and hyphenation follow the interface language.
  document.documentElement.lang = locale;
  return { provide: { fluent } };
});
