/* Local, text-based A4 export. The captured HTML is the same draft or frozen snapshot as the preview.
   No patient text is sent to a server and no print popup or canvas screenshot is used. */
function reportPdf(html, meta) {
  const Pdf = window.jspdf?.jsPDF;
  if (!Pdf || !window.MDT_PDF_FONTS) throw new Error("PDF export není dostupný. Obnovte stránku a zkuste to znovu.");
  const pdf = new Pdf({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  for (const [style, data] of Object.entries(window.MDT_PDF_FONTS)) {
    const name = `MDT-${style}.ttf`;
    pdf.addFileToVFS(name, data); pdf.addFont(name, "MDT", style);
  }
  pdf.setProperties({ title: `GLIDE MDT - Záznam z MDT - ${meta.id}`, subject: "Záznam z multidisciplinárního týmu", creator: "GLIDE MDT" });
  const margin = 18, width = 174, bottom = 276;
  let y = 22;
  const font = (size = 10.5, bold = false) => { pdf.setFont("MDT", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(0); };
  const page = () => { pdf.addPage(); y = 19; font(8); pdf.text(`GLIDE MDT | Záznam z MDT - ${meta.id}`, margin, 12); };
  const room = h => { if (y + h > bottom) page(); };
  const text = (value, options = {}) => {
    const { size = 10.5, bold = false, indent = 0, gap = 2, leading = 5.1 } = options;
    font(size, bold);
    const lines = pdf.splitTextToSize(String(value || "").replace(/\u00a0/g, " "), width - indent);
    for (const line of lines) { room(leading); font(size, bold); pdf.text(line, margin + indent, y); y += leading; }
    y += gap;
  };
  const plain = node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    return copy.textContent.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  };
  // Keep bold diagnosis/medication terms in the actual PDF, with normal-weight qualifiers.
  const rich = (node, { size = 10.5, leading = 5.1, gap = 2, indent = 0, prefix = "" } = {}) => {
    const tokens = [], collect = (n, bold = false) => {
      if (n.nodeType === 3) n.textContent.replace(/\s+/g, " ").split(/( +)/).filter(Boolean).forEach(t => tokens.push({ t, bold }));
      else if (n.nodeName === "BR") tokens.push({ t: "\n", bold });
      else [...n.childNodes].forEach(c => collect(c, bold || n.nodeName === "B" || n.nodeName === "STRONG"));
    };
    if (prefix) tokens.push({ t: prefix, bold: false });
    collect(node);
    let line = [], used = 0;
    const flush = () => {
      if (!line.length) return;
      room(leading); let x = margin + indent;
      for (const run of line) { font(size, run.bold); pdf.text(run.t, x, y); x += run.w; }
      y += leading; line = []; used = 0;
    };
    const add = (t, bold) => {
      font(size, bold); const w = pdf.getTextWidth(t);
      const last = line.at(-1);
      if (last?.bold === bold) { last.t += t; last.w += w; } else line.push({ t, bold, w });
      used += w;
    };
    for (const { t, bold } of tokens) {
      if (t === "\n") { flush(); continue; }
      if (!used && !t.trim()) continue;
      font(size, bold); const w = pdf.getTextWidth(t), max = width - indent;
      if (used + w > max) { flush(); if (!t.trim()) continue; }
      if (w > max) {
        for (const char of t) { font(size, bold); if (used + pdf.getTextWidth(char) > max) flush(); add(char, bold); }
      } else add(t, bold);
    }
    flush(); y += gap;
  };
  const template = document.createElement("template"); template.innerHTML = html;
  const article = template.content.querySelector("article");
  if (!article) throw new Error("Chybí obsah reportu.");
  const walk = node => {
    if (node.classList.contains("signatures")) {
      room(33); y += 12;
      font(9); pdf.setDrawColor(0); pdf.setLineWidth(.2);
      for (const offset of [0, 92]) {
        pdf.line(margin + offset, y, margin + offset + 76, y);
        pdf.text("Jméno a podpis", margin + offset, y + 5);
      }
      y += 14; return;
    }
    if (node.classList.contains("hdr")) {
      const logo = node.querySelector(".report-brand img");
      if (logo) {
        pdf.addImage(logo.getAttribute("src"), "PNG", margin, y - 5.8, 28, 28 * 216 / 880);
        font(18, true); pdf.text("MDT", margin + 31, y); y += 12;
      }
      text("Záznam z MDT", { size: 17, bold: true, gap: 4, leading: 7 });
      text(plain(node.querySelector(".report-meta") || node).replace(/^Záznam z MDT\s*/, ""), { size: 9, gap: 4, leading: 4.5 });
      return;
    }
    if (node.tagName === "H4") {
      const next = node.nextElementSibling, first = next?.matches("ul, ol") ? next.firstElementChild : null;
      let reserve = 21;
      if (first) {
        const small = next.classList.contains("src"); font(small ? 8 : 10.5);
        const height = (pdf.splitTextToSize(plain(first), width - 2).length + 1) * (small ? 4 : 5.1);
        if (height < 80) reserve = 12 + height;
      }
      room(reserve); y += 3; text(plain(node), { bold: true, gap: 1.5 }); return;
    }
    if (node.tagName === "P") {
      const small = node.classList.contains("src");
      rich(node, small ? { size: 8, leading: 4, gap: 2 } : {}); return;
    }
    if (node.tagName === "UL" || node.tagName === "OL") {
      const small = node.classList.contains("src");
      [...node.children].filter(n => n.tagName === "LI").forEach((li, i) => {
        // Keep short list entries together; longer entries may continue on the next page.
        font(small ? 8 : 10.5);
        const estimated = (pdf.splitTextToSize(plain(li), width - 2).length + 1) * (small ? 4 : 5.1);
        if (estimated < 80) room(estimated);
        rich(li, { prefix: `${node.tagName === "OL" ? `${i + 1}.` : "-"} `, indent: 2, size: small ? 8 : 10.5, leading: small ? 4 : 5.1, gap: 1.5 });
      }); return;
    }
    [...node.children].forEach(walk);
  };
  [...article.children].forEach(walk);
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i); font(8); pdf.text(`${meta.id} | Strana ${i} / ${total}`, margin, 286);
  }
  return pdf;
}
async function downloadReport() {
  const p = P(S.pid), pr = ensureProto(p);
  // Capture everything before yielding; patient navigation or edits cannot change this download.
  // A server-stored snapshot carries the patient line as an empty placeholder; fillIdent puts the current identity back.
  const html = pr.state === "approved" && pr.reportSnap ? fillIdent(pr.reportSnap, p) : reportHtml(p, pr, presentList(attDay(p)));
  const meta = { pid: p.file, id: p.id, date: p.slot?.day || "bez-data", draft: pr.state !== "approved" };
  const button = document.querySelector('[data-act="download"]'), error = document.getElementById("report-error");
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = "Připravuji PDF…"; }
  if (error) { error.hidden = true; error.textContent = ""; }
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const pdf = reportPdf(html, meta), bytes = pdf.output("arraybuffer");
    const blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `GLIDE-MDT-${meta.id}-${meta.date}${meta.draft ? "-koncept" : ""}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    logAccess(meta.pid, "vytvořil(a) PDF report"); toast("PDF připraveno ke stažení");
  } catch (err) {
    if (error?.isConnected) { error.textContent = `PDF se nepodařilo vytvořit: ${err.message}`; error.hidden = false; }
    toast("PDF se nepodařilo vytvořit. Zkuste to znovu.");
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = "Stáhnout PDF"; }
  }
}
