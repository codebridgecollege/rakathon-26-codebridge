// The recorder's pure rules: which case takes a word, what one request carries, how audio is cut into parts and how a
// stored transcript becomes the view. Synthetic values only.
import { describe, expect, it } from "vitest";
import {
  committedLines,
  isFinalCode,
  joinPcm,
  lineBackoff,
  nextBatch,
  nextSocketFails,
  newUpload,
  partBackoff,
  partSamples,
  pushAudio,
  recErrMsg,
  reconnectDelay,
  settledLineIds,
  spanPid,
  tailPart,
  toPcm16,
  transcriptView,
  jobPollDelay,
  type QueuedLine,
  type RecTimeline,
} from "../src/recording";

const ses: RecTimeline = { t0: 1_000_000, spans: [{ from: 0, pid: "a" }, { from: 5, pid: null }, { from: 8, pid: "b" }] };

describe("words to cases", () => {
  it("maps a second on the timeline to the case open then", () => {
    expect(spanPid(ses, 0)).toBe("a");
    expect(spanPid(ses, 4.9)).toBe("a");
    expect(spanPid(ses, 5)).toBeNull();
    expect(spanPid(ses, 9)).toBe("b");
    expect(spanPid({ t0: 0, spans: [] }, 3)).toBeNull();
  });

  it("silences audio no case takes and clamps the rest", () => {
    expect([...toPcm16([0.5, 2, -2], false)]).toEqual([0, 0, 0]);
    expect([...toPcm16([0.5, 2, -2], true)]).toEqual([16383, 32767, -32767]);
  });

  it("groups consecutive words of one case and drops words of no case or already covered", () => {
    const words = [
      { type: "word", text: "Ložisko", start: 1 },
      { type: "spacing", text: " ", start: 1.1 },
      { type: "word", text: "vlevo", start: 2 },
      { type: "word", text: "ticho", start: 6 },
      { type: "word", text: "dále", start: 9 },
      { type: "word", text: "konec", start: 9.5 },
    ];
    const made = committedLines(words, 0, ses, () => false);
    expect(made.map((m) => [m.pid, m.line.text.join(" "), m.line.wall])).toEqual([
      ["a", "Ložisko vlevo", 1_001_000],
      ["b", "dále konec", 1_009_000],
    ]);
    // A reconnected socket starts later on the same timeline.
    expect(committedLines([{ type: "word", text: "x", start: 1 }], 7, ses, () => false)[0]!.pid).toBe("b");
    // The speaker pass of case a already holds everything before 1 001 500.
    expect(committedLines(words, 0, ses, (pid, wall) => pid === "a" && wall <= 1_001_500).map((m) => m.line.text)).toEqual([["vlevo"], ["dále", "konec"]]);
  });
});

const q = (pid: string, recId: string, i: number, text = "slovo"): QueuedLine => ({ pid, recId, line: { client_line_id: `${pid}-${i}`, wall_ms: i, text } });

describe("line batches", () => {
  it("takes the case's lines of the oldest recording only", () => {
    const queue = [q("b", "r1", 0), q("a", "r1", 1), q("a", "r2", 2), q("a", "r1", 3)];
    expect(nextBatch(queue, "a").map((x) => x.line.client_line_id)).toEqual(["a-1", "a-3"]);
    expect(nextBatch(queue, "c")).toEqual([]);
  });

  it("stops at 100 lines", () => {
    const queue = Array.from({ length: 130 }, (_, i) => q("a", "r", i, "x"));
    expect(nextBatch(queue, "a")).toHaveLength(100);
  });

  it("stops near 48 000 bytes, but always sends one line", () => {
    const long = "x".repeat(5000);
    const queue = Array.from({ length: 10 }, (_, i) => q("a", "r", i, long));
    // 15 120 bytes each by the estimate: three fit, a fourth would pass 48 000.
    expect(nextBatch(queue, "a")).toHaveLength(3);
    expect(nextBatch([q("a", "r", 0, "x".repeat(20000))], "a")).toHaveLength(1);
  });

  it("settles accepted, duplicate and rejected lines", () => {
    expect([...settledLineIds({ accepted: ["1"], duplicate: ["2"], rejected: [{ client_line_id: "3" }] })].sort()).toEqual(["1", "2", "3"]);
    expect(settledLineIds(null).size).toBe(0);
  });

  it("knows which refusals are final", () => {
    for (const c of ["case_closed", "case_approved", "recording_ended", "audio_too_long", "data_reset"]) expect(isFinalCode(c)).toBe(true);
    for (const c of ["network", "timeout", "error", "rate_limited", null]) expect(isFinalCode(c)).toBe(false);
  });

  it("backs off 1, 2, 4 ... 30 s", () => {
    expect([1, 2, 3, 6, 10].map(lineBackoff)).toEqual([1000, 2000, 4000, 30000, 30000]);
    expect([0, 1, 5, 6].map(partBackoff)).toEqual([1000, 2000, 30000, 30000]);
    expect([1, 2].map(reconnectDelay)).toEqual([2000, 4000]);
  });

  it("counts quick socket closes and resets after a long one", () => {
    expect(nextSocketFails(0, null, 5000)).toBe(1);
    expect(nextSocketFails(1, 1000, 5000)).toBe(2);
    expect(nextSocketFails(2, 1000, 20000)).toBe(0);
  });

  it("polls a job every 2 s, then every 5 s", () => {
    expect(jobPollDelay(0)).toBe(2000);
    expect(jobPollDelay(31000)).toBe(5000);
  });
});

