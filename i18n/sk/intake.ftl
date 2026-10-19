# Slovak: the "Nový pacient" dialog, uploads and "Nahrať z telefónu" (docs/design/I18N.md). Message IDs are the same as
# in Czech. Names and case IDs come in as placeholders; the catalog holds no patient data, synthetic or not.
#
## Glossary (Czech -> Slovak), for clinician review
# Žádost o konzultaci -> Žiadosť o konzultáciu
# Rodné číslo -> Rodné číslo
# Pojišťovna -> Poisťovňa
# Jméno lékaře (vlastník) -> Meno lekára (vlastník)
# Odesílající pracoviště -> Odosielajúce pracovisko
# Anamnéza -> Anamnéza
# Otázka na NOCO (otázka pro MDT) -> Otázka na NOCO (otázka pre MDT); NOCO is FNO's neuro-oncology centre, kept as a name
# Kontrola čitelnosti -> Kontrola čitateľnosti
# Pseudonymizace -> Pseudonymizácia
# Extrakce údajů -> Extrakcia údajov
# Kontrola úplnosti -> Kontrola úplnosti
# Chybějící podklady -> Chýbajúce podklady
# špatně čitelný -> zle čitateľný
# Nahrát z telefonu -> Nahrať z telefónu

## "Nový pacient": frame and steps

intake-title = Nový pacient
intake-close = Zavrieť
# A step of the stepper: its number, then its name.
intake-step = { $n }. { $title }
intake-step-referral = Žiadosť o konzultáciu
intake-step-documents = Dokumenty
intake-step-processing = Spracovanie
intake-only-doctor-or-coordinator = Pacienta zakladá lekár alebo koordinátorka.

## Step 1: the referral form

intake-form-intro = Polia podľa formulára FNO „Konzultace pacienta“. Povinné polia sú označené *.
intake-field-first-name = Meno
intake-field-last-name = Priezvisko
intake-field-birth-number = Rodné číslo
intake-field-birth-number-hint = kontroluje sa len formát
intake-field-insurer = Poisťovňa
intake-insurer-none = nevybrané
intake-field-owner = Meno lekára (vlastník)
intake-field-dept = Odosielajúce pracovisko
intake-field-email = Kontaktný e-mail
intake-field-phone = Kontaktný telefón
intake-field-anamnesis = Anamnéza
intake-field-anamnesis-hint = nepovinné, asistent ju zostaví z dokumentácie
intake-field-question = Otázka na NOCO (otázka pre MDT)
intake-field-question-hint = nepovinné, dá sa doplniť neskôr v detaile pacienta
# The required mark " *" follows in the markup.
intake-consent = Súhlasím, aby FNO použila uvedené osobné údaje na spracovanie požiadavky podľa GDPR.
intake-continue = Pokračovať
intake-error-first-name = Vyplňte meno.
intake-error-last-name = Vyplňte priezvisko.
intake-error-birth-number = Vyplňte rodné číslo.
intake-error-birth-number-format = Rodné číslo zadajte v tvare 123456/7890.
intake-error-consent = Bez súhlasu so spracovaním údajov nemožno žiadosť odoslať.
# $existing is a link to the existing patient ("Priezvisko Meno, ID case"), $override the button below.
intake-duplicate = Pacient s týmto rodným číslom už je v databáze: { $existing }. { $override }
intake-duplicate-override = Napriek tomu vytvoriť nový záznam

## Step 1: import of the referral from FHIR

intake-fhir-open = Import z FHIR
intake-fhir-label = Import z FHIR: Bundle s Patient, Coverage a ServiceRequest (žiadanka), alebo len Patient
intake-fhir-pick-file = Vybrať súbor .json
intake-fhir-sample = Vložiť ukážku
intake-fhir-cancel = Zrušiť
intake-fhir-load = Načítať
# $found lists FHIR resource types (Patient, Coverage, ServiceRequest); $missing the form fields the data lacks.
intake-fhir-loaded = Načítané z FHIR ({ $found }). Súhlas s GDPR potvrďte ručne.
intake-fhir-loaded-missing = Načítané z FHIR ({ $found }). V údajoch chýba: { $missing }. Súhlas s GDPR potvrďte ručne.
intake-fhir-bad-json = Import sa nepodaril: údaje nie sú platný JSON.

## Step 2: documents

