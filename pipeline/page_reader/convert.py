"""A photo of a page (JPEG or PNG, typically from a phone) into a one-page PDF, so the rest of the pipeline reads
it like any scanned PDF: render, Tesseract, readability.

- Upright by its EXIF orientation: phones store the picture sideways and only a tag says how to turn it, and
  Tesseract reads a sideways page as noise.
- Metadata is dropped: the page is rebuilt from the photo's pixels alone, so EXIF (camera, time, GPS location), XMP,
  ICC profiles and JPEG or PNG comments do not reach the PDF. The uploaded original is kept unchanged by the Worker;
  only this derived PDF is read.
- Transparency becomes white paper, not black (a screenshot with a transparent background).
- Grayscale, as the pipeline renders every page in grayscale anyway, and at most about A4 at 300 dpi: the pages are
  rendered at 300 dpi later, so more pixels would only make the PDF, and every call that carries it, larger.
- Placed on an A4 page (portrait or landscape by the photo's shape), scaled to fit.
"""

import io

import fitz  # PyMuPDF
from PIL import Image, ImageOps

# A 48-megapixel phone photo is 48 Mpx; refuse anything far larger before decoding it, since a decompression bomb
# would exhaust the instance's memory.
MAX_PIXELS = 60_000_000
A4 = (595.28, 841.89)  # points
# A4 at 300 dpi is 2480 x 3508 pixels; the longer side is cut to this, the shorter follows the photo's shape.
MAX_SIDE = 3508
JPEG_QUALITY = 85  # enough for OCR of print at A4; the original stays as uploaded


class NotImage(ValueError):
    pass


class TooLarge(ValueError):
    pass


def kind(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


def _decode(data: bytes) -> Image.Image:
    try:
        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if w * h > MAX_PIXELS:
            raise TooLarge()
        im.load()
        return im
    except (TooLarge, Image.DecompressionBombError):
        # Pillow's own bomb limit sits above MAX_PIXELS; either way the photo has too many pixels, not a damaged file.
        raise TooLarge() from None
    except Exception:  # Pillow raises many types for damaged files; the detail is not needed
        raise NotImage() from None


def _paper(im: Image.Image) -> Image.Image:
    """Grayscale on white: transparent parts become paper, not black."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(white, rgba).convert("L")
    if im.mode in ("I;16", "I;16B", "I;16L", "I"):
        # 16-bit grayscale: scale to 8 bits instead of clipping everything above 255 to white.
        return im.point(lambda v: v / 256).convert("L")
    return im.convert("L")


def image_to_pdf(data: bytes) -> tuple[bytes, tuple[int, int]]:
    """The PDF bytes and the pixel size of the upright, possibly reduced image."""
    if kind(data) is None:
        raise NotImage()
    im = _paper(ImageOps.exif_transpose(_decode(data)))
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    # A fresh image holding only the pixels: nothing of the original's info (comments, ICC, EXIF, XMP) can follow.
    clean = Image.new("L", im.size)
    clean.paste(im)
    buf = io.BytesIO()
    clean.save(buf, "JPEG", quality=JPEG_QUALITY)
    w, h = clean.size
    pw, ph = A4 if h >= w else (A4[1], A4[0])
    scale = min(pw / w, ph / h)
    rect = fitz.Rect(0, 0, w * scale, h * scale)
    doc = fitz.open()
    page = doc.new_page(width=pw, height=ph)
    page.insert_image(rect, stream=buf.getvalue())
    out = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return out, (w, h)
