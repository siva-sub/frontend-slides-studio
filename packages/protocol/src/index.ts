import { z } from "zod";

export const slideRoleSchema = z.enum([
  "cover", "agenda", "section", "content", "comparison", "data", "diagram", "quote", "closing", "other",
]);
export type SlideRole = z.infer<typeof slideRoleSchema>;

export const slideRenderModeSchema = z.enum(["html", "visual-master"]);
export type SlideRenderMode = z.infer<typeof slideRenderModeSchema>;

export const diagramTypeSchema = z.enum([
  "architecture", "it-state", "flowchart", "sequence", "state", "er", "timeline", "swimlane", "quadrant",
  "radar", "loop", "nested", "tree", "org-chart", "layers", "venn", "pyramid", "bar", "line", "gantt",
  "scatter", "high-level", "process", "medallion", "data-flow", "dp-integration", "dp-security-matrix",
]);
export type DiagramType = z.infer<typeof diagramTypeSchema>;

export const diagramThemeSchema = z.object({
  paper: z.string().default("#f5f5f2"),
  paper2: z.string().default("#ffffff"),
  ink: z.string().default("#20231f"),
  muted: z.string().default("#6f756d"),
  rule: z.string().default("#d8dbd4"),
  accent: z.string().default("#f05a36"),
  accentTint: z.string().default("#fde8e1"),
  link: z.string().default("#315f9d"),
  titleFont: z.string().default("Fraunces"),
  bodyFont: z.string().default("Manrope"),
  monoFont: z.string().default("IBM Plex Mono"),
});
export type DiagramTheme = z.infer<typeof diagramThemeSchema>;

export const diagramNodeKindSchema = z.enum([
  "focal", "step", "store", "external", "input", "optional", "security", "actor", "metric",
]);
export type DiagramNodeKind = z.infer<typeof diagramNodeKindSchema>;

export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: diagramNodeKindSchema.default("step"),
  sublabel: z.string().optional(),
  groupId: z.string().optional(),
  x: z.number().multipleOf(4).optional(),
  y: z.number().multipleOf(4).optional(),
  width: z.number().positive().multipleOf(4).optional(),
  height: z.number().positive().multipleOf(4).optional(),
  data: z.record(z.unknown()).optional(),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().max(24).optional(),
  kind: z.enum(["default", "accent", "link", "async", "return", "transit"]).default("default"),
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const diagramSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  type: diagramTypeSchema,
  variant: z.enum(["light", "dark", "editorial", "sketchy", "terminal"]).default("light"),
  direction: z.enum(["ltr", "ttb"]).default("ltr"),
  theme: diagramThemeSchema.default({}),
  nodes: z.array(diagramNodeSchema),
  edges: z.array(diagramEdgeSchema),
  groups: z.array(z.object({ id: z.string(), label: z.string(), nodeIds: z.array(z.string()) })).optional(),
  annotations: z.array(z.object({ id: z.string(), targetId: z.string(), text: z.string().max(120) })).optional(),
  legend: z.object({ title: z.string().default("Legend"), items: z.array(z.object({ label: z.string(), kind: z.string() })) }).optional(),
});
export type DiagramSpecV1 = z.infer<typeof diagramSpecSchema>;

// ---------------------------------------------------------------------------
// DiagramSpecV2 — discriminated union across payload families
// ---------------------------------------------------------------------------
// V2 organizes the 27 legacy diagram type names (preserved verbatim) into 8
// payload families. Each branch constrains its own `type` enum so a family/type
// mismatch is impossible both at runtime and in the inferred TypeScript types.
// Each V2 spec carries EITHER family-specific `data` (rich enough for later
// semantic adapters) OR a `legacyGraph` payload (so a deterministic V1→V2
// migration is always structurally lossless).

export const diagramFamilySchema = z.enum([
  "graph-topology", "hierarchy", "process-state", "sequence-time",
  "matrix", "quantitative-series", "set-radial", "schedule",
]);
export type DiagramFamily = z.infer<typeof diagramFamilySchema>;

// Per-family `type` enums. Together these are an exact partition of the 27
// legacy diagram type names.
export const graphTopologyTypeSchema = z.enum([
  "architecture", "it-state", "er", "high-level", "medallion", "data-flow", "dp-integration",
]);
export const hierarchyTypeSchema = z.enum(["nested", "tree", "org-chart", "layers", "pyramid"]);
export const processStateTypeSchema = z.enum(["flowchart", "state", "swimlane", "process"]);
export const sequenceTimeTypeSchema = z.enum(["sequence", "timeline"]);
export const matrixTypeSchema = z.enum(["quadrant", "dp-security-matrix"]);
export const quantitativeSeriesTypeSchema = z.enum(["bar", "line", "scatter", "radar"]);
export const setRadialTypeSchema = z.enum(["venn", "loop"]);
export const scheduleTypeSchema = z.enum(["gantt"]);

// Deterministic mapping of each of the 27 legacy diagram type names to a family.
export const DIAGRAM_TYPE_FAMILY = {
  // graph-topology
  architecture: "graph-topology",
  "it-state": "graph-topology",
  er: "graph-topology",
  "high-level": "graph-topology",
  medallion: "graph-topology",
  "data-flow": "graph-topology",
  "dp-integration": "graph-topology",
  // hierarchy
  nested: "hierarchy",
  tree: "hierarchy",
  "org-chart": "hierarchy",
  layers: "hierarchy",
  pyramid: "hierarchy",
  // process-state
  flowchart: "process-state",
  state: "process-state",
  swimlane: "process-state",
  process: "process-state",
  // sequence-time
  sequence: "sequence-time",
  timeline: "sequence-time",
  // matrix
  quadrant: "matrix",
  "dp-security-matrix": "matrix",
  // quantitative-series
  bar: "quantitative-series",
  line: "quantitative-series",
  scatter: "quantitative-series",
  radar: "quantitative-series",
  // set-radial
  venn: "set-radial",
  loop: "set-radial",
  // schedule
  gantt: "schedule",
} as const satisfies Readonly<Record<DiagramType, DiagramFamily>>;

