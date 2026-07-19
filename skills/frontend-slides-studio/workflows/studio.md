<workflow name="studio-operator">
<required_reading>
- On first use or after a failed doctor probe, read `references/setup.md`.
- Read `references/product-map.md` to choose subsystems.
- Read `references/commands.md` before running the workspace.
- Read `references/studio-controls.md` before browser operation.
- Read `references/troubleshooting.md` only if launch, save, preview, or export fails.
</required_reading>

<process>
1. Resolve and verify `<workspace-root>` using `SKILL.md`'s runtime context. Run `pnpm install --frozen-lockfile` only when dependencies are missing or the lockfile changed, then run `pnpm build` before the first Studio launch.
2. Establish the source:
   - New presentation → follow `workflows/create.md` through plan, style/recipe/layout selection, and starter source creation.
   - Existing HTML → inspect it, then follow `workflows/import-edit.md`.
   - Any editable-PPTX output → also follow `workflows/pptx-html.md` before authoring or conversion.
   - Continuous prose without discrete slides → stop and ask before promoting sections into pages.
3. Convert the source path to an absolute real path. Launch the exact deck:
   ```bash
   pnpm studio:open -- --input "$(realpath <deck.html>)"
   ```
   Capture the printed `Studio URL`, source path, PID, log path, and stop command. The URL contains a local session token; do not strip it.
4. Verify the URL responds on `127.0.0.1`. Open it with available browser automation. The launch bridge loads the requested deck automatically; do not open the welcome deck and do not use a file picker for this path.
5. Confirm the workspace header shows the expected filename, page count, import strategy, confidence, and no unexpected warning. Confirm the export source field is prefilled with the same absolute path.
6. Author through the UI rather than bypassing it:
   - **Browse** to verify navigation and original behavior.
   - **Edit** to select objects and change text or media properties.
   - **Move** to drag, snap, resize, layer, nudge, or delete objects.
   - Use the page rail for navigation, search, duplicate, reorder, skip/include, and deletion.
   - Use Recipe → Style → Compatible layout before asset planning.
   - Insert typed diagrams through DiagramSpec JSON.
   - Use media framing, asset generation, motion, transitions, and quality controls only when the product map routes the request there.
   - Write private per-page cues in **Speaker notes**. Notes persist in source HTML, appear in Presenter view, stay out of Audience/Presentation only, and map to editable PPTX notes.
   - Use **Present with speaker view** for synchronized presenter/audience windows. Use **Presentation only** when popups, multiple displays, or synchronization are unavailable. Follow `workflows/present.md` for Win+P, fullscreen, and rehearsal.
   - Review **Editable PPTX readiness** before editable export. Resolve blockers and compare every hybrid warning with the approved slide plan.
7. After every meaningful change, wait for the `UNSAVED` state before pressing **Save**. In a launch session, Save atomically updates only the configured source path. Do not send a client-selected path to the launch bridge.
8. Reload the Studio URL or relaunch the saved path and verify the edited text, geometry, media, slide order, diagrams, motion metadata, transitions, and PPTX readiness state persist.
9. Run **Run page audit** for the current page. Rehearse through `workflows/present.md` when presentation or speaker-note behavior is required. For delivery, follow `workflows/export.md` for deck-wide validation, author/share builds, strict quality, and requested exports.
10. If PDF, raster PPTX, asset generation, or deck-wide quality is required, start the authenticated export service in a persistent terminal using `references/commands.md`; enter the same service URL and token in Studio.
11. Keep Studio running when the user wants to continue editing. Otherwise run the printed stop command or:
   ```bash
   pnpm studio:stop -- --state <state-file>
   ```
12. Report the Studio URL, source path, actions performed, saved revision, outputs, quality evidence, and any manual review still required.
</process>

<failure_rule>
Do not silently fall back to writing one HTML file. If Studio cannot launch, report the failing command and log path, consult troubleshooting, attempt a bounded repair, and ask before switching to explicit HTML-only mode.
</failure_rule>

<success_criteria>
- The requested deck, not the welcome deck, opens at the printed Studio URL.
- The relevant Studio controls were used and the source was explicitly saved.
- A reload proves persistence.
- Requested validation and export gates pass.
- Presenter/Audience requests prove notes isolation, current/next previews, bidirectional navigation, timer/clock/progress, reconnect, reduced motion, and Presentation-only fallback.
- Editable-PPTX requests have a reviewed readiness report, object-level fallback plan, and verified speaker notes when authored.
</success_criteria>
</workflow>
