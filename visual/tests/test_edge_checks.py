import unittest

from PIL import Image
from visual.slides_studio_visual.edge_checks import (
    measure_edge_contamination,
    render_edge_check_black,
    render_edge_check_white,
)


class EdgeCheckRenderTests(unittest.TestCase):
    def test_white_and_black_composites_have_correct_background(self):
        layer = Image.new("RGBA", (3, 3), (200, 100, 50, 255))
        white = render_edge_check_white(layer, (3, 3))
        black = render_edge_check_black(layer, (3, 3))
        self.assertEqual(white.size, (3, 3))
        self.assertEqual(black.size, (3, 3))
        # opaque subject: background fully covered -> same rgb on both
        self.assertEqual(white.getpixel((0, 0))[:3], (200, 100, 50))
        self.assertEqual(black.getpixel((0, 0))[:3], (200, 100, 50))
        # outputs are opaque (alpha 255) so they save as evidence without alpha
        self.assertEqual(white.getpixel((0, 0))[3], 255)

    def test_transparent_pixel_shows_background(self):
        layer = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
        white = render_edge_check_white(layer, (2, 2))
        black = render_edge_check_black(layer, (2, 2))
        self.assertEqual(white.getpixel((0, 0))[:3], (255, 255, 255))
        self.assertEqual(black.getpixel((0, 0))[:3], (0, 0, 0))


class EdgeContaminationMetricTests(unittest.TestCase):
    def test_opaque_subject_has_zero_contamination(self):
        layer = Image.new("RGBA", (4, 4), (200, 50, 50, 255))
        report = measure_edge_contamination(layer)
        self.assertEqual(report.contaminated_pixels, 0)
        self.assertEqual(report.footprint_pixels, 16)
        self.assertEqual(report.contamination_ratio, 0.0)
        self.assertEqual(report.max_edge_difference, 0)

    def test_fully_transparent_has_zero_footprint_and_zero_contamination(self):
        layer = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
        report = measure_edge_contamination(layer)
        self.assertEqual(report.footprint_pixels, 0)
        self.assertEqual(report.contaminated_pixels, 0)
        self.assertEqual(report.contamination_ratio, 0.0)

    def test_partial_alpha_pixels_count_as_contamination(self):
        layer = Image.new("RGBA", (4, 1), (200, 50, 50, 255))
        layer.putpixel((0, 0), (200, 50, 50, 128))  # partial halo
        layer.putpixel((3, 0), (200, 50, 50, 1))  # near-transparent halo
        report = measure_edge_contamination(layer)
        self.assertEqual(report.contaminated_pixels, 2)
        self.assertEqual(report.footprint_pixels, 4)
        self.assertAlmostEqual(report.contamination_ratio, 0.5)
        self.assertGreater(report.max_edge_difference, 0)

    def test_as_dict_is_deterministic(self):
        layer = Image.new("RGBA", (4, 4), (200, 50, 50, 255))
        layer.putpixel((0, 0), (200, 50, 50, 100))
        d = measure_edge_contamination(layer).as_dict()
        self.assertEqual(
            set(d),
            {
                "contaminated_pixels",
                "footprint_pixels",
                "total_pixels",
                "max_edge_difference",
                "contamination_ratio",
            },
        )


if __name__ == "__main__":
    unittest.main()
