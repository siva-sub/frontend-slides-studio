<workflow name="assets-and-media">
<required_reading>
- Read `references/product-map.md`, `references/commands.md`, and the media section of `references/studio-controls.md`.
</required_reading>

<process>
1. Select a licensed recipe, style, and compatible layout before writing the asset prompt. Inspect with `pnpm cli -- recipes inspect`, `pnpm cli -- styles inspect`, and `pnpm cli -- layouts query` when the choice is unclear.
2. Reserve fidelity-critical logos, product UI, charts, evidence, and supplied images as independent media placements. Generated backgrounds must leave those regions empty.
3. Select the intended image/video object in Studio. Attach a folder workspace when deck-relative persistent media is required; otherwise Studio uses a bounded embedded-media fallback.
4. For deterministic CLI planning, create a versioned plan with `pnpm cli -- asset plan --style ... --layout ...`. Record provider capabilities, protected regions, prompt hash, and reference hashes.
5. Start the authenticated export service. In Studio, enter the local service URL and export token, then use **Generate and apply**. For batch use, submit with `pnpm cli -- asset generate` and wait for a terminal job state.
6. Apply the artifact to its declared stable slot. Preserve fit, focal point, pan, zoom, rotation, normalized crop, alt text, and layout slot so HTML and PPTX use the same geometry.
7. For reconstruction, keep the visual master, clean plate, masks, independent layers, overlay trace, scene manifest, A1/A2/B decisions, edge checks, and render-back evidence together.
8. Save in Studio, reload, and run rendered quality after placement. Generated evidence remains pending manual review until a named reviewer inspects a fresh render.
</process>

<success_criteria>
- Real assets remain independent and unredrawn unless explicitly authorized.
- Media survives Save and reload with identical framing.
- Generated assets retain plan and evidence provenance.
</success_criteria>
</workflow>
