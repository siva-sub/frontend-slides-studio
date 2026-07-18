// Public type surface for @slides-studio/style-registry.
// All runtime modules here are browser-safe: no filesystem access.

import type { DeckGoalV1, LayoutProfile, Recipe, SlideRole, StyleProfile } from "@slides-studio/protocol";

export interface StyleSummary {
  id: string;
  name: string;
  layoutCount: number;
}

export interface RecipeSummary {
  id: string;
  name: string;
  recommendedStyleId: string;
  slideCount: number;
}

export interface StyleDetail {
  style: StyleProfile;
  layouts: LayoutProfile[];
}

export interface SuppliedAsset {
  /** Width / height aspect ratio of the supplied asset (e.g. 16/9). */
  aspect?: number;
  /** Desired fidelity/detail level of the supplied asset. */
  detail?: "low" | "standard" | "high";
}

export interface LayoutQuery {
  /** Restrict candidates to a single style id. */
  styleId?: string;
  /** Required page role. */
  role?: SlideRole;
  /** Required external media slot count. Layouts with fewer declared slots are
   *  never returned (insufficient media capacity is always rejected). */
  needsMedia?: number;
  /** Supplied assets whose count/aspect/detail inform capacity + fit scoring. */
  suppliedAssets?: SuppliedAsset[];
  /** Compound layout ids already used in the deck; penalized by reuse policy. */
  used?: string[];
  /** Stable seed for deterministic ordering of equally-scored candidates. */
  seed?: string;
  /** Optional maximum number of results. */
  limit?: number;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface NormalizeLayoutPropsResult {
  compoundId: string;
  props: Record<string, unknown>;
  substitutions: Array<{ from: string; to: string; reason: string }>;
  issues: ValidationIssue[];
}

export type { DeckGoalV1, LayoutProfile, Recipe, SlideRole, StyleProfile };
