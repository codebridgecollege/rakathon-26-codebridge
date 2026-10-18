<script setup lang="ts">
// The conclusion draft under "Závěr MDT" (the draftable part of conclusionBox() and syncConcl() in the template). Only a
// doctor writes it; the assistant never proposes a conclusion. It stays a draft until it is approved in "Projednání na
// MDT", and a new draft sits under the valid conclusion, so a draft is never read as the decision.
//
// The field is never re-created while the doctor types: recreating it mid-typing broke IME composition on phone
// keyboards and Czech dead keys. Its value comes from the store, which holds exactly what the field holds, so Vue never
// writes into it during typing. "change" and "compositionend" store the same value for input paths that send no
// "input" event, such as dictation or a committed composition.
import { computed } from "vue";
import { usePatient } from "../../composables/usePatient";
import { useDiscussionStore } from "../../stores/discussion";

const props = defineProps<{ hasValid: boolean }>();
const c = usePatient();
const disc = useDiscussionStore();
const file = computed(() => c.p.value.file);
const pr = computed(() => disc.protoOf(file.value));
const has = computed(() => !!pr.value.concl.trim());

function sync(e: Event) {
  if (pr.value.state === "approved" || c.p.value.status === "closed") return;
  disc.setText(file.value, "concl", (e.target as HTMLTextAreaElement).value);
}
// Leaving the field stores it at once instead of after the pause.
function flushNow() {
  if (disc.isDirty(file.value)) void disc.flush(file.value);
}
</script>

<template>
  <span v-if="props.hasValid" id="concl-new-label" class="label" style="display:block;margin-top:10px">{{ $t("discussion-concl-new-label") }}</span>
  <!-- The label above describes the field rather than naming it, so the field keeps the name its placeholder gives. -->
  <textarea
    id="concl"
    class="input"
    :placeholder="$t('discussion-concl-placeholder')"
    :aria-describedby="props.hasValid ? 'concl-new-label' : undefined"
    style="min-height:70px;margin-top:4px"
    :value="pr.concl"
    @input="sync"
    @change="sync"
    @compositionend="sync"
    @focusout="flushNow"
  />
  <p id="concldraft" class="muted small" style="margin:4px 0 0" :hidden="!has">{{ $t("discussion-concl-draft-note") }}</p>
</template>
