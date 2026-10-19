# S03 ground truth: what the scan says and what OCR read

S03 is a synthetic poor scan (Bořivoj Klenovský, fictional; lung
adenocarcinoma, MDT question lobectomy versus stereotactic radiotherapy).
The Markdown files in this folder are the truth. `S03_pacient.clean.pdf` is
their clean print, and `S03_pacient.pdf` is the same print turned into a
poor scan by `scripts/degrade_scan.py` with the defects in `damage.json`.

"Text of record" below is Tesseract 5.5.3 (`ces`, page segmentation mode 4)
on the scan, as the page reader reads it (`p<n>.tess.txt`). "Text layer" is
the scan's own invisible OCR layer (Tesseract in mode 3, as scanner software
adds one; `p<n>.layer.txt`). Both are in
`samples/derived/pages/S03_pacient/`, next to `p<n>.truth.md`, the page
text we wrote.

## Planted defects

| ID | Page | Truth | Text of record | Text layer | What goes wrong |
|---|---|---|---|---|---|
| D1 | 1 | `Bisoprolol 1,25 mg 1-0-0` | `Bisoprolol 4,25 mg 1- 0-0` | `Bisoprolol 4,25 mg 1-0-0` | A dose read as four times the real one. Aimed at an l/1 swap; Tesseract made it a 4. |
| D2 | 2 | `Metastatické postižení jater neprokázáno.` | `Metastatické postižení. jater prokázáno.` | `prokázáno.` (line split) | A negated finding read as positive: "liver metastases proven". |
| D3, D4 | 3 | `Odběr: 21.9.2026 07:40` | `Odběr: 21 9 2026'07:40` | `Odběr: 21 9 2026'07:40` | The draw date loses both dots and no longer parses as a date. |
| D5 | 3 | `S_K: 5,8 mmol/l [3.5 ... 5.1]` | `S K: 5,3.mmoll [3.5 ... 5.1]` | `S K: 5,3.mmol/l [3.5 .. 5.1)` | Potassium 5,8 read as 5,3: still above the range, but milder than stated. |

Both readings agree on D1, D2 and D5. Comparing the two readings, which is
how the page reader marks "ověřit" today, therefore cannot catch them: a
shared misread looks like a confirmed value. What can catch them is the
page's readability, a vision reading of the image, or the report on page 1,
which quotes "K 5,8 mmol/l" from the lab sheet.

## Misreads the wear made on its own

Not planted, but in the committed OCR, and part of what the evaluation sees:

- Page 1: `cN0 cM0` reads `cNŮ cMO`; `dg. 9/2026 -` reads `bon *`;
  `FEV1 1,41 l (52 % n. h.),` reads `FEV1 1,41 | (52 k n. h. 4`.
- Page 2: `cN0` reads `cNO`.
- Page 3: `poj. 211` reads `poj, Ž1`; the sample's received and issued
  dates read `P 9, 2026` and `2 9. 2026`; `S_CREAE` reads `S.GREAE` and
  its range `[59 ... 104]` reads `[59... 04)`; the `S_NA` line is broken
  (`[136"... KE C eo pa oje ie`); `S_CEA ... [0 ... 5]` reads `[0.51`;
  B_PLT's unit `10^9/l` reads `10790`.

## What the assistant must do with this scan

- Page 3 (and so the lab sheet) is poorly readable: warn and ask for a
  better copy. Page 1 is also judged poor by the current rules (16 % of its
  words below confidence 60).
- Never show potassium as a clear 5,3; never show the bisoprolol dose as a
  clear 4,25 mg; never show liver metastases as proven.
- The draw date of the lab sheet is unreadable: show the lab values without
  a date and with "ověřit", never with a date guessed from the report.
- Values on page 3 that cannot be read are listed as unreadable, never
  dropped and never filled in.

The machine-readable form of these expectations is
`samples/expected/S03.json`; `pipeline/eval.py` checks them.

## Regenerating

```sh
SAMPLE_FONTS=<folder with Liberation Sans 2.1.5> \
  uv run scripts/render_samples.py samples/S03_pacient --pages samples/derived/pages \
    --out samples/S03_pacient/S03_pacient.clean.pdf
uv run scripts/degrade_scan.py samples/S03_pacient/S03_pacient.clean.pdf \
  --damage samples/S03_pacient/damage.json --out samples/S03_pacient/S03_pacient.pdf \
  --truth-pages samples/derived/pages/S03_pacient
uv run scripts/ocr_pages.py samples/S03_pacient/S03_pacient.pdf --out samples/derived/pages
```

The wear is seeded, so the images repeat on the same Pillow and NumPy. The
OCR depends on the local Tesseract version: another version may misread
other characters, so check the table above against the new
`p<n>.tess.txt` before committing, and update it.
