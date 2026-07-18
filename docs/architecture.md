# Architecture

## Trust boundaries

Studio is a host application. Imported decks run in a sandboxed iframe with `allow-scripts` but not `allow-same-origin`. Host messages are discriminated, runtime-validated, and accepted only when `event.source` is the active iframe. Static previews must strip scripts, event attributes, and script URLs.

The export service is a separate localhost process. It accepts bearer-authenticated requests only from loopback origins, resolves real paths beneath an explicit source root, writes into per-job directories, and closes browsers in `finally` blocks.

## Source and build layers

1. **DeckGoal** captures intent, stable slide IDs, render modes, layout, diagram, visual and motion metadata.
2. **HTML** is authoritative for HTML-native slides.
3. **Runtime IIFE** supplies fixed-stage navigation, WAAPI playback, hidden-slide suspension and settled export. Canonical decks default to 1920×1080; imported 16:9 stages preserve intrinsic geometry and are uniformly contained by preview and normalized export frames.
4. **Author build** embeds runtime and authoring metadata.
5. **Share build** removes authoring/private state and embeds only runtime behavior.
6. **Presentation object graph** converges DOM snapshots, DiagramSpec and contained visual scenes for editable exports.

## Diagram adapters

All 27 public diagram type names route through exhaustive deterministic type-specific adapters. Each adapter normalizes V1 or V2 input into the same renderer-neutral stable-ID primitives, so inline SVG and editable presentation objects share one lossless scene. Auto-layout assigns 4px-aligned boxes. Routing fans shared ports and produces orthogonal rounded paths. Validation rejects missing endpoints, overlapping boxes, excessive focal emphasis, diagonal segments, and non-transit obstacle crossings.

## Motion boundary

The Python analyzer uses ffprobe for source metadata and streams scaled grayscale frames from ffmpeg. It emits energy, holds/motion segments, beat/easing/loop hints, and caveats. No analysis output refers to a DOM selector. Object mapping occurs only in MotionIntent; the CLI compiles that mapping into a MotionProgram.

## Editable export boundary

Every object records source kind, source ID, native/fallback status and fallback reason. DiagramSpec converts losslessly where supported. Visual-master scenes begin with exactly one clean plate plus declared native/layer objects. Unsupported DOM regions become one raster fallback and must not duplicate native text.
