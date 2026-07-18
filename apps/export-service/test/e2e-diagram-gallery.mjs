import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const galleryRoot = resolve(here, "../../../examples/diagram-gallery");
const screenshotPath = join(tmpdir(), "frontend-slides-studio-diagram-gallery.png");
const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolvePort(port));
  });
});
const port = await reservePort();
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", galleryRoot], { stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}`); if (response.ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (attempt === 39) throw new Error("Diagram gallery server did not start");
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const cards = page.locator("main.grid article");
  if (await cards.count() !== 27) throw new Error(`Expected 27 gallery cards, found ${await cards.count()}`);
  const images = page.locator("main.grid img");
  const imageState = await images.evaluateAll((elements) => elements.map((image) => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })));
  const broken = imageState.filter((image) => !image.complete || image.width !== 1000 || image.height !== 560);
  if (broken.length) throw new Error(`${broken.length} gallery images failed to load at 1000×560`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ok: true, cards: 27, loadedImages: imageState.length, screenshotPath }));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
