# English, translated from the Czech source catalog (i18n/cs/, docs/design/I18N.md). Message IDs are the same as in Czech.
# The catalog holds interface text only: no patient names or examples, synthetic or not. A message missing here falls
# back to Czech.
#
## Glossary (Czech -> English), for clinician review; the other en files use the same terms
# Databáze pacientů -> Patient database
# Kalendář MDT -> MDT calendar
# Moje úlohy -> My tasks
# Personál -> Staff
# Administrace -> Administration
# koordinátorka MDT -> MDT coordinator
# správce systému -> system administrator

## App shell: header and navigation

brand-logo-alt = GLIDE
brand-mark = MDT
brand-button-title = Patient database
brand-button-label = GLIDE MDT, open the patient database
nav-label = Main areas
nav-patients = Patient database
nav-calendar = MDT calendar
nav-tasks = My tasks
nav-staff = Staff
nav-admin = Administration

## User picker (demo mode has no login; the user is picked by hand)

user-picker-label = User:
user-picker-aria = Current user (demo without login)
user-picker-other-roles = Other roles
# A role holder shown with their function: the name, then the function in brackets.
user-picker-with-function = { $name } ({ $fn })
user-coordinator-function-default = MDT coordinator
# The coordinator's tooltip when the staff list names no function (it is worded differently from the label).
user-coordinator-tooltip-default = MDT coordination
user-admin-function = system administrator

## Account menu (with a login, in place of the user picker; docs/design/AUTH.md)

account-button-aria = Account: { $name }
account-menu = Account
account-role-doctor = doctor
account-role-coordinator = coordinator
account-role-admin = system administrator
account-logged-in-as = Signed in: { $name }
account-switch-org = Switch organization
account-switch-role = Switch role
account-switch-role-help = Demo organizations only. The access log records you and the role you act in.
account-role-entry = { $name } ({ $role })
account-logout = Sign out

## Lost login while something is unsaved

session-expired-title = Your sign-in has expired
session-expired-body = Your unsaved changes are still on this page. Sign in in a new window, then click "Try again"; the changes will be stored.
session-expired-login = Sign in in a new window
session-expired-retry = Try again
session-expired-checking = Checking the sign-in…
session-expired-still = You are not signed in again yet.
session-expired-other = Another user or role signed in in the new window. Your unsaved changes cannot be stored under them.
session-expired-reload = Reload the page

## Startup

app-loading = Loading…
boot-failed = Could not load the data: { $reason }

## Errors the API client raises itself (an answer from the API brings its own Czech message)

api-error-no-api = The server is not responding.
api-error-timeout = The server did not respond in time.
api-error-network = The server is not responding. Please try again.
api-error-request-failed = The request could not be completed.
api-error-write-no-api = The server did not send a valid response. Please try again.
api-error-write-timeout = The server did not respond in time. Please try again.
api-error-write-network = The server is not responding. Check your connection and try again.
api-error-write-failed = The change could not be saved.
data-reset-reload = The demo data were reset; the page will reload.
session-changed-reload = The sign-in changed (another user or role in another window); the page will reload.
user-switch-unknown = This user is not in the server's list.
case-data-bad-shape = The server sent case data in an unknown shape.

## Development only (shown with ?dev in the address)

dev-patient-count = { $n ->
    [one] { $n } patient from the server
   *[other] { $n } patients from the server
}
