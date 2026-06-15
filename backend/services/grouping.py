"""Geometric grouping of OCR word-boxes (no model, CPU-only).

RapidOCR returns text boxes in raw detection order, which is rarely reading
order — multi-word fields end up scrambled across the concatenated text. This
module reconstructs reading order from box geometry and groups boxes into
blocks, then classifies each block by keyword so downstream matchers and the
reviewer overlay can reason about *what* a region is.

Box format (from ``ReaderOutput.word_boxes``): ``{"box": [[x,y]x4], "text",
"confidence"}`` with points in the OCR image's pixel space. All ordering here is
within that space, which is sufficient for reading-order reconstruction.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from dataclasses import field as _dc_field

logger = logging.getLogger("ttb_label_verifier")

# A box joins the current row when its vertical center sits within this fraction
# of the row's height — tolerant of slightly uneven baselines without merging
# separate lines.
_ROW_OVERLAP = 0.6
# Rows separated by more than this multiple of the local line height start a new
# block (paragraph) when grouping into blocks.
_BLOCK_GAP = 1.6


@dataclass
class Block:
    """A grouped, reading-ordered text block with its bounding region."""

    text: str
    # Axis-aligned bounds in OCR-image pixels: (x0, y0, x1, y1).
    bounds: tuple[float, float, float, float]
    # Field key this block most resembles, or None when nothing matched.
    field: str | None = None
    lines: list[str] = _dc_field(default_factory=list)


def _metrics(box: dict) -> tuple[float, float, float, float, float]:
    """Return (cx, cy, top, height, left) for a box's quad."""
    pts = box.get("box") or []
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]
    top, bottom = min(ys), max(ys)
    return (
        sum(xs) / len(xs),
        sum(ys) / len(ys),
        top,
        max(1.0, bottom - top),
        min(xs),
    )


def _rows(boxes: list[dict]) -> list[list[dict]]:
    """Cluster boxes into rows by vertical overlap, top-to-bottom."""
    annotated = sorted(
        ((b, _metrics(b)) for b in boxes if b.get("box")), key=lambda t: t[1][1]
    )
    rows: list[list[tuple[dict, tuple]]] = []
    for b, m in annotated:
        cy, height = m[1], m[3]
        placed = False
        for row in rows:
            row_cy = sum(rm[1][1] for rm in row) / len(row)
            row_h = sum(rm[1][3] for rm in row) / len(row)
            if abs(cy - row_cy) <= _ROW_OVERLAP * max(height, row_h):
                row.append((b, m))
                placed = True
                break
        if not placed:
            rows.append([(b, m)])
    # Each row: order left-to-right; drop the metrics.
    return [[bm[0] for bm in sorted(row, key=lambda t: t[1][4])] for row in rows]


def _row_text(row: list[dict]) -> str:
    """Join a left-to-right row of boxes into a single line of text."""
    return " ".join((b.get("text") or "").strip() for b in row).strip()


def reading_order_lines(boxes: list[dict] | None) -> list[str]:
    """Reconstruct reading-ordered lines from boxes (row-clustered, L→R, T→B)."""
    if not boxes:
        return []
    return [ln for ln in (_row_text(row) for row in _rows(boxes)) if ln]


def reading_order_text(boxes: list[dict] | None) -> str:
    """Reading-ordered text — a coherent replacement for raw detection order."""
    return "\n".join(reading_order_lines(boxes))


# --- block grouping + classification ---------------------------------------

# Keyword/regex rules mapping a block's text to a field key. Order matters:
# more specific patterns first. These are intentionally lenient (OCR is noisy).
_CLASSIFIERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("government_warning", re.compile(r"gov\w*\s*warn|surgeon\s*general", re.I)),
    (
        "alcohol_content",
        re.compile(r"\balc\b|alc\.?\s*/?\s*vol|\babv\b|\bproof\b|\d+\s*%", re.I),
    ),
    (
        "net_contents",
        re.compile(r"\bml\b|fl\.?\s*oz|\bliter|\d+\s*(ml|l)\b", re.I),
    ),
    (
        "country_of_origin",
        re.compile(r"product\s+of|imported|hecho\s+en|produce\s+of", re.I),
    ),
)


def classify_text(text: str) -> str | None:
    """Best-effort field key for a block of text, or None."""
    for field_key, pat in _CLASSIFIERS:
        if pat.search(text):
            return field_key
    return None


def group_blocks(boxes: list[dict] | None) -> list[Block]:
    """Group boxes into reading-ordered blocks (paragraphs) and classify them."""
    if not boxes:
        return []
    rows = _rows(boxes)
    # Row metrics for gap-based block splitting.
    row_meta = [
        (
            row,
            sum(_metrics(b)[1] for b in row) / len(row),  # center y
            sum(_metrics(b)[3] for b in row) / len(row),  # height
        )
        for row in rows
    ]
    blocks: list[list[list[dict]]] = []
    prev_cy = prev_h = None
    for row, cy, h in row_meta:
        if prev_cy is not None and (cy - prev_cy) > _BLOCK_GAP * max(h, prev_h or h):
            blocks.append([row])
        elif blocks:
            blocks[-1].append(row)
        else:
            blocks.append([row])
        prev_cy, prev_h = cy, h

    out: list[Block] = []
    for blk in blocks:
        flat = [b for row in blk for b in row]
        xs = [float(p[0]) for b in flat for p in b["box"]]
        ys = [float(p[1]) for b in flat for p in b["box"]]
        lines = [ln for ln in (_row_text(row) for row in blk) if ln]
        text = "\n".join(lines)
        out.append(
            Block(
                text=text,
                bounds=(min(xs), min(ys), max(xs), max(ys)),
                field=classify_text(text),
                lines=lines,
            )
        )
    logger.debug(
        "event=group_blocks boxes=%d blocks=%d classified=%d",
        len(boxes),
        len(out),
        sum(1 for b in out if b.field),
    )
    return out
