// Deterministic layout query + scoring. Browser-safe (no filesystem access).
//
// Query scoring accounts for: page role, visible content capacity, required
// media count, supplied asset aspect/detail, reuse policy + already-used layouts,
// and a stable seed. The required media count is max(needsMedia, supplied asset
// count); layouts with fewer declared slots are filtered out so insufficient
// media capacity never leaks into results.

import type { LayoutProfile } from "@slides-studio/protocol";

import { LAYOUTS } from "./generated/styles.js";
import type { LayoutQuery, SuppliedAsset } from "./types.js";

/** Stable FNV-1a 32-bit hash of a string. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/** Declared visible media capacity = number of declared layout slots. */
export function mediaCapacity(layout: LayoutProfile): number {
  return layout.slots.length;
}

/** The effective required media count for a query. */
export function requiredMediaFor(query: LayoutQuery): number {
  return Math.max(query.needsMedia ?? 0, query.suppliedAssets?.length ?? 0);
}

// Reuse penalties are intentionally dominant: they exceed the full role /
// capacity score range so that a used layout is always demoted below fresh
// alternatives, while still ranking reuse policies (singleton > unique > shared).
function reusePenalty(policy: LayoutProfile["reuse"]["policy"]): number {
  switch (policy) {
    case "singleton":
      return 10000;
    case "unique":
      return 3000;
    case "shared":
      return 1000;
    default:
      return 1000;
  }
}

/**
 * Media-fit scoring term. Scores supplied-asset aspect ratios against the actual
 * slot region aspect ratio, and rewards high-detail assets that match a large
 * cover-crop slot. Deterministic; 0 when no slots or no supplied assets.
 */
export function mediaFitScore(layout: LayoutProfile, supplied: SuppliedAsset[]): number {
  if (layout.slots.length === 0 || supplied.length === 0) return 0;
  let term = 0;
  const slot = layout.slots[0]!;
  const canvasAspect = layout.canvas.width / layout.canvas.height;
  const slotAspect = (slot.region.width * canvasAspect) / slot.region.height;
  for (const asset of supplied) {
    if (asset.aspect !== undefined && slotAspect > 0 && Number.isFinite(asset.aspect)) {
      // Closeness in [0,1]: 1 = perfect aspect match.
      const ratio = asset.aspect / slotAspect;
      const closeness = ratio >= 1 ? 1 / ratio : ratio;
      term += closeness * 6;
    }
  }
  if (supplied.some((asset) => asset.detail === "high")) {
    if (slot.fit === "cover") term += 4;
    if (slot.region.width * slot.region.height >= 0.25) term += 2;
  }
  return term;
}

/**
 * Score a candidate layout for a query. Higher is better. Pure & deterministic.
 */
export function scoreLayout(layout: LayoutProfile, query: LayoutQuery): number {
  let score = 0;

  // Page role suitability.
  if (query.role) {
    if (layout.suitability.best.includes(query.role)) score += 30;
    if (layout.suitability.avoid.includes(query.role)) score -= 40;
  }

  // Visible content capacity vs supplied asset count.
  const suppliedCount = query.suppliedAssets?.length;
  if (suppliedCount !== undefined) {
    if (layout.capacity >= suppliedCount) score += 12;
    else score -= 18;
  }

  // Media aspect/detail fit against actual slot geometry.
  score += mediaFitScore(layout, query.suppliedAssets ?? []);

  // Reuse penalty: already-used layouts are demoted by policy.
  if (query.used && query.used.includes(layout.id)) {
    score -= reusePenalty(layout.reuse.policy);
  }

  return score;
}

/**
 * Query the layout registry. Results are filtered (style/role/media capacity)
 * then sorted by score with a stable seed tiebreak. The required media count is
 * max(needsMedia, suppliedAssets.length); layouts with fewer slots are never
 * returned, so no insufficient-capacity result leaks.
 */
export function queryLayouts(query: LayoutQuery = {}): LayoutProfile[] {
  const seedHash = hashSeed(query.seed ?? "style-registry");
  const requiredMedia = requiredMediaFor(query);

  const candidates = LAYOUTS.filter((layout) => {
    if (query.styleId !== undefined && layout.styleId !== query.styleId) return false;
    if (query.role !== undefined && layout.role !== query.role) return false;
    if (requiredMedia > 0 && mediaCapacity(layout) < requiredMedia) return false;
    return true;
  });

  const sorted = [...candidates].sort((left, right) => {
    const delta = scoreLayout(right, query) - scoreLayout(left, query);
    if (delta !== 0) return delta;
    return (hashSeed(left.id) ^ seedHash) - (hashSeed(right.id) ^ seedHash);
  });

  return query.limit !== undefined ? sorted.slice(0, query.limit) : sorted;
}
