// Short notes at the bottom of the screen: shown for 2.6 s, newest on top. They carry
// confirmations and refusals; the actions themselves never wait for them.
import { defineStore } from "pinia";
import { ref } from "vue";
import type { Msg } from "../lib/msg";

export const TOAST_MS = 2600;

export const useToastStore = defineStore("toast", () => {
  const items = ref<{ key: number; msg: Msg }[]>([]);
  let seq = 0;

  function show(msg: Msg) {
    const key = ++seq;
    items.value.push({ key, msg });
    setTimeout(() => {
      items.value = items.value.filter((t) => t.key !== key);
    }, TOAST_MS);
  }

  return { items, show };
});
