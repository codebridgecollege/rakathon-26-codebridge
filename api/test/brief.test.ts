// The brief and drafted question step (src/domain/brief.ts) with the model mocked: what is sent (verified facts under
// short references, nothing else), and what of the answer is kept (only sentences backed by their facts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { validateRun } from "@codebridge/domain/extraction/validate";
import { FAKE_NAME, loadFixture, RUN_A2 } from "./data";
import { mockFetch, testEnv } from "./helpers";
import { composeBrief, type BriefRequest } from "../src/domain/brief";
import { loadCaseIdentity } from "../src/store/identity";
import { actorFor } from "../src/store/audio";
import { queueQuestionDraft } from "../src/store/runs";
import { Tx } from "../src/store/write";

beforeEach(() => loadFixture());
afterEach(() => vi.restoreAllMocks());

const reply = (content: unknown) => () => Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });

async function request(over: Partial<BriefRequest> = {}): Promise<BriefRequest> {
  return {
    org: "demo-a",
    caseId: "NO-A",
    actor: await actorFor(env.DB, "demo-a", "d2p1", "demo"),
    identity: await loadCaseIdentity(env.DB, "demo-a", "NO-A"),
    draftQuestion: true,
    ...over,
  };
}

const run = () => structuredClone(RUN_A2);

