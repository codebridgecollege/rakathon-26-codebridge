import { describe, expect, it } from "vitest";
import { chartGeometry, num, pointAt, rangeOf } from "../src/labs";
import type { LabDraw, LabTest } from "../src/case-data";

const src = (page: number) => ({ file: "S99_pacient.pdf", page, quote: "q" });
const draws: LabDraw[] = [
  { date: "2026-01-08", time: "07:40", source: src(7) },
  { date: "2026-05-12", time: "07:35", source: src(5) },
  { date: "2026-08-04", time: "07:45", source: src(4) },
];
const test = (values: (string | null)[], extra: Partial<LabTest> = {}): LabTest => ({
  code: "B_X",
  name_cs: "Test",
  unit: "10^9/l",
  reference_range: "4 ... 10",
  points: values.map((v, i) => ({ value: v, date: draws[i]!.date, time: draws[i]!.time, source: src(9 - i) })),
  ...extra,
});

describe("num", () => {
  it("reads a decimal comma and keeps missing values missing", () => {
    expect(num("11,42")).toBe(11.42);
    expect(num("3.9")).toBe(3.9);
    expect(num("")).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});

describe("rangeOf", () => {
  it("reads the ranges the sheets print", () => {
    expect(rangeOf("4 ... 10")).toEqual([4, 10]);
    expect(rangeOf("3.9 ... 5.6")).toEqual([3.9, 5.6]);
    expect(rangeOf("0,5 - 1,2")).toEqual([0.5, 1.2]);
    expect(rangeOf("59 – 104")).toEqual([59, 104]);
  });
  it("gives no range for a one-sided limit or nothing", () => {
    expect(rangeOf("< 5")).toBeNull();
    expect(rangeOf("")).toBeNull();
    expect(rangeOf(undefined)).toBeNull();
  });
});

describe("pointAt", () => {
  it("matches a draw by date and time, so a missing value leaves a gap", () => {
    const t = test(["5", "6", "7"]);
    t.points = t.points!.filter((p) => p.date !== "2026-05-12");
    expect(pointAt(t, draws[0]!)?.value).toBe("5");
    expect(pointAt(t, draws[1]!)).toBeUndefined();
    // Same day, other time: a different draw.
    expect(pointAt(t, { ...draws[0]!, time: "12:00" })).toBeUndefined();
  });
});

describe("chartGeometry", () => {
  it("draws nothing from fewer than two numbers", () => {
    expect(chartGeometry(test(["5", null, ""]), draws)).toBeNull();
    expect(chartGeometry(test(["5"]), draws.slice(0, 1))).toBeNull();
  });

  it("places one dot per value at its own draw and skips the gap", () => {
    const g = chartGeometry(test(["11,42", null, "7,95"]), draws)!;
    expect(g.dots.map((d) => d.draw)).toEqual([0, 2]);
    expect(g.dots.map((d) => d.point.value)).toEqual(["11,42", "7,95"]);
    // First draw at the left edge, last at the right edge.
    expect(g.dots[0]!.x).toBe(46);
    expect(g.dots[1]!.x).toBe(640 - 16);
    expect(g.path.startsWith("M46,")).toBe(true);
    expect(g.path.split(" ")).toHaveLength(2);
  });

  it("marks dots outside the reference range and draws its band", () => {
    const g = chartGeometry(test(["11,42", "2,86", "7,95"]), draws)!;
    expect(g.dots.map((d) => d.out)).toEqual([true, true, false]);
    expect(g.band).not.toBeNull();
    // The band spans 4 to 10: its top is above (smaller y than) its bottom.
    expect(g.band!.height).toBeGreaterThan(0);
  });

  it("draws no band and marks nothing when the range is not two bounds", () => {
    const g = chartGeometry(test(["1", "2", "3"], { reference_range: "< 5" }), draws)!;
    expect(g.band).toBeNull();
    expect(g.dots.every((d) => !d.out)).toBe(true);
    expect(g.ticks.map((t) => t.value)).toEqual([1, 2, 3]);
  });

  it("ends the last date label at its point", () => {
    const g = chartGeometry(test(["1", "2", "3"]), draws)!;
    expect(g.xLabels.map((l) => l.anchor)).toEqual(["middle", "middle", "end"]);
  });

  it("handles a flat series without dividing by zero", () => {
    const g = chartGeometry(test(["5", "5", "5"], { reference_range: "" }), draws)!;
    expect(g.dots.every((d) => Number.isFinite(d.y))).toBe(true);
  });
});
