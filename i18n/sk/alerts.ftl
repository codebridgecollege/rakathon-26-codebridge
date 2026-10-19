# Slovak, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,
# named alert-<rule>. Arguments: $fact, $fact_a, $fact_b are fact IDs the view renders as that fact's line;
# $document is a document or part ID the view renders as its title; $field is a code. Messages are "label: value",
# so no argument needs a grammatical case. The model's own explanation is the alert's note, in the content language.
# Written by fixtures/convert/convert_v2.py from its MESSAGES table; edit the table and rerun, not this file.

alert-request-without-result = Požiadavka bez výsledku v dostupnej dokumentácii: { $fact }

alert-original-report-missing = Originálna správa v dostupnej dokumentácii chýba, len citácia: { $fact }

alert-mdt-question-missing = Výslovná otázka pre MDT { -gap-not-stated-f }. Účel podľa dokumentu: { $fact }

alert-suspicion-not-verified = Suspekcia bez histologického ani iného overenia v dostupnej dokumentácii: { $fact }

alert-document-date-not-stated = Dátum dokumentu { $document }: { -gap-not-stated }

alert-lab-draw-date-not-stated = Dátum odberu laboratórnych hodnôt v dokumente { $document }: { -gap-not-stated }

alert-reading-uncertain = Neisté čítanie: { $fact }

alert-patient-field-missing = { $field ->
    [age] Vek
    [birth_number] Rodné číslo
   *[other] Údaj o pacientovi
}: { -gap-not-stated }

alert-consultation-form-missing = Konzultačný formulár v dostupnej dokumentácii nenájdený.

alert-comparison-imaging-missing = Predchádzajúce vyšetrenie na porovnanie v dostupnej dokumentácii nenájdené: { $fact }

alert-exam-attribution-unclear = Nejasné, ku ktorému vyšetreniu nález patrí: { $fact }

alert-date-contradiction = Rozdielny dátum toho istého vyšetrenia: { $fact_a }; { $fact_b }

alert-response-assessment-differs = Hodnotenie odpovede na liečbu sa v dokumentácii líši: { $fact_a }; { $fact_b }

alert-cycles-differ = Počet indikovaných a zdokumentovaných cyklov sa líši: { $fact }

alert-page-order-unclear = Poradie strán a najnovší záver dokumentu nie sú jednoznačné: { $document }

alert-dosing-differs = Dávkovanie lieku sa medzi časťami dokumentácie líši: { $fact_a }; { $fact_b }
