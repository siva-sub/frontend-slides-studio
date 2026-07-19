<contracts>
- DeckGoal schema version: 1.
- Slide render modes: `html`, `visual-master`.
- Iframe protocol version: 1. Validate `event.source` and every discriminated message.
- Studio launch bridge: one random token, one loopback Vite process, one server-configured real HTML path. Clients may read or atomically save HTML but may never choose another path.
- Studio launch state is written under ignored `.slides-studio/`; the complete printed URL is required to load the configured deck.
- Motion artifacts: MotionAnalysis → MotionIntent → MotionProgram.
- Presentation object sources: DOM, DiagramSpec, visual scene, raster fallback.
- Editable-PPTX plans declare each slide `native-oriented`, `hybrid`, or `raster`, plus mandatory-native IDs and the smallest allowed fallback regions.
- HTML readiness is a conservative preflight. The export report is authoritative for actual native/fallback inventory.
- Visual review states: planned → generated → rendered_pending_manual_review → passed/failed; `unverified` is allowed when render-back is unavailable.
- Every fallback object records a reason. Text must not appear both natively and inside its raster fallback. Unplanned full-slide fallback or rasterized mandatory-native text blocks approval.
- Historical restore is exact; edits from old versions branch.
</contracts>