export function diagramFamilyForType(type: DiagramType): DiagramFamily {
  return DIAGRAM_TYPE_FAMILY[type];
}

// Common display-level fields shared by every V2 family payload (the raw graph
// lives in `data` for native V2 specs or in `legacyGraph` for migrated specs).
const diagramV2DisplayFields = {
  id: z.string().min(1),
  variant: z.enum(["light", "dark", "editorial", "sketchy", "terminal"]).default("light"),
  direction: z.enum(["ltr", "ttb"]).default("ltr"),
  theme: diagramThemeSchema.default({}),
};

// A lossless carrier for migrated V1 specs: every common V1 field is preserved.
export const legacyGraphSchema = z.object({
  variant: z.enum(["light", "dark", "editorial", "sketchy", "terminal"]).default("light"),
  direction: z.enum(["ltr", "ttb"]).default("ltr"),
  theme: diagramThemeSchema.default({}),
  nodes: z.array(diagramNodeSchema).default([]),
  edges: z.array(diagramEdgeSchema).default([]),
  groups: z.array(z.object({ id: z.string(), label: z.string(), nodeIds: z.array(z.string()) })).optional(),
  annotations: z.array(z.object({ id: z.string(), targetId: z.string(), text: z.string().max(120) })).optional(),
  legend: z.object({ title: z.string().default("Legend"), items: z.array(z.object({ label: z.string(), kind: z.string() })) }).optional(),
});
export type LegacyGraph = z.infer<typeof legacyGraphSchema>;

// --- Family-specific `data` payloads -----------------------------------------

const graphTopologyDataSchema = z.object({
  layout: z.enum(["dot", "neato", "fdp", "circo", "dagre", "manual"]).optional(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    kind: diagramNodeKindSchema.optional(),
    zoneId: z.string().optional(),
  })).default([]),
  zones: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  connections: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
    kind: z.string().optional(),
  })).default([]),
});

const hierarchyDataSchema = z.object({
  rootId: z.string().optional(),
  orientation: z.enum(["vertical", "horizontal", "radial"]).optional(),
  items: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  parents: z.array(z.object({ id: z.string().min(1), parentId: z.string().min(1) })).default([]),
});

const processStateDataSchema = z.object({
  startId: z.string().optional(),
  terminalIds: z.array(z.string().min(1)).default([]),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  steps: z.array(z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    laneId: z.string().optional(),
  })).default([]),
  transitions: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
    kind: z.string().optional(),
  })).default([]),
  lanes: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
});

const sequenceTimeDataSchema = z.object({
  actors: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  events: z.array(z.object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().optional(),
    label: z.string().optional(),
    timeMs: z.number().nonnegative().optional(),
  })).default([]),
  timeAxis: z.enum(["horizontal", "vertical"]).optional(),
  timeDomain: z.object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative() }).optional(),
});

const matrixDataSchema = z.object({
  rows: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  columns: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  cells: z.array(z.object({
    rowId: z.string().min(1),
    columnId: z.string().min(1),
    value: z.union([z.string(), z.number()]).optional(),
    label: z.string().optional(),
  })).default([]),
});

const quantitativeSeriesDataSchema = z.object({
  categories: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  series: z.array(z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    values: z.array(z.number()).default([]),
  })).default([]),
  domain: z.object({ min: z.number(), max: z.number() }).optional(),
  valueAxis: z.enum(["linear", "log"]).optional(),
});

const setRadialDataSchema = z.object({
  sets: z.array(z.object({ id: z.string().min(1), label: z.string().optional() })).default([]),
  segments: z.array(z.object({
    id: z.string().min(1),
    setIds: z.array(z.string().min(1)).default([]),
    label: z.string().optional(),
  })).default([]),
});

// Schedule tasks carry an explicit interval; endMs must strictly exceed startMs.
const scheduleTaskSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
}).refine((task) => task.endMs > task.startMs, { message: "task endMs must be greater than startMs" });

const scheduleDataSchema = z.object({
  tasks: z.array(scheduleTaskSchema).default([]),
  domain: z.object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative() }).optional(),
  timeAxis: z.enum(["horizontal", "vertical"]).optional(),
});

// Each V2 spec must carry either family `data` or a `legacyGraph` payload.
function requireV2Payload(spec: { data?: unknown; legacyGraph?: unknown }, context: z.RefinementCtx): void {
  // Enforce a true XOR: exactly one of family `data` or `legacyGraph` must be
  // present. Neither, or both, are rejected.
  const hasData = spec.data !== undefined;
  const hasLegacyGraph = spec.legacyGraph !== undefined;
  if (hasData === hasLegacyGraph) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["data"],
      message: "V2 diagram must include exactly one of family data or legacyGraph",
    });
  }
}

const graphTopologyDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("graph-topology"),
  type: graphTopologyTypeSchema,
  ...diagramV2DisplayFields,
  data: graphTopologyDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const hierarchyDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("hierarchy"),
  type: hierarchyTypeSchema,
  ...diagramV2DisplayFields,
  data: hierarchyDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const processStateDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("process-state"),
  type: processStateTypeSchema,
  ...diagramV2DisplayFields,
  data: processStateDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const sequenceTimeDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("sequence-time"),
  type: sequenceTimeTypeSchema,
  ...diagramV2DisplayFields,
  data: sequenceTimeDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const matrixDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("matrix"),
  type: matrixTypeSchema,
  ...diagramV2DisplayFields,
  data: matrixDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const quantitativeSeriesDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("quantitative-series"),
  type: quantitativeSeriesTypeSchema,
  ...diagramV2DisplayFields,
  data: quantitativeSeriesDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const setRadialDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("set-radial"),
  type: setRadialTypeSchema,
  ...diagramV2DisplayFields,
  data: setRadialDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

const scheduleDiagramSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  family: z.literal("schedule"),
  type: scheduleTypeSchema,
  ...diagramV2DisplayFields,
  data: scheduleDataSchema.optional(),
  legacyGraph: legacyGraphSchema.optional(),
});

// The data/legacyGraph requirement is applied at the union level so each branch
// stays a plain ZodObject and the `family` discriminator remains inferable.
export const diagramSpecV2Schema = z.discriminatedUnion("family", [
  graphTopologyDiagramSpecV2Schema,
  hierarchyDiagramSpecV2Schema,
  processStateDiagramSpecV2Schema,
  sequenceTimeDiagramSpecV2Schema,
  matrixDiagramSpecV2Schema,
  quantitativeSeriesDiagramSpecV2Schema,
  setRadialDiagramSpecV2Schema,
  scheduleDiagramSpecV2Schema,
]).superRefine(requireV2Payload);
export type DiagramSpecV2 = z.infer<typeof diagramSpecV2Schema>;

// diagramSpecSchema (V1) is preserved unchanged. Alias for ergonomic paired use.
export const diagramSpecV1Schema = diagramSpecSchema;

export const diagramSpecUnionSchema = z.union([diagramSpecV1Schema, diagramSpecV2Schema]);
export type DiagramSpecAny = z.infer<typeof diagramSpecUnionSchema>;

/**
 * Deterministic, lossless migration of a DiagramSpecV1 into a DiagramSpecV2.
 * The legacy `type` is preserved verbatim and mapped to its payload family via
 * DIAGRAM_TYPE_FAMILY; the full V1 graph is carried inside `legacyGraph`. The
 * output is re-validated against diagramSpecV2Schema so the return type is exact.
 */
export function migrateDiagramV1ToV2(v1: DiagramSpecV1): DiagramSpecV2 {
  const family = diagramFamilyForType(v1.type);
  const v2Input = {
    schemaVersion: 2 as const,
    family,
    id: v1.id,
    type: v1.type,
    variant: v1.variant,
    direction: v1.direction,
    theme: v1.theme,
    legacyGraph: {
      variant: v1.variant,
      direction: v1.direction,
      theme: v1.theme,
      nodes: v1.nodes,
      edges: v1.edges,
      groups: v1.groups,
      annotations: v1.annotations,
      legend: v1.legend,
    },
  };
  return diagramSpecV2Schema.parse(v2Input);
}

/** Parse a diagram spec accepting either V1 or V2. */
export function parseDiagramSpec(input: unknown): DiagramSpecAny {
  return diagramSpecUnionSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Motion (legacy V1 contracts — preserved unchanged)
// ---------------------------------------------------------------------------

export const motionAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string(),
  durationMs: z.number().nonnegative(),
  fps: z.number().positive(),
  energy: z.array(z.object({ timeMs: z.number().nonnegative(), value: z.number().nonnegative() })),
  segments: z.array(z.object({ startMs: z.number(), endMs: z.number(), kind: z.enum(["motion", "hold", "fade", "beat"]) })),
  easingHint: z.string().optional(),
  loopPeriodMs: z.number().positive().optional(),
  staggerHint: z.object({ direction: z.string(), intervalMs: z.number().positive() }).optional(),
  keyframes: z.array(z.object({ timeMs: z.number(), path: z.string() })).default([]),
  caveats: z.array(z.string()).default([]),
});
export type MotionAnalysisV1 = z.infer<typeof motionAnalysisSchema>;

export const motionIntentSchema = z.object({
  schemaVersion: z.literal(1),
  analysisId: z.string().optional(),
  // Motion-intent presets. Legacy presets (reveal/fade/slide/scale/draw/focus/loop)
  // are retained for backward compatibility; blur/wipe/rotate/pulse/stagger are new.
  mappings: z.array(z.object({ objectId: z.string(), effect: z.enum(["reveal", "fade", "slide", "scale", "draw", "focus", "loop", "blur", "wipe", "rotate", "pulse", "stagger"]), startMs: z.number().nonnegative(), durationMs: z.number().positive(), easing: z.string().default("ease-out") })),
});
export type MotionIntentV1 = z.infer<typeof motionIntentSchema>;

export const motionProgramSchema = z.object({
  schemaVersion: z.literal(1),
  replay: z.enum(["always", "once", "never"]).default("always"),
  tracks: z.array(z.object({
    objectId: z.string(),
    keyframes: z.array(z.record(z.union([z.string(), z.number()]))).min(2),
    options: z.object({ duration: z.number().positive(), delay: z.number().nonnegative().default(0), easing: z.string().default("ease-out"), iterations: z.number().positive().default(1), fill: z.literal("both").default("both") }),
    reducedMotion: z.record(z.union([z.string(), z.number()])).default({ opacity: 1 }),
  })),
});
export type MotionProgramV1 = z.infer<typeof motionProgramSchema>;

