import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const skillRoot = resolve(root, "skills/frontend-slides-studio");

async function markdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result;
}

const files = await markdownFiles(skillRoot);
const contents = new Map(await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")] as const)));
const skill = contents.get(resolve(skillRoot, "SKILL.md")) ?? "";
const errors: string[] = [];

for (const required of [
  "workflows/studio.md",
  "references/product-map.md",
  "references/setup.md",
  "references/commands.md",
  "references/studio-controls.md",
  "references/troubleshooting.md",
  "pnpm studio:open",
  "pnpm cli --",
]) if (!skill.includes(required)) errors.push(`SKILL.md is missing ${required}`);

if (!/^compatibility:\s+.+/m.test(skill)) errors.push("SKILL.md lacks a compatibility declaration");
const setup = contents.get(resolve(skillRoot, "references/setup.md")) ?? "";
for (const required of [
  "pi install \"$(pwd)\"",
  "/skill:frontend-slides-studio",
  "playwright install chromium",
  "Node.js 20",
  "pnpm 11.3",
  "optional",
  "core workspace",
]) if (!setup.includes(required)) errors.push(`setup.md is missing ${required}`);

for (const [path, content] of contents) {
  if (/^\s*slides-studio\s+/m.test(content)) errors.push(`Bare global CLI command in ${path}`);
  for (const match of content.matchAll(/`((?:workflows|references)\/[^`]+\.md)`/g)) {
    const target = resolve(skillRoot, match[1]!);
    try { if (!(await stat(target)).isFile()) errors.push(`Missing referenced file ${match[1]} from ${path}`); }
    catch { errors.push(`Missing referenced file ${match[1]} from ${path}`); }
  }
}

if (!skill.includes("do not stop after writing `deck.html`") && !skill.includes("do not stop after writing one HTML file")) errors.push("SKILL.md lacks the Studio completion prohibition");
if (errors.length) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else {
  console.log(`Frontend Slides Studio skill OK: ${files.length} Markdown files, Studio-first routing and references verified.`);
}
