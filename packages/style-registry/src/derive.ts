// Pure derivation helpers: role coercion + original deterministic candidate
// media-region and protected-text-region derivation from upstream layout
// semantics. Browser-safe (no zod, no filesystem access).
//
// Candidate media slots are derived ONLY for layouts whose declared semantics
// describe an image/photo/illustration region (cover/section/content/quote).
// The raw upstream `external_image_slots` declaration is preserved unchanged in
// the layout `schema` bag; these candidate slots are original normalized
// metadata, not a copy of upstream geometry.

import type { LayoutSlot, NormalizedRect, SlideRole } from "@slides-studio/protocol";

export const SLIDE_ROLES: readonly SlideRole[] = [
  "cover", "agenda", "section", "content", "comparison", "data", "diagram", "quote", "closing", "other",
];
const ROLE_SET = new Set<string>(SLIDE_ROLES);

export function isSlideRole(token: string): token is SlideRole {
  return ROLE_SET.has(token);
}

// Synonym map from loose upstream suitability tokens to canonical SlideRoles.
const ROLE_SYNONYMS: Record<string, SlideRole> = {
  comparison: "comparison",
  "before after": "comparison",
  "before/after": "comparison",
  tradeoff: "comparison",
  "two options": "comparison",
  "feature list": "content",
  "structured explanation": "content",
  "chapter list": "agenda",
  overview: "agenda",
  "thank you": "closing",
  contact: "closing",
  "next step": "closing",
  summary: "closing",
  "chapter divider": "section",
  "major transition": "section",
  chapter: "section",
  divider: "section",
  "key insight": "quote",
  "transition statement": "quote",
  statement: "quote",
  "large-text": "quote",
  metrics: "data",
  "comparison numbers": "data",
  chart: "data",
};

