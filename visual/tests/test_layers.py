import unittest

from PIL import Image
from visual.slides_studio_visual.layers import (
    LayerMetrics,
    SubjectRef,
    bboxes_overlap,
    choose_layer_strategy,
    composite_masked_layer,
    extract_rgba_layer,
    group_overlapping_subjects,
    layer_decision,
    split_group,
)

EPS = 1e-9


class RouteThresholdTests(unittest.TestCase):
    def test_a1_exact_inclusive_boundary(self):
        # all three at the exact ceiling -> A1
        self.assertEqual(choose_layer_strategy(LayerMetrics(0.90, 0.08, 0.20)), "A1")

    def test_a2_when_occlusion_above_ceiling(self):
        self.assertEqual(choose_layer_strategy(LayerMetrics(0.90, 0.08, 0.20 + EPS)), "A2")

    def test_b_when_confidence_below_floor(self):
        self.assertEqual(choose_layer_strategy(LayerMetrics(0.90 - EPS, 0.08, 0.10)), "B")

    def test_b_when_edge_above_ceiling(self):
        self.assertEqual(choose_layer_strategy(LayerMetrics(0.95, 0.08 + EPS, 0.10)), "B")

    def test_design_mode_forces_b_regardless_of_metrics(self):
        self.assertEqual(choose_layer_strategy(LayerMetrics(0.99, 0.0, 0.0), design_mode=True), "B")

    def test_metrics_reject_out_of_range(self):
        for bad in (-0.01, 1.01):
            with self.assertRaises(ValueError):
                LayerMetrics(bad, 0.0, 0.0)


class RouteEvidenceTests(unittest.TestCase):
    def test_decision_records_route_reason_metrics_and_thresholds(self):
        decision = layer_decision(LayerMetrics(0.90, 0.08, 0.20 + EPS))
        self.assertEqual(decision["route"], "A2")
        self.assertIn("occlusion", decision["reason"])
        self.assertEqual(decision["metrics"]["occlusion_ratio"], 0.20 + EPS)
        self.assertEqual(decision["thresholds"]["max_occlusion"], 0.20)
        self.assertFalse(decision["design_mode"])

    def test_explicit_route_override_must_be_valid(self):
        with self.assertRaises(ValueError):
            layer_decision(LayerMetrics(0.5, 0.5, 0.5), route="X")


class ExtractionTests(unittest.TestCase):
    def test_a1_extract_preserves_source_and_sets_alpha(self):
        source = Image.new("RGBA", (4, 4), (200, 50, 50, 255))
        source.putpixel((0, 0), (10, 20, 30, 255))
        mask = Image.new("L", (4, 4), 0)
        mask.putpixel((1, 1), 255)
        layer = extract_rgba_layer(source, mask)
        # source rgb preserved verbatim
        self.assertEqual(layer.getpixel((0, 0))[:3], (10, 20, 30))
        # alpha follows the mask
        self.assertEqual(layer.getpixel((0, 0))[3], 0)
        self.assertEqual(layer.getpixel((1, 1))[3], 255)

    def test_a2_composite_preserves_visible_repairs_masked(self):
        source = Image.new("RGB", (4, 4), (100, 100, 100))
        repair = Image.new("RGB", (4, 4), (0, 0, 0))
        mask = Image.new("L", (4, 4), 0)
        mask.putpixel((2, 2), 255)
        composited = composite_masked_layer(source, repair, mask)
        # visible source pixel preserved
        self.assertEqual(composited.getpixel((0, 0))[:3], (100, 100, 100))
        # masked pixel replaced by repair
        self.assertEqual(composited.getpixel((2, 2))[:3], (0, 0, 0))


class GroupingTests(unittest.TestCase):
    def test_overlapping_subjects_form_one_group(self):
        subjects = (
            SubjectRef("a", (0, 0, 20, 20)),
            SubjectRef("b", (10, 10, 30, 30)),
        )
        groups = group_overlapping_subjects(subjects)
        self.assertEqual(groups, (("a", "b"),))

    def test_non_overlapping_subjects_stay_separate(self):
        subjects = (
            SubjectRef("a", (0, 0, 10, 10)),
            SubjectRef("b", (50, 50, 60, 60)),
        )
        groups = group_overlapping_subjects(subjects)
        self.assertEqual(groups, (("a",), ("b",)))

    def test_transitive_chain_collapses(self):
        subjects = (
            SubjectRef("a", (0, 0, 20, 20)),
            SubjectRef("b", (10, 0, 30, 20)),
            SubjectRef("c", (25, 0, 45, 20)),  # overlaps b, not a directly
        )
        groups = group_overlapping_subjects(subjects)
        self.assertEqual(groups, (("a", "b", "c"),))

    def test_split_override_dissolves_group(self):
        self.assertEqual(split_group(("a", "b", "c")), (("a",), ("b",), ("c",)))

    def test_bboxes_overlap_excludes_touching(self):
        # flush-edge bboxes share no interior area -> not grouped
        self.assertFalse(bboxes_overlap((0, 0, 10, 10), (10, 0, 20, 10)))
        # genuine interior overlap -> grouped
        self.assertTrue(bboxes_overlap((0, 0, 15, 10), (10, 0, 20, 10)))


if __name__ == "__main__":
    unittest.main()
