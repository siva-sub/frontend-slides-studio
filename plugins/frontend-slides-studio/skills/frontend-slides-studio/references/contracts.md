<contracts>
- DeckGoal schema version: 1.
- Slide render modes: `html`, `visual-master`.
- Iframe protocol version: 1. Validate `event.source` and every discriminated message.
- Studio launch bridge: one random token, one loopback Vite process, one server-configured real HTML path. Clients may read or atomically save HTML but may never choose another path.
- Studio launch state is written under ignored `.slides-studio/`; the complete printed URL is required to load the configured deck.
- Presentation session protocol version: 1. Every message carries session ID, deck ID, SHA-256 revision, sender role/ID, Lamport sequence, and sent time. Wrong-identity and stale messages are rejected.
- Presenter and audience receive separate random read-only capabilities. Audience bootstrap and shared session messages never contain speaker notes.
- Motion artifacts: MotionAnalysis → MotionIntent → MotionProgram.
- Presentation object sources: DOM, DiagramSpec, visual scene, raster fallback.
- Speaker notes use one `script[type="text/plain"][data-speaker-notes]` per slide. Dangerous closing-script text is base64 encoded with explicit metadata and decoded before presenter display or PPTX capture.
- Editable-PPTX plans declare each slide `native-oriented`, `hybrid`, or `raster`, plus mandatory-native IDs and the smallest allowed fallback regions.
- HTML readiness is a conservative preflight. The export report is authoritative for actual native/fallback inventory.
- Visual review states: planned → generated → rendered_pending_manual_review → passed/failed; `unverified` is allowed when render-back is unavailable.
- Every fallback object records a reason. Text must not appear both natively and inside its raster fallback. Unplanned full-slide fallback or rasterized mandatory-native text blocks approval.
- Historical restore is exact; edits from old versions branch.
</contracts>
