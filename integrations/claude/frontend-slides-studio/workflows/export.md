<workflow>
1. Run `slides-studio validate` on source and DeckGoal metadata, then run `slides-studio quality --strict` for canonical decks.
2. Build author HTML for editing and share HTML for delivery. Inspect share HTML for authoring chrome, private metadata, unsafe URLs, and external runtime dependencies.
3. Start the localhost export service with an explicit source root and one-time token.
4. Export PDF only after the runtime enters settled state: finish entrances, pause loops at poster progress 0.5 unless overridden, seek media, wait boundedly for fonts and images, and hide chrome. Use `--quality-gate strict --wait` for canonical delivery.
5. Raster PPTX is one frozen slide image per page and must be labeled non-editable.
6. Editable PPTX must include native and fallback counts, fallback reasons, crop metadata, quality evidence, and explicit motion limitations. Generate from a validated object graph with `slides-studio pptx editable --graph ... --quality-report ... --output ...`. If no render backend exists, status is `unverified`; after render-back, status is `rendered_pending_manual_review` until viewed.
7. Never relabel editable output as passed implicitly. Only `slides-studio pptx review --report ... --reviewer ... --evidence ...` may record `passed`, and only after the named reviewer inspected the fresh render-back artifact.
8. Report output paths, file sizes, test evidence, editability, and unresolved manual checks.
</workflow>
