import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const source = resolve(root, "skills/frontend-slides-studio");
const targets = [
  resolve(root, "integrations/claude/frontend-slides-studio"),
  resolve(root, "integrations/codex/frontend-slides-studio"),
  resolve(root, "integrations/cursor/frontend-slides-studio"),
  resolve(root, "plugins/frontend-slides-studio/skills/frontend-slides-studio"),
];
const check = process.argv.includes("--check");

async function files(directory: string, base = directory): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path, base));
    else result.push(path.slice(base.length + 1));
  }
  return result.sort();
}

let drift = false;
const sourceFiles = await files(source);
for (const target of targets) {
  if (check) {
    const targetFiles = await files(target);
    if (JSON.stringify(targetFiles) !== JSON.stringify(sourceFiles)) { console.error(`Integration file-list drift: ${target}`); drift = true; continue; }
    for (const relative of sourceFiles) {
      if (await readFile(join(source, relative), "utf8") !== await readFile(join(target, relative), "utf8")) { console.error(`Integration content drift: ${join(target, relative)}`); drift = true; }
    }
  } else {
    await rm(target, { recursive: true, force: true });
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(source, target, { recursive: true });
    console.log(target);
  }
}
if (drift) process.exitCode = 1;
else if (check) console.log(`Integration sync OK: ${targets.length} generated trees, ${sourceFiles.length} files each.`);
