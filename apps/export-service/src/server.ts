import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright";
import { exportRasterPptx } from "@slides-studio/export";
import {
  createDeterministicAssetProvider,
  createPythonImageAssetProvider,
  registerAssetRoutes,
  type AssetGenerationProvider,
} from "./assets.js";
import { auditSource, runPageQualityAudit, settlePageForExport } from "./quality.js";
import { isLoopbackOrigin, validateSource } from "./security.js";

interface Job { id: string; format: "pdf" | "pptx"; status: "queued" | "running" | "complete" | "failed"; progress: number; source: string; qualityGate: "off" | "report" | "strict"; qualityMode: "canonical" | "imported"; qualityReport?: string; qualityPassed?: boolean; output?: string; error?: string; createdAt: number; events: Array<{ id: number; data: Record<string, unknown> }>; }
const jobs = new Map<string, Job>();
const clients = new Map<string, Set<(event: Job["events"][number]) => void>>();
const emit = (job: Job, data: Record<string, unknown>) => { const event = { id: job.events.length + 1, data }; job.events.push(event); clients.get(job.id)?.forEach((listener) => listener(event)); };

async function captureRasterSlides(page: Page, count: number, outputDir: string, job: Job, index = 0, inputs: Array<{ id: string; imagePath: string }> = []): Promise<Array<{ id: string; imagePath: string }>> {
  if (index >= count) return inputs;
  await page.evaluate((active) => {
    const allSlides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    allSlides.forEach((slide, slideIndex) => { slide.classList.toggle("active", slideIndex === active); slide.classList.toggle("visible", slideIndex === active); });
    const target = allSlides[active]; const stage = target?.closest<HTMLElement>(".deck-stage") ?? target;
    if (!target || !stage) return;
    const stageWidth = stage.offsetWidth || target.offsetWidth || 1920;
    const stageHeight = stage.offsetHeight || target.offsetHeight || 1080;
    const scale = Math.min(1920 / stageWidth, 1080 / stageHeight);
    Object.assign(document.documentElement.style, { width: "1920px", height: "1080px", overflow: "hidden" });
    Object.assign(document.body.style, { width: "1920px", height: "1080px", margin: "0", overflow: "hidden" });
    Object.assign(stage.style, { position: "absolute", width: `${stageWidth}px`, height: `${stageHeight}px`, left: `${(1920 - stageWidth * scale) / 2}px`, top: `${(1080 - stageHeight * scale) / 2}px`, transform: `scale(${scale})`, transformOrigin: "0 0" });
    Object.assign(target.style, { position: "absolute", inset: "0", width: "100%", height: "100%", visibility: "visible", opacity: "1" });
  }, index);
  const imagePath = join(outputDir, `slide-${String(index + 1).padStart(2, "0")}.png`);
  await page.screenshot({ path: imagePath, clip: { x: 0, y: 0, width: 1920, height: 1080 }, animations: "disabled" });
  inputs.push({ id: `slide-${index + 1}`, imagePath });
  job.progress = 0.1 + 0.75 * ((index + 1) / count); emit(job, { status: job.status, progress: job.progress, slide: index + 1, total: count });
  return captureRasterSlides(page, count, outputDir, job, index + 1, inputs);
}

