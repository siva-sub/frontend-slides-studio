# Licensed under the Apache License, Version 2.0.
# Technique adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
"""Deterministic real-asset reservation and trace skeletons."""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw


def fit_bbox_to_asset(region: tuple[float, float, float, float], asset_ratio: float, slide_aspect: float = 16 / 9, padding: float = 0.0) -> tuple[float, float, float, float]:
    x, y, width, height = region
    inner_width, inner_height = max(0.001, width - 2 * padding), max(0.001, height - 2 * padding)
    normalized_ratio = asset_ratio / slide_aspect
    if inner_width / inner_height >= normalized_ratio:
        fitted_height, fitted_width = inner_height, inner_height * normalized_ratio
    else:
        fitted_width, fitted_height = inner_width, inner_width / normalized_ratio
    return x + (width - fitted_width) / 2, y + (height - fitted_height) / 2, fitted_width, fitted_height


def render_corner_skeleton(output: str | Path, bbox: tuple[float, float, float, float], size: tuple[int, int] = (1536, 864), color: tuple[int, int, int, int] = (240, 90, 54, 180)) -> Path:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    x, y, width, height = bbox
    left, top = round(x * size[0]), round(y * size[1])
    right, bottom = round((x + width) * size[0]), round((y + height) * size[1])
    arm = max(10, round(min(right - left, bottom - top) * 0.08))
    for point, horizontal, vertical in [((left, top), 1, 1), ((right, top), -1, 1), ((left, bottom), 1, -1), ((right, bottom), -1, -1)]:
        px, py = point
        draw.line((px, py, px + arm * horizontal, py), fill=color, width=3)
        draw.line((px, py, px, py + arm * vertical), fill=color, width=3)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return path
