# Czech, the source catalog (docs/design/I18N.md). Message IDs are semantic, never the Czech text.
# The pages the Worker serves itself during the login (api/src/auth/pages.ts, docs/design/AUTH.md): no access, a
# failed login, the login service unreachable, and the end of a login in a second window. No patient data.

## Login pages of the Worker

auth-page-app = GLIDE MDT
auth-no-access-title = Nemáte přístup
auth-no-access-body = Přihlášení proběhlo, ale tento účet nemá v GLIDE MDT aktivní členství v žádné organizaci. O přístup požádejte správce své organizace.
auth-no-access-other = Přihlásit jiným účtem
auth-failed-title = Přihlášení se nepodařilo
auth-failed-body = Přihlášení se nedokončilo, například proto, že vypršelo nebo bylo otevřeno dvakrát. Nic se neuložilo.
auth-unavailable-title = Přihlašovací služba je nedostupná
auth-unavailable-body = Přihlašovací službu se teď nepodařilo zastihnout. Zkuste to prosím za chvíli.
auth-misconfigured-title = Přihlášení není nastavené
auth-misconfigured-body = Přihlášení není na tomto serveru správně nastavené. Obraťte se na správce aplikace.
auth-retry = Zkusit znovu
auth-done-title = Přihlášení obnoveno
auth-done-body = Toto okno můžete zavřít. V původním okně klikněte na „Zkusit znovu“ a neuložené změny se uloží.
