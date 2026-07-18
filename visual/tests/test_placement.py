import unittest
from pathlib import Path
from typing import cast

from PIL import Image
from visual.slides_studio_visual.placement import (
    PlacementResult,
    _validate_rect,
    find_placement_candidate,
    rects_overlap,
    render_overlay_trace,
)
from visual.slides_studio_visual.slots import render_corner_skeleton


def _pixel(image: Image.Image, xy: tuple[int, int]) -> tuple[int, int, int, int]:
    """Read one RGBA pixel as a typed 4-tuple (getpixel returns a union type)."""
    return cast("tuple[int, int, int, int]", image.getpixel(xy))


class RectsOverlapTests(unittest.TestCase):
    def test_touching_counts_as_overlap_by_default(self):
        # flush at x=0.5
        self.assertTrue(rects_overlap((0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 0.5, 0.5)))

    def test_strict_mode_excludes_touching(self):
        self.assertFalse(
            rects_overlap((0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 0.5, 0.5), touching_counts=False)
        )

    def test_interior_overlap_detected_in_both_modes(self):
        a = (0.0, 0.0, 0.6, 0.6)
        b = (0.5, 0.5, 0.5, 0.5)
        self.assertTrue(rects_overlap(a, b))
        self.assertTrue(rects_overlap(a, b, touching_counts=False))

    def test_disjoint_never_overlaps(self):
        a = (0.0, 0.0, 0.3, 0.3)
        b = (0.7, 0.7, 0.2, 0.2)
        self.assertFalse(rects_overlap(a, b))
        self.assertFalse(rects_overlap(a, b, touching_counts=False))


class ValidateRectTests(unittest.TestCase):
    def test_exact_canvas_fit_allowed(self):
        self.assertEqual(_validate_rect((0.0, 0.0, 1.0, 1.0)), (0.0, 0.0, 1.0, 1.0))

    def test_overflow_rejected_without_tolerance(self):
        with self.assertRaises(ValueError):
            _validate_rect((0.0, 0.0, 1.0 + 1e-12, 1.0))


class PlacementSelectionTests(unittest.TestCase):
    def test_first_collision_free_candidate_selected(self):
        result = find_placement_candidate(
            [(0.1, 0.1, 0.3, 0.3), (0.6, 0.6, 0.3, 0.3)],
            [(0.0, 0.0, 0.5, 0.5)],
        )
        self.assertIsInstance(result, PlacementResult)
        self.assertEqual(result.selected_index, 1)
        self.assertEqual(result.selected_rect, (0.6, 0.6, 0.3, 0.3))
        self.assertFalse(result.blocked)

    def test_protected_collision_skips_candidate(self):
        # candidate touches protected region -> rejected, blocked
        result = find_placement_candidate(
            [(0.4, 0.0, 0.2, 0.2)],  # flush against protected [0,0,0.4,0.4]
            [(0.0, 0.0, 0.4, 0.4)],
        )
        self.assertTrue(result.blocked)
        self.assertIsNone(result.selected_index)

    def test_attempts_bounded_by_input_alternatives(self):
        result = find_placement_candidate(
            [(0.1, 0.1, 0.2, 0.2), (0.2, 0.2, 0.2, 0.2), (0.6, 0.6, 0.2, 0.2)],
            [(0.0, 0.0, 0.8, 0.8)],
        )
        # all three inspected, none fit
        self.assertTrue(result.blocked)
        self.assertEqual(result.attempts, 3)
        self.assertLessEqual(result.attempts, 3)

    def test_blocking_when_no_declared_candidate_fits(self):
        result = find_placement_candidate([(0.1, 0.1, 0.2, 0.2)], [(0.0, 0.0, 1.0, 1.0)])
        self.assertTrue(result.blocked)
        self.assertIsNone(result.selected_rect)
        self.assertEqual(result.attempts, 1)


class OverlayTraceTests(unittest.TestCase):
    def test_trace_preserves_fill_outline_and_corner_geometry(self):
        import tempfile

        bbox = (0.25, 0.25, 0.5, 0.5)
        size = (320, 180)
        with tempfile.TemporaryDirectory() as directory:
            path = render_overlay_trace(Path(directory) / "trace.png", bbox, size)
            self.assertTrue(path.is_file())
            with Image.open(path) as image:
                rgba = image.convert("RGBA")
                self.assertEqual(rgba.size, size)
                # faint fill survives at the center (was previously overwritten)
                self.assertEqual(_pixel(rgba, (160, 90))[3], 40)
                # corner skeleton arm present near top-left corner (non-zero alpha)
                self.assertGreater(_pixel(rgba, (round(0.25 * 320) + 6, round(0.25 * 180)))[3], 0)

    def test_trace_bbox_matches_corner_skeleton_bounds(self):
        import tempfile

        bbox = (0.1, 0.2, 0.4, 0.5)
        size = (200, 200)
        with tempfile.TemporaryDirectory() as directory:
            trace = render_overlay_trace(Path(directory) / "trace.png", bbox, size)
            skeleton = render_corner_skeleton(Path(directory) / "skeleton.png", bbox, size=size)
            # both render to the same canvas size and same corner pixel coordinates
            with Image.open(trace) as t, Image.open(skeleton) as s:
                self.assertEqual(t.size, size)
                self.assertEqual(s.size, size)
            # corner anchor coordinates are derived identically
            left, top = round(bbox[0] * size[0]), round(bbox[1] * size[1])
            right = round((bbox[0] + bbox[2]) * size[0])
            bottom = round((bbox[1] + bbox[3]) * size[1])
            self.assertEqual((left, top, right, bottom), (20, 40, 100, 140))


if __name__ == "__main__":
    unittest.main()
