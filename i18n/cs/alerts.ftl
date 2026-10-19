# Czech, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,
# named alert-<rule>. Arguments: $fact, $fact_a, $fact_b are fact IDs the view renders as that fact's line;
# $document is a document or part ID the view renders as its title; $field is a code. Messages are "label: value",
# so no argument needs a grammatical case. The model's own explanation is the alert's note, in the content language.
# Written by fixtures/convert/convert_v2.py from its MESSAGES table; edit the table and rerun, not this file.

alert-request-without-result = Požadavek bez výsledku v dostupné dokumentaci: { $fact }

alert-original-report-missing = Originální zpráva v dostupné dokumentaci chybí, jen citace: { $fact }

alert-mdt-question-missing = Výslovná otázka pro MDT { -gap-not-stated-f }. Účel dle dokumentu: { $fact }

alert-suspicion-not-verified = Suspekce bez histologického ani jiného ověření v dostupné dokumentaci: { $fact }

alert-document-date-not-stated = Datum dokumentu { $document }: { -gap-not-stated }

alert-lab-draw-date-not-stated = Datum odběru laboratorních hodnot v dokumentu { $document }: { -gap-not-stated }

alert-reading-uncertain = Nejisté čtení: { $fact }

alert-patient-field-missing = { $field ->
    [age] Věk
    [birth_number] Rodné číslo
   *[other] Údaj o pacientovi
}: { -gap-not-stated }

alert-consultation-form-missing = Konzultační formulář v dostupné dokumentaci nenalezen.

alert-comparison-imaging-missing = Předchozí vyšetření ke srovnání v dostupné dokumentaci nenalezeno: { $fact }

alert-exam-attribution-unclear = Nejasné, ke kterému vyšetření nález patří: { $fact }

alert-date-contradiction = Rozdílné datum téhož vyšetření: { $fact_a }; { $fact_b }

alert-response-assessment-differs = Hodnocení odpovědi na léčbu se v dokumentaci liší: { $fact_a }; { $fact_b }

alert-cycles-differ = Počet indikovaných a dokumentovaných cyklů se liší: { $fact }

alert-page-order-unclear = Pořadí stran a nejnovější závěr dokumentu nejsou jednoznačné: { $document }

alert-dosing-differs = Dávkování léku se mezi částmi dokumentace liší: { $fact_a }; { $fact_b }

alert-original-reports-missing = Originální zprávy citovaných vyšetření v dostupné dokumentaci chybí, počet: { $count }

alert-lab-value-differs = Rozdílná hodnota téhož laboratorního vyšetření ze stejného odběru: { $fact_a }; { $fact_b }

alert-stage-differs = Rozdílné stadium téhož druhu ke stejnému datu: { $fact_a }; { $fact_b }

alert-performance-status-differs = Rozdílný výkonnostní stav ke stejnému datu: { $fact_a }; { $fact_b }

alert-metastasis-status-differs = Metastáza téže lokalizace ke stejnému datu jednou uvedena, jednou vyloučena: { $fact_a }; { $fact_b }

alert-histology-grade-differs = Rozdílný grading téhož histologického vzorku: { $fact_a }; { $fact_b }

alert-therapy-stop-before-start = Datum ukončení léčby je dřívější než datum zahájení: { $fact }

alert-date-after-processing = Datum proběhlé události je pozdější než datum zpracování dokumentace: { $fact }

alert-result-before-request = Výsledek je datován dříve než požadavek: { $fact_a }; { $fact_b }

alert-brief-unverified-withheld = Shrnutí uvádí jen ověřené údaje; údaje k ověření v něm nejsou, počet: { $count }

alert-brief-sentences-dropped = Ze shrnutí vypuštěny věty, které uvedená fakta nedoložila, počet: { $count }

alert-poor-copy = Špatně čitelný dokument, vyžádejte lepší kopii: { $document }

alert-identity-conflict = Strana patří jinému pacientovi; její údaje nejsou zobrazeny: { $document }, s. { $page }
