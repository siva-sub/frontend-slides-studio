import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../../..");
const tempRoot = await mkdtemp(join(tmpdir(), "slides-studio-presenter-smoke-"));
const sourcePath = join(tempRoot, "presenter-deck.html");
const assetDir = join(tempRoot, "assets");
const token = "studio-presenter-smoke-token";
await mkdir(assetDir, { recursive: true });
await writeFile(join(assetDir, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#f4f1e8"/><path d="M120 210H680" stroke="#f05a36" stroke-width="16"/><circle cx="120" cy="210" r="70" fill="#28493f"/><circle cx="680" cy="210" r="70" fill="#28493f"/></svg>');
await writeFile(sourcePath, `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}.deck-stage{position:absolute;width:1280px;height:720px;background:#f4f1e8}.slide{position:absolute;inset:0;width:1280px;height:720px;padding:80px;visibility:hidden;opacity:0}.slide.active,.slide.visible{visibility:visible;opacity:1}h1{font:700 70px sans-serif;color:#20231f}p{font:32px sans-serif}.diagram{position:absolute;left:220px;top:180px;width:840px;height:440px}.diagram img{width:100%;height:100%;object-fit:contain}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="intro"><h1>Opening</h1><p>Private notes stay off the audience screen.</p><script type="text/plain" data-speaker-notes>Opening cue: welcome the audience.</script></section><section class="slide" data-slide-id="diagram"><h1>Diagram path</h1><figure class="diagram" data-object-id="diagram-flow"><img src="assets/diagram.svg" alt="Two nodes connected by one path"><script type="application/json" data-diagram-spec>{"schemaVersion":1,"id":"flow","type":"architecture","nodes":[{"id":"a","label":"Input"},{"id":"b","label":"Outcome"}],"edges":[{"id":"a-b","source":"a","target":"b"}]}</script></figure><script type="text/plain" data-speaker-notes>Explain the visual from left to right.</script></section><section class="slide" data-slide-id="skipped" data-slide-skipped="true"><h1>Skipped</h1><script type="text/plain" data-speaker-notes>Never show.</script></section><section class="slide" data-slide-id="finish"><h1>Finish</h1><script type="text/plain" data-speaker-notes>Pause for questions.</script></section></main></body></html>`);

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolvePort(port)); });
});
const port = await reservePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn("pnpm", ["--filter", "@slides-studio/studio", "dev"], { cwd: root, env: { ...process.env, SLIDES_STUDIO_INITIAL_DECK: sourcePath, SLIDES_STUDIO_SESSION_TOKEN: token, SLIDES_STUDIO_STUDIO_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const response = await fetch(base); if (response.ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (attempt === 79) throw new Error(`Studio presenter server did not start.\n${serverLog}`);
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studio = await context.newPage();
  await studio.goto(`${base}/?session=${encodeURIComponent(token)}`, { waitUntil: "networkidle" });
  await studio.getByText(/Opened presenter-deck\.html through the authenticated Studio launch bridge/).waitFor();
  const launch = await studio.evaluate(async (sessionToken) => {
    const response = await fetch("/api/presentation-sessions", { method: "POST", headers: { "x-slides-studio-session": sessionToken } });
    return { status: response.status, body: await response.json() };
  }, token);
  assert(launch.status === 201, `Presentation session create failed: ${JSON.stringify(launch.body)}`);
  assert(!launch.body.presenterUrl.includes(token) && !launch.body.audienceUrl.includes(token), "Role URLs leaked the Studio save token");

  const presenter = await context.newPage();
  const audience = await context.newPage();
  await audience.emulateMedia({ reducedMotion: "reduce" });
  await Promise.all([
    presenter.goto(`${base}${launch.body.presenterUrl}`, { waitUntil: "networkidle" }),
    audience.goto(`${base}${launch.body.audienceUrl}`, { waitUntil: "networkidle" }),
  ]);
  await presenter.getByText("Audience connected", { exact: true }).waitFor({ timeout: 10_000 });
  await audience.getByText("Presenter connected", { exact: true }).waitFor({ timeout: 10_000 });
  assert(await audience.locator("main.presentation-audience").getAttribute("data-reduced-motion") === "true", "Audience did not honor reduced motion");
  assert((await presenter.locator(".presenter-notes").textContent()).includes("Opening cue"), "Presenter notes are missing");
  assert(await audience.frameLocator('iframe[title="Audience presentation"]').locator("[data-speaker-notes]").count() === 0, "Audience iframe contains note metadata");
  assert(!(await audience.content()).includes("Opening cue"), "Audience host document contains private note text");
  assert(await presenter.frameLocator('iframe[title="Current slide preview"]').locator("h1").textContent() === "Opening", "Presenter current preview is wrong");
  assert(await presenter.frameLocator('iframe[title="Next slide preview"]').locator("h1").textContent() === "Diagram path", "Presenter next preview is wrong");

  const audienceDeck = audience.frames().find((frame) => frame.name() === "") ?? audience.frames().find((frame) => frame !== audience.mainFrame());
  const audiencePresentationFrame = audience.frames().find((frame) => frame !== audience.mainFrame() && frame.url() === "about:srcdoc");
  assert(audiencePresentationFrame || audienceDeck, "Audience presentation iframe was not available");
  const focusedFrame = audiencePresentationFrame ?? audienceDeck;
  await focusedFrame.evaluate(() => { document.documentElement.requestFullscreen = async () => { document.documentElement.dataset.fullscreenRequested = "true"; }; document.body.focus(); });
  await focusedFrame.locator("body").click({ position: { x: 20, y: 20 } });
  await audience.keyboard.press("f");
  await focusedFrame.waitForFunction(() => document.documentElement.dataset.fullscreenRequested === "true");
  await audience.keyboard.press("ArrowRight");
  await presenter.frameLocator('iframe[title="Current slide preview"]').locator("h1", { hasText: "Diagram path" }).waitFor();
  await audience.frameLocator('iframe[title="Audience presentation"]').locator(".slide.active h1", { hasText: "Diagram path" }).waitFor();
  await audience.frameLocator('iframe[title="Audience presentation"]').locator("img[alt^='Two nodes']").waitFor();
  assert(await audience.frameLocator('iframe[title="Audience presentation"]').locator("img[alt^='Two nodes']").evaluate((image) => image.complete && image.naturalWidth === 800), "Deck-local diagram asset did not load through the contained presentation route");
  assert((await presenter.locator(".presenter-notes").textContent()).includes("left to right"), "Diagram slide notes are not synchronized");

  await presenter.getByRole("button", { name: "Next →" }).click();
  await presenter.frameLocator('iframe[title="Current slide preview"]').locator("h1", { hasText: "Finish" }).waitFor();
  assert((await presenter.locator(".presenter-metrics").textContent()).includes("3 / 3"), "Skipped slide was not excluded from progress");
  assert((await presenter.locator(".presenter-notes").textContent()).includes("Pause for questions"), "Notes did not skip the excluded slide");

  const audienceParams = new URL(`${base}${launch.body.audienceUrl}`).searchParams;
  const audienceBootstrap = await audience.evaluate(async ({ sessionId, capability }) => {
    const response = await fetch(`/api/presentation-sessions/${encodeURIComponent(sessionId)}?capability=${encodeURIComponent(capability)}`, { headers: { "x-slides-studio-presentation": capability } });
    return { status: response.status, body: await response.json() };
  }, { sessionId: audienceParams.get("presentation"), capability: audienceParams.get("capability") });
  assert(audienceBootstrap.status === 200 && audienceBootstrap.body.role === "audience", "Audience capability did not remain role-scoped");
  assert(!audienceBootstrap.body.html.includes("data-speaker-notes") && !audienceBootstrap.body.html.includes("Pause for questions"), "Audience bootstrap leaked speaker notes");

  await audience.evaluate(({ sessionId, deckId, revision }) => {
    const channel = new BroadcastChannel(`slides-studio:presentation:${sessionId}`);
    channel.postMessage({ namespace: "slides-studio-presentation", protocolVersion: 1, sessionId, deckId, revision, seq: 0, senderRole: "audience", senderId: "stale-injector", sentAt: Date.now(), type: "presentation:navigation", slideIndex: 0, slideId: "intro", slideCount: 3 });
    channel.close();
  }, { sessionId: launch.body.sessionId, deckId: launch.body.deckId, revision: launch.body.revision });
  await presenter.waitForTimeout(300);
  assert(await presenter.frameLocator('iframe[title="Current slide preview"]').locator("h1").textContent() === "Finish", "Stale state injection changed the active slide");

  await presenter.getByRole("button", { name: "Pause timer" }).click();
  await presenter.getByRole("button", { name: "Reset timer" }).click();
  assert((await presenter.locator(".presenter-metrics").textContent()).includes("00:00"), "Presenter timer did not reset");

  await audience.close();
  await presenter.getByText("Audience disconnected", { exact: true }).waitFor({ timeout: 5_000 });
  const reopenedPromise = context.waitForEvent("page");
  await presenter.getByRole("button", { name: "Reopen audience" }).click();
  const reopened = await reopenedPromise;
  await reopened.waitForLoadState("networkidle");
  await presenter.getByText("Audience connected", { exact: true }).waitFor({ timeout: 10_000 });
  await reopened.close();

  await presenter.evaluate(() => { window.open = () => null; });
  presenter.once("dialog", (dialog) => { void dialog.accept(); });
  await presenter.getByRole("button", { name: "Reopen audience" }).click();
  await presenter.waitForTimeout(100);

  console.log(JSON.stringify({ ok: true, sessionId: launch.body.sessionId, notesIsolated: true, bidirectional: true, reconnect: true }));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
