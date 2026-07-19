<workflow name="present-and-rehearse">
<required_reading>
- Read `references/presenter-view.md` for display, privacy, synchronization, and fallback behavior.
- Read `references/studio-controls.md` for the current Studio controls.
- For speaker notes that must reach PowerPoint, also read `references/pptx-native.md` and `workflows/export.md`.
</required_reading>

<process>
1. Open the exact deck through `pnpm studio:open -- --input "$(realpath <deck.html>)"`. Dual-window presenting requires this authenticated launch session; a welcome-only or manually opened file can still use Presentation only.
2. Review the deck as a visual story before rehearsing. Each page should communicate one takeaway through a purposeful image, chart, table, or typed diagram where that is clearer than prose. Do not decorate a weak narrative with generic imagery.
3. Add or revise private cues in **Speaker notes** for every page that needs them. Keep notes speaker-oriented: evidence reminders, transitions, emphasis, timing, and questions. Do not repeat the visible slide verbatim.
4. Save and reload. Confirm every notes edit persists in one `script[type="text/plain"][data-speaker-notes]` element on its slide.
5. On Windows, press **Win+P** and choose **Extend**. Duplicate mirrors one desktop and cannot keep presenter notes private. The browser cannot invoke Win+P for the user.
6. Click **Present with speaker view**. Studio opens role-scoped presenter and audience windows:
   - Presenter shows current and next previews, private notes, elapsed timer, clock, progress, navigation, timer controls, and audience connection state.
   - Audience shows only the active slide, progress, connection state, navigation, and an explicit fullscreen control.
7. If the browser grants Window Management permission and reports another display, Studio places the audience on the external screen and the presenter on the current screen. Otherwise move the audience window manually.
8. Click **Enter fullscreen** or press **F** inside the audience window. Fullscreen requires a user gesture in that window.
9. Rehearse navigation from both windows. Verify skipped pages remain excluded, reduced-motion behavior is complete, current/next previews are correct, notes advance with the current page, and diagrams/media load from the contained deck asset route.
10. Close and reopen the audience window to verify recovery. If a popup is blocked, allow popups and use **Reopen audience** from Studio or Presenter view.
11. When multiple displays, popups, or synchronization are unavailable, click **Presentation only**. It replaces Studio with a notes-free audience view in the current window. Press Escape or **Exit presentation** to return.
12. If editable PPTX is requested, export after rehearsal and verify the output reports speaker notes. Inspect the actual PPTX notes pane after render-back and during the edit-save-reopen review.
</process>

<privacy_rule>
Speaker notes must never enter audience bootstrap HTML, audience DOM, shared BroadcastChannel state, thumbnails, share HTML, or presentation-only HTML. Shared state carries only session identity, deck revision, slide state, timer state, connection state, and monotonic sequence metadata.
</privacy_rule>

<success_criteria>
- Presenter and audience windows synchronize navigation in both directions.
- Presenter shows current/next previews, notes, timer, clock, progress, and connection status.
- Audience and Presentation only contain no note metadata or note text.
- Win+P Extend, popup, screen-placement, and fullscreen constraints are explained honestly.
- The fallback works on one display and without popup access.
- Studio-authored notes persist in HTML and appear in editable PPTX speaker notes when that output is requested.
</success_criteria>
</workflow>
