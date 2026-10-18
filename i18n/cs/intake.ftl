# Czech: the "Nový pacient" dialog, uploads and "Nahrát z telefonu" (docs/design/I18N.md). Message IDs are semantic.
# Names and case IDs come in as placeholders; the catalog holds no patient data, synthetic or not.

## "Nový pacient": frame and steps

intake-title = Nový pacient
intake-close = Zavřít
# A step of the stepper: its number, then its name.
intake-step = { $n }. { $title }
intake-step-referral = Žádost o konzultaci
intake-step-documents = Dokumenty
intake-step-processing = Zpracování
intake-only-doctor-or-coordinator = Pacienta zakládá lékař nebo koordinátorka.

## Step 1: the referral form

intake-form-intro = Pole podle formuláře FNO „Konzultace pacienta“. Povinná pole jsou označena *.
intake-field-first-name = Jméno
intake-field-last-name = Příjmení
intake-field-birth-number = Rodné číslo
intake-field-birth-number-hint = kontroluje se jen formát
intake-field-insurer = Pojišťovna
intake-insurer-none = nevybráno
intake-field-owner = Jméno lékaře (vlastník)
intake-field-dept = Odesílající pracoviště
intake-field-email = Kontaktní e-mail
intake-field-phone = Kontaktní telefon
intake-field-anamnesis = Anamnéza
intake-field-anamnesis-hint = nepovinné, asistent ji sestaví z dokumentace
intake-field-question = Otázka na NOCO (otázka pro MDT)
intake-field-question-hint = nepovinné, lze doplnit později v detailu pacienta
# The required mark " *" follows in the markup.
intake-consent = Souhlasím, aby FNO použila uvedené osobní údaje ke zpracování požadavku, dle GDPR.
intake-continue = Pokračovat
intake-error-first-name = Vyplňte jméno.
intake-error-last-name = Vyplňte příjmení.
intake-error-birth-number = Vyplňte rodné číslo.
intake-error-birth-number-format = Rodné číslo zadejte ve tvaru 123456/7890.
intake-error-consent = Bez souhlasu se zpracováním údajů nelze žádost odeslat.
# $existing is a link to the existing patient ("Příjmení Jméno, ID case"), $override the button below.
intake-duplicate = Pacient s tímto rodným číslem už v databázi je: { $existing }. { $override }
intake-duplicate-override = Přesto vytvořit nový záznam

## Step 1: import of the referral from FHIR

intake-fhir-open = Import z FHIR
intake-fhir-label = Import z FHIR: Bundle s Patient, Coverage a ServiceRequest (doporučení), nebo jen Patient
intake-fhir-pick-file = Vybrat soubor .json
intake-fhir-sample = Vložit ukázku
intake-fhir-cancel = Zrušit
intake-fhir-load = Načíst
# $found lists FHIR resource types (Patient, Coverage, ServiceRequest); $missing the form fields the data lacks.
intake-fhir-loaded = Načteno z FHIR ({ $found }). Souhlas s GDPR potvrďte ručně.
intake-fhir-loaded-missing = Načteno z FHIR ({ $found }). V datech není: { $missing }. Souhlas s GDPR potvrďte ručně.
intake-fhir-bad-json = Import se nezdařil: data nejsou platný JSON.

## Step 2: documents

