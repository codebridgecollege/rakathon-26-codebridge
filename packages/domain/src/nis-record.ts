// The "záznam z NIS" source panel (issue #22): a NIS record a fact rests on, shown to the doctor as the record states
// it. A NIS record has no page and no quote; it is its own evidence (EXTRACTION-FORMAT.md, "A record in the NIS"), so
// the panel lists the record's own fields, and the full record stays one click away. Pure: the Worker reads the record,
// this picks the fields, the app labels them through its catalog (patient-nisrec-field-<field>).

type R = Record<string, any>;

/** One line of the panel: a field the record has, its text as the record gives it. */
export type NisRecordField = { field: string; value: string };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : typeof x === "number" ? String(x) : null);
const text = (cc: R | undefined): string | null =>
  str(cc?.text) ?? str((Array.isArray(cc?.coding) ? cc!.coding : []).map((c: R) => c?.display).find(Boolean)) ?? null;
const codes = (cc: R | undefined): string | null => {
  const xs = ((Array.isArray(cc?.coding) ? cc!.coding : []) as R[]).filter((c) => str(c?.code)).map((c) => `${c.code}${str(c.system) ? ` (${c.system})` : ""}`);
  return xs.length ? xs.join(", ") : null;
};
const period = (p: R | undefined): string | null => {
  const a = str(p?.start);
  const b = str(p?.end);
  return a && b ? `${a} - ${b}` : (a ?? b);
};
const quantity = (q: R | undefined): string | null => (typeof q?.value === "number" ? `${str(q.comparator) ?? ""}${q.value}${str(q.unit) ? ` ${q.unit}` : ""}` : null);

/**
 * The fields the panel shows, in reading order, only those the record has. Values are the record's own text; nothing
 * is translated, normalised or inferred, so the doctor compares the fact with what the NIS says.
 */
export function nisRecordFields(r: R): NisRecordField[] {
  const out: NisRecordField[] = [];
  const add = (field: string, v: string | null | undefined) => {
    if (v) out.push({ field, value: v });
  };
  add("status", str(r.status));
  add("verification", text(r.verificationStatus) ?? codes(r.verificationStatus));
  add("clinical_status", text(r.clinicalStatus) ?? codes(r.clinicalStatus));
  add("category", ((Array.isArray(r.category) ? r.category : r.category ? [r.category] : []) as R[]).map((c) => text(c) ?? codes(c)).filter(Boolean).join(", ") || null);
  add("class", str(r.class?.display) ?? str(r.class?.code));
  add("name", text(r.code) ?? text(r.medicationCodeableConcept) ?? text(r.type?.[0]));
  add("codes", codes(r.code) ?? codes(r.medicationCodeableConcept) ?? codes(r.type?.[0]));
  add("value", quantity(r.valueQuantity) ?? str(r.valueString) ?? text(r.valueCodeableConcept));
  add("interpretation", ((r.interpretation ?? []) as R[]).map((i) => text(i) ?? codes(i)).filter(Boolean).join(", ") || null);
  add("reference_range", ((r.referenceRange ?? []) as R[]).map((x) => str(x?.text) ?? [quantity(x?.low), quantity(x?.high)].filter(Boolean).join(" - ")).filter(Boolean).join("; ") || null);
  add("date", str(r.effectiveDateTime) ?? period(r.effectivePeriod) ?? str(r.performedDateTime) ?? period(r.performedPeriod) ?? period(r.period) ?? str(r.authoredOn));
  add("onset", str(r.onsetDateTime) ?? str(r.onsetString) ?? period(r.onsetPeriod));
  add("abatement", str(r.abatementDateTime) ?? str(r.abatementString));
  add("dosage", ((r.dosage ?? []) as R[]).map((d) => str(d?.text)).filter(Boolean).join("; ") || null);
  add("reason", ((r.reasonCode ?? []) as R[]).map((c) => text(c)).filter(Boolean).join("; ") || null);
  add("department", str(r.serviceProvider?.display));
  add("conclusion", str(r.conclusion));
  add("note", ((r.note ?? []) as R[]).map((n) => str(n?.text)).filter(Boolean).join(" ") || null);
  add("issued", str(r.issued));
  return out;
}
