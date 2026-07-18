#!/usr/bin/env python3
# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
"""
Explicit visual-master CLI; no provider calls occur without a subcommand.

Provider credentials are read from the environment only when a network
subcommand (``generate`` / ``edit``) is actually invoked. Importing this module
performs no network access and no environment discovery. Non-network commands
that touch files (``build-evidence`` / ``place-overlay``) require a
``--job-root`` and resolve every input/output as a contained relative path.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from PIL import Image
from slides_studio_visual.evidence import (
    EvidencePlan,
    LayerSpec,
    OverlaySpec,
    ProviderSpec,
    build_evidence_bundle,
)
from slides_studio_visual.layers import LayerMetrics, layer_decision
from slides_studio_visual.placement import find_placement_candidate, render_overlay_trace
from slides_studio_visual.provider import OpenAIImageProvider
from slides_studio_visual.scene import VisualScene, contained_path


def _contained(root: Path, rel: str) -> Path:
    return contained_path(root, rel)


def _rect4(seq: object) -> tuple[float, float, float, float]:
    """Coerce a JSON ``[x, y, w, h]`` sequence into a typed normalized rect."""
    if not isinstance(seq, (list, tuple)) or len(seq) != 4:
        raise ValueError(f"rect must be [x, y, w, h], got {seq!r}")
    return (float(seq[0]), float(seq[1]), float(seq[2]), float(seq[3]))


def _load_evidence_plan(job_root: Path, plan_rel: str) -> EvidencePlan:
    """
    Load an EvidencePlan from a contained JSON plan file under job_root.

    Image inputs are referenced by safe relative paths inside the job root.
    """
    plan_path = _contained(job_root, plan_rel)
    data = json.loads(plan_path.read_text(encoding="utf-8"))
    canvas = data.get("canvas") or {}
    width, height = int(canvas.get("width", 0)), int(canvas.get("height", 0))
    if width <= 0 or height <= 0:
        raise ValueError("plan canvas must be positive")

    def _image(rel: str | None) -> Image.Image | None:
        if not rel:
            return None
        return Image.open(_contained(job_root, str(rel))).copy()

    visual_master = _image(data.get("visualMaster"))
    if visual_master is None:
        raise ValueError("plan.visualMaster is required")

    layers: list[LayerSpec] = []
    for raw in data.get("layers") or []:
        mask = _image(raw.get("mask"))
        if mask is None:
            raise ValueError(f"layer {raw.get('id')!r} requires a mask")
        metrics = LayerMetrics(
            float(raw.get("confidence", 0.0)),
            float(raw.get("edgeContamination", 0.0)),
            float(raw.get("occlusion", 0.0)),
        )
        layers.append(
            LayerSpec(
                id=str(raw["id"]),
                mask=mask,
                metrics=metrics,
                design_mode=bool(raw.get("designMode", False)),
                route=raw.get("route"),
                repair=_image(raw.get("repair")),
            )
        )

    overlay_raw = data.get("overlay")
    overlay: OverlaySpec | None = None
    if overlay_raw is not None:
        bbox = _rect4(overlay_raw["bbox"])
        alts = tuple(_rect4(rect) for rect in overlay_raw.get("alternatives") or [])
        prot = tuple(_rect4(rect) for rect in overlay_raw.get("protected") or [])
        overlay = OverlaySpec(bbox=bbox, alternatives=alts, protected=prot)

    provider_raw = data.get("provider")
    provider: ProviderSpec | None = None
    if provider_raw is not None:
        provider = ProviderSpec(
            name=str(provider_raw.get("name", "")),
            model=str(provider_raw.get("model", "")),
            quality=str(provider_raw.get("quality", "")),
            capabilities=dict(provider_raw.get("capabilities") or {}),
        )

    return EvidencePlan(
        slide_id=str(data.get("slideId") or "slide-01"),
        canvas=(width, height),
        visual_master=visual_master,
        prompts=dict(data.get("prompts") or {}),
        references=tuple(str(ref) for ref in data.get("references") or []),
        layers=tuple(layers),
        repair_mask=_image(data.get("repairMask")),
        clean_plate_candidate=_image(data.get("cleanPlateCandidate")),
        overlay=overlay,
        provider=provider,
        planned=bool(data.get("planned", False)),
    )


def _build_subparsers(sub: argparse._SubParsersAction) -> None:
    generate = sub.add_parser("generate", help="network: generate an image via the provider")
    generate.add_argument("--prompt", required=True)
    generate.add_argument("--output", required=True)

    edit = sub.add_parser("edit", help="network: masked edit via the provider")
    edit.add_argument("--prompt", required=True)
    edit.add_argument("--image", required=True)
    edit.add_argument("--mask", required=True)
    edit.add_argument("--output", required=True)

    validate = sub.add_parser("reconstruct", help="load and summarize a contained scene")
    validate.add_argument("--scene", required=True)
    validate.add_argument("--job-root", required=True)

    route = sub.add_parser("route-layer", help="non-network: choose A1/A2/B from metrics")
    route.add_argument("--confidence", type=float, required=True)
    route.add_argument("--edge-contamination", type=float, required=True)
    route.add_argument("--occlusion", type=float, required=True)
    route.add_argument("--design-mode", action="store_true")

    evidence = sub.add_parser(
        "build-evidence", help="non-network: build a contained evidence bundle"
    )
    evidence.add_argument("--job-root", required=True)
    evidence.add_argument("--plan", required=True)

    place = sub.add_parser(
        "place-overlay", help="non-network: place a declared overlay under job-root"
    )
    place.add_argument("--job-root", required=True)
    place.add_argument("--overlay", required=True)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="slides-studio visual")
    sub = parser.add_subparsers(dest="command", required=True)
    _build_subparsers(sub)
    args = parser.parse_args(argv)

    if args.command == "generate":
        print(OpenAIImageProvider().generate(args.prompt, args.output))
    elif args.command == "edit":
        print(
            OpenAIImageProvider().edit(args.prompt, Path(args.image), Path(args.mask), args.output)
        )
    elif args.command == "reconstruct":
        job_root = Path(args.job_root)
        payload = json.loads(_contained(job_root, args.scene).read_text(encoding="utf-8"))
        scene = VisualScene.from_dict(payload, job_root)
        print(
            json.dumps(
                {
                    "slideId": scene.slide_id,
                    "objects": len(scene.elements),
                    "status": scene.review_status,
                }
            )
        )
    elif args.command == "route-layer":
        metrics = LayerMetrics(args.confidence, args.edge_contamination, args.occlusion)
        print(json.dumps(layer_decision(metrics, args.design_mode), indent=2, sort_keys=True))
    elif args.command == "build-evidence":
        job_root = Path(args.job_root)
        plan = _load_evidence_plan(job_root, args.plan)
        bundle = build_evidence_bundle(job_root, plan)
        print(
            json.dumps(
                {
                    "jobRoot": str(job_root),
                    "manifest": str(bundle.manifest_path.relative_to(job_root.resolve())),
                    "status": bundle.manifest["reviewStatus"],
                    "files": len(bundle.files),
                },
                indent=2,
                sort_keys=True,
            )
        )
    elif args.command == "place-overlay":
        job_root = Path(args.job_root)
        spec = json.loads(_contained(job_root, args.overlay).read_text(encoding="utf-8"))
        bbox = _rect4(spec["bbox"])
        alternatives = [_rect4(rect) for rect in spec.get("alternatives") or [bbox]]
        protected = [_rect4(rect) for rect in spec.get("protected") or []]
        result = find_placement_candidate(alternatives, protected)
        trace_rect: tuple[float, float, float, float] = (
            result.selected_rect if result.selected_rect is not None else bbox
        )
        trace_path = render_overlay_trace((job_root.resolve() / "overlay-trace.png"), trace_rect)
        print(
            json.dumps(
                {
                    "placement": result.as_dict(),
                    "trace": str(trace_path.relative_to(job_root.resolve())),
                },
                indent=2,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
