# NOTICE — gpt-image2-ppt-skills imported resources

This subtree contains style prompts, layout sidecars, and deck recipes imported
**byte-for-byte and unchanged** from the upstream Apache-2.0 project
[`JuneYaooo/gpt-image2-ppt-skills`](https://github.com/JuneYaooo/gpt-image2-ppt-skills)
at commit `ce4714225d938b02806af3660a46e62be8900e29`.

A copy of the upstream Apache License 2.0 is shipped at [`LICENSE`](LICENSE).

## What is imported (unchanged)

- `styles/*.md` (32) — raw upstream style prompt documents.
- `styles/*.layouts.json` (32) — raw upstream layout sidecars (256 layouts
  total, 8 per style). The sidecar `version` is `"2"`.
- `recipes/<slug>/recipe.md` and `recipes/<slug>/slides_plan.md` (6 recipes) —
  raw upstream example recipes and their paired slide plans.
- `LICENSE` — the upstream Apache-2.0 text.

The exact identity (target path, byte size, and SHA-256) of every imported file
is recorded in [`MANIFEST.json`](MANIFEST.json). Each manifest entry is marked
`"modificationStatus": "unchanged"`, meaning the bytes on disk are identical to
the pinned upstream revision. **No upstream screenshots, gallery images, or other
binaries are imported.**

## What is NOT here

- Upstream screenshots/gallery binaries are intentionally excluded.
- Upstream tooling (Python scripts, installers) is intentionally excluded; this
  project does not use the upstream `md_to_plan.py`/`generate_ppt.py` pipeline.

## Where original modifications live (outside this subtree)

This `NOTICE` records the boundary between the unchanged upstream resources and
the original work in this repository. The **original** derivative work consists
of:

- The typed, browser-safe `@slides-studio/style-registry` package
  (`packages/style-registry`), which reads these resources at **build time only**
  and emits generated TypeScript data. The generated normalization into
  `StyleProfile` / `LayoutProfile` / `Recipe` protocol contracts, the query
  scoring, recipe scaffolding, prop normalization, and the generated style
  browser are original to this repository and live outside this subtree.
- Provenance, attribution, and clean-room documentation at the repository root
  and under `docs/`.

No file inside this `resources/gpt-image2-ppt-skills/` subtree is an original
modification of upstream content; the imported resources above are reproduced
verbatim under Apache-2.0 §4. The upstream project did not ship a `NOTICE` file,
so none is invented here.
