// The local, text-based A4 export of the report. The HTML it reads is the same draft or frozen snapshot as the
// preview. No patient text is sent to a server, and no print popup or canvas screenshot is used.
//
// jsPDF and the DejaVu font subset are vendored in app/vendor/ (jsPDF 4.2.1, licences next to them), so the PDF output
// does not move with an npm release. They are large (about 730 kB together), so they are emitted as separate
// same-origin files and loaded as scripts only when the report dialog opens, never with the main bundle.
import jspdfUrl from "../../vendor/jspdf.umd.min.js?url";
import fontsUrl from "../../vendor/pdf-fonts.js?url";
import type { T } from "./dates";

// The part of jsPDF's API the layout uses; the UMD build puts the class on window.jspdf.
type Pdf = {
  addFileToVFS(name: string, data: string): void;
  addFont(file: string, name: string, style: string): void;
  setProperties(p: Record<string, string>): void;
  setFont(name: string, style: string): void;
  setFontSize(n: number): void;
  setTextColor(n: number): void;
  addPage(): void;
  text(s: string, x: number, y: number): void;
  splitTextToSize(s: string, w: number): string[];
  getTextWidth(s: string): number;
  setDrawColor(n: number): void;
  setLineWidth(n: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  addImage(src: string, kind: string, x: number, y: number, w: number, h: number): void;
  getNumberOfPages(): number;
  setPage(n: number): void;
  output(kind: "arraybuffer"): ArrayBuffer;
};
type PdfWindow = Window & { jspdf?: { jsPDF: new (o: Record<string, unknown>) => Pdf }; MDT_PDF_FONTS?: Record<string, string> };
const w = () => window as PdfWindow;

export type PdfMeta = { id: string };

// Loads one script once; a failed load is forgotten, so the next attempt tries again.
const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        loading.delete(src);
        reject(new Error("load failed"));
      };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

// Starts loading the PDF library and fonts (when the dialog opens) and resolves when both are there. A failure is not
// thrown here: reportPdf() says the export is unavailable, which the dialog shows when the doctor asks for the PDF.
export async function loadPdfLib(): Promise<boolean> {
  try {
    await Promise.all([w().jspdf ? null : loadScript(jspdfUrl), w().MDT_PDF_FONTS ? null : loadScript(fontsUrl)]);
    return true;
  } catch {
    return false;
  }
}

