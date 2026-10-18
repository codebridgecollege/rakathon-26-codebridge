// The old page's toast (toast() in mocks/src/v3-template.html): a short message at the bottom for 2.6 s, styled by
// the copied CSS. role="status" lets screen readers announce it (the old page had none; e2e/README.md lists the gap).
export const TOAST_MS = 2600;

export function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), TOAST_MS);
}
