# Security model

- Studio uses sandboxed iframes to prevent imported CSS, globals and keyboard handlers from taking over the host.
- `postMessage` receivers check `event.source` and parse protocol version 1 messages.
- Share builds remove authoring UI, private metadata, inline event handlers and script URLs.
- Presenter/Audience launch creates separate random read-only role capabilities; child URLs never contain the Studio save token.
- Audience bootstrap, Presentation only, thumbnails, and shared presenter-session messages contain no speaker notes. Presenter reads notes from its role-scoped snapshot.
- Presentation messages carry session/deck/revision identity and Lamport sequence metadata; wrong, stale, duplicate, and invalid-slide messages are ignored.
- Deck-relative presentation assets use a contained read-only route with an extension allowlist, file-size cap, source-HTML denial, and realpath symlink-escape checks.
- Export binds only to `127.0.0.1`, checks Origin/Referer, requires a bearer session token, caps request bodies and slide count, and contains real paths under configured roots.
- Symlink escape is rejected after `realpath`, not by string prefix.
- Visual scenes resolve every asset beneath a job root.
- Provider credentials are read only from explicit process environment. No code walks project parents for `.env` files.
- Fidelity-critical assets are never silently sent for redrawing.
- Export artifacts expire after the service TTL; browser cleanup runs in `finally`.

The current Studio and export-service tokens are session material printed at startup when generated automatically. Do not put them into a deck or commit them. Presenter and audience capabilities are distinct, ephemeral, and limited to one in-memory saved-revision snapshot.
