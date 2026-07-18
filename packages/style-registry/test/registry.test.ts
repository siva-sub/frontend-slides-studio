import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  layoutProfileSchema,
  recipeSchema,
  styleProfileSchema,
  type LayoutProfile,
  type Recipe,
} from "@slides-studio/protocol";

import {
  REGISTRY_META,
  allRecipeRecords,
  allStyleProfiles,
  generateStyleBrowserHtml,
  inspectLayout,
  inspectStyle,
  listRecipes,
  listStyles,
  mediaCapacity,
  mediaFitScore,
  normalizeLayoutProps,
  queryLayouts,
  requiredMediaFor,
  scaffoldRecipe,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(__dirname, "..", "src", "generated");

const STYLES = allStyleProfiles();
const LAYOUTS: LayoutProfile[] = (() => {
  const out: LayoutProfile[] = [];
  for (const style of STYLES) out.push(...inspectStyle(style.id).layouts);
  return out;
})();
const RECIPES: readonly Recipe[] = allRecipeRecords();

describe("registry counts and shape", () => {
  it("registers exactly 32 styles, 256 layouts, 6 recipes", () => {
    expect(listStyles()).toHaveLength(32);
    expect(LAYOUTS).toHaveLength(256);
    expect(REGISTRY_META.styleCount).toBe(32);
    expect(REGISTRY_META.layoutCount).toBe(256);
    expect(REGISTRY_META.recipeCount).toBe(6);
    expect(REGISTRY_META.sidecarVersion).toBe("2");
    expect(REGISTRY_META.sourceRepository).toBe("https://github.com/JuneYaooo/gpt-image2-ppt-skills");
    expect(REGISTRY_META.sourceCommit).toBe("ce4714225d938b02806af3660a46e62be8900e29");
    expect(REGISTRY_META.license).toBe("Apache-2.0");
    expect(REGISTRY_META.manifestPath).toBe("resources/gpt-image2-ppt-skills/MANIFEST.json");
    expect(listRecipes()).toHaveLength(6);
  });

  it("gives every style exactly 8 layouts", () => {
    for (const summary of listStyles()) {
      expect(summary.layoutCount).toBe(8);
    }
  });

  it("uses compound ${styleId}/${layoutId} layout ids that are globally unique", () => {
    const ids = LAYOUTS.map((layout) => layout.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    }
  });

  it("handles the long Unicode-name slug end to end", () => {
    const longSlug =
      "health-disparities-and-social-determinants-of-health-doctor-of-philosophy-phd-in-health-behavior-and-health-education";
    expect(longSlug.length).toBeGreaterThan(100);
    const detail = inspectStyle(longSlug);
    expect(detail.layouts).toHaveLength(8);
    const first = detail.layouts[0]!;
    expect(inspectLayout(first.id).id).toBe(first.id);
    // Compound layout id carries the long slug as the style segment.
    expect(first.id.startsWith(`${longSlug}/`)).toBe(true);
  });

  it("re-validates every generated record against the protocol schemas", () => {
    for (const style of STYLES) expect(() => styleProfileSchema.parse(style)).not.toThrow();
    for (const layout of LAYOUTS) expect(() => layoutProfileSchema.parse(layout)).not.toThrow();
    for (const recipe of RECIPES) expect(() => recipeSchema.parse(recipe)).not.toThrow();
  });

  it("preserves raw upstream prompt text and lossless json schema / content capacity", () => {
    const swiss = inspectStyle("swiss-grid").style;
    expect(swiss.promptGuidance).toContain("瑞士");
    const layout = inspectLayout("swiss-grid/data-visual-callouts");
    const schema = layout.schema as { jsonSchema?: { properties?: Record<string, unknown> }; contentCapacity?: Record<string, string> };
    expect(schema.jsonSchema?.properties?.["metrics"]).toBeDefined();
    expect(schema.contentCapacity?.["metrics"]).toContain("指标");
  });
});

describe("candidate media regions + asset-aware query", () => {
  it("derives real candidate media slots for media-bearing layouts (not all, not none)", () => {
    const withMedia = LAYOUTS.filter((l) => l.slots.length > 0);
    expect(withMedia.length).toBeGreaterThan(0);
    expect(withMedia.length).toBeLessThan(LAYOUTS.length);
    // At least most visual styles expose media-capable candidates.
    const stylesWithMedia = new Set(withMedia.map((l) => l.styleId));
    expect(stylesWithMedia.size).toBeGreaterThanOrEqual(20);
  });

  it("records kinds / maxCount / fit / empty behavior / overlap groups for media slots", () => {
    const cover = inspectLayout("eco-green-business-plan/cover-split-natural-photo");
    expect(cover.slots).toHaveLength(1);
    const slot = cover.slots[0]!;
    expect(slot.acceptedKinds).toEqual(["image", "video"]);
    expect(slot.maxCount).toBe(1);
    expect(slot.fit).toBe("cover");
    expect(slot.emptyBehavior).toBe("placeholder");
    expect(cover.allowedOverlapGroups).toContain("media");
  });

  it("keeps explicitly anti-image styles (swiss-grid) free of media slots", () => {
    for (const layout of inspectStyle("swiss-grid").layouts) {
      expect(layout.slots).toHaveLength(0);
    }
  });

  it("media slot regions never overlap their protected text regions", () => {
    for (const layout of LAYOUTS) {
      for (const slot of layout.slots) {
        for (const r of layout.protectedTextRegions) {
          const s = slot.region;
          const overlap = s.x < r.x + r.width && s.x + s.width > r.x && s.y < r.y + r.height && s.y + s.height > r.y;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("preserves the raw upstream external_image_slots unchanged in the schema bag", () => {
    for (const layout of LAYOUTS) {
      const schema = layout.schema as { externalImageSlots?: unknown[] };
      expect(Array.isArray(schema.externalImageSlots)).toBe(true);
    }
  });

  it("returns media-capable layouts for a needsMedia query and rejects insufficient counts", () => {
    const capable = queryLayouts({ needsMedia: 1 });
    expect(capable.length).toBeGreaterThan(0);
    for (const layout of capable) expect(mediaCapacity(layout)).toBeGreaterThanOrEqual(1);
    // Max declared capacity per layout is 1, so requiring 2 rejects everything.
    expect(queryLayouts({ needsMedia: 2 })).toEqual([]);
    // Required media is max(needsMedia, suppliedAssets.length).
    expect(queryLayouts({ suppliedAssets: [{}, {}] })).toEqual([]);
  });

  it("never leaks an insufficient-capacity result", () => {
    const queries = [
      { needsMedia: 1 },
      { needsMedia: 1, suppliedAssets: [{}] },
      { suppliedAssets: [{}, {}, {}] },
    ];
    for (const q of queries) {
      const req = requiredMediaFor(q);
      for (const layout of queryLayouts(q)) expect(mediaCapacity(layout)).toBeGreaterThanOrEqual(req);
    }
  });

  it("ranks media layouts by supplied aspect ratio and detail deterministically", () => {
    const ecoCover = inspectLayout("eco-green-business-plan/cover-split-natural-photo"); // portrait slot
    const ecoQuote = inspectLayout("eco-green-business-plan/quote-image-banner-serif"); // landscape banner
    // Portrait asset favors the portrait cover slot; landscape favors the banner.
    expect(mediaFitScore(ecoCover, [{ aspect: 0.56 }])).toBeGreaterThan(mediaFitScore(ecoQuote, [{ aspect: 0.56 }]));
    expect(mediaFitScore(ecoQuote, [{ aspect: 3 }])).toBeGreaterThan(mediaFitScore(ecoCover, [{ aspect: 3 }]));
    // High detail rewards a large cover slot.
    expect(mediaFitScore(ecoCover, [{ detail: "high" }])).toBeGreaterThan(0);
    // Query ordering reflects aspect and changes deterministically.
    const portrait = queryLayouts({ needsMedia: 1, suppliedAssets: [{ aspect: 0.56 }], seed: "z" }).map((l) => l.id);
    const landscape = queryLayouts({ needsMedia: 1, suppliedAssets: [{ aspect: 3 }], seed: "z" }).map((l) => l.id);
    expect(portrait).not.toEqual(landscape);
    expect(portrait.indexOf(ecoCover.id)).toBeLessThan(portrait.indexOf(ecoQuote.id));
    expect(landscape.indexOf(ecoQuote.id)).toBeLessThan(landscape.indexOf(ecoCover.id));
  });
});

describe("deterministic query + reuse penalty", () => {
  it("is deterministic for a fixed seed", () => {
    const a = queryLayouts({ role: "content", seed: "deck-1" }).map((l) => l.id);
    const b = queryLayouts({ role: "content", seed: "deck-1" }).map((l) => l.id);
    expect(a).toEqual(b);
  });

  it("penalizes already-used layouts (singleton > shared)", () => {
    const first = queryLayouts({ styleId: "swiss-grid", role: "content", seed: "s" });
    expect(first.length).toBeGreaterThan(0);
    const usedId = first[0]!.id;
    const withUsed = queryLayouts({ styleId: "swiss-grid", role: "content", seed: "s", used: [usedId] });
    // The used layout is demoted below at least one fresh alternative.
    expect(withUsed[0]!.id).not.toBe(usedId);
    expect(withUsed.find((l) => l.id === usedId)).toBeDefined();
  });

  it("does not crash when many supplied assets exceed any layout capacity", () => {
    // required media becomes > max slot count, so results are empty but stable.
    const many = queryLayouts({ role: "content", suppliedAssets: Array.from({ length: 20 }, () => ({})), seed: "x" });
    expect(many).toEqual([]);
  });
});

describe("recipe scaffolding", () => {
  it("scaffolds every recipe to a stable DeckGoal skeleton", () => {
    for (const summary of listRecipes()) {
      const deck = scaffoldRecipe(summary.id, "seed-42");
      expect(deck.schemaVersion).toBe(1);
      expect(deck.slides.length).toBe(summary.slideCount);
      expect(deck.theme).toBe(summary.recommendedStyleId);
      // Stable ids for a fixed seed.
      const again = scaffoldRecipe(summary.id, "seed-42");
      expect(again.id).toBe(deck.id);
      expect(again.slides.map((s) => s.id)).toEqual(deck.slides.map((s) => s.id));
      // Every slide has a selected compound layout id.
      for (const slide of deck.slides) {
        expect(typeof slide.layout).toBe("string");
        expect(slide.layout).toMatch(/\//);
      }
    }
  });

  it("selects different layouts for repeated roles within a deck when available", () => {
    // investor-pitch has multiple content slides; clean-tech-blue has 2 content layouts.
    const deck = scaffoldRecipe("investor-pitch", "rotate");
    const contentLayouts = new Set(
      deck.slides.filter((s) => s.role === "content").map((s) => s.layout),
    );
    expect(contentLayouts.size).toBeGreaterThan(1);
  });

  it("throws on an unknown recipe", () => {
    expect(() => scaffoldRecipe("nope", "1")).toThrow(/Unknown recipe/);
  });
});

describe("safe prop normalization", () => {
  it("normalizes and trims props against the embedded json-schema subset", () => {
    const result = normalizeLayoutProps("swiss-grid/agenda-structured-overview", {
      title: "  Agenda  ",
      items: [{ name: " A ", description: "desc" }, { name: "B" }, { name: "C" }],
    });
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect((result.props as { title: string }).title).toBe("Agenda");
  });

  it("reports required + maxLength + unknown-property errors", () => {
    const missing = normalizeLayoutProps("swiss-grid/cover-hero-composition", { subtitle: "x" });
    expect(missing.issues.some((i) => i.message.includes("Required"))).toBe(true);

    const tooLong = normalizeLayoutProps("swiss-grid/cover-hero-composition", {
      title: "x".repeat(60),
    });
    expect(tooLong.issues.some((i) => i.message.includes("maxLength"))).toBe(true);

    const unknown = normalizeLayoutProps("swiss-grid/cover-hero-composition", {
      title: "ok",
      bogus: 1,
    });
    expect(unknown.issues.some((i) => i.message.includes("Unknown property"))).toBe(true);
    // additionalProperties:false drops the unknown key from sanitized props.
    expect("bogus" in unknown.props).toBe(false);
  });

  it("rejects unsafe and placeholder copy", () => {
    const unsafe = normalizeLayoutProps("swiss-grid/cover-hero-composition", {
      title: "<script>alert(1)</script>",
    });
    expect(unsafe.issues.some((i) => /Unsafe/.test(i.message))).toBe(true);
    const placeholder = normalizeLayoutProps("swiss-grid/cover-hero-composition", {
      title: "{{todo}}",
    });
    expect(placeholder.issues.some((i) => /Placeholder/.test(i.message))).toBe(true);
  });
});

describe("style browser html", () => {
  it("emits 32 style cards with layout metadata and no images", () => {
    const html = generateStyleBrowserHtml();
    expect(html).toContain("<!doctype html>");
    // 32 card sections.
    expect(html.match(/<section class="card"/g)).toHaveLength(32);
    // No image/binary references.
    expect(/\.(png|jpe?g|gif|webp|bmp|svg)\b/i.test(html)).toBe(false);
    // Contains a compound layout id.
    expect(html).toContain("swiss-grid/data-visual-callouts");
  });
});

describe("browser-safe generated data", () => {
  it("generated modules import no node:fs and use no require()", async () => {
    const files = ["styles.ts", "recipes.ts", "meta.ts"];
    for (const file of files) {
      const source = await readFile(join(GEN_DIR, file), "utf8");
      expect(source).not.toMatch(/import\s+.*node:fs/);
      expect(source).not.toMatch(/from\s+["']node:/);
      expect(source).not.toMatch(/\brequire\s*\(/);
    }
  });
});
