# FNO challenge documents

Readable copies of the two Word documents FNO shipped with the challenge
data. The originals are in `data/rakathon-26/2_AI asistent MDT/`.

- [`upresneni-vystupu-ai-asistenta.md`](upresneni-vystupu-ai-asistenta.md):
  "Upřesnění výstupu AI asistenta pro MDT", FNO's description of the
  expected output, converted to Markdown word for word, with a translation.
- [`konzultace-pacienta-form.json`](konzultace-pacienta-form.json):
  "Struktura MDT protokolu_FNO.docx", the MDT consultation request form,
  as a list of fields with their types. The docx is a web form pasted into
  Word: each input is an embedded HTML control, whose type is read from
  its class ID. Two inputs (contact e-mail, attachment) did not survive
  the paste; their types are inferred from the labels and marked so.

The checklist of what FNO expects is in
[`docs/agent/REQUIREMENTS.md`](../../agent/REQUIREMENTS.md).
