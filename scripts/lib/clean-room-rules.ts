/**
 * Pure clean-room rule definitions + matchers. Shared by the repo scan
 * (scripts/check-clean-room.ts) and the self-contained fixture test
 * (scripts/check-clean-room.test.ts). No filesystem access here.
 */

// Only root-level dependency / VCS / generated directories are skipped — never
// arbitrary nested build folders (those are scanned so Dashi artifacts cannot
// hide inside a nested dist/build).
export const ROOT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".pi-subagents",
]);

// Whole-file allowlist: only explicit provenance / notice / clean-room docs and
// the guard infrastructure files that necessarily contain the fingerprint
// patterns as definitions or fixtures.
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "docs/clean-room-dashi.md",
  "provenance.json",
  "ATTRIBUTIONS.md",
  "THIRD_PARTY_NOTICES.md",
  "scripts/check-clean-room.ts",
  "scripts/lib/clean-room-rules.ts",
  "scripts/check-clean-room.test.ts",
]);

// Strong Dashi fingerprints. Case-sensitive where a name is distinctive.
export interface Fingerprint {
  name: string;
  re: RegExp;
}

export const CONTENT_FINGERPRINTS: readonly Fingerprint[] = [
  { name: "html-deck-to-pptx exporter", re: /html-deck-to-pptx/ },
  { name: "@dashi package scope", re: /@dashi\b/ },
  { name: "SwissDeck runtime name", re: /\bSwissDeck\b/ },
  { name: "copied Dashi package header", re: /\bdashi[-_ ]?ppt[-_ ]?skill\b/i },
];

// Files larger than this are not content-scanned (path rules still apply).
export const MAX_SCAN_BYTES = 2_000_000;

/**
 * Broad suspicious-path matcher. Flags any path segment containing dashi,
 * SwissDeck, or theme-bundle patterns regardless of file extension.
 * Returns a human reason, or null if the path is clean.
 */
export function findForbiddenPath(relPath: string): string | null {
  const segments = relPath.toLowerCase().split("/");
  for (const segment of segments) {
    if (segment.includes("dashi")) return `forbidden Dashi path segment "${segment}"`;
    if (segment.includes("swissdeck")) return `forbidden SwissDeck path segment "${segment}"`;
    if (segment.includes("theme-bundle")) return `forbidden theme-bundle path segment "${segment}"`;
  }
  return null;
}

/**
 * Content fingerprint matcher. Returns the first matching fingerprint name, or
 * null if the content is clean.
 */
export function findForbiddenContent(content: string): string | null {
  for (const fingerprint of CONTENT_FINGERPRINTS) {
    if (fingerprint.re.test(content)) return fingerprint.name;
  }
  return null;
}
