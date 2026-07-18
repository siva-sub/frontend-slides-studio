import unittest

from PIL import Image
from visual.slides_studio_visual.masking import (
    changed_outside_mask,
    composite_masked_edit,
    make_api_edit_mask,
    prepare_letterboxed_edit,
    restore_letterboxed_edit,
)


class LetterboxTests(unittest.TestCase):
    def _image_and_mask(self) -> tuple[Image.Image, Image.Image]:
        image = Image.new("RGB", (80, 60), (120, 90, 200))
        mask = Image.new("L", (80, 60), 0)
        # white replace block (10,10)-(40,40)
        for x in range(10, 40):
            for y in range(10, 40):
                mask.putpixel((x, y), 255)
        return image, mask

    def test_prepare_fits_without_distortion_and_letterboxes(self):
        image, mask = self._image_and_mask()
        canvas, canvas_mask, box = prepare_letterboxed_edit(image, mask, (160, 90))
        # both canvases share the target size
        self.assertEqual(canvas.size, (160, 90))
        self.assertEqual(canvas_mask.size, (160, 90))
        left, top, width, height = box
        # content box stays inside the canvas
        self.assertGreaterEqual(left, 0)
        self.assertGreaterEqual(top, 0)
        self.assertLessEqual(left + width, 160)
        self.assertLessEqual(top + height, 90)
        # source aspect is preserved within rounding (80:60 == 4:3)
        self.assertAlmostEqual(width / height, 80 / 60, places=2)

    def test_prepare_mask_uses_nearest_and_stays_binary(self):
        image, mask = self._image_and_mask()
        _canvas, canvas_mask, box = prepare_letterboxed_edit(image, mask, (160, 90))
        # nearest-neighbour resampling must never introduce grey mask values
        values = set(canvas_mask.getdata())
        self.assertTrue(values.issubset({0, 255}), f"non-binary mask values: {values}")
        # outside the content box the mask is fully black (preserve)
        left, top, width, height = box
        self.assertEqual(canvas_mask.getpixel((0, 0)), 0)
        self.assertEqual(canvas_mask.getpixel((159, 89)), 0)
        # inside the content box some white pixels survive
        white_inside = sum(
            1
            for x in range(left, left + width)
            for y in range(top, top + height)
            if canvas_mask.getpixel((x, y)) == 255
        )
        self.assertGreater(white_inside, 0)

    def test_restore_roundtrip_restores_size_and_outside_mask_unchanged(self):
        image, mask = self._image_and_mask()
        canvas, _canvas_mask, box = prepare_letterboxed_edit(image, mask, (160, 90))
        restored = restore_letterboxed_edit(canvas, box, image.size)
        # size is restored exactly
        self.assertEqual(restored.size, image.size)
        # compositing the restored plate through the mask changes nothing outside it
        composited = composite_masked_edit(image, restored, mask)
        self.assertEqual(changed_outside_mask(image, composited, mask), 0)

    def test_restore_rejects_out_of_bounds_box(self):
        image, mask = self._image_and_mask()
        with self.assertRaises(ValueError):
            restore_letterboxed_edit(Image.new("RGB", (10, 10)), (5, 5, 10, 10), (10, 10))

    def test_prepare_rejects_mismatched_sizes(self):
        with self.assertRaises(ValueError):
            prepare_letterboxed_edit(Image.new("RGB", (10, 10)), Image.new("L", (12, 12)), (20, 20))


class MaskInversionTests(unittest.TestCase):
    def test_api_mask_inverts_internal_labels(self):
        internal = Image.new("L", (4, 4), 0)
        internal.putpixel((1, 1), 255)
        api_mask = make_api_edit_mask(internal)
        self.assertEqual(api_mask.mode, "RGBA")
        # preserve region (internal 0) -> opaque in api mask
        self.assertEqual(api_mask.getpixel((0, 0))[3], 255)
        # replace region (internal 255) -> transparent in api mask
        self.assertEqual(api_mask.getpixel((1, 1))[3], 0)


if __name__ == "__main__":
    unittest.main()
