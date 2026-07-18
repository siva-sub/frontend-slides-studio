# Security model

- Studio uses sandboxed iframes to prevent imported CSS, globals and keyboard handlers from taking over the host.
- `postMessage` receivers check `event.source` and parse protocol version 1 messages.
- Share builds remove authoring UI, private metadata, inline event handlers and script URLs.
- Export binds only to `127.0.0.1`, checks Origin/Referer, requires a bearer session token, caps request bodies and slide count, and contains real paths under configured roots.
- Symlink escape is rejected after `realpath`, not by string prefix.
- Visual scenes resolve every asset beneath a job root.
- Provider credentials are read only from explicit process environment. No code walks project parents for `.env` files.
- Fidelity-critical assets are never silently sent for redrawing.
- Export artifacts expire after the service TTL; browser cleanup runs in `finally`.

The current service token is session material printed at startup when generated automatically. Do not put it into a deck or commit it.
