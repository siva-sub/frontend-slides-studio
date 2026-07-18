<studio_controls>
The authenticated launch URL loads the configured deck automatically. The editor is divided into the top bar, page rail, canvas, and inspector.

<top_bar>
- **Browse / Edit / Move:** modes 1, 2, and 3.
  - Browse preserves deck interaction and navigation.
  - Edit selects objects and enables copy/property changes.
  - Move selects objects for drag, resize, snapping, nudging, layering, and deletion.
- **Undo / Redo:** restores exact in-memory history snapshots.
- **Open HTML:** detaches from the launch session and opens another file through browser file access.
- **Attach folder:** enables content-hashed media staging under `assets/user-media/` when the File System Access API is available.
- **Download copy:** downloads without overwriting the source.
- **Save:** in an authenticated launch session, atomically saves only the configured source file. In a manual session, it uses File System Access or download fallback.
</top_bar>

<page_rail>
- Search by page heading or text.
- Select pages by numbered thumbnail.
- **Duplicate page** copies the current page with new stable IDs.
- Inspector page actions move up/down, skip/include, or delete the current page.
</page_rail>

<canvas>
- The imported stage is uniformly contained and centered; 1280×720 and 1920×1080 sources keep intrinsic geometry.
- Selection overlays and pointer deltas are scale-correct.
- Move mode exposes eight resize handles. Grid and sibling snapping are active; hold Alt to bypass snapping.
- Arrow controls nudge by 1px; browser keyboard handling supports Shift for larger movement where available.
</canvas>

<inspector>
- **Recipe / Style / Compatible layout:** choose authoring context before asset generation. Selection does not rewrite existing slide visuals by itself; it informs compatible layouts and asset plans.
- **DiagramSpec JSON / Insert validated diagram:** accepts version 1 or 2 and inserts stable-ID editable SVG primitives into the current slide.
- **Selected object / Text content:** text commits on blur. Wait for `UNSAVED` before saving.
- **Media:** replace image/video; choose layout slot; set contain/cover, focal point, pan, zoom, rotation, normalized crop, and alt text; reset framing when needed.
- **Generate asset:** requires a selected image/video object, a prompt, local service URL, and session token. The current style/layout enters the AssetPlan.
- **Geometry / Layer:** nudge and order the selected object.
- **Object motion:** choose reveal, fade, slide, scale, draw, focus, loop, blur, wipe, rotate, pulse, or stagger; set duration, delay, and replay; apply or remove.
- **Page transition:** choose none, crossfade, slide, zoom, circle reveal, clip wipe, pixel grid/bars, or vertical/horizontal slices; set duration, target entrance fraction, and reduced-motion policy.
- **Rendered audit:** runs a current-page non-strict browser audit and lets the operator focus an issue on canvas.
- **Evidence-gated export:** requires a saved absolute source path, the loopback service, token, format, and quality gate. Export is disabled while the deck is dirty.
</inspector>

<operator_sequence>
1. Verify filename and pages.
2. Browse the source before mutation.
3. Select the appropriate authoring mode.
4. Apply one logical change at a time and inspect the canvas.
5. Wait for `UNSAVED`, then Save.
6. Reload and confirm persistence.
7. Run page audit, then deck-wide quality/export when requested.
</operator_sequence>
</studio_controls>
