/**
 * Self-contained fixture tests for the clean-room rules. Exercises positive
 * (must flag) and negative (must not flag) path and content cases against the
 * pure matchers in scripts/lib/clean-room-rules.ts. Throws on any failure.
 *
 *   tsx scripts/check-clean-room.test.ts
 */
import { findForbiddenContent, findForbiddenPath } from "./lib/clean-room-rules.js";

const PATH_POSITIVE: Array<{ label: string; value: string }> = [
  { label: "dashi theme dir", value: "themes/dashi-dark/theme.json" },
  { label: "dashi-named file", value: "packages/dashi-exporter/index.ts" },
  { label: "SwissDeck segment", value: "vendor/SwissDeck/runtime.js" },
  { label: "theme-bundle segment", value: "assets/theme-bundle/bundle.json" },
  { label: "extension-agnostic dashi", value: "foo/dashi-thing.css" },
];

const PATH_NEGATIVE: Array<{ label: string; value: string }> = [
  { label: "swiss-grid style (Swiss design movement)", value: "resources/gpt-image2-ppt-skills/styles/swiss-grid.md" },
  { label: "style-registry source", value: "packages/style-registry/src/query.ts" },
  { label: "protocol source", value: "packages/protocol/src/index.ts" },
  { label: "normal markdown", value: "README.md" },
];

const CONTENT_POSITIVE: Array<{ label: string; value: string }> = [
  { label: "html-deck-to-pptx exporter", value: "import { htmlDeckToPptx } from 'html-deck-to-pptx';" },
  { label: "@dashi package scope", value: "from \"@dashi/themes\"" },
  { label: "SwissDeck runtime name", value: "const deck = new SwissDeck();" },
  { label: "copied dashi-ppt-skill header", value: "# dashi-ppt-skill exporter module" },
];

const CONTENT_NEGATIVE: Array<{ label: string; value: string }> = [
  { label: "swiss-grid prompt (Chinese)", value: "瑞士国际主义 / Swiss Grid 风格" },
  { label: "ordinary code", value: "export function queryLayouts(query) { return []; }" },
  { label: "dashboards word (not dashi)", value: "const dashboards = [];" },
];

let failures = 0;
function check(label: string, condition: boolean): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    failures += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

for (const c of PATH_POSITIVE) {
  check(`path positive: ${c.label} should flag`, findForbiddenPath(c.value) !== null);
}
for (const c of PATH_NEGATIVE) {
  check(`path negative: ${c.label} should NOT flag`, findForbiddenPath(c.value) === null);
}
for (const c of CONTENT_POSITIVE) {
  check(`content positive: ${c.label} should flag`, findForbiddenContent(c.value) !== null);
}
for (const c of CONTENT_NEGATIVE) {
  check(`content negative: ${c.label} should NOT flag`, findForbiddenContent(c.value) === null);
}

if (failures > 0) {
  console.error(`\n${failures} clean-room rule test(s) failed.`);
  process.exit(1);
}
console.log(`\nClean-room rule tests OK (${PATH_POSITIVE.length + PATH_NEGATIVE.length + CONTENT_POSITIVE.length + CONTENT_NEGATIVE.length} cases).`);
