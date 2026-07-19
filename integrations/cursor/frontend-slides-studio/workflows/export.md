<workflow name="validate-build-export">
<required_reading>
- Read `references/commands.md` and the export section of `references/troubleshooting.md`.
- Read `references/contracts.md` for review-state semantics.
- For editable PPTX, read `workflows/pptx-html.md` and `references/pptx-native.md` before export.
</required_reading>

<process>
1. Save the Studio source and reload it before export. Run `pnpm cli -- validate <source>` and build author/share HTML with `pnpm cli -- build`. For editable PPTX, run `pnpm cli -- pptx html-check --input <source> --output pptx-html-readiness.json`; use `--strict` for native-oriented slide plans.
2. Inspect share HTML for authoring chrome, private metadata, unsafe URLs, and external runtime dependencies.
3. Start the localhost export service with an explicit `SLIDES_STUDIO_SOURCE_ROOT` containing the real saved path and a one-time `SLIDES_STUDIO_EXPORT_TOKEN`. Keep it in a persistent terminal.
4. In Studio, verify the absolute source path, `http://127.0.0.1:4317`, token, and output intent. Choose PDF for text-preserving static pages, raster PPTX for frozen pages, or editable PPTX for native objects with declared fallbacks. Export remains disabled while the deck is dirty.
5. Run deck-wide strict quality with `pnpm cli -- quality --strict` for canonical delivery. Repair blocking bounds, overflow, overlap, connector, asset, clone, or settlement findings in Studio; save and rerun.
6. Export PDF only after the runtime enters settled state: finish entrances, pause loops at poster progress 0.5 unless overridden, seek media, wait boundedly for fonts/images, and hide chrome. Use `pnpm cli -- export --format pdf --quality-gate strict --wait`.
7. Raster PPTX is one frozen slide image per page and must be labeled non-editable. Use `--format pptx`.
8. Editable PPTX must include native/fallback counts, fallback reasons, crop metadata, quality evidence, and motion limitations. Use `pnpm cli -- export --format editable-pptx --quality-gate strict --wait` for a saved HTML deck. The advanced graph path remains `pnpm cli -- pptx editable --graph ... --quality-report ... --output ...`.
9. Compare the actual object inventory with the per-slide PPTX plan. Reject unplanned full-slide fallback, rasterized mandatory-native text, oversized fallback regions, or missing native tables, charts, diagrams, shapes, and pictures. If HTML contains speaker notes, require a nonzero speaker-notes inventory and inspect the notes pane in the output. A readiness estimate is not the actual inventory.
10. Both PPTX modes must carry evidence that package validation confirmed ISO/IEC 29500 Transitional compatibility. Run `pnpm cli -- pptx validate --input <actual-output.pptx>` and bind its report to the delivered artifact hash.
11. If no render backend exists, editable status is `unverified`. Fresh render-back produces `rendered_pending_manual_review`. Inspect representative native objects and authored speaker notes in a presentation editor, perform an edit-save-reopen check, and then use `pnpm cli -- pptx review --report ... --reviewer ... --evidence ...` to record `passed`.
12. Report Studio URL, source and output paths, file sizes, readiness report, actual native/fallback inventory, ISO/IEC 29500 evidence, quality report/screenshots, practical edit check, render backend, and unresolved manual checks.
</process>

<success_criteria>
- Export uses the same saved revision reviewed in Studio.
- Strict quality passes for canonical delivery.
- Static outputs are settled and normalized.
- PPTX readiness, actual native/fallback inventory, practical editability, speaker-note preservation, ISO/IEC 29500 Transitional package compatibility validation, and evidence status are described honestly.
</success_criteria>
</workflow>
