# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# Original work in this module: deterministic contained evidence-bundle builder.
"""
Deterministic, contained evidence-bundle builder for a visual-master job.

Given a job root and an :class:`EvidencePlan`, writes a fully self-describing
evidence bundle and returns its manifest. Every written path is a safe relative
path inside the job root; symlinks and traversal attempts are rejected. The
bundle never claims a job *passed*: when real source assets are supplied the
review status is ``rendered_pending_manual_review`` (evidence present, manual
review pending); in plan-only mode it is ``planned``/``unverified``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from PIL import Image, ImageChops

from .edge_checks import (
    measure_edge_contamination,
    render_edge_check_black,
    render_edge_check_white,
)
from .layers import (
    ROUTE_DIRECT,
    ROUTE_MASKED,
    LayerMetrics,
    choose_layer_strategy,
    composite_masked_layer,
    extract_rgba_layer,
    layer_decision,
)
from .masking import changed_outside_mask, composite_masked_edit
from .placement import find_placement_candidate, render_overlay_trace

if TYPE_CHECKING:
    from .provider import ImageProvider

REVIEW_EVIDENCED = "rendered_pending_manual_review"
REVIEW_PLANNED = "planned"
REVIEW_UNVERIFIED = "unverified"
RENDER_BACK_PENDING = "rendered_pending_manual_review"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return _sha256_bytes(text.encode("utf-8"))


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _png_bytes(image: Image.Image) -> bytes:
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _safe_relative_target(root: Path, rel: str, *, must_exist: bool = False) -> Path:
    """
    Resolve ``rel`` under ``root`` rejecting traversal, absolute, and symlink escapes.

    Walks every path component and rejects any that is a symlink, then confirms
    the resolved target stays inside ``root``. Used for both reading reference
    inputs and computing write targets so no evidence path can escape the job.
    """
    root = root.resolve()
    if not isinstance(rel, str) or not rel:
        raise ValueError("relative path must be a non-empty string")
    if Path(rel).is_absolute():
        raise ValueError(f"absolute path rejected: {rel}")
    parts = [part for part in rel.replace("\\", "/").split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ValueError(f"path traversal rejected: {rel}")
    candidate = root.joinpath(*parts) if parts else root
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"symlink component rejected: {part}")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"path escapes job root: {rel}") from error
    if must_exist and not resolved.exists():
        raise ValueError(f"missing required path: {rel}")
    return resolved


def _safe_layer_id(layer_id: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in str(layer_id).strip())
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError(f"invalid layer id: {layer_id!r}")
    if "/" in str(layer_id) or "\\" in str(layer_id):
        raise ValueError(f"layer id must not contain a path separator: {layer_id!r}")
    return cleaned


@dataclass
class LayerSpec:
    """One subject layer and the metrics used to route it."""

    id: str
    mask: Image.Image
    metrics: LayerMetrics
    design_mode: bool = False
    route: str | None = None
    repair: Image.Image | None = None


@dataclass
class OverlaySpec:
    """A declared overlay target with alternative regions and protected rects."""

    bbox: tuple[float, float, float, float]
    alternatives: tuple[tuple[float, float, float, float], ...] = ()
    protected: tuple[tuple[float, float, float, float], ...] = ()


@dataclass
class ProviderSpec:
    """Credential-free provider boundary descriptor for the manifest."""

    name: str
    model: str
    quality: str
    capabilities: dict[str, bool] = field(default_factory=dict)


@dataclass
class EvidencePlan:
    """Inputs for a deterministic evidence bundle."""

    slide_id: str
    canvas: tuple[int, int]
    visual_master: Image.Image
    prompts: Mapping[str, str] = field(default_factory=dict)
    references: tuple[str, ...] = ()
    layers: tuple[LayerSpec, ...] = ()
    repair_mask: Image.Image | None = None
    clean_plate_candidate: Image.Image | None = None
    overlay: OverlaySpec | None = None
    provider: ProviderSpec | ImageProvider | None = None
    planned: bool = False


@dataclass(frozen=True)
class EvidenceBundle:
    """Result of building an evidence bundle."""

    job_root: Path
    manifest_path: Path
    manifest: dict[str, Any]
    files: tuple[str, ...]


def _provider_to_dict(provider: ProviderSpec | ImageProvider | None) -> dict[str, Any] | None:
    if provider is None:
        return None
    if isinstance(provider, ProviderSpec):
        return {
            "name": provider.name,
            "model": provider.model,
            "quality": provider.quality,
            "capabilities": dict(provider.capabilities),
        }
    # Anything else must implement the ImageProvider boundary (describe()).
    described = cast("ImageProvider", provider).describe()
    return {str(key): value for key, value in described.items()}


def _build_layer(
    visual_master: Image.Image,
    spec: LayerSpec,
    layers_dir: Path,
) -> dict[str, Any]:
    """Extract/repair one layer, write it, and return its evidence record."""
    if visual_master.size != spec.mask.size:
        raise ValueError(f"layer {spec.id!r} mask size must match visual master")
    layer_id = _safe_layer_id(spec.id)
    metrics = spec.metrics
    route = spec.route if spec.route is not None else choose_layer_strategy(metrics, spec.design_mode)
    decision = layer_decision(metrics, spec.design_mode, route)

    if route == ROUTE_DIRECT:
        layer_image = extract_rgba_layer(visual_master, spec.mask)
        extraction = {"method": "direct_rgba_extraction", "regeneration_planned": False}
    elif route == ROUTE_MASKED:
        repair = spec.repair if spec.repair is not None else visual_master
        if repair.size != spec.mask.size:
            raise ValueError(f"layer {spec.id!r} repair plate size must match mask")
        composited = composite_masked_layer(visual_master, repair, spec.mask)
        layer_image = extract_rgba_layer(composited, spec.mask)
        extraction = {"method": "masked_composite", "regeneration_planned": False}
    else:  # ROUTE_REGENERATE (B)
        layer_image = extract_rgba_layer(visual_master, spec.mask)
        extraction = {"method": "source_placeholder", "regeneration_planned": True}

    asset_rel = f"layers/{layer_id}.png"
    asset_path = _safe_relative_target(layers_dir.parent, asset_rel)
    asset_path.write_bytes(_png_bytes(layer_image))

    edge = measure_edge_contamination(layer_image, visual_master.size)
    record = dict(decision)
    record.update(
        {
            "id": spec.id,
            "asset": asset_rel,
            "assetHash": _sha256_file(asset_path),
            "dimensions": [layer_image.width, layer_image.height],
            "extraction": extraction,
            "edgeCheck": edge.as_dict(),
        }
    )
    return record


def _required_layer_mask(layers: tuple[LayerSpec, ...], size: tuple[int, int]) -> Image.Image:
    required = Image.new("L", size, 0)
    for spec in layers:
        if spec.mask.size != size:
            raise ValueError(f"layer {spec.id!r} mask size must match canvas")
        required = ImageChops.lighter(required, spec.mask.convert("L"))
    return required


def _verify_clean_plate(visual_master: Image.Image, clean_plate: Image.Image, repair_mask: Image.Image, layers: tuple[LayerSpec, ...]) -> dict[str, Any]:
    required = _required_layer_mask(layers, visual_master.size)
    required_values = list(required.getdata())
    repair_values = list(repair_mask.convert("L").getdata())
    uncovered = sum(1 for needed, covered in zip(required_values, repair_values, strict=True) if needed >= 128 and covered < 128)
    if uncovered:
        raise ValueError(f"repair mask leaves {uncovered} extracted-layer pixels in the clean plate")
    before = list(visual_master.convert("RGBA").getdata()); after = list(clean_plate.convert("RGBA").getdata())
    layer_changes: dict[str, int] = {}
    for spec in layers:
        mask_values = list(spec.mask.convert("L").getdata())
        changed = sum(1 for source, target, selected in zip(before, after, mask_values, strict=True) if selected >= 128 and source != target)
        if changed == 0:
            raise ValueError(f"clean plate does not replace any pixels for extracted layer {spec.id!r}")
        layer_changes[spec.id] = changed
    return {"requiredLayerPixels": sum(1 for value in required_values if value >= 128), "uncoveredLayerPixels": uncovered, "changedPixelsByLayer": layer_changes, "verifiedSeparated": True}


def _mask_evidence(mask: Image.Image) -> dict[str, Any]:
    light = mask.convert("L")
    values = list(light.getdata())
    white = sum(1 for value in values if value >= 128)
    black = sum(1 for value in values if value < 128)
    return {"replacePixels": white, "preservePixels": black, "totalPixels": len(values)}


def build_evidence_bundle(job_root: str | Path, plan: EvidencePlan) -> EvidenceBundle:
    """
    Write a deterministic contained evidence bundle and return its manifest.

    The review status is honest: ``rendered_pending_manual_review`` when real
    source assets are supplied, ``planned`` in plan-only mode. It is never set
    to ``passed``.
    """
    root = Path(job_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    width, height = plan.canvas
    if width <= 0 or height <= 0:
        raise ValueError("canvas dimensions must be positive")

    review_status = REVIEW_PLANNED if plan.planned else REVIEW_EVIDENCED
    render_back_status = REVIEW_PLANNED if plan.planned else RENDER_BACK_PENDING
    written: list[str] = []

    # visual-master
    visual_master = plan.visual_master.convert("RGBA")
    vm_path = _safe_relative_target(root, "visual-master.png")
    vm_bytes = _png_bytes(visual_master)
    vm_path.write_bytes(vm_bytes)
    written.append("visual-master.png")
    visual_master_hash = _sha256_bytes(vm_bytes)

    # repair-mask (optional)
    repair_mask = plan.repair_mask.convert("L") if plan.repair_mask is not None else None
    repair_mask_rel: str | None = None
    repair_mask_hash: str | None = None
    mask_evidence: dict[str, Any] | None = None
    if repair_mask is not None:
        if repair_mask.size != (width, height):
            raise ValueError("repair mask size must equal canvas")
        rm_path = _safe_relative_target(root, "repair-mask.png")
        rm_bytes = _png_bytes(repair_mask)
        rm_path.write_bytes(rm_bytes)
        repair_mask_rel = "repair-mask.png"
        repair_mask_hash = _sha256_bytes(rm_bytes)
        mask_evidence = _mask_evidence(repair_mask)
        written.append("repair-mask.png")

    # clean-plate: every extracted layer must be covered by a real repair candidate.
    if plan.layers and not plan.planned and (plan.clean_plate_candidate is None or repair_mask is None):
        raise ValueError("extracted layers require a clean plate candidate and a repair mask covering every layer")
    if plan.clean_plate_candidate is not None and repair_mask is not None:
        candidate = plan.clean_plate_candidate.convert("RGBA")
        if candidate.size != (width, height):
            raise ValueError("clean plate candidate size must equal canvas")
        clean_plate = composite_masked_edit(visual_master, candidate, repair_mask)
    else:
        clean_plate = visual_master.copy()
    clean_plate_evidence = _verify_clean_plate(visual_master, clean_plate, repair_mask, plan.layers) if plan.layers and repair_mask is not None else {"requiredLayerPixels": 0, "uncoveredLayerPixels": 0, "changedPixelsByLayer": {}, "verifiedSeparated": not plan.layers}
    cp_path = _safe_relative_target(root, "clean-plate.png")
    cp_bytes = _png_bytes(clean_plate)
    cp_path.write_bytes(cp_bytes)
    written.append("clean-plate.png")
    clean_plate_hash = _sha256_bytes(cp_bytes)

    # outside-change evidence for the clean plate vs visual master
    if repair_mask is not None:
        changed_outside = changed_outside_mask(visual_master, clean_plate, repair_mask)
    else:
        changed_outside = 0
    outside_evidence = {"changedOutsideMask": changed_outside, "repairMask": repair_mask_rel}

    # prompts + hashes
    prompt_hashes: dict[str, str] = {}
    prompts_dir = _safe_relative_target(root, "prompts")
    prompts_dir.mkdir(parents=True, exist_ok=True)
    for name in sorted(plan.prompts):
        text = str(plan.prompts[name])
        safe_name = _safe_layer_id(name)
        rel = f"prompts/{safe_name}.txt"
        target = _safe_relative_target(root, rel)
        target.write_text(text, encoding="utf-8")
        prompt_hashes[name] = _sha256_text(text)
        written.append(rel)
    for name in sorted(prompt_hashes):
        sha_rel = f"prompts/{_safe_layer_id(name)}.sha256"
        _safe_relative_target(root, sha_rel).write_text(prompt_hashes[name] + "\n", encoding="utf-8")
        written.append(sha_rel)

    # reference hashes (contained inputs)
    reference_hashes: dict[str, str] = {}
    for ref in plan.references:
        ref_path = _safe_relative_target(root, ref, must_exist=True)
        reference_hashes[ref] = _sha256_file(ref_path)

    # layers
    layers_dir = _safe_relative_target(root, "layers")
    layers_dir.mkdir(parents=True, exist_ok=True)
    layer_records: list[dict[str, Any]] = []
    for spec in plan.layers:
        record = _build_layer(visual_master, spec, layers_dir)
        layer_records.append(record)
        written.append(record["asset"])

    # edge-check white/black for the primary (first) layer, else the clean plate
    primary = layer_records[0] if layer_records else None
    edge_subject_path = (
        _safe_relative_target(root, primary["asset"], must_exist=True)
        if primary is not None
        else cp_path
    )
    with Image.open(edge_subject_path) as opened:
        edge_subject = opened.convert("RGBA")
    edge_white = render_edge_check_white(edge_subject, (width, height))
    edge_black = render_edge_check_black(edge_subject, (width, height))
    ew_path = _safe_relative_target(root, "edge-check-white.png")
    eb_path = _safe_relative_target(root, "edge-check-black.png")
    ew_path.write_bytes(_png_bytes(edge_white))
    eb_path.write_bytes(_png_bytes(edge_black))
    written.extend(["edge-check-white.png", "edge-check-black.png"])
    edge_check_record = {
        "white": "edge-check-white.png",
        "black": "edge-check-black.png",
        "primaryLayer": primary["id"] if primary is not None else None,
    }

    # overlay placement + trace
    overlay_records: list[dict[str, Any]] = []
    overlay_trace_rel: str | None = None
    if plan.overlay is not None:
        alternatives = list(plan.overlay.alternatives) or [plan.overlay.bbox]
        result = find_placement_candidate(alternatives, list(plan.overlay.protected))
        trace_rect = result.selected_rect if result.selected_rect is not None else plan.overlay.bbox
        trace_path = render_overlay_trace(_safe_relative_target(root, "overlay-trace.png"), trace_rect, (width, height))
        overlay_trace_rel = "overlay-trace.png"
        written.append("overlay-trace.png")
        overlay_records.append(
            {
                "bbox": list(plan.overlay.bbox),
                "selectedRect": list(result.selected_rect) if result.selected_rect is not None else None,
                "blocked": result.blocked,
                "attempts": result.attempts,
                "alternatives": len(plan.overlay.alternatives),
                "trace": overlay_trace_rel,
                "traceRect": list(trace_rect),
            }
        )

    provider_record = _provider_to_dict(plan.provider)

    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "slideId": plan.slide_id,
        "canvas": {"width": width, "height": height},
        "reviewStatus": review_status,
        "claimedPassed": False,
        "dimensions": {
            "visualMaster": [visual_master.width, visual_master.height],
            "cleanPlate": [clean_plate.width, clean_plate.height],
        },
        "assets": {
            "visualMaster": "visual-master.png",
            "cleanPlate": "clean-plate.png",
            "repairMask": repair_mask_rel,
            "edgeCheckWhite": "edge-check-white.png",
            "edgeCheckBlack": "edge-check-black.png",
            "overlayTrace": overlay_trace_rel,
        },
        "hashes": {
            "visualMaster": visual_master_hash,
            "cleanPlate": clean_plate_hash,
            "repairMask": repair_mask_hash,
            "prompts": dict(sorted(prompt_hashes.items())),
            "references": dict(sorted(reference_hashes.items())),
        },
        "provider": provider_record,
        "layers": layer_records,
        "overlays": overlay_records,
        "maskEvidence": mask_evidence,
        "outsideChangeEvidence": outside_evidence,
        "cleanPlateEvidence": clean_plate_evidence,
        "edgeChecks": edge_check_record,
        "renderBack": {
            "status": render_back_status,
            "claimedPassed": False,
            "evidence": ["visual-master", "clean-plate", "layers", "edge-check-white", "edge-check-black"],
        },
    }

    # quality-report.json mirrors the actionable metrics for quick triage
    quality_report = {
        "slideId": plan.slide_id,
        "reviewStatus": review_status,
        "claimedPassed": False,
        "outsideMaskChangedPixels": changed_outside,
        "cleanPlateSeparated": clean_plate_evidence["verifiedSeparated"],
        "layers": [
            {"id": rec["id"], "route": rec["route"], "metrics": rec["metrics"], "edgeCheck": rec["edgeCheck"]}
            for rec in layer_records
        ],
        "overlays": [
            {"blocked": rec["blocked"], "attempts": rec["attempts"], "alternatives": rec["alternatives"]}
            for rec in overlay_records
        ],
        "renderBackStatus": render_back_status,
    }
    qp_path = _safe_relative_target(root, "quality-report.json")
    _write_json(qp_path, quality_report)
    written.append("quality-report.json")

    # asset-plan.json: sanitized input plan (no image bytes, no secrets)
    asset_plan = {
        "slideId": plan.slide_id,
        "canvas": {"width": width, "height": height},
        "prompts": dict(sorted((name, str(text)) for name, text in plan.prompts.items())),
        "references": list(plan.references),
        "layers": [
            {
                "id": spec.id,
                "metrics": spec.metrics.as_dict(),
                "designMode": spec.design_mode,
                "explicitRoute": spec.route,
            }
            for spec in plan.layers
        ],
        "overlay": (
            {
                "bbox": list(plan.overlay.bbox),
                "alternatives": [list(rect) for rect in plan.overlay.alternatives],
                "protected": [list(rect) for rect in plan.overlay.protected],
            }
            if plan.overlay is not None
            else None
        ),
        "provider": provider_record,
        "planned": bool(plan.planned),
    }
    ap_path = _safe_relative_target(root, "asset-plan.json")
    _write_json(ap_path, asset_plan)
    written.append("asset-plan.json")

    # scene manifest
    scene_manifest = {
        "schemaVersion": 1,
        "slideId": plan.slide_id,
        "canvas": {"width": width, "height": height},
        "visual_master": "visual-master.png",
        "clean_plate": "clean-plate.png",
        "repair_mask": repair_mask_rel,
        "reviewStatus": review_status,
        "elements": [
            {
                "id": rec["id"],
                "type": "image_layer",
                "bbox_px": [0, 0, width, height],
                "asset": rec["asset"],
                "layerRoute": rec["route"],
            }
            for rec in layer_records
        ],
    }
    scene_path = _safe_relative_target(root, "scene.json")
    _write_json(scene_path, scene_manifest)
    written.append("scene.json")

    # render-back evidence placeholder
    rb_path = _safe_relative_target(root, "render-back.json")
    _write_json(rb_path, manifest["renderBack"])
    written.append("render-back.json")

    manifest_path = _safe_relative_target(root, "evidence-manifest.json")
    _write_json(manifest_path, manifest)
    written.append("evidence-manifest.json")

    return EvidenceBundle(root, manifest_path, manifest, tuple(sorted(set(written))))


__all__ = [
    "RENDER_BACK_PENDING",
    "REVIEW_EVIDENCED",
    "REVIEW_PLANNED",
    "REVIEW_UNVERIFIED",
    "EvidenceBundle",
    "EvidencePlan",
    "LayerSpec",
    "OverlaySpec",
    "ProviderSpec",
    "build_evidence_bundle",
]
