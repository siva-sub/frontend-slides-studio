/**
 * Explicit Zod schemas + type-guarded parsers for the upstream Apache-2.0
 * resource shapes. Used by the build-time generator so sidecars/recipes are
 * validated BEFORE normalization — never cast with `as`. Build/test only.
 */
import { z } from "zod";

import type { SlideRole } from "@slides-studio/protocol";
import { isSlideRole } from "../src/derive.js";

// ---------------------------------------------------------------------------
// Sidecar JSON schemas
// ---------------------------------------------------------------------------

export const upstreamLayoutSchema = z.object({
  id: z.string().min(1),
  page_type: z.string().min(1),
  summary: z.string(),
  visual_signature: z.string(),
  content_capacity: z.record(z.string()),
  best_for: z.array(z.string()),
  avoid_for: z.array(z.string()),
  variation_tags: z.array(z.string()),
  external_image_slots: z.array(z.unknown()).optional(),
  reuse_friendly: z.boolean(),
  reuse_reason: z.string(),
  json_schema: z.record(z.unknown()),
});

export const upstreamSidecarSchema = z.object({
  version: z.literal("2"),
  style_id: z.string().min(1),
  style_name: z.string().min(1),
  global_style: z.string(),
  theme: z.record(z.unknown()),
  layouts: z.array(upstreamLayoutSchema).length(8),
});

export type UpstreamLayout = z.infer<typeof upstreamLayoutSchema>;
export type UpstreamSidecar = z.infer<typeof upstreamSidecarSchema>;

/** Parse + validate a sidecar JSON string. Throws on any shape violation. */
export function parseUpstreamSidecar(text: string, source: string): UpstreamSidecar {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Sidecar ${source} is not valid JSON: ${(error as Error).message}`);
  }
  return upstreamSidecarSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Recipe / plan markdown parsers (with type guards)
// ---------------------------------------------------------------------------

export interface ParsedPlanSlide {
  index: number;
  role: SlideRole;
  title: string;
  body: string;
}

export interface ParsedPlan {
  title: string;
  scenario: string;
  recommendedStyleId: string;
  slides: ParsedPlanSlide[];
}

const PLAN_HEADER_RE = /^##\s+(\d+)\.\s*\[([^\]]+)\]\s*(.*)$/;

function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  let body = text;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match) {
    for (const line of match[1]!.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = text.slice(match[0].length);
  }
  return { frontmatter: fm, body };
}

/**
 * Parse a slides_plan.md into a guarded plan. Throws if the structure is
 * malformed: no slides, an unrecognized role, or duplicate/non-integer indices.
 */
export function parseUpstreamPlanMarkdown(markdown: string, source: string): ParsedPlan {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const slides: ParsedPlanSlide[] = [];
  let current: ParsedPlanSlide | null = null;
  const buffer: string[] = [];
  const flush = (): void => {
    if (current) {
      current.body = buffer.join("\n").trim();
      slides.push(current);
    }
  };
  for (const line of lines) {
    const m = PLAN_HEADER_RE.exec(line);
    if (m) {
      flush();
      buffer.length = 0;
      const index = Number(m[1]);
      if (!Number.isInteger(index) || index < 1) {
        throw new Error(`Plan ${source} has an invalid slide index: ${m[1]}`);
      }
      const roleToken = m[2]!.trim().toLowerCase();
      if (!isSlideRole(roleToken)) {
        throw new Error(`Plan ${source} slide ${index} has an unrecognized role: ${m[2]}`);
      }
      current = { index, role: roleToken, title: m[3]!.trim(), body: "" };
    } else if (current) {
      buffer.push(line);
    }
  }
  flush();
  if (slides.length === 0) {
    throw new Error(`Plan ${source} contains no \`## N. [role] title\` slides`);
  }
  const indices = new Set<number>();
  for (const slide of slides) {
    if (indices.has(slide.index)) throw new Error(`Plan ${source} has a duplicate slide index: ${slide.index}`);
    indices.add(slide.index);
  }
  return {
    title: frontmatter.title ?? "",
    scenario: frontmatter.scenario ?? "",
    recommendedStyleId: frontmatter.recommended_style ?? "",
    slides,
  };
}

export interface ParsedRecipeMarkdown {
  name: string;
  recommendedStyleId: string;
  description: string;
  warnings: string[];
}

/** Parse a recipe.md. Throws if no H1 title can be derived. */
export function parseUpstreamRecipeMarkdown(markdown: string, source: string): ParsedRecipeMarkdown {
  const lines = markdown.split(/\r?\n/);
  let name = "";
  let recommendedStyleId = "";
  const descriptionLines: string[] = [];
  const warnings: string[] = [];
  let inWarnings = false;
  for (const line of lines) {
    if (line.startsWith("# ") && !name) {
      name = line.slice(2).trim();
      continue;
    }
    const styleMatch = /推荐风格[：:]\s*`([^`]+)`/.exec(line);
    if (styleMatch) {
      recommendedStyleId = styleMatch[1]!.trim();
      continue;
    }
    if (/^#+\s*(注意|注意事项|Notes?|Cautions?)/i.test(line)) {
      inWarnings = true;
      continue;
    }
    if (line.trim().startsWith("```")) {
      inWarnings = false;
      continue;
    }
    if (inWarnings) {
      const bullet = line.replace(/^\s*[-*]\s*/, "").trim();
      if (bullet) warnings.push(bullet);
      continue;
    }
    descriptionLines.push(line);
  }
  if (!name) throw new Error(`Recipe ${source} is missing an H1 title`);
  const description = descriptionLines.join("\n").replace(/```[\s\S]*?```/g, "").trim();
  return { name, recommendedStyleId, description, warnings };
}
