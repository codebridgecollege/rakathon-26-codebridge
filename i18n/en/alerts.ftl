# English, the alerts of an extraction run (codebridge.extraction/2, alerts[].message). One message per alert rule,
# named alert-<rule>. Arguments: $fact, $fact_a, $fact_b are fact IDs the view renders as that fact's line;
# $document is a document or part ID the view renders as its title; $field is a code. Messages are "label: value",
# so no argument needs a grammatical case. The model's own explanation is the alert's note, in the content language.
# Written by fixtures/convert/convert_v2.py from its MESSAGES table; edit the table and rerun, not this file.

alert-request-without-result = Request without a result in the available documentation: { $fact }

alert-original-report-missing = Original report missing from the available documentation, cited only: { $fact }

alert-mdt-question-missing = Explicit question for the MDT { -gap-not-stated-f }. Purpose according to the document: { $fact }

alert-suspicion-not-verified = Suspicion without histological or other confirmation in the available documentation: { $fact }

alert-document-date-not-stated = Document date { -gap-not-stated }: { $document }

alert-lab-draw-date-not-stated = Lab sample date { -gap-not-stated }: { $document }

alert-reading-uncertain = Uncertain reading, { -trust-verify-reading }: { $fact }

alert-patient-field-missing = { $field ->
    [age] Age
   *[birth_number] Birth number
}: { -gap-not-stated }

alert-exam-attribution-unclear = Unclear which examination the finding belongs to: { $fact }

alert-date-contradiction = Different dates for the same examination: { $fact_a }; { $fact_b }

alert-response-assessment-differs = The treatment response assessment differs within the documentation: { $fact_a }; { $fact_b }

alert-cycles-differ = The number of indicated and documented cycles differs: { $fact }

alert-page-order-unclear = The page order and the latest conclusion of the document are not clear: { $document }

alert-dosing-contradiction = Different dosing of the same drug: { $fact_a }; { $fact_b }
