<script setup lang="ts">
// "Závěr MDT" under the brief (conclusionBox() in the template). The valid, approved conclusion stays on top with who
// approved it and when; earlier ones are superseded, never erased (append-only history), each with its frozen
// report. A closed case takes no new conclusion until it is reopened from the status menu.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";
import { useDiscussionStore } from "../../stores/discussion";
import ConclusionDraft from "../discussion/ConclusionDraft.vue";
import { fmtWhen } from "../../lib/dates";
import { fillIdent as fillReportIdent } from "../../lib/report";

type Decision = { id?: string; version?: number; text: string; by: string; when: string; reportSnap?: string };

const { $t } = useFluent();
const c = usePatient();

const decisions = computed(() =>
  ((c.wf.value.decisions ?? []) as Decision[])
    .slice()
    .sort((a, b) => (a.version || 0) - (b.version || 0))
    .map((d) => ({ ...d, when: fmtWhen(d.when) })),
);
const last = computed(() => decisions.value.at(-1) ?? null);
// The page's copy of the record: it holds typed text the server has not stored yet.
const proto = computed(() => useDiscussionStore().protoOf(c.p.value.file));
const closed = computed(() => c.p.value.status === "closed");
const draftable = computed(() => c.isDoctor.value && proto.value.state !== "approved" && !closed.value);
const earlier = computed(() => decisions.value.slice(0, -1).reverse());

// The frozen report is stored without identity; the identity line is filled in from the list row when shown. The
// snapshot is the page's own HTML from approval time (reportHtml() escaped every value), stored on the server.
const fillIdent = (html: string | undefined) => fillReportIdent(html, c.p.value, $t);
</script>

<template>
  <div :class="['concl', last ? 'valid' : '']">
    <span class="bh">{{ $t("patient-concl-title") }}</span>
    <template v-if="last">
      <p lang="cs">{{ last.text }}</p>
      <div class="muted small">{{ $t("patient-concl-valid", { n: decisions.length, by: last.by, when: last.when }) }}</div>
      <details v-if="decisions.length > 1" class="srcs">
        <summary>{{ $t("patient-concl-earlier", { n: decisions.length - 1 }) }}</summary>
        <ul class="hist" style="margin-top:6px">
          <li v-for="(x, i) in earlier" :key="x.id ?? i" class="old small">
            <b>{{ $t("patient-concl-number", { n: decisions.length - 1 - i }) }}</b> · {{ $t("patient-concl-superseded") }} · {{ x.when }} · {{ x.by }}<br><span lang="cs">{{ x.text }}</span>
            <details v-if="x.reportSnap" class="srcs">
              <summary>{{ $t("patient-concl-report") }}</summary>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div style="margin-top:6px" lang="cs" v-html="fillIdent(x.reportSnap)" />
            </details>
          </li>
        </ul>
      </details>
    </template>
    <p v-else-if="!draftable" class="muted" style="font-size:14px">{{ $t("patient-concl-none") }}</p>
    <template v-if="closed">
      <p v-if="proto.state !== 'approved' && String(proto.concl ?? '').trim()" class="muted small" style="margin:6px 0 0">{{ $t("patient-concl-unapproved") }} <span lang="cs">{{ proto.concl }}</span></p>
      <p class="small closedmsg" style="margin:6px 0 0">{{ $t("patient-concl-closed") }}</p>
    </template>
    <ConclusionDraft v-if="draftable" :has-valid="!!last" />
  </div>
</template>