async function runJob(job: Job, jobRoot: string): Promise<void> {
  let browser: Browser | undefined;
  try {
    job.status = "running"; job.progress = 0.05; emit(job, { status: job.status, progress: job.progress });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(new URL(`file://${job.source}`).href, { waitUntil: "networkidle", timeout: 30_000 });
    await settlePageForExport(page);
    const slides = page.locator(".slide");
    const count = await slides.count();
    if (count === 0 || count > 200) throw new Error(`invalid slide count: ${count}`);
    const outputDir = join(jobRoot, job.id); await mkdir(outputDir, { recursive: true });
    if (job.qualityGate !== "off") {
      const quality = await runPageQualityAudit(page, { id: `quality-${job.id}`, source: job.source, outputDir, mode: job.qualityMode, strict: job.qualityGate === "strict", requireSettled: true });
      job.qualityReport = quality.reportPath; job.qualityPassed = quality.report.passed;
      emit(job, { status: job.status, progress: job.progress, qualityReport: job.qualityReport, qualityPassed: job.qualityPassed });
      if (job.qualityGate === "strict" && !quality.report.passed) throw new Error(`strict quality gate failed; report: ${quality.reportPath}`);
    }
    if (job.format === "pdf") {
      await page.evaluate(() => {
        const sourceSlides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
        sourceSlides.forEach((slide, index) => { slide.dataset.slideId ||= `export-slide-${index + 1}`; });
        const printRoot = document.createElement("main"); printRoot.id = "slides-studio-print-root";
        sourceSlides.forEach((sourceSlide) => {
          const pageElement = document.createElement("section"); pageElement.className = "slides-studio-print-page";
          const sourceStage = sourceSlide.closest<HTMLElement>(".deck-stage");
          const stageWidth = sourceStage?.offsetWidth || sourceSlide.offsetWidth || 1920;
          const stageHeight = sourceStage?.offsetHeight || sourceSlide.offsetHeight || 1080;
          const stage = sourceStage ? sourceStage.cloneNode(true) as HTMLElement : document.createElement("div");
          const scale = Math.min(1280 / stageWidth, 720 / stageHeight);
          stage.classList.add("deck-stage", "slides-studio-print-stage");
          stage.style.setProperty("--slides-studio-print-width", `${stageWidth}px`);
          stage.style.setProperty("--slides-studio-print-height", `${stageHeight}px`);
          stage.style.setProperty("--slides-studio-print-scale", String(scale));
          stage.style.setProperty("--slides-studio-print-left", `${(1280 - stageWidth * scale) / 2}px`);
          stage.style.setProperty("--slides-studio-print-top", `${(720 - stageHeight * scale) / 2}px`);
          if (!sourceStage) stage.append(sourceSlide.cloneNode(true));
          stage.querySelectorAll<HTMLElement>(".slide").forEach((candidate) => {
            if (candidate.dataset.slideId !== sourceSlide.dataset.slideId) candidate.remove();
            else { candidate.classList.add("active", "visible"); candidate.removeAttribute("aria-hidden"); }
          });
          pageElement.append(stage); printRoot.append(pageElement);
        });
        document.body.replaceChildren(printRoot);
      });
      await page.addStyleTag({ content: "@page{size:13.333in 7.5in;margin:0}html,body{margin:0!important;padding:0!important;width:1280px!important;height:auto!important;overflow:visible!important;background:white!important}#slides-studio-print-root{margin:0!important;padding:0!important;width:1280px!important}.slides-studio-print-page{position:relative!important;width:1280px!important;height:720px!important;margin:0!important;padding:0!important;overflow:hidden!important;break-after:page;page-break-after:always;background:white}.slides-studio-print-page:last-child{break-after:auto;page-break-after:auto}.slides-studio-print-stage{position:absolute!important;left:var(--slides-studio-print-left)!important;top:var(--slides-studio-print-top)!important;width:var(--slides-studio-print-width)!important;height:var(--slides-studio-print-height)!important;transform:scale(var(--slides-studio-print-scale))!important;transform-origin:0 0!important}.slides-studio-print-stage>.slide{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;display:block!important}" });
      job.output = join(outputDir, `${basename(job.source).replace(/\.html?$/i, "")}.pdf`);
      await page.pdf({ path: job.output, width: "13.333in", height: "7.5in", printBackground: true, preferCSSPageSize: true, tagged: true, scale: 1 });
    } else {
      const inputs = await captureRasterSlides(page, count, outputDir, job);
      job.output = join(outputDir, `${basename(job.source).replace(/\.html?$/i, "")}.pptx`);
      await exportRasterPptx(inputs, job.output, { ...(job.qualityReport ? { qualityReport: job.qualityReport } : {}) });
    }
    job.status = "complete"; job.progress = 1; emit(job, { status: job.status, progress: 1, output: job.output });
  } catch (error) { job.status = "failed"; job.error = error instanceof Error ? error.message : String(error); emit(job, { status: job.status, error: job.error }); }
  finally { await browser?.close(); }
}

