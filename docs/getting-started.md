# Getting Started

This guide is for a new user who wants to install Frontend Slides Studio, create or import a deck, edit it locally, and export a checked PDF or PPTX.

## Prerequisites

The base workspace requires:

- Node.js 20 or newer; Node 22 is the repository default;
- pnpm 11.3;
- a current Chromium-compatible browser.

Some workflows need additional local tools:

| Workflow | Additional tools |
| --- | --- |
| Browser smoke tests and export | Playwright Chromium |
| Motion analysis and video media | Python 3.10+, ffmpeg, and ffprobe |
| PDF inspection | Poppler utilities |
| Optional visual-master tooling | Python 3.10+, packages in `visual/requirements.txt`, and explicit provider credentials for network generation |
| Editable-PPTX render-back | LibreOffice |
| Optional PPTX extraction/inspection | python-pptx |

Ordinary Studio authoring and share HTML do not require Python, ffmpeg, LibreOffice, or provider credentials. Check the command-line tools visible to the project after installation:

```bash
pnpm cli -- doctor
```

## Install the Workspace

```bash
git clone https://github.com/siva-sub/frontend-slides-studio.git
cd frontend-slides-studio
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm build
```

If Corepack is unavailable, run `npm install --global pnpm@11.3.0`. Install Playwright Chromium only when browser quality checks, PDF, raster PPTX, or smoke tests are needed:

```bash
pnpm --filter @slides-studio/export-service exec playwright install chromium
```

For Python visual workflows, create and activate a virtual environment before starting Pi or the export service:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r visual/requirements.txt
```

See `skills/frontend-slides-studio/references/setup.md` for Linux/macOS system packages and capability-specific setup profiles.

## Option A: Create with an Agent

The agent skill gathers the audience, purpose, source material, density, slide count, media, visual-master exceptions, and required outputs before building.

### Claude Code Plugin

Run these as separate Claude Code commands:

```text
/plugin marketplace add https://github.com/siva-sub/frontend-slides-studio
```

```text
/plugin install frontend-slides-studio@frontend-slides-studio
```

Invoke the installed skill:

```text
/frontend-slides-studio:frontend-slides-studio
```

A useful first request is:

```text
Create a 10-slide speaker-led product launch deck. Use supplied product screenshots as real assets, include one architecture diagram, and deliver author HTML, share HTML, and a quality-gated PDF.
```

### Pi

Review the checked-out repository, then install it as a local-path Pi package:

```bash
pi install "$(pwd)"
```

Use `pi install -l "$(pwd)"` for project-local settings. Run `/reload` in an existing Pi session, then invoke the skill explicitly or let Pi route a presentation request to it:

```text
/skill:frontend-slides-studio Create a 10-slide product launch deck, open it in Studio, and deliver a quality-gated PDF.
```

Local-path installation is recommended for this pnpm workspace. `pi list` should show the package after installation.

### Other Coding Agents

Ask the agent to read `skills/frontend-slides-studio/SKILL.md` and follow the routed workflow. Generated copies for Claude, Codex, and Cursor are available under `integrations/`. The canonical skill remains the source of truth.

## Option B: Edit in Studio

Launch one exact HTML source:

```bash
pnpm studio:open -- --input "$(realpath deck.html)"
```

The command starts Studio on the first available loopback port from 4173 and prints a complete URL such as `http://127.0.0.1:4173/?session=...`. Open that complete URL. The requested file loads automatically; no file picker is required. The launch bridge can read and atomically save only the one server-configured file, and Studio pre-fills its absolute export path.

A typical Studio session is:

1. Confirm the header shows the expected filename, page count, import strategy, and confidence.
2. Use **Browse** mode to navigate without changing the deck.
3. Use **Edit** mode to select text or media and change inspector values.
4. Use **Move** mode to drag, snap, resize, layer, or delete selected objects.
5. Reorder, duplicate, skip, include, or search slides in the page rail.
6. Choose a style or recipe, insert a stable-ID diagram, or configure object motion.
7. Replace and reframe images with contain/cover, focal-point, pan, and zoom controls.
8. Run the current-page quality audit and focus reported issues.
9. Wait for `UNSAVED`, then press **Save**. Reload the same authenticated URL to confirm persistence.
10. Start the local export service and submit the already-prefilled saved path for PDF or raster PPTX.

The launcher prints its log and stop command. Stop the session when finished:

```bash
pnpm studio:stop -- --state .slides-studio/studio-<port>.json
```

Use `pnpm dev:studio` only for a welcome-only development session. Studio history keeps up to 50 exact snapshots, and imported decks run in a sandboxed iframe so their scripts and styles cannot take over the host editor.

## Option C: Create or Import with the CLI

### Inspect Styles and Recipes

