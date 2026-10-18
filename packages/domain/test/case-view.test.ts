import { describe, expect, it } from "vitest";
import {
  alertKeyIn,
  alertNote,
  alertState,
  categoryOf,
  hasMissing,
  linkProse,
  marksOf,
  missingState,
  qState,
  refList,
  stripMarkers,
  timelineSorted,
  topAlerts,
  vitalsOf,
  warningEntries,
  type AlertEvent,
} from "../src/case-view";

// Synthetic values only.
const alerts = {
  flags: [
    { kind: "missing", text_cs: "Chybí MR.", relevant: true },
    { kind: "contradiction", text_cs: "Rozpor v datu." },
  ],
  gaps: [{ kind: "unclear", text_cs: "M0 ověřit.", refs: [{ file: "a.pdf", page: 1, quote: "MO" }] }],
};
const ev = (i: number | string, action: AlertEvent["action"]): AlertEvent => ({ i, action, who: "MUDr. A", when: "x" });

describe("alerts", () => {
  it("takes an alert's state from its latest event; reopen returns it to open", () => {
    expect(alertState([], 0).state).toBe("open");
    expect(alertState([ev(0, "ack")], 0).state).toBe("ack");
    expect(alertState([ev(0, "resolved"), ev(0, "reopen")], 0).state).toBe("open");
    expect(alertState([ev(1, "resolved")], 0).state).toBe("open");
  });

  it("reads flag keys as numbers and gap keys as text", () => {
    expect(alertKeyIn("3")).toBe(3);
    expect(alertKeyIn("gap:1")).toBe("gap:1");
  });

  it("lists data gaps after flags, never relevant to the question, with their own sources", () => {
    const e = warningEntries(alerts);
    expect(e.map((x) => x.i)).toEqual([0, 1, "gap:0"]);
    expect(e[2]).toMatchObject({ relevant: false, based_on: [{ page: 1, quote: "MO" }] });
  });

  it("puts question-relevant open alerts first and archives acknowledged and resolved ones", () => {
    const t = topAlerts(alerts, [ev(1, "ack")]);
    expect(t.top.map((x) => x.i)).toEqual([0]);
    expect(t.archived.map((x) => x.i)).toEqual([1]);
  });

  it("keeps the missing-document signal on until a missing alert is resolved; data gaps always count", () => {
    expect(hasMissing(alerts, [])).toBe(true);
    expect(hasMissing(alerts, [ev(0, "ack")])).toBe(true);
    expect(hasMissing(alerts, [ev(0, "resolved")])).toBe(false);
    expect(hasMissing({ flags: [], gaps: [{ kind: "missing", text_cs: "x" }] }, [])).toBe(true);
    expect(hasMissing(null, [])).toBeNull();
  });

  it("never reports 'nothing missing' for a case that is loading, failed or unprocessed", () => {
    expect(missingState("loading", undefined, [])).toBe("loading");
    expect(missingState("absent", undefined, [])).toBe("loading");
    expect(missingState("error", undefined, [])).toBe("failed");
    expect(missingState("ready", null, [])).toBe("unchecked");
    expect(missingState("ready", alerts, [])).toBe("yes");
    expect(missingState("ready", { flags: [], gaps: [] }, [])).toBe("no");
  });

  it("drops the note's own observation prefix, which the list header already says", () => {
    expect(alertNote("Pozorování asistenta. formulář chybí.")).toBe("Formulář chybí.");
    expect(alertNote(undefined)).toBe("");
  });
});

