---
name: frontend-slides-studio
description: Operates Frontend Slides Studio to create, import, visually edit, diagram, animate, validate, and export local-first HTML presentations. Use when a user asks for a presentation, slide deck, Studio editor session, arbitrary HTML deck editing, typed diagrams, media generation or reframing, reference-motion analysis, deterministic PDF/raster PPTX, or evidence-gated editable PPTX.
license: MIT
compatibility: Node.js 20+ and pnpm 11.3 for core Studio/CLI use; optional Playwright Chromium, Python 3.10+, ffmpeg/ffprobe, Poppler, LibreOffice, and provider credentials are required only by matching workflows.
metadata:
  version: "0.1.0"
---

<objective>
Operate the complete Frontend Slides Studio pipeline. A normal request should produce an editable source, launch the requested deck in Studio, use the relevant authoring subsystems, save explicitly, validate, and deliver the requested outputs. Writing one standalone HTML file is an explicit HTML-only fallback, not the default Studio workflow.
</objective>

<runtime_context>
- Treat the directory containing this loaded `SKILL.md` as `<skill-root>`.
- Resolve `<workspace-root>` as two directories above `<skill-root>`.
- Before running commands, verify `<workspace-root>/package.json` has `"name": "frontend-slides-studio"`.
- Run every project command from `<workspace-root>` unless a workflow says otherwise.
- The CLI is workspace-local. Use `pnpm cli -- ...`; never assume a global `slides-studio` binary exists.
- On first use, or when `pnpm cli -- doctor` reports missing tools, read `references/setup.md` before any workflow.
- The first-class editor launch command is `pnpm studio:open -- --input <absolute-html-path>`. It starts a loopback Studio session, loads that deck automatically, and prints the authenticated editor URL.
</runtime_context>

<operating_modes>
- **Studio-first, default:** use for unspecified presentation requests, new decks, imports, edits, visual authoring, and any request mentioning Studio, preview, editor, diagrams, motion, media, quality, PDF, or PPTX.
- **HTML-only fallback:** use only when the user explicitly asks for a single HTML file without Studio or when Studio cannot run. State the limitation and still validate the HTML.
- **CLI support:** use for deterministic planning, schemas, batch transformations, validation, builds, and service jobs. The CLI supports Studio; it does not replace the editor when visual authoring was requested.
</operating_modes>

<essential_principles>
- **Source first:** reviewed Markdown and HTML are authoritative; generated JSON and exports are derived.
- **Stable identity:** every slide has `data-slide-id`; editable elements have `data-object-id`.
- **Fixed stage:** author new decks at 1920×1080 and scale uniformly. Imported 16:9 stages preserve their measured intrinsic size.
- **Local first:** no account, cloud persistence, or hosted collaboration is required.
- **Real assets stay real:** logos, product UI, medical images, evidence, charts, and tables are preserved unless the user explicitly allows redrawing.
- **Motion provenance:** measured timing, semantic intent, and runtime tracks remain separate.
- **Static exports settle semantically:** entrances finish, loops freeze at a declared poster position, media seeks to poster time, and authoring chrome disappears.
- **Evidence before delivery:** validate, render, and inspect the artifact. Editable PPTX cannot reach `passed` without fresh render-back and visual review.
</essential_principles>

<intake>
For a new deck, gather in one round:
1. purpose and audience;
2. approximate slide count;
3. source material and supplied media;
4. reading-first or speaker-led density;
5. whether any slide explicitly needs visual-master treatment;
6. required outputs: source HTML, author HTML, share HTML, PDF, raster PPTX, or editable PPTX evidence build.

For an import, inspect the file first. Do not ask the user to restate facts visible in the artifact.
</intake>

<routing>
- Installation, Pi package setup, dependency questions, or a failed environment probe → read `references/setup.md`.
- Any unspecified presentation request, “use Studio,” create, import, or edit request → first read `references/product-map.md`, then follow `workflows/studio.md`.
- New deck content and source construction inside the Studio workflow → read `workflows/create.md`.
- Existing HTML normalization and editing inside the Studio workflow → read `workflows/import-edit.md`.
- Diagram or business/technical schematic → read `workflows/diagram.md`, then return to `workflows/studio.md` for insertion and review.
- Asset planning, generation, staging, or reframing → read `workflows/assets.md`, then use the Studio media and asset controls.
- Reference animation or object motion → read `workflows/motion.md`, then use the Studio motion and transition controls.
- Explicit art-directed image slide → read `workflows/visual-master.md`.
- Validation, build, quality, PDF, or PPTX → read `workflows/export.md`.
- Contracts, stable IDs, provenance, or review states → read `references/contracts.md`.
- Command uncertainty → read `references/commands.md`.
- UI-control uncertainty → read `references/studio-controls.md`.
- Launch, save, preview, service, or export failure → read `references/troubleshooting.md`.
</routing>

<studio_completion_rule>
When Studio is requested or selected by default, do not stop after writing `deck.html`. Completion requires:
1. launch the deck with `pnpm studio:open`;
2. report and, when browser automation exists, open the printed Studio URL;
3. exercise the relevant Studio controls and save the source explicitly;
4. reopen or reload the saved revision;
5. validate/build and run the requested quality/export workflow.
</studio_completion_rule>

<guardrails>
- Never copy Dashi PPT code, themes, layouts, or exporter output into this repository. Behavioral comparison may inform an independently implemented workflow only.
- Never discover API keys by walking a user's project for `.env` files.
- Never describe raster PPTX as editable.
- Never call regeneration a rollback; exact restore copies a historical artifact, while regeneration creates a branch.
- Never animate directly from aggregate MotionAnalysis without an explicit object-ID mapping.
- Never turn continuous prose into guessed slides without user confirmation.
- Never claim Studio was used when only an HTML file was written.
</guardrails>

<quick_commands>
```bash
cd <workspace-root>
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- doctor
pnpm cli -- new deck.html
pnpm studio:open -- --input "$(realpath deck.html)"
pnpm cli -- validate deck.html
pnpm cli -- build --input deck.html --mode share --output dist/deck.html
```
</quick_commands>

<success_criteria>
- The selected source is loaded in Studio through the authenticated loopback URL, unless the user explicitly chose HTML-only mode.
- The agent can name which Studio controls and subsystem workflows it used.
- Save writes the reviewed revision to the intended source, and the reopened artifact matches it.
- Stable IDs are present and unique.
- Layout, diagram, motion, visual-master, and safety validators have no blocking errors.
- Share HTML contains no authoring/private metadata and requires no npm runtime.
- PDF/PPTX exports identify editability and review status honestly.
- Final reporting includes the Studio URL, source path, output paths, verification evidence, limitations, and any residual manual review.
</success_criteria>
