# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# Original work in this module: normalized-rect placement with declared
# alternatives only, protected-region collisions, and bounded deterministic retry.
"""
Protected-region placement for real overlay assets.

Placement is restricted to a caller-declared list of alternative candidate
regions expressed as normalized rects (``x, y, w, h`` in ``[0, 1]``). The first
candidate, in input order, that does not collide with any protected region is
selected. If no declared candidate fits, the result is a deterministic *block*
-- the router never invents or searches for new positions, so retry is bounded
by the length of the input alternative list.

The overlay trace renders the selected region using the exact same normalized
bbox and corner-skeleton geometry as :func:`slots.render_corner_skeleton` so a
trace image and the eventual real overlay share identical bounds.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

NormalizedRect = tuple[float, float, float, float]


@dataclass(frozen=True)
class NormalizedRects:
    """Validated container of normalized rects."""

    rects: tuple[NormalizedRect, ...]

    @classmethod
    def from_iterable(cls, items: object) -> NormalizedRects:
        if items is None:
            return cls(())
        if not isinstance(items, (list, tuple)):
            raise ValueError("rects must be a list of [x, y, w, h]")
        normalized: list[NormalizedRect] = []
        for index, item in enumerate(items):
            if not isinstance(item, (list, tuple)) or len(item) != 4:
                raise ValueError(f"alternative #{index} must be [x, y, w, h]")
            x, y, w, h = (float(item[0]), float(item[1]), float(item[2]), float(item[3]))
            normalized.append(_validate_rect((x, y, w, h)))
        return cls(tuple(normalized))


def _validate_rect(rect: tuple[float, float, float, float]) -> NormalizedRect:
    x, y, w, h = rect
    for name, value in (("x", x), ("y", y), ("w", w), ("h", h)):
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"normalized rect component {name}={value} out of [0, 1]")
    if w <= 0.0 or h <= 0.0:
        raise ValueError(f"normalized rect must have positive size: {rect}")
    if x + w > 1.0 or y + h > 1.0:
        raise ValueError(f"normalized rect exceeds canvas: {rect}")
    return (x, y, w, h)


def rects_overlap(a: NormalizedRect, b: NormalizedRect, *, touching_counts: bool = True) -> bool:
    """
    Return True when two normalized rects intersect.

    ``touching_counts=True`` (default) treats flush/touching edges as overlap
    using inclusive ``<=`` boundaries, so a candidate flush against a protected
    region is rejected. ``touching_counts=False`` uses strict ``<`` and reports
    only interior overlap.
    """
    a_x, a_y, a_w, a_h = a
    b_x, b_y, b_w, b_h = b
    if touching_counts:
        return a_x <= b_x + b_w and b_x <= a_x + a_w and a_y <= b_y + b_h and b_y <= a_y + a_h
    return a_x < b_x + b_w and b_x < a_x + a_w and a_y < b_y + b_h and b_y < a_y + a_h


@dataclass(frozen=True)
class PlacementResult:
    """
    Outcome of a placement attempt.

    ``selected_index`` is the input-order index of the chosen candidate, or
    ``None`` when every declared candidate collides with a protected region
    (a blocking result). ``attempts`` is the number of candidates actually
    inspected -- always ``<= len(alternatives)``.
    """

    selected_index: int | None
    selected_rect: NormalizedRect | None
    attempts: int
    blocked: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "selected_index": self.selected_index,
            "selected_rect": list(self.selected_rect) if self.selected_rect is not None else None,
            "attempts": self.attempts,
            "blocked": self.blocked,
        }


def find_placement_candidate(
    alternatives: object,
    protected: object,
) -> PlacementResult:
    """
    Select the first declared alternative that avoids all protected regions.

    ``alternatives`` and ``protected`` are lists of normalized ``[x, y, w, h]``
    rects. Selection is deterministic: alternatives are tried in input order and
    the first collision-free one wins. The number of attempts is bounded by the
    declared alternative count; when none fit a blocking result is returned and
    no position is invented.
    """
    candidates = NormalizedRects.from_iterable(alternatives)
    guards = NormalizedRects.from_iterable(protected)
    for index, candidate in enumerate(candidates.rects):
        if not any(rects_overlap(candidate, guard) for guard in guards.rects):
            return PlacementResult(index, candidate, index + 1, False)
    return PlacementResult(None, None, len(candidates.rects), True)


def render_overlay_trace(
    output: str | Path,
    bbox: NormalizedRect,
    size: tuple[int, int] = (1536, 864),
    color: tuple[int, int, int, int] = (240, 90, 54, 180),
) -> Path:
    """
    Render the overlay trace for a normalized bbox.

    Draws a single image containing a faint filled rectangle, the exact bbox
    outline, and the corner skeleton at the *same* pixel coordinates as
    :func:`slots.render_corner_skeleton`, so the trace image and the eventual
    real overlay share identical bounds. The image is saved exactly once; it is
    not overwritten by a later pass, so the fill and outline survive.
    """
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    x, y, width, height = bbox
    left, top = round(x * size[0]), round(y * size[1])
    right, bottom = round((x + width) * size[0]), round((y + height) * size[1])
    fill_color = (color[0], color[1], color[2], 40)
    # Exact bbox outline + faint fill, drawn once.
    draw.rectangle((left, top, right, bottom), outline=color, width=2, fill=fill_color)
    # Corner skeleton at the exact same bbox geometry (mirrors slots.render_corner_skeleton).
    arm = max(10, round(min(right - left, bottom - top) * 0.08))
    corners = (
        (left, top, 1, 1),
        (right, top, -1, 1),
        (left, bottom, 1, -1),
        (right, bottom, -1, -1),
    )
    for px, py, horizontal, vertical in corners:
        draw.line((px, py, px + arm * horizontal, py), fill=color, width=3)
        draw.line((px, py, px, py + arm * vertical), fill=color, width=3)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return path
