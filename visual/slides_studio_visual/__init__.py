"""Contained visual-master tooling for Frontend Slides Studio."""

from .edge_checks import EdgeContaminationReport, measure_edge_contamination
from .evidence import EvidenceBundle, EvidencePlan, build_evidence_bundle
from .layers import (
    LayerMetrics,
    choose_layer_strategy,
    composite_masked_layer,
    extract_rgba_layer,
    group_overlapping_subjects,
    layer_decision,
)
from .masking import (
    changed_outside_mask,
    composite_masked_edit,
    make_api_edit_mask,
    prepare_letterboxed_edit,
    restore_letterboxed_edit,
)
from .placement import PlacementResult, find_placement_candidate, render_overlay_trace
from .scene import VisualScene
from .slots import fit_bbox_to_asset, render_corner_skeleton

__all__ = [
    "EdgeContaminationReport",
    "EvidenceBundle",
    "EvidencePlan",
    "LayerMetrics",
    "PlacementResult",
    "VisualScene",
    "build_evidence_bundle",
    "changed_outside_mask",
    "choose_layer_strategy",
    "composite_masked_edit",
    "composite_masked_layer",
    "extract_rgba_layer",
    "find_placement_candidate",
    "fit_bbox_to_asset",
    "group_overlapping_subjects",
    "layer_decision",
    "make_api_edit_mask",
    "measure_edge_contamination",
    "prepare_letterboxed_edit",
    "render_corner_skeleton",
    "render_overlay_trace",
    "restore_letterboxed_edit",
]
