# Attributions

Frontend Slides Studio preserves the full history of [`zarazhangrui/frontend-slides`](https://github.com/zarazhangrui/frontend-slides), originally created by Zara Zhang and licensed under MIT.

The project selectively adapts permissively licensed ideas and code. Exact imported paths, revisions, licenses, and modification notes are recorded in [`provenance.json`](provenance.json).

## Direct lineage

- **zarazhangrui/frontend-slides** — MIT — fork lineage, fixed 16:9 stage, agent skill workflow, design presets, and original export/conversion helpers.

## Adapted sources

- **Trade-Offf/NextPPT** — MIT — confidence-ranked HTML deck normalization, typed iframe messaging, independent CSS transform properties, history/export-job concepts.
- **KumarSashank/motiscope** — MIT — measured motion timing, holds, beats, loop/easing hints, curated frames, and measured-versus-estimated provenance.
- **cathrynlavery/diagram-design** — MIT — semantic diagram grammar, complexity budgets, connector canon, progressive type references, and design-token onboarding.
- **JuneYaooo/gpt-image2-ppt-skills** — Apache-2.0 — contained visual-master scenes, mask-locked repairs, clean-plate reconstruction, real-asset reservation, and render-back review states. The visual/ adaptation is extended with letterbox-safe edits, the A1/A2/B layer-route contract, deterministic edge-contamination checks, protected-region placement, a contained evidence-bundle builder, and a non-network visual CLI. The style prompt library and example recipes are imported byte-for-byte under `resources/gpt-image2-ppt-skills/` (32 styles, 256 layouts, 6 recipes, LICENSE), and normalized into a typed browser-safe registry in `packages/style-registry`. `examples/visual-reconstruction/` is an original synthetic reconstruction example inspired by the upstream technique.
- **yingkitw/ppt-rs** — Apache-2.0 — package-validation rules, native shape-name compatibility, slide-transition XML semantics, repair detection, and HTML/XML test invariants adapted into original TypeScript under `packages/pptx-compat` and associated tests. No Rust source is vendored. Studio corrects upstream schema defects found by Microsoft Open XML SDK validation instead of copying them.
- **lukesw55/frontend-slides** — MIT fork lineage — deterministic settled-state PDF export and localhost/path-hardening ideas.
- **millecodex/nerd-slides** — MIT-compatible fork lineage where verified — presenter/editor interaction concepts; behavior is independently reimplemented unless a copied path is listed in provenance.

## Clean-room inspiration only

- **chuspeeism/dashi-ppt-skill** — AGPL-3.0 with additional proprietary exporter restrictions. No source, templates, themes, layouts, or exporter code is copied. Only high-level concepts independently reimplemented from observed behavior are used: compact layout queries, shared authoring contracts, and explicit normalization reports.

## Icon policy

No third-party icon pack is bundled by default. If icons are added, their exact files and upstream licenses must be registered in `provenance.json` and `THIRD_PARTY_NOTICES.md` before release.
