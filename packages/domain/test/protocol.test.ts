import { describe, expect, it } from "vitest";
import { emptyProtocol, newDraft, patchProtocol, validateSteps, type Protocol } from "../src/protocol";

const staff = new Set(["Bc. Marková", "MUDr. Novák"]);
const draft = (o: Partial<Protocol> = {}): Protocol => ({ ...emptyProtocol(), version: 3, conclusion: "Text", ...o });

describe("protocol draft", () => {
  it("patches with the version the caller saw", () => {
    const p = patchProtocol(draft(), "ready", { concl: "Nový text", notes: "pozn." }, 3, staff);
    expect(p).toMatchObject({ conclusion: "Nový text", notes: "pozn.", version: 4 });
  });

  it("refuses a stale version with the stored draft as current", () => {
    expect(() => patchProtocol(draft({ updated_by_name: "MUDr. Novák" }), "ready", { concl: "x" }, 2, staff)).toThrow(
      expect.objectContaining({ code: "protocol_conflict", message_cs: "Koncept mezitím upravil(a) MUDr. Novák.", extra: { current: expect.objectContaining({ version: 3 }) } }),
    );
  });

  it("refuses edits to an approved protocol and on a closed case", () => {
    expect(() => patchProtocol(draft({ state: "approved" }), "done", { concl: "x" }, 3, staff)).toThrow(expect.objectContaining({ code: "protocol_locked" }));
    expect(() => patchProtocol(draft(), "closed", { concl: "x" }, 3, staff)).toThrow(expect.objectContaining({ code: "case_closed" }));
  });

  it("validates steps: length, assignee on the staff list, ISO date", () => {
    expect(validateSteps([{ text: "MR", who: "Bc. Marková", due: "2026-10-30" }], staff)).toHaveLength(1);
    expect(() => validateSteps([{ text: "x".repeat(501), who: "", due: "" }], staff)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() => validateSteps([{ text: "MR", who: "Neznámý", due: "" }], staff)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() => validateSteps([{ text: "MR", who: "", due: "30.10.2026" }], staff)).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("starts a new draft only after approval, never over an unapproved draft (the mock's wipe bug)", () => {
    expect(() => newDraft(draft({ state: "draft" }), "done", "dec-1", "dec-1")).toThrow(expect.objectContaining({ code: "not_approved_yet" }));
    expect(() => newDraft(draft({ state: "approved" }), "closed", "dec-1", "dec-1")).toThrow(expect.objectContaining({ code: "case_closed" }));
    expect(() => newDraft(draft({ state: "approved" }), "done", "dec-2", "dec-1")).toThrow(expect.objectContaining({ code: "decision_changed" }));
    expect(() => newDraft(draft({ state: "approved" }), "done", "dec-1", "dec-1")).not.toThrow();
  });
});
