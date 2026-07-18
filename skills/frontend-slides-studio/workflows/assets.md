<workflow>
1. Select a licensed style, recipe, and compatible layout before writing the asset prompt. Use `slides-studio styles list`, `slides-studio recipes inspect`, and `slides-studio layouts query` when the choice is unclear.
2. Reserve fidelity-critical logos, product UI, charts, evidence, and supplied images as independent media placements. The generated background must leave those regions empty.
3. Create a versioned asset plan with `slides-studio asset plan --style ... --layout ...`. Record provider capabilities, protected regions, prompt hash, and reference hashes.
4. Submit the plan to the authenticated loopback service with `slides-studio asset generate`. Monitor the job until it reaches `complete`, `failed`, or `cancelled`.
5. Apply the generated artifact to its declared media slot. Preserve the slot ID, fit, focal point, pan, zoom, rotation, crop, and alt text so HTML and PPTX use the same geometry.
6. For reconstruction, keep the visual master, clean plate, masks, independent layers, overlay trace, scene manifest, A1/A2/B decisions, edge checks, and render-back evidence together.
7. Run the rendered quality gate after placement. Generated evidence remains pending manual review until a named reviewer inspects a fresh render.
</workflow>
