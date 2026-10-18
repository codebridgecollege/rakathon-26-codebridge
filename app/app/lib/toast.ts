// A toast with a text the patient screen already formatted (toast() in the template). It goes through the shared
// toast store, so AppToasts draws it like every other toast: 2.6 s at the bottom, with a status role.
import { useToastStore } from "../stores/toast";

export function toast(msg: string): void {
  useToastStore().show({ text: msg });
}