intake-docs-zone-title = Přetáhněte dokumenty sem
intake-docs-zone-hint = nebo klikněte a vyberte (PDF, DOC/DOCX, XLS/XLSX, ODT nebo ZIP, nejvýše 20 MB)
intake-already-uploaded = Už nahráno: { $names }
intake-back = Zpět
intake-process = Zpracovat
# The intake demo patient (synthetic, samples/): hints for the presenter. $name is that synthetic patient's name.
intake-demo-name-mismatch = Jméno v žádosti se neshoduje se jménem v dokumentech ukázkového pacienta ({ $name }). Dokumenty se k tomuto záznamu nepřipojí.
intake-demo-exists = Ukázkový pacient { $name } už v databázi je; nový záznam zůstane bez zpracovaných dokumentů.
# $zip is the link intake-demo-zip.
intake-demo-upload = Ukázkový pacient: nahrajte { $total } dokumentů (PDF) ze složky samples/{ $folder }/upload, nebo { $zip }, rozbalte ho a nahrajte jednotlivé PDF.
intake-demo-missing = Ukázkový pacient: chybí ještě { $missing } z { $total } dokumentů ze složky samples/{ $folder }/upload, nebo { $zip }, rozbalte ho a nahrajte jednotlivé PDF.
intake-demo-zip = stáhněte ZIP

## Step 3: processing

intake-stage-readability = Kontrola čitelnosti
intake-stage-pseudonymization = Pseudonymizace
intake-stage-extraction = Extrakce údajů
intake-stage-completeness = Kontrola úplnosti
intake-pseudonymization-note = Před extrakcí se jméno a rodné číslo nahradí ID případu; jazykový model vidí jen pseudonymizovaný text. Převodní tabulka zůstává na serveru nemocnice.
intake-done = Hotovo.
intake-done-prepared = Zpracováno { $docs ->
    [one] { $docs } dokument
    [few] { $docs } dokumenty
    [many] { $docs } dokumentu
   *[other] { $docs } dokumentů
} ({ $pages } s.), všechny dobře čitelné. Chybějící podklady: { $gaps }, ukážou se v detailu pacienta.
intake-done-listed = Dokumenty jsou nahrané. Maketa zpracovává jen připravené dokumenty ukázkového pacienta, tento záznam zůstane bez extrakce.
intake-add = Přidat do databáze
intake-saving = Ukládám…
intake-added = Pacient { $id } přidán do databáze

## Uploaded files (the intake, "Projednání na MDT", the documents tab)

upload-size-kb = { $size } kB
upload-size-mb = { $size } MB
upload-done = Nahráno
upload-from-phone = z telefonu
upload-remove = Odebrat { $name }
uploads-zone-title = Přetáhněte soubory sem
uploads-zone-hint = nebo klikněte a vyberte (PDF, obrázky, Word)
uploads-none = Žádné dokumenty nenahrány.
uploads-added = Nahráno: { $n ->
    [one] { $n } soubor
    [few] { $n } soubory
    [many] { $n } souboru
   *[other] { $n } souborů
}
uploads-poor-readability = Dokument je špatně čitelný, vyžádejte lepší kopii.
uploads-poor-readability-reasons = Dokument je špatně čitelný, vyžádejte lepší kopii. ({ $reasons })
uploads-note = Ukázka: asistent nahrané soubory nečte; kromě připravených ukázkových dokumentů se ukládá jen název a velikost souboru. Ve skutečném provozu se uloží k případu a projdou kontrolou čitelnosti.
uploads-note-pipeline = Ukázka: kromě připravených ukázkových dokumentů se ukládá jen název a velikost souboru. Ve skutečném provozu se uloží k případu a projdou kontrolou čitelnosti.

## "Nahrát z telefonu"

phone-button = Nahrát z telefonu
phone-title = Nahrát z telefonu
phone-heading = Nahrát z telefonu · { $caseId }
phone-close = Zavřít
phone-done = Hotovo
phone-preparing = Připravuji kód…
phone-qr-alt = QR kód pro nahrání z telefonu
phone-scan = Naskenujte kód fotoaparátem telefonu. Otevře se stránka, kde dokument vyfotíte nebo vyberete.
phone-validity = Platí 15 minut (do { $time }), jen pro nahrání k případu { $caseId }.
phone-full = Kód už přijal nejvíce souborů.
phone-expired = Platnost kódu skončila.
phone-new-code = Nový kód
phone-received = Přijato z telefonu ({ $n })
phone-waiting = Čekám na soubory z telefonu…
