import { describe, expect, it } from "vitest";

import {
  parseUpstreamPlanMarkdown,
  parseUpstreamRecipeMarkdown,
  parseUpstreamSidecar,
  upstreamSidecarSchema,
} from "../scripts/upstream.js";

function layout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cover-x",
    page_type: "cover",
    summary: "summary",
    visual_signature: "visual",
    content_capacity: { title: "t" },
    best_for: ["cover"],
    avoid_for: [],
    variation_tags: ["cover"],
    external_image_slots: [],
    reuse_friendly: true,
    reuse_reason: "reason",
    json_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    ...overrides,
  };
}

function sidecar(layouts: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "2",
    style_id: "demo-style",
    style_name: "Demo Style",
    global_style: "global",
    theme: {},
    layouts,
    ...overrides,
  });
}

const VALID_8 = Array.from({ length: 8 }, () => layout());

describe("upstream sidecar validation (no casts)", () => {
  it("accepts a well-formed sidecar with exactly 8 layouts", () => {
    const parsed = parseUpstreamSidecar(sidecar(VALID_8), "demo.layouts.json");
    expect(parsed.version).toBe("2");
    expect(parsed.layouts).toHaveLength(8);
    expect(parsed.style_id).toBe("demo-style");
  });

  it("rejects an invalid version", () => {
    expect(() => parseUpstreamSidecar(sidecar(VALID_8, { version: "1" }), "v")).toThrow();
    expect(() => parseUpstreamSidecar(sidecar(VALID_8, { version: 2 }), "v")).toThrow();
  });

  it("rejects the wrong layout count", () => {
    expect(() => parseUpstreamSidecar(sidecar(VALID_8.slice(0, 7)), "v")).toThrow();
    expect(() => parseUpstreamSidecar(sidecar([...VALID_8, layout()]), "v")).toThrow();
  });

  it("rejects a layout missing a required field", () => {
    const bad = VALID_8.map((l, i) => (i === 0 ? { ...l, json_schema: undefined } : l));
    expect(() => parseUpstreamSidecar(sidecar(bad), "v")).toThrow();
  });

  it("rejects malformed JSON", () => {
    expect(() => parseUpstreamSidecar("{ not json", "v")).toThrow(/not valid JSON/);
  });

  it("rejects an unknown extra top-level key only via strictness is permissive (theme is a record)", () => {
    // theme is a permissive record; an extra theme key must not break parsing.
    const parsed = parseUpstreamSidecar(sidecar(VALID_8, { theme: { primary: "#fff", fonts: { title: "serif" } } }), "v");
    expect(parsed.theme).toBeDefined();
  });

  it("schema object is exported and usable directly", () => {
    expect(() => upstreamSidecarSchema.parse(JSON.parse(sidecar(VALID_8)))).not.toThrow();
  });
});

describe("upstream plan markdown validation", () => {
  const VALID_PLAN = `---
title: Demo
scenario: demo
recommended_style: clean-tech-blue
---

## 1. [cover] Hello
body

## 2. [content] World
more body
`;

  it("parses a well-formed plan", () => {
    const plan = parseUpstreamPlanMarkdown(VALID_PLAN, "demo");
    expect(plan.slides).toHaveLength(2);
    expect(plan.slides[0]!.role).toBe("cover");
    expect(plan.recommendedStyleId).toBe("clean-tech-blue");
  });

  it("rejects a plan with no slides", () => {
    expect(() => parseUpstreamPlanMarkdown("---\ntitle: x\n---\n\nno slides here\n", "demo")).toThrow(/no.*slides/i);
  });

  it("rejects an unrecognized role", () => {
    const bad = "## 1. [timeline] Bad role\nbody\n";
    expect(() => parseUpstreamPlanMarkdown(bad, "demo")).toThrow(/unrecognized role/i);
  });

  it("rejects a duplicate slide index", () => {
    const bad = "## 1. [cover] A\nx\n\n## 1. [content] B\ny\n";
    expect(() => parseUpstreamPlanMarkdown(bad, "demo")).toThrow(/duplicate slide index/i);
  });
});

describe("upstream recipe markdown validation", () => {
  it("parses a well-formed recipe with a recommended style", () => {
    const md = "# Demo Recipe / 示例\n\nProse.\n\n推荐风格：`clean-tech-blue`\n";
    const recipe = parseUpstreamRecipeMarkdown(md, "demo");
    expect(recipe.name).toBe("Demo Recipe / 示例");
    expect(recipe.recommendedStyleId).toBe("clean-tech-blue");
  });

  it("rejects a recipe with no H1 title", () => {
    expect(() => parseUpstreamRecipeMarkdown("just prose, no heading", "demo")).toThrow(/H1 title/i);
  });
});
