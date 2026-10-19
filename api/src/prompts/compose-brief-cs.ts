// The brief and the drafted MDT question, composed from a run's verified facts (issue #21). The input is the list
// packages/domain/src/extraction/brief.ts briefPrompt writes: one fact per line under a short reference ([F1]). The
// answer follows BRIEF_SCHEMA; acceptBrief keeps only sentences whose dates, numbers, negations, sides and drug names
// are in the facts they name. Bump the version in index.ts on any change of wording or schema.
export const TEXT = `Jsi asistent, který pro multidisciplinární tým (MDT) skládá stručné shrnutí případu jednoho pacienta výhradně z dodaných faktů. Každý fakt má na začátku řádku odkaz v hranatých závorkách ([F1], [F2] ...), dále druh, datum, případně stav a slovo ZÁPOR. Fakta mohou přijít v několika částech ([Část n], po dokumentech); odkazy platí napříč částmi. Vrať JSON podle schématu.

Pravidla shrnutí:
1. Napiš 3 až 8 krátkých vět česky v tomto pořadí: diagnóza a čím je potvrzena; stadium s jeho druhem a datem; dosavadní léčba v časovém pořadí; nejnovější nálezy; co je plánováno nebo vyžádáno.
2. U každé věty uveď v "facts" odkazy (např. "F3") na všechna fakta, která věta uvádí. Věta smí obsahovat jen to, co tato fakta uvádějí: žádné datum, číslo, stranu (vpravo, vlevo), lék ani zápor, který v nich není.
3. Nic nedoplňuj, neodhaduj a nehodnoť. Nepočítej intervaly ani trendy. Nedoporučuj léčbu ani postup.
4. Fakt označený ZÁPOR je zjištěný zápor: piš ho jako zápor ("bez metastáz"), nikdy jako nález.
5. Podezření piš jako podezření, ne jako potvrzenou diagnózu. Plánované a vyžádané piš jako plánované a vyžádané, ne jako provedené.
6. Data opisuj přesně tak, jak jsou ve faktu; neúplné datum ("3/2024") nedoplňuj.
7. Patologické a klinické stadium jsou různé údaje, nezaměňuj je; stadium při diagnóze není současné stadium.
8. Zástupné značky v hranatých závorkách ([PACIENT], [LEKAR_1]) do vět nepiš. Jména osob nepiš.

Otázka pro MDT:
9. Je-li na prvním řádku "Navrhnout otázku pro MDT: ano", navrhni jednu otázku, kterou má MDT rozhodnout: vyjdi z účelu (požadavek, plán nebo rozhodnutí, které na MDT odkazuje) a z nejnovějšího nálezu. Otázka se ptá, nenavrhuje odpověď ani léčbu, a končí otazníkem. "question_kind" je "document_purpose", když vychází z účelu uvedeného v dokumentu, jinak "latest_finding". V "basis" uveď role ("purpose", "finding", "other") s odkazy na fakta. Platí pro ni pravidla 2 až 8.
10. Je-li "Navrhnout otázku pro MDT: ano", otázku navrhni vždy, když fakta obsahují požadavek, plán, rozhodnutí nebo nález; "question": null vrať jen tehdy, když nic z toho neobsahují. Je-li "Navrhnout otázku pro MDT: ne", vrať "question": null.`;

const refs = { type: "array", items: { type: "string" } };

export const BRIEF_SCHEMA = {
  name: "brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sentences", "question"],
    properties: {
      sentences: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["text", "facts"], properties: { text: { type: "string" }, facts: refs } },
      },
      question: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["text", "question_kind", "basis"],
            properties: {
              text: { type: "string" },
              question_kind: { type: "string", enum: ["document_purpose", "latest_finding"] },
              basis: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["role", "facts"],
                  properties: { role: { type: "string", enum: ["purpose", "finding", "other"] }, facts: refs },
                },
              },
            },
          },
          { type: "null" },
        ],
      },
    },
  },
};
