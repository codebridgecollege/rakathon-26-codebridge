# Czech, three tabs of the patient detail screen (S-3): Dokumenty (documents), Anamnéza (anamnesis) and Laboratoř
# (labs). Interface text only: document titles, quotes, lab names, values, units, ranges and codes are content and
# never come from here. Shared wording (gap, sources, certainty tags) is in patient.ftl.

## Anamnéza

patient-anam-title = Anamnéza
patient-anam-section = { $key ->
    [OA] Osobní anamnéza
    [RA] Rodinná anamnéza
    [PA] Pracovní anamnéza
    [SA] Sociální anamnéza
    [FA] Farmakologická anamnéza
    [AA] Alergologická anamnéza
    [abusus] Abúzus
    [EA] Epidemiologická anamnéza
   *[preventive] Preventivní vyšetření
}
# The chip in front of a drug warning (an interaction or contraindication the documents state).
patient-anam-warning = Pozor
patient-anam-pack-years = Balíčkoroky:{" "}
# The icon legend under the card; each label follows its icon.
patient-anam-legend-label = Ikony:
patient-anam-legend-ocr = { -trust-verify-reading }
patient-anam-legend-planned = plánováno
patient-anam-legend-conflict = rozpor mezi dokumenty
patient-anam-legend-observation = { -trust-observation }
patient-anam-legend-tail = Podrobnost ukáže najetí myší. Léky slouží pro informaci; při příjmu se kontrolují.

## Dokumenty

patient-docs-title = Dokumenty ({ $n })
patient-docs-title-filtered = Dokumenty ({ $shown } z { $n })
patient-docs-source = Zdroj:{" "}
patient-docs-source-uploaded = { $n ->
    [one] { $n } nahrané PDF
    [few] { $n } nahraná PDF
    [many] { $n } nahraného PDF
   *[other] { $n } nahraných PDF
}
patient-docs-source-pages = { $n ->
    [one] , { $n } strana
    [few] , { $n } strany
    [many] , { $n } strany
   *[other] , { $n } stran
}
# The page count of the documentation is not known: a gap dash sits between these two.
patient-docs-source-pages-none = ,{" "}
patient-docs-source-pages-none-unit = {" "}stran
patient-docs-upload = + Nahrát dokument
patient-docs-missing-originals = Chybí originály
patient-docs-search = Hledat v dokumentech
patient-docs-clear-filters = Zrušit filtry ({ $n })
patient-docs-col-document = Dokument
patient-docs-col-type = Typ
patient-docs-col-date = Datum
patient-docs-col-pages = Strany
patient-docs-col-readability = Čitelnost
patient-docs-col-year = Rok
patient-docs-year-none = bez data
patient-docs-readability = { $code ->
    [good] Dobře čitelné
    [fair] Částečně čitelné
   *[poor] Špatně čitelné
}
# After a document the PDF only cites ("citováno v ambulantní zprávě"): its original is not in the documentation.
patient-docs-original-missing = , originál chybí
patient-docs-open = Otevřít
patient-docs-none-match = Žádný dokument neodpovídá filtru.
patient-docs-readability-hint = Důvod hodnocení čitelnosti ukáže najetí myší na štítek.

## Column filter (Excel-style list of a column's values)

patient-docs-filter-label = Filtr { $title }
patient-docs-filter-all = (Vše)
patient-docs-filter-done = Hotovo

## Reading a document without AI (the pipeline panel; the result is the assistant's reading, never the case data)

patient-docs-pipe-run = Přečíst bez AI
patient-docs-pipe-rerun = Přečíst znovu bez AI
patient-docs-pipe-busy = Čtu…
patient-docs-pipe-failed = Čtení selhalo ({ $code ->
    [start_failed] nespustilo se
    [stalled] nedokončilo se
    [encrypted] PDF je zašifrované
    [not_pdf] soubor není čitelné PDF
    [unreadable_pdf] soubor není čitelné PDF
    [too_many_pages] příliš mnoho stran
    [page_too_large] stránka je příliš velká
    [pipeline_off] zpracování není zapnuté
    [pagekit_unreachable] služba neodpovídá
   *[other] chyba služby
}).
patient-docs-pipe-reading = Čte se (
patient-docs-pipe-queued = ve frontě
patient-docs-pipe-reading-end = )…
patient-docs-pipe-readability = :{" "}čitelnost{" "}
patient-docs-pipe-verify = { $n ->
    [one] , { $n } místo k ověření
    [few] , { $n } místa k ověření
    [many] , { $n } místa k ověření
   *[other] , { $n } míst k ověření
}
# A missing count from the server is a gap dash between the parts, never an assumed 0.
patient-docs-pipe-labs = , laboratorní hodnoty { $n } (k ověření{" "}
patient-docs-pipe-labs-end = )
patient-docs-pipe-diff = ; proti předem připraveným datům{" "}
patient-docs-pipe-diff-same = {" "}shodných,{" "}
patient-docs-pipe-diff-verify = {" "}k ověření
patient-docs-pipe-diff-silent = { $n } jinak bez označení
patient-docs-pipe-diff-missing = { $n } nenalezeno

## Laboratoř

patient-labs-title-values = Laboratoř · Hodnoty z dokumentu
patient-labs-title-trend = Laboratoř · Vývoj v čase
patient-labs-draws = { $n ->
    [one] { $n } odběr z dokumentace
    [few] { $n } odběry z dokumentace
    [many] { $n } odběru z dokumentace
   *[other] { $n } odběrů z dokumentace
}
patient-labs-trend-hint = Klik na hodnotu otevře její řádek ve zdroji, klik na datum laboratorní list.
patient-labs-col-test = Parametr
patient-labs-col-value = Hodnota
patient-labs-col-unit = Jednotka
patient-labs-col-range-short = Ref. mez
patient-labs-col-range = Referenční mez
patient-labs-col-date = Datum odběru
patient-labs-col-source = Zdroj
# Tooltip of a value or draw date: the quoted line it rests on.
patient-labs-src-tip = Zdroj: „{ $quote }“
patient-labs-value-label = { $name } { $date }: { $value } { $unit }, otevřít zdroj
patient-labs-pick-hint = Klikněte na řádek parametru · zelené pásmo = referenční mez
patient-labs-chart-label = Vývoj v čase, { $name }
patient-labs-chart-range = ref. { $range }
patient-labs-chart-needs-two = Pro graf jsou potřeba alespoň dvě hodnoty.
patient-labs-sources = Zdroje
# The source button of a value row, with a plain space as the old table printed it.
patient-labs-row-source = s. { $page }
patient-labs-all-values = Pro všechny hodnoty:{" "}
patient-labs-head-date = Datum odběru:{" "}
patient-labs-head-source = Zdroj:{" "}
patient-labs-head-source-page = , s.{" "}{ $page }
patient-labs-head-click-name = . Klik na název parametru otevře jeho řádek ve zdroji.
patient-labs-no-trend = Vývoj v čase se ukazuje jen tam, kde dokumentace obsahuje alespoň dva datované odběry; zde je jedna sada bez data odběru.
