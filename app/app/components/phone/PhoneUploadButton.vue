<script setup lang="ts">
// "Nahrát z telefonu". The screen shows it only where this user could upload to the case
// (an open intake, an upload zone that is offered); the dialog itself is PhoneUploadDialog, mounted once in app.vue.
import { useFluent } from "fluent-vue";
import type { UploadTarget } from "@codebridge/api-client";
import { usePhoneStore } from "../../stores/phone";

const props = withDefaults(defineProps<{ target: UploadTarget; caseId: string; file?: string | null; rowStyle?: string }>(), { file: null, rowStyle: undefined });
const { $t } = useFluent();
const phone = usePhoneStore();
</script>

<template>
  <div class="row" :style="props.rowStyle">
    <button class="btn small" @click="phone.open(props.target, props.caseId, props.file)">{{ $t("phone-button") }}</button>
  </div>
</template>
