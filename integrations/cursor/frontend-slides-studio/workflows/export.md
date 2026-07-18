<workflow name="validate-build-export">
<required_reading>
- Read `references/commands.md` and the export section of `references/troubleshooting.md`.
- Read `references/contracts.md` for review-state semantics.
</required_reading>

<process>
1. Save the Studio source and reload it before export. Run `pnpm cli -- validate <source>` and build author/share HTML with `pnpm cli -- build`.
2. Inspect share HTML for authoring chrome, private metadata, unsafe URLs, and external runtime dependencies.
3. Start the localhost export service with an explicit `SLIDES_STUDIO_SOURCE_ROOT` containing the real saved path and a one-time `SLIDES_STUDIO_EXPORT_TOKEN`. Keep it in a persistent terminal.
4. In Studio, verify the absolute source path, `http://127.0.0.1:4317`, token, format, and quality gate. Export remains disabled while the deck is dirty.
5. Run deck-wide strict quality with `pnpm cli -- quality --strict` for canonical delivery. Repair blocking bounds, overflow, overlap, connector, asset, clone, or settlement findings in Studio; save and rerun.
6. Export PDF only after the runtime enters settled state: finish entrances, pause loops at poster progress 0.5 unless overridden, seek media, wait boundedly for fonts/images, and hide chrome. Use `pnpm cli -- export --format pdf --quality-gate strict --wait`.
7. Raster PPTX is one frozen slide image per page and must be labeled non-editable.
8. Editable PPTX must include native/fallback counts, fallback reasons, crop metadata, quality evidence, and motion limitations. Generate from a validated graph with `pnpm cli -- pptx editable --graph ... --quality-report ... --output ...`.
9. If no render backend exists, editable status is `unverified`. Fresh render-back produces `rendered_pending_manual_review`; only `pnpm cli -- pptx review --report ... --reviewer ... --evidence ...` may record `passed` after a named reviewer inspects it.
10. Report Studio URL, source and output paths, file sizes, quality report/screenshots, editability, render backend, and unresolved manual checks.
</process>

<success_criteria>
- Export uses the same saved revision reviewed in Studio.
- Strict quality passes for canonical delivery.
- Static outputs are settled and normalized.
- PPTX editability and evidence status are described honestly.
</success_criteria>
</workflow>
