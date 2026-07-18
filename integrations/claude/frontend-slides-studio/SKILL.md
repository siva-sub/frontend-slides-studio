---
name: frontend-slides-studio
description: Builds, imports, edits, diagrams, animates, validates, and exports local-first HTML presentations with Frontend Slides Studio. Use for self-contained slide decks, arbitrary HTML deck editing, typed diagrams, reference-motion analysis, optional visual-master slides, deterministic PDF, raster PPTX, or editable PPTX evidence workflows.
license: MIT
metadata:
  version: "0.1.0"
---

<objective>
Create presentation artifacts whose source remains inspectable and whose exported state is deterministic. HTML-native slides are the default. Image-generated visual masters are explicit per slide and never the default for dense text, exact data, tables, legal copy, evidence, or fidelity-critical supplied media.
</objective>

<essential_principles>
- **Source first:** reviewed Markdown and HTML are authoritative; generated JSON and export files are derived.
- **Stable identity:** every slide has `data-slide-id`; editable elements have `data-object-id`.
- **Fixed stage:** author at 1920×1080 and scale uniformly. Do not reflow slides at mobile widths.
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
6. required outputs: author HTML, share HTML, PDF, raster PPTX, or editable PPTX evidence build.

For an import, inspect the file first. Do not ask the user to restate facts visible in the artifact.
</intake>

<routing>
- New HTML-native presentation → read `workflows/create.md`.
- Import or edit existing HTML → read `workflows/import-edit.md`.
- Diagram or business/technical schematic → read `workflows/diagram.md`.
- Asset planning, generation, staging, or reframing → read `workflows/assets.md`.
- Analyze a reference animation or apply motion → read `workflows/motion.md`.
- Explicit art-directed image slide → read `workflows/visual-master.md`.
- Validate/build/export → read `workflows/export.md`.
- Contracts, stable IDs, provenance or status semantics → read `references/contracts.md`.
</routing>

<guardrails>
- Never copy Dashi PPT code, themes, layouts, or exporter output into this repository.
- Never discover API keys by walking a user's project for `.env` files.
- Never describe raster PPTX as editable.
- Never call regeneration a rollback; exact restore copies a historical artifact, while regeneration creates a branch.
- Never animate directly from aggregate MotionAnalysis without an explicit object-ID mapping.
- Never turn continuous prose into guessed slides without user confirmation.
</guardrails>

<quick_commands>
```bash
slides-studio doctor
slides-studio new deck.html
slides-studio styles list
slides-studio recipes scaffold investor-pitch --seed project-x --output deck-goal.json
slides-studio layouts query --role diagram --seed project-x
slides-studio diagram validate --input diagram.json
slides-studio motion analyze clip.mp4 --output motion-analysis.json
slides-studio validate deck.html
slides-studio build --input deck.html --mode share --output dist/deck.html
slides-studio quality --input dist/deck.html --strict --output quality-report.json
slides-studio export --input dist/deck.html --format pdf --quality-gate strict --wait
```
</quick_commands>

<success_criteria>
- The chosen source artifact opens locally and preserves fixed-stage navigation.
- Stable IDs are present and unique.
- Layout, diagram, motion, visual-master, and safety validators have no blocking errors.
- Share HTML contains no authoring/private metadata and requires no npm runtime.
- PDF/PPTX exports identify their editability and review status honestly.
- File paths, commands, evidence, limitations, and residual manual checks are reported to the user.
</success_criteria>
