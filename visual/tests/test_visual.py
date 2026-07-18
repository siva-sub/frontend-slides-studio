import tempfile
import unittest
from pathlib import Path

from PIL import Image

from visual.slides_studio_visual.masking import changed_outside_mask, composite_masked_edit
from visual.slides_studio_visual.scene import VisualScene
from visual.slides_studio_visual.slots import fit_bbox_to_asset, render_corner_skeleton


class VisualTests(unittest.TestCase):
    def test_mask_locks_pixels_outside_region(self):
        original = Image.new("RGB", (4, 4), "white")
        edited = Image.new("RGB", (4, 4), "red")
        mask = Image.new("L", (4, 4), 0)
        mask.putpixel((1, 1), 255)
        result = composite_masked_edit(original, edited, mask)
        self.assertEqual(changed_outside_mask(original, result, mask), 0)
        self.assertEqual(result.getpixel((1, 1))[:3], (255, 0, 0))

    def test_slot_fit_and_corner_skeleton_share_bbox(self):
        bbox = fit_bbox_to_asset((0.5, 0.1, 0.4, 0.8), 1.0)
        self.assertLessEqual(bbox[2], 0.4)
        with tempfile.TemporaryDirectory() as directory:
            path = render_corner_skeleton(Path(directory) / "slot.png", bbox)
            self.assertTrue(path.is_file())
            with Image.open(path) as image:
                self.assertEqual(image.size, (1536, 864))

    def test_scene_passed_status_requires_bound_review_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new("RGB", (10, 10)).save(root / "master.png"); Image.new("RGB", (10, 10)).save(root / "plate.png")
            payload = {"schemaVersion": 1, "slideId": "s1", "canvas": {"width": 10, "height": 10}, "visual_master": "master.png", "clean_plate": "plate.png", "elements": [], "reviewStatus": "passed"}
            with self.assertRaisesRegex(ValueError, "passed scenes require"):
                VisualScene.from_dict(payload, root)
            (root / "render.pdf").write_bytes(b"%PDF-1.4")
            approved = VisualScene.from_dict({**payload, "review": {"reviewer": "Reviewer", "evidence": "Viewed render"}, "renderBackEvidence": ["render.pdf"]}, root)
            self.assertEqual(approved.review_status, "passed")
            self.assertEqual(approved.review["reviewer"], "Reviewer")

    def test_scene_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new("RGB", (10, 10)).save(root / "master.png")
            Image.new("RGB", (10, 10)).save(root / "plate.png")
            payload = {"schemaVersion": 1, "slideId": "s1", "canvas": {"width": 10, "height": 10}, "visual_master": "master.png", "clean_plate": "plate.png", "elements": [{"id": "bad", "type": "image_layer", "bbox_px": [0,0,5,5], "asset": "../outside.png"}]}
            with self.assertRaisesRegex(ValueError, "escapes job root"):
                VisualScene.from_dict(payload, root)


if __name__ == "__main__":
    unittest.main()
