/**
 * Writes the original metadata-driven examples/style-browser.html using the
 * runtime generateStyleBrowserHtml() API. No upstream images or binaries are
 * embedded. Run after `pnpm --filter @slides-studio/style-registry generate`.
 *
 *   pnpm --filter @slides-studio/style-registry tsx scripts/write-gallery.ts
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateStyleBrowserHtml } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "..", "..", "examples", "style-browser.html");

const html = generateStyleBrowserHtml();
await writeFile(OUT, html, "utf8");
console.log(`Wrote ${html.length} bytes to ${OUT}`);
