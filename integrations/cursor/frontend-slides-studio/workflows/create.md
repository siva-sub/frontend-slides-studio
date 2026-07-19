<workflow name="create-deck-source">
<required_reading>
- Read `references/product-map.md` for subsystem selection.
- Read `references/commands.md` for the real workspace CLI.
- Return to `workflows/studio.md` after source creation.
</required_reading>

<process>
1. Draft `slides_plan.md` with one action-title, one audience takeaway, source evidence, and intended media/diagram treatment per slide. Keep user claims and supplied data verbatim. If editable PPTX is requested, first read `workflows/pptx-html.md` and add each slide's PPTX intent, mandatory-native object IDs, allowed fallback regions, native metadata, and verification method.
2. Inspect styles and recipes with `pnpm cli -- styles list` and `pnpm cli -- recipes list`. Select a deterministic seed, scaffold the chosen recipe, and query compatible layouts. Validate copy and real media capacity before authoring.
3. Choose HTML-native for every slide unless an explicit visual-master exception is justified. Use one stable `data-slide-id` per slide and `data-object-id` per editable object. For editable PPTX, keep factual text and semantic content inside stable boundaries and use the smallest planned fallback region.
4. Create a starter source with:
   ```bash
   pnpm cli -- new path/to/deck.html
   ```
   Author the planned slides at 1920×1080. Use `.slide` plus `.active`/`.visible`; do not create a responsive scrolling document.
5. Add versioned DiagramSpec, MotionProgram, TransitionSpec, and MediaPlacement metadata only where the plan requires them. Add validated `data-pptx-shape`, `data-pptx-gradient`, `data-pptx-chart`, table, notes, and local-media contracts when the PPTX plan requires native objects. Do not hard-wire anonymous animations or flatten supported diagrams into screenshots.
6. Run `pnpm cli -- validate path/to/deck.html` before visual operation. For editable PPTX, also run `pnpm cli -- pptx html-check --input path/to/deck.html --output pptx-html-readiness.json`; add `--strict` for native-oriented slide plans.
7. Return to `workflows/studio.md`. Launch the exact source with `pnpm studio:open`, open the printed URL, use Studio to review and edit, and Save explicitly.
8. After the Studio reload check, build author and share HTML and run only the requested quality/export workflows.
</process>

<prohibition>
Do not stop after step 4 or report the raw starter HTML as the completed Studio deliverable. A Studio-first request is incomplete until the editor URL was launched, the source was saved through Studio, and the saved revision was validated.
</prohibition>

<success_criteria>
- Plan, style, recipe, layouts, and stable-ID source exist.
- Editable-PPTX plans include object mappings, bounded fallback intent, and a readiness report with no blockers.
- The exact source opens in Studio rather than the welcome deck.
- Visual edits persist after Save and reload.
- Requested author/share/export outputs pass their gates.
</success_criteria>
</workflow>
