/**
 * Build-time generator for @slides-studio/style-registry.
 *
 * Runs under Node/tsx ONLY at generation time. Reads the licensed Apache-2.0
 * resources under resources/gpt-image2-ppt-skills/, validates sidecars/recipes
 * with explicit Zod schemas + type guards (never `as`-cast), normalizes them
 * into the protocol StyleProfile/LayoutProfile/Recipe contracts, and writes
 * browser-safe generated TypeScript into src/generated/.
 *
 *   pnpm --filter @slides-studio/style-registry generate           # write
 *   pnpm --filter @slides-studio/style-registry generate -- --check # compare, no write
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  layoutProfileSchema,
  recipeSchema,
  styleProfileSchema,
  type DeckGoalV1,
  type LayoutProfile,
  type Recipe,
  type SlideRole,
  type StyleProfile,
} from "@slides-studio/protocol";

import {
  coerceRoles,
  deriveCandidateMediaSlots,
  deriveProtectedTextRegions,
  isSlideRole,
} from "../src/derive.js";
import {
  parseUpstreamPlanMarkdown,
  parseUpstreamRecipeMarkdown,
  parseUpstreamSidecar,
  type ParsedPlan,
  type ParsedPlanSlide,
  type UpstreamSidecar,
} from "./upstream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
const RESOURCES = join(ROOT, "resources", "gpt-image2-ppt-skills");
const OUT_DIR = join(__dirname, "..", "src", "generated");

const SOURCE_REPOSITORY = "https://github.com/JuneYaooo/gpt-image2-ppt-skills";
const SOURCE_COMMIT = "ce4714225d938b02806af3660a46e62be8900e29";

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
function firstHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = HEX_RE.exec(value);
  return m ? m[0] : undefined;
}

// ---------------------------------------------------------------------------
// Normalization: validated sidecar -> StyleProfile + LayoutProfile[]
// ---------------------------------------------------------------------------

function normalizeStyle(sidecar: UpstreamSidecar, promptMarkdown: string): StyleProfile {
  const theme = (sidecar.theme ?? {}) as { primary?: string; accent?: string[]; background?: string; fonts?: { title?: string; body?: string } };
  const accentHex = firstHex(theme.primary) ?? (theme.accent ?? []).map(firstHex).find((v): v is string => !!v);
  const palette: StyleProfile["palette"] = {};
  const paperHex = firstHex(theme.background);
  if (paperHex) palette.paper = paperHex;
  if (accentHex) palette.accent = accentHex;
  const fonts: StyleProfile["fonts"] = {};
  if (theme.fonts?.title) fonts.title = theme.fonts.title;
  if (theme.fonts?.body) fonts.body = theme.fonts.body;

  const profile: StyleProfile = {
    schemaVersion: 1,
    id: sidecar.style_id,
    name: sidecar.style_name,
    palette,
    fonts,
    globalGuidance: sidecar.global_style,
    promptGuidance: promptMarkdown,
    tags: [],
    tokens: { theme, sourceStyleId: sidecar.style_id, sidecarVersion: sidecar.version },
    provenance: {
      source: SOURCE_REPOSITORY,
      sourceId: SOURCE_COMMIT,
      note: "Imported byte-for-byte from the Apache-2.0 upstream resource; see resources/gpt-image2-ppt-skills/MANIFEST.json.",
    },
  };
  return styleProfileSchema.parse(profile);
}

function normalizeLayout(styleId: string, raw: UpstreamSidecar["layouts"][number]): LayoutProfile {
  const role: SlideRole = isSlideRole(raw.page_type) ? raw.page_type : "other";
  const contentFields = Object.keys(raw.content_capacity ?? {});
  const capacity = Math.max(1, contentFields.length);

  // Media-term detection over the layout's declared semantics.
  const textBlob = [raw.visual_signature, raw.summary, ...raw.variation_tags, ...raw.best_for, raw.id].join(" ");
  const media = deriveCandidateMediaSlots(role, textBlob);
  const protectedTextRegions = media.protectedTextRegions.length > 0
    ? media.protectedTextRegions
    : deriveProtectedTextRegions(role, contentFields);

  const profile: LayoutProfile = {
    schemaVersion: 1,
    id: `${styleId}/${raw.id}`,
    styleId,
    name: raw.visual_signature,
    role,
    canvas: { width: 1280, height: 720 },
    visualSignature: raw.visual_signature,
    capacity,
    suitability: { best: coerceRoles(raw.best_for), avoid: coerceRoles(raw.avoid_for) },
    reuse: { policy: raw.reuse_friendly ? "shared" : "singleton", reason: raw.reuse_reason },
    promptGuidance: raw.summary,
    slots: media.slots,
    protectedTextRegions,
    allowedOverlapGroups: media.allowedOverlapGroups,
    // schema carries lossless upstream metadata: the JSON schema (prop
    // normalization), content-capacity prose, variation tags, and the RAW
    // external_image_slots declaration (preserved unchanged for provenance).
    schema: {
      jsonSchema: raw.json_schema,
      contentCapacity: raw.content_capacity,
      variationTags: raw.variation_tags,
      externalImageSlots: raw.external_image_slots ?? [],
    },
  };
  return layoutProfileSchema.parse(profile);
}

// ---------------------------------------------------------------------------
// Recipe normalization (validated parsers)
// ---------------------------------------------------------------------------

type ParsedRecipe = Recipe & {
  frontmatterTitle: string;
  scenario: string;
  planSlides: ParsedPlanSlide[];
  rawRecipeMarkdown: string;
  rawSlidesPlanMarkdown: string;
};

function normalizeRecipe(slug: string, recipeMarkdown: string, planMarkdown: string): { recipe: Recipe; record: ParsedRecipe } {
  const parsedRecipe = parseUpstreamRecipeMarkdown(recipeMarkdown, slug);
  const plan: ParsedPlan = parseUpstreamPlanMarkdown(planMarkdown, slug);
  const recommendedStyleId = plan.recommendedStyleId || parsedRecipe.recommendedStyleId;
  const name = parsedRecipe.name || plan.title || slug;

  const planSlides: ParsedPlanSlide[] = plan.slides.map((slide) => ({
    index: slide.index,
    role: slide.role,
    title: slide.title,
    body: slide.body,
  }));

  const recipe: Recipe = {
    schemaVersion: 1,
    id: slug,
    name,
    recommendedStyleId,
    description: parsedRecipe.description || undefined,
    slideRoles: planSlides.map((s) => s.role),
    planPath: `resources/gpt-image2-ppt-skills/recipes/${slug}/slides_plan.md`,
    warnings: parsedRecipe.warnings,
    provenance: { source: SOURCE_REPOSITORY, note: "Imported byte-for-byte from the Apache-2.0 upstream example; see MANIFEST.json." },
  };
  const validatedRecipe = recipeSchema.parse(recipe);
  return {
    recipe: validatedRecipe,
    record: {
      ...validatedRecipe,
      frontmatterTitle: plan.title,
      scenario: plan.scenario,
      planSlides,
      rawRecipeMarkdown: recipeMarkdown,
      rawSlidesPlanMarkdown: planMarkdown,
    },
  };
}

// ---------------------------------------------------------------------------
// DeckGoal scaffolding (deterministic; mirrors src/scaffold.ts)
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

function selectCompoundLayout(styleId: string, role: SlideRole, seed: string, used: Set<string>, byRole: Map<string, LayoutProfile[]>): string | undefined {
  const all = byRole.get(`${styleId}:${role}`) ?? [];
  const fresh = all.filter((l) => !used.has(l.id));
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) return undefined;
  const seedHash = hashSeed(seed);
  const ordered = [...pool].sort((a, b) => (hashSeed(a.id) ^ seedHash) - (hashSeed(b.id) ^ seedHash));
  return ordered[0]!.id;
}

function scaffoldDeckGoal(record: ParsedRecipe, seed: string, byRole: Map<string, LayoutProfile[]>): DeckGoalV1 {
  const used = new Set<string>();
  const slides = record.planSlides.map((slide) => {
    const layout = selectCompoundLayout(record.recommendedStyleId, slide.role, seed, used, byRole);
    if (layout) used.add(layout);
    return {
      id: `${record.id}-s${String(slide.index).padStart(2, "0")}`,
      renderMode: "html" as const,
      role: slide.role,
      layout,
      props: { title: slide.title },
    };
  });
  return {
    schemaVersion: 1,
    id: `${record.id}-${hashSeed(seed).toString(36)}`,
    title: record.frontmatterTitle || record.name,
    purpose: record.description || undefined,
    theme: record.recommendedStyleId,
    seed,
    slides,
  };
}

// ---------------------------------------------------------------------------
// Output emission (deterministic, no timestamps)
// ---------------------------------------------------------------------------

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 0);
}

interface EmittedFiles {
  "styles.ts": string;
  "recipes.ts": string;
  "meta.ts": string;
}

function buildOutput(styles: StyleProfile[], layouts: LayoutProfile[], recipeRecords: ParsedRecipe[]): EmittedFiles {
  const stylesHeader = `// AUTO-GENERATED by scripts/generate.ts. Do not edit by hand.
// Source: ${SOURCE_REPOSITORY}@${SOURCE_COMMIT} (Apache-2.0), imported byte-for-byte
// under resources/gpt-image2-ppt-skills. Browser-safe: no filesystem access.
import type { LayoutProfile, StyleProfile } from "@slides-studio/protocol";
`;
  const recipesHeader = `// AUTO-GENERATED by scripts/generate.ts. Do not edit by hand.
// Source: ${SOURCE_REPOSITORY}@${SOURCE_COMMIT} (Apache-2.0). Browser-safe: no filesystem access.
import type { Recipe, SlideRole } from "@slides-studio/protocol";

export interface PlanSlide {
  index: number;
  role: SlideRole;
  title: string;
  body: string;
}

export interface RecipeRecord extends Recipe {
  frontmatterTitle: string;
  scenario: string;
  rawRecipeMarkdown: string;
  rawSlidesPlanMarkdown: string;
  planSlides: PlanSlide[];
}
`;
  const meta = {
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    license: "Apache-2.0",
    styleCount: styles.length,
    layoutCount: layouts.length,
    recipeCount: recipeRecords.length,
    sidecarVersion: "2",
    layoutsPerStyle: 8,
    manifestPath: "resources/gpt-image2-ppt-skills/MANIFEST.json",
  };
  return {
    "styles.ts": `${stylesHeader}\nexport const STYLES: readonly StyleProfile[] = ${serialize(styles)};\n\nexport const LAYOUTS: readonly LayoutProfile[] = ${serialize(layouts)};\n`,
    "recipes.ts": `${recipesHeader}\nexport const RECIPES: readonly RecipeRecord[] = ${serialize(recipeRecords)};\n`,
    "meta.ts": `// AUTO-GENERATED by scripts/generate.ts. Do not edit by hand. Browser-safe: no filesystem access.\n\nexport const REGISTRY_META = ${serialize(meta)} as const;\n`,
  };
}

async function main(): Promise<void> {
  const checkOnly = process.argv.slice(2).includes("--check");

  const stylesDir = join(RESOURCES, "styles");
  const recipesDir = join(RESOURCES, "recipes");

  const styleFiles = (await readdir(stylesDir)).filter((f) => f.endsWith(".layouts.json")).sort();
  if (styleFiles.length !== 32) throw new Error(`Expected 32 style sidecars, found ${styleFiles.length}`);

  const styles: StyleProfile[] = [];
  const layouts: LayoutProfile[] = [];

  for (const file of styleFiles) {
    const sidecarPath = join(stylesDir, file);
    const sidecar = parseUpstreamSidecar(await readFile(sidecarPath, "utf8"), file);
    const mdPath = join(stylesDir, file.replace(/\.layouts\.json$/, ".md"));
    const promptMarkdown = await readFile(mdPath, "utf8");
    styles.push(normalizeStyle(sidecar, promptMarkdown));
    for (const rawLayout of sidecar.layouts) {
      layouts.push(normalizeLayout(sidecar.style_id, rawLayout));
    }
  }

  // Compound uniqueness across all 256 layouts.
  const ids = new Set<string>();
  for (const layout of layouts) {
    if (ids.has(layout.id)) throw new Error(`Duplicate compound layout id: ${layout.id}`);
    ids.add(layout.id);
  }
  if (layouts.length !== 256) throw new Error(`Expected 256 layouts, got ${layouts.length}`);

  const recipeSlugs = (await readdir(recipesDir)).filter((f) => !f.startsWith(".")).sort();
  if (recipeSlugs.length !== 6) throw new Error(`Expected 6 recipes, found ${recipeSlugs.length}`);
  const recipes: Recipe[] = [];
  const recipeRecords: ParsedRecipe[] = [];
  for (const slug of recipeSlugs) {
    const recipeMd = await readFile(join(recipesDir, slug, "recipe.md"), "utf8");
    const planMd = await readFile(join(recipesDir, slug, "slides_plan.md"), "utf8");
    const { recipe, record } = normalizeRecipe(slug, recipeMd, planMd);
    if (!styles.some((s) => s.id === recipe.recommendedStyleId)) {
      throw new Error(`Recipe ${slug} recommends unknown style ${recipe.recommendedStyleId}`);
    }
    recipes.push(recipe);
    recipeRecords.push(record);
  }

  // Build role index + verify every recipe scaffolds to valid layouts.
  const byRole = new Map<string, LayoutProfile[]>();
  for (const layout of layouts) {
    const key = `${layout.styleId}:${layout.role}`;
    const arr = byRole.get(key) ?? [];
    arr.push(layout);
    byRole.set(key, arr);
  }
  for (const record of recipeRecords) {
    const deck = scaffoldDeckGoal(record, "verify", byRole);
    for (const slide of deck.slides) {
      if (!slide.layout) throw new Error(`Recipe ${record.id} slide ${slide.id} has no selectable layout`);
    }
  }

  const output = buildOutput(styles, layouts, recipeRecords);

  if (checkOnly) {
    const drift: string[] = [];
    for (const name of Object.keys(output) as Array<keyof EmittedFiles>) {
      const existing = await readFile(join(OUT_DIR, name), "utf8");
      if (existing !== output[name]) drift.push(name);
    }
    if (drift.length > 0) {
      throw new Error(`Generated registry data is stale; rerun 'pnpm --filter @slides-studio/style-registry generate'. Drifted: ${drift.join(", ")}`);
    }
    console.log(`Registry generated-data check OK: ${styles.length} styles, ${layouts.length} layouts, ${recipes.length} recipes (no drift).`);
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const name of Object.keys(output) as Array<keyof EmittedFiles>) {
    await writeFile(join(OUT_DIR, name), output[name]);
  }
  console.log(`Generated ${styles.length} styles, ${layouts.length} layouts, ${recipes.length} recipes into ${OUT_DIR}`);
}

await main();
