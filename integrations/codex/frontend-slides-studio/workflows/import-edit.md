<workflow name="import-edit-html">
<required_reading>
- Read `references/commands.md` and `references/studio-controls.md`.
- Return to `workflows/studio.md` for launch, save, reload, and delivery.
</required_reading>

<process>
1. Inspect the source for discrete slide structures, intrinsic stage dimensions, scripts, motion, media, and unsafe URLs. Preserve continuous prose as document mode unless the user confirms page promotion.
2. When normalization is needed, run:
   ```bash
   pnpm cli -- import --input existing.html --output normalized.html
   pnpm cli -- validate normalized.html
   ```
3. Launch the chosen exact source with `pnpm studio:open -- --input "$(realpath <source>)"`. Use the printed authenticated URL; do not substitute `file://`, a generic static server, or the welcome-only development URL.
4. In **Browse**, verify original navigation, scripts, animations, page count, and the reported normalization strategy/confidence before editing.
5. Use **Edit** for copy and properties and **Move** for geometry. Geometry uses individual CSS `translate`, `scale`, and `rotate` so existing animated `transform` remains intact.
6. Before detaching flow content, measure every box, preserve flow footprints, and detach relative to the final containing block.
7. Commit commands at gesture end. Use page, media, motion, transition, diagram, audit, and export controls described in `references/studio-controls.md` as required.
8. Wait for `UNSAVED`, press **Save**, reload the authenticated URL, and verify IDs, content, geometry, media, navigation, slide operations, and animation behavior.
9. Return to `workflows/studio.md`, then run `workflows/export.md` when delivery formats are requested.
</process>

<success_criteria>
- The imported source retains its measured stage and behavior.
- Studio edits persist to the intended source after reload.
- No continuous document was silently converted into guessed slides.
</success_criteria>
</workflow>
