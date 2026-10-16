# OCR evaluation on FNO's patient PDFs (2026-10-16)

Question: how should the app read uploaded PDFs, given that the text we
first extracted from FNO's documents looked broken in the source view?
Tested on `data/rakathon-26/2_AI asistent MDT/10_pacient.pdf`, pages 1 and
4 (page 4 has the garbled header and the iRECIST table, which lists tumour
measurements against a baseline).

## How FNO's PDFs are built

- Most pages hold an embedded image that is a **faded background**, not a
  readable scan: the vision model could not read a single word from it.
  The readable page is **text drawn on top in fonts** (Arial, Tahoma,
  Courier New, Calibri). Five files name PDF24 as the producer. The
  documents look edited for anonymization: scan faded out, text placed
  over it.
- Some fonts have a **broken character map**: the glyphs render correctly,
  but text extraction returns other characters. Page 4's header renders
  as "Ambulantní vyšetření kontrolní" but extracts as "Ambulantnf
  vyletfenf kontrolnf" (font Tahoma-Bold). Page 1's header (Arial)
  extracts correctly.
- `20_pacient.pdf` is a clean digital document (no image). Page 3 of
  patient 10 has no image either. Page 4 of `9_pacient.pdf` is empty.
- Page images are about 1215 x 1725 px (about 150 dpi for A4).

So "OCR the embedded image" does not work for this data. What works is
**rendering the full page** (as a viewer shows it) and reading that.

## Engines compared

1. **PDF text layer**: `pypdf` `extract_text()`, which the mocks used so far.
2. **Tesseract 5** (Homebrew), Czech model `ces`, page segmentation mode 4,
   on the page rendered at 300 dpi with PyMuPDF. Local, free.
3. **Vision LLM**: Claude Sonnet reading the 300 dpi render, instructed to
   transcribe exactly, keep tables, mark stamps and blacked-out areas, and
   write `[?]` instead of guessing. Run as a Claude Code sub-agent as a
   stand-in for an API call; the production call would go to the
   hackathon's Azure endpoint (see `docs/agent/HACKATHON.md`).

## Results at the known problem spots

| Spot | PDF text layer | Tesseract (ces, 300 dpi) | Vision LLM |
|---|---|---|---|
| p1 stage | `pT2a pN1(3+/5) MO` | `pN1C(3+/5) MO` (flagged low confidence) | `pN1(3+/5) M0` |
| p1 ipilimumab dose | `lmg/kg` | `1mg/kg` | `1mg/kg` |
| p1 restaging dates | `cr 6/2023 + 1112023 + 212024` | `CT 6/2023 + 11/2023 + 2/2024` | same as Tesseract |
| p1 response | `PO (progressive disease)` | `PD (...)` | `PD (...)` |
| p1 MR date | `MR yyš, mozku 14.9.2026` | `MR vyš, mozku 14,9,2026` (flagged) | `MR vyš. mozku 14.9.2026` |
| p4 header | `Ambulantnf vyletfenf kontrolnf` plus logo noise | correct, plus noise `a`, `ny aš` (flagged) | correct; stamp written as `[razítko: SK]` |
| p4 blood pressure label | `Tlak` | `Tak` (flagged) | `Tlak` |
| p4 iRECIST table | values lost: labels and numbers in separate runs | values kept, but `11` read as `l` (flagged) | Markdown table, all 10 values correct |
| p4 pulse unit (printed `1/mín`) | `1/mín` | `1/míin` | `1/min` (silently normalized) |

Tesseract's mean word confidence was about 92 on both pages. Every
Tesseract error above was among the words it scored below 60 (11 words on
p1, 14 on p4), so its confidence is a usable "verify" signal. The vision
model marked one `[?]` and kept the author's typos ("výbormně",
"nevolnoist"), but it also normalized one token without saying so
(`1/mín` to `1/min`), and it gives no per-word confidence or position.

## Conclusions

- Do not trust the PDF's own text layer: broken font maps and lost table
  structure produce exactly the dates, stages, and doses that matter most.
- Read the **rendered page**, not the embedded image.
- **Vision LLM as the primary reader**: it was right at every spot checked,
  including the table and the stage. Risk: silent normalization, so keep
  its output checkable against the image.
- **Tesseract alongside, not only as a fallback**: it runs locally, and its
  word confidences and boxes give the "ověřit" (verify) markers and the
  highlight position on the page image. Where the two engines disagree on
  a token (a digit, a date, a stage), mark it for verification.
- In the source view, show the **rendered page image** next to the text,
  with the cited passage highlighted, so a doctor can always check the
  original.

Small sample (two pages of one patient); enough to decide the pipeline
shape, not to quote accuracy figures.

Working files (scratchpad, not in git): 300 dpi renders, Tesseract
`.txt`/`.tsv`, and the vision transcripts for both pages.
