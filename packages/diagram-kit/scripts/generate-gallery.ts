import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAllDiagramFixtures, renderDiagramSvg } from "../src/index.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outputRoot = resolve(projectRoot, "examples/diagram-gallery");
const check = process.argv.includes("--check");
const fixtures = createAllDiagramFixtures().toSorted((left, right) => left.type.localeCompare(right.type));
const expected = new Map<string, string>();

for (const fixture of fixtures) {
  expected.set(`fixtures/${fixture.type}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
  expected.set(`svgs/${fixture.type}.svg`, `${renderDiagramSvg(fixture)}\n`);
}

const cards = fixtures.map((fixture) => `<article><header><span>${fixture.family}</span><strong>${fixture.type}</strong></header><img src="svgs/${fixture.type}.svg" alt="${fixture.type} diagram fixture"></article>`).join("\n");
expected.set("index.html", `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frontend Slides Studio · Diagram Gallery</title><style>*{box-sizing:border-box}body{margin:0;background:#e8e7df;color:#20231f;font-family:system-ui,sans-serif}header.hero{padding:56px 5vw 32px;border-bottom:1px solid #bfc1b8;background:#f5f5f2}.hero p{margin:0 0 8px;font:700 11px/1.2 monospace;letter-spacing:.18em;color:#f05a36}.hero h1{margin:0;font:600 clamp(36px,6vw,72px)/.95 Georgia,serif}.hero small{display:block;margin-top:18px;color:#6f756d}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:18px;padding:24px 5vw 64px}.grid article{background:#f5f5f2;border:1px solid #cfd1c9}.grid article header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #d8dbd4}.grid span{font:9px monospace;text-transform:uppercase;letter-spacing:.12em;color:#6f756d}.grid strong{font-size:13px}.grid img{display:block;width:100%;aspect-ratio:1000/560;background:#f5f5f2}</style></head><body><header class="hero"><p>ORIGINAL TYPED FIXTURES · 27 ADAPTERS</p><h1>Diagram grammar gallery</h1><small>Deterministically generated from DiagramSpecV2 fixtures. No upstream themes, layouts, or assets.</small></header><main class="grid">${cards}</main></body></html>\n`);

if (check) {
  const mismatches: string[] = [];
  for (const [relativePath, content] of expected) {
    const path = resolve(outputRoot, relativePath);
    const actual = await readFile(path, "utf8").catch(() => null);
    if (actual !== content) mismatches.push(relativePath);
  }
  for (const directory of ["fixtures", "svgs"] as const) {
    const actualFiles = await readdir(resolve(outputRoot, directory)).catch(() => []);
    const expectedFiles = [...expected.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1)).toSorted();
    for (const extra of actualFiles.filter((file) => !expectedFiles.includes(file))) mismatches.push(`${directory}/${extra} (unexpected)`);
  }
  if (mismatches.length) throw new Error(`diagram gallery is stale, missing, or contains extra files: ${mismatches.join(", ")}`);
  console.log(`Diagram gallery is current (${fixtures.length} fixtures).`);
} else {
  await rm(resolve(outputRoot, "fixtures"), { recursive: true, force: true });
  await rm(resolve(outputRoot, "svgs"), { recursive: true, force: true });
  for (const [relativePath, content] of expected) {
    const path = resolve(outputRoot, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  console.log(`Wrote ${fixtures.length} diagram fixtures to ${outputRoot}`);
}
