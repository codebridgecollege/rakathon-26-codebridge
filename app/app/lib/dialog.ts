// Focus handling for the app's dialogs, which the old page did not have: focus moves into the dialog when it opens,
// Tab stays inside it, and focus goes back to where it was (the button that opened it) when it closes. Nothing visible
// changes; keyboard and screen-reader users no longer land behind the scrim.
import { nextTick, watch, type Ref } from "vue";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(el: Ref<HTMLElement | null>, open: Ref<boolean>) {
  let before: HTMLElement | null = null;
  watch(
    open,
    async (o) => {
      if (o) {
        before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await nextTick();
        el.value?.focus();
      } else if (before?.isConnected) {
        before.focus();
        before = null;
      }
    },
    { immediate: true },
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Tab" && el.value) trapTab(e, el.value);
  }

  return { onKeydown };
}

// Keeps Tab and Shift+Tab inside a dialog. The upload zone's input is transparent but laid out, so it counts: it is
// how the file chooser is reached from the keyboard. An input with the hidden attribute cannot take focus. Focus
// outside the dialog (after a click on the scrim's edge, say) is brought back in.
export function trapTab(e: KeyboardEvent, dlg: HTMLElement): void {
  const items = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null && !x.hidden);
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const at = document.activeElement;
  if (!at || !dlg.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (at === first || at === dlg)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}
