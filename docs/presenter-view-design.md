# Presenter View Design

## Purpose

Frontend Slides Studio needs three related experiences:

1. **Audience view** shows the active slide without notes or authoring controls.
2. **Presenter view** shows current and next previews, speaker notes, elapsed time, clock, progress, and navigation controls.
3. **Presentation-only fallback** runs the audience view in the current Studio window when popups, multiple displays, or screen-placement permissions are unavailable.

Speaker notes remain part of the authoritative HTML source and editable PPTX export. The runtime does not copy notes into audience HTML or shared synchronization messages.

## Reference Findings

Reveal.js demonstrates the useful interaction pattern: open a separate speaker window, keep current and upcoming previews synchronized, provide a timer and clock, forward navigation from either window, retry its connection, and reconnect after reload. Frontend Slides Studio will implement these ideas independently with typed messages, role-specific capabilities, strict sender checks, and deterministic stale-message rejection.

The Window Management API can enumerate displays and place windows on a selected screen after permission. It is progressive enhancement because browser support and permission vary. The Presentation API targets external presentation displays, but it is not a reliable foundation for ordinary desktop projector workflows.

Windows display routing remains a user action. The product must tell Windows users to press **Win+P** and choose **Extend**. Duplicate mode mirrors the same desktop and cannot show private presenter notes on one screen while showing the audience slide on another. Browser code cannot invoke Win+P.

## Security and Privacy Contract

The authenticated Studio launch bridge creates an in-memory presentation snapshot and returns separate random audience and presenter capabilities. Child URLs never contain the full Studio save token.

The audience bootstrap receives HTML with every `script[type="text/plain"][data-speaker-notes]` element removed. The presenter bootstrap receives the note map. Shared session state contains slide identity, navigation, timer, connection, and status only. It never contains note text.

Both capabilities are read-only and scoped to one presentation snapshot. Asset reads remain inside the deck directory, reject traversal and symlink escape, enforce size limits, require loopback requests, and use `Cache-Control: no-store`.

Deck previews run in sandboxed iframes without same-origin access. The host view owns synchronization and only sends bounded slide-navigation commands to the iframe bridge.

## Synchronization Contract

Every message carries:

- protocol version and namespace;
- session, deck, and source-revision identity;
- sender role and random sender ID;
- a Lamport sequence number;
- a typed payload.

Participants reject messages for another session, deck, or revision. They compare `(seq, senderId)` tuples and reject stale or duplicate state. Navigation from the presenter, audience, or Studio becomes a new state message, so either presentation window remains usable if the other closes.

Heartbeat and goodbye messages update peer status. Reloaded windows rejoin through a hello/state handshake and recover the latest slide and timer state. Notes do not participate in this transport.

## Timer Model

Presentation state stores a timer anchor, accumulated elapsed milliseconds, and running or paused status. Each view derives display time locally from the shared anchor. Pause, resume, and reset update the shared state; wall-clock time remains local to the presenter view.

## Display and Fullscreen Behavior

The default launch opens presenter and audience windows. The audience window contains an explicit **Enter fullscreen** button and supports `F`, because browsers require a user gesture for fullscreen.

When `window.getScreenDetails()` is available and permission is granted, Studio may place the audience window on a non-primary screen and the presenter window on the current screen. Failure or denial leaves both windows normally positioned.

The presentation panel always offers **Presentation only**. This same-window route hides Studio chrome, notes, and presenter controls. It works with one display, blocked popups, Duplicate mode, or unsupported multi-screen APIs.

Reduced-motion behavior remains governed by the existing slide runtime and `prefers-reduced-motion`. Presenter previews suppress transitions and motion to remain stable and readable.

## Speaker Notes Contract

Each slide may contain exactly one notes element:

```html
<script type="text/plain" data-speaker-notes>
Explain the decision, then pause for questions.
</script>
```

Studio edits this element through the same undoable HTML history as other authoring changes. Empty notes remove the element. DOM text serialization preserves Unicode and safely handles text that contains `</script>`.

Editable PPTX capture maps the notes text to `PresentationSlide.notes`. Package normalization preserves schema-valid notes slides, notes master ordering, theme relationships, and content types. Acceptance must prove that notes authored through the Studio helper appear in the generated PPTX notes part.

## Acceptance

The implementation is complete only when tests demonstrate:

- presenter-only notes and notes-free audience bootstrap;
- current and next previews, elapsed timer, clock, progress, and pause/reset controls;
- bidirectional navigation with stale-message rejection;
- heartbeat, reload, close, and audience-reopen behavior;
- popup and fullscreen failure guidance;
- presentation-only fallback without notes;
- reduced-motion behavior;
- a canonical DiagramSpec slide rendered in both views;
- Studio-authored notes in editable PPTX output;
- passing protocol, runtime, Studio, smoke, external PPTX, and diagnostic gates.

## External References

- [Reveal.js Speaker View](https://revealjs.com/speaker-view)
- [Reveal.js notes plugin source](https://github.com/hakimel/reveal.js/tree/master/plugin/notes)
- [MDN Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API)
- [Chrome Window Management guidance](https://developer.chrome.com/docs/capabilities/web-apis/window-management)
- [MDN Presentation API](https://developer.mozilla.org/en-US/docs/Web/API/Presentation_API)
- [web.dev multiple-screen pattern](https://web.dev/patterns/web-apps/multiple-screens)
