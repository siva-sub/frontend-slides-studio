import json
import os
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from visual.slides_studio_visual.evidence import (
    EvidencePlan,
    LayerSpec,
    OverlaySpec,
    ProviderSpec,
    _safe_relative_target,
    build_evidence_bundle,
)
from visual.slides_studio_visual.layers import LayerMetrics

SECRET_MARKERS = (
    "apikey",
    "api_key",
    "baseUrl",
    "base_url",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "secret",
)


def _seed_job(root: Path) -> EvidencePlan:
    Image.new("RGB", (32, 18), (120, 140, 160)).save(root / "master.png")
    mask = Image.new("L", (32, 18), 0)
    mask.putpixel((4, 4), 255)
    mask.putpixel((5, 5), 255)
    mask.save(root / "mask.png")
    Image.new("RGB", (32, 18), (220, 200, 180)).save(root / "repair.png")
    (root / "ref.png").write_bytes(b"reference-bytes")
    return EvidencePlan(
        slide_id="s1",
        canvas=(32, 18),
        visual_master=Image.new("RGB", (32, 18), (10, 20, 30)),
        prompts={"generation": "make a slide", "repair": "fix the background"},
        references=("ref.png",),
        layers=(
            LayerSpec(
                id="subj-a",
                mask=Image.open(root / "mask.png").convert("L"),
                metrics=LayerMetrics(0.95, 0.02, 0.10),
                repair=Image.open(root / "repair.png").convert("RGB"),
            ),
            LayerSpec(
                id="subj-b",
                mask=Image.open(root / "mask.png").convert("L"),
                metrics=LayerMetrics(0.95, 0.02, 0.30),  # A2
            ),
            LayerSpec(
                id="subj-c",
                mask=Image.open(root / "mask.png").convert("L"),
                metrics=LayerMetrics(0.50, 0.02, 0.10),  # B
            ),
        ),
        repair_mask=Image.open(root / "mask.png").convert("L"),
        clean_plate_candidate=Image.open(root / "repair.png").convert("RGB"),
        overlay=OverlaySpec(
            bbox=(0.1, 0.1, 0.3, 0.3),
            alternatives=((0.1, 0.1, 0.3, 0.3), (0.6, 0.6, 0.3, 0.3)),
            protected=((0.0, 0.0, 0.5, 0.5),),
        ),
        provider=ProviderSpec(name="openai", model="gpt-image-2", quality="high"),
    )


class EvidenceInventoryTests(unittest.TestCase):
    def _required_files(self) -> set[str]:
        return {
            "asset-plan.json",
            "clean-plate.png",
            "edge-check-black.png",
            "edge-check-white.png",
            "evidence-manifest.json",
            "overlay-trace.png",
            "quality-report.json",
            "render-back.json",
            "repair-mask.png",
            "scene.json",
            "visual-master.png",
            "layers/subj-a.png",
            "layers/subj-b.png",
            "layers/subj-c.png",
            "prompts/generation.txt",
            "prompts/generation.sha256",
            "prompts/repair.txt",
            "prompts/repair.sha256",
        }

    def test_bundle_writes_full_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = build_evidence_bundle(root, _seed_job(root))
            written = set()
            for path in root.rglob("*"):
                if path.is_file():
                    written.add(path.relative_to(root).as_posix())
            # every required output exists on disk
            self.assertEqual(self._required_files() - written, set())
            # every file the builder reports is actually present
            self.assertEqual(set(bundle.files) - written, set())


