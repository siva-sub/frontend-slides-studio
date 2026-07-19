<commands>
All commands run from `<workspace-root>`. Use workspace scripts exactly as shown.

<setup>
```bash
cd <workspace-root>
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- doctor
```
</setup>

<studio>
Launch one exact deck in a detached authenticated Studio session:
```bash
pnpm studio:open -- --input "$(realpath path/to/deck.html)"
```
Optional fixed starting port and machine-readable output:
```bash
pnpm studio:open -- --input "$(realpath path/to/deck.html)" --port 4173 --json
```
Stop with the command printed by the launcher, or:
```bash
pnpm studio:stop -- --state <workspace-root>/.slides-studio/studio-<port>.json
```
For a blank welcome-only development session:
```bash
pnpm dev:studio
```
Do not use `pnpm dev:studio` when the agent must open a specific deck automatically; use `studio:open`. Presenter/Audience launch is a Studio control because it creates role-scoped capabilities from this authenticated source session. Use Presentation only when no authenticated session is available.
</studio>

<planning_and_source>
```bash
pnpm cli -- styles list
pnpm cli -- styles inspect swiss-grid
pnpm cli -- recipes list
pnpm cli -- recipes scaffold investor-pitch --seed project-x --output deck-goal.json
pnpm cli -- layouts query --style swiss-grid --role content --seed project-x
pnpm cli -- new deck.html
pnpm cli -- import --input existing.html --output normalized.html
pnpm cli -- validate deck.html
```
</planning_and_source>

<diagrams_motion_media>
```bash
pnpm cli -- diagram validate --input diagram.json
pnpm cli -- diagram render --input diagram.json --output diagram.svg
pnpm cli -- motion analyze reference.mp4 --output motion-analysis.json
pnpm cli -- motion apply --analysis motion-analysis.json --intent motion-intent.json --replay once --output motion-program.json
pnpm cli -- media reframe --input placement.json --source-width 1600 --source-height 900 --slot 0,0,1,1 --fit cover --output placement.updated.json
```
</diagrams_motion_media>

<build>
```bash
pnpm build
pnpm cli -- build --input deck.html --mode author --output dist/deck.author.html
pnpm cli -- build --input deck.html --mode share --output dist/deck.html
```
</build>

<export_service>
Start the export service in a persistent terminal. The source root must contain the saved deck:
```bash
export SLIDES_STUDIO_SOURCE_ROOT="$(pwd)"
export SLIDES_STUDIO_EXPORT_TOKEN="$(openssl rand -hex 32)"
pnpm dev:export
```
The service defaults to `http://127.0.0.1:4317`. Keep the token in session memory; do not write it into a deck or commit it.

Run deck-wide quality and PDF export from another terminal:
```bash
pnpm cli -- quality --input "$(realpath dist/deck.html)" --mode canonical --strict --output quality-report.json --token "$SLIDES_STUDIO_EXPORT_TOKEN"
pnpm cli -- export --input "$(realpath dist/deck.html)" --format pdf --quality-gate strict --wait --token "$SLIDES_STUDIO_EXPORT_TOKEN"
```
Use `--format pptx` for raster PPTX. Use `--format editable-pptx --quality-gate strict --wait` to map a saved HTML deck into native PowerPoint objects with declared regional fallbacks. Both PPTX modes validate their Open XML packages for ISO/IEC 29500 Transitional compatibility and record the evidence in `<output>.report.json`.
</export_service>

<editable_pptx>
Preflight one HTML source, discover native shapes and transitions, resolve ppt-rs aliases, and validate the actual package:
```bash
pnpm cli -- pptx html-check --input deck.html --output pptx-html-readiness.json
pnpm cli -- pptx html-check --input deck.html --strict
pnpm cli -- pptx shapes list
pnpm cli -- pptx shapes resolve --name flowChartOffPageConnector
pnpm cli -- pptx transitions
pnpm cli -- pptx validate --input deck.pptx
```

The graph command is the advanced path for callers that already have a presentation object graph:
```bash
pnpm cli -- pptx editable --graph presentation-graph.json --quality-report quality-report.json --output deck.pptx
pnpm cli -- pptx review --report deck.pptx.report.json --reviewer "Reviewer Name" --evidence "Reviewed fresh render-back."
```
Read `../workflows/pptx-html.md` and `pptx-native.md` before authoring any editable-PPTX HTML. Default HTML preflight fails blockers; `--strict` also fails warnings. The report predicts capture behavior and never replaces validation of the exported PPTX.
</editable_pptx>

<verification>
```bash
pnpm check
pnpm smoke:studio
pnpm smoke:presenter
pnpm smoke
pnpm check:pptx-external-compat
```
</verification>
</commands>
