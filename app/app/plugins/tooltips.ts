// Tooltips for info and certainty icons, as the old page shows them (showTip() and its listeners in the template): on
// hover or keyboard focus the element's title moves to data-tip and a styled tip (.tip) appears, so the browser does
// not show a second one. A click on such an icon shows its tip instead of acting, unless the icon sits in something
// that opens a source, an edit, a tab or a menu (marked with data-src, data-edit, data-tab, data-stmenu or a clickable
// table row). The meaning of every mark stays in its title, so the e2e suite and screen readers can read it.
import { defineNuxtPlugin } from "#app";

const TIP_SEL = ".info, .mk, .edtag, .qlbl.ok, .qlbl.draft, .gapq, .chip[title], .chip[data-tip], .vf, .vbox, .dt[data-tip], .lpin[title], .lpin[data-tip]";
const ACTS = "[data-src],[data-edit],[data-act],[data-tab],[data-open],[data-stmenu],tr.click";

export default defineNuxtPlugin(() => {
  let tipEl: HTMLDivElement | null = null;

  function hideTip() {
    tipEl?.remove();
    tipEl = null;
  }

  function showTip(el: HTMLElement) {
    if (el.title) {
      el.dataset.tip = el.title;
      el.removeAttribute("title");
    }
    if (!el.dataset.tip) return;
    hideTip();
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    tipEl.textContent = el.dataset.tip;
    document.body.appendChild(tipEl);
    const r = el.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    tipEl.dataset.for = el.dataset.tip;
  }

  const tipOf = (e: Event) => ((e.target as Element | null)?.closest?.(TIP_SEL) as HTMLElement | null) ?? null;

  document.addEventListener("mouseover", (e) => {
    const el = tipOf(e);
    if (el) showTip(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = tipOf(e);
    if (el && !el.contains(e.relatedTarget as Node | null)) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const el = tipOf(e);
    if (el) showTip(el);
  });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, true);
  // Capture phase, so a click on an icon inside a clickable card (a timeline event) shows the tip and goes no further.
  document.addEventListener(
    "click",
    (e) => {
      const el = tipOf(e);
      if (el && !el.closest(ACTS)) {
        e.preventDefault();
        e.stopPropagation();
        showTip(el);
        return;
      }
      hideTip();
    },
    true,
  );
});
