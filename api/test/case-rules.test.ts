// The case rules (packages/domain/src/extraction/rules.ts) and the brief's withheld alert as the Worker ships them:
// every alert they can raise has its Fluent message in each interface language, so no alert ever reaches the doctor as
// a bare message ID.
import { describe, expect, it } from "vitest";
import { BRIEF_WITHHELD_RULE } from "@codebridge/domain/extraction/brief";
import { CASE_RULES, messageId } from "@codebridge/domain/extraction/rules";
import cs from "../../i18n/cs/alerts.ftl";
import sk from "../../i18n/sk/alerts.ftl";
import en from "../../i18n/en/alerts.ftl";

describe("case rule messages", () => {
  it("has a message for every rule in cs, sk and en", () => {
    for (const [locale, ftl] of Object.entries({ cs, sk, en })) {
      for (const rule of [...CASE_RULES, BRIEF_WITHHELD_RULE]) expect(ftl, `${locale} ${rule}`).toMatch(new RegExp(`^${messageId(rule)} =`, "m"));
    }
  });
});
