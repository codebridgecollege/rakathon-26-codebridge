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
# The coordinator's tooltip when the staff list names no function (it is worded differently from the label).
user-coordinator-tooltip-default = koordinácia MDT
user-admin-function = správca systému

## Account menu (with a login, in place of the user picker; docs/design/AUTH.md)

account-button-aria = Účet: { $name }
account-menu = Účet
account-role-doctor = lekár
account-role-coordinator = koordinátor
account-role-admin = správca systému
account-logged-in-as = Prihlásený(á): { $name }
account-switch-org = Prepnúť organizáciu
account-switch-role = Prepnúť rolu
account-switch-role-help = Len v ukážkovej organizácii. Záznam prístupov uvádza vás aj rolu, za ktorú konáte.
account-role-entry = { $name } ({ $role })
account-logout = Odhlásiť

## Lost login while something is unsaved

session-expired-title = Prihlásenie vypršalo
session-expired-body = Neuložené zmeny zostali na tejto stránke. Prihláste sa v novom okne a potom kliknite na „Skúsiť znova“; zmeny sa uložia.
session-expired-login = Prihlásiť sa v novom okne
session-expired-retry = Skúsiť znova
session-expired-checking = Overujem prihlásenie…
session-expired-still = Prihlásenie sa zatiaľ neobnovilo.
session-expired-other = V novom okne sa prihlásil iný používateľ alebo iná rola. Neuložené zmeny pod ním uložiť nemožno.
session-expired-reload = Načítať stránku znova

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
session-changed-reload = Prihlásenie sa v inom okne zmenilo, stránka sa znova načíta.
user-switch-unknown = Tento používateľ nie je v zozname na serveri.
case-data-bad-shape = Server vrátil údaje prípadu v neznámom tvare.

## Development only (shown with ?dev in the address)

dev-patient-count = { $n ->
    [one] { $n } pacient zo servera
    [few] { $n } pacienti zo servera
    [many] { $n } pacienta zo servera
   *[other] { $n } pacientov zo servera
}
