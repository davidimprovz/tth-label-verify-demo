"""Render the synthetic label fixture used by the OCR + orchestrator tests.

Run inside the container to (re)generate ``synthetic_label.png``::

    docker compose run --rm bench python -m tests.fixtures.generate_label

The rendered PNG is committed so tests don't depend on Pillow/fonts at runtime;
this generator is kept alongside it for reproducibility.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Field values rendered onto the label. The orchestrator test builds matching
# ``ExpectedFields`` from these.
BRAND_NAME = "RIVERSTONE RESERVE"
CLASS_TYPE = "Kentucky Straight Bourbon Whiskey"
ALCOHOL = "45% Alc./Vol. (90 Proof)"
NET_CONTENTS = "750 mL"
PRODUCER = "Riverstone Distilling Co."
PRODUCER_CITY = "Louisville, Kentucky"

GOVERNMENT_WARNING = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not "
    "drink alcoholic beverages during pregnancy because of the risk of birth "
    "defects. (2) Consumption of alcoholic beverages impairs your ability to "
    "drive a car or operate machinery, and may cause health problems."
)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load a clear sans-serif font, falling back to the PIL default."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _wrap(draw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render() -> Image.Image:
    width, height = 900, 1200
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    margin = 60
    y = 90

    big = _font(54)
    mid = _font(34)
    small = _font(26)
    warn = _font(24)

    def center(text: str, font, yy: int, fill="black") -> int:
        w = draw.textlength(text, font=font)
        draw.text(((width - w) / 2, yy), text, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), text, font=font)
        return yy + (bbox[3] - bbox[1]) + 20

    y = center(BRAND_NAME, big, y)
    y += 20
    for line in _wrap(draw, CLASS_TYPE, mid, width - 2 * margin):
        y = center(line, mid, y)
    y += 40
    y = center(ALCOHOL, mid, y)
    y = center(NET_CONTENTS, mid, y)
    y += 40
    y = center(PRODUCER, small, y)
    y = center(PRODUCER_CITY, small, y)

    # Government warning block, left-aligned and wrapped at the bottom.
    y = max(y + 60, height - 320)
    for line in _wrap(draw, GOVERNMENT_WARNING, warn, width - 2 * margin):
        draw.text((margin, y), line, font=warn, fill="black")
        bbox = draw.textbbox((0, 0), line, font=warn)
        y += (bbox[3] - bbox[1]) + 10

    return img


def main() -> None:
    out = Path(__file__).with_name("synthetic_label.png")
    render().save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