export const visualMasterSpecSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.string().min(1),
  prompt: z.string().min(1),
  styleId: z.string().optional(),
  referenceAssets: z.array(z.string()).default([]),
  realAssets: z.array(z.object({ id: z.string(), source: z.string(), fidelityCritical: z.boolean().default(true), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() })).default([]),
  status: z.enum(["planned", "generated", "rendered_pending_manual_review", "passed", "failed"]).default("planned"),
});
export type VisualMasterSpecV1 = z.infer<typeof visualMasterSpecSchema>;

// ---------------------------------------------------------------------------
// Transitions (TransitionSpecV1)
// ---------------------------------------------------------------------------
// Explicitly versioned, optional, additive contract for deck-level default
// transitions and slide-level transitions. All existing decks/slides continue to
// parse because the field is optional and `schemaVersion` defaults to 1.

export const transitionKindSchema = z.enum([
  "none", "crossfade", "slide", "zoom", "circle-reveal",
  "clip-wipe", "pixel-grid", "pixel-bars", "slice-vertical", "slice-horizontal",
]);
export type TransitionKind = z.infer<typeof transitionKindSchema>;

export const transitionDirectionSchema = z.enum([
  "ltr", "rtl", "ttb", "btt", "in", "out", "clockwise", "counter-clockwise",
]);
export type TransitionDirection = z.infer<typeof transitionDirectionSchema>;

// Bounded easing: named CSS easings or a single cubic-bezier(...) expression
// with exactly four finite numeric controls whose x1/x2 lie in [0,1].

// A strict CSS number token: optional sign, decimal digits with an optional
// fractional part (or a leading dot), and an optional decimal exponent. This
// rejects empty tokens, hex (0x...), and the bare identifiers Infinity/NaN
// before any Number() coercion can reinterpret them.
const CSS_NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export const transitionEasingSchema = z.union([
  z.enum(["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]),
  z.string().refine((value) => {
    const match = /^cubic-bezier\(\s*([^)]*?)\s*\)$/.exec(value);
    if (!match) return false;
    const parts = match[1]!.split(",").map((part) => part.trim());
    if (parts.length !== 4) return false;
    if (!parts.every((part) => CSS_NUMBER_TOKEN.test(part))) return false;
    const controls = parts.map((part) => Number(part));
    if (!controls.every((control) => Number.isFinite(control))) return false;
    const x1 = controls[0]!;
    const x2 = controls[2]!;
    return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
  }, "easing must be a named easing or cubic-bezier(<x1>, <y1>, <x2>, <y2>) with finite numbers and x1/x2 in [0,1]"),
]);
export type TransitionEasing = z.infer<typeof transitionEasingSchema>;

// How a transition degrades when the viewer requests reduced motion.
export const transitionReducedMotionSchema = z.enum(["skip", "fade", "crossfade", "none"]);
export type TransitionReducedMotion = z.infer<typeof transitionReducedMotionSchema>;

export const transitionSpecSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  kind: transitionKindSchema,
  // Bounded duration: 0ms (instant) .. 4000ms.
  durationMs: z.number().min(0).max(4000).default(400),
  easing: transitionEasingSchema.default("ease-out"),
  direction: transitionDirectionSchema.optional(),
  // Fraction (0..1) of the page-transition DURATION that must elapse before the
  // real target-entrance animation begins (gates when the incoming slide's
  // entrance starts relative to the transition timeline).
  targetEntranceStartFraction: z.number().min(0).max(1).optional(),
  reducedMotion: transitionReducedMotionSchema.default("fade"),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type TransitionSpecV1 = z.infer<typeof transitionSpecSchema>;

// ---------------------------------------------------------------------------
// Slide / deck goals
// ---------------------------------------------------------------------------

export const slideGoalSchema = z.object({
  id: z.string().min(1),
  renderMode: slideRenderModeSchema.default("html"),
  role: slideRoleSchema,
  layout: z.string().optional(),
  props: z.record(z.unknown()).optional(),
  // Accepts V1 or V2 diagrams additively; legacy V1 diagrams parse unchanged.
  diagram: diagramSpecUnionSchema.optional(),
  visualMaster: visualMasterSpecSchema.optional(),
  motion: motionProgramSchema.optional(),
  // Optional per-slide transition (additive; legacy slides omit it).
  transition: transitionSpecSchema.optional(),
}).superRefine((slide, context) => {
  if (slide.renderMode === "visual-master" && !slide.visualMaster) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["visualMaster"], message: "visual-master slides require visualMaster metadata" });
  }
});
export type SlideGoalV1 = z.infer<typeof slideGoalSchema>;

export const deckGoalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().optional(),
  audience: z.string().optional(),
  language: z.string().optional(),
  theme: z.string().optional(),
  seed: z.string().optional(),
  slides: z.array(slideGoalSchema).min(1),
  // Optional deck-level default transition applied to slides that do not declare
  // their own `transition` (additive; legacy decks omit it).
  defaultTransition: transitionSpecSchema.optional(),
});
export type DeckGoalV1 = z.infer<typeof deckGoalSchema>;

// ---------------------------------------------------------------------------
// Safe relative paths & content hashes (shared by media contracts)
// ---------------------------------------------------------------------------

