# Frontend Slides Studio

Frontend Slides Studio is a local-first workbench for creating, importing, editing, animating, validating, and exporting HTML presentations. It extends the history of [`zarazhangrui/frontend-slides`](https://github.com/zarazhangrui/frontend-slides) while preserving its strongest delivery format: a presentation can still ship as one self-contained HTML file.

The project combines an agent skill, a visual browser editor, a dependency-free presentation runtime, typed diagram and media systems, and deterministic PDF/PPTX export. It is designed for people who want editable source, repeatable rendering, and honest evidence about export quality.

> **Status:** active v0.1. HTML authoring, Studio editing, styles and recipes, all 27 diagram adapters, motion and transitions, quality reports, PDF export, raster PPTX, and evidence-gated editable PPTX are implemented. See [Implementation Status](docs/status.md) for current limits.

## What You Can Do

- Create a new fixed-stage HTML presentation with an agent or the CLI.
- Import an existing HTML deck without flattening it into screenshots.
- Edit text, move and resize objects, reorder or skip slides, replace media, and use undo/redo in Studio.
- Choose from 32 licensed style systems, 256 layouts, and 6 deck recipes.
- Insert deterministic, editable diagrams across 27 business and technical diagram types.
- Analyze reference video timing, map motion to stable object IDs, and run replay-safe transitions.
- Generate or reframe assets while preserving supplied logos, evidence, charts, and other fidelity-critical media.
- Build clean author and share HTML, run deck-wide quality checks, and export PDF or PPTX locally.
- Produce editable PPTX object graphs with native/fallback inventories and explicit render-back review status.

## Choose How to Use It

### 1. Use the Agent Skill

Claude Code users can install the public plugin from this repository. Run these as separate Claude Code commands:

```text
/plugin marketplace add https://github.com/siva-sub/frontend-slides-studio
```

```text
/plugin install frontend-slides-studio@frontend-slides-studio
```

Then start a presentation task with:

```text
/frontend-slides-studio:frontend-slides-studio
```

Pi users should clone and build the workspace, then install the reviewed local path with `pi install "$(pwd)"`. Run `/reload` in an existing session and invoke `/skill:frontend-slides-studio ...` when explicit routing is useful. The complete core and optional dependency matrix is in [Getting Started](docs/getting-started.md) and `skills/frontend-slides-studio/references/setup.md`.

For Codex, Cursor, or another filesystem-capable coding agent, point the agent to this repository and ask it to follow `skills/frontend-slides-studio/SKILL.md`. Generated agent-specific copies are also available under `integrations/`.

### 2. Use the Studio Editor

```bash
git clone https://github.com/siva-sub/frontend-slides-studio.git
cd frontend-slides-studio
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- new demo.html
pnpm studio:open -- --input "$(realpath demo.html)"
```

The launcher starts a loopback Studio session and prints an authenticated URL such as `http://127.0.0.1:4173/?session=...`. Open the complete URL: the requested deck loads automatically, Save atomically updates only that configured source, and the absolute export path is prefilled. Studio provides sandboxed Browse/Edit/Move modes, slide and media operations, styles and recipes, diagrams, motion, current-page audit, and evidence-gated export. Use `pnpm dev:studio` only for a welcome-only development session.

### 3. Use the CLI

```bash
pnpm cli -- doctor
pnpm cli -- styles list
pnpm cli -- recipes list
pnpm cli -- recipes scaffold investor-pitch --seed demo --output deck-goal.json
pnpm cli -- new demo.html
pnpm cli -- validate demo.html
pnpm build
pnpm cli -- build --input demo.html --mode share --output dist/demo.html
```

The CLI also supports HTML import, layout queries, diagrams, media reframing, asset jobs, motion, transitions, quality reports, PDF/PPTX jobs, and editable-PPTX review.

See the complete [Getting Started Guide](docs/getting-started.md) for prerequisites, first-deck steps, Studio export setup, and common commands.

## What We Built

| Area | Delivered capability |
| --- | --- |
| Agent workflow | Canonical skill plus generated Claude, Codex, Cursor, and plugin integrations for create, import/edit, assets, diagrams, motion, visual masters, validation, and export |
| Studio | React/Vite/Zustand local editor with an authenticated one-file launch bridge, atomic save-back, sandboxed import, Browse/Edit/Move modes, scale-correct selection and manipulation, snapping, eight-handle resize, layers, slide operations, history, File System Access fallback, media controls, styles, diagrams, motion, quality focus, and export jobs |
| Runtime | Dependency-free IIFE with fixed-stage navigation, replay-safe WAAPI motion, ten transition kinds, adjacent preload, reduced-motion behavior, and deterministic settled export state |
| Styles and recipes | Browser-safe typed registry of 32 Apache-2.0 style systems, 256 layouts, and 6 recipes with deterministic queries, inspection, scaffolding, normalization, and generated-data drift checks |
| Diagrams | Versioned DiagramSpec contracts and exhaustive deterministic adapters for 27 diagram types, rendered through stable editable primitives to SVG and native presentation objects |
| Assets and media | MIME-verified content-hashed staging, contain/cover crop geometry, focal point, pan, zoom, rotation, AVIF derivatives, video posters, asset plans, local generation jobs, and evidence bundles |
| Motion | Python/ffmpeg timing analysis separated from semantic object mapping and runtime tracks; replay policies and static poster-state settlement are validated |
| Quality | Static and browser-rendered checks for bounds, overflow, overlap, connectors, missing assets, clone safety, and export settlement, with report or strict gate modes |
| Export | Secure localhost Playwright service with authenticated asynchronous jobs, reconnectable events, deterministic PDF, raster PPTX, and editable-PPTX native/fallback reports |
| Security and provenance | Sandboxed imported decks, loopback-only export boundaries, path and symlink containment, credential-safe provider configuration, clean-room enforcement, license notices, and machine-readable provenance |

## Output Formats

| Output | Purpose | Editability status |
| --- | --- | --- |
| Author HTML | Source-preserving local editing and metadata | Editable HTML |
| Share HTML | Clean, self-contained browser presentation | Editable as HTML source |
| PDF | Deterministic settled static pages | Static |
| Raster PPTX | One normalized slide image per PowerPoint page | **Not editable** |
| Editable PPTX | Native shapes, text, connectors, images, and declared fallbacks | Evidence-gated; never treated as passed without render-back and named visual review |

## Core Rules

- HTML-native slides are the default. Visual-master image generation is an explicit per-slide exception.
- New decks use a 1920×1080 stage. Imported 16:9 decks preserve intrinsic dimensions such as 1280×720 and scale uniformly in preview and export.
- Every slide and editable object uses a stable ID.
- Supplied logos, UI captures, evidence, medical imagery, charts, and tables remain real assets unless redrawing is explicitly authorized.
- Motion analysis measures **when**. Motion intent decides **what**. Motion programs control runtime tracks.
- Static export settles entrances, loops, media, transitions, and authoring chrome before capture.
- Raster output is labeled raster. Editable output reports every native object and fallback honestly.

## Local Export Service

```bash
export SLIDES_STUDIO_SOURCE_ROOT="$PWD"
export SLIDES_STUDIO_EXPORT_TOKEN="$(openssl rand -hex 32)"
pnpm dev:export
```

In another terminal:

```bash
pnpm cli -- export \
  --input "$PWD/dist/demo.html" \
  --format pdf \
  --quality-gate strict \
  --wait \
  --token "$SLIDES_STUDIO_EXPORT_TOKEN"
```

The service binds to `127.0.0.1`, accepts only contained source paths, and returns asynchronous job state and output paths. Studio uses the same service URL, token, and absolute saved-deck path.

## Development and Verification

The repository uses Node 22, pnpm 11.3, TypeScript, React/Vite, Fastify, Playwright, Vitest, and Python tooling.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm smoke
```

`pnpm check` runs builds, typechecks, unit tests, generated-data drift checks, provenance checks, clean-room checks, and integration synchronization. `pnpm smoke` exercises Studio editing, all diagram gallery renders, asset generation, motion and transitions, PDF/raster PPTX export, and editable-PPTX render-back gates.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Implementation Status](docs/status.md)
- [Architecture](docs/architecture.md)
- [Security Model](docs/security.md)
- [Clean-Room Policy](docs/clean-room-dashi.md)
- [Original Upstream README](docs/upstream-frontend-slides-readme.md)

## Provenance and License

This repository is a public renamed fork. [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and [`provenance.json`](provenance.json) record imported resources, exact source revisions, licenses, and modifications. Dashi PPT is a clean-room behavioral reference only; its AGPL or proprietary code and assets are not included.

Original Studio code and the inherited fork are MIT-licensed. Files explicitly marked under `visual/` and imported `resources/gpt-image2-ppt-skills/` materials retain Apache-2.0 notices.
