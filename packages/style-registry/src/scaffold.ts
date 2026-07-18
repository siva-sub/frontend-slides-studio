// Deterministic recipe -> DeckGoal scaffolding. Browser-safe (no filesystem).
//
// Each recipe's paired Markdown frontmatter / `## N. [role] title` plan is
// parsed at generation time into `planSlides`. At runtime we build a
// DeckGoalV1 skeleton with stable slide ids and deterministically selected
// compound layout ids (seeded, with reuse penalties).

import type { DeckGoalV1, LayoutProfile, SlideRole, SlideGoalV1 } from "@slides-studio/protocol";

import { getRecipeRecord } from "./lookup.js";
import { allLayouts } from "./lookup.js";
import { hashSeed } from "./query.js";

function roleIndex(): Map<string, LayoutProfile[]> {
  const index = new Map<string, LayoutProfile[]>();
  for (const layout of allLayouts()) {
    const key = `${layout.styleId}:${layout.role}`;
    const arr = index.get(key) ?? [];
    arr.push(layout);
    index.set(key, arr);
  }
  return index;
}

function selectCompoundLayout(
  styleId: string,
  role: SlideRole,
  seed: string,
  used: Set<string>,
  index: Map<string, LayoutProfile[]>,
): string | undefined {
  const key = `${styleId}:${role}`;
  const all = index.get(key) ?? [];
  const fresh = all.filter((layout) => !used.has(layout.id));
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) return undefined;
  const seedHash = hashSeed(seed);
  const ordered = [...pool].sort(
    (left, right) => (hashSeed(left.id) ^ seedHash) - (hashSeed(right.id) ^ seedHash),
  );
  const chosen = ordered[0];
  return chosen ? chosen.id : undefined;
}

function stableSlideId(recipeId: string, index: number): string {
  return `${recipeId}-s${String(index).padStart(2, "0")}`;
}

/**
 * Scaffold a DeckGoal-compatible skeleton from a recipe. Slide ids and the deck
 * id are stable for a given (recipeId, seed). Each slide carries a selected
 * compound layout id; repeated roles within one style rotate through available
 * layouts via the reuse penalty.
 */
export function scaffoldRecipe(recipeId: string, seed: string): DeckGoalV1 {
  const record = getRecipeRecord(recipeId);
  const index = roleIndex();
  const used = new Set<string>();

  const slides: SlideGoalV1[] = record.planSlides.map((planSlide) => {
    const layout = selectCompoundLayout(record.recommendedStyleId, planSlide.role, seed, used, index);
    if (layout) used.add(layout);
    return {
      id: stableSlideId(record.id, planSlide.index),
      renderMode: "html",
      role: planSlide.role,
      layout,
      props: { title: planSlide.title },
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
