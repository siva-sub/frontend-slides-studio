<workflow name="pptx-oriented-html-authoring">
<required_reading>
- Read `references/pptx-native.md`, `references/contracts.md`, and `workflows/export.md`.
- Use this workflow for every editable-PPTX request, even when the user does not mention OOXML or native shapes.
</required_reading>

<purpose>
Author HTML that the browser can present faithfully and the editable exporter can reconstruct conservatively. This is a preflight contract for HTML capture. It does not prove final PPTX fidelity, editability, or ISO/IEC 29500 package compatibility.
</purpose>

<plan_contract>
Before writing a slide, add these fields to `slides_plan.md`:

| Field | Required decision |
| --- | --- |
| PPTX intent | `native-oriented`, `hybrid`, or `raster` |
| Mandatory-native objects | Stable object IDs for text, tables, charts, diagrams, shapes, and movable pictures that must remain independently editable |
| Allowed fallbacks | Smallest permitted regions, reason, and whether text may be frozen |
| Local media | Deck-relative path, alt text, fit, crop, focal point, and layout slot |
| Native metadata | Shape preset, chart contract, DiagramSpec, TransitionSpec, notes, or other required `data-pptx-*` fields |
| Verification | Readiness issue code, object inventory expectation, render-back page, and manual edit check |

Do not use one deck-wide native percentage as a substitute for this plan. A title can be mandatory-native while an illustration is an intentional clean-plate region.
</plan_contract>

<html_contract>
1. Use one `.deck-stage` and fixed 16:9 geometry. Give every `.slide` a unique, nonempty `data-slide-id` and set `data-pptx-intent` to `native-oriented`, `hybrid`, or `raster`.
2. Give each independently editable or intentionally regional-fallback object a unique `data-object-id`. Do not nest stable objects unless the parent and child capture behavior was tested.
3. Keep mandatory-native text in leaf elements. Avoid transforms, filters, box shadows, clipping, pseudo-element content, rich mixed runs, and unsupported CSS on those elements. Their final classification still depends on computed browser style and positive rendered bounds.
4. Use `data-pptx-shape` for guaranteed preset geometry. Use either `data-pptx-fill` or `data-pptx-gradient`, not both. Resolve every preset through `pnpm cli -- pptx shapes resolve`.
5. Use semantic `<table>` markup for editable tables. Keep `rowspan` and `colspan` rectangular and bounded by the table.
6. Use validated `data-pptx-chart` JSON for editable categorical charts. Keep labels and values equal in length and finite.
7. Use a diagram host with `data-diagram-type`, `data-object-id`, and a validated `script[data-diagram-spec]`. Do not replace a supported DiagramSpec with a screenshot.
8. Keep editable pictures deck-local or in supported image data URLs. Preserve alt text and normalized media placement metadata. Remote HTTP, blob, video, canvas, iframe, and generic SVG objects require fallback handling.
9. Put speaker notes in `script[type="text/plain"][data-speaker-notes]`. Put page transitions in validated `script[type="application/json"][data-transition-spec]`.
10. Treat untagged CSS artwork as intentional background-only clean-plate decoration. Keep it behind reconstructed objects. Never leave factual text, numbers, chart labels, logos, evidence, or foreground callouts outside a stable object boundary.
11. Use the smallest regional fallback that preserves an unsupported effect. Keep supported text, tables, charts, shapes, diagrams, and pictures native around it.
12. Do not duplicate text between a native object and its clean plate or regional fallback. Every fallback must have one explicit reason in the final inventory.
</html_contract>

<preflight>
Run before opening Studio and after every structural change:

```bash
pnpm cli -- pptx html-check --input path/to/deck.html --output pptx-html-readiness.json
```

Use `--strict` for a `native-oriented` slide plan. Default mode blocks invalid identity or metadata but allows reviewed hybrid warnings. Strict mode also rejects warnings such as untracked text, unsupported stable elements, nested stable objects, remote media, or native-transition downgrades.

Interpret the report conservatively:
- `native-candidate` means explicit metadata maps to a native object type.
- `runtime-dependent` means browser capture still depends on computed style, bounds, or asset resolution.
- `regional-fallback` means the stable object is expected to become pixels.
- `clean-plate` preserves untagged slide artwork and is not independently editable.
- `blocked` means editable export must not proceed.
</preflight>

<studio_review>
1. Open the exact source with `pnpm studio:open`.
2. Set each page's PPTX intent in the **Editable PPTX readiness** panel. Fix blockers before selecting editable PPTX. Review every hybrid warning against the slide plan.
3. Use native-shape, table/chart metadata, DiagramSpec, media, notes, and transition controls as required.
4. Save and reload. Run readiness again because IDs and metadata can change during editing.
5. Run current-page rendered audit, then deck-wide strict quality before export.
</studio_review>

<artifact_acceptance>
1. Export with `--format editable-pptx --quality-gate strict --wait` from the saved revision.
2. Run `pnpm cli -- pptx validate --input <actual-output.pptx>` and retain the report with the artifact hash.
3. Compare actual native/fallback counts and object inventory with each slide plan. Reject unplanned full-slide fallbacks, rasterized mandatory-native text, or fallback regions larger than approved.
4. Render back through LibreOffice, PowerPoint, or Keynote and inspect every page for visual drift.
5. Open representative text, table, chart, connector, shape, and picture objects in a presentation editor. Edit, save, reopen, and confirm practical editability for the mandatory-native set.
6. Record named visual review only after the strict quality, package validation, inventory, render-back, and edit-save-reopen checks pass.
</artifact_acceptance>

<success_criteria>
- Every slide has an explicit PPTX intent and object-level mapping.
- HTML readiness has no blockers; strict mode passes when the slide plan is native-oriented.
- Untagged text and unplanned regional or full-slide fallbacks are absent.
- Actual export inventory matches the approved plan.
- ISO/IEC 29500 Transitional validation, render-back, and named practical-editability review pass for the delivered artifact.
</success_criteria>
</workflow>