describe("the MDT question", () => {
  const row = { explicit: false, question: null, draft: "Návrh?", qkind: "document_purpose", basis: [] };

  it("shows the explicit question as written", () => {
    expect(qState({ ...row, explicit: true, question: "Otázka?" }, undefined, null)).toEqual({ mode: "explicit", text: "Otázka?" });
  });

  it("keeps a draft a draft until a doctor confirms that very text", () => {
    expect(qState(row, undefined, null).mode).toBe("draft");
    expect(qState(row, undefined, { text: "Návrh?", by: "MUDr. A", when: "t" }).mode).toBe("confirmed");
    // A re-extracted draft differs from the confirmed text, so it is a draft again.
    expect(qState(row, undefined, { text: "Starý návrh?", by: "MUDr. A", when: "t" }).mode).toBe("draft");
  });

  it("puts a doctor's edit before everything, and says when nothing is stated", () => {
    expect(qState(row, { text: "Upraveno?", by: "MUDr. A", when: "t" }, null)).toMatchObject({ mode: "edited", text: "Upraveno?" });
    expect(qState({ ...row, draft: null }, undefined, null).mode).toBe("none");
  });

  it("labels an inferred draft as the assistant's, not the document's purpose", () => {
    expect(qState({ ...row, qkind: "assistant_inference" }, undefined, null)).toMatchObject({ kind: "assistant_inference" });
    expect(qState({ ...row, qkind: null }, undefined, null)).toMatchObject({ kind: "assistant_inference" });
  });
});

describe("certainty marks", () => {
  it("marks an OCR doubt unless both readings agree", () => {
    expect(marksOf({ ocr_note_cs: "MO" })).toEqual([{ kind: "ocr", note: "MO" }]);
    expect(marksOf({ ocr_note_cs: "MO", ocr_check: { mark: false } })).toEqual([]);
    expect(marksOf({ certainty: "unclear_ocr" })).toEqual([{ kind: "ocr", note: null }]);
  });

  it("marks inferences, plans and contradictions, and keeps other notes reachable", () => {
    expect(marksOf({ certainty: "inferred" })).toEqual([{ kind: "inferred" }]);
    expect(marksOf({ change_cs: "plánováno od 1/2026", note_cs: "n" })).toEqual([{ kind: "planned", note: "n" }, { kind: "note", note: "n" }]);
    expect(marksOf({ certainty: "conflicting", note_cs: "jiné datum" })).toEqual([{ kind: "conflict", note: "jiné datum" }]);
  });
});

describe("timeline", () => {
  it("sorts dated events first and keeps each event's position for its source", () => {
    const s = timelineSorted([
      { title_cs: "b", text_cs: "", date_sort: "2023-01" },
      { title_cs: "u", text_cs: "" },
      { title_cs: "a", text_cs: "", date_sort: "2022-04", kind: "histology" },
    ]);
    expect(s.map((e) => [e.title_cs, e.i])).toEqual([["a", 2], ["b", 0], ["u", 1]]);
    expect(s[0]!.category).toBe("pathology");
  });

  it("files unknown kinds under clinical, never guessing from prose", () => {
    expect(categoryOf({ kind: "visit" })).toBe("clinical");
    expect(categoryOf({ kind: "something" })).toBe("clinical");
    expect(categoryOf({ category: "imaging", kind: "visit" })).toBe("imaging");
  });
});

describe("prose and sources", () => {
  it("links each clause before a marker to its source and hides the markers", () => {
    const r1 = { file: "a.pdf", page: 1, quote: "x" };
    const r2 = { file: "a.pdf", page: 2, quote: "y" };
    const { parts, used } = linkProse("První věta [1]. Druhá věta [2]; konec.", [r1, r2]);
    expect(parts).toEqual([{ text: "První věta", ref: r1 }, { text: ". " }, { text: "Druhá věta", ref: r2 }, { text: "; konec." }]);
    expect(used).toEqual([r1, r2]);
    expect(stripMarkers("Věta [1]. Další [12].")).toBe("Věta. Další.");
  });

  it("numbers sources in order of first use, one number per file, page and quote", () => {
    const r = refList();
    expect(r.add({ file: "a", page: 1, quote: "q" })).toBe(1);
    expect(r.add({ file: "a", page: 2, quote: "q" })).toBe(2);
    expect(r.add({ file: "a", page: 1, quote: "q" })).toBe(1);
    expect(r.add(undefined)).toBe(0);
    expect(r.list).toHaveLength(2);
  });

  it("reads vital signs as written and leaves an unstated one empty", () => {
    expect(vitalsOf("krevní tlak 155/70 mmHg, pulz 68/min")).toEqual({ tk: "155/70 mmHg", pulse: "68/min", tt: null });
    expect(vitalsOf(undefined)).toEqual({ tk: null, pulse: null, tt: null });
  });
});
