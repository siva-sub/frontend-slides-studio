import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const runtime = await readFile(resolve(projectRoot, "packages/runtime/dist/slides-studio-runtime.iife.js"), "utf8");
const tempRoot = await mkdtemp(join(tmpdir(), "slides-studio-motion-transition-"));
const sourcePath = join(tempRoot, "deck.html");
const screenshotPath = join(tmpdir(), "frontend-slides-studio-motion-transition.png");
const motionProgram = { schemaVersion: 1, replay: "once", tracks: [{ objectId: "hero", keyframes: [{ opacity: 0, translate: "0 32px" }, { opacity: 1, translate: "0 0" }], options: { duration: 900, delay: 0, easing: "ease-out", iterations: 3, fill: "both" }, reducedMotion: { opacity: 1 } }] };
const deckGoal = { schemaVersion: 1, id: "motion-e2e", title: "Motion E2E", defaultTransition: { schemaVersion: 1, kind: "clip-wipe", durationMs: 600, easing: "ease-out", direction: "ltr", targetEntranceStartFraction: 0.2, reducedMotion: "fade" }, slides: [{ id: "s1", role: "cover" }, { id: "s2", role: "content" }, { id: "s3", role: "closing" }] };
await writeFile(sourcePath, `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}.deck-stage{position:relative;width:1280px;height:720px;background:#f5f5f2}.slide{position:absolute;inset:0;width:1280px;height:720px;visibility:hidden;opacity:0;pointer-events:none;background:#f5f5f2}.slide.active,.slide.visible{visibility:visible;opacity:1}.hero{position:absolute;left:180px;top:180px;width:720px;height:220px;background:#f05a36;color:white;font:700 72px/220px system-ui;text-align:center}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="s1"><div class="hero">Source</div></section><section class="slide" data-slide-id="s2"><div class="hero" data-object-id="hero">Target motion</div><script type="application/json" data-motion-program>${JSON.stringify(motionProgram)}</script></section><section class="slide" data-slide-id="s3"><div class="hero">Closing</div></section></main><script type="application/json" data-deck-goal>${JSON.stringify(deckGoal)}</script><script>${runtime}</script></body></html>`);

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolvePort(port)); });
});
const port = await reservePort();
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", tempRoot], { stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/deck.html`); if (response.ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (attempt === 39) throw new Error("Motion deck server did not start");
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/deck.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.slidesStudioRuntime === "ready");
  await page.evaluate(() => window.SlidesStudio.goTo(1));
  await page.waitForTimeout(170);
  const during = await page.evaluate(() => ({
    clones: document.querySelectorAll("[data-transition-clone]").length,
    originalAnimations: document.querySelector('[data-object-id="hero"]')?.getAnimations().length ?? 0,
    cloneAnimations: document.querySelector('[data-clone-source-id="hero"]')?.getAnimations().length ?? 0,
    transitionState: document.documentElement.dataset.transitionState,
  }));
  if (during.clones !== 2 || during.originalAnimations !== 1 || during.cloneAnimations !== 1 || during.transitionState !== "active") throw new Error(`Unexpected mid-transition state: ${JSON.stringify(during)}`);
  await page.evaluate(() => window.SlidesStudio.freezeForExport({ posterProgress: 0.5 }));
  const settled = await page.evaluate(() => ({
    clones: document.querySelectorAll("[data-transition-clone]").length,
    exportState: document.documentElement.dataset.exportState,
    transitionState: document.documentElement.dataset.transitionState,
    running: document.getAnimations().filter((animation) => animation.playState === "running").length,
    targetAnimationCount: document.querySelector('[data-object-id="hero"]')?.getAnimations().length ?? 0,
    motionPlayed: document.querySelectorAll(".slide")[1]?.dataset.motionPlayed,
    posterOpacity: document.querySelector('[data-object-id="hero"]')?.style.opacity,
  }));
  if (settled.clones !== 0 || settled.exportState !== "settled" || settled.transitionState !== "settled" || settled.running !== 0 || settled.targetAnimationCount !== 1 || settled.motionPlayed !== "true" || Math.abs(Number(settled.posterOpacity) - 0.5) > 0.001) throw new Error(`Unexpected settled state: ${JSON.stringify(settled)}`);
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({ ok: true, during, settled, screenshotPath }));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
