import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

VISUAL_DIR = Path(__file__).resolve().parent.parent
CLI = VISUAL_DIR / "cli.py"


def _run(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    # The CLI imports ``slides_studio_visual.*`` directly, so it must run with
    # the visual/ package directory as cwd (no PYTHONPATH mutation, no network).
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        cwd=str(VISUAL_DIR),
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin"},
    )


def _seed(root: Path) -> None:
    Image.new("RGB", (32, 18), (120, 140, 160)).save(root / "master.png")
    mask = Image.new("L", (32, 18), 0)
    mask.putpixel((4, 4), 255)
    mask.save(root / "mask.png")
    Image.new("RGB", (32, 18), (20, 30, 40)).save(root / "clean-candidate.png")
    plan = {
        "slideId": "s1",
        "canvas": {"width": 32, "height": 18},
        "visualMaster": "master.png",
        "repairMask": "mask.png",
        "cleanPlateCandidate": "clean-candidate.png",
        "prompts": {"generation": "make a slide"},
        "layers": [
            {
                "id": "subj-a",
                "mask": "mask.png",
                "confidence": 0.95,
                "edgeContamination": 0.02,
                "occlusion": 0.10,
            }
        ],
        "overlay": {
            "bbox": [0.1, 0.1, 0.3, 0.3],
            "alternatives": [[0.1, 0.1, 0.3, 0.3], [0.6, 0.6, 0.3, 0.3]],
            "protected": [[0.0, 0.0, 0.5, 0.5]],
        },
        "provider": {"name": "openai", "model": "gpt-image-2", "quality": "high"},
    }
    (root / "plan.json").write_text(json.dumps(plan))


class CliSubcommandWiringTests(unittest.TestCase):
    def test_help_lists_all_six_subcommands(self):
        result = _run(["--help"], VISUAL_DIR)
        self.assertEqual(result.returncode, 0, result.stderr)
        for command in (
            "generate",
            "edit",
            "reconstruct",
            "route-layer",
            "build-evidence",
            "place-overlay",
        ):
            self.assertIn(command, result.stdout)


class CliNonNetworkSmokeTests(unittest.TestCase):
    def test_route_layer_outputs_route_decision(self):
        result = _run(
            [
                "route-layer",
                "--confidence",
                "0.95",
                "--edge-contamination",
                "0.02",
                "--occlusion",
                "0.10",
            ],
            VISUAL_DIR,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["route"], "A1")

    def test_build_evidence_requires_job_root_and_writes_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _seed(root)
            result = _run(
                ["build-evidence", "--job-root", str(root), "--plan", "plan.json"], VISUAL_DIR
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["status"], "rendered_pending_manual_review")
            self.assertTrue((root / "evidence-manifest.json").is_file())
            self.assertTrue((root / "visual-master.png").is_file())

    def test_build_evidence_rejects_missing_job_root(self):
        result = _run(["build-evidence", "--plan", "plan.json"], VISUAL_DIR)
        self.assertNotEqual(result.returncode, 0)

    def test_place_overlay_writes_trace_and_reports_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            overlay = {
                "bbox": [0.1, 0.1, 0.3, 0.3],
                "alternatives": [[0.1, 0.1, 0.3, 0.3], [0.6, 0.6, 0.3, 0.3]],
                "protected": [[0.0, 0.0, 0.5, 0.5]],
            }
            (root / "overlay.json").write_text(json.dumps(overlay))
            result = _run(
                ["place-overlay", "--job-root", str(root), "--overlay", "overlay.json"], VISUAL_DIR
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["placement"]["selected_index"], 1)
            self.assertFalse(payload["placement"]["blocked"])
            self.assertTrue((root / "overlay-trace.png").is_file())


if __name__ == "__main__":
    unittest.main()
