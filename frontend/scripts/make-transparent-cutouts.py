"""
Produce transparent-background product cutouts.
---------------------------------------------------------------------------
    pip install "rembg[cpu]" pillow
    python scripts/make-transparent-cutouts.py

Takes the menu photography in public/images/products/photos/ and removes the
background with a U^2-Net segmentation model, leaving just the dish on
transparency. Output goes to public/images/products/cutouts/ as PNG.

WHY CUTOUTS RATHER THAN PHOTOS:
A photo carries its own background — a wooden board, a studio backdrop, another
restaurant's lighting. Twelve of those in a grid fight each other and fight the
dark UI behind them. A cutout sits on OUR background, so the menu reads as one
designed surface instead of a scrapbook, and the same asset works on a dark
card, a light invoice or a coloured offer banner.

Both PNG and WebP are written. JPEG is not an option at all — it has no alpha
channel. PNG is lossless and universally supported but expensive for
photographic subjects (~400KB each); lossy WebP preserves the alpha at roughly
a tenth of that. The app serves WebP and keeps the PNG as a fallback.

The model runs on CPU and takes a few seconds per image. This is a BUILD-TIME
step — the output is committed, so nothing runs at request time.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from rembg import new_session, remove
    from PIL import Image
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit('Missing dependencies. Run:  pip install "rembg[cpu]" pillow')

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE.parent / 'public' / 'images' / 'products' / 'photos'
OUTPUT_DIR = HERE.parent / 'public' / 'images' / 'products' / 'cutouts'

# `ambience` is a room, not a dish — there is no subject to cut out, and the
# background IS the point. It stays a normal photo for the story section.
SKIP = {'ambience'}

# Cutouts are displayed at ~300px in the grid; 800 square gives a 2x buffer for
# high-DPI screens without bloating the payload.
CANVAS = 800
# Breathing room so the dish never touches the edge of its tile.
PADDING = 40


def trim_and_centre(image: Image.Image) -> Image.Image:
    """Crop to the subject's alpha bounds, then centre it on a square canvas.

    Without this every cutout keeps the framing of its ORIGINAL photo, so one
    dish floats top-left and the next sits bottom-right. Normalising here is
    what makes a grid of them look deliberate.
    """
    bbox = image.getbbox()  # bounds of the non-transparent pixels
    if bbox:
        image = image.crop(bbox)

    inner = CANVAS - PADDING * 2
    # `contain`, not `cover` — cropping a cutout would slice off the dish.
    image.thumbnail((inner, inner), Image.LANCZOS)

    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(
        image,
        ((CANVAS - image.width) // 2, (CANVAS - image.height) // 2),
        image,
    )
    return canvas


def main() -> int:
    if not SOURCE_DIR.exists():
        sys.exit(f'No source photos at {SOURCE_DIR}. Run fetch-menu-photos.mjs first.')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sources = sorted(p for p in SOURCE_DIR.glob('*.jpg') if p.stem not in SKIP)
    if not sources:
        sys.exit('No source photos found.')

    # One session reused across every image: creating it loads the model, which
    # is by far the slowest part. Per-image sessions would multiply that cost.
    print('Loading segmentation model (first run downloads it — this is slow once)…')
    session = new_session('u2net')

    written = 0
    for source in sources:
        target = OUTPUT_DIR / f'{source.stem}.png'

        try:
            with Image.open(source) as original:
                cut = remove(original.convert('RGBA'), session=session)

            finished = trim_and_centre(cut)
            # optimize=True typically saves 20-30% on flat-alpha images.
            finished.save(target, 'PNG', optimize=True)

            # WebP alongside the PNG. Photographic subjects on transparency are
            # expensive as PNG (lossless, ~400KB each); lossy WebP keeps the
            # alpha channel at roughly a tenth of the size, which matters a lot
            # for a grid of twelve. The PNG stays as the fallback for anything
            # that cannot decode WebP.
            webp_target = target.with_suffix('.webp')
            finished.save(webp_target, 'WEBP', quality=82, method=6)

            size_kb = target.stat().st_size // 1024
            webp_kb = webp_target.stat().st_size // 1024
            print(f'  OK  {target.stem}  png {size_kb}KB / webp {webp_kb}KB')
            written += 1
        except Exception as error:  # noqa: BLE001 - one bad image must not stop the batch
            print(f'  --  {source.name} failed: {error}')

    print(f'\n{written}/{len(sources)} cutouts written to {OUTPUT_DIR}')
    return 0 if written else 1


if __name__ == '__main__':
    raise SystemExit(main())