class EvidenceManifestTests(unittest.TestCase):
    def test_manifest_records_hashes_dimensions_routes_and_review_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = build_evidence_bundle(root, _seed_job(root))
            manifest = bundle.manifest
            # honest review state: never claimed passed
            self.assertEqual(manifest["reviewStatus"], "rendered_pending_manual_review")
            self.assertFalse(manifest["claimedPassed"])
            self.assertFalse(manifest["renderBack"]["claimedPassed"])
            self.assertEqual(manifest["renderBack"]["status"], "rendered_pending_manual_review")
            # hashes present and correct
            self.assertEqual(
                manifest["hashes"]["visualMaster"],
                _sha256_file(root / "visual-master.png"),
            )
            self.assertEqual(
                manifest["hashes"]["prompts"]["generation"], _sha256_text("make a slide")
            )
            self.assertEqual(
                manifest["hashes"]["references"]["ref.png"], _sha256_file(root / "ref.png")
            )
            # dimensions
            self.assertEqual(manifest["dimensions"]["visualMaster"], [32, 18])
            # A1/A2/B decisions recorded with reason + metrics
            routes = {layer["id"]: layer for layer in manifest["layers"]}
            self.assertEqual(routes["subj-a"]["route"], "A1")
            self.assertEqual(routes["subj-b"]["route"], "A2")
            self.assertEqual(routes["subj-c"]["route"], "B")
            for record in routes.values():
                self.assertIn("reason", record)
                self.assertIn("metrics", record)
                self.assertIn("thresholds", record)
            # mask + outside-change + clean-plate separation + edge evidence present
            self.assertIn("replacePixels", manifest["maskEvidence"])
            self.assertEqual(manifest["outsideChangeEvidence"]["changedOutsideMask"], 0)
            self.assertTrue(manifest["cleanPlateEvidence"]["verifiedSeparated"])
            self.assertEqual(manifest["cleanPlateEvidence"]["uncoveredLayerPixels"], 0)
            self.assertEqual(manifest["edgeChecks"]["primaryLayer"], "subj-a")
            # real overlays recorded
            self.assertEqual(len(manifest["overlays"]), 1)
            self.assertEqual(manifest["overlays"][0]["selectedRect"], [0.6, 0.6, 0.3, 0.3])

    def test_extracted_layers_require_a_separated_clean_plate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = _seed_job(root)
            missing_candidate = EvidencePlan(slide_id=plan.slide_id, canvas=plan.canvas, visual_master=plan.visual_master, layers=plan.layers, repair_mask=plan.repair_mask)
            with self.assertRaisesRegex(ValueError, "clean plate candidate"):
                build_evidence_bundle(root, missing_candidate)
            empty_mask = Image.new("L", plan.canvas, 0)
            uncovered = EvidencePlan(slide_id=plan.slide_id, canvas=plan.canvas, visual_master=plan.visual_master, layers=plan.layers, repair_mask=empty_mask, clean_plate_candidate=plan.clean_plate_candidate)
            with self.assertRaisesRegex(ValueError, "leaves .* extracted-layer pixels"):
                build_evidence_bundle(root, uncovered)

    def test_provider_report_has_no_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = build_evidence_bundle(root, _seed_job(root)).manifest
            blob = json.dumps(manifest["provider"])
            for marker in SECRET_MARKERS:
                self.assertNotIn(marker, blob)
            self.assertEqual(manifest["provider"]["name"], "openai")
            self.assertIn("capabilities", manifest["provider"])

    def test_planned_mode_uses_planned_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = _seed_job(root)
            plan = EvidencePlan(
                slide_id=plan.slide_id,
                canvas=plan.canvas,
                visual_master=plan.visual_master,
                prompts=plan.prompts,
                planned=True,
            )
            manifest = build_evidence_bundle(root, plan).manifest
            self.assertEqual(manifest["reviewStatus"], "planned")
            self.assertEqual(manifest["renderBack"]["status"], "planned")


class EvidenceContainmentTests(unittest.TestCase):
    def test_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                _safe_relative_target(root, "../escape.png")

    def test_absolute_path_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                _safe_relative_target(root, "/etc/passwd")

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "outside.txt"
            target.write_text("data")
            link = root / "evil.png"
            os.symlink(target, link)
            with self.assertRaises(ValueError):
                _safe_relative_target(root, "evil.png", must_exist=True)

    def test_reference_must_exist_and_be_contained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = _seed_job(root)
            plan = EvidencePlan(
                slide_id=plan.slide_id,
                canvas=plan.canvas,
                visual_master=plan.visual_master,
                references=("../missing.png",),
            )
            with self.assertRaises(ValueError):
                build_evidence_bundle(root, plan)


class EvidenceDeterminismTests(unittest.TestCase):
    def test_two_builds_produce_identical_manifests_and_images(self):
        manifests = []
        image_hashes = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                build_evidence_bundle(root, _seed_job(root))
                manifests.append((root / "evidence-manifest.json").read_text())
                image_hashes.append(_sha256_file(root / "visual-master.png"))
        self.assertEqual(manifests[0], manifests[1])
        self.assertEqual(image_hashes[0], image_hashes[1])


def _sha256_file(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha256_text(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    unittest.main()
