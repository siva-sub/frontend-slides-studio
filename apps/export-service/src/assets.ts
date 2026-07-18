import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import {
  assetJobSchema,
  assetPlanSchema,
  safeRelativePathSchema,
  type AssetJob,
  type AssetPlan,
  type AssetProvider,
  type ProviderCapability,
  type ProviderQuality,
} from "@slides-studio/protocol";

const execFileAsync = promisify(execFile);
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export interface GeneratedAssetArtifact {
  path: string;
  data: Uint8Array | string;
  mimeType: string;
}

export interface AssetGenerationResult {
  assetId?: string;
  artifacts: GeneratedAssetArtifact[];
  model?: string;
  quality?: ProviderQuality;
  capabilities?: ProviderCapability[];
}

export interface AssetGenerationContext {
  jobId: string;
  report(update: { stage?: string; progress?: number }): void;
}

export interface AssetGenerationProvider {
  descriptor: AssetProvider;
  generate(plan: AssetPlan, context: AssetGenerationContext): Promise<AssetGenerationResult>;
}

interface AssetEvent {
  id: number;
  data: Record<string, unknown>;
}

interface AssetJobRecord {
  job: AssetJob;
  plan: AssetPlan;
  createdAt: number;
  events: AssetEvent[];
  artifactMime: Map<string, string>;
  writeChain: Promise<void>;
}

export interface AssetRouteOptions {
  jobRoot: string;
  provider?: AssetGenerationProvider;
  retentionMs?: number;
}

function publicJob(record: AssetJobRecord): AssetJob {
  return assetJobSchema.parse(record.job);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function containedArtifactPath(root: string, relativePath: string): string {
  const safe = safeRelativePathSchema.parse(relativePath);
  const target = resolve(root, safe);
  const child = relative(resolve(root), target);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`)) throw new Error("artifact path escapes job root");
  return target;
}

function artifactBytes(data: Uint8Array | string): Uint8Array {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  return bytes;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

/** Offline provider used only when explicitly selected for demos and E2E tests. */
export function createDeterministicAssetProvider(): AssetGenerationProvider {
  return {
    descriptor: { id: "deterministic-local", model: "svg-placeholder-v1", quality: "draft", capabilities: ["ordinary-generation"] },
    async generate(plan, context) {
      context.report({ stage: "rendering", progress: 0.45 });
      const prompt = (plan.prompt ?? "Generated presentation asset").trim();
      const digest = createHash("sha256").update(prompt).digest("hex");
      const accent = `#${digest.slice(0, 6)}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864"><rect width="1536" height="864" fill="#111713"/><circle cx="1240" cy="190" r="250" fill="${accent}" opacity=".72"/><path d="M0 680 L650 280 L1050 864 H0Z" fill="#f4f0e6" opacity=".12"/><text x="104" y="170" fill="#f4f0e6" font-family="system-ui,sans-serif" font-size="32" letter-spacing="8">FRONTEND SLIDES STUDIO</text><text x="104" y="330" fill="#f4f0e6" font-family="system-ui,sans-serif" font-size="68" font-weight="700">${escapeXml(prompt.slice(0, 80))}</text><text x="104" y="782" fill="#f4f0e6" opacity=".58" font-family="monospace" font-size="22">DETERMINISTIC OFFLINE PREVIEW · ${digest.slice(0, 12)}</text></svg>`;
      context.report({ stage: "packaging", progress: 0.85 });
      return { assetId: `asset-${digest.slice(0, 16)}`, artifacts: [{ path: "visual-master.svg", data: svg, mimeType: "image/svg+xml" }], model: "svg-placeholder-v1", quality: "draft", capabilities: ["ordinary-generation"] };
    },
  };
}

