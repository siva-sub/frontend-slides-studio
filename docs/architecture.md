# Architecture

## Trust boundaries

Studio is a host application. Imported decks run in a sandboxed iframe with `allow-scripts` but not `allow-same-origin`. Host messages are discriminated, runtime-validated, and accepted only when `event.source` is the active iframe. Static previews must strip scripts, event attributes, and script URLs.

The export service is a separate localhost process. It accepts bearer-authenticated requests only from loopback origins, resolves real paths beneath an explicit source root, writes into per-job directories, and closes browsers in `finally` blocks.

Presenter/Audience launch is another boundary inside the Studio launch bridge. A saved source snapshot receives separate random presenter and audience capabilities. Presenter bootstrap includes source notes; Audience bootstrap receives notes-stripped HTML. Shared BroadcastChannel messages contain typed slide, timer, heartbeat, and lifecycle state only. Sandboxed deck frames do not own synchronization.

## Source and build layers

1. **DeckGoal** captures intent, stable slide IDs, render modes, layout, diagram, visual and motion metadata.
2. **HTML** is authoritative for HTML-native slides.
3. **Runtime IIFE** supplies fixed-stage navigation, WAAPI playback, hidden-slide suspension and settled export. Canonical decks default to 1920×1080; imported 16:9 stages preserve intrinsic geometry and are uniformly contained by preview and normalized export frames.
4. **Author build** embeds runtime and authoring metadata.
5. **Share build** removes authoring/private state and embeds only runtime behavior.
6. **Presentation session views** render a notes-free audience document and motion-suppressed current/next presenter previews from one saved revision. Lamport sequence tuples reject stale cross-window updates.
7. **Presentation object graph** converges DOM snapshots, DiagramSpec and contained visual scenes for editable exports, including speaker notes.

## Diagram adapters

All 27 public diagram type names route through exhaustive deterministic type-specific adapters. Each adapter normalizes V1 or V2 input into the same renderer-neutral stable-ID primitives, so inline SVG and editable presentation objects share one lossless scene. Auto-layout assigns 4px-aligned boxes. Routing fans shared ports and produces orthogonal rounded paths. Validation rejects missing endpoints, overlapping boxes, excessive focal emphasis, diagonal segments, and non-transit obstacle crossings.

## Motion boundary

The Python analyzer uses ffprobe for source metadata and streams scaled grayscale frames from ffmpeg. It emits energy, holds/motion segments, beat/easing/loop hints, and caveats. No analysis output refers to a DOM selector. Object mapping occurs only in MotionIntent; the CLI compiles that mapping into a MotionProgram.

## Presenter session boundary

The runtime controller uses an injectable transport and typed protocol. Each participant carries session, deck, revision, role, sender, and sequence identity. Navigation is bidirectional; timer anchors synchronize elapsed time; hello/state and heartbeat/goodbye support reload and close recovery. Notes remain local to Presenter and never enter the transport.

The authenticated launch bridge serves deck-relative assets through role capabilities and a read-only extension allowlist. It rejects traversal, source-HTML reads, oversized files, and symlink escape. Window Management and fullscreen remain progressive browser capabilities; Presentation only is the one-window fallback.

## Editable export boundary

Every object records source kind, source ID, native/fallback status and fallback reason. DiagramSpec converts losslessly where supported. Visual-master scenes begin with exactly one clean plate plus declared native/layer objects. Unsupported DOM regions become one raster fallback and must not duplicate native text.
