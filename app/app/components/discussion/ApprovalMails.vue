<script setup lang="ts">
// "Odeslané upozornění" in an approved case (the mails part of mdtCard() and mailHtml() in the template). The mail to
// the coordinator names only the case ID and the number of tasks, with a link: notifications carry a link, never
// medical data. Without tasks no mail is sent, and the card says so.
import { computed } from "vue";
import { usePatient } from "../../composables/usePatient";
import { useWorkflowStore } from "../../stores/workflow";
import { useStaffStore } from "../../stores/staff";

// The example internal address of a case; nothing is sent in the demo.
const CASE_LINK = "https://mdt.fno.local/pripad/";
type MailWire = { kind?: string; case_id?: string; n?: number; when?: string };

const c = usePatient();
const workflow = useWorkflowStore();
const staff = useStaffStore();
// Newest first, as the old page sorted them.
const mails = computed(() =>
  (workflow.mails as MailWire[])
    .filter((m) => m.kind !== "digest" && m.case_id === c.p.value.id)
    .slice()
    .sort((a, b) => String(b.when).localeCompare(String(a.when))),
);
</script>

<template>
  <div class="sub">
    <div class="head"><h3>{{ $t("discussion-mails") }}</h3></div>
    <div v-for="(m, i) in mails" :key="i" class="mail">
      <div class="row"><b>{{ $t("tasks-mail-approval-subject") }}</b></div>
      <p class="small" style="margin:6px 0">{{ $t("tasks-mail-approval-to", { to: staff.coord?.name ?? "" }) }}</p>
      <p style="margin:0">{{ $t("tasks-mail-approval-body", { id: m.case_id ?? "", n: m.n ?? 0 }) }}</p>
      <p style="margin:6px 0 0">{{ $t("tasks-mail-link") }} <span class="num">{{ CASE_LINK }}{{ m.case_id }}</span> <span class="muted small">{{ $t("tasks-mail-example-address") }}</span></p>
      <p class="muted small" style="margin:6px 0 0">{{ $t("tasks-mail-approval-note") }}</p>
    </div>
    <p v-if="!mails.length" class="muted small" style="margin:0">{{ $t("discussion-mails-none") }}</p>
  </div>
</template>