// A canonical deck-local POSIX relative path. Plain string checks only (no node
// `path` dependency) so the protocol stays browser-bundleable. Rejects absolute,
// tilde, Windows drive prefix, backslash, control/NUL bytes, empty/dot/dotdot
// segments, duplicate separators, and trailing separators.
export const safeRelativePathSchema = z.string().min(1).refine(
  (p) => {
    if (p.length === 0 || p.charCodeAt(0) === 47 /* / */ || p.charCodeAt(0) === 126 /* ~ */) return false;
    if (/\\/.test(p)) return false; // backslash
    if (/[\x00-\x1f\x7f]/.test(p)) return false; // control / NUL
    if (/^[a-zA-Z]:/.test(p)) return false; // Windows drive prefix
    if (/\/\//.test(p)) return false; // duplicate separators
    if (p.endsWith("/")) return false; // trailing separator -> empty trailing segment
    const segments = p.split("/");
    for (const segment of segments) {
      if (segment === "" || segment === "." || segment === "..") return false;
    }
    return true;
  },
  { message: "path must be a deck-local POSIX relative path: no backslash, control bytes, absolute/tilde/drive prefix, empty/dot/dotdot segments, or duplicate separators" },
);
export type SafeRelativePath = z.infer<typeof safeRelativePathSchema>;

// SHA-256 identity only: exactly 64 lowercase/uppercase hex characters.
export const contentHashSchema = z.object({
  algorithm: z.literal("sha256"),
  value: z.string().regex(/^[0-9a-fA-F]{64}$/, "sha256 hash value must be exactly 64 hex characters"),
});
export type ContentHash = z.infer<typeof contentHashSchema>;

// ---------------------------------------------------------------------------
// Canvas, normalized rectangles, layout slots
// ---------------------------------------------------------------------------

// Canvas sizes preserve the existing 1280x720 / 1920x1080 behavior; arbitrary
// positive integer dimensions are also accepted so the contract does not regress.
export const canvasSpecSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CanvasSpec = z.infer<typeof canvasSpecSchema>;

// Normalized 0..1 rectangle with positive size that stays within the unit box.
export const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine(
  (rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1,
  { message: "normalized rect must stay within the unit box (x+width<=1 and y+height<=1)" },
);
export type NormalizedRect = z.infer<typeof normalizedRectSchema>;

// A candidate media slot/region for a layout profile.
export const layoutSlotSchema = z.object({
  id: z.string().min(1),
  region: normalizedRectSchema,
  acceptedKinds: z.array(z.string().min(1)).default([]),
  maxCount: z.number().int().positive().default(1),
  fit: z.enum(["contain", "cover"]).default("contain"),
  emptyBehavior: z.enum(["collapse", "placeholder", "keep"]).default("collapse"),
});
export type LayoutSlot = z.infer<typeof layoutSlotSchema>;

// ---------------------------------------------------------------------------
// Provider / capability / evidence / review contracts (non-secret)
// ---------------------------------------------------------------------------

// Non-secret provider capabilities. No base URL, token, arbitrary provider ref,
// or credential-bearing URLs are modeled anywhere in artifacts.
export const providerCapabilitySchema = z.enum([
  "ordinary-generation", "ordered-references", "masked-edit", "visual-review",
]);
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerQualitySchema = z.enum(["draft", "standard", "high"]);
export type ProviderQuality = z.infer<typeof providerQualitySchema>;

export const assetProviderSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1).optional(),
  quality: providerQualitySchema.optional(),
  capabilities: z.array(providerCapabilitySchema).default([]),
});
export type AssetProvider = z.infer<typeof assetProviderSchema>;

// Evidence references are safe deck-local artifact paths (never arbitrary URLs).
export const assetEvidenceSchema = z.object({
  kind: z.string().min(1),
  path: safeRelativePathSchema.optional(),
  note: z.string().optional(),
});
export type AssetEvidence = z.infer<typeof assetEvidenceSchema>;

// Review state with status-dependent refinements.
export const assetReviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "needs-revision"]).default("pending"),
  reviewer: z.string().optional(),
  evidence: z.array(safeRelativePathSchema).default([]),
  note: z.string().optional(),
}).superRefine((review, context) => {
  if (review.status === "approved") {
    const reviewer = review.reviewer?.trim() ?? "";
    if (reviewer === "" || review.evidence.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "approved reviews require a reviewer and evidence" });
    }
  }
});
export type AssetReview = z.infer<typeof assetReviewSchema>;

// ---------------------------------------------------------------------------
// StyleProfile, LayoutProfile, Recipe (plan-conformant versioned contracts)
// ---------------------------------------------------------------------------

export const styleProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  palette: z.object({
    paper: z.string().optional(),
    paper2: z.string().optional(),
    ink: z.string().optional(),
    muted: z.string().optional(),
    rule: z.string().optional(),
    accent: z.string().optional(),
    accentTint: z.string().optional(),
    link: z.string().optional(),
  }).default({}),
  fonts: z.object({
    title: z.string().optional(),
    body: z.string().optional(),
    mono: z.string().optional(),
  }).default({}),
  scale: z.number().positive().optional(),
  // Global/prompt guidance, tags/tokens, and source provenance.
  globalGuidance: z.string().optional(),
  promptGuidance: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  tokens: z.record(z.unknown()).default({}),
  provenance: z.object({
    source: z.string().optional(),
    sourceId: z.string().optional(),
    note: z.string().optional(),
  }).default({}),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

