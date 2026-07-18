import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const startScript = resolve(repositoryRoot, "apps/studio/scripts/start.mjs");
const stopScript = resolve(repositoryRoot, "apps/studio/scripts/stop.mjs");
const tempRoot = await mkdtemp(join(tmpdir(), "slides-studio-launch-smoke-"));
const sourcePath = join(tempRoot, "launch-deck.html");
const source = `<!doctype html><html><head><style>html,body{margin:0}.deck-stage{position:absolute;width:1280px;height:720px}.slide{position:absolute;inset:0;width:1280px;height:720px;background:#f5f2e8}.slide h1{position:absolute;left:80px;top:80px;font:700 72px sans-serif}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="launch-slide"><h1 data-object-id="launch-title">Launch-loaded deck</h1></section></main></body></html>`;
await writeFile(sourcePath, source);

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolvePort(port)); });
});
const port = await reservePort();
const launched = spawnSync(process.execPath, [startScript, "--input", sourcePath, "--port", String(port), "--json"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: { ...process.env, SLIDES_STUDIO_MAX_SOURCE_BYTES: "2048" },
  timeout: 30_000,
});
if (launched.status !== 0) throw new Error(launched.stderr || launched.stdout || "Studio launcher failed");
const session = JSON.parse(launched.stdout.trim().split("\n").at(-1));
const url = new URL(session.url);
const token = url.searchParams.get("session");
const base = `${url.protocol}//${url.host}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let browser;
try {
  const headers = { origin: base, "x-slides-studio-session": token };
  const loaded = await fetch(`${base}/api/studio-session?token=${encodeURIComponent(token)}`, { headers });
  assert(loaded.status === 200, `Launch bridge GET failed: ${loaded.status}`);
  assert((await loaded.json()).sourcePath === sourcePath, "Launch bridge exposed the wrong source path");
  const wrongToken = await fetch(`${base}/api/studio-session?token=wrong`, { headers: { ...headers, "x-slides-studio-session": "wrong" } });
  assert(wrongToken.status === 401, `Wrong launch token returned ${wrongToken.status}`);
  const wrongOrigin = await fetch(`${base}/api/studio-session?token=${encodeURIComponent(token)}`, { headers: { ...headers, origin: "https://evil.example" } });
  assert(wrongOrigin.status === 403, `Non-loopback origin returned ${wrongOrigin.status}`);
  const arbitraryPath = await fetch(`${base}/api/studio-session?token=${encodeURIComponent(token)}`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ html: source, path: "/tmp/other.html" }) });
  assert(arbitraryPath.status === 400, `Arbitrary-path payload returned ${arbitraryPath.status}`);
  assert((await readFile(sourcePath, "utf8")) === source, "Rejected arbitrary-path save modified the source");
  const oversized = await fetch(`${base}/api/studio-session?token=${encodeURIComponent(token)}`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ html: "x".repeat(3000) }) });
  assert(oversized.status === 413, `Oversized payload returned ${oversized.status}`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(session.url, { waitUntil: "networkidle" });
  await page.getByText("launch-deck.html", { exact: true }).waitFor({ timeout: 10_000 });
  assert(await page.locator("#export-source-path").inputValue() === sourcePath, "Studio did not prefill the service-visible source path");
  await page.locator(".mode-switch").getByRole("button", { name: /^edit/i }).click();
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame, "Studio preview iframe was not created");
  await frame.locator("h1").click();
  const editor = page.locator('.inspector-section textarea[placeholder="Replace selected text"]');
  await editor.fill("Saved through Studio bridge");
  await editor.press("Tab");
  await frame.waitForFunction(() => document.querySelector("h1")?.textContent === "Saved through Studio bridge");
  await page.locator(".workspace-meta i").waitFor({ timeout: 10_000 });
  await page.locator(".save-button").click();
  await page.getByText(/Saved launch-deck\.html atomically through the Studio launch bridge/).waitFor({ timeout: 10_000 });
  assert((await readFile(sourcePath, "utf8")).includes("Saved through Studio bridge"), "Studio Save did not update the configured source");
  console.log(JSON.stringify({ ok: true, url: session.url.replace(token, "<redacted>"), sourcePath }));
} finally {
  await browser?.close();
  const stopped = spawnSync(process.execPath, [stopScript, "--state", session.statePath], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 });
  if (stopped.status !== 0) console.error(stopped.stderr || stopped.stdout);
  await rm(tempRoot, { recursive: true, force: true });
}