intake-docs-zone-title = Presuňte dokumenty sem
intake-docs-zone-hint = alebo kliknite a vyberte (PDF, DOC/DOCX, XLS/XLSX, ODT alebo ZIP, najviac 20 MB)
intake-already-uploaded = Už nahrané: { $names }
intake-back = Späť
intake-process = Spracovať
# The intake demo patient (synthetic, samples/): hints for the presenter. $name is that synthetic patient's name.
intake-demo-name-mismatch = Meno v žiadosti sa nezhoduje s menom v dokumentoch ukážkového pacienta ({ $name }). Dokumenty sa k tomuto záznamu nepripoja.
intake-demo-exists = Ukážkový pacient { $name } už je v databáze; nový záznam zostane bez spracovaných dokumentov.
# $zip is the link intake-demo-zip.
intake-demo-upload = Ukážkový pacient: nahrajte { $total } dokumentov (PDF) z priečinka samples/{ $folder }/upload, alebo { $zip }, rozbaľte ho a nahrajte jednotlivé PDF.
intake-demo-missing = Ukážkový pacient: chýba ešte { $missing } z { $total } dokumentov z priečinka samples/{ $folder }/upload, alebo { $zip }, rozbaľte ho a nahrajte jednotlivé PDF.
intake-demo-zip = stiahnite ZIP

## Step 3: processing

intake-stage-readability = Kontrola čitateľnosti
intake-stage-pseudonymization = Pseudonymizácia
intake-stage-extraction = Extrakcia údajov
intake-stage-completeness = Kontrola úplnosti
intake-pseudonymization-note = Pred extrakciou sa meno a rodné číslo nahradia ID prípadu; jazykový model vidí len pseudonymizovaný text. Prevodná tabuľka zostáva na serveri nemocnice.
intake-done = Hotovo.
intake-done-prepared = { $docs ->
    [one] Spracovaný { $docs } dokument
    [few] Spracované { $docs } dokumenty
    [many] Spracovaného { $docs } dokumentu
   *[other] Spracovaných { $docs } dokumentov
} ({ $pages } s.), všetky dobre čitateľné. Chýbajúce podklady: { $gaps }, zobrazia sa v detaile pacienta.
intake-done-listed = Dokumenty sú nahrané. Ukážka spracúva len pripravené dokumenty ukážkového pacienta, tento záznam zostane bez extrakcie.
intake-add = Pridať do databázy
intake-saving = Ukladám…
intake-added = Pacient { $id } pridaný do databázy

## Uploaded files (the intake, "Projednání na MDT", the documents tab)

upload-size-kb = { $size } kB
upload-size-mb = { $size } MB
upload-done = Nahrané
upload-from-phone = z telefónu
upload-remove = Odobrať { $name }
upload-withdrawn = Odobraté z prípadu
upload-withdraw-wrong-patient = Iný pacient
upload-withdraw-confirm-wrong-patient = Odobrať { $name } ako dokument iného pacienta? Obsah aj názov súboru sa zmažú, v zozname zostane záznam s dôvodom.
upload-withdraw-yes = Odobrať
upload-withdraw-no = Ponechať
uploads-zone-title = Presuňte súbory sem
uploads-zone-hint = alebo kliknite a vyberte (PDF, obrázky, Word)
uploads-none = Žiadne dokumenty nie sú nahrané.
uploads-added = Nahrané: { $n ->
    [one] { $n } súbor
    [few] { $n } súbory
    [many] { $n } súboru
   *[other] { $n } súborov
}
uploads-poor-readability = Dokument je zle čitateľný, vyžiadajte lepšiu kópiu.
uploads-poor-readability-reasons = Dokument je zle čitateľný, vyžiadajte lepšiu kópiu. ({ $reasons })
uploads-note = Ukážka: asistent nahrané súbory nečíta; okrem pripravených ukážkových dokumentov sa ukladá len názov a veľkosť súboru. V skutočnej prevádzke sa uložia k prípadu a prejdú kontrolou čitateľnosti.
uploads-note-read = Nahrané PDF a fotografie (JPEG, PNG) sa uložia k prípadu a hneď sa prečítajú bez AI: čítanie strán, kontrola čitateľnosti, laboratórne hodnoty. Iné formáty (napr. Word) sa uložia len ako názov a veľkosť; nahrajte ich ako PDF.
uploads-note-pipeline = Ukážka: okrem pripravených ukážkových dokumentov sa ukladá len názov a veľkosť súboru. V skutočnej prevádzke sa uložia k prípadu a prejdú kontrolou čitateľnosti.

## "Nahrať z telefónu"

phone-button = Nahrať z telefónu
phone-title = Nahrať z telefónu
phone-heading = Nahrať z telefónu · { $caseId }
phone-close = Zavrieť
phone-done = Hotovo
phone-preparing = Pripravujem kód…
phone-qr-alt = QR kód na nahratie z telefónu
phone-scan = Naskenujte kód fotoaparátom telefónu. Otvorí sa stránka, kde dokument odfotíte alebo vyberiete.
phone-validity = Platí 15 minút (do { $time }), len na nahratie k prípadu { $caseId }.
phone-full = Kód už prijal maximálny počet súborov.
phone-expired = Platnosť kódu skončila.
phone-new-code = Nový kód
phone-received = Prijaté z telefónu ({ $n })
phone-waiting = Čakám na súbory z telefónu…