export const layoutProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  styleId: z.string().min(1),
  role: slideRoleSchema,
  canvas: canvasSpecSchema,
  visualSignature: z.string().min(1),
  capacity: z.number().int().positive(),
  suitability: z.object({
    best: z.array(slideRoleSchema).default([]),
    avoid: z.array(slideRoleSchema).default([]),
  }).default({}),
  reuse: z.object({
    policy: z.enum(["unique", "shared", "singleton"]).default("unique"),
    reason: z.string().optional(),
  }).default({}),
  promptGuidance: z.string().optional(),
  // Candidate media slots/regions with accepted kinds, max count, fit, empty behavior.
  slots: z.array(layoutSlotSchema).default([]),
  protectedTextRegions: z.array(normalizedRectSchema).default([]),
  allowedOverlapGroups: z.array(z.string().min(1)).default([]),
  // The upstream JSON schema is preserved losslessly as an opaque JSON object.
  schema: z.record(z.unknown()).default({}),
});
export type LayoutProfile = z.infer<typeof layoutProfileSchema>;

// Recipe models a recommended style, description, slide roles/plan path,
// warnings, and provenance — it does not force a single layout ID.
export const recipeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  recommendedStyleId: z.string().min(1),
  description: z.string().optional(),
  slideRoles: z.array(slideRoleSchema).default([]),
  planPath: safeRelativePathSchema.optional(),
  warnings: z.array(z.string().min(1)).default([]),
  provenance: z.object({
    source: z.string().optional(),
    note: z.string().optional(),
  }).default({}),
});
export type Recipe = z.infer<typeof recipeSchema>;

// ---------------------------------------------------------------------------
// Media contracts: MediaAsset, MediaPlacement, AssetPlan, AssetJob, AssetManifest
// ---------------------------------------------------------------------------

export const mediaAssetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  path: safeRelativePathSchema,
  hash: contentHashSchema,
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  provider: assetProviderSchema.optional(),
  evidence: z.array(assetEvidenceSchema).default([]),
  review: assetReviewSchema.optional(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

// A declared intentional overlap between placements: a stable group/pair plus a
// nonempty reason. Declared overlaps are not treated as quality errors.
export const intentionalOverlapSchema = z.object({
  group: z.string().min(1),
  with: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});
export type IntentionalOverlap = z.infer<typeof intentionalOverlapSchema>;

export const mediaPlacementSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  // Deck-local source identity (path + hash) recorded on the placement itself.
  sourcePath: safeRelativePathSchema,
  sourceHash: contentHashSchema,
  // Optional link to a manifest asset carrying richer metadata.
  assetId: z.string().min(1).optional(),
  slideId: z.string().optional(),
  // Required layout slot this placement fills.
  layoutSlot: z.string().min(1),
  fit: z.enum(["contain", "cover"]).default("contain"),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  crop: normalizedRectSchema.optional(),
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  pan: z.object({ x: z.number(), y: z.number() }).optional(),
  zoom: z.number().min(0).max(10).optional(),
  // Rotation supports negative values (clockwise/counter-clockwise).
  rotation: z.number().min(-360).max(360).optional(),
  z: z.number().int().optional(),
  alt: z.string().optional(),
  overlaps: z.array(intentionalOverlapSchema).default([]),
});
export type MediaPlacement = z.infer<typeof mediaPlacementSchema>;

export const assetPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  slideId: z.string().optional(),
  styleId: z.string().optional(),
  layoutId: z.string().optional(),
  operation: z.enum(["generate", "source", "reuse"]).default("generate"),
  stages: z.array(z.string().min(1)).default([]),
  capabilities: z.array(providerCapabilitySchema).default([]),
  prompt: z.string().optional(),
  promptHash: contentHashSchema.optional(),
  referenceHashes: z.array(contentHashSchema).default([]),
  protectedRegions: z.array(normalizedRectSchema).default([]),
  alternativeRegions: z.array(normalizedRectSchema).default([]),
  placements: z.array(mediaPlacementSchema).default([]),
  provider: assetProviderSchema.optional(),
});
export type AssetPlan = z.infer<typeof assetPlanSchema>;

// Output/artifact inventory produced by a job.
export const assetJobOutputSchema = z.object({
  assetId: z.string().optional(),
  artifacts: z.array(safeRelativePathSchema).default([]),
});
export type AssetJobOutput = z.infer<typeof assetJobOutputSchema>;

export const assetJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(["queued", "running", "cancelling", "cancelled", "complete", "failed", "review"]),
  stage: z.string().optional(),
  progress: z.number().min(0).max(1).default(0),
  output: assetJobOutputSchema.optional(),
  model: z.string().optional(),
  quality: providerQualitySchema.optional(),
  capabilities: z.array(providerCapabilitySchema).default([]),
  error: z.string().optional(),
}).superRefine((job, context) => {
  if (job.status === "complete" && (!job.output || job.progress !== 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "complete jobs require output and progress=1" });
  }
  if (job.status === "failed") {
    const error = job.error?.trim() ?? "";
    if (error === "") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "failed jobs require a non-empty error" });
    }
  }
});
export type AssetJob = z.infer<typeof assetJobSchema>;

// A1/A2/B fidelity decisions recorded in a manifest, each with a reason.
export const fidelityDecisionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["A1", "A2", "B"]),
  reason: z.string().min(1),
});
export type FidelityDecision = z.infer<typeof fidelityDecisionSchema>;

