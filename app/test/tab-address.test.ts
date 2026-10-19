// useTabAddress (the patient view's address naming its tab) under a real vue-router: the address follows the tab once
// the data is there, and a navigation the user started meanwhile is not cancelled by it.
import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, useRoute } from "vue-router";
import { computed, defineComponent, h, ref } from "vue";
import { useTabAddress } from "../app/composables/useTabAddress";
import { deferred } from "./helpers";

const ready = ref(false);

// The patient route's component: shows "overview" when no tab is asked for, as PatientView falls back to the first tab.
const Case = defineComponent({
  setup() {
    const route = useRoute();
    const asked = computed(() => (route.params.tab ? String(route.params.tab) : null));
    useTabAddress(() => ({ nr: String(route.params.nr), ready: ready.value, shown: asked.value ?? "overview", asked: asked.value }));
    return () => h("p", "case");
  },
});

async function setup() {
  ready.value = false;
  // The list's page loads lazily, so a push to it stays pending until the test lets it resolve: the window in which
  // the case's data used to arrive and its replace cancelled the push (seen in CI right after the intake).
  const listLoaded = deferred<void>();
  const List = defineComponent({ setup: () => () => h("p", "list") });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/patients", component: () => listLoaded.promise.then(() => List) },
      { path: "/patient/:nr/:tab?", name: "patient", component: Case },
    ],
  });
  await router.push("/patient/S02");
  const w = mount(defineComponent({ setup: () => () => h(RouterView) }), { global: { plugins: [router] } });
  await flushPromises();
  return { router, w, listLoaded };
}

describe("useTabAddress", () => {
  it("names the shown tab in the address once the data is there", async () => {
    const { router } = await setup();
    expect(router.currentRoute.value.fullPath).toBe("/patient/S02");
    ready.value = true;
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/patient/S02/overview");
  });

  it("does not cancel a click away that is still resolving when the data arrives", async () => {
    const { router, w, listLoaded } = await setup();
    const nav = router.push("/patients");
    await flushPromises();
    ready.value = true;
    await flushPromises();
    listLoaded.resolve();
    expect(await nav).toBeUndefined();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/patients");
    expect(w.text()).toBe("list");
  });

  it("does not cancel a move to another case that is still resolving when the data arrives", async () => {
    const { router } = await setup();
    // A guard after the update guards holds the move, as Nuxt's own route handling can.
    const held = deferred<void>();
    router.beforeResolve((to) => (to.params.nr === "S03" ? held.promise : undefined));
    const nav = router.push("/patient/S03/labs");
    await flushPromises();
    ready.value = true;
    await flushPromises();
    held.resolve();
    expect(await nav).toBeUndefined();
    expect(router.currentRoute.value.fullPath).toBe("/patient/S03/labs");
  });
});
