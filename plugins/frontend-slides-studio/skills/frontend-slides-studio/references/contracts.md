<contracts>
- DeckGoal schema version: 1.
- Slide render modes: `html`, `visual-master`.
- Iframe protocol version: 1. Validate `event.source` and every discriminated message.
- Studio launch bridge: one random token, one loopback Vite process, one server-configured real HTML path. Clients may read or atomically save HTML but may never choose another path.
- Studio launch state is written under ignored `.slides-studio/`; the complete printed URL is required to load the configured deck.
- Motion artifacts: MotionAnalysis → MotionIntent → MotionProgram.
- Presentation object sources: DOM, DiagramSpec, visual scene, raster fallback.
- Visual review states: planned → generated → rendered_pending_manual_review → passed/failed; `unverified` is allowed when render-back is unavailable.
- Every fallback object records a reason. Text must not appear both natively and inside its raster fallback.
- Historical restore is exact; edits from old versions branch.
</contracts>
