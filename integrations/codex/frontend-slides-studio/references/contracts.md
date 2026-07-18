<contracts>
- DeckGoal schema version: 1.
- Slide render modes: `html`, `visual-master`.
- Iframe protocol version: 1. Validate `event.source` and every discriminated message.
- Motion artifacts: MotionAnalysis → MotionIntent → MotionProgram.
- Presentation object sources: DOM, DiagramSpec, visual scene, raster fallback.
- Visual review states: planned → generated → rendered_pending_manual_review → passed/failed; `unverified` is allowed when render-back is unavailable.
- Every fallback object records a reason. Text must not appear both natively and inside its raster fallback.
- Historical restore is exact; edits from old versions branch.
</contracts>