export function coerceRoles(tokens: readonly string[] | undefined): SlideRole[] {
  if (!tokens) return [];
  const out: SlideRole[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    const mapped = ROLE_SYNONYMS[token] ?? (ROLE_SET.has(token) ? (token as SlideRole) : undefined);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media-term detection (English + Chinese). Matches the explicit media kinds
// called out by the resource semantics. Bare "图" is intentionally avoided to
// prevent false positives on common characters; specific compounds are used.
// ---------------------------------------------------------------------------

const MEDIA_TERM_RE =
  /image|photo|portrait|illustration|product[\s-]?shot|screenshot|\b3d\b|media|照片|摄影|图片|插图|插画|产品图|截图|肖像|实物|材质|素材|配图|视觉主图|相框/i;

const SHAPE_BANNER_RE = /banner|横幅|band/i;

export type MediaShape = "split" | "banner";

export interface MediaDetection {
  bearing: boolean;
  shape: MediaShape | null;
}

/**
 * Detect whether a layout declares a media region from its role/id/summary/
 * visual_signature/variation/best-for text. Returns the bearing flag plus a
 * deterministic shape hint (split side-panel vs top banner).
 */
export function detectMedia(
  role: SlideRole,
  textBlob: string,
): MediaDetection {
  const bearing = MEDIA_TERM_RE.test(textBlob);
  if (!bearing) return { bearing: false, shape: null };
  // Banner shape is quote-specific; otherwise default to a split side panel.
  const shape: MediaShape = SHAPE_BANNER_RE.test(textBlob) || role === "quote" ? "banner" : "split";
  return { bearing: true, shape };
}

// Roles eligible for derived candidate media regions.
const MEDIA_ELIGIBLE_ROLES: ReadonlySet<SlideRole> = new Set(["cover", "section", "content", "quote"]);

// Deterministic candidate media slot per eligible role. Regions are normalized
// 0..1, stay within the unit box, and never overlap that role's protected text.
interface MediaGeometry {
  slot: LayoutSlot;
  protectedText: NormalizedRect[];
}

function slot(
  id: string,
  region: NormalizedRect,
  acceptedKinds: string[],
  fit: "contain" | "cover",
  emptyBehavior: "collapse" | "placeholder" | "keep",
): LayoutSlot {
  return { id, region, acceptedKinds, maxCount: 1, fit, emptyBehavior };
}

function mediaGeometryForRole(role: SlideRole): MediaGeometry | null {
  switch (role) {
    case "cover":
      return {
        slot: slot("media-cover", { x: 0.55, y: 0.12, width: 0.39, height: 0.7 }, ["image", "video"], "cover", "placeholder"),
        protectedText: [
          { x: 0.06, y: 0.1, width: 0.42, height: 0.1 },
          { x: 0.06, y: 0.54, width: 0.44, height: 0.32 },
        ],
      };
    case "section":
      return {
        slot: slot("media-section", { x: 0.56, y: 0.16, width: 0.38, height: 0.64 }, ["image", "video"], "cover", "placeholder"),
        protectedText: [
          { x: 0.06, y: 0.1, width: 0.42, height: 0.1 },
          { x: 0.06, y: 0.3, width: 0.44, height: 0.5 },
        ],
      };
    case "content":
      return {
        slot: slot("media-content", { x: 0.62, y: 0.22, width: 0.32, height: 0.56 }, ["image"], "cover", "collapse"),
        protectedText: [
          { x: 0.06, y: 0.1, width: 0.5, height: 0.1 },
          { x: 0.06, y: 0.26, width: 0.5, height: 0.58 },
        ],
      };
    case "quote":
      return {
        slot: slot("media-quote", { x: 0.06, y: 0.1, width: 0.88, height: 0.3 }, ["image"], "cover", "collapse"),
        protectedText: [{ x: 0.1, y: 0.46, width: 0.8, height: 0.36 }],
      };
    default:
      return null;
  }
}

/**
 * Derive original candidate media slots for a layout. Returns at most one slot
 * for media-bearing cover/section/content/quote layouts; otherwise []. This is
 * normalized metadata derived from semantics — the raw upstream
 * external_image_slots declaration is preserved separately in the schema bag.
 */
export function deriveCandidateMediaSlots(
  role: SlideRole,
  textBlob: string,
): { slots: LayoutSlot[]; protectedTextRegions: NormalizedRect[]; allowedOverlapGroups: string[] } {
  if (!MEDIA_ELIGIBLE_ROLES.has(role)) {
    return { slots: [], protectedTextRegions: [], allowedOverlapGroups: [] };
  }
  const detection = detectMedia(role, textBlob);
  if (!detection.bearing) {
    return { slots: [], protectedTextRegions: [], allowedOverlapGroups: [] };
  }
  const geometry = mediaGeometryForRole(role);
  if (!geometry) {
    return { slots: [], protectedTextRegions: [], allowedOverlapGroups: [] };
  }
  return {
    slots: [geometry.slot],
    protectedTextRegions: geometry.protectedText,
    allowedOverlapGroups: ["media"],
  };
}

// ---------------------------------------------------------------------------
// Protected text regions for non-media (text-only) layouts, by role + fields.
// ---------------------------------------------------------------------------

function hasField(fields: readonly string[], name: string): boolean {
  return fields.some((f) => f === name || f.startsWith(name));
}

export function deriveProtectedTextRegions(role: SlideRole, fields: readonly string[]): NormalizedRect[] {
  const rects: NormalizedRect[] = [];
  if (hasField(fields, "title") || hasField(fields, "section_number")) {
    rects.push({ x: 0.06, y: 0.08, width: 0.88, height: 0.12 });
  }
  switch (role) {
    case "cover":
      rects.push({ x: 0.06, y: 0.5, width: 0.7, height: 0.36 });
      break;
    case "quote":
      rects.push({ x: 0.1, y: 0.28, width: 0.8, height: 0.4 });
      break;
    case "content":
    case "comparison":
    case "data":
      rects.push({ x: 0.06, y: 0.26, width: 0.88, height: 0.6 });
      break;
    case "agenda":
    case "section":
      rects.push({ x: 0.06, y: 0.26, width: 0.88, height: 0.58 });
      break;
    case "closing":
      rects.push({ x: 0.06, y: 0.34, width: 0.88, height: 0.46 });
      break;
    default:
      if (!hasField(fields, "title")) rects.push({ x: 0.06, y: 0.26, width: 0.88, height: 0.6 });
  }
  return rects;
}
