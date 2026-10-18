// The old page's toast: a short message at the bottom of the screen for 2.6 s (toast() in the template). It has no
// status role there either; the e2e suite reads it right after the action (e2e/README.md).
export function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
