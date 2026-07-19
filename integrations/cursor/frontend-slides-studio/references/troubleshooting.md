<troubleshooting>
<launch>
- **Welcome deck opened instead of the requested file:** the agent used `pnpm dev:studio`. Stop it and use `pnpm studio:open -- --input "$(realpath <deck>)"`, then open the complete printed URL including `?session=...`.
- **401 Invalid session token:** use the latest launcher URL without editing its query string. A token belongs to one running Studio process.
- **403 loopback request required:** open the `http://127.0.0.1:<port>/` URL. Do not proxy the launch bridge through a remote origin.
- **Port occupied:** the launcher scans upward from 4173 or the requested port. Use the exact port it prints.
- **Vite missing:** run `pnpm install --frozen-lockfile` from `<workspace-root>`.
- **Launch timeout:** inspect the printed `.slides-studio/studio-<port>.log`, fix the first error, and retry once.
</launch>

<source_and_save>
- **Source too large:** the launch bridge defaults to a 20 MB HTML limit. Move large binary media into deck-relative assets instead of embedding it.
- **Save appears to do nothing:** finish the text edit or pointer gesture, blur the active field, and wait for `UNSAVED` before pressing Save.
- **Save rejected an arbitrary path:** expected. The bridge is locked to the one server-configured source and never accepts a client path.
- **Opened another file manually:** this intentionally detaches the server-backed launch session. Relaunch the desired source for atomic bridge save and export-path prefill.
- **Media disappeared after reload:** attach a folder workspace and stage media under `assets/user-media/`, or confirm the fallback data URL remains within size limits.
</source_and_save>

<preview_geometry>
- The iframe and export must use the source's measured intrinsic 16:9 stage. New decks default to 1920×1080; imported 1280×720 decks remain 1280×720 internally.
- If the stage overflows, verify there is one fixed stage and no nested scaling or CSS `zoom`. Object movement uses scale-correct deltas and individual CSS `translate`.
</preview_geometry>

<present>
- **Present with speaker view is disabled:** save the deck and launch it through `pnpm studio:open`; a manual browser file has no role-scoped presentation bridge.
- **Popup blocked:** allow popups for the loopback Studio origin, then use Reopen audience. Presentation only requires no popup.
- **Presenter and projector show the same desktop:** the operating system is mirroring. On Windows press Win+P and choose Extend; on macOS/Linux disable mirroring.
- **Window placement permission denied:** move Audience to the external display manually. Multi-screen placement is progressive enhancement.
- **Fullscreen did not start:** click Enter fullscreen or press F inside Audience. A click in Studio or Presenter does not satisfy the audience-window user-gesture requirement.
- **Audience disconnected:** reopen it from Studio or Presenter. Either remaining view can continue navigating.
- **Notes visible to the audience:** stop presenting. Verify the source uses only `script[type="text/plain"][data-speaker-notes]`, relaunch through Studio, and rerun `pnpm smoke:presenter`; never paste notes into visible slide elements.
- **Relative media missing:** keep the asset inside the deck directory and use an allowed CSS/image/font/audio/video/JSON/script extension. The presentation asset route is read-only and contained.
</present>

<export>
- **Export button says Save before export:** save the current revision first. The service reads the file on disk, not unsaved browser state.
- **Export source path empty:** authenticated launch pre-fills it. Manual sessions require an absolute saved path.
- **Service unreachable:** start `pnpm dev:export` with `SLIDES_STUDIO_SOURCE_ROOT` and `SLIDES_STUDIO_EXPORT_TOKEN`; default URL is `http://127.0.0.1:4317`.
- **401 from export service:** the Studio token and export-service token are different. Enter `SLIDES_STUDIO_EXPORT_TOKEN` in the asset/export token field.
- **Source outside root or symlink escape:** restart the service with a source root containing the real source path. Do not weaken containment.
- **Editable PPTX readiness is blocked:** open the readiness panel or run `pnpm cli -- pptx html-check --input <source>`. Repair duplicate/missing IDs, invalid metadata, unsafe links, or unsupported media paths before export.
- **Strict readiness fails with hybrid warnings:** compare untracked text, nested stable objects, remote media, transition downgrades, and regional fallbacks with the per-slide plan. Keep intentional hybrid fallback only in default preflight mode.
- **Strict quality failure:** open the report and screenshots, focus each blocking issue, repair in Studio, save, and resubmit.
- **Editable PPTX remains pending:** inspect the actual inventory and fresh LibreOffice/PowerPoint/Keynote render-back, perform a representative edit-save-reopen check, and record a named review; do not relabel it implicitly.
</export>

<optional_dependencies>
- Motion analysis requires ffmpeg and ffprobe.
- Browser export requires Playwright Chromium.
- PDF inspection requires Poppler.
- PPTX and image checks require Pillow and python-pptx.
- Editable-PPTX render-back uses LibreOffice when available.
</optional_dependencies>
</troubleshooting>