describe("audio parts", () => {
  it("joins chunks up to n samples", () => {
    expect([...joinPcm([Int16Array.of(1, 2), Int16Array.of(3, 4, 5)], 4)]).toEqual([1, 2, 3, 4]);
    expect([...joinPcm([Int16Array.of(1)], 3)]).toEqual([1, 0, 0]);
  });

  it("uses the server's part size, else 5 MiB", () => {
    expect(partSamples(undefined)).toBe(2621440);
    expect(partSamples(8)).toBe(4);
  });

  it("cuts full parts in order, with the visit marks inside each part", () => {
    const u = newUpload("r1");
    // A fresh upload marks its first visit even when the caller did not.
    expect(pushAudio(u, Int16Array.of(1, 2, 3), false, 100, 4)).toEqual([]);
    expect(u.segs).toEqual([{ start_sample: 0, wall_ms: 100 }]);
    const parts = pushAudio(u, Int16Array.of(4, 5, 6, 7, 8, 9), true, 200, 4);
    expect(parts.map((p) => [p.n, [...p.data], p.segs])).toEqual([
      [1, [1, 2, 3, 4], [{ start_sample: 0, wall_ms: 100 }, { start_sample: 3, wall_ms: 200 }]],
      [2, [5, 6, 7, 8], []],
    ]);
    expect(u.n).toBe(3);
    expect(u.base).toBe(8);
    const tail = tailPart(u);
    expect([tail.n, [...tail.data], tail.segs]).toEqual([3, [9], []]);
    // The tail is kept, so a second flush sends the same part again, longer.
    pushAudio(u, Int16Array.of(10), true, 300, 4);
    const tail2 = tailPart(u);
    expect([tail2.n, [...tail2.data], tail2.segs]).toEqual([3, [9, 10], [{ start_sample: 9, wall_ms: 300 }]]);
  });
});

describe("stored transcript", () => {
  it("shows the server's lines, keeps pending local ones and finds running jobs", () => {
    const local = [
      { wall: 5, text: ["čeká"], cid: "c5" },
      { wall: 3, text: ["uloženo"], cid: "c3" },
      { wall: 4, text: ["odmítnuto"], cid: "c4" },
    ];
    const v = transcriptView(
      {
        lines: [{ client_line_id: "c3", wall_ms: 3, speaker: null, text: "uloženo" }, { wall_ms: 1, speaker: 0, text: "Mluvčí" }],
        passes: [
          { id: "p1", job_id: "j1", cutoff_wall_ms: 9, state: "running", job_state: "running", job_phase: "summary", audio_kept: true },
          { id: "p0", job_id: "j0", cutoff_wall_ms: 2, state: "error", job_state: "error", error_code: null, job_error: "eleven_429" },
        ],
        summaries: [{ state: "done", text: "starší" }],
      },
      local,
      ["c5", "c3"],
    );
    expect(v.lines.map((l) => l.text.join(" "))).toEqual(["Mluvčí", "uloženo", "čeká"]);
    expect(v.lines[0]!.spk).toBe(0);
    expect(v.passes.map((p) => [p.jobId, p.state, p.err, p.audioKept])).toEqual([
      ["j1", "running", null, true],
      ["j0", "error", "eleven_429", false],
    ]);
    // A summary pass still running wins over the older stored summary.
    expect(v.summary).toEqual({ state: "running" });
    expect(v.polls).toEqual(["j1"]);
  });

  it("takes the latest summary with its basis", () => {
    const v = transcriptView({ summaries: [{ state: "done", text: "a" }, { state: "done", text: "b", basis: "live_only" }] }, [], []);
    expect(v.summary).toEqual({ state: "done", text: "b", basis: "live_only", err: null });
    expect(transcriptView({}, [], []).summary).toBeNull();
  });

  it("words known error codes and shows others as they are", () => {
    expect(recErrMsg("eleven_429")).toEqual({ id: "discussion-rec-err-eleven-429" });
    expect(recErrMsg("strange")).toEqual({ text: "strange" });
    expect(recErrMsg(null)).toEqual({ id: "discussion-rec-err-unknown" });
  });
});
