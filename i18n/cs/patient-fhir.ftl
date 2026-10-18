# Czech, the FHIR R4 export of a case (the "Export FHIR" dialog and the Bundle's own labels). FHIR is the HL7
# standard for exchanging health records as linked JSON records called resources. Message IDs start with
# "patient-fhir-". The Bundle translates only our labels and section titles (I18N.md, "PDF and FHIR"); names, quotes,
# codes and values come from the documents and never from this file.

## The dialog

patient-fhir-dialog-label = Export FHIR
patient-fhir-dialog-title = Export FHIR R4 · { $id }
# $n: the number of entries in the Bundle; $counts: "Patient 1, Observation 30, ..." (resource names are FHIR code).
patient-fhir-dialog-counts = Případ jako balík FHIR R4 (Bundle, { $n } { $n ->
        [one] záznam
        [few] záznamy
        [many] záznamu
       *[other] záznamů
    }): { $counts }. Každý údaj má záznam Provenance s dokumentem, stranou a citací. Vše je návrh asistenta, neověřený lékařem. Uložená kopie prošla oficiálním validátorem HL7 bez chyb (fhir/README.md).
patient-fhir-dialog-identity = Export obsahuje identifikaci pacienta. V pilotu by šel přes FHIR rozhraní nemocnice, ne jako soubor.
patient-fhir-download = Stáhnout JSON
patient-fhir-copy = Kopírovat
patient-fhir-close = Zavřít
patient-fhir-copied = Zkopírováno do schránky
patient-fhir-copy-failed = Kopírování se nepodařilo; označte text ručně

## The Bundle's labels and narrative. Composition text stays Czech while the content is Czech.

patient-fhir-device-name = CodeBridge MDT asistent (maketa)
patient-fhir-device-type = Software pro přípravu podkladů MDT
patient-fhir-doc-text = Dokument { $file }
patient-fhir-patient-text = { $name }, { $id }
patient-fhir-source-ref = { $file }, s. { $page }
patient-fhir-provenance-text = Zdroj: { $refs }
patient-fhir-activity-extracted = Vytěženo asistentem z dokumentu; neověřeno lékařem
patient-fhir-activity-observation = Pozorování asistenta; neověřeno lékařem
patient-fhir-activity-q-draft = Návrh otázky pro MDT asistentem z citovaných pasáží; neověřeno lékařem
patient-fhir-date-in-doc = Datum v dokumentu: { $date }
patient-fhir-dated-line = { $date }: { $text }
patient-fhir-dx-text = { $code } { $text }
patient-fhir-dx-text-dated = { $code } { $text }, diagnóza { $date }
patient-fhir-issue-text = Pozorování asistenta: { $text }
patient-fhir-negated = Negace uvedená v dokumentu.
patient-fhir-obs-clinical = Klinický nález
patient-fhir-obs-current = Aktuální stav
patient-fhir-obs-imaging = Zobrazovací vyšetření
patient-fhir-obs-histology = Histologie
patient-fhir-lab-out-of-range = { $dir ->
        [high] Nad
       *[low] Pod
    } rozmezím (vyhodnotil asistent podle uvedeného rozmezí)
patient-fhir-lab-as-written = V dokumentu: { $value }
patient-fhir-lab-no-date = Datum odběru neuvedeno v dostupné dokumentaci.
patient-fhir-lab-text = { $name }: { $value } { $unit } (ref. { $range })
patient-fhir-gap = Neuvedeno v dostupné dokumentaci.
patient-fhir-comp-text = Podklady pro MDT, { $id }: návrh asistenta, neověřeno lékařem.
patient-fhir-comp-type = Podklady pro multidisciplinární tým (MDT)
patient-fhir-comp-title = Podklady pro MDT, { $id } (návrh asistenta, neověřeno lékařem)
patient-fhir-sec-question = Otázka pro MDT
patient-fhir-sec-summary = Shrnutí
patient-fhir-sec-course = Průběh onemocnění
patient-fhir-sec-conditions = Diagnóza a přidružená onemocnění
patient-fhir-sec-findings = Nálezy
patient-fhir-sec-treatment = Léčba
patient-fhir-sec-medication = Medikace
patient-fhir-sec-drug-flags = Upozornění k lékům
patient-fhir-sec-labs = Laboratoř
patient-fhir-sec-observations = Pozorování asistenta
patient-fhir-sec-notes = Poznámky k podkladům

## The MDT question as plain text (also for the report). A label in brackets says who wrote it.

patient-fhir-q-none = Výslovná otázka neuvedena v dostupné dokumentaci.
# $explicit: "yes" when the referral had its own question that a doctor changed, "no" when the doctor wrote it.
patient-fhir-q-edited = { $explicit ->
        [yes] [upraveno lékařem]
       *[no] [doplněno lékařem]
    }
patient-fhir-q-confirmed = [návrh asistenta, potvrdil(a) { $by }, { $when }]
patient-fhir-q-draft = { $kind ->
        [document_purpose] [otázka podle účelu v dokumentu, návrh asistenta, neověřeno lékařem]
       *[other] [návrh otázky asistentem, neověřeno lékařem]
    }
# One passage a drafted question rests on, quoted verbatim with its page.
patient-fhir-basis = { $role ->
        [purpose] Účel v dokumentu
       *[other] Vychází z
    }: „{ $quote }“ ({ $file }, s. { $page }).
