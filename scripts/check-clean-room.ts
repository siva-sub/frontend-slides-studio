/**
 * Clean-room guard: rejects Dashi source/themes/layouts/assets/bundles and
 * exporter artifacts. Uses scripts/lib/clean-room-rules.ts (pure matchers) so
 * the same rules are exercised by scripts/check-clean-room.test.ts.
 *
 * Scans all reasonably-sized repository-controlled files (any extension) for
 * strong Dashi fingerprints and flags suspicious path segments regardless of
 * extension. Only root-level dependency/VCS/generated dirs are skipped.
 *
 *   pnpm check:clean-room
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_PATHS,
  findForbiddenContent,
  findForbiddenPath,
  MAX_SCAN_BYTES,
  ROOT_SKIP_DIRS,
} from "./lib/clean-room-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface Finding {
  path: string;
  reason: string;
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ROOT_SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function relPath(abs: string): string {
  return relative(ROOT, abs).split("\\").join("/");
}

async function main(): Promise<void> {
  const files = await walk(ROOT);
  const findings: Finding[] = [];
  let scanned = 0;

  for (const abs of files) {
    const rel = relPath(abs);
    const allowed = ALLOWED_PATHS.has(rel);

    // Path rules apply everywhere except allowlisted docs.
    if (!allowed) {
      const pathReason = findForbiddenPath(rel);
      if (pathReason) {
        findings.push({ path: rel, reason: pathReason });
        continue;
      }
    }
    if (allowed) continue;

    // Content scan: all files up to MAX_SCAN_BYTES (any extension).
    const info = await stat(abs);
    if (info.size > MAX_SCAN_BYTES) continue;
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    const contentReason = findForbiddenContent(content);
    if (contentReason) {
      findings.push({ path: rel, reason: `contains Dashi fingerprint: ${contentReason}` });
    }
  }

  const guardSource = await readFile(join(__dirname, "lib", "clean-room-rules.ts"), "utf8");
  const guardHash = createHash("sha256").update(guardSource).digest("hex").slice(0, 12);

  if (findings.length > 0) {
    console.error("Clean-room violations found:");
    for (const finding of findings) console.error(`  ${finding.path}: ${finding.reason}`);
    console.error(`\n${findings.length} violation(s). Dashi source/themes/layouts/assets/bundles/exporter code must not be present.`);
    process.exit(1);
  }

  console.log(`Clean-room OK: scanned ${scanned} files, no Dashi artifacts or fingerprints found (rules ${guardHash}).`);
}

await main();
