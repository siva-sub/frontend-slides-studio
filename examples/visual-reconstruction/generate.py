#!/usr/bin/env python3
# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# ----------------------------------------------------------------------------
# Deterministic, original compact reconstruction example. The tiny visual
# master, clean plate, layer, mask, edge checks, scene, and quality report are
# generated entirely by this script (no upstream binary is copied). The mask /
# letterbox / route technique is inspired by the Apache-2.0 gpt-image2-ppt-skills
# project; all pixels here are synthetic and produced by this repository.
# ----------------------------------------------------------------------------
"""
Generate a deterministic compact visual-reconstruction example bundle.

Run from the repository root::

    python3 examples/visual-reconstruction/generate.py [target_dir]

When no target is given the bundle is written next to this script. The output is
fully deterministic: two runs produce byte-identical images and identical JSON.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# Make the ``visual`` package importable when this script is run from any cwd.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from visual.slides_studio_visual.evidence import (  # noqa: E402
    EvidenceBundle,
    EvidencePlan,
    LayerSpec,
    OverlaySpec,
    ProviderSpec,
    build_evidence_bundle,
)
from visual.slides_studio_visual.layers import LayerMetrics  # noqa: E402
from visual.slides_studio_visual.provider import (  # noqa: E402
    CAPABILITY_MASKED_EDIT,
    CAPABILITY_ORDERED_REFERENCES,
    CAPABILITY_ORDINARY_GENERATION,
)

CANVAS = (64, 36)


def _visual_master() -> Image.Image:
    image = Image.new("RGB", CANVAS, (30, 40, 60))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 28, 28), fill=(220, 90, 54))  # primary subject block
    draw.rectangle((40, 6, 58, 30), fill=(90, 180, 200))  # secondary block to repair
    return image


def _subject_mask() -> Image.Image:
    mask = Image.new("L", CANVAS, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle((8, 8, 28, 28), fill=255)
    return mask


def _repair_mask() -> Image.Image:
    mask = Image.new("L", CANVAS, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle((8, 8, 28, 28), fill=255)  # remove extracted subject from plate
    draw.rectangle((40, 6, 58, 30), fill=255)
    return mask


def _clean_plate_candidate() -> Image.Image:
    return Image.new("RGB", CANVAS, (30, 40, 60))


def build_example(target_dir: str | Path) -> EvidenceBundle:
    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)
    plan = EvidencePlan(
        slide_id="example-slide",
        canvas=CANVAS,
        visual_master=_visual_master(),
        prompts={
            "generation": "Reconstruct the slide subject as a transparent layer.",
            "repair": "Repair the occluded background block only.",
        },
        layers=(
            LayerSpec(
                id="subject",
                mask=_subject_mask(),
                metrics=LayerMetrics(0.96, 0.01, 0.05),
            ),
        ),
        repair_mask=_repair_mask(),
        clean_plate_candidate=_clean_plate_candidate(),
        overlay=OverlaySpec(
            bbox=(0.1, 0.1, 0.3, 0.3),
            alternatives=((0.1, 0.1, 0.3, 0.3), (0.6, 0.1, 0.3, 0.3)),
            protected=((0.0, 0.0, 0.5, 1.0),),
        ),
        provider=ProviderSpec(
            name="openai",
            model="gpt-image-2",
            quality="high",
            capabilities={
                CAPABILITY_ORDINARY_GENERATION: True,
                CAPABILITY_MASKED_EDIT: True,
                CAPABILITY_ORDERED_REFERENCES: False,
            },
        ),
    )
    return build_evidence_bundle(target, plan)


def main(argv: list[str]) -> int:
    target = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent
    bundle = build_example(target)
    print(
        json.dumps(
            {
                "target": str(target),
                "status": bundle.manifest["reviewStatus"],
                "files": len(bundle.files),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
