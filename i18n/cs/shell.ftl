# Czech, the source catalog (docs/design/I18N.md). Message IDs are semantic, never the Czech text.
# The catalog holds interface text only: no patient names or examples, synthetic or not.

## App shell: header and navigation

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
# A role holder shown with their function: the name, then the function in brackets.
user-picker-with-function = { $name } ({ $fn })
user-coordinator-function-default = koordinátorka MDT
# The coordinator's tooltip when the staff list names no function (it is worded differently from the label).
user-coordinator-tooltip-default = koordinace MDT
user-admin-function = správce systému

## Account menu (with a login, in place of the user picker; docs/design/AUTH.md)

account-button-aria = Účet: { $name }
account-menu = Účet
account-role-doctor = lékař
account-role-coordinator = koordinátor
account-role-admin = správce systému
# After a role switch in a demo org: who is really logged in.
account-logged-in-as = Přihlášen(a): { $name }
account-switch-org = Přepnout organizaci
account-switch-role = Přepnout roli
account-switch-role-help = Jen v ukázkové organizaci. Záznam přístupů uvádí vás i roli, za kterou jednáte.
# A role-switch entry: the person, then the role.
account-role-entry = { $name } ({ $role })
account-logout = Odhlásit

## Lost login while something is unsaved

session-expired-title = Přihlášení vypršelo
session-expired-body = Neuložené změny zůstaly na této stránce. Přihlaste se v novém okně a pak klikněte na „Zkusit znovu“; změny se uloží.
session-expired-login = Přihlásit se v novém okně
session-expired-retry = Zkusit znovu
session-expired-checking = Ověřuji přihlášení…
session-expired-still = Přihlášení se zatím neobnovilo.
session-expired-other = V novém okně se přihlásil jiný uživatel nebo jiná role. Neuložené změny pod ním uložit nelze.
session-expired-reload = Načíst stránku znovu

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
case-data-bad-shape = Server vrátil data případu v neznámém tvaru.

## Development only (shown with ?dev in the address)

dev-patient-count = { $n ->
    [one] { $n } pacient ze serveru
    [few] { $n } pacienti ze serveru
    [many] { $n } pacienta ze serveru
   *[other] { $n } pacientů ze serveru
}
