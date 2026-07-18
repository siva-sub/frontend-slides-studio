/**
 * @slides-studio/media-kit — browser-safe public entry.
 *
 * Re-exports the deterministic geometry API, the byte-level MIME sniffer, and
 * the browser file-only descriptor helper. Nothing in this entry imports Node
 * built-ins; the Node-only staging pipeline lives under
 * `@slides-studio/media-kit/node`.
 */

export * from "./geometry.js";
export * from "./sniff.js";
export * from "./browser.js";
