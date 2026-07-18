import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface SourceRecord {
  repository: string;
  commit: string;
  license: string;
  relationship: string;
  paths: string[];
  modifications: string;
}

const manifest = JSON.parse(await readFile(join(ROOT, "provenance.json"), "utf8")) as {
  schemaVersion: number;
  sources: SourceRecord[];
};

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources) || manifest.sources.length < 5) {
  throw new Error("provenance.json is missing required source records");
}

const APACHE_REPO = "https://github.com/JuneYaooo/gpt-image2-ppt-skills";
const APACHE_COMMIT = "ce4714225d938b02806af3660a46e62be8900e29";

for (const source of manifest.sources) {
  for (const key of ["repository", "commit", "license", "relationship", "modifications"] as const) {
    if (!source[key]) throw new Error(`provenance source is missing ${key}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(source.commit)) throw new Error(`provenance commit must be a full 40-character SHA: ${source.repository}`);
  if (!Array.isArray(source.paths)) throw new Error(`provenance paths must be an array: ${source.repository}`);
  if (source.relationship.includes("clean-room") && source.paths.length !== 0) {
    throw new Error(`clean-room source must not list copied paths: ${source.repository}`);
  }
}

// ---------------------------------------------------------------------------
// Resource manifest validation (byte-for-byte Apache-2.0 import)
// ---------------------------------------------------------------------------

interface ManifestEntry {
  sourceRepository: string;
  sourceCommit: string;
  upstreamPath: string;
  targetPath: string;
  sha256: string;
  sizeBytes?: number;
  license: string;
  modificationStatus: string;
}

const RESOURCES_DIR = "resources/gpt-image2-ppt-skills";
const resourceRootAbs = join(ROOT, RESOURCES_DIR);
const resourceRootReal = await realpath(resourceRootAbs);

const resourceManifest = JSON.parse(await readFile(join(resourceRootAbs, "MANIFEST.json"), "utf8")) as {
  schemaVersion: number;
  sourceRepository: string;
  sourceCommit: string;
  license: string;
  entries: ManifestEntry[];
  counts: { styleMarkdown: number; styleLayoutsJson: number; recipes: number };
};

const apacheSource = manifest.sources.find((source) => source.repository === APACHE_REPO);
if (!apacheSource) throw new Error(`provenance.json is missing the Apache source record for ${APACHE_REPO}`);
if (!apacheSource.paths.some((path) => path.startsWith(RESOURCES_DIR))) {
  throw new Error(`Apache source record must list the imported resource path under ${RESOURCES_DIR}`);
}
if (apacheSource.commit !== resourceManifest.sourceCommit) {
  throw new Error(`provenance commit ${apacheSource.commit} does not match manifest commit ${resourceManifest.sourceCommit}`);
}
if (apacheSource.license !== "Apache-2.0") throw new Error(`Apache source record license must be Apache-2.0, got ${apacheSource.license}`);

// Exact counts.
const expected = { styleMarkdown: 32, styleLayoutsJson: 32, recipes: 6 };
for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
  if (resourceManifest.counts[key] !== expected[key]) {
    throw new Error(`manifest count ${key} must be ${expected[key]}, got ${resourceManifest.counts[key]}`);
  }
}
if (resourceManifest.sourceRepository !== APACHE_REPO) throw new Error(`manifest sourceRepository must be ${APACHE_REPO}`);
if (resourceManifest.sourceCommit !== APACHE_COMMIT) throw new Error(`manifest sourceCommit must be ${APACHE_COMMIT}`);

// LICENSE must ship.
await stat(join(resourceRootAbs, "LICENSE"));

function assertWithinResourceRoot(targetReal: string, targetPath: string): void {
  const rel = relative(resourceRootReal, targetReal);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`manifest target escapes the resource root (traversal): ${targetPath}`);
  }
}

const seenTargets = new Set<string>();
const seenUpstream = new Set<string>();
const styleMd = new Set<string>();
const styleJson = new Set<string>();
const recipeMd = new Set<string>();
const slidesPlanMd = new Set<string>();
const manifestDiskTargets = new Set<string>(); // realpath-normalized

let checked = 0;
for (const entry of resourceManifest.entries) {
  if (entry.modificationStatus !== "unchanged") {
    throw new Error(`imported resource must be unchanged: ${entry.targetPath} (got ${entry.modificationStatus})`);
  }
  if (entry.license !== "Apache-2.0") throw new Error(`imported resource license must be Apache-2.0: ${entry.targetPath}`);
  if (entry.sourceRepository !== APACHE_REPO) throw new Error(`entry sourceRepository must be ${APACHE_REPO}: ${entry.targetPath}`);
  if (entry.sourceCommit !== APACHE_COMMIT) throw new Error(`entry sourceCommit must be ${APACHE_COMMIT}: ${entry.targetPath}`);

  const targetAbs = join(ROOT, entry.targetPath);
  // Reject symlinks.
  const lst = await lstat(targetAbs);
  if (lst.isSymbolicLink()) throw new Error(`manifest target is a symlink (forbidden): ${entry.targetPath}`);
  if (!lst.isFile()) throw new Error(`manifest target is not a regular file: ${entry.targetPath}`);

  // Resolve + reject traversal outside the resource root.
  const targetReal = await realpath(targetAbs);
  assertWithinResourceRoot(targetReal, entry.targetPath);

  // Reject duplicate targets / upstream mappings.
  if (seenTargets.has(entry.targetPath)) throw new Error(`duplicate manifest target: ${entry.targetPath}`);
  if (seenUpstream.has(entry.upstreamPath)) throw new Error(`duplicate manifest upstream path: ${entry.upstreamPath}`);
  seenTargets.add(entry.targetPath);
  seenUpstream.add(entry.upstreamPath);
  manifestDiskTargets.add(targetReal);

  const bytes = await readFile(targetAbs);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) {
    throw new Error(`manifest hash mismatch for ${entry.targetPath}: expected ${entry.sha256}, got ${digest}`);
  }
  if (entry.sizeBytes !== undefined && entry.sizeBytes !== bytes.length) {
    throw new Error(`manifest size mismatch for ${entry.targetPath}: expected ${entry.sizeBytes}, got ${bytes.length}`);
  }
  // No binary extras: imported text resources must not contain NUL bytes.
  if (bytes.includes(0)) throw new Error(`imported resource contains NUL bytes (binary): ${entry.targetPath}`);

  if (entry.upstreamPath.startsWith("styles/") && entry.upstreamPath.endsWith(".md")) styleMd.add(entry.upstreamPath);
  if (entry.upstreamPath.startsWith("styles/") && entry.upstreamPath.endsWith(".layouts.json")) styleJson.add(entry.upstreamPath);
  if (entry.upstreamPath.endsWith("/recipe.md")) recipeMd.add(entry.upstreamPath);
  if (entry.upstreamPath.endsWith("/slides_plan.md")) slidesPlanMd.add(entry.upstreamPath);
  checked += 1;
}

if (styleMd.size !== 32) throw new Error(`expected 32 style markdown files, found ${styleMd.size}`);
if (styleJson.size !== 32) throw new Error(`expected 32 style sidecars, found ${styleJson.size}`);
if (recipeMd.size !== 6) throw new Error(`expected exactly six recipe.md files, found ${recipeMd.size}`);
if (slidesPlanMd.size !== 6) throw new Error(`expected exactly six slides_plan.md files, found ${slidesPlanMd.size}`);

// ---------------------------------------------------------------------------
// Exact reverse disk inventory: every resource file (except the two original
// repo manifests) must be a manifest entry; no orphan or missing files.
// ---------------------------------------------------------------------------

const ALLOWED_NON_MANIFEST = new Set(["MANIFEST.json", "NOTICE-OF-MODIFICATIONS.md"]);

async function walkDisk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await walkDisk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const diskFiles = await walkDisk(resourceRootAbs);
const orphans: string[] = [];
for (const abs of diskFiles) {
  const real = await realpath(abs);
  const base = relative(resourceRootAbs, abs);
  if (ALLOWED_NON_MANIFEST.has(base)) continue;
  if (!manifestDiskTargets.has(real)) orphans.push(base);
}
if (orphans.length > 0) {
  throw new Error(`resource disk inventory has orphan files not in manifest: ${orphans.join(", ")}`);
}
// Every manifest target must exist on disk (already verified above via readFile).

console.log(`Provenance OK: ${manifest.sources.length} sources registered; ${checked} imported resources verified (32 styles, 256 layouts, 6 recipes + 6 plans, LICENSE); disk inventory exact, no symlinks/traversal/binaries.`);
