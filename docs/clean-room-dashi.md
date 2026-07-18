# Clean-room boundary: Dashi / dashi-ppt-skill

This document records the **behavioral** requirements that Frontend Slides
Studio independently reimplements, and the **prohibited imports** that keep the
boundary clean. It exists so an auditor can verify that no Dashi source, themes,
layouts, assets, bundles, style names, or exporter code is copied.

## Provenance

Dashi (`chuspeeism/dashi-ppt-skill`, commit `fdbb145517ea0e289000aef9b7906bcb3e0cd19`)
is licensed under **AGPL-3.0 plus proprietary exporter restrictions**. Because of
that license, Dashi is treated as **clean-room inspiration only**: no code or
assets are copied. The relationship is recorded in [`provenance.json`](../provenance.json)
with an empty `paths` array.

## Behavioral requirements (independently reimplemented)

These are high-level behaviors observed from public descriptions, reimplemented
from scratch under this repository's own licenses. They describe *what* the
system does, never *how* a specific Dashi module is written:

1. **Compact, deterministic layout selection** — given a page role and a small
   set of constraints, pick a layout deterministically, penalize reuse, and keep
   selection stable for a given seed. Implemented originally in
   `packages/layout-contracts` and `packages/style-registry`.
2. **Shared authoring contracts** — versioned, typed contracts for decks,
   layouts, styles, and recipes that an agent and a renderer agree on. Implemented
   in `packages/protocol`.
3. **Explicit normalization reports** — when content is normalized into a
   layout, surface substitutions and validation issues instead of silently
   mutating. Implemented in the layout/style-registry normalizers.
4. **Editor URL handoff** — a deck workflow ends by opening the requested source
   in a local editor URL rather than leaving the user with an unexplained file.
   Frontend Slides Studio implements this behavior independently through a
   one-file, token-authenticated Vite bridge in `apps/studio`, atomic save-back,
   and a separate contained export service. No Dashi launcher, preview-server,
   autosave, or export-route code was copied.

## Prohibited imports

The following must **never** be present in this repository outside this document
and the explicit provenance/attribution notices:

- Dashi package source, headers, or module manifests.
- Dashi **themes**, **theme bundles**, or **layouts** (including style names that
  originate from Dashi).
- Dashi **exporter** code, including the `html-deck-to-pptx` exporter and any
  SwissDeck runtime names/identifiers.
- Dashi assets, screenshots, or binary bundles.

## Automated guard

`scripts/check-clean-room.ts` (wired into `pnpm check:clean-room`) scans the
repository for strong Dashi fingerprints (`html-deck-to-pptx`, `@dashi`, copied
Dashi package headers, SwissDeck runtime names) and rejects any Dashi
theme-bundle/exporter path. It allowlists only this document and the explicit
provenance/attribution notices so the boundary can be described without false
positives. The guard must currently pass.

> Note: the licensed style/layout resources under
> `resources/gpt-image2-ppt-skills/` and their derived registry come from the
> separate Apache-2.0 `gpt-image2-ppt-skills` project, not from Dashi. The style
> named `swiss-grid` ("Swiss Grid") refers to the Swiss International
> typographic-design movement and is unrelated to the Dashi "SwissDeck" runtime
> name.
