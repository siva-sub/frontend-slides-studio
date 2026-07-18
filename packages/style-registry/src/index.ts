// @slides-studio/style-registry — public API.
//
// Browser-safe typed registry of licensed style/layout and recipe resources with
// deterministic layout queries and recipe scaffolding. The runtime public API
// performs no filesystem access; all data is embedded in the generated modules.

import type { LayoutProfile, Recipe, StyleProfile } from "@slides-studio/protocol";

import { allRecipes, allStyles, getLayout, getRecipeRecord, getStyle, layoutsForStyle, listRecipes as listRecipeSummaries, listStyles as listStyleSummaries } from "./lookup.js";
import type { RecipeSummary, StyleDetail, StyleSummary } from "./types.js";

// Re-export the core functions, constants, and types. These are declared with
// `export ... from` so they are not also imported as local bindings.
export { generateStyleBrowserHtml } from "./browser.js";
export { normalizeLayoutProps } from "./props.js";
export { hashSeed, mediaCapacity, mediaFitScore, queryLayouts, requiredMediaFor, scoreLayout } from "./query.js";
export { scaffoldRecipe } from "./scaffold.js";
export { REGISTRY_META } from "./generated/meta.js";
export type { LayoutQuery, NormalizeLayoutPropsResult, RecipeSummary, StyleDetail, StyleSummary, SuppliedAsset, ValidationIssue } from "./types.js";
export type { DeckGoalV1, LayoutProfile, Recipe, StyleProfile } from "@slides-studio/protocol";

/** List all registered styles as lightweight summaries. */
export function listStyles(): StyleSummary[] {
  return listStyleSummaries();
}

/** List all registered recipes as lightweight summaries. */
export function listRecipes(): RecipeSummary[] {
  return listRecipeSummaries();
}

/** Inspect a full style profile and its 8 layouts. Throws on unknown id. */
export function inspectStyle(id: string): StyleDetail {
  const style = getStyle(id);
  return { style, layouts: layoutsForStyle(id) };
}

/** Inspect a single layout by its compound `${styleId}/${layoutId}` id. */
export function inspectLayout(compoundId: string): LayoutProfile {
  return getLayout(compoundId);
}

/** Inspect a full recipe (Recipe contract). Throws on unknown id. */
export function inspectRecipe(recipeId: string): Recipe {
  return getRecipeRecord(recipeId);
}

/** All registered style profiles (full). */
export function allStyleProfiles(): readonly StyleProfile[] {
  return allStyles();
}

/** All registered recipe records (full, including raw plan text). */
export function allRecipeRecords(): readonly ReturnType<typeof allRecipes>[number][] {
  return allRecipes();
}