export function reportPdf(t: T, html: string, meta: PdfMeta): Pdf {
  const Ctor = w().jspdf?.jsPDF;
  const fonts = w().MDT_PDF_FONTS;
  if (!Ctor || !fonts) throw new Error(t("discussion-report-unavailable"));
  const pdf = new Ctor({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  for (const [style, data] of Object.entries(fonts)) {
    const name = `MDT-${style}.ttf`;
    pdf.addFileToVFS(name, data);
    pdf.addFont(name, "MDT", style);
  }
  pdf.setProperties({ title: t("discussion-report-pdf-title", { id: meta.id }), subject: t("discussion-report-pdf-subject"), creator: "GLIDE MDT" });
  const margin = 18;
  const width = 174;
  const bottom = 276;
  let y = 22;
  const font = (size = 10.5, bold = false) => {
    pdf.setFont("MDT", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(0);
  };
  const page = () => {
    pdf.addPage();
    y = 19;
    font(8);
    pdf.text(t("discussion-report-pdf-running", { id: meta.id }), margin, 12);
  };
  const room = (h: number) => {
    if (y + h > bottom) page();
  };
  const text = (value: string, o: { size?: number; bold?: boolean; indent?: number; gap?: number; leading?: number } = {}) => {
    const { size = 10.5, bold = false, indent = 0, gap = 2, leading = 5.1 } = o;
    font(size, bold);
    const lines = pdf.splitTextToSize(String(value || "").replace(/\u00a0/g, " "), width - indent);
    for (const l of lines) {
      room(leading);
      font(size, bold);
      pdf.text(l, margin + indent, y);
      y += leading;
    }
    y += gap;
  };
  const plain = (node: Element) => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    return (copy.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  };
  // Keeps bold diagnosis and medication terms bold in the PDF, with normal-weight qualifiers.
  const rich = (node: Element, o: { size?: number; leading?: number; gap?: number; indent?: number; prefix?: string } = {}) => {
    const { size = 10.5, leading = 5.1, gap = 2, indent = 0, prefix = "" } = o;
    const tokens: { t: string; bold: boolean }[] = [];
    const collect = (n: Node, bold = false) => {
      if (n.nodeType === 3)
        (n.textContent || "")
          .replace(/\s+/g, " ")
          .split(/( +)/)
          .filter(Boolean)
          .forEach((x) => tokens.push({ t: x, bold }));
      else if (n.nodeName === "BR") tokens.push({ t: "\n", bold });
      else [...n.childNodes].forEach((c) => collect(c, bold || n.nodeName === "B" || n.nodeName === "STRONG"));
    };
    if (prefix) tokens.push({ t: prefix, bold: false });
    collect(node);
    let line: { t: string; bold: boolean; w: number }[] = [];
    let used = 0;
    const flush = () => {
      if (!line.length) return;
      room(leading);
      let x = margin + indent;
      for (const run of line) {
        font(size, run.bold);
        pdf.text(run.t, x, y);
        x += run.w;
      }
      y += leading;
      line = [];
      used = 0;
    };
    const add = (s: string, bold: boolean) => {
      font(size, bold);
      const wd = pdf.getTextWidth(s);
      const last = line.at(-1);
      if (last?.bold === bold) {
        last.t += s;
        last.w += wd;
      } else line.push({ t: s, bold, w: wd });
      used += wd;
    };
    for (const { t: s, bold } of tokens) {
      if (s === "\n") {
        flush();
        continue;
      }
      if (!used && !s.trim()) continue;
      font(size, bold);
      const wd = pdf.getTextWidth(s);
      const max = width - indent;
      if (used + wd > max) {
        flush();
        if (!s.trim()) continue;
      }
      if (wd > max) {
        for (const ch of s) {
          font(size, bold);
          if (used + pdf.getTextWidth(ch) > max) flush();
          add(ch, bold);
        }
      } else add(s, bold);
    }
    flush();
    y += gap;
  };
  const template = document.createElement("template");
  template.innerHTML = html;
  const article = template.content.querySelector("article");
  if (!article) throw new Error(t("discussion-report-no-content"));
  const title = t("discussion-report-title");
  const signature = t("discussion-report-signature");
  const walk = (node: Element) => {
    if (node.classList.contains("signatures")) {
      room(33);
      y += 12;
      font(9);
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.2);
      for (const offset of [0, 92]) {
        pdf.line(margin + offset, y, margin + offset + 76, y);
        pdf.text(signature, margin + offset, y + 5);
      }
      y += 14;
      return;
    }
    if (node.classList.contains("hdr")) {
      const logo = node.querySelector(".report-brand img");
      if (logo) {
        pdf.addImage(logo.getAttribute("src") || "", "PNG", margin, y - 5.8, 28, (28 * 216) / 880);
        font(18, true);
        pdf.text("MDT", margin + 31, y);
        y += 12;
      }
      text(title, { size: 17, bold: true, gap: 4, leading: 7 });
      // The meta line alone; without one the header's text minus its title.
      const m = plain(node.querySelector(".report-meta") || node);
      text(m.startsWith(title) ? m.slice(title.length).trimStart() : m, { size: 9, gap: 4, leading: 4.5 });
      return;
    }
    if (node.tagName === "H4") {
      const next = node.nextElementSibling;
      const first = next?.matches("ul, ol") ? next.firstElementChild : null;
      let reserve = 21;
      if (first && next) {
        const small = next.classList.contains("src");
        font(small ? 8 : 10.5);
        const height = (pdf.splitTextToSize(plain(first), width - 2).length + 1) * (small ? 4 : 5.1);
        if (height < 80) reserve = 12 + height;
      }
      room(reserve);
      y += 3;
      text(plain(node), { bold: true, gap: 1.5 });
      return;
    }
    if (node.tagName === "P") {
      const small = node.classList.contains("src");
      rich(node, small ? { size: 8, leading: 4, gap: 2 } : {});
      return;
    }
    if (node.tagName === "UL" || node.tagName === "OL") {
      const small = node.classList.contains("src");
      [...node.children]
        .filter((n) => n.tagName === "LI")
        .forEach((li, i) => {
          // Short list entries stay together; longer entries may continue on the next page.
          font(small ? 8 : 10.5);
          const estimated = (pdf.splitTextToSize(plain(li), width - 2).length + 1) * (small ? 4 : 5.1);
          if (estimated < 80) room(estimated);
          rich(li, { prefix: `${node.tagName === "OL" ? `${i + 1}.` : "-"} `, indent: 2, size: small ? 8 : 10.5, leading: small ? 4 : 5.1, gap: 1.5 });
        });
      return;
    }
    [...node.children].forEach(walk);
  };
  [...article.children].forEach(walk);
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    font(8);
    pdf.text(t("discussion-report-pdf-page", { id: meta.id, i: String(i), n: String(total) }), margin, 286);
  }
  return pdf;
}