describe("composeBrief", () => {
  it("sends only verified facts under short references, never fact IDs, unverified values or the patient", async () => {
    const { calls } = mockFetch(reply({ sentences: [], question: null }));
    await composeBrief(testEnv(), await request(), run());
    const body = JSON.parse(await calls[0]!.text());
    const sent = body.messages[1].content.map((c: { text: string }) => c.text).join("\n");
    expect(body.response_format.json_schema.name).toBe("brief");
    expect(sent).toContain("Navrhnout otázku pro MDT: ano");
    expect(sent).toMatch(/\[F1\] /);
    // No fact ID leaves; the stage marked "verify" (OCR "MO") and the lab values are not offered.
    expect(sent).not.toMatch(/f-[0-9a-f]{6}/);
    expect(sent).not.toContain("pT2a");
    expect(sent).not.toContain("Kreatinin");
    expect(sent).toContain("ZÁPOR");
    expect(sent).not.toContain(FAKE_NAME);
    expect(sent).not.toContain("645312");
  });

  it("keeps backed sentences, drops invented dates, unknown references and placeholders, and keeps the run valid", async () => {
    mockFetch(
      reply({
        sentences: [
          { text: "ECOG 1.", facts: ["F2"] },
          { text: "Bez klinických známek mozkových metastáz.", facts: ["F3"] },
          { text: "ECOG 1 od 14.9.2026.", facts: ["F2"] },
          { text: "ECOG 1.", facts: ["F9"] },
          { text: "[PACIENT] má ECOG 1.", facts: ["F2"] },
          { text: "Léčba sunitinibem.", facts: ["F2"] },
        ],
        question: { text: "Jaký postup doporučuje neurochirurgický seminář?", question_kind: "document_purpose", basis: [{ role: "purpose", facts: ["F1"] }] },
      }),
    );
    const out = await composeBrief(testEnv(), await request(), run());
    expect(out.run.brief!.sentences.map((s) => s.text)).toEqual(["ECOG 1.", "Bez klinických známek mozkových metastáz."]);
    expect(out.run.brief!.sentences[0]!.facts).toEqual(["f-5a0b11"]);
    expect(out.dropped.map(({ facts: _f, ...x }) => x)).toEqual([
      { sentence: 2, reasons: ["date"] },
      { sentence: 3, reasons: ["unknown_fact"] },
      { sentence: 4, reasons: ["placeholder"] },
      { sentence: 5, reasons: ["drug"] },
    ]);
    expect(out.run.question_draft).toEqual({ text: "Jaký postup doporučuje neurochirurgický seminář?", question_kind: "document_purpose", basis: [{ role: "purpose", facts: ["f-3c90de"] }] });
    expect(out.run.brief!.made_by).toEqual({ model: "test-model", prompt: "compose-brief-cs@2" });
    expect(out.run.run.stages.at(-1)).toMatchObject({ name: "compose_brief", prompt: "compose-brief-cs@2" });
    expect(validateRun(out.run).issues).toEqual([]);
    // The stage read with "MO" is left out as unverified, and an alert says the brief leaves it out.
    expect(out.run.alerts.find((a) => a.rule === "brief_unverified_withheld")).toMatchObject({ kind: "unclear", facts: ["f-0b19e4"], message: { id: "alert-brief-unverified-withheld", args: { count: 1 } } });
  });

  it("drafts no question when the referral states one, and drops a question that is not one", async () => {
    mockFetch(reply({ sentences: [{ text: "ECOG 1.", facts: ["F2"] }], question: { text: "Seminář rozhodne.", question_kind: "document_purpose", basis: [{ role: "purpose", facts: ["F1"] }] } }));
    const kept = await composeBrief(testEnv(), await request({ draftQuestion: false }), run());
    expect(kept.run.question_draft).toEqual(RUN_A2.question_draft);
    const dropped = await composeBrief(testEnv(), await request(), run());
    expect(dropped.run.question_draft).toBeNull();
    expect(dropped.dropped.map(({ facts: _f, ...x }) => x)).toEqual([{ sentence: "question", reasons: ["not_a_question"] }]);
  });

  it("queues the drafted question onto a case without an explicit question, never over a confirmed draft", async () => {
    const r = { ...run(), question_draft: { text: "Jaký postup doporučuje seminář?", question_kind: "document_purpose", basis: [{ role: "purpose" as const, facts: ["f-3c90de"] }] } };
    const actor = await actorFor(env.DB, "demo-a", "d2p1", "demo");
    const draftOf = async () => env.DB.prepare("SELECT question_draft, question_kind, question_basis_json FROM cases WHERE org_id = 'demo-a' AND id = 'NO-A'").first<Record<string, string | null>>();
    const queue = async () => {
      const t = new Tx(env.DB, actor, { requestId: null, epoch: null });
      queueQuestionDraft(t, r, (doc) => `${doc}.pdf`);
      await t.commit();
    };
    // NO-A has an explicit question: the draft is not written.
    await queue();
    expect((await draftOf())!.question_draft).toBeNull();
    await env.DB.prepare("UPDATE cases SET question_explicit = 0, question_text = NULL WHERE org_id = 'demo-a' AND id = 'NO-A'").run();
    await queue();
    const row = (await draftOf())!;
    expect(row.question_draft).toBe("Jaký postup doporučuje seminář?");
    expect(JSON.parse(row.question_basis_json!)).toEqual([{ role: "purpose", quote: expect.any(String), source: { file: "A_pacient.pdf", page: expect.any(Number) } }]);
    // A doctor confirms it; a later run's other draft does not replace the confirmed text.
    await env.DB.prepare("INSERT INTO question_confirmations (org_id, case_id, text, by_user_id, by_name, at) VALUES ('demo-a','NO-A',?1,'d2p1','MUDr. Test','2026-10-19T10:00:00.000Z')").bind(row.question_draft).run();
    r.question_draft = { ...r.question_draft, text: "Jiná otázka?" };
    await queue();
    expect((await draftOf())!.question_draft).toBe("Jaký postup doporučuje seminář?");
  });

  it("leaves a question a doctor edited alone, and clears a stale unconfirmed draft when the run has none", async () => {
    const actor = await actorFor(env.DB, "demo-a", "d2p1", "demo");
    await env.DB.prepare("UPDATE cases SET question_explicit = 0, question_text = NULL, question_draft = 'Stará otázka?' WHERE org_id = 'demo-a' AND id = 'NO-A'").run();
    const queue = async (r: typeof RUN_A2) => {
      const t = new Tx(env.DB, actor, { requestId: null, epoch: null });
      queueQuestionDraft(t, r, (doc) => `${doc}.pdf`);
      await t.commit();
    };
    const draftNow = async () => (await env.DB.prepare("SELECT question_draft FROM cases WHERE org_id = 'demo-a' AND id = 'NO-A'").first<{ question_draft: string | null }>())!.question_draft;
    await queue({ ...run(), question_draft: null });
    expect(await draftNow()).toBeNull();
    await env.DB.prepare("UPDATE cases SET question_draft = 'Stará otázka?' WHERE org_id = 'demo-a' AND id = 'NO-A'").run();
    await env.DB.prepare("INSERT INTO fact_edits (org_id, case_id, key, text, orig, by_user_id, by_name) VALUES ('demo-a','NO-A','q','Upravená otázka?','Stará otázka?','d2p1','MUDr. Test')").run();
    await queue({ ...run(), question_draft: { text: "Nová otázka?", question_kind: "latest_finding", basis: [] } });
    expect(await draftNow()).toBe("Stará otázka?");
  });

  it("leaves the brief empty, never guessed, when no model is configured", async () => {
    const { calls } = mockFetch(reply({ sentences: [], question: null }));
    const out = await composeBrief(testEnv({ AZURE_OPENAI_KEY: "" }), await request(), run());
    expect(calls).toHaveLength(0);
    expect(out).toMatchObject({ skipped: "model_off", run: { brief: null, question_draft: null } });
    expect(out.run.alerts.some((a) => a.rule === "brief_unverified_withheld")).toBe(false);
  });
});
