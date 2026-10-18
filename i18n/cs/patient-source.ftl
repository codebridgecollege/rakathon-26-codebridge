# Czech, the source viewer drawer (F-18 in docs/design/PRODUCT.md): the original page image with the quoted passage,
# the page switcher, zoom, the page transcription and the local redaction demo. Interface text only: document titles,
# file names, case IDs, quotes, the transcription, Tesseract's readings and redaction reasons are content from the
# data and never come from here.

## Drawer

patient-src-dialog = Původní dokument
patient-src-loading-dialog = Zdrojový dokument
patient-src-loading-label = Zdroj
patient-src-loading = Načítám stránku…
patient-src-close = Zavřít
patient-src-kind = Původní dokument · obrázek stránky
patient-src-page-of = strana { $n } z { $of }
# $quote is a slot: the quote is content and sits in its own element.
patient-src-sought = Hledaná citace (s. { $page }): „{ $quote }“
# The page switcher's button; a plain space, as the old viewer had (patient-src-page keeps a no-break space).
patient-src-page-button = s. { $n }
patient-src-page-empty = {" "}(prázdná)
patient-src-page-empty-tooltip = prázdná stránka

## View switch and toolbar

patient-src-tabs = Zobrazení
patient-src-tab-image = Stránka
patient-src-tab-text = Přepis stránky
patient-src-redact = Cenzurovat (demo)
patient-src-zoom-hit = Přiblížit na citaci
patient-src-verify-count = { $n ->
    [one] { $n } místo k ověření
    [few] { $n } místa k ověření
    [many] { $n } místa k ověření
   *[other] { $n } míst k ověření
}
patient-src-engine-vision = Přepis: jazykový model, kontrola: Tesseract
patient-src-engine-tesseract = Přepis: Tesseract
patient-src-engine-conf = { $engine }, průměrná jistota Tesseractu { $conf } %

## How the quote was found

patient-src-note-not-found = Citace nenalezena přesně, zobrazena celá stránka.
patient-src-note-text-only = Na obrázku citaci nelze vyznačit; v přepisu stránky vyznačena je.
patient-src-note-image-only = V přepisu citaci nelze vyznačit; na obrázku stránky vyznačena je.
patient-src-note-spread = Všechna slova citace nalezena, ale mezi nimi stojí další slova.
patient-src-note-approx = Citace nalezena přibližně (shoda { $pct } %): původní citace pochází ze staršího převodu textu s chybami čtení.
patient-src-note-repeated = Citace je na stránce víckrát; zvýrazněn první výskyt.
patient-src-note-similar = Podobná pasáž je na stránce víckrát; zvýrazněna nejlepší shoda, ověřte.

## Page body

patient-src-empty-page = Prázdná stránka: na stránce není žádný text.
patient-src-img-alt = Strana { $n } dokumentu { $file }
patient-src-img-alt-redacted = Strana { $n } po začernění identifikátorů
patient-src-img-failed = Obrázek stránky se nepodařilo načíst. Přepis je v záložce „Přepis stránky“.
patient-src-legend-text = Tečkovaně: číslo, datum nebo stadium, které Tesseract přečetl jinak, s nízkou jistotou, nebo vůbec (četl jen jazykový model). Neoznačený text není ověřený; rozhoduje obrázek stránky.
patient-src-legend-image = Žlutě: citovaná pasáž. Čárkovaně: Tečkovaně: číslo, datum nebo stadium, které Tesseract přečetl jinak, s nízkou jistotou, nebo vůbec (četl jen jazykový model). Neoznačený text není ověřený; rozhoduje obrázek stránky. Místa, která četl jen jazykový model, jsou podtržená v přepisu.
patient-src-unreadable = Nečitelné znaky ({ $n })
patient-src-transcriber-note = Poznámka přepisu, není tištěný text

# A dashed box on the image: why to check the token, then what the transcription has there ($reading is content).
patient-src-vbox = { $why }; přepis: { $reading }

## Why a token is marked "ověřit" ($tess and $layer are the engines' readings, content from the data)

patient-src-verify-only-vision = Četl jen jazykový model; Tesseract zde nic nepřečetl, ověřit
patient-src-verify-tess = Tesseract četl: { $tess }, ověřit
patient-src-verify-tess-low = Tesseract četl: { $tess } (jistota { $conf } %), ověřit
patient-src-verify-only-tesseract = Textová vrstva PDF zde nic nemá, ověřit
patient-src-verify-only-layer = Jen textová vrstva PDF: { $layer }, ověřit
patient-src-verify-layer-low = Tesseract si není jistý (jistota { $conf } %), ověřit
patient-src-verify-layer = Textová vrstva PDF: { $layer }, ověřit

## Local redaction demo (docs/design/DATA-PROTECTION.md)

patient-src-redact-intro = Ukázka místního začernění: takto by stránka odešla do cloudového jazykového modelu.
# $reasons is a slot: the reasons are content and sit in their own element.
patient-src-redact-count = Začerněno { $n ->
    [one] { $n } místo
    [few] { $n } místa
    [many] { $n } místa
   *[other] { $n } míst
} ({ $reasons }) přímo na serveru nemocnice.
patient-src-redact-none = Na této stránce kontrola nic nenašla; kontrola je neúplná, stránku před odesláním zkontrolujte.
patient-src-redact-outro = Data, diagnózy a nálezy zůstávají, proto je stránka stále osobní údaj.

## Zoom

patient-src-zoom = Zvětšení stránky
patient-src-zoom-out = Oddálit
patient-src-zoom-out-tooltip = Oddálit (−)
patient-src-zoom-in = Přiblížit
patient-src-zoom-in-tooltip = Přiblížit (+)
patient-src-zoom-reset = Obnovit zvětšení
patient-src-zoom-reset-tooltip = Obnovit: na šířku (0)
patient-src-zoom-fit = Na šířku
patient-src-zoom-pct = { $z } %
