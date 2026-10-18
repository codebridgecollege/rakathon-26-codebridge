# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==10.4.0"]
# ///
"""Turn the app screenshots taken by scripts/cover/build.mjs into light JPEGs for the landing page (site/img).

Usage: COVER_DEPS=... node scripts/cover/build.mjs, then `uv run scripts/site/build_images.py`.
The screenshots are 2880 px wide (2x); 1600 px is enough for the largest card on the page.
"""
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "scripts/cover/shots"
OUT = ROOT / "site/img"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for png in sorted(SHOTS.glob("*.png")):
        im = Image.open(png).convert("RGB")
        im.thumbnail((1600, 1600 * im.height // im.width))
        im.save(OUT / f"{png.stem}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    shutil.copy(ROOT / "scripts/brand/glide.svg", OUT / "glide.svg")
    shutil.copy(ROOT / "docs/submission/og.jpg", OUT / "og.jpg")  # link preview image, without the event line
    print(f"wrote {len(list(OUT.glob('*.jpg')))} images to {OUT}")


if __name__ == "__main__":
    main()
