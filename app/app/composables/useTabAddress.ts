// Keeps the address of a patient view naming the tab it shows (/patient/<nr> becomes /patient/<nr>/<tab> once the
// case's data is there), without overriding a navigation the user has already started. vue-router cancels a pending
// navigation when a newer one starts, so a replace fired by data arriving while the user's click on "Databáze
// pacientů" is still resolving would keep the user on the case.
import { watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from "vue-router";

export type TabAddress = {
  // The case's number in the route (nrOf(file)).
  nr: string;
  // Whether the case's data is there, so the shown tab is final.
  ready: boolean;
  // The tab on screen, and the one the address asks for (none for /patient/<nr>).
  shown: string;
  asked: string | null;
};

export function useTabAddress(source: () => TabAddress) {
  const router = useRouter();
  // Set once a navigation away from this case starts: to another area, or to another case on the same route. A tab
  // change of this case (our own replace included) clears it.
  let leaving = false;
  onBeforeRouteLeave(() => {
    leaving = true;
  });
  onBeforeRouteUpdate((to) => {
    leaving = String(to.params.nr ?? "") !== source().nr;
  });
  watch(
    source,
    (s) => {
      if (s.ready && s.asked !== s.shown && !leaving) void router.replace({ name: "patient", params: { nr: s.nr, tab: s.shown } });
    },
    { immediate: true },
  );
}
