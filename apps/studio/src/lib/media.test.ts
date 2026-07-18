import { describe, expect, it, vi } from "vitest";
import {
  applyMediaReframe,
  applyMediaSource,
  createStudioAssetPlan,
  fetchAssetArtifact,
  generatedMediaArtifact,
  readMediaReframe,
  resetMediaReframe,
  resolvePreviewMediaSources,
  submitAssetJob,
  waitForAssetJob,
} from "./media";

const source = '<!doctype html><html><body><section class="slide" data-slide-id="s1"><img data-object-id="hero" data-source-width="1600" data-source-height="900" src="hero.png" alt="Original" style="width:400px;height:240px"></section></body></html>';

describe("Studio media workflows", () => {
  it("stores relative media sources while resolving folder previews separately", () => {
    const staged = applyMediaSource(source, "hero", { src: "assets/user-media/ab/hero-abcd1234.png", sha256: "a".repeat(64), originalName: "hero.png" });
    expect(staged).toContain('src="assets/user-media/ab/hero-abcd1234.png"');
    expect(staged).toContain(`data-asset-sha256="${"a".repeat(64)}"`);
    const previewed = resolvePreviewMediaSources(staged, new Map([["assets/user-media/ab/hero-abcd1234.png", "blob:preview"]]));
    expect(previewed).toContain('src="blob:preview"');
    expect(staged).not.toContain("blob:preview");
  });

  it("round-trips complete media framing and resets geometry", () => {
    const reframed = applyMediaReframe(source, "hero", { fit: "cover", focalX: 0.72, focalY: 0.18, panX: 0.08, panY: -0.04, zoom: 1.4, rotation: -12, alt: "Product detail", layoutSlot: "hero" });
    expect(reframed).toContain('data-media-fit="cover"');
    expect(reframed).toContain('data-layout-slot="hero"');
    expect(reframed).toContain("scale: 1.4");
    const frame = readMediaReframe(reframed, "hero");
    expect(frame).toMatchObject({ fit: "cover", focalX: 0.72, focalY: 0.18, panX: 0.08, panY: -0.04, zoom: 1.4, rotation: -12, alt: "Product detail", layoutSlot: "hero" });
    expect(frame?.crop).toBeDefined();
    const manual = applyMediaReframe(reframed, "hero", { crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 } });
    expect(readMediaReframe(manual, "hero")?.crop).toEqual({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 });
    expect(readMediaReframe(resetMediaReframe(manual, "hero"), "hero")).toEqual({ fit: "cover", focalX: 0.5, focalY: 0.5, panX: 0, panY: 0, zoom: 1, rotation: 0, alt: "Product detail", layoutSlot: "hero" });
    expect(applyMediaReframe(source, "missing", { fit: "cover" })).toBe(source);
  });

  it("builds provenance-bearing generation plans", async () => {
    const plan = await createStudioAssetPlan({ id: "studio-plan", prompt: "  A tactile data landscape  ", slideId: "s1" });
    expect(plan).toMatchObject({ id: "studio-plan", slideId: "s1", prompt: "A tactile data landscape", operation: "generate" });
    expect(plan.promptHash?.value).toHaveLength(64);
    expect(plan.stages).toContain("evidence");
  });

  it("submits, polls, selects, and downloads a generated media artifact", async () => {
    const plan = await createStudioAssetPlan({ id: "studio-plan", prompt: "A tactile data landscape" });
    const queued = { schemaVersion: 1, id: "job-1", planId: "studio-plan", status: "queued", progress: 0, capabilities: [] };
    const complete = { ...queued, status: "complete", progress: 1, output: { assetId: "asset-1", artifacts: ["visual-master.svg", "evidence-manifest.json"] } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(complete), { status: 200 }))
      .mockResolvedValueOnce(new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }));
    const accepted = await submitAssetJob(plan, { service: "http://127.0.0.1:4317", token: "token", fetcher });
    const result = await waitForAssetJob(accepted, { service: "http://127.0.0.1:4317", token: "token", fetcher, pollMs: 0, timeoutMs: 500 });
    const artifact = generatedMediaArtifact(result);
    expect(artifact).toBe("visual-master.svg");
    const blob = await fetchAssetArtifact(result.id, artifact!, { service: "http://127.0.0.1:4317", token: "token", fetcher });
    expect(blob.type).toBe("image/svg+xml");
    expect(fetcher).toHaveBeenLastCalledWith("http://127.0.0.1:4317/asset-jobs/job-1/artifacts/visual-master.svg", expect.any(Object));
  });
});
