// The lab rules of the patient view (Laboratoř tab): reading a value as a number, reading a reference range, finding
// a test's point at a draw, and the geometry of the trend chart. Pure and free of interface text. The values a doctor sees are always the
// document's own text; the numbers here only place points on the chart.
import type { LabDraw, LabPoint, LabTest } from "./case-data";

// A document value as a number for the chart: "11,42" is 11.42. Empty or missing is null, never 0.
export const num = (v: unknown): number | null => (v == null || v === "" ? null : parseFloat(String(v).replace(",", ".")));

// "4 ... 10", "3.9 ... 5.6", "0,5 - 1,2" as [low, high]; a range the text does not give as two bounds ("< 5") is null,
// so no band is drawn for it.
export function rangeOf(r: unknown): [number, number] | null {
  const m = String(r || "")
    .replace(/,/g, ".")
    .match(/(-?[\d.]+)\s*(?:\.\.\.|–|-)\s*(-?[\d.]+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// The point of test t taken at draw d. Matched by date and time, so a test missing from one sheet leaves a gap
// instead of borrowing a neighbour's value.
export const pointAt = (t: LabTest, d: LabDraw): LabPoint | undefined =>
  (t.points || []).find((x) => x.date === d.date && (x.time || "") === (d.time || ""));

// The chart's size in SVG units.
export const CHART = { W: 640, H: 220, L: 46, R: 16, T: 14, B: 34 } as const;

export type ChartDot = { x: number; y: number; draw: number; out: boolean; point: LabPoint };
export type ChartGeometry = {
  band: { x: number; y: number; width: number; height: number; labelX: number; labelY: number } | null;
  ticks: { value: number; y: number }[];
  xLabels: { x: number; anchor: "middle" | "end"; draw: number }[];
  path: string;
  dots: ChartDot[];
};

// The trend of one test across the draws, or null when fewer than two draws hold a number: one value is no trend, and
// a chart is never drawn from invented points.
export function chartGeometry(t: LabTest, draws: LabDraw[]): ChartGeometry | null {
  const pts = draws.map((d, i) => [i, num(pointAt(t, d)?.value)] as const).filter((x): x is readonly [number, number] => x[1] != null && !Number.isNaN(x[1]));
  if (pts.length < 2) return null;
  const rg = rangeOf(t.reference_range);
  const vals = pts.map((x) => x[1]).concat(rg || []);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // Padding keeps the extreme points off the edges; a flat series gets a fixed margin so it is not divided by zero.
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad;
  hi += pad;
  const { W, H, L, R, T, B } = CHART;
  const x = (i: number) => L + (W - L - R) * (draws.length === 1 ? 0.5 : i / (draws.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  return {
    band: rg ? { x: L, y: y(rg[1]), width: W - L - R, height: Math.max(0, y(rg[0]) - y(rg[1])), labelX: W - R, labelY: y(rg[1]) - 4 } : null,
    // Three gridlines: the lowest and highest data value (before padding) and the middle; labels rounded to 2 places.
    ticks: [lo + pad, (lo + hi) / 2, hi - pad].map((v) => ({ value: Number(v.toFixed(2)), y: y(v) })),
    // The last date label ends at its point, so it is not cut off at the chart's right edge.
    xLabels: draws.map((_, i) => ({ x: x(i), anchor: i === draws.length - 1 && i ? "end" : "middle", draw: i })),
    path: pts.map((p, k) => `${k ? "L" : "M"}${x(p[0])},${y(p[1])}`).join(" "),
    dots: pts.map((p) => ({ x: x(p[0]), y: y(p[1]), draw: p[0], out: !!rg && (p[1] < rg[0] || p[1] > rg[1]), point: pointAt(t, draws[p[0]]!)! })),
  };
}