```bash
pnpm cli -- styles list
pnpm cli -- styles inspect swiss-grid
pnpm cli -- recipes list
pnpm cli -- recipes scaffold investor-pitch --seed acme-demo --output deck-goal.json
pnpm cli -- layouts query --style swiss-grid --role content --seed acme-demo
```

A recipe scaffold produces structured deck-goal metadata. It does not replace content review or author the final HTML by itself.

### Create a Starter Deck

```bash
pnpm cli -- new deck.html
pnpm cli -- validate deck.html
```

Edit `deck.html` directly, through Studio, or with the agent skill. Keep stable `data-slide-id` and `data-object-id` values when changing the source.

### Import Existing HTML

```bash
pnpm cli -- import --input existing-deck.html --output normalized-deck.html
pnpm cli -- validate normalized-deck.html
```

Import accepts documents with discrete slides. It rejects continuous-flow pages instead of guessing where slides should begin and end.

### Build Author or Share HTML

Build the runtime first, then create the required output:

```bash
pnpm build
pnpm cli -- build --input deck.html --mode author --output dist/deck.author.html
pnpm cli -- build --input deck.html --mode share --output dist/deck.html
```

Author HTML retains authoring metadata. Share HTML removes authoring state and embeds the dependency-free runtime for offline presentation.

## Add a Typed Diagram

Diagram input uses the versioned DiagramSpec contract. The repository includes fixtures for all 27 supported types.

```bash
pnpm cli -- diagram validate --input examples/diagram-gallery/fixtures/architecture.json
pnpm cli -- diagram render \
  --input examples/diagram-gallery/fixtures/architecture.json \
  --output architecture.svg
```

The same normalized diagram primitives feed inline SVG and editable presentation objects. Stable IDs are preserved across both paths.

## Analyze and Apply Motion

Analyze the timing of a reference video:

```bash
pnpm cli -- motion analyze reference.mp4 --output motion-analysis.json
```

The analysis records measured timing and caveats. Applying motion is a separate step that requires a MotionIntent file mapping effects to stable object IDs:

```bash
pnpm cli -- motion apply \
  --analysis motion-analysis.json \
  --intent motion-intent.json \
  --replay once \
  --output motion-program.json
```

This separation prevents aggregate video measurements from animating arbitrary deck elements.

## Run Quality Checks and Export

The export service reads saved files from an explicit source root. Start it from the repository or another directory containing the deck:

```bash
export SLIDES_STUDIO_SOURCE_ROOT="$PWD"
export SLIDES_STUDIO_EXPORT_TOKEN="$(openssl rand -hex 32)"
pnpm dev:export
```

Keep that terminal running. In another terminal, run a deck-wide quality report:

```bash
pnpm cli -- quality \
  --input "$PWD/dist/deck.html" \
  --mode canonical \
  --strict \
  --output quality-report.json \
  --token "$SLIDES_STUDIO_EXPORT_TOKEN"
```

Export a deterministic PDF:

```bash
pnpm cli -- export \
  --input "$PWD/dist/deck.html" \
  --format pdf \
  --quality-gate strict \
  --wait \
  --token "$SLIDES_STUDIO_EXPORT_TOKEN"
```

Use `--format pptx` for a raster PPTX. Raster PPTX places one normalized image on each PowerPoint page and is not editable.

The service returns asynchronous job state, report paths, and output paths. Strict mode fails the job when blocking rendered-quality issues remain.

## Editable PPTX Review

Editable PPTX starts from a presentation object graph and, by default, requires a quality report:

```bash
pnpm cli -- pptx editable \
  --graph presentation-graph.json \
  --quality-report quality-report.json \
  --output deck.pptx
```

When LibreOffice is available, the exporter performs a fresh render-back. The report remains `rendered_pending_manual_review` until a person inspects the result and records evidence:

```bash
pnpm cli -- pptx review \
  --report deck.pptx.report.json \
  --reviewer "Reviewer Name" \
  --evidence "Reviewed render-back images; no blocking mismatch found."
```

Do not describe editable PPTX as passed before this review. Unsupported regions remain declared raster fallbacks rather than pretending to be native objects.

## Verify a Development Checkout

Run the complete non-browser gate:

```bash
pnpm check
```

Run the browser, export, and render-back acceptance suite:

```bash
pnpm smoke
```

The full smoke suite requires the optional tools listed under Prerequisites.

## Current Boundaries

- The product is local-first and has no hosted collaboration, accounts, or cloud persistence.
- Visual-master generation is opt-in and requires an explicitly configured provider. Ordinary HTML builds make no provider call.
- Raster PPTX is intentionally non-editable.
- Editable PPTX is a native-object-plus-fallback exporter, not a pixel-perfect promise.
- Native PowerPoint and Keynote animation export is outside v0.1; HTML motion settles to deterministic poster states in static formats.
- New canonical decks use 1920×1080. Imported 16:9 decks retain their measured intrinsic stage and scale uniformly.
