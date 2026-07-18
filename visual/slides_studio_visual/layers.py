# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# ============================================================================
# PROMINENT MODIFICATION NOTICE (Apache-2.0 §4(b))
# ----------------------------------------------------------------------------
# The upstream Apache-2.0 module exposed three internal strategies
# (direct_extract / occlusion_complete / ai_regenerate). This project renames
# them to the A1 / A2 / B route contract used by the visual-master pipeline,
# adds validated metrics, route-evidence records, default overlap grouping,
# and the A2 masked-composite builder. No upstream text/asset is copied.
# ============================================================================
"""
Raster layer extraction and A1/A2/B route selection.

Routes
------
* ``A1`` -- direct RGBA extraction of the visible subject. Allowed only when
  ``mask_confidence >= 0.90``, ``edge_contamination <= 0.08`` and
  ``occlusion_ratio <= 0.20``. The source pixels are lifted verbatim; nothing
  is regenerated.
* ``A2`` -- masked composite. The mask and edge checks pass but occlusion
  exceeds 0.20, so the visible source pixels are preserved and only the masked
  occluded/background regions are repaired from an external ``repair`` plate.
* ``B`` -- isolated regeneration. Used whenever the mask/edge checks fail, or
  unconditionally when ``design_mode`` is enabled.

Thresholds are exact (inclusive on the A1 side), mirroring the upstream
comparison operators so callers can rely on boundary stability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from PIL import Image

# Exact A1 thresholds (inclusive boundaries).
A1_MIN_MASK_CONFIDENCE = 0.90
A1_MAX_EDGE_CONTAMINATION = 0.08
A1_MAX_OCCLUSION = 0.20

ROUTE_DIRECT = "A1"
ROUTE_MASKED = "A2"
ROUTE_REGENERATE = "B"

_VALID_ROUTES = (ROUTE_DIRECT, ROUTE_MASKED, ROUTE_REGENERATE)


@dataclass(frozen=True)
class LayerMetrics:
    """
    Validated per-layer quality metrics used for route selection.

    All three values are clamped to the closed interval ``[0.0, 1.0]``.
    """

    mask_confidence: float
    edge_contamination: float
    occlusion_ratio: float

    def __post_init__(self) -> None:
        for name, value in (
            ("mask_confidence", self.mask_confidence),
            ("edge_contamination", self.edge_contamination),
            ("occlusion_ratio", self.occlusion_ratio),
        ):
            if not isinstance(value, (int, float)):
                raise TypeError(f"{name} must be a number")
            if not 0.0 <= float(value) <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1")

    def as_dict(self) -> dict[str, float]:
        return {
            "mask_confidence": float(self.mask_confidence),
            "edge_contamination": float(self.edge_contamination),
            "occlusion_ratio": float(self.occlusion_ratio),
        }


def choose_layer_strategy(metrics: LayerMetrics, design_mode: bool = False) -> str:
    """
    Return the route (``A1`` / ``A2`` / ``B``) for the supplied metrics.

    ``design_mode`` forces ``B`` (isolated regeneration). Otherwise the mask and
    edge checks gate ``A1``/``A2``; occlusion above the A1 ceiling downgrades a
    passing mask/edge pair to the masked ``A2`` composite.
    """
    if design_mode:
        return ROUTE_REGENERATE
    if (
        metrics.mask_confidence < A1_MIN_MASK_CONFIDENCE
        or metrics.edge_contamination > A1_MAX_EDGE_CONTAMINATION
    ):
        return ROUTE_REGENERATE
    if metrics.occlusion_ratio > A1_MAX_OCCLUSION:
        return ROUTE_MASKED
    return ROUTE_DIRECT


def explain_route(route: str, metrics: LayerMetrics, design_mode: bool = False) -> str:
    """Return a deterministic human-readable reason for the chosen route."""
    if route == ROUTE_REGENERATE and design_mode:
        return "design_mode forces isolated regeneration (route B)"
    if route == ROUTE_REGENERATE:
        if metrics.mask_confidence < A1_MIN_MASK_CONFIDENCE:
            return f"mask_confidence {metrics.mask_confidence} below A1 floor {A1_MIN_MASK_CONFIDENCE}; regenerate"
        return f"edge_contamination {metrics.edge_contamination} above A1 ceiling {A1_MAX_EDGE_CONTAMINATION}; regenerate"
    if route == ROUTE_MASKED:
        return (
            f"mask/edge pass but occlusion {metrics.occlusion_ratio} above A1 ceiling "
            f"{A1_MAX_OCCLUSION}; preserve visible pixels and repair masked regions"
        )
    return (
        f"mask_confidence {metrics.mask_confidence} >= {A1_MIN_MASK_CONFIDENCE}, "
        f"edge_contamination {metrics.edge_contamination} <= {A1_MAX_EDGE_CONTAMINATION}, "
        f"occlusion {metrics.occlusion_ratio} <= {A1_MAX_OCCLUSION}; direct RGBA extraction"
    )


def layer_decision(
    metrics: LayerMetrics, design_mode: bool = False, route: str | None = None
) -> dict[str, Any]:
    """
    Build the deterministic route-evidence record for one layer.

    ``route`` lets a caller force an explicit decision; it must still be a valid
    route. When omitted the route is derived from :func:`choose_layer_strategy`.
    """
    chosen = route if route is not None else choose_layer_strategy(metrics, design_mode)
    if chosen not in _VALID_ROUTES:
        raise ValueError(f"invalid route: {chosen}")
    return {
        "route": chosen,
        "reason": explain_route(chosen, metrics, design_mode),
        "design_mode": bool(design_mode),
        "metrics": metrics.as_dict(),
        "thresholds": {
            "min_mask_confidence": A1_MIN_MASK_CONFIDENCE,
            "max_edge_contamination": A1_MAX_EDGE_CONTAMINATION,
            "max_occlusion": A1_MAX_OCCLUSION,
        },
    }


def extract_rgba_layer(source: Image.Image, mask: Image.Image) -> Image.Image:
    """
    Direct RGBA extraction (route A1).

    Lifts the source pixels verbatim and stamps the supplied ``mask`` (0=keep
    transparent, 255=opaque) onto the alpha channel. Source pixels are never
    modified; only the alpha channel is set.
    """
    if source.size != mask.size:
        raise ValueError("source and layer mask sizes must match")
    layer = source.convert("RGBA")
    layer.putalpha(mask.convert("L"))
    return layer


def composite_masked_layer(
    source: Image.Image,
    repair: Image.Image,
    internal_mask: Image.Image,
) -> Image.Image:
    """
    Masked A2 composite: preserve visible source pixels, repair only masked regions.

    White (255) mask pixels mark occluded/background regions that may be replaced
    by ``repair``; black (0) pixels must retain the original ``source`` pixels
    exactly. This is the route-A2 specialization of the pixel-locked composite
    and is byte-identical to :func:`masking.composite_masked_edit` for the same
    inputs, but is named separately so route evidence stays explicit.
    """
    from .masking import composite_masked_edit

    return composite_masked_edit(source, repair, internal_mask)


@dataclass(frozen=True)
class SubjectRef:
    """
    A subject with its integer pixel bounding box and mask extent.

    ``bbox_px`` is ``(left, top, right, bottom)`` in source pixel coordinates.
    """

    id: str
    bbox_px: tuple[int, int, int, int]


def _bbox_area(bbox: tuple[int, int, int, int]) -> int:
    left, top, right, bottom = bbox
    return max(0, right - left) * max(0, bottom - top)


def bboxes_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    """
    Return True when two integer pixel bboxes share interior area (touching excluded).

    Uses strict ``<`` boundaries so pixel-adjacent (flush-edge) bboxes are not
    grouped. This matches the default grouping intent: only subjects whose
    extents actually overlap are kept as one logical image group.
    """
    a_left, a_top, a_right, a_bottom = a
    b_left, b_top, b_right, b_bottom = b
    return a_left < b_right and b_left < a_right and a_top < b_bottom and b_top < a_bottom


def group_overlapping_subjects(
    subjects: tuple[SubjectRef, ...] | list[SubjectRef],
) -> tuple[tuple[str, ...], ...]:
    """
    Default grouping: mutually overlapping subjects stay one logical image group.

    Two subjects are grouped when their bboxes overlap. Transitively connected
    subjects collapse into a single group. Deterministic ordering: groups are
    returned in the order of the first subject they contain, and member ids
    within a group preserve the original input order. This is the default so a
    cluster of overlapping subjects is treated as one logical image unless a
    caller explicitly splits them.
    """
    nodes = list(subjects)
    parent = {subject.id: subject.id for subject in nodes}

    def find(identity: str) -> str:
        while parent[identity] != identity:
            parent[identity] = parent[parent[identity]]
            identity = parent[identity]
        return identity

    def union(a: str, b: str) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for i, outer in enumerate(nodes):
        for inner in nodes[i + 1 :]:
            if bboxes_overlap(outer.bbox_px, inner.bbox_px):
                union(outer.id, inner.id)

    ordered: dict[str, list[str]] = {}
    for subject in nodes:
        root = find(subject.id)
        ordered.setdefault(root, []).append(subject.id)
    return tuple(tuple(members) for members in ordered.values())


def split_group(group: tuple[str, ...]) -> tuple[tuple[str, ...], ...]:
    """
    Explicit split override: dissolve a default group into singletons.

    Provided so a caller can opt out of the default overlap grouping and treat
    each subject as its own logical image.
    """
    return tuple((member,) for member in group)
