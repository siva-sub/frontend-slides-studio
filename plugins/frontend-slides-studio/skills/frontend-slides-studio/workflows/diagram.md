<workflow name="typed-diagram">
<required_reading>
- Read `references/product-map.md`, `references/commands.md`, and the diagram section of `references/studio-controls.md`.
</required_reading>

<process>
1. Choose the diagram type from the relationship being explained, not from aesthetics. Prefer a table or paragraph if it teaches the same thing more clearly.
2. Keep one semantic node/edge idea per stable ID. Use at most two focal nodes and stay within the type's complexity budget.
3. Validate DiagramSpec V1 or V2 with `pnpm cli -- diagram validate --input diagram.json`. Off-axis edges must be rounded orthogonal routes; shared ports fan; obstacles are avoided; labels keep clearance.
4. Launch or return to Studio, choose the destination page, paste the validated JSON into **DiagramSpec JSON**, and click **Insert validated diagram**.
5. Inspect the stable editable SVG primitives in Studio. Apply optional motion only to node/edge IDs. Reduced motion must show the complete diagram.
6. Save, reload, and run page audit. For editable PPTX, use the DiagramSpec presentation-object adapter rather than rasterizing the whole diagram.
</process>

<success_criteria>
- The diagram uses a supported type-specific adapter and stable IDs.
- It is inserted and reviewed through Studio.
- HTML SVG and editable-PPTX objects share the same normalized scene.
</success_criteria>
</workflow>