/** Adapter for the Apache-derived Python/OpenAI provider boundary. */
export function createPythonImageAssetProvider(projectRoot: string): AssetGenerationProvider {
  return {
    descriptor: { id: "openai", model: "gpt-image-2", quality: "high", capabilities: ["ordinary-generation", "masked-edit"] },
    async generate(plan, context) {
      if (!plan.prompt?.trim()) throw new Error("generation plans require a non-empty prompt");
      const scratch = await mkdtemp(join(tmpdir(), "slides-studio-asset-"));
      const output = join(scratch, "visual-master.png");
      try {
        context.report({ stage: "provider", progress: 0.2 });
        await execFileAsync("python3", [resolve(projectRoot, "visual/cli.py"), "generate", "--prompt", plan.prompt, "--output", output], {
          cwd: resolve(projectRoot, "visual"),
          env: { ...process.env, PYTHONPATH: resolve(projectRoot, "visual") },
          maxBuffer: 2 * 1024 * 1024,
        });
        const data = await readFile(output);
        context.report({ stage: "packaging", progress: 0.85 });
        return {
          assetId: `asset-${createHash("sha256").update(data).digest("hex").slice(0, 16)}`,
          artifacts: [{ path: "visual-master.png", data, mimeType: "image/png" }],
          model: plan.provider?.model ?? "gpt-image-2",
          quality: plan.provider?.quality ?? "high",
          capabilities: plan.provider?.capabilities ?? ["ordinary-generation", "masked-edit"],
        };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}

export function registerAssetRoutes(app: FastifyInstance, options: AssetRouteOptions): void {
  const jobs = new Map<string, AssetJobRecord>();
  const listeners = new Map<string, Set<(event: AssetEvent) => void>>();
  const jobDirectory = (id: string) => join(options.jobRoot, id);

  const emit = (record: AssetJobRecord, data: Record<string, unknown>) => {
    const event = { id: record.events.length + 1, data };
    record.events.push(event);
    listeners.get(record.job.id)?.forEach((listener) => listener(event));
  };
  const persistJob = (record: AssetJobRecord) => {
    const snapshot = publicJob(record);
    const path = join(jobDirectory(record.job.id), "job.json");
    record.writeChain = record.writeChain.then(
      () => writeJsonAtomic(path, snapshot),
      () => writeJsonAtomic(path, snapshot),
    );
    return record.writeChain;
  };

  const run = async (record: AssetJobRecord) => {
    const root = jobDirectory(record.job.id);
    try {
      record.job = { ...record.job, status: "running", stage: "provider", progress: 0.05 };
      await persistJob(record);
      emit(record, { status: record.job.status, stage: record.job.stage, progress: record.job.progress });
      const result = await options.provider!.generate(record.plan, {
        jobId: record.job.id,
        report(update) {
          const progress = update.progress === undefined ? record.job.progress : Math.max(record.job.progress, Math.min(0.95, update.progress));
          record.job = { ...record.job, stage: update.stage ?? record.job.stage, progress };
          emit(record, { status: record.job.status, stage: record.job.stage, progress: record.job.progress });
          void persistJob(record);
        },
      });
      if (result.artifacts.length === 0) throw new Error("asset provider returned no artifacts");
      const inventory: Array<{ path: string; mimeType: string; bytes: number; sha256: string }> = [];
      const seen = new Set<string>();
      for (const artifact of result.artifacts) {
        const safePath = safeRelativePathSchema.parse(artifact.path);
        if (["plan.json", "job.json", "artifact-manifest.json", "evidence-manifest.json"].includes(safePath)) throw new Error(`provider artifact uses reserved path: ${safePath}`);
        if (seen.has(safePath)) throw new Error(`duplicate provider artifact: ${safePath}`);
        seen.add(safePath);
        const bytes = artifactBytes(artifact.data);
        const target = containedArtifactPath(root, safePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: "wx" });
        const digest = createHash("sha256").update(bytes).digest("hex");
        inventory.push({ path: safePath, mimeType: artifact.mimeType, bytes: bytes.byteLength, sha256: digest });
        record.artifactMime.set(safePath, artifact.mimeType);
      }
      const provider = { ...options.provider!.descriptor, model: result.model ?? options.provider!.descriptor.model, quality: result.quality ?? options.provider!.descriptor.quality, capabilities: result.capabilities ?? options.provider!.descriptor.capabilities };
      const evidence = {
        schemaVersion: 1,
        jobId: record.job.id,
        planId: record.plan.id,
        reviewStatus: "rendered_pending_manual_review",
        claimedPassed: false,
        provider,
        artifacts: inventory,
        renderBack: { status: "rendered_pending_manual_review", claimedPassed: false, evidence: inventory.map((item) => item.path) },
      };
      await writeJsonAtomic(join(root, "evidence-manifest.json"), evidence);
      record.artifactMime.set("evidence-manifest.json", "application/json");
      const artifactManifest = { schemaVersion: 1, jobId: record.job.id, plan: "plan.json", evidence: "evidence-manifest.json", artifacts: inventory };
      await writeJsonAtomic(join(root, "artifact-manifest.json"), artifactManifest);
      record.artifactMime.set("artifact-manifest.json", "application/json");
      const artifacts = [...inventory.map((item) => item.path), "evidence-manifest.json", "artifact-manifest.json"];
      record.job = {
        ...record.job,
        status: "complete",
        stage: "review",
        progress: 1,
        output: { assetId: result.assetId, artifacts },
        model: provider.model,
        quality: provider.quality,
        capabilities: provider.capabilities,
      };
      await persistJob(record);
      emit(record, { status: record.job.status, stage: record.job.stage, progress: 1, output: record.job.output });
    } catch (error) {
      record.job = { ...record.job, status: "failed", stage: "failed", error: error instanceof Error ? error.message : String(error) };
      await persistJob(record).catch(() => undefined);
      emit(record, { status: record.job.status, error: record.job.error });
    }
  };

  app.post<{ Body: { plan?: unknown } & Record<string, unknown> }>("/asset-jobs", async (request, reply) => {
    if (!options.provider) return reply.code(503).send({ error: "asset generation provider is not configured" });
    const candidate = request.body?.plan ?? request.body;
    const parsed = assetPlanSchema.safeParse(candidate);
    if (!parsed.success) return reply.code(400).send({ error: "invalid asset plan", issues: parsed.error.issues });
    if (parsed.data.operation !== "generate" || !parsed.data.prompt?.trim()) return reply.code(400).send({ error: "asset jobs require operation=generate and a non-empty prompt" });
    const id = randomUUID();
    const record: AssetJobRecord = {
      job: { schemaVersion: 1, id, planId: parsed.data.id, status: "queued", progress: 0, capabilities: parsed.data.capabilities },
      plan: parsed.data,
      createdAt: Date.now(),
      events: [],
      artifactMime: new Map(),
      writeChain: Promise.resolve(),
    };
    jobs.set(id, record);
    await mkdir(options.jobRoot, { recursive: true });
    const root = jobDirectory(id);
    await mkdir(root, { recursive: false });
    await writeJsonAtomic(join(root, "plan.json"), record.plan);
    await persistJob(record);
    emit(record, { status: "queued", progress: 0 });
    queueMicrotask(() => { void run(record); });
    return reply.code(202).send(publicJob(record));
  });

  app.get<{ Params: { id: string } }>("/asset-jobs/:id", async (request, reply) => {
    const record = jobs.get(request.params.id);
    return record ? publicJob(record) : reply.code(404).send({ error: "asset job not found" });
  });

  app.get<{ Params: { id: string; "*": string } }>("/asset-jobs/:id/artifacts/*", async (request, reply) => {
    const record = jobs.get(request.params.id);
    if (!record) return reply.code(404).send({ error: "asset job not found" });
    const parsed = safeRelativePathSchema.safeParse(request.params["*"]);
    if (!parsed.success || !record.job.output?.artifacts.includes(parsed.data)) return reply.code(404).send({ error: "artifact not found" });
    try {
      const path = containedArtifactPath(jobDirectory(record.job.id), parsed.data);
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) return reply.code(404).send({ error: "artifact not found" });
      reply.type(record.artifactMime.get(parsed.data) ?? "application/octet-stream");
      return reply.send(await readFile(path));
    } catch {
      return reply.code(404).send({ error: "artifact not found" });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/asset-jobs/:id/events", async (request, reply) => {
    const record = jobs.get(request.params.id);
    if (!record) return reply.code(404).send({ error: "asset job not found" });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const after = Number(request.query.after ?? request.headers["last-event-id"] ?? 0);
    const send = (event: AssetEvent) => reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
    record.events.filter((event) => event.id > after).forEach(send);
    const jobListeners = listeners.get(record.job.id) ?? new Set();
    jobListeners.add(send);
    listeners.set(record.job.id, jobListeners);
    request.raw.on("close", () => jobListeners.delete(send));
  });

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - (options.retentionMs ?? 60 * 60 * 1000);
    for (const [id, record] of jobs) {
      if (record.createdAt >= cutoff || record.job.status === "running" || record.job.status === "queued") continue;
      jobs.delete(id);
      listeners.delete(id);
      void rm(jobDirectory(id), { recursive: true, force: true });
    }
  }, 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => clearInterval(cleanup));
}
