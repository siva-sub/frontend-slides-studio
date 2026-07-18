// Pure lookups over the generated browser-safe data. Browser-safe (no fs).

import type { LayoutProfile } from "@slides-studio/protocol";

import { LAYOUTS, STYLES } from "./generated/styles.js";
import { RECIPES, type RecipeRecord } from "./generated/recipes.js";
import type { RecipeSummary, StyleSummary } from "./types.js";

const LAYOUT_BY_ID = new Map<string, LayoutProfile>();
const LAYOUTS_BY_STYLE = new Map<string, LayoutProfile[]>();
for (const layout of LAYOUTS) {
  LAYOUT_BY_ID.set(layout.id, layout);
  const arr = LAYOUTS_BY_STYLE.get(layout.styleId) ?? [];
  arr.push(layout);
  LAYOUTS_BY_STYLE.set(layout.styleId, arr);
}

export function getLayout(compoundId: string): LayoutProfile {
  const layout = LAYOUT_BY_ID.get(compoundId);
  if (!layout) throw new Error(`Unknown compound layout id: ${compoundId}`);
  return layout;
}

export function getStyle(id: string) {
  const style = STYLES.find((candidate) => candidate.id === id);
  if (!style) throw new Error(`Unknown style id: ${id}`);
  return style;
}

export function getRecipeRecord(recipeId: string): RecipeRecord {
  const record = RECIPES.find((candidate) => candidate.id === recipeId);
  if (!record) throw new Error(`Unknown recipe id: ${recipeId}`);
  return record;
}

export function layoutsForStyle(styleId: string): LayoutProfile[] {
  return LAYOUTS_BY_STYLE.get(styleId) ?? [];
}

export function listStyles(): StyleSummary[] {
  return STYLES.map((style) => ({
    id: style.id,
    name: style.name,
    layoutCount: (LAYOUTS_BY_STYLE.get(style.id) ?? []).length,
  }));
}

export function listRecipes(): RecipeSummary[] {
  return RECIPES.map((record) => ({
    id: record.id,
    name: record.name,
    recommendedStyleId: record.recommendedStyleId,
    slideCount: record.planSlides.length,
  }));
}

export function allStyles() {
  return STYLES;
}

export function allLayouts(): readonly LayoutProfile[] {
  return LAYOUTS;
}

export function allRecipes(): readonly RecipeRecord[] {
  return RECIPES;
}
