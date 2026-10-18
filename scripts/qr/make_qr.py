# /// script
# requires-python = ">=3.11"
# dependencies = ["segno==1.6.1"]
# ///
"""QR codes that open https://glidemdt.com, for slides, posters and print.

Usage: uv run scripts/qr/make_qr.py
Writes docs/submission/qr/glidemdt-qr.{svg,png} (dark ink on white) and glidemdt-qr-mint.png (on GLIDE's mint).
The link carries utm_source=qr, so Umami can tell scans apart from other visits.
"""
from pathlib import Path

import segno

URL = "https://glidemdt.com/?utm_source=qr"
OUT = Path(__file__).resolve().parents[2] / "docs/submission/qr"
INK = "#102c39"  # GLIDE ink

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Error correction "q" (25 %) keeps the code readable from a projector or a creased printout.
    qr = segno.make(URL, error="q")
    qr.save(OUT / "glidemdt-qr.svg", dark=INK, light="#ffffff", border=4, scale=10)
    qr.save(OUT / "glidemdt-qr.png", dark=INK, light="#ffffff", border=4, scale=24)
    qr.save(OUT / "glidemdt-qr-mint.png", dark=INK, light="#74ebcc", border=4, scale=24)
    print(f"{URL} -> {OUT} (version {qr.version}, {qr.symbol_size(scale=24)} px)")

if __name__ == "__main__":
    main()
