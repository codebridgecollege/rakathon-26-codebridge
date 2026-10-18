# Slovak, translated from the Czech source catalog (i18n/cs/, docs/design/I18N.md). Message IDs are the same as in Czech.
# The catalog holds interface text only: no patient names or examples, synthetic or not. A message missing here falls
# back to Czech.
#
## Glossary (Czech -> Slovak), for clinician review; the other sk files use the same terms
# Databáze pacientů -> Databáza pacientov
# Kalendář MDT -> Kalendár MDT
# Moje úlohy -> Moje úlohy
# Personál -> Personál
# Administrace -> Administrácia
# koordinátorka MDT -> koordinátorka MDT
# správce systému -> správca systému
# server neodpovídá -> server neodpovedá

## App shell: header and navigation

brand-logo-alt = GLIDE
brand-mark = MDT
brand-button-title = Databáza pacientov
brand-button-label = GLIDE MDT, otvoriť databázu pacientov
nav-label = Hlavné oblasti
nav-patients = Databáza pacientov
nav-calendar = Kalendár MDT
nav-tasks = Moje úlohy
nav-staff = Personál
nav-admin = Administrácia

## User picker (the demo has no login; the user is picked by hand)

user-picker-label = Používateľ:
user-picker-aria = Aktuálny používateľ (ukážka bez prihlásenia)
user-picker-other-roles = Ďalšie roly
# A role holder shown with their function: the name, then the function in brackets.
user-picker-with-function = { $name } ({ $fn })
user-coordinator-function-default = koordinátorka MDT
# The coordinator's tooltip when the staff list names no function (the old page words it differently from the label).
user-coordinator-tooltip-default = koordinácia MDT
user-admin-function = správca systému

## Startup

app-loading = Načítavam…
boot-failed = Údaje sa nepodarilo načítať: { $reason }

## Errors the API client raises itself (an answer from the API brings its own Czech message)

api-error-no-api = Server neodpovedá.
api-error-timeout = Server neodpovedal včas.
api-error-network = Server neodpovedá. Skúste to znova.
api-error-request-failed = Požiadavku sa nepodarilo dokončiť.
api-error-write-no-api = Server nevrátil platnú odpoveď. Skúste to znova.
api-error-write-timeout = Server neodpovedal včas. Skúste to znova.
api-error-write-network = Server neodpovedá. Skontrolujte pripojenie a skúste to znova.
api-error-write-failed = Zmenu sa nepodarilo uložiť.
data-reset-reload = Ukážkové údaje boli obnovené, stránka sa znova načíta.
user-switch-unknown = Tento používateľ nie je v zozname na serveri.
case-data-bad-shape = Server vrátil údaje prípadu v neznámom tvare.

## Development only (shown with ?dev in the address)

dev-patient-count = { $n ->
    [one] { $n } pacient zo servera
    [few] { $n } pacienti zo servera
    [many] { $n } pacienta zo servera
   *[other] { $n } pacientov zo servera
}
