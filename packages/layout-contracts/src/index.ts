import type { SlideRenderMode, SlideRole } from "@slides-studio/protocol";

export interface CopyBudget { path: string; maxCharacters: number; maxVisualUnits: number; required?: boolean; }
export interface ArrayBinding { path: string; min: number; max: number; sameLengthAs?: string; }
export interface NumericDomain { path: string; min: number; max: number; integer?: boolean; }
export interface MediaSlot { id: string; kind: "image" | "video" | "diagram"; bbox: [number, number, number, number]; fidelityCritical?: boolean; }
export interface LayoutContract {
  key: string;
  theme: string;
  role: SlideRole;
  reuse: "unique" | "limited" | "free";
  defaults: Record<string, unknown>;
  copy: CopyBudget[];
  arrays?: ArrayBinding[];
  numerics?: NumericDomain[];
  enums?: Record<string, readonly string[]>;
  mediaSlots: MediaSlot[];
  renderModes: SlideRenderMode[];
  diagramTypes?: string[];
  description: string;
}
export interface LayoutQuery { theme?: string; role?: SlideRole; needsMedia?: number; renderMode?: SlideRenderMode; seed?: string; used?: string[]; }
export interface ValidationIssue { severity: "error" | "warning"; path: string; message: string; }
export interface NormalizeResult { layout: string; props: Record<string, unknown>; substitutions: Array<{ from: string; to: string; reason: string }>; issues: ValidationIssue[]; }

export const catalog: LayoutContract[] = [
  { key: "folio-cover", theme: "folio", role: "cover", reuse: "unique", defaults: { eyebrow: "STUDIO NOTE" }, copy: [{ path: "title", maxCharacters: 42, maxVisualUnits: 48, required: true }, { path: "subtitle", maxCharacters: 90, maxVisualUnits: 96 }], mediaSlots: [{ id: "hero", kind: "image", bbox: [0.58, 0.08, 0.36, 0.78] }], renderModes: ["html", "visual-master"], description: "Editorial cover with a strong left title rail and optional preserved hero image." },
  { key: "folio-statement", theme: "folio", role: "content", reuse: "limited", defaults: {}, copy: [{ path: "title", maxCharacters: 56, maxVisualUnits: 60, required: true }, { path: "body", maxCharacters: 240, maxVisualUnits: 270 }], mediaSlots: [], renderModes: ["html", "visual-master"], description: "Single thesis with restrained supporting copy." },
  { key: "folio-media-split", theme: "folio", role: "content", reuse: "free", defaults: {}, copy: [{ path: "title", maxCharacters: 48, maxVisualUnits: 54, required: true }, { path: "body", maxCharacters: 180, maxVisualUnits: 210 }], mediaSlots: [{ id: "media", kind: "image", bbox: [0.54, 0.14, 0.4, 0.72], fidelityCritical: true }], renderModes: ["html", "visual-master"], description: "Protected text rail with a large preserved media panel." },
  { key: "folio-comparison", theme: "folio", role: "comparison", reuse: "free", defaults: {}, copy: [{ path: "title", maxCharacters: 50, maxVisualUnits: 54, required: true }], arrays: [{ path: "columns", min: 2, max: 2 }], mediaSlots: [], renderModes: ["html"], description: "Two-column trade-off comparison." },
  { key: "folio-metrics", theme: "folio", role: "data", reuse: "limited", defaults: {}, copy: [{ path: "title", maxCharacters: 50, maxVisualUnits: 54, required: true }], arrays: [{ path: "metrics", min: 2, max: 5 }], numerics: [{ path: "emphasisIndex", min: 0, max: 4, integer: true }], mediaSlots: [], renderModes: ["html"], description: "Large typographic metrics with one focal result." },
  { key: "folio-diagram", theme: "folio", role: "diagram", reuse: "free", defaults: {}, copy: [{ path: "title", maxCharacters: 56, maxVisualUnits: 60, required: true }], mediaSlots: [{ id: "diagram", kind: "diagram", bbox: [0.06, 0.18, 0.88, 0.68] }], renderModes: ["html"], diagramTypes: ["architecture", "flowchart", "sequence", "state", "er", "timeline", "swimlane", "tree", "org-chart", "layers", "loop", "quadrant", "bar", "line", "gantt", "scatter"], description: "Borderless diagram stage with a short action title." },
  { key: "folio-visual-hero", theme: "folio", role: "content", reuse: "limited", defaults: {}, copy: [{ path: "title", maxCharacters: 38, maxVisualUnits: 44, required: true }], mediaSlots: [{ id: "preserved-asset", kind: "image", bbox: [0.52, 0.12, 0.42, 0.76], fidelityCritical: true }], renderModes: ["visual-master"], description: "Art-directed hero with a reserved real-asset zone." },
  { key: "folio-closing", theme: "folio", role: "closing", reuse: "unique", defaults: {}, copy: [{ path: "title", maxCharacters: 48, maxVisualUnits: 52, required: true }, { path: "contact", maxCharacters: 80, maxVisualUnits: 90 }], mediaSlots: [], renderModes: ["html", "visual-master"], description: "Closing statement and optional contact line." },
];

