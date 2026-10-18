# Czech, the source catalog (docs/design/I18N.md). Message IDs are semantic, never the Czech text.
# The catalog holds interface text only: no patient names or examples, synthetic or not.

## App shell: header and navigation

app-title = GLIDE MDT
brand-logo-alt = GLIDE
brand-mark = MDT
brand-button-title = Databáze pacientů
brand-button-label = GLIDE MDT, otevřít databázi pacientů
nav-label = Hlavní oblasti
nav-patients = Databáze pacientů
nav-calendar = Kalendář MDT
nav-tasks = Moje úlohy
nav-staff = Personál
nav-admin = Administrace

## User picker (the demo has no login; the user is picked by hand)

user-picker-label = Uživatel:
user-picker-aria = Aktuální uživatel (maketa bez přihlášení)
user-picker-other-roles = Další role
# A role holder shown with their function, for example "Bc. Marková (koordinátorka MDT)".
user-picker-with-function = { $name } ({ $fn })
user-coordinator-function-default = koordinátorka MDT
user-admin-function = správce systému

## Startup

app-loading = Načítám…
boot-failed = Data se nepodařilo načíst: { $reason }

## Errors the API client raises itself (an answer from the API brings its own Czech message)

api-error-no-api = Server neodpovídá.
api-error-timeout = Server neodpověděl včas.
api-error-network = Server neodpovídá. Zkuste to znovu.
api-error-request-failed = Požadavek se nepodařilo dokončit.
api-error-write-no-api = Server neodpověděl platnou odpovědí. Zkuste to znovu.
api-error-write-timeout = Server neodpověděl včas. Zkuste to znovu.
api-error-write-network = Server neodpovídá. Zkontrolujte připojení a zkuste to znovu.
api-error-write-failed = Změnu se nepodařilo uložit.
data-reset-reload = Ukázková data byla obnovena, stránka se znovu načte.
user-switch-unknown = Tento uživatel není v seznamu na serveru.

## Development only (shown with ?dev in the address)

dev-patient-count = { $n ->
    [one] { $n } pacient ze serveru
    [few] { $n } pacienti ze serveru
    [many] { $n } pacienta ze serveru
   *[other] { $n } pacientů ze serveru
}
