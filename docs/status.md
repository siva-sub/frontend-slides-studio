# Implementation Status

Frontend Slides Studio is an active v0.1 implementation. The public contract is local-first HTML authoring with deterministic static export and explicit evidence for any claim of editable-PPTX fidelity.

## Delivered Capabilities

| Area | Current implementation |
| --- | --- |
| Workspace | Node/pnpm monorepo, TypeScript project references, CI, generated-resource drift checks, unit tests, Python tests, and Playwright smoke suites |
| Protocol | Versioned deck, diagram, media, asset, motion, transition, presenter-session, visual-scene, presentation-object, quality, and export-job contracts with runtime validation and backward-compatible V1 parsing |
| Runtime | Dependency-free browser IIFE, fixed-stage navigation, measured intrinsic stage support, uniform centered scaling, scale-correct pointer geometry, settled export state, reduced-motion behavior, and hidden-slide resource suspension |
| Studio launch and editing | Authenticated loopback launcher for one exact HTML source, automatic deck loading, atomic save-back locked to that source, export-path prefill, sandboxed arbitrary-HTML import, Browse/Edit/Move modes, text editing, snapping, eight-handle resizing, nudging, layers, slide operations, undo/redo, File System Access fallback, content-hashed media replacement, and state restoration |
| Studio integration | Style and recipe browsing, typed stable-ID diagram insertion, media crop/reframe controls, asset plans and local generation jobs, object motion and transitions, private speaker-note authoring, synchronized presenter/audience launch, Presentation-only fallback, current-page issue focus, and authenticated local export jobs |
| Styles and recipes | Apache-2.0 resource bank with 32 styles, 256 layouts, and 6 recipes; browser-safe typed registry; compound style/layout IDs; deterministic queries; recipe scaffolding; prop normalization; and generated-data validation |
| Diagrams | DiagramSpec V1/V2 parsing, deterministic V1 migration, exhaustive type-specific adapters for all 27 public diagram names, lossless stable IDs, editable primitives, SVG rendering, native presentation-object mapping, checked-in fixtures, and gallery drift tests |
| Media | Shared contain/cover geometry, focal point, pan, zoom, rotation, inverse/reframe helpers, MIME verification, content-hash deduplication, Unicode-safe names, AVIF/long-edge derivatives, video-poster fallback, atomic manifests, and traversal/symlink defenses |
| Assets and visual scenes | Protocol-validated asset plans, deterministic and configured-provider jobs, reconnectable lifecycle state, contained artifacts, evidence manifests, letterbox-safe mask editing, exact layer routing, protected-region placement, and reconstruction examples |
| Motion and transitions | ffmpeg-based timing analysis; separate MotionAnalysis, MotionIntent, and MotionProgram contracts; all ten transition kinds; replay always/once/never; cancellable sanitized clones; adjacent preload; real-target entrance timing; and deterministic loop poster settlement |
| Quality | Static and deck-wide browser checks for bounds, text overflow, overlap, connector geometry, missing assets, clone safety, and export settlement; persisted reports and screenshots; report and strict modes |
| Export | Secure asynchronous localhost service, bearer token, Origin/Referer checks, realpath containment, retention cleanup, reconnectable SSE, deterministic PDF, normalized raster PPTX, and editable-PPTX native/fallback inventory |
| Agent integrations | Canonical skill and synchronized Claude, Codex, Cursor, and Claude-plugin copies for create, import/edit, assets, diagrams, motion, presenter/audience rehearsal, visual masters, validation, and export |
| Licensing and clean room | Attribution, third-party notices, machine-readable provenance, byte-verified Apache-2.0 resources, reverse-inventory checks, and clean-room guards against prohibited Dashi artifacts and fingerprints |

## Supported Outputs

- **Author HTML:** editable source plus authoring metadata.
- **Share HTML:** clean self-contained presentation with the dependency-free runtime.
- **PDF:** deterministic static pages after semantic motion and media settlement.
- **Raster PPTX:** normalized full-slide images; intentionally non-editable.
- **Editable PPTX:** named native objects, speaker notes, explicit raster fallbacks, and a generated quality report.

## Evidence-Gated or Intentionally Limited

- Visual-master generation is opt-in, limited to suitable art-directed slides, and requires an explicitly configured provider. Normal HTML builds make no network call.
- Studio provides deep general HTML editing. Specialized property panels for every diagram subtype remain incremental UX work.
- The diagram system has exhaustive adapters for all 27 names, but it is not a spreadsheet-style charting application or a complete data-visualization grammar.
- Editable PPTX preserves supported text, shapes, connectors, images, and stable source-derived names. It remains `rendered_pending_manual_review` or `unverified` until fresh render-back and named visual evidence are recorded.
- Native PowerPoint and Keynote animation export is outside v0.1. HTML retains motion; static formats use deterministic settled poster states.
- Browser code cannot switch operating-system display modes. Multi-screen placement uses permission-gated Window Management when available; users still choose Extend and trigger Audience fullscreen.
- The product has no hosted collaboration, accounts, or cloud persistence. Provider-backed asset generation is optional and explicitly configured.

## Verification Gates

- `pnpm check` builds every package, runs TypeScript and Python tests, checks registry and diagram generated data, validates provenance and clean-room rules, and checks generated integrations and legacy compatibility.
- `pnpm smoke:studio` verifies imported-stage preview containment and editing operations across 1280×720 and 1920×1080 decks.
- `pnpm smoke:presenter` verifies role-scoped bootstrap, notes isolation, current/next previews, bidirectional navigation, timer/clock/progress, reduced motion, contained diagram assets, stale-message rejection, popup handling, and audience reconnect.
- `pnpm smoke:gallery` renders and checks browser output for all 27 diagram types.
- `pnpm smoke:asset` verifies Studio-to-service asset planning, job completion, artifact download, and content-hashed application.
- `pnpm smoke:motion` verifies transition lifecycle, replay behavior, cancellation, and deterministic export settlement.
- `pnpm smoke:export` verifies full-edge PDF and raster PPTX output across both supported intrinsic stage sizes.
- `pnpm smoke:editable` verifies stable native object names, speaker notes, fallback inventory, fresh LibreOffice render-back when available, and the manual-review evidence gate.
- `pnpm smoke` runs all of the browser and export suites above.
