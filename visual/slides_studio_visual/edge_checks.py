# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# Original work in this module: deterministic white/black edge-check composites.
"""
Deterministic edge-contamination checks for an extracted RGBA layer.

A clean subject extraction is opaque inside its mask and fully transparent
outside, so compositing it over a pure white and a pure black background yields
identical colours wherever the alpha is exactly 0 or 255. Any pixel where the
two composites differ signals partial transparency or halo bleed -- i.e. edge
contamination. This module renders those two reference composites and computes
deterministic contamination statistics used by the A1/A2/B router.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageChops

# Pixels whose alpha is strictly between 0 and 255 are partial-alpha / halo
# pixels and are the definition of edge contamination. Fully transparent pixels
# (alpha == 0) are outside the subject and are ignored entirely: the white-vs-
# black composite difference across alpha == 0 is just the background colour and
# is not contamination.


def _ensure_rgba(image: Image.Image) -> Image.Image:
    return image.convert("RGBA")


def render_edge_check_white(layer: Image.Image, size: tuple[int, int] | None = None) -> Image.Image:
    """
    Composite ``layer`` over a pure white background of the given size.

    ``size`` defaults to the layer size. The layer is alpha-composited; the
    output is opaque RGBA so it can be saved as evidence without alpha.
    """
    canvas_size = size or layer.size
    background = Image.new("RGBA", canvas_size, (255, 255, 255, 255))
    background.alpha_composite(_ensure_rgba(layer).resize(canvas_size, Image.Resampling.NEAREST))
    return background


def render_edge_check_black(layer: Image.Image, size: tuple[int, int] | None = None) -> Image.Image:
    """Composite ``layer`` over a pure black background of the given size."""
    canvas_size = size or layer.size
    background = Image.new("RGBA", canvas_size, (0, 0, 0, 255))
    background.alpha_composite(_ensure_rgba(layer).resize(canvas_size, Image.Resampling.NEAREST))
    return background


@dataclass(frozen=True)
class EdgeContaminationReport:
    """
    Deterministic edge-contamination statistics for one layer.

    ``contaminated_pixels`` counts partial-alpha / halo pixels
    (``0 < alpha < 255``). ``footprint_pixels`` is the subject footprint
    (``alpha > 0``) and is the contamination denominator: fully transparent
    pixels are ignored because the white-vs-black composite difference there is
    only the background colour, not contamination. ``max_edge_difference`` is the
    largest white-vs-black grey difference observed over the footprint and is
    informational; the authoritative contamination signal is the partial-alpha
    count.
    """

    contaminated_pixels: int
    footprint_pixels: int
    total_pixels: int
    max_edge_difference: int

    @property
    def contamination_ratio(self) -> float:
        if self.footprint_pixels <= 0:
            return 0.0
        return min(1.0, self.contaminated_pixels / self.footprint_pixels)

    def as_dict(self) -> dict[str, float | int]:
        return {
            "contaminated_pixels": int(self.contaminated_pixels),
            "footprint_pixels": int(self.footprint_pixels),
            "total_pixels": int(self.total_pixels),
            "max_edge_difference": int(self.max_edge_difference),
            "contamination_ratio": float(self.contamination_ratio),
        }


def measure_edge_contamination(
    layer: Image.Image, size: tuple[int, int] | None = None
) -> EdgeContaminationReport:
    """
    Measure edge contamination from the layer's alpha channel.

    The layer is rendered over white and black backgrounds (the two evidence
    composites) and the subject footprint is taken from the alpha channel at the
    same size. Contamination is defined as partial-alpha / halo pixels
    (``0 < alpha < 255``) divided by the footprint (``alpha > 0``), so fully
    transparent regions never count as contamination. Deterministic per input.
    """
    canvas_size = size or layer.size
    resized = _ensure_rgba(layer).resize(canvas_size, Image.Resampling.NEAREST)
    alpha = resized.getchannel("A")
    white = render_edge_check_white(layer, size)
    black = render_edge_check_black(layer, size)
    difference = ImageChops.difference(white, black).convert("L")
    total_pixels = canvas_size[0] * canvas_size[1]
    alpha_data = list(alpha.getdata())
    diff_data = list(difference.getdata())
    footprint = sum(1 for value in alpha_data if value > 0)
    contaminated = sum(1 for value in alpha_data if 0 < value < 255)
    max_edge_difference = 0
    for alpha_value, diff_value in zip(alpha_data, diff_data, strict=True):
        if alpha_value > 0 and diff_value > max_edge_difference:
            max_edge_difference = diff_value
    return EdgeContaminationReport(contaminated, footprint, total_pixels, int(max_edge_difference))
