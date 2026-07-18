import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetPlan } from "@slides-studio/protocol";
import { buildServer } from "./server.js";
import type { AssetGenerationProvider } from "./assets.js";

const token = "test-token";
const headers = { authorization: `Bearer ${token}`, origin: "http://127.0.0.1:5173", "content-type": "application/json" };
const roots: string[] = [];

const plan: AssetPlan = {
  schemaVersion: 1,
  id: "plan-01",
  operation: "generate",
  stages: ["prompt", "provider", "evidence"],
  capabilities: ["ordinary-generation"],
  prompt: "A restrained editorial title visual",
  referenceHashes: [],
  protectedRegions: [],
  alternativeRegions: [],
  placements: [],
};

async function fixture(provider: AssetGenerationProvider) {
  const root = await mkdtemp(join(tmpdir(), "slides-studio-assets-test-"));
  roots.push(root);
  const sourceRoot = join(root, "source");
  const jobRoot = join(root, "jobs");
  await mkdir(sourceRoot);
  await mkdir(jobRoot);
  const app = buildServer({ token, sourceRoot, jobRoot, logger: false, assetProvider: provider });
  return { app, jobRoot };
}

async function waitForStatus(app: ReturnType<typeof buildServer>, id: string, status: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/asset-jobs/${id}`, headers });
    const body = response.json();
    if (body.status === status) return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`asset job ${id} did not reach ${status}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("asset jobs", () => {
  it("persists queued/running/completed state and serves evidence-gated artifacts", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider: AssetGenerationProvider = {
      descriptor: { id: "fake", model: "fake-v1", quality: "draft", capabilities: ["ordinary-generation"] },
      async generate(_plan, context) {
        context.report({ stage: "provider", progress: 0.35 });
        await gate;
        context.report({ stage: "packaging", progress: 0.8 });
        return { assetId: "asset-01", artifacts: [{ path: "visual-master.svg", data: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", mimeType: "image/svg+xml" }], model: "fake-v1", quality: "draft", capabilities: ["ordinary-generation"] };
      },
    };
    const { app, jobRoot } = await fixture(provider);
    try {
      const accepted = await app.inject({ method: "POST", url: "/asset-jobs", headers, payload: { plan } });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json().status).toBe("queued");
      const id = accepted.json().id as string;
      const running = await waitForStatus(app, id, "running");
      expect(running.progress).toBeGreaterThan(0);
      release();
      const complete = await waitForStatus(app, id, "complete");
      expect(complete.output.artifacts).toEqual(expect.arrayContaining(["visual-master.svg", "evidence-manifest.json", "artifact-manifest.json"]));
      const persistedJob = JSON.parse(await readFile(join(jobRoot, id, "job.json"), "utf8"));
      expect(persistedJob).toMatchObject({ status: "complete", progress: 1, output: { assetId: "asset-01" } });
      const evidence = JSON.parse(await readFile(join(jobRoot, id, "evidence-manifest.json"), "utf8"));
      expect(evidence).toMatchObject({ reviewStatus: "rendered_pending_manual_review", claimedPassed: false, provider: { id: "fake" } });
      const artifactManifest = JSON.parse(await readFile(join(jobRoot, id, "artifact-manifest.json"), "utf8"));
      const expectedSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
      expect(artifactManifest.artifacts).toEqual([{ path: "visual-master.svg", mimeType: "image/svg+xml", bytes: expectedSvg.length, sha256: createHash("sha256").update(expectedSvg).digest("hex") }]);
      const artifact = await app.inject({ method: "GET", url: `/asset-jobs/${id}/artifacts/visual-master.svg`, headers });
      expect(artifact.statusCode).toBe(200);
      expect(artifact.headers["content-type"]).toContain("image/svg+xml");
      expect(artifact.body).toContain("<svg");
    } finally {
      release();
      await app.close();
    }
  });

  it("records provider failures and rejects unsafe provider artifact paths", async () => {
    const failing: AssetGenerationProvider = {
      descriptor: { id: "fake", capabilities: ["ordinary-generation"] },
      async generate() { throw new Error("provider unavailable"); },
    };
    const first = await fixture(failing);
    try {
      const accepted = await first.app.inject({ method: "POST", url: "/asset-jobs", headers, payload: plan });
      const failed = await waitForStatus(first.app, accepted.json().id, "failed");
      expect(failed.error).toContain("provider unavailable");
    } finally { await first.app.close(); }

    const traversal: AssetGenerationProvider = {
      descriptor: { id: "fake", capabilities: ["ordinary-generation"] },
      async generate() { return { artifacts: [{ path: "../escape.svg", data: "bad", mimeType: "image/svg+xml" }] }; },
    };
    const second = await fixture(traversal);
    try {
      const accepted = await second.app.inject({ method: "POST", url: "/asset-jobs", headers, payload: { plan } });
      const failed = await waitForStatus(second.app, accepted.json().id, "failed");
      expect(failed.error).toMatch(/path|relative/i);
      await expect(readFile(join(second.jobRoot, "escape.svg"))).rejects.toThrow();
    } finally { await second.app.close(); }
  });

  it("rejects invalid plans, foreign origins, and artifact traversal", async () => {
    const provider: AssetGenerationProvider = {
      descriptor: { id: "fake", capabilities: ["ordinary-generation"] },
      async generate() { return { artifacts: [{ path: "asset.txt", data: "ok", mimeType: "text/plain" }] }; },
    };
    const { app } = await fixture(provider);
    try {
      const invalid = await app.inject({ method: "POST", url: "/asset-jobs", headers, payload: { schemaVersion: 1, id: "missing-prompt" } });
      expect(invalid.statusCode).toBe(400);
      const foreign = await app.inject({ method: "POST", url: "/asset-jobs", headers: { ...headers, origin: "https://evil.example" }, payload: plan });
      expect(foreign.statusCode).toBe(403);
      const missing = await app.inject({ method: "GET", url: "/asset-jobs/not-found/artifacts/../plan.json", headers });
      expect(missing.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("returns 503 when no asset provider is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-studio-no-provider-test-"));
    roots.push(root);
    const sourceRoot = join(root, "source");
    const jobRoot = join(root, "jobs");
    await mkdir(sourceRoot);
    const app = buildServer({ token, sourceRoot, jobRoot, logger: false });
    try {
      const response = await app.inject({ method: "POST", url: "/asset-jobs", headers, payload: { plan } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toMatch(/provider/i);
    } finally { await app.close(); }
  });
});
