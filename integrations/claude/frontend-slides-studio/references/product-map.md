<product_map>
Use this map before choosing a workflow. Frontend Slides Studio is a coordinated system; do not reduce it to the starter HTML template.

| User need | Implemented subsystem | Primary operation | Continue with |
| --- | --- | --- | --- |
| Install for Pi or prepare dependencies | Pi package manifest and workspace setup | Local-path Pi install, core build, workflow-specific optional tools | `references/setup.md` |
| Create or visually edit a deck | Studio launcher and React editor | Open the exact source at an authenticated loopback URL, then use Browse/Edit/Move | `workflows/studio.md` |
| Plan a new deck | DeckGoal, style registry, recipes, layouts | Review content, scaffold a recipe, query layouts, create stable-ID source | `workflows/create.md` |
| Import existing HTML | Normalizer and sandboxed iframe | Detect discrete slides, preserve intrinsic stage, assign stable IDs, report confidence | `workflows/import-edit.md` |
| Choose visual system | Style registry | 32 styles, 256 layouts, 6 recipes; deterministic inspection and media-capacity-aware queries | Studio Recipe/Style/Layout controls and `references/commands.md` |
| Build a diagram | DiagramSpec V1/V2 and diagram kit | Validate one of 27 type-specific adapters, insert stable editable SVG primitives | `workflows/diagram.md` |
| Replace or crop media | Media kit | Content-hashed staging, contain/cover, focal point, pan, zoom, rotation, normalized crop | `workflows/assets.md` and Studio media controls |
| Generate an image asset | Asset plans and export-service jobs | Bind prompt to slide/style/layout, preserve real overlays, retain evidence | `workflows/assets.md` |
| Add object motion | MotionProgram and runtime | Map stable object IDs to validated tracks and replay policy | `workflows/motion.md` |
| Add page transitions | TransitionSpec and runtime | Select one of ten transition kinds with reduced-motion behavior | Studio transition controls |
| Reconstruct an art-directed slide | Visual scene tooling | Clean plate, masks, independent overlays, evidence bundle | `workflows/visual-master.md` |
| Find visual defects | Quality package | Current-page Studio audit plus persisted deck-wide rendered reports | `workflows/export.md` |
| Rehearse or present | Presenter session protocol and role-scoped launch bridge | Private notes, current/next previews, timer/clock/progress, synchronized audience, multi-screen placement, Presentation-only fallback | `workflows/present.md` |
| Deliver browser slides | Export package and runtime | Build author HTML and clean self-contained share HTML | `workflows/export.md` |
| Deliver PDF or raster PPTX | Authenticated export service | Settle motion/media, normalize stage, run quality gate, capture | `workflows/export.md` |
| Author HTML for editable PPTX | PPTX HTML readiness and presentation object graph | Per-slide intent, stable object mapping, conservative native/fallback preflight | `workflows/pptx-html.md` |
| Deliver editable PPTX | Presentation object graph and package validator | Actual inventory, ISO/IEC 29500 validation, render-back, edit-save-reopen, named review | `workflows/export.md` |

<workflow_chaining>
A complete new-deck request normally chains:
`studio.md` → `create.md` → optional `pptx-html.md` / `diagram.md` / `assets.md` / `motion.md` / `visual-master.md` → `studio.md` save and audit → optional `present.md` rehearsal → `export.md`.

A complete edit request normally chains:
`studio.md` → `import-edit.md` → optional `pptx-html.md` and other subsystem workflows → `studio.md` save and reload → `export.md` when delivery is requested.
</workflow_chaining>

<source_of_truth>
- Studio is the visual operator and should be used when visual editing is requested.
- The CLI is the deterministic contract and batch interface.
- HTML remains the source for HTML-native slides.
- DiagramSpec, MotionProgram, TransitionSpec, MediaPlacement, and presentation objects remain versioned metadata rather than anonymous DOM guesses.
- Presentation sessions share typed slide/timer state but never speaker notes; Presenter reads role-scoped notes and Audience receives sanitized HTML.
- PPTX HTML readiness is a conservative preflight; the export report is the source of truth for actual native/fallback inventory, speaker-note count, and review status.
</source_of_truth>
</product_map>
