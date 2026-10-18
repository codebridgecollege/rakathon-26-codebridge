<script setup lang="ts">
// "Odeslané e-maily". Mails carry no medical text on the server either:
// the page builds the count sentence and the link itself, and the approval mail names only the case ID.
import { computed } from "vue";
import { useListText } from "../../composables/useListText";
import { useWorkflowStore } from "../../stores/workflow";
import { useStaffStore } from "../../stores/staff";

// The example internal address of the app; nothing is sent in the demo.
const APP_LINK = "https://mdt.fno.local/ulohy";
const CASE_LINK = "https://mdt.fno.local/pripad/";

type MailWire = { kind?: string; to?: string | null; by?: string; when?: string; n?: number; case_id?: string };

const text = useListText();
const workflow = useWorkflowStore();
const staff = useStaffStore();
// Newest first.
const mails = computed(() => (workflow.mails as MailWire[]).slice().sort((a, b) => String(b.when).localeCompare(String(a.when))));
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ $t("tasks-mails-title") }}</h2></div>
    <template v-for="(m, i) in mails" :key="i">
      <div v-if="m.kind === 'digest'" class="mail">
        <div class="row"><b>{{ $t("tasks-mail-digest-subject") }}</b><span class="muted small">{{ text.dateTime(m.when) }}</span></div>
        <p class="small" style="margin:6px 0">{{ $t("tasks-mail-digest-to", { to: m.to ?? "", by: m.by ?? "" }) }}</p>
        <p style="margin:0;white-space:pre-line" class="mailbody">{{ `${$t("tasks-waiting", { n: m.n ?? 0 })}\n${APP_LINK}` }}</p>
        <p class="muted small" style="margin:6px 0 0">{{ $t("tasks-mail-digest-note") }}</p>
      </div>
      <div v-else class="mail">
        <div class="row"><b>{{ $t("tasks-mail-approval-subject") }}</b></div>
        <p class="small" style="margin:6px 0">{{ $t("tasks-mail-approval-to", { to: staff.coord?.name ?? "" }) }}</p>
        <p style="margin:0">{{ $t("tasks-mail-approval-body", { id: m.case_id ?? "", n: m.n ?? 0 }) }}</p>
        <p style="margin:6px 0 0">{{ $t("tasks-mail-link") }} <span class="num">{{ CASE_LINK }}{{ m.case_id }}</span> <span class="muted small">{{ $t("tasks-mail-example-address") }}</span></p>
        <p class="muted small" style="margin:6px 0 0">{{ $t("tasks-mail-approval-note") }}</p>
      </div>
    </template>
    <p v-if="!mails.length" class="muted small">{{ $t("tasks-mails-none") }}</p>
  </section>
</template>
