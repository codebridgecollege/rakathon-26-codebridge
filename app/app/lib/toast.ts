// A toast with text the list screens already formatted (their messages mix catalog text with names and slots). It goes
// through the app's one toast store, which AppToasts.vue shows.
import { useToastStore } from "../stores/toast";

export function toast(text: string): void {
  useToastStore().show({ text });
}
