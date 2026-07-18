# Licensed under the Apache License, Version 2.0.
# Adapted from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# Modified: added strict job-root containment, groups/raster regions, and export provenance.
"""Strict, contained visual-master scene model."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SUPPORTED_TYPES = {"native_text", "native_shape", "connector", "image_layer", "group", "svg_fallback", "raster_region"}
SUPPORTED_SHAPES = {"rectangle", "rounded_rectangle", "ellipse", "line", "polygon"}


def contained_path(root: Path, value: str, *, required: bool = True) -> Path:
    root = root.resolve()
    candidate = (root / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"path escapes job root: {value}") from error
    if required and not candidate.is_file():
        raise ValueError(f"file does not exist: {candidate}")
    return candidate


def _bbox(value: Any, width: int, height: int, element_id: str) -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{element_id}.bbox_px must be [x,y,w,h]")
    x, y, w, h = (float(part) for part in value)
    if x < 0 or y < 0 or w < 0 or h < 0 or x + w > width or y + h > height:
        raise ValueError(f"{element_id}.bbox_px is outside canvas")
    return x, y, w, h


@dataclass(frozen=True)
class SceneElement:
    id: str
    type: str
    bbox_px: tuple[float, float, float, float]
    z_index: int
    content: str = ""
    style: dict[str, Any] = field(default_factory=dict)
    asset: Path | None = None
    layer_route: str | None = None


@dataclass(frozen=True)
class VisualScene:
    schema_version: int
    slide_id: str
    canvas_width: int
    canvas_height: int
    visual_master: Path
    clean_plate: Path
    repair_mask: Path | None
    elements: tuple[SceneElement, ...]
    review_status: str
    review: dict[str, str] | None = None
    render_back_evidence: tuple[Path, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any], job_root: str | Path) -> "VisualScene":
        root = Path(job_root)
        if int(data.get("schemaVersion", 0)) != 1:
            raise ValueError("unsupported scene schemaVersion")
        canvas = data.get("canvas") or {}
        width, height = int(canvas.get("width", 0)), int(canvas.get("height", 0))
        if width <= 0 or height <= 0:
            raise ValueError("canvas must be positive")
        seen: set[str] = set()
        elements: list[SceneElement] = []
        for raw in data.get("elements") or []:
            element_id = str(raw.get("id") or "").strip()
            element_type = str(raw.get("type") or "")
            if not element_id or element_id in seen:
                raise ValueError(f"missing or duplicate element id: {element_id}")
            if element_type not in SUPPORTED_TYPES:
                raise ValueError(f"unsupported element type: {element_type}")
            seen.add(element_id)
            asset = contained_path(root, str(raw["asset"])) if raw.get("asset") else None
            route = raw.get("layerRoute")
            if route is not None and route not in {"A1", "A2", "B"}:
                raise ValueError(f"invalid layer route: {route}")
            elements.append(SceneElement(element_id, element_type, _bbox(raw.get("bbox_px"), width, height, element_id), int(raw.get("z_index", 0)), str(raw.get("content") or ""), dict(raw.get("style") or {}), asset, route))
        review_status = str(data.get("reviewStatus") or "rendered_pending_manual_review")
        if review_status not in {"planned", "generated", "rendered_pending_manual_review", "passed", "failed", "unverified"}:
            raise ValueError("invalid reviewStatus")
        review_raw = data.get("review"); review = {"reviewer": str((review_raw or {}).get("reviewer") or "").strip(), "evidence": str((review_raw or {}).get("evidence") or "").strip()} if isinstance(review_raw, dict) else None
        evidence_raw = data.get("renderBackEvidence") or []
        if not isinstance(evidence_raw, list):
            raise ValueError("renderBackEvidence must be a list")
        render_back_evidence = tuple(contained_path(root, str(path)) for path in evidence_raw)
        if review_status == "passed" and (not review or not review["reviewer"] or not review["evidence"] or not render_back_evidence):
            raise ValueError("passed scenes require reviewer evidence and contained render-back artifacts")
        return cls(1, str(data.get("slideId") or "slide-01"), width, height, contained_path(root, str(data.get("visual_master") or "")), contained_path(root, str(data.get("clean_plate") or "")), contained_path(root, str(data["repair_mask"])) if data.get("repair_mask") else None, tuple(sorted(elements, key=lambda element: element.z_index)), review_status, review, render_back_evidence)
