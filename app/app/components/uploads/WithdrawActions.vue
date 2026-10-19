<script setup lang="ts">
// Taking a processed upload of another patient out of the case (POST /documents/:id/withdraw). The server deletes its
// content and keeps the row with the reason. Two steps, because the content cannot come back; shown only where the
// pipeline runs for the org (CaseUploads), and off while the request runs, so a double click sends one.
import { ref } from "vue";
import { useFluent } from "fluent-vue";
import type { WithdrawReason } from "@codebridge/api-client";

const props = defineProps<{ name: string }>();
const emit = defineEmits<{ withdraw: [reason: WithdrawReason, done: () => void] }>();
const { $t } = useFluent();
const asking = ref(false);
const busy = ref(false);

function confirm() {
  busy.value = true;
  emit("withdraw", "wrong_patient", () => {
    busy.value = false;
    asking.value = false;
  });
}
</script>

<template>
  <span class="small" style="flex-basis:100%;margin-top:4px">
    <button v-if="!asking" class="btn small" @click="asking = true">{{ $t("upload-withdraw-wrong-patient") }}</button>
    <template v-else>
      <span role="alert">{{ $t("upload-withdraw-confirm-wrong-patient", { name: props.name }) }}</span>{{ " " }}
      <button class="btn small" :disabled="busy" @click="confirm">{{ $t("upload-withdraw-yes") }}</button>{{ " " }}
      <button class="btn small" :disabled="busy" @click="asking = false">{{ $t("upload-withdraw-no") }}</button>
    </template>
  </span>
</template>
