import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const plugin = join(root, "plugins/frontend-slides/skills/frontend-slides");

async function files(directory: string, relative = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(directory, path));
    else result.push(path);
  }
  return result.sort();
}

for (const file of ["SKILL.md", "STYLE_PRESETS.md", "viewport-base.css", "html-template.md", "animation-patterns.md"]) {
  if (await readFile(join(root, file), "utf8") !== await readFile(join(plugin, file), "utf8")) throw new Error(`Legacy plugin drift: ${file}`);
}
for (const file of ["extract-pptx.py", "deploy.sh", "export-pdf.sh"]) {
  if (await readFile(join(root, "scripts", file), "utf8") !== await readFile(join(plugin, "scripts", file), "utf8")) throw new Error(`Legacy plugin drift: scripts/${file}`);
}
const sourceFiles = await files(join(root, "bold-template-pack"));
const pluginFiles = await files(join(plugin, "bold-template-pack"));
if (JSON.stringify(sourceFiles) !== JSON.stringify(pluginFiles)) throw new Error("Legacy plugin file-list drift: bold-template-pack");
for (const relative of sourceFiles) if (await readFile(join(root, "bold-template-pack", relative), "utf8") !== await readFile(join(plugin, "bold-template-pack", relative), "utf8")) throw new Error(`Legacy plugin drift: bold-template-pack/${relative}`);
console.log("Legacy root/plugin compatibility trees are in sync.");
