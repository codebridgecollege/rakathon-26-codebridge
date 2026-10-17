// The report snapshot the approving doctor's browser built. The server cannot render it itself yet, so it accepts
// only the markup the page's reportHtml() produces (no script, no event handlers, no external URLs) and refuses a
// snapshot that carries the patient's identity: identity lives in the patients table only, the page fills the
// patient line from the patient row when it shows the report.
import { D } from "./errors";

const TAGS = new Set(["article", "b", "i", "em", "strong", "small", "br", "div", "span", "p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "img", "section", "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"]);
const ATTRS = new Set(["class", "id", "alt", "aria-label", "title", "style", "src"]);

export function validateReportHtml(html: string, identity: { birthNumber: string | null; names: string[] }): void {
  const bad = () => D.invalidInput({ fields: { report_html: "Report obsahuje nepovolený obsah." } });
  if (/<!--|<!|<\?/.test(html)) throw bad();
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    if (!TAGS.has(m[1]!.toLowerCase())) throw bad();
    const attrs = m[2]!.replace(/\/\s*$/, "");
    const rest = attrs.replace(/\s+([a-zA-Z-]+)="([^"]*)"/g, (_all, name: string, value: string) => {
      const n = name.toLowerCase();
      if (!ATTRS.has(n)) throw bad();
      if (n === "style" && /url\s*\(|expression|javascript:|@import/i.test(value)) throw bad();
      if (n === "src" && !/^(data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+|[a-z0-9_./-]+)$/i.test(value)) throw bad();
      return "";
    });
    if (rest.trim()) throw bad();
  }
  // A "<" that does not open an allowed tag would be text the page escaped; a raw one means hand-built markup.
  if ((html.match(/</g) || []).length !== [...html.matchAll(/<\/?[a-zA-Z0-9]+[^>]*>/g)].length) throw bad();
  const text = html.replace(/\s+/g, " ");
  const rcDigits = identity.birthNumber?.replace("/", "");
  const hasRc = !!identity.birthNumber && (text.includes(identity.birthNumber) || (!!rcDigits && text.includes(rcDigits)));
  if (hasRc || identity.names.some((n) => n && n.length >= 5 && text.includes(n)))
    throw D.invalidInput({ fields: { report_html: "Report nesmí obsahovat identitu pacienta; obnovte stránku." } });
}