export interface ServerOptions {
  token: string;
  sourceRoot: string;
  jobRoot: string;
  logger?: boolean;
  assetProvider?: AssetGenerationProvider;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 64 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackOrigin(request.headers.origin) || !isLoopbackOrigin(request.headers.referer)) return reply.code(403).send({ error: "foreign origin rejected" });
    const origin = request.headers.origin;
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") return reply.code(204).send();
    if (request.headers.authorization !== `Bearer ${options.token}`) return reply.code(401).send({ error: "invalid session token" });
  });
  registerAssetRoutes(app, { jobRoot: options.jobRoot, ...(options.assetProvider ? { provider: options.assetProvider } : {}) });
  app.get("/health", async () => ({ ok: true, activeJobs: [...jobs.values()].filter((job) => job.status === "running").length }));
  app.post<{ Body: { source: string; mode?: "canonical" | "imported"; strict?: boolean } }>("/quality", async (request, reply) => {
    if (!request.body?.source) return reply.code(400).send({ error: "source is required" });
    let source: string; try { source = await validateSource(options.sourceRoot, request.body.source); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
    const id = randomUUID(); const outputDir = join(options.jobRoot, `quality-${id}`); await mkdir(outputDir, { recursive: true });
    try { const result = await auditSource(source, outputDir, { id: `quality-${id}`, mode: request.body.mode ?? "canonical", strict: request.body.strict ?? false }); return { report: result.report, reportPath: result.reportPath, screenshots: result.screenshots.map(({ path }) => path) }; }
    catch (error) { return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Body: { source: string; format: "pdf" | "pptx"; qualityGate?: "off" | "report" | "strict"; qualityMode?: "canonical" | "imported" } }>("/jobs", async (request, reply) => {
    if (!request.body || !["pdf", "pptx"].includes(request.body.format)) return reply.code(400).send({ error: "format must be pdf or pptx" });
    if (request.body.qualityGate && !["off", "report", "strict"].includes(request.body.qualityGate)) return reply.code(400).send({ error: "qualityGate must be off, report, or strict" });
    if (request.body.qualityMode && !["canonical", "imported"].includes(request.body.qualityMode)) return reply.code(400).send({ error: "qualityMode must be canonical or imported" });
    let source: string; try { source = await validateSource(options.sourceRoot, request.body.source); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
    const job: Job = { id: randomUUID(), format: request.body.format, status: "queued", progress: 0, source, qualityGate: request.body.qualityGate ?? "report", qualityMode: request.body.qualityMode ?? "canonical", createdAt: Date.now(), events: [] }; jobs.set(job.id, job); void runJob(job, options.jobRoot); return reply.code(202).send(job);
  });
  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => { const job = jobs.get(request.params.id); return job ? job : reply.code(404).send({ error: "job not found" }); });
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/jobs/:id/events", async (request, reply) => {
    const job = jobs.get(request.params.id); if (!job) return reply.code(404).send({ error: "job not found" });
    reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const after = Number(request.query.after ?? request.headers["last-event-id"] ?? 0); const send = (event: Job["events"][number]) => reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`); job.events.filter((event) => event.id > after).forEach(send);
    const listeners = clients.get(job.id) ?? new Set(); listeners.add(send); clients.set(job.id, listeners); request.raw.on("close", () => listeners.delete(send));
  });
  const cleanup = setInterval(() => { const cutoff = Date.now() - 60 * 60 * 1000; for (const [id, job] of jobs) if (job.createdAt < cutoff && job.status !== "running") { jobs.delete(id); clients.delete(id); void rm(join(options.jobRoot, id), { recursive: true, force: true }); } }, 60_000); cleanup.unref();
  app.addHook("onClose", async () => clearInterval(cleanup));
  return app;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const token = process.env.SLIDES_STUDIO_EXPORT_TOKEN || randomBytes(32).toString("hex");
  const sourceRoot = resolve(process.env.SLIDES_STUDIO_SOURCE_ROOT || process.cwd());
  const jobRoot = resolve(process.env.SLIDES_STUDIO_JOB_ROOT || join(sourceRoot, ".slides-studio", "exports"));
  await mkdir(jobRoot, { recursive: true });
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const providerMode = process.env.SLIDES_STUDIO_ASSET_PROVIDER?.trim().toLowerCase();
  const assetProvider = providerMode === "openai"
    ? createPythonImageAssetProvider(projectRoot)
    : providerMode === "deterministic"
      ? createDeterministicAssetProvider()
      : undefined;
  const app = buildServer({ token, sourceRoot, jobRoot, ...(assetProvider ? { assetProvider } : {}) });
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 4317) });
  app.log.info({ token, sourceRoot, jobRoot }, "Slides Studio export service ready; token is one-time session material");
}
