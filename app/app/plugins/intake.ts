// Wires the "Nový pacient" dialog and the phone upload into the app's routes and the user switch, as the old page's
// readHash() and switchApiUser() did:
// - back or forward away from the dialog closes it and discards the open intake, as closing it does;
// - a user switch first ends the intake and the phone upload session, which belong to the previous user;
// - a finished intake opens the new patient (/patient/<id>) or the patient list. The patient screens may replace
//   this with useNewPatient().setNavigation().
import { defineNuxtPlugin } from "#app";
import type { Router } from "vue-router";
import { useIntakeStore } from "../stores/intake";
import { usePhoneStore } from "../stores/phone";
import { useSessionStore } from "../stores/session";
import { defaultIntakeNavigation } from "../lib/intake-nav";

export default defineNuxtPlugin((nuxtApp) => {
  const router = nuxtApp.$router as Router;
  const intake = useIntakeStore();
  const phone = usePhoneStore();

  intake.setNavigation(defaultIntakeNavigation(router));

  router.afterEach((to, from) => {
    if (to.fullPath !== from.fullPath && intake.isOpen) intake.close();
  });

  useSessionStore().onBeforeUserSwitch(async () => {
    await intake.closeForUserSwitch();
    phone.close();
  });
});