export const assetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  assets: z.array(mediaAssetSchema),
  placements: z.array(mediaPlacementSchema).default([]),
  plans: z.array(assetPlanSchema).default([]),
  jobs: z.array(assetJobSchema).default([]),
  promptHash: contentHashSchema.optional(),
  referenceHashes: z.array(contentHashSchema).default([]),
  provider: assetProviderSchema.optional(),
  model: z.string().optional(),
  quality: providerQualitySchema.optional(),
  capabilities: z.array(providerCapabilitySchema).default([]),
  outputDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  generatedFiles: z.array(safeRelativePathSchema).default([]),
  realAssetOverlays: z.array(mediaPlacementSchema).default([]),
  decisions: z.array(fidelityDecisionSchema).default([]),
  maskEvidence: z.array(safeRelativePathSchema).default([]),
  edgeChecks: z.object({ white: z.boolean().optional(), black: z.boolean().optional() }).default({}),
  renderBackEvidence: z.array(safeRelativePathSchema).default([]),
  review: assetReviewSchema.optional(),
}).superRefine((manifest, context) => {
  // Uniqueness + referential integrity: no dangling or duplicate manifest IDs.
  const assetIds = new Set<string>();
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: `duplicate asset id: ${asset.id}` });
    }
    assetIds.add(asset.id);
  }
  const placementIds = new Set<string>();
  for (const placement of manifest.placements) {
    if (placementIds.has(placement.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["placements"], message: `duplicate placement id: ${placement.id}` });
    }
    placementIds.add(placement.id);
    if (placement.assetId && !assetIds.has(placement.assetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["placements"], message: `placement ${placement.id} references unknown asset ${placement.assetId}` });
    }
  }
  const planIds = new Set<string>();
  for (const plan of manifest.plans) {
    if (planIds.has(plan.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["plans"], message: `duplicate plan id: ${plan.id}` });
    }
    planIds.add(plan.id);
  }
  const jobIds = new Set<string>();
  for (const job of manifest.jobs) {
    if (jobIds.has(job.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["jobs"], message: `duplicate job id: ${job.id}` });
    }
    jobIds.add(job.id);
    if (!planIds.has(job.planId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["jobs"], message: `job ${job.id} references unknown plan ${job.planId}` });
    }
  }
  // Referential integrity for assetId references inside plans, overlays, and job outputs.
  for (const plan of manifest.plans) {
    for (const placement of plan.placements) {
      if (placement.assetId && !assetIds.has(placement.assetId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["plans"], message: `plan ${plan.id} placement ${placement.id} references unknown asset ${placement.assetId}` });
      }
    }
  }
  for (const overlay of manifest.realAssetOverlays) {
    if (overlay.assetId && !assetIds.has(overlay.assetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["realAssetOverlays"], message: `overlay ${overlay.id} references unknown asset ${overlay.assetId}` });
    }
  }
  for (const job of manifest.jobs) {
    const outputAssetId = job.output?.assetId;
    if (outputAssetId && !assetIds.has(outputAssetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["jobs"], message: `job ${job.id} output references unknown asset ${outputAssetId}` });
    }
  }
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;

// ---------------------------------------------------------------------------
// QualityReport (browser-quality gate)
// ---------------------------------------------------------------------------

// The approved browser-quality gate categories. "other" is an optional extra
// catch-all category.
export const qualityIssueCategorySchema = z.enum([
  "stage-bounds", "text-overflow", "media-bounds", "object-overlap", "connector-collision",
  "missing-asset", "unsafe-clone-content", "export-settlement", "duplicate-id",
  "clipped-content", "scroll-overflow", "other",
]);
export type QualityIssueCategory = z.infer<typeof qualityIssueCategorySchema>;

export const qualityIssueSchema = z.object({
  slideId: z.string().optional(),
  objectId: z.string().optional(),
  pair: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  group: z.string().optional(),
  category: qualityIssueCategorySchema,
  severity: z.enum(["info", "warning", "error", "critical"]),
  // Hard-failure distinction: hard issues cannot be passed over.
  hard: z.boolean().default(false),
  reason: z.string().min(1),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  evidence: z.array(safeRelativePathSchema).default([]),
  // Settlement state (meaningful for export-settlement issues).
  settled: z.boolean().optional(),
});
export type QualityIssue = z.infer<typeof qualityIssueSchema>;

export const qualityReportSummarySchema = z.object({
  total: z.number().int().nonnegative().default(0),
  info: z.number().int().nonnegative().default(0),
  warning: z.number().int().nonnegative().default(0),
  error: z.number().int().nonnegative().default(0),
  critical: z.number().int().nonnegative().default(0),
  hard: z.number().int().nonnegative().default(0),
});
export type QualityReportSummary = z.infer<typeof qualityReportSummarySchema>;

export const qualityReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  deckId: z.string().optional(),
  canvas: canvasSpecSchema,
  // canonical = produced by the Studio renderer; imported = produced from an
  // imported/source document (looser expectations).
  mode: z.enum(["canonical", "imported"]).default("canonical"),
  strict: z.boolean().default(false),
  issues: z.array(qualityIssueSchema).default([]),
  passed: z.boolean(),
  summary: qualityReportSummarySchema.default({}),
}).superRefine((report, context) => {
  const blocking = report.issues.filter((issue) => issue.hard || issue.severity === "error" || issue.severity === "critical");
  const unsettled = report.issues.filter((issue) => issue.category === "export-settlement" && issue.settled !== true);
  if (report.passed && (blocking.length > 0 || unsettled.length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passed"],
      message: "passed must be false when hard/error/critical issues or unsettled export-settlement issues remain",
    });
  }
  // Summary counts must exactly match the issue-derived totals.
  const derived: QualityReportSummary = {
    total: report.issues.length,
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
    hard: 0,
  };
  for (const issue of report.issues) {
    if (issue.severity === "info") derived.info += 1;
    else if (issue.severity === "warning") derived.warning += 1;
    else if (issue.severity === "error") derived.error += 1;
    else if (issue.severity === "critical") derived.critical += 1;
    if (issue.hard) derived.hard += 1;
  }
  const summary = report.summary;
  if (
    summary.total !== derived.total ||
    summary.info !== derived.info ||
    summary.warning !== derived.warning ||
    summary.error !== derived.error ||
    summary.critical !== derived.critical ||
    summary.hard !== derived.hard
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "summary counts must exactly match the issue-derived totals",
    });
  }
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

