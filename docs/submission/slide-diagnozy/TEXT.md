# Slide 06: GLIDE MDT nekončí u jedné diagnózy

Replaces the hospital cards with diagnoses. Preview: `preview.png` (source `preview.html`).

**Nadpis:** GLIDE MDT nekončí u jedné diagnózy

| Ikona | Štítek vpravo nahoře (MKN-10) | Název | Podtitul |
|---|---|---|---|
| `mozek` | C71 · NYNÍ | Nádory mozku | IDH, MGMT a nálezy MR v čase |
| `prs` | C50 | Karcinom prsu | ER, PR, HER2, Ki-67 a stadium TNM |
| `prostata` | C61 | Karcinom prostaty | PSA v čase, Gleason / ISUP a staging |
| `kolorektum` | C18–C20 | Kolorektální karcinom | CEA v čase, MMR / MSI, RAS a BRAF |
| `plice` | C34 | Karcinom plic | PD-L1, EGFR, ALK a stadium TNM |
| `ledviny` | C64 | Karcinom ledviny | Histologický typ, ISUP grade a IMDC |

The subtitle names the data each MDT works with for that diagnosis, which the assistant tracks over time and
links to its source. "NYNÍ" marks where GLIDE MDT starts (neuro-oncology in Ostrava); drop it if not wanted.

Spare icons for other diagnoses: `srdce` (srdce), `pankreas` (C25, karcinom pankreatu),
`mocovy-mechyr` (C67, karcinom močového měchýře), `zaludek` (C16, karcinom žaludku).

## Icons

- `svg/*.svg` (vector, teal #007f78) and `png/*.png` (256 px, transparent).
- From [Healthicons](https://healthicons.org) (outline, body), MIT licence; colour changed to GLIDE teal.
