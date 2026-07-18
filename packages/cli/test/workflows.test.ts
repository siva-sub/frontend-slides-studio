import { describe, expect, it, vi } from "vitest";
import { applyTransitionToDeck, createAssetPlan, motionEffectFrames, reframeMediaPlacement, submitAssetPlan, waitForAssetJob } from "../src/workflows.js";

const hash = { algorithm: "sha256" as const, value: "a".repeat(64) };
const placement = {
  schemaVersion: 1 as const,
  id: "hero-placement",
  sourcePath: "media/hero.png",
  sourceHash: hash,
  layoutSlot: "hero",
  fit: "cover" as const,
  overlaps: [],
};

describe("asset and media CLI workflows", () => {
  it("builds a validated deterministic plan with prompt provenance", () => {
    const first = createAssetPlan({ id: "plan-1", prompt: "  Editorial orbital system  ", providerId: "openai", model: "gpt-image-2", quality: "high" });
    const second = createAssetPlan({ id: "plan-1", prompt: "Editorial orbital system", providerId: "openai", model: "gpt-image-2", quality: "high" });
    expect(first.prompt).toBe("Editorial orbital system");
    expect(first.promptHash).toEqual(second.promptHash);
    expect(first.stages).toContain("evidence");
    expect(first.provider).toMatchObject({ id: "openai", model: "gpt-image-2", quality: "high" });
  });

  it("reframes a media contract with exact crop and CSS reproduction", () => {
    const result = reframeMediaPlacement(placement, {
      source: { width: 1600, height: 900 },
      slot: { x: 100, y: 50, width: 400, height: 400 },
      fit: "cover",
      focal: { x: 0.75, y: 0.5 },
      zoom: 1.25,
    });
    expect(result.placement.bbox).toEqual([100, 50, 400, 400]);
    expect(result.placement.crop).toBeDefined();
    expect(result.placement.focal).toEqual({ x: 0.75, y: 0.5 });
    expect(result.geometry.css.container.overflow).toBe("hidden");
    expect(result.geometry.destination).toEqual({ x: 100, y: 50, width: 400, height: 400 });
  });

  it("covers every motion preset and applies validated slide/default transitions", () => {
    for (const effect of ["blur", "wipe", "rotate", "pulse", "stagger"]) expect(motionEffectFrames(effect).length).toBeGreaterThanOrEqual(2);
    expect(() => motionEffectFrames("teleport")).toThrow(/unsupported/);
    const deck = { schemaVersion: 1, id: "deck", title: "Deck", slides: [{ id: "s1", role: "cover" }, { id: "s2", role: "content" }] };
    const spec = { schemaVersion: 1, kind: "clip-wipe", durationMs: 650, easing: "ease-out", reducedMotion: "fade" };
    expect(applyTransitionToDeck(deck, spec, { slideId: "s2" }).slides[1]?.transition?.kind).toBe("clip-wipe");
    expect(applyTransitionToDeck(deck, spec, { default: true }).defaultTransition?.durationMs).toBe(650);
    expect(() => applyTransitionToDeck(deck, spec, { slideId: "missing" })).toThrow(/slide not found/);
  });

  it("submits and polls an asset job through the service contract", async () => {
    const plan = createAssetPlan({ id: "plan-1", prompt: "Diagram texture" });
    const queued = { schemaVersion: 1, id: "job-1", planId: "plan-1", status: "queued", progress: 0, capabilities: [] };
    const complete = { ...queued, status: "complete", progress: 1, output: { assetId: "asset-1", artifacts: ["visual-master.png", "evidence-manifest.json"] } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(complete), { status: 200, headers: { "content-type": "application/json" } }));
    const accepted = await submitAssetPlan(plan, { service: "http://127.0.0.1:4317/", token: "token", fetcher });
    const result = await waitForAssetJob(accepted, { service: "http://127.0.0.1:4317", token: "token", fetcher, pollMs: 0, timeoutMs: 1000 });
    expect(result.status).toBe("complete");
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://127.0.0.1:4317/asset-jobs", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "http://127.0.0.1:4317/asset-jobs/job-1", expect.any(Object));
  });
});
