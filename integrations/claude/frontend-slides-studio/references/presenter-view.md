<presenter_view>
Frontend Slides Studio provides three presentation modes.

| Mode | Use | Private notes | Requires authenticated `studio:open` |
| --- | --- | --- | --- |
| Audience | Projector or shared screen | Never | Yes for dual-window launch |
| Presenter | Operator screen | Yes | Yes |
| Presentation only | One-screen or popup-blocked fallback | Never | No |

<display_setup>
- **Windows:** press Win+P and choose **Extend**. Duplicate mirrors one desktop and cannot show private notes separately.
- **macOS/Linux:** enable an extended desktop in system display settings. Mirroring has the same privacy limitation as Windows Duplicate.
- Browsers cannot change the operating-system display mode.
- Window Management (`getScreenDetails`) is permission-gated progressive enhancement. When available, Studio chooses a non-primary screen for Audience and keeps Presenter on the current screen. Denial or unsupported browsers fall back to ordinary windows.
- Fullscreen must be requested from a user gesture inside Audience. Click **Enter fullscreen** or press **F** there.
</display_setup>

<presenter_surface>
- Current preview and next preview are static, motion-suppressed views.
- Speaker notes are plain text from the current unskipped slide.
- Elapsed time is session-synchronized; wall clock is local.
- Pause, resume, and reset update shared timer state.
- Previous/Next, arrow keys, Page Up/Down, Space, Home, and End navigate the session.
- **Reopen audience** restores a closed or blocked audience window with the same role-scoped session.
</presenter_surface>

<audience_surface>
- Only the current slide, progress, connection status, minimal navigation, and fullscreen control are present.
- Speaker-note elements are removed on the server before bootstrap and removed again when the view document is built.
- The audience capability cannot retrieve presenter bootstrap data.
- Reduced motion follows `prefers-reduced-motion`; inactive media pauses.
</audience_surface>

<synchronization>
Messages use protocol version 1 and include session ID, deck ID, source revision, sender role, random sender ID, Lamport sequence, and sent time. State, navigation, timer, hello, heartbeat, and goodbye messages are typed. Wrong-session, wrong-revision, stale, duplicate, or invalid-slide messages are ignored.

Notes are local presenter data. They never appear in synchronization messages. Either Presenter or Audience can navigate. Heartbeats and goodbye messages update connection state, and a reloaded peer recovers through the hello/state handshake.
</synchronization>

<asset_and_security_model>
The launch bridge creates one immutable presentation snapshot with separate random audience and presenter capabilities. Child URLs do not contain the Studio save token. Relative CSS, images, fonts, video, audio, JSON, and scripts load through a read-only contained asset route. The route rejects traversal, source-HTML reads, unsupported extensions, oversized files, and symlink escape.

Deck documents run in sandboxed iframes without same-origin access. Role hosts own session synchronization.
</asset_and_security_model>

<failure_handling>
- Popup blocked → allow popups, use Reopen audience, or use Presentation only.
- Only one display → use Presentation only or keep Presenter and Audience tiled.
- Duplicate/mirror mode → switch to Extend before showing private notes.
- Screen permission denied → move the windows manually.
- Fullscreen denied → click or press F inside Audience, not Studio or Presenter.
- BroadcastChannel unavailable → use Presentation only.
- Missing relative asset → launch with `studio:open`, keep the asset inside the deck directory, and verify its extension is allowed.
</failure_handling>
</presenter_view>
