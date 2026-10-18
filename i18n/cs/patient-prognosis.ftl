# Czech, the Prognóza tab of the patient screen and its two drawers (the source list and the similarity explanation).
# The tab shows study results for similar patient groups that the assistant's search found; it is no individual
# prognosis. Message IDs start with "patient-pg-". Study titles, arms, populations, values, quotes and the server's
# warnings are content and never come from here.

## The tab

patient-pg-title = Prognóza
patient-pg-subtitle = Výsledky studií pro podobné skupiny pacientů · rešerše asistenta
patient-pg-as-of = K datu MDT { $date }
patient-pg-intro = Porovnání výsledků jednotlivých studií. Uvedená procenta popisují studované skupiny; individuální prognózu posuzuje lékař.
patient-pg-no-slot = Pacient nemá termín MDT. Pro vyhledání nejprve vyberte den v kalendáři.
patient-pg-schedule = Naplánovat MDT
patient-pg-loading-profile = Načítání profilu a nastavení…
patient-pg-retry = Zkusit připojení znovu
patient-pg-not-configured = Vyhledávání není nakonfigurováno. Doplňte API klíč a model Astra v serverovém .env.
patient-pg-profile-unavailable = Pro tento případ nejsou k datu MDT dostupné dostatečné strukturované podklady.

## The search profile (the structured facts the search was given)

patient-pg-profile-summary = { $n ->
    [one] Klinický profil pro hledání ({ $n } podklad)
    [few] Klinický profil pro hledání ({ $n } podklady)
    [many] Klinický profil pro hledání ({ $n } podkladu)
   *[other] Klinický profil pro hledání ({ $n } podkladů)
}
patient-pg-profile-note = Původní strukturované syntetické podklady k datu MDT. Neobsahuje jméno, rodné číslo ani místní úpravy textů v prohlížeči.

## Search controls and states

patient-pg-loading-saved = Načítání uložené rešerše…
patient-pg-search-pending = Probíhá rešerše…
patient-pg-show-saved = Zobrazit uloženou rešerši
patient-pg-search = Vyhledat studie · Astra
patient-pg-refresh = Nové vyhledání · 1 požadavek
patient-pg-abbreviations = OS = celkové přežití · PFS = přežití bez progrese · ORR = podíl léčebných odpovědí
patient-pg-busy = Astra vyhledává studie a jejich výsledky. Hledání může trvat několik minut.
patient-pg-saved-stale = Uložená rešerše vychází ze starších podkladů. Pro aktuální profil spusťte nové vyhledání.
# Followed by the time of the search as the server sends it.
patient-pg-found = { $n ->
    [one] Nalezena { $n } populace / rameno ·{" "}
    [few] Nalezeny { $n } populace / ramena ·{" "}
    [many] Nalezeno { $n } populace / ramene ·{" "}
   *[other] Nalezeno { $n } populací / ramen ·{" "}
}
patient-pg-found-saved = {" "}· uložená rešerše
patient-pg-found-cached = {" "}· z mezipaměti

## Errors the client raises itself (the prognosis server is a separate local server)

patient-pg-error-no-server = Vyhledávání vyžaduje spuštěný lokální server Prognózy (python3 mocks/serve.py).
patient-pg-error-timeout = Vypršel časový limit. Další vyhledávání se nespustí automaticky.
patient-pg-error-request-failed = Požadavek se nepodařilo dokončit.

## The study table

