"""Motion timing analyzer.

Adapted from Motiscope (MIT), commit 91300a0b1234a654907b795ce4d4d74a83f59651.
Copyright (c) 2026 Kumar Sashank Ghanta.
Modified by Frontend Slides Studio: standard-library frame analysis, versioned output,
and explicit caveats. This module measures WHEN; it never guesses WHAT element moved.
"""

from __future__ import annotations

import json
import math
import statistics
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class EnergyPoint:
    timeMs: float
    value: float


@dataclass(frozen=True)
class Segment:
    startMs: float
    endMs: float
    kind: str


def _probe(path: Path) -> tuple[float, float, int, int]:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,width,height:format=duration", "-of", "json", str(path)
    ], check=True, capture_output=True, text=True)
    payload = json.loads(result.stdout)
    stream = payload["streams"][0]
    numerator, denominator = (int(part) for part in stream["avg_frame_rate"].split("/"))
    fps = numerator / denominator
    return float(payload["format"]["duration"]), fps, int(stream["width"]), int(stream["height"])


def _mean_abs_diff(left: bytes, right: bytes) -> float:
    if len(left) != len(right):
        raise ValueError("frame sizes differ")
    return sum(abs(a - b) for a, b in zip(left, right)) / max(1, len(left))


def analyze_energy(path: str | Path, sample_width: int = 96) -> tuple[list[EnergyPoint], dict[str, float]]:
    source = Path(path).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    duration, fps, width, height = _probe(source)
    sample_height = max(2, round(sample_width * height / width))
    process = subprocess.Popen([
        "ffmpeg", "-v", "error", "-i", str(source), "-vf", f"scale={sample_width}:{sample_height},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-"
    ], stdout=subprocess.PIPE)
    assert process.stdout is not None
    frame_size = sample_width * sample_height
    previous = process.stdout.read(frame_size)
    points: list[EnergyPoint] = [EnergyPoint(0.0, 0.0)] if previous else []
    frame_index = 1
    while previous:
        current = process.stdout.read(frame_size)
        if len(current) != frame_size:
            break
        points.append(EnergyPoint(frame_index / fps * 1000.0, _mean_abs_diff(previous, current)))
        previous = current
        frame_index += 1
    return points, {"durationMs": duration * 1000.0, "fps": fps, "width": width, "height": height}


def _threshold(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    median = statistics.median(values)
    mad = statistics.median(abs(value - median) for value in values)
    return max(0.8, median + 2.5 * mad)


def segment_energy(points: Sequence[EnergyPoint], minimum_hold_ms: float = 120.0) -> list[Segment]:
    if len(points) < 2:
        return []
    threshold = _threshold([point.value for point in points])
    raw: list[Segment] = []
    start = points[0].timeMs
    kind = "motion" if points[0].value > threshold else "hold"
    for point in points[1:]:
        next_kind = "motion" if point.value > threshold else "hold"
        if next_kind != kind:
            raw.append(Segment(start, point.timeMs, kind))
            start, kind = point.timeMs, next_kind
    raw.append(Segment(start, points[-1].timeMs, kind))
    merged: list[Segment] = []
    for segment in raw:
        if segment.kind == "hold" and segment.endMs - segment.startMs < minimum_hold_ms and merged:
            previous = merged.pop()
            merged.append(Segment(previous.startMs, segment.endMs, previous.kind))
        else:
            merged.append(segment)
    return merged


def detect_beats(points: Sequence[EnergyPoint], min_gap_ms: float = 180.0) -> list[float]:
    if len(points) < 3:
        return []
    threshold = _threshold([point.value for point in points])
    beats: list[float] = []
    for index in range(1, len(points) - 1):
        point = points[index]
        if point.value > threshold and point.value >= points[index - 1].value and point.value >= points[index + 1].value and (not beats or point.timeMs - beats[-1] >= min_gap_ms):
            beats.append(point.timeMs)
    return beats


def loop_period(points: Sequence[EnergyPoint], min_period_ms: float = 250.0) -> float | None:
    values = [point.value for point in points]
    if len(values) < 12 or max(values, default=0.0) - min(values, default=0.0) < 0.15:
        return None
    step = statistics.median(points[index].timeMs - points[index - 1].timeMs for index in range(1, len(points)))
    min_lag = max(2, round(min_period_ms / step))
    mean = statistics.fmean(values)
    centered = [value - mean for value in values]
    base = sum(value * value for value in centered) or 1.0
    best: tuple[float, int] | None = None
    for lag in range(min_lag, len(values) // 2):
        score = sum(centered[index] * centered[index + lag] for index in range(len(values) - lag)) / base
        if best is None or score > best[0]:
            best = score, lag
    return best[1] * step if best and best[0] >= 0.25 else None


def fit_easing(points: Sequence[EnergyPoint]) -> str | None:
    values = [point.value for point in points]
    if len(values) < 4 or sum(values) <= 0:
        return None
    cumulative: list[float] = []
    total = sum(values)
    running = 0.0
    for value in values:
        running += value
        cumulative.append(running / total)
    curves = {
        "linear": lambda t: t,
        "ease-in": lambda t: t * t,
        "ease-out": lambda t: 1 - (1 - t) ** 2,
        "ease-in-out": lambda t: 3 * t * t - 2 * t * t * t,
        "ease-out-expo": lambda t: 1 if t == 1 else 1 - 2 ** (-10 * t),
    }
    scored = []
    for name, curve in curves.items():
        error = statistics.fmean((value - curve(index / (len(cumulative) - 1))) ** 2 for index, value in enumerate(cumulative))
        scored.append((error, name))
    return min(scored)[1]


def build_analysis(path: str | Path) -> dict:
    points, metadata = analyze_energy(path)
    segments = segment_energy(points)
    beats = detect_beats(points)
    for beat in beats:
        segments.append(Segment(beat, beat, "beat"))
    period = loop_period(points)
    return {
        "schemaVersion": 1,
        "source": str(Path(path).resolve()),
        "durationMs": metadata["durationMs"],
        "fps": metadata["fps"],
        "energy": [asdict(point) for point in points],
        "segments": [asdict(segment) for segment in sorted(segments, key=lambda segment: (segment.startMs, segment.kind))],
        "easingHint": fit_easing(points),
        **({"loopPeriodMs": period} if period else {}),
        "keyframes": [],
        "caveats": [
            "Aggregate motion energy does not identify which element moved.",
            "Stagger energy may combine children with different easing.",
            "Scroll-driven recordings do not reveal intrinsic duration.",
            "Speed-based yoyo detection may report half a visual cycle.",
            "Constant-energy loops can evade autocorrelation.",
            "Brightness change does not prove fade intent.",
            "Transform magnitudes remain estimated until mapped from frames.",
        ],
    }