const getPath = (value: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value);
const visualUnits = (text: string): number => Array.from(text).reduce((sum, character) => sum + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);
const hashSeed = (seed: string): number => Array.from(seed).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function queryLayouts(query: LayoutQuery = {}): LayoutContract[] {
  const used = new Set(query.used ?? []);
  const candidates = catalog.filter((layout) => (!query.theme || layout.theme === query.theme) && (!query.role || layout.role === query.role) && (!query.renderMode || layout.renderModes.includes(query.renderMode)) && (query.needsMedia === undefined || layout.mediaSlots.length >= query.needsMedia));
  const seed = hashSeed(query.seed ?? "slides-studio");
  return candidates.toSorted((left, right) => {
    const leftPenalty = used.has(left.key) ? (left.reuse === "unique" ? 100 : left.reuse === "limited" ? 20 : 5) : 0;
    const rightPenalty = used.has(right.key) ? (right.reuse === "unique" ? 100 : right.reuse === "limited" ? 20 : 5) : 0;
    return leftPenalty - rightPenalty || ((hashSeed(left.key) ^ seed) - (hashSeed(right.key) ^ seed));
  });
}

export function inspectLayout(key: string): LayoutContract {
  const layout = catalog.find((candidate) => candidate.key === key);
  if (!layout) throw new Error(`Unknown layout: ${key}`);
  return layout;
}

export function validateLayoutProps(layout: LayoutContract, props: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const budget of layout.copy) {
    const value = getPath(props, budget.path);
    if (budget.required && (typeof value !== "string" || !value.trim())) issues.push({ severity: "error", path: budget.path, message: "Required copy is missing." });
    if (typeof value === "string") {
      if (value.length > budget.maxCharacters) issues.push({ severity: "error", path: budget.path, message: `Copy exceeds ${budget.maxCharacters} characters.` });
      if (visualUnits(value) > budget.maxVisualUnits) issues.push({ severity: "error", path: budget.path, message: `Copy exceeds ${budget.maxVisualUnits} visual units.` });
      if (/<script|javascript:|vbscript:/i.test(value)) issues.push({ severity: "error", path: budget.path, message: "Unsafe HTML or URL scheme." });
      if (/\{\{.+?\}\}|<TODO>|lorem ipsum|xxxx/i.test(value)) issues.push({ severity: "error", path: budget.path, message: "Placeholder copy remains." });
    }
  }
  for (const binding of layout.arrays ?? []) {
    const value = getPath(props, binding.path);
    if (!Array.isArray(value) || value.length < binding.min || value.length > binding.max) issues.push({ severity: "error", path: binding.path, message: `Expected ${binding.min}-${binding.max} items.` });
    if (binding.sameLengthAs && Array.isArray(value)) { const peer = getPath(props, binding.sameLengthAs); if (Array.isArray(peer) && peer.length !== value.length) issues.push({ severity: "error", path: binding.path, message: `Must match ${binding.sameLengthAs} length.` }); }
  }
  for (const domain of layout.numerics ?? []) {
    const value = getPath(props, domain.path);
    if (typeof value !== "number" || value < domain.min || value > domain.max || (domain.integer && !Number.isInteger(value))) issues.push({ severity: "error", path: domain.path, message: `Expected ${domain.integer ? "integer " : ""}${domain.min}-${domain.max}.` });
  }
  return issues;
}

export function normalizeLayout(key: string, props: Record<string, unknown>, requiredMedia = 0): NormalizeResult {
  let layout = inspectLayout(key);
  const substitutions: NormalizeResult["substitutions"] = [];
  if (layout.mediaSlots.length < requiredMedia) {
    const preferredMode = layout.renderModes[0];
    const replacement = queryLayouts({ theme: layout.theme, role: layout.role, needsMedia: requiredMedia, ...(preferredMode ? { renderMode: preferredMode } : {}) })[0];
    if (!replacement) return { layout: key, props, substitutions, issues: [{ severity: "error", path: "media", message: `Layout has capacity ${layout.mediaSlots.length}; ${requiredMedia} required.` }] };
    substitutions.push({ from: layout.key, to: replacement.key, reason: `media capacity ${layout.mediaSlots.length} < ${requiredMedia}` });
    layout = replacement;
  }
  return { layout: layout.key, props: { ...layout.defaults, ...props }, substitutions, issues: validateLayoutProps(layout, { ...layout.defaults, ...props }) };
}
