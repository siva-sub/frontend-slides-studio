import { createHash } from "node:crypto";
import {
  assetJobSchema,
  assetPlanSchema,
  deckGoalSchema,
  mediaPlacementSchema,
  transitionSpecSchema,
  type AssetJob,
  type AssetPlan,
  type DeckGoalV1,
  type MediaPlacement,
  type ProviderCapability,
  type TransitionSpecV1,
  type ProviderQuality,
} from "@slides-studio/protocol";
import { computePlacement, type Fit, type Point, type Rect } from "@slides-studio/media-kit";

export interface AssetPlanInput {
  id: string;
  prompt: string;
  slideId?: string;
  styleId?: string;
  layoutId?: string;
  providerId?: string;
  model?: string;
  quality?: ProviderQuality;
  capabilities?: ProviderCapability[];
  stages?: string[];
}

export function createAssetPlan(input: AssetPlanInput): AssetPlan {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("asset prompt must not be empty");
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const provider = input.providerId
    ? {
        id: input.providerId,
        ...(input.model ? { model: input.model } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        capabilities: input.capabilities ?? ["ordinary-generation" as const],
      }
    : undefined;
  return assetPlanSchema.parse({
    schemaVersion: 1,
    id: input.id,
    ...(input.slideId ? { slideId: input.slideId } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
    ...(input.layoutId ? { layoutId: input.layoutId } : {}),
    operation: "generate",
    stages: input.stages ?? ["prompt", "provider", "evidence", "review"],
    capabilities: input.capabilities ?? ["ordinary-generation"],
    prompt,
    promptHash: { algorithm: "sha256", value: promptHash },
    referenceHashes: [],
    protectedRegions: [],
    alternativeRegions: [],
    placements: [],
    ...(provider ? { provider } : {}),
  });
}

export interface MediaReframeInput {
  source: { width: number; height: number };
  slot: Rect;
  fit?: Fit;
  focal?: Point;
  pan?: Point;
  zoom?: number;
  rotation?: number;
}

export interface MediaReframeOutput {
  placement: MediaPlacement;
  geometry: ReturnType<typeof computePlacement>;
}

export function reframeMediaPlacement(placementInput: unknown, changes: MediaReframeInput): MediaReframeOutput {
  const placement = mediaPlacementSchema.parse(placementInput);
  const focal = changes.focal ?? placement.focal;
  const pan = changes.pan ?? placement.pan;
  const zoom = changes.zoom ?? placement.zoom;
  const rotation = changes.rotation ?? placement.rotation;
  const geometry = computePlacement({
    source: changes.source,
    slot: changes.slot,
    fit: changes.fit ?? placement.fit,
    ...(focal !== undefined ? { focal } : {}),
    ...(pan !== undefined ? { pan } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
  });
  const crop = {
    x: geometry.crop.x / changes.source.width,
    y: geometry.crop.y / changes.source.height,
    width: geometry.crop.width / changes.source.width,
    height: geometry.crop.height / changes.source.height,
  };
  const next = mediaPlacementSchema.parse({
    ...placement,
    fit: geometry.fit,
    bbox: [changes.slot.x, changes.slot.y, changes.slot.width, changes.slot.height],
    crop,
    ...(changes.focal ? { focal: changes.focal } : {}),
    ...(changes.pan ? { pan: changes.pan } : {}),
    ...(changes.zoom !== undefined ? { zoom: changes.zoom } : {}),
    ...(changes.rotation !== undefined ? { rotation: changes.rotation } : {}),
  });
  return { placement: next, geometry };
}

export interface AssetServiceClientOptions {
  service: string;
  token: string;
  fetcher?: typeof fetch;
}

function serviceUrl(service: string, path: string): string {
  return `${service.replace(/\/$/, "")}${path}`;
}

function requestHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function submitAssetPlan(planInput: unknown, options: AssetServiceClientOptions): Promise<AssetJob> {
  const plan = assetPlanSchema.parse(planInput);
  const response = await (options.fetcher ?? fetch)(serviceUrl(options.service, "/asset-jobs"), {
    method: "POST",
    headers: requestHeaders(options.token),
    body: JSON.stringify({ plan }),
  });
  if (!response.ok) throw new Error(`asset service rejected the plan (${response.status}): ${await response.text()}`);
  return assetJobSchema.parse(await response.json());
}

export function motionEffectFrames(effect: string): Array<Record<string, string | number>> {
  if (effect === "fade" || effect === "reveal") return [{ opacity: 0 }, { opacity: 1 }];
  if (effect === "slide") return [{ opacity: 0, translate: "0 24px" }, { opacity: 1, translate: "0 0" }];
  if (effect === "scale") return [{ opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }];
  if (effect === "draw") return [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }];
  if (effect === "focus") return [{ opacity: 0.45, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }];
  if (effect === "loop") return [{ opacity: 0.7, translate: "0 0" }, { opacity: 1, translate: "0 -8px" }, { opacity: 0.7, translate: "0 0" }];
  if (effect === "blur") return [{ opacity: 0, filter: "blur(18px)" }, { opacity: 1, filter: "blur(0px)" }];
  if (effect === "wipe") return [{ clipPath: "inset(0 100% 0 0)", opacity: 0.4 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }];
  if (effect === "rotate") return [{ opacity: 0, rotate: "-5deg", scale: 0.96 }, { opacity: 1, rotate: "0deg", scale: 1 }];
  if (effect === "pulse") return [{ scale: 1 }, { scale: 1.06 }, { scale: 1 }];
  if (effect === "stagger") return [{ opacity: 0, translate: "0 18px" }, { opacity: 1, translate: "0 0" }];
  throw new Error(`unsupported motion effect: ${effect}`);
}

export function applyTransitionToDeck(deckInput: unknown, specInput: unknown, target: { default?: boolean; slideId?: string }): DeckGoalV1 {
  const deck = deckGoalSchema.parse(deckInput);
  const transition = transitionSpecSchema.parse(specInput);
  if (target.default) return deckGoalSchema.parse({ ...deck, defaultTransition: transition });
  if (!target.slideId) throw new Error("--slide or --default is required");
  let found = false;
  const slides = deck.slides.map((slide) => {
    if (slide.id !== target.slideId) return slide;
    found = true;
    return { ...slide, transition };
  });
  if (!found) throw new Error(`slide not found: ${target.slideId}`);
  return deckGoalSchema.parse({ ...deck, slides });
}

export async function waitForAssetJob(job: AssetJob, options: AssetServiceClientOptions & { pollMs?: number; timeoutMs?: number }): Promise<AssetJob> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let current = job;
  while (!["complete", "failed", "cancelled"].includes(current.status)) {
    if (Date.now() >= deadline) throw new Error(`asset job ${job.id} timed out`);
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250));
    const response = await fetcher(serviceUrl(options.service, `/asset-jobs/${encodeURIComponent(job.id)}`), { headers: requestHeaders(options.token) });
    if (!response.ok) throw new Error(`asset service job poll failed (${response.status}): ${await response.text()}`);
    current = assetJobSchema.parse(await response.json());
  }
  if (current.status === "failed") throw new Error(current.error ?? `asset job ${job.id} failed`);
  return current;
}
