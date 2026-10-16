# /// script
# dependencies = ["pypdf==5.1.0"]
# ///
import sys, json, pathlib
from pypdf import PdfReader
d = pathlib.Path(sys.argv[1]); out = {}
for f in sorted(d.glob("*_pacient.pdf")):
    r = PdfReader(str(f))
    out[f.name] = [p.extract_text() or "" for p in r.pages]
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
for k, v in out.items(): print(k, len(v), [len(x) for x in v])
