// Sizes and clock times as the old page shows them (fmtSize, upWhen, hhmm), formatted with Intl in the interface
// language instead of a hand-written decimal comma (I18N.md, "Hand-written formats").
import { msgId, type Msg } from "./msg";

const MB = 1024 * 1024;

// "12 kB" below a megabyte (never "0 kB"), "1,5 MB" above, one decimal as before.
export function sizeMsg(bytes: number, locale = "cs"): Msg {
  if (bytes < MB) return msgId("upload-size-kb", { size: String(Math.max(1, Math.round(bytes / 1024))) });
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  return msgId("upload-size-mb", { size: nf.format(bytes / MB) });
}

// "09:05" in the browser's local time, as the old page showed upload and expiry times.
export function clock(ms: number, locale = "cs"): string {
  try {
    return new Date(ms).toLocaleTimeString(locale === "cs" ? "cs-CZ" : locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