patient-pg-table-label = Studie a prognostické ukazatele
patient-pg-col-study = Studie / zdroj
patient-pg-col-population = Populace a léčba
patient-pg-col-similarity = Podobnost pacienta
patient-pg-col-model = Našel model
# The short two-line headers of the OS columns; the full name is the column's accessible name.
patient-pg-col-os-6 = 6 měs.
patient-pg-col-os-12 = 12 měs.
patient-pg-col-os-36 = 3 roky
patient-pg-col-os-60 = 5 let
patient-pg-col-os = OS
patient-pg-ep-os-6 = 6měsíční OS
patient-pg-ep-os-12 = 12měsíční OS
patient-pg-ep-os-36 = 3leté OS
patient-pg-ep-os-60 = 5leté OS
patient-pg-ep-pfs = Medián PFS
patient-pg-ep-response = Odpověď a trvání odpovědi
patient-pg-ep-toxicity = Závažná toxicita a ukončení léčby
patient-pg-ep-burden = Zátěž léčby
patient-pg-empty-pending = Čekáme na výsledky Astry.
patient-pg-empty-no-rows = Astra nevrátila použitelné výsledky. Zkontrolujte stav rešerše a zdroje.
patient-pg-empty-start = Studie se zobrazí po spuštění vyhledávání.
patient-pg-footnotes-label = Poznámky k rešerši
patient-pg-footnote = Každý řádek zachovává populaci, léčbu a počátek sledování zdroje. Chybějící hodnoty se nedopočítávají. Rešerše nezaručuje úplnost dostupné literatury. Podobnost je orientační shoda populace, nikoli pravděpodobnost přežití. Extrahované údaje vyžadují kontrolu ve zdroji.

## A study row

patient-pg-untitled = Zdroj bez názvu
patient-pg-link-pubmed = PubMed { $id }
patient-pg-link-doi = DOI { $id }
patient-pg-verify = Extrakce modelu · ověřit
patient-pg-sample-size = n = { $n }
patient-pg-time-origin = Počátek sledování:{" "}
patient-pg-unit-months = měsíců
patient-pg-name-orr = ORR
patient-pg-name-dor-median = Medián trvání odpovědi
patient-pg-name-grade3 = Stupeň ≥3
patient-pg-name-discontinuation = Ukončení pro toxicitu
patient-pg-name-conflict-dor = Trvání odpovědi
patient-pg-name-conflict-grade3 = Toxicita stupně ≥3
patient-pg-conflicts = Rozdílné extrahované hodnoty ({ $n })
patient-pg-conflicts-note = Sporné hodnoty se nezobrazují v hlavní buňce. Ověřte populaci, rameno a analýzu.

## Similarity (an orientation score of the population match, not a survival probability)

patient-pg-percent = { $v } %
patient-pg-sim-label = Orientační shoda populace
patient-pg-sim-coverage = Pokrytí { $v } % váhy údajů
patient-pg-sim-critical = Zásadní rozdíl: { $list }
patient-pg-sim-explain = Vysvětlení podobnosti
patient-pg-sim-variants = Odlišná posouzení shody
patient-pg-dim-histology = Histologie
patient-pg-dim-stage = Stádium
patient-pg-dim-biomarkers = Biomarkery
patient-pg-dim-treatment-line = Linie léčby
patient-pg-dim-prior-treatment = Předchozí léčba
patient-pg-dim-performance-status = Výkonnostní stav
patient-pg-dim-brain-metastases = Mozkové metastázy
patient-pg-dim-age = Věk
patient-pg-status-match = shoda
patient-pg-status-mismatch = neshoda
patient-pg-status-unknown = nezjištěno
patient-pg-status-partial = částečná shoda

## The similarity drawer

patient-pg-panel-label = Prognóza · Vysvětlení podobnosti
patient-pg-panel-sub = Orientační shoda { $v } %
patient-pg-panel-disclaimer = Skóre shody se studovanou populací. Nejde o pravděpodobnost přežití ani validovaný prognostický model.
patient-pg-panel-coverage = Pokrytí známými údaji: { $v } % celkové váhy
patient-pg-panel-patient = Pacient:{" "}
patient-pg-panel-study = Studie:{" "}
patient-pg-panel-critical = Zásadní rozdíly: { $list }

## The source list drawer

patient-pg-refs-label = Zdroje prognózy
patient-pg-refs-title = Zdroje ({ $n })
patient-pg-refs-no-quote = Pasáž nebyla dodána.
patient-pg-close = Zavřít
