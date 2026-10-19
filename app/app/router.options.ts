// Scroll rules (issue #48). Nuxt's default scrolls to the top whenever the path changes, and a tab change is a path
// change (/patient/10/labs to /patient/10/alerts), so reading further down a tab and switching tab threw the doctor back
// to the top. Here a tab change within the same case keeps the scroll position; every other navigation behaves as in
// Nuxt's default: a new screen or case starts at the top, and back or forward restores the saved position.
import type { RouterConfig } from "@nuxt/schema";
import { START_LOCATION, type RouteLocationNormalized } from "vue-router";
import { useNuxtApp } from "#app/nuxt";
import { useRouter } from "#app/composables/router";

// Exported for the unit test.
export function isTabChangeOfSameCase(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  return to.name === "patient" && from.name === "patient" && to.params.nr === from.params.nr;
}

const config: RouterConfig = {
  scrollBehavior(to, from, savedPosition) {
    // Back or forward between tabs of one case still restores the position saved for that entry.
    if (isTabChangeOfSameCase(to, from)) return savedPosition ?? false;
    if (from === START_LOCATION) return savedPosition ?? { left: 0, top: 0 };
    const nuxtApp = useNuxtApp();
    const router = useRouter();
    // Scroll only after the new page has rendered, otherwise the page is too short to scroll to the saved position.
    return new Promise((resolve) => {
      nuxtApp.hooks.hookOnce("page:loading:end", () => {
        requestAnimationFrame(() => {
          // A newer navigation has started meanwhile: leave the scroll to it.
          resolve(router.currentRoute.value.fullPath !== to.fullPath ? false : (savedPosition ?? { left: 0, top: 0 }));
        });
      });
    });
  },
};

export default config;
