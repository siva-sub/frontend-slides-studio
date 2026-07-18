import math
import unittest

from motion.src.analyzer import EnergyPoint, detect_beats, fit_easing, loop_period, segment_energy


class AnalyzerTests(unittest.TestCase):
    def test_segments_holds_and_motion(self):
        points = [EnergyPoint(index * 50, 0.1 if index < 4 or index > 10 else 8.0) for index in range(15)]
        kinds = [segment.kind for segment in segment_energy(points, minimum_hold_ms=100)]
        self.assertEqual(kinds, ["hold", "motion", "hold"])

    def test_detects_repeated_period(self):
        points = [EnergyPoint(index * 50, 5 + math.sin(index * math.pi / 4)) for index in range(80)]
        period = loop_period(points)
        self.assertIsNotNone(period)
        self.assertAlmostEqual(period, 400, delta=60)

    def test_easing_and_beats_are_hints(self):
        points = [EnergyPoint(index * 100, value) for index, value in enumerate([0, 1, 2, 5, 9, 3, 1, 0])]
        self.assertIsInstance(fit_easing(points), str)
        self.assertGreaterEqual(len(detect_beats(points)), 1)


if __name__ == "__main__":
    unittest.main()
