# English: the "Nový pacient" (New patient) dialog, uploads and "Upload from phone" (docs/design/I18N.md). Message IDs
# are the same as in Czech. Names and case IDs come in as placeholders; the catalog holds no patient data, synthetic or not.
#
## Glossary (Czech -> English), for clinician review
# Žádost o konzultaci -> Consultation request
# Rodné číslo -> Birth number (the Czech national personal ID)
# Pojišťovna -> Insurer
# Jméno lékaře (vlastník) -> Doctor's name (owner)
# Odesílající pracoviště -> Referring department
# Anamnéza -> History
# Otázka na NOCO (otázka pro MDT) -> Question for NOCO (question for the MDT); NOCO is FNO's neuro-oncology centre
# Kontrola čitelnosti -> Readability check
# Pseudonymizace -> Pseudonymization
# Extrakce údajů -> Data extraction
# Kontrola úplnosti -> Completeness check
# Chybějící podklady -> Missing documents
# špatně čitelný -> poorly readable

## "Nový pacient": frame and steps

intake-title = New patient
intake-close = Close
# A step of the stepper: its number, then its name.
intake-step = { $n }. { $title }
intake-step-referral = Consultation request
intake-step-documents = Documents
intake-step-processing = Processing
intake-only-doctor-or-coordinator = A patient is added by a doctor or the coordinator.

## Step 1: the referral form

intake-form-intro = Fields follow the FNO form “Konzultace pacienta” (patient consultation). Required fields are marked *.
intake-field-first-name = First name
intake-field-last-name = Surname
intake-field-birth-number = Birth number
intake-field-birth-number-hint = only the format is checked
intake-field-insurer = Insurer
intake-insurer-none = not selected
intake-field-owner = Doctor's name (owner)
intake-field-dept = Referring department
intake-field-email = Contact e-mail
intake-field-phone = Contact phone
intake-field-anamnesis = History
intake-field-anamnesis-hint = optional, the assistant compiles it from the documentation
intake-field-question = Question for NOCO (question for the MDT)
intake-field-question-hint = optional, can be added later in the patient detail
# The required mark " *" follows in the markup.
intake-consent = I agree that FNO may use the personal data given here to process the request, under the GDPR.
intake-continue = Continue
intake-error-first-name = Enter the first name.
intake-error-last-name = Enter the surname.
intake-error-birth-number = Enter the birth number.
intake-error-birth-number-format = Enter the birth number as 123456/7890.
intake-error-consent = The request cannot be sent without consent to data processing.
# $existing is a link to the existing patient ("Surname First name, case ID"), $override the button below.
intake-duplicate = A patient with this birth number is already in the database: { $existing }. { $override }
intake-duplicate-override = Create a new record anyway

## Step 1: import of the referral from FHIR

intake-fhir-open = Import from FHIR
intake-fhir-label = Import from FHIR: a Bundle with Patient, Coverage and ServiceRequest (referral), or Patient only
intake-fhir-pick-file = Choose a .json file
intake-fhir-sample = Insert sample
intake-fhir-cancel = Cancel
intake-fhir-load = Load
# $found lists FHIR resource types (Patient, Coverage, ServiceRequest); $missing the form fields the data lacks.
intake-fhir-loaded = Loaded from FHIR ({ $found }). Confirm the GDPR consent by hand.
intake-fhir-loaded-missing = Loaded from FHIR ({ $found }). Not in the data: { $missing }. Confirm the GDPR consent by hand.
intake-fhir-bad-json = Import failed: the data are not valid JSON.

## Step 2: documents

intake-docs-zone-title = Drag documents here
intake-docs-zone-hint = or click to choose (PDF, DOC/DOCX, XLS/XLSX, ODT or ZIP, up to 20 MB)
intake-already-uploaded = Already uploaded: { $names }
intake-back = Back
intake-process = Process
# The intake demo patient (synthetic, samples/): hints for the presenter. $name is that synthetic patient's name.
intake-demo-name-mismatch = The name in the request does not match the name in the demo patient's documents ({ $name }). The documents will not be attached to this record.
intake-demo-exists = Demo patient { $name } is already in the database; the new record stays without processed documents.
# $zip is the link intake-demo-zip.
intake-demo-upload = Demo patient: upload { $total } documents (PDF) from the folder samples/{ $folder }/upload, or { $zip }, unpack it and upload the PDFs one by one.
intake-demo-missing = Demo patient: { $missing } of { $total } documents from samples/{ $folder }/upload are still missing. Upload them, or { $zip }, unpack it and upload the PDFs one by one.
intake-demo-zip = download the ZIP

## Step 3: processing

intake-stage-readability = Readability check
intake-stage-pseudonymization = Pseudonymization
intake-stage-extraction = Data extraction
intake-stage-completeness = Completeness check
intake-pseudonymization-note = Before extraction, the name and birth number are replaced by the case ID; the language model sees only pseudonymized text. The mapping table stays on the hospital's server.
intake-done = Done.
intake-done-prepared = Processed { $docs ->
    [one] { $docs } document
   *[other] { $docs } documents
} ({ $pages } p.), all readable. Missing documents: { $gaps }, shown in the patient detail.
intake-done-listed = The documents are uploaded. The demo processes only the prepared documents of the demo patient; this record stays without extraction.
intake-add = Add to database
intake-saving = Saving…
intake-added = Patient { $id } added to the database

## Uploaded files (the intake, "Projednání na MDT", the documents tab)

upload-size-kb = { $size } kB
upload-size-mb = { $size } MB
upload-done = Uploaded
upload-from-phone = from phone
upload-remove = Remove { $name }
upload-withdrawn = Removed from the case
upload-withdraw-wrong-patient = Another patient
upload-withdraw-confirm-wrong-patient = Remove { $name } as another patient's document? Its content and file name are deleted; an entry with the reason stays in the list.
upload-withdraw-yes = Remove
upload-withdraw-no = Keep
upload-part-pages = p. { $pages }:
upload-part-poor = poorly readable
upload-part-verify = verify
uploads-zone-title = Drag files here
uploads-zone-hint = or click to choose (PDF, images, Word)
uploads-none = No documents uploaded.
uploads-added = Uploaded: { $n ->
    [one] { $n } file
   *[other] { $n } files
}
uploads-poor-readability = The document is poorly readable; request a better copy.
uploads-poor-readability-reasons = The document is poorly readable; request a better copy. ({ $reasons })
uploads-note = Demo: the assistant does not read uploaded files; apart from the prepared demo documents, only the file name and size are stored. In real use they are stored with the case and go through the readability check.
uploads-note-read = Uploaded PDFs and photos (JPEG, PNG) are stored with the case and read at once without AI: page reading, readability check, lab values. Other formats (such as Word) keep only their name and size; upload them as PDF.
uploads-note-pipeline = Demo: apart from the prepared demo documents, only the file name and size are stored. In real use they are stored with the case and go through the readability check.

## "Upload from phone"

phone-button = Upload from phone
phone-title = Upload from phone
phone-heading = Upload from phone · { $caseId }
phone-close = Close
phone-done = Done
phone-preparing = Preparing the code…
phone-qr-alt = QR code for uploading from a phone
phone-scan = Scan the code with the phone's camera. A page opens where you photograph or choose the document.
phone-validity = Valid for 15 minutes (until { $time }), only for uploads to case { $caseId }.
phone-full = The code has already received the maximum number of files.
phone-expired = The code has expired.
phone-new-code = New code
phone-received = Received from phone ({ $n })
phone-waiting = Waiting for files from the phone…
