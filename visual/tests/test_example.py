import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "examples" / "visual-reconstruction" / "generate.py"

REQUIRED = {
    "visual-master.png",
    "clean-plate.png",
    "repair-mask.png",
    "layers/subject.png",
    "edge-check-white.png",
    "edge-check-black.png",
    "overlay-trace.png",
    "scene.json",
    "quality-report.json",
    "evidence-manifest.json",
}


def _run(target: Path) -> None:
    subprocess.run(
        [sys.executable, str(GENERATOR), str(target)],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )


class ExampleReconstructionTests(unittest.TestCase):
    def test_committed_bundle_contains_required_files(self):
        example_dir = GENERATOR.parent
        for name in REQUIRED:
            self.assertTrue(
                (example_dir / name).is_file(), f"missing committed example file: {name}"
            )
        self.assertTrue((example_dir / "README.md").is_file())

    def test_generator_is_deterministic(self):
        snapshots = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _run(root)
                manifest = (root / "evidence-manifest.json").read_text()
                visual_master = hashlib.sha256(
                    (root / "visual-master.png").read_bytes()
                ).hexdigest()
                layer = hashlib.sha256((root / "layers" / "subject.png").read_bytes()).hexdigest()
                snapshots.append((manifest, visual_master, layer))
        self.assertEqual(snapshots[0], snapshots[1])

    def test_generated_bundle_honest_review_state(self):
        import json

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _run(root)
            manifest = json.loads((root / "evidence-manifest.json").read_text())
            self.assertEqual(manifest["reviewStatus"], "rendered_pending_manual_review")
            self.assertFalse(manifest["claimedPassed"])


if __name__ == "__main__":
    unittest.main()
