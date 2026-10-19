import { describe, expect, it } from "vitest";
import {
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
  orphansOf,
  warningEntries,
  type AlertEvent,
} from "../src/case-view";

// Synthetic values only.
const flag = (id: string, kind: string, relevant = false) => ({ id, kind, rule: "r", message: { id: "alert-r", args: {} }, fact_ids: [], relevant });
const alerts = { flags: [flag("al-00000001", "missing", true), flag("al-00000002", "contradiction")] };
const ev = (i: string, action: AlertEvent["action"]): AlertEvent => ({ i, action, who: "MUDr. A", when: "x" });

describe("alerts", () => {
  it("takes an alert's state from its latest event; reopen returns it to open", () => {
    expect(alertState([], "al-00000001").state).toBe("open");
    expect(alertState([ev("al-00000001", "ack")], "al-00000001").state).toBe("ack");
    expect(alertState([ev("al-00000001", "resolved"), ev("al-00000001", "reopen")], "al-00000001").state).toBe("open");
    expect(alertState([ev("al-00000002", "resolved")], "al-00000001").state).toBe("open");
  });

  it("keys every alert by its ID, never by its position", () => {
    expect(warningEntries(alerts).map((x) => x.i)).toEqual(["al-00000001", "al-00000002"]);
    const reordered = { flags: [...alerts.flags].reverse() };
    expect(topAlerts(reordered, [ev("al-00000002", "ack")]).archived.map((x) => x.i)).toEqual(["al-00000002"]);
  });

  it("puts question-relevant open alerts first and archives acknowledged and resolved ones", () => {
    const t = topAlerts(alerts, [ev("al-00000002", "ack")]);
    expect(t.top.map((x) => x.i)).toEqual(["al-00000001"]);
    expect(t.archived.map((x) => x.i)).toEqual(["al-00000002"]);
  });

  it("keeps the missing-document signal on until a missing alert is resolved", () => {
    expect(hasMissing(alerts, [])).toBe(true);
    expect(hasMissing(alerts, [ev("al-00000001", "ack")])).toBe(true);
    expect(hasMissing(alerts, [ev("al-00000001", "resolved")])).toBe(false);
    expect(hasMissing(null, [])).toBeNull();
  });

  it("never reports 'nothing missing' for a case that is loading, failed or unprocessed", () => {
    expect(missingState("loading", undefined, [])).toBe("loading");
    expect(missingState("absent", undefined, [])).toBe("loading");
    expect(missingState("error", undefined, [])).toBe("failed");
    expect(missingState("ready", null, [])).toBe("unchecked");
    expect(missingState("ready", alerts, [])).toBe("yes");
    expect(missingState("ready", { flags: [] }, [])).toBe("no");
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
    const items = [{ what: "blood_pressure", text_cs: "155/70 mmHg" }, { what: "pulse", text_cs: "68 /min" }, { what: "ecog", text_cs: "1" }];
    expect(vitalsOf(items)).toMatchObject({ tk: "155/70 mmHg", pulse: "68 /min", tt: null, ecog: { text_cs: "1" } });
    expect(vitalsOf([])).toEqual({ tk: null, pulse: null, tt: null, ecog: null });
  });
});

describe("confirmations and edits that lost their fact", () => {
  const cd = { run: { facts: { "f-0000aaaa": {} }, view_line_ids: ["vl-0000aaaa"] } } as never;
  const e = (text: string) => ({ text, orig: "původně", by: "MUDr. A", when: "1. 10." });
  it("lists edits under positional keys and of facts or lines the run does not have, never field edits", () => {
    const o = orphansOf(cd, { "oc:3": e("a"), "f:f-0000aaaa:t": e("b"), "f:f-0000bbbb": e("c"), "v:vl-0000aaaa": e("d"), "v:vl-0000bbbb": e("e"), brief: e("f"), q: e("g") }, []);
    expect(o.map((x) => (x.kind === "edit" ? [x.key, x.reason] : x))).toEqual([["oc:3", "position"], ["f:f-0000bbbb", "missing"], ["v:vl-0000bbbb", "missing"]]);
  });
  it("lists an edit the view no longer renders although its fact is in the run (a drug now stopped)", () => {
    const shown = { run: { facts: { "f-0000aaaa": {}, "f-0000eeee": {} }, view_line_ids: [], shown_keys: ["f:f-0000aaaa"] } } as never;
    const o = orphansOf(shown, { "f:f-0000aaaa:line": e("a"), "f:f-0000eeee:line": e("b") }, []);
    expect(o.map((x) => (x.kind === "edit" ? [x.key, x.reason] : x))).toEqual([["f:f-0000eeee:line", "not_shown"]]);
  });

  it("lists a fact whose latest confirmation stands but which the run does not have; a withdrawn one is not listed", () => {
    const row = (fact_id: string, action: "confirm" | "withdraw") => ({ fact_id, action, who: "MUDr. A", when: "x" });
    const o = orphansOf(cd, {}, [row("f-0000aaaa", "confirm"), row("f-0000cccc", "confirm"), row("f-0000dddd", "confirm"), row("f-0000dddd", "withdraw")]);
    expect(o).toEqual([{ kind: "confirmation", fact_id: "f-0000cccc", run_id: null, by: "MUDr. A", when: "x" }]);
  });
});
