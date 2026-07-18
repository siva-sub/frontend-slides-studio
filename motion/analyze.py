#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.analyzer import build_analysis


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure animation timing without guessing element intent.")
    parser.add_argument("video")
    parser.add_argument("--output", default="motion-analysis.json")
    args = parser.parse_args()
    analysis = build_analysis(args.video)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
