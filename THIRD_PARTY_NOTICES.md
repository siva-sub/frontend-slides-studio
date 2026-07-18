# Third-party notices

## Frontend Slides

Copyright (c) 2025 Zara Zhang. Licensed under the MIT License in [`LICENSE`](LICENSE). This repository is a renamed GitHub fork and retains upstream history.

## Motiscope

Copyright (c) 2026 Kumar Sashank Ghanta. Licensed under the MIT License. The adapted analyzer retains the upstream attribution and modification notes in source headers and [`provenance.json`](provenance.json).

Motiscope itself attributes MIT-licensed work from `claude-video` and `claude-video-vision`; this project retains those notices in `motion/NOTICE` where adapted behavior overlaps.

## Diagram Design

Copyright (c) 2025 Cathryn Lavery. Licensed under the MIT License. This project reimplements the diagram grammar in a typed renderer; no example gallery or icon asset is bundled unless separately registered.

## gpt-image2-ppt-skills

Licensed under the Apache License, Version 2.0. Adapted visual-master modules under `visual/` retain Apache-2.0 notices and prominent modification markers. A copy of Apache-2.0 is included at [`visual/APACHE-2.0.txt`](visual/APACHE-2.0.txt).

The adaptation extends `visual/` with letterbox-safe prepare/restore edits, the A1/A2/B layer-route contract (validated metrics, masked A2 composite, default overlap grouping), deterministic white/black edge-contamination checks, protected-region placement, a contained evidence-bundle builder, and a non-network visual CLI. [`examples/visual-reconstruction/`](examples/visual-reconstruction/) is an original synthetic reconstruction example inspired by the upstream Apache technique; no upstream binary is copied. All of this extension is original work in this repository.

The upstream style prompt library (32 `styles/*.md` + 32 `styles/*.layouts.json` = 256 layouts), six example recipes (`recipes/<slug>/recipe.md` + `slides_plan.md`), and the upstream `LICENSE` are imported **byte-for-byte and unchanged** under [`resources/gpt-image2-ppt-skills/`](resources/gpt-image2-ppt-skills/), with a per-file SHA-256 [`MANIFEST.json`](resources/gpt-image2-ppt-skills/MANIFEST.json) and a [`NOTICE-OF-MODIFICATIONS.md`](resources/gpt-image2-ppt-skills/NOTICE-OF-MODIFICATIONS.md). No upstream screenshots or gallery binaries are imported. The typed, browser-safe normalization into `StyleProfile` / `LayoutProfile` / `Recipe` contracts, query scoring, recipe scaffolding, and the generated style browser are original work in [`packages/style-registry`](packages/style-registry).

## NextPPT

Licensed under the MIT License. Frontend Slides Studio independently implements the selected behavior and records any direct source adaptation in [`provenance.json`](provenance.json).

## Dashi PPT

No code or assets are included. Dashi PPT is listed only to make the clean-room boundary explicit.