// ---------------------------------------------------------------------------
// Presentation session contracts
// ---------------------------------------------------------------------------

export const presentationRoleSchema = z.enum(["studio", "presenter", "audience"]);
export type PresentationRole = z.infer<typeof presentationRoleSchema>;

export const presentationStatusSchema = z.enum(["idle", "running", "paused", "ended"]);
export type PresentationStatus = z.infer<typeof presentationStatusSchema>;

export const presentationTimerSchema = z.object({
  running: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
  anchorEpochMs: z.number().int().nonnegative().nullable(),
}).superRefine((timer, context) => {
  if (timer.running && timer.anchorEpochMs === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchorEpochMs"], message: "a running presentation timer requires an anchor" });
  if (!timer.running && timer.anchorEpochMs !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchorEpochMs"], message: "a paused presentation timer cannot retain an anchor" });
});
export type PresentationTimer = z.infer<typeof presentationTimerSchema>;

export const presentationStateSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  slideId: z.string().min(1),
  slideCount: z.number().int().positive(),
  status: presentationStatusSchema,
  timer: presentationTimerSchema,
}).superRefine((state, context) => {
  if (state.slideIndex >= state.slideCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["slideIndex"], message: "slideIndex must be smaller than slideCount" });
});
export type PresentationState = z.infer<typeof presentationStateSchema>;

const presentationEnvelopeShape = {
  namespace: z.literal("slides-studio-presentation"),
  protocolVersion: z.literal(1),
  sessionId: z.string().min(1).max(128),
  deckId: z.string().min(1).max(512),
  revision: z.string().regex(/^[a-f0-9]{64}$/i),
  seq: z.number().int().nonnegative(),
  senderRole: presentationRoleSchema,
  senderId: z.string().min(1).max(128),
  sentAt: z.number().int().nonnegative(),
} as const;

export const presentationSessionMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:hello"), wantsState: z.boolean().default(true) }),
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:state"), state: presentationStateSchema, reason: z.enum(["initial", "navigation", "timer", "reconnect"]) }),
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:navigation"), slideIndex: z.number().int().nonnegative(), slideId: z.string().min(1), slideCount: z.number().int().positive() }),
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:timer"), status: presentationStatusSchema, timer: presentationTimerSchema, action: z.enum(["start", "pause", "resume", "reset", "end"]) }),
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:heartbeat"), currentSlideIndex: z.number().int().nonnegative() }),
  z.object({ ...presentationEnvelopeShape, type: z.literal("presentation:goodbye"), reason: z.enum(["closed", "reloaded", "ended"]) }),
]).superRefine((message, context) => {
  if (message.type === "presentation:navigation" && message.slideIndex >= message.slideCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["slideIndex"], message: "slideIndex must be smaller than slideCount" });
});
export type PresentationSessionMessage = z.infer<typeof presentationSessionMessageSchema>;

export function parsePresentationSessionMessage(input: unknown): PresentationSessionMessage { return presentationSessionMessageSchema.parse(input); }

// ---------------------------------------------------------------------------
// Studio / export contracts (legacy — preserved unchanged)
// ---------------------------------------------------------------------------

export const studioMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("studio:ready"), protocolVersion: z.literal(1) }),
  z.object({ type: z.literal("studio:select"), protocolVersion: z.literal(1), objectId: z.string().nullable(), tagName: z.string().optional() }),
  z.object({ type: z.literal("studio:patch"), protocolVersion: z.literal(1), objectId: z.string(), patch: z.record(z.unknown()) }),
  z.object({ type: z.literal("studio:snapshot"), protocolVersion: z.literal(1), html: z.string(), revision: z.string() }),
  z.object({ type: z.literal("studio:set-mode"), protocolVersion: z.literal(1), mode: z.enum(["browse", "edit", "move"]) }),
  z.object({ type: z.literal("studio:go-to"), protocolVersion: z.literal(1), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal("studio:delete-selected"), protocolVersion: z.literal(1) }),
  z.object({ type: z.literal("studio:nudge-selected"), protocolVersion: z.literal(1), dx: z.number(), dy: z.number() }),
  z.object({ type: z.literal("studio:export-state"), protocolVersion: z.literal(1), settled: z.boolean() }),
  z.object({ type: z.literal("studio:quality-request"), protocolVersion: z.literal(1), requestId: z.string().min(1), slideIndex: z.number().int().nonnegative().optional(), mode: z.enum(["canonical", "imported"]).default("imported"), strict: z.boolean().default(false) }),
  z.object({ type: z.literal("studio:quality-report"), protocolVersion: z.literal(1), requestId: z.string().min(1), report: qualityReportSchema }),
]);
export type StudioMessage = z.infer<typeof studioMessageSchema>;

export const exportJobSchema = z.object({
  id: z.string(),
  format: z.enum(["pdf", "pptx"]),
  status: z.enum(["queued", "running", "complete", "failed"]),
  progress: z.number().min(0).max(1),
  output: z.string().optional(),
  error: z.string().optional(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export function parseDeckGoal(input: unknown): DeckGoalV1 { return deckGoalSchema.parse(input); }
export function parseStudioMessage(input: unknown): StudioMessage { return studioMessageSchema.parse(input); }
