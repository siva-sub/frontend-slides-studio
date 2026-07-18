import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { createDeterministicAssetProvider } from "../dist/assets.js";
import { buildServer } from "../dist/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const studioDist = resolve(here, "../../studio/dist");
const tempRoot = await mkdtemp(join(tmpdir(), "slides-studio-asset-e2e-"));
const sourceRoot = join(tempRoot, "source");
const jobRoot = join(tempRoot, "jobs");
const sourcePath = join(sourceRoot, "asset-studio.html");
await mkdir(sourceRoot);
await mkdir(jobRoot);
await writeFile(sourcePath, `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}.deck-stage{position:absolute;width:1280px;height:720px;background:#f4f0e6}.slide{position:absolute;inset:0;width:1280px;height:720px}.slide img{position:absolute;left:140px;top:110px;width:720px;height:430px;object-fit:cover}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="asset-slide"><img alt="generated target" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='blue'/%3E%3C/svg%3E"></section></main></body></html>`);

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolvePort(port));
  });
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const studioPort = await reservePort();
const assetPort = await reservePort();
const token = "asset-e2e-token";
const staticServer = spawn("python3", ["-m", "http.server", String(studioPort), "--bind", "127.0.0.1", "--directory", studioDist], { stdio: "ignore" });
let capturedPlan;
const deterministicProvider = createDeterministicAssetProvider();
const assetProvider = { descriptor: deterministicProvider.descriptor, async generate(plan, context) { capturedPlan = plan; return deterministicProvider.generate(plan, context); } };
const assetServer = buildServer({ token, sourceRoot, jobRoot, logger: false, assetProvider });
let browser;
try {
  await assetServer.listen({ host: "127.0.0.1", port: assetPort });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${studioPort}`); if (response.ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (attempt === 39) throw new Error("Studio static server did not start");
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    class MemoryFileHandle {
      constructor(name) { this.name = name; this.data = new Blob([]); }
      async getFile() { return new File([this.data], this.name, { type: this.data.type }); }
      async createWritable() { return { write: async (data) => { this.data = data instanceof Blob ? data : typeof data === "string" ? new Blob([data], { type: "application/json" }) : new Blob([data]); }, close: async () => undefined }; }
    }
    class MemoryDirectoryHandle {
      constructor() { this.directories = new Map(); this.files = new Map(); }
      async getDirectoryHandle(name, options = {}) { if (this.directories.has(name)) return this.directories.get(name); if (!options.create) throw new DOMException("missing", "NotFoundError"); const directory = new MemoryDirectoryHandle(); this.directories.set(name, directory); return directory; }
      async getFileHandle(name, options = {}) { if (this.files.has(name)) return this.files.get(name); if (!options.create) throw new DOMException("missing", "NotFoundError"); const file = new MemoryFileHandle(name); this.files.set(name, file); return file; }
    }
    window.__workspaceRoot = new MemoryDirectoryHandle();
    window.showDirectoryPicker = async () => window.__workspaceRoot;
  });
  await page.goto(`http://127.0.0.1:${studioPort}`, { waitUntil: "networkidle" });
  await page.locator('input[accept^=".html"]').setInputFiles(sourcePath);
  await page.locator("#style-profile").selectOption("y2k-chrome");
  await page.waitForFunction(() => document.querySelector("#layout-profile")?.value);
  const selectedStyle = await page.locator("#style-profile").inputValue();
  const selectedLayout = await page.locator("#layout-profile").inputValue();
  assert(selectedLayout.startsWith(`${selectedStyle}/`) && !selectedLayout.startsWith(`${selectedStyle}/${selectedStyle}/`), `Layout ID is not canonical: ${selectedLayout}`);
  await page.locator("#export-source-path").fill(sourcePath);
  await page.locator("#export-service").fill(`http://127.0.0.1:${assetPort}`);
  await page.locator("#export-token").fill(token);
  await page.getByRole("button", { name: "Run export" }).click();
  await page.locator(".export-status").filter({ hasText: "Complete" }).waitFor({ timeout: 20_000 });
  assert((await page.locator(".export-panel").textContent())?.includes("quality-report.json"), "Studio export did not surface quality evidence");
  await page.getByRole("button", { name: "Attach folder" }).click();
  await page.locator(".workspace-meta").filter({ hasText: "Folder workspace attached" }).waitFor();
  await page.locator(".mode-switch").getByRole("button", { name: /^move/i }).click();
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame, "Studio preview iframe was not created");
  await frame.waitForFunction(() => document.documentElement.dataset.studioMode === "move");
  await frame.locator("img").click();
  await page.locator("#media-fit").selectOption("contain");
  await page.waitForTimeout(150);
  const setRange = async (selector, value) => page.locator(selector).evaluate((element, next) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(element, next); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }, value);
  await setRange("#focal-x", "0.73"); await setRange("#pan-x", "0.08"); await setRange("#media-zoom", "1.25"); await setRange("#media-rotation", "-7");
  assert(await page.locator("#media-slot option").count() > 1, "Selected layout exposes no media slots"); await page.locator("#media-slot").selectOption({ index: 1 }); const selectedMediaSlot = await page.locator("#media-slot").inputValue();
  await page.locator("#media-alt").fill("Generated editorial orbit"); await page.locator("#media-alt").blur();
  await frame.waitForFunction(() => {
    const image = document.querySelector("img");
    return image?.dataset.mediaFit === "contain" && image.dataset.focalX === "0.73" && image.dataset.panX === "0.08" && image.dataset.mediaZoom === "1.25" && image.dataset.mediaRotation === "-7" && image.getAttribute("alt") === "Generated editorial orbit";
  });
  await page.locator("#asset-prompt").fill("A high-contrast editorial orbit with reserved title space");
  await page.locator("#asset-service").fill(`http://127.0.0.1:${assetPort}`);
  await page.locator("#asset-token").fill(token);
  await page.getByRole("button", { name: "Generate and apply" }).click();
  await page.locator(".asset-status").filter({ hasText: "rendered evidence pending manual review" }).waitFor({ timeout: 15_000 });
  await frame.waitForFunction(() => document.querySelector("img")?.dataset.originalName === "visual-master.svg", undefined, { timeout: 10_000 });
  const applied = await frame.locator("img").evaluate((image) => ({
    name: image.dataset.originalName,
    hash: image.dataset.assetSha256,
    fit: image.dataset.mediaFit,
    focalX: image.dataset.focalX,
    src: image.getAttribute("src"),
    panX: image.dataset.panX,
    zoom: image.dataset.mediaZoom,
    rotation: image.dataset.mediaRotation,
    slot: image.dataset.layoutSlot,
    alt: image.getAttribute("alt"),
  }));
  assert(applied.name === "visual-master.svg", "Generated asset was not applied to the selected media object");
  assert(applied.hash?.length === 64, "Generated asset was not content-hashed before staging");
  assert(applied.fit === "contain" && applied.focalX === "0.73" && applied.panX === "0.08" && applied.zoom === "1.25" && applied.rotation === "-7" && applied.slot === selectedMediaSlot && applied.alt === "Generated editorial orbit", "Complete media reframe metadata was not preserved after generation");
  assert(applied.src?.startsWith("blob:"), `Folder-staged preview did not use a blob URL: ${applied.src}`);
  const manifest = await page.evaluate(async () => {
    const root = window.__workspaceRoot;
    const media = root.directories.get("assets").directories.get("user-media");
    return JSON.parse(await media.files.get("manifest.json").data.text());
  });
  assert(manifest.entries.length === 1 && manifest.entries[0].path.startsWith("assets/user-media/"), `Folder manifest is invalid: ${JSON.stringify(manifest)}`);
  assert(manifest.entries[0].hash.value === applied.hash, "Staged manifest hash does not match authored media metadata");
  assert(capturedPlan?.styleId === selectedStyle, `Selected style did not reach the asset plan: ${capturedPlan?.styleId}`);
  assert(capturedPlan?.layoutId === selectedLayout, `Selected layout did not reach the asset plan: ${capturedPlan?.layoutId}`);
  console.log(JSON.stringify({ ok: true, applied, styleId: capturedPlan.styleId, layoutId: capturedPlan.layoutId }));
} finally {
  await browser?.close();
  await assetServer.close();
  staticServer.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
