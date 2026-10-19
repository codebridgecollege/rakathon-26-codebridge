# Czech, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,
# named alert-<rule>. Arguments: $fact, $fact_a, $fact_b are fact IDs the view renders as that fact's line;
# $document is a document or part ID the view renders as its title; $field is a code. Messages are "label: value",
# so no argument needs a grammatical case. The model's own explanation is the alert's note, in the content language.
# Written by fixtures/convert/convert_v2.py from its MESSAGES table; edit the table and rerun, not this file.

alert-request-without-result = Požadavek bez výsledku v dostupné dokumentaci: { $fact }

alert-original-report-missing = Originální zpráva v dostupné dokumentaci chybí, jen citace: { $fact }

alert-mdt-question-missing = Výslovná otázka pro MDT { -gap-not-stated-f }. Účel dle dokumentu: { $fact }

alert-suspicion-not-verified = Suspekce bez histologického ani jiného ověření v dostupné dokumentaci: { $fact }

alert-document-date-not-stated = Datum dokumentu { -gap-not-stated }: { $document }

alert-lab-draw-date-not-stated = Datum odběru laboratorních hodnot { -gap-not-stated }: { $document }

alert-reading-uncertain = Nejisté čtení, { -trust-verify-reading }: { $fact }

alert-patient-field-missing = { $field ->
    [age] Věk
   *[birth_number] Rodné číslo
}: { -gap-not-stated }

alert-exam-attribution-unclear = Nejasné, ke kterému vyšetření nález patří: { $fact }

alert-date-contradiction = Rozdílné datum téhož vyšetření: { $fact_a }; { $fact_b }

alert-response-assessment-differs = Hodnocení odpovědi na léčbu se v dokumentaci liší: { $fact_a }; { $fact_b }

alert-cycles-differ = Počet indikovaných a dokumentovaných cyklů se liší: { $fact }

alert-page-order-unclear = Pořadí stran a nejnovější závěr dokumentu nejsou jednoznačné: { $document }

alert-dosing-contradiction = Rozdílné dávkování téhož léku: { $fact_a }; { $fact_b }
