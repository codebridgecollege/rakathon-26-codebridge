// What the AI extraction of one document reads, decided from the pipeline's outputs (issue #20; the same rules as the
// offline harness api/scripts/extract-eval.ts, measured in docs/research/2026-10-19-extraction-eval.md).
import type { QuoteText } from "@codebridge/domain/extraction/types";

export type PageFacts = {
  n: number;
  level: "good" | "fair" | "poor" | "empty";
  /** Tokens the text layer and Tesseract read differently (the page record's verify items). */
  disagreements: number;
  layerChars: number;
};

/**
 * Which pages the vision model reads: a page not judged good, whose two readings disagree on three or more tokens, or
 * with no text layer (a scan). Agreement of two OCR readings does not prove them right (FNO's text layers are OCR too),
 * so "fair" pages are read as well. An empty page is not sent: there is nothing to read.
 */
export const needsVision = (p: PageFacts) => p.level !== "empty" && (p.level !== "good" || p.disagreements >= 3 || p.layerChars < 40);

/**
 * The reading the extraction gets for a page, and the ranges marked "ověřit" in it: the vision reading when the page
 * has one; else the PDF text layer when it has text (no marks of its own: its disagreements with Tesseract index
 * Tesseract's text); else Tesseract's text with the page record's marks.
 */
export function readingFor(p: {
  vision: { text: string; verify: [number, number][]; engine: string } | null;
  layerText: string;
  tessText: string;
  tessVerify: { start: number | null; end: number | null }[];
  tessEngine: string;
}): { text: string; quoteText: QuoteText; engine: string; verify: [number, number][] } {
  if (p.vision) return { text: p.vision.text, quoteText: "vision", engine: p.vision.engine, verify: p.vision.verify };
  if (p.layerText.trim().length > 40) return { text: p.layerText, quoteText: "pdf_text", engine: "pdf text layer", verify: [] };
  const verify = p.tessVerify.filter((v) => v.start != null && v.end != null).map((v) => [v.start!, v.end!] as [number, number]);
  return { text: p.tessText, quoteText: "tesseract", engine: p.tessEngine, verify };
}

/** A vision reading much shorter than Tesseract's (a skipped line or column) is marked as a whole: the comparison marks
 * what it reads differently, not what it leaves out. */
export function shortReading(text: string, tessWords: number): boolean {
  const words = text.split(/\s+/).filter((t) => /[\p{L}\d]/u.test(t)).length;
  return tessWords > 0 && words < 0.85 * tessWords;
}
