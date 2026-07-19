import { mapStudioTransitionToNative, resolveNativeShapePreset } from "@slides-studio/pptx-compat/browser";
import { parseDiagramSpec, transitionSpecSchema } from "@slides-studio/protocol";

export type PptxSlideIntent = "native-oriented" | "hybrid" | "raster";
export type PptxHtmlReadinessStatus = "blocked" | "hybrid" | "native-oriented";
export type PptxHtmlReadinessSeverity = "blocker" | "warning" | "info";
export type PptxHtmlDisposition = "native-candidate" | "regional-fallback" | "runtime-dependent" | "clean-plate" | "omitted-risk" | "blocked";

export interface PptxHtmlReadinessIssue {
  severity: PptxHtmlReadinessSeverity;
  code: string;
  disposition: PptxHtmlDisposition;
  reason: string;
  slideId?: string;
  objectId?: string;
}

export interface PptxHtmlReadinessReport {
  schemaVersion: 1;
  status: PptxHtmlReadinessStatus;
  ready: boolean;
  strictReady: boolean;
  slideCount: number;
  stableObjects: number;
  nativeCandidates: number;
  regionalFallbacks: number;
  runtimeDependent: number;
  cleanPlateFallbacks: number;
  fullSlideFallbacks: number;
  issues: PptxHtmlReadinessIssue[];
}

const CHART_TYPES = new Set(["bar", "barHorizontal", "barStacked", "barStacked100", "line", "lineMarkers", "lineStacked", "pie", "doughnut", "area", "areaStacked", "areaStacked100", "radar", "radarFilled"]);
const REGIONAL_FALLBACK_TAGS = new Set(["VIDEO", "CANVAS", "IFRAME", "SVG", "PATH"]);
const METADATA_SELECTOR = "[data-pptx-shape],[data-pptx-chart],[data-diagram-type]";
const BLOCKED_URL = /^(?:javascript|vbscript):/i;
const REMOTE_OR_BLOB_MEDIA = /^(?:https?:|blob:)/i;
const SUPPORTED_DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|svg\+xml)[;,]/i;
const UNSUPPORTED_INLINE_STYLE = /(?:^|;)\s*(?:transform|filter|box-shadow|text-shadow|clip-path|mask|opacity|background-image)\s*:/i;

function directText(element: Element): string {
  return Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
}

function issue(issues: PptxHtmlReadinessIssue[], severity: PptxHtmlReadinessSeverity, code: string, disposition: PptxHtmlDisposition, reason: string, context: { slideId?: string; objectId?: string } = {}): void {
  issues.push({ severity, code, disposition, reason, ...context });
}

function parseJsonAttribute(element: Element, name: string, issues: PptxHtmlReadinessIssue[], context: { slideId?: string; objectId?: string }): unknown | undefined {
  const raw = element.getAttribute(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as unknown; }
  catch (error) { issue(issues, "blocker", `${name.slice(5)}-json`, "blocked", `${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, context); return undefined; }
}

function validGradient(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const gradient = value as { angle?: unknown; stops?: unknown };
  if (typeof gradient.angle !== "number" || !Number.isFinite(gradient.angle) || !Array.isArray(gradient.stops) || gradient.stops.length < 2) return false;
  return gradient.stops.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const stop = entry as { color?: unknown; position?: unknown; transparency?: unknown };
    return typeof stop.color === "string" && /^#?[0-9a-f]{6}$/i.test(stop.color) && typeof stop.position === "number" && Number.isFinite(stop.position) && stop.position >= 0 && stop.position <= 1 && (stop.transparency === undefined || (typeof stop.transparency === "number" && Number.isFinite(stop.transparency) && stop.transparency >= 0 && stop.transparency <= 100));
  });
}

function validChart(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const chart = value as { chartType?: unknown; series?: unknown };
  if (typeof chart.chartType !== "string" || !CHART_TYPES.has(chart.chartType) || !Array.isArray(chart.series) || chart.series.length === 0) return false;
  return chart.series.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const series = entry as { name?: unknown; labels?: unknown; values?: unknown };
    return typeof series.name === "string" && series.name.trim().length > 0 && Array.isArray(series.labels) && Array.isArray(series.values) && series.labels.length > 0 && series.labels.length === series.values.length && series.labels.every((label) => typeof label === "string" && label.trim().length > 0) && series.values.every((value) => typeof value === "number" && Number.isFinite(value));
  });
}

function validateTable(element: Element, issues: PptxHtmlReadinessIssue[], context: { slideId?: string; objectId?: string }): boolean {
  const rows = Array.from(element.querySelectorAll("tr"));
  if (rows.length === 0) { issue(issues, "blocker", "table-empty", "blocked", "Native table has no rows.", context); return false; }
  let valid = true;
  rows.forEach((row, rowIndex) => Array.from(row.querySelectorAll(":scope > th,:scope > td")).forEach((cell, cellIndex) => {
    for (const name of ["colspan", "rowspan"] as const) {
      const raw = cell.getAttribute(name); if (raw === null) continue;
      const span = Number(raw);
      if (!Number.isInteger(span) || span < 1 || (name === "rowspan" && rowIndex + span > rows.length)) { issue(issues, "blocker", "table-span", "blocked", `Table cell ${rowIndex + 1}:${cellIndex + 1} has invalid ${name}.`, context); valid = false; }
    }
  }));
  return valid;
}

function untrackedElements(slide: Element): Element[] {
  return [slide, ...Array.from(slide.querySelectorAll("*"))].filter((element) => !["SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName) && !element.closest("[data-object-id]"));
}

function hasUntrackedText(slide: Element): boolean {
  return untrackedElements(slide).some((element) => directText(element).length > 0);
}

function hasUntrackedForeground(slide: Element): boolean {
  return untrackedElements(slide).some((element) => { const match = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/i.exec(element.getAttribute("style") ?? ""); return match ? Number(match[1]) >= 0 : false; });
}

export function analyzePptxHtmlReadiness(root: ParentNode): PptxHtmlReadinessReport {
  const issues: PptxHtmlReadinessIssue[] = [];
  const stages = Array.from(root.querySelectorAll(".deck-stage"));
  if (stages.length !== 1) issue(issues, "blocker", "stage-count", "blocked", `Expected exactly one .deck-stage, found ${stages.length}.`);
  const slides = Array.from(root.querySelectorAll(".slide"));
  if (slides.length === 0) issue(issues, "blocker", "slides-missing", "blocked", "No .slide elements were found.");

  const slideIds = new Set<string>(); const objectIds = new Set<string>();
  let stableObjects = 0; let nativeCandidates = 0; let regionalFallbacks = 0; let runtimeDependent = 0; let fullSlideFallbacks = 0;

  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || ((attribute.name === "href" || attribute.name === "src") && BLOCKED_URL.test(attribute.value.trim()))) issue(issues, "blocker", "unsafe-html", "blocked", `${attribute.name} contains executable or unsafe content.`);
    }
  }
  if (Array.from(root.querySelectorAll("script[src]")).some((element) => /^https?:/i.test(element.getAttribute("src") ?? ""))) issue(issues, "blocker", "remote-script", "blocked", "Remote scripts are not allowed in a self-contained PPTX source.");
  if (Array.from(root.querySelectorAll("style")).some((element) => /@import\s+(?:url\()?['\"]?https?:/i.test(element.textContent ?? ""))) issue(issues, "warning", "remote-style", "runtime-dependent", "Remote stylesheet imports can change fonts or geometry during capture.");

  slides.forEach((slide, slideIndex) => {
    const slideId = slide.getAttribute("data-slide-id")?.trim() ?? "";
    const slideContext = slideId ? { slideId } : {};
    const intent = slide.getAttribute("data-pptx-intent")?.trim() ?? "";
    if (!intent) issue(issues, "warning", "pptx-intent-missing", "runtime-dependent", "Slide does not declare data-pptx-intent as native-oriented, hybrid, or raster.", slideContext);
    else if (!(["native-oriented", "hybrid", "raster"] as string[]).includes(intent)) issue(issues, "blocker", "pptx-intent-invalid", "blocked", `Unsupported data-pptx-intent ${intent}.`, slideContext);
    if (!slideId) issue(issues, "blocker", "slide-id-missing", "blocked", `Slide ${slideIndex + 1} is missing data-slide-id.`);
    else if (slideIds.has(slideId)) issue(issues, "blocker", "slide-id-duplicate", "blocked", `Duplicate data-slide-id ${slideId}.`, slideContext);
    else slideIds.add(slideId);

    for (const metadata of Array.from(slide.querySelectorAll(METADATA_SELECTOR))) if (!metadata.getAttribute("data-object-id")?.trim()) issue(issues, "blocker", "metadata-object-id-missing", "blocked", "Native PPTX or diagram metadata requires data-object-id.", slideContext);

    const stable = Array.from(slide.querySelectorAll("[data-object-id]"));
    if (stable.length === 0) { fullSlideFallbacks += 1; issue(issues, intent === "raster" ? "info" : "warning", "full-slide-fallback", "clean-plate", "Slide has no stable objects; all visible content will be frozen into the clean plate.", slideContext); }
    if (hasUntrackedText(slide)) issue(issues, intent === "raster" ? "info" : "warning", "untracked-text", "clean-plate", "Text outside a data-object-id boundary will be rasterized into the clean plate.", slideContext);
    if (hasUntrackedForeground(slide)) issue(issues, "warning", "untracked-foreground", "clean-plate", "An untracked positive-z element will be flattened behind reconstructed objects in the clean plate.", slideContext);

    const transitionScript = slide.querySelector('script[type="application/json"][data-transition-spec]');
    if (transitionScript?.textContent?.trim()) {
      try {
        const transition = transitionSpecSchema.parse(JSON.parse(transitionScript.textContent));
        const mapping = mapStudioTransitionToNative(transition.kind, transition.durationMs, transition.direction);
        if (!mapping.exact) issue(issues, "warning", "transition-downgrade", "runtime-dependent", mapping.reason ?? `${transition.kind} requires a native-transition downgrade.`, slideContext);
      } catch (error) { issue(issues, "blocker", "transition-metadata", "blocked", `TransitionSpec is invalid: ${error instanceof Error ? error.message : String(error)}`, slideContext); }
    }

    stable.forEach((element) => {
      const objectId = element.getAttribute("data-object-id")?.trim() ?? ""; const context = { ...slideContext, ...(objectId ? { objectId } : {}) };
      stableObjects += 1;
      if (!objectId) issue(issues, "blocker", "object-id-missing", "blocked", "Editable object has an empty data-object-id.", slideContext);
      else if (objectIds.has(objectId)) issue(issues, "blocker", "object-id-duplicate", "blocked", `Duplicate data-object-id ${objectId}.`, context);
      else objectIds.add(objectId);
      if (element.querySelector("[data-object-id]")) issue(issues, "warning", "nested-stable-object", "omitted-risk", "Nested stable objects can duplicate or omit parent-only visuals during capture.", context);
      const unsupportedInlineStyle = UNSUPPORTED_INLINE_STYLE.test(element.getAttribute("style") ?? "");
      const explicitNativeContract = element.tagName === "IMG" || element.tagName === "TABLE" || element.hasAttribute("data-pptx-shape") || element.hasAttribute("data-pptx-chart") || element.hasAttribute("data-diagram-type");
      if (unsupportedInlineStyle && explicitNativeContract) issue(issues, "warning", "native-css-loss", "runtime-dependent", "The explicit native object uses CSS effects that its PowerPoint mapping does not preserve exactly.", context);

      const hyperlink = element.getAttribute("data-pptx-hyperlink");
      if (hyperlink && /^(?:javascript|vbscript|data):/i.test(hyperlink.trim())) issue(issues, "blocker", "hyperlink-unsafe", "blocked", "Native shape hyperlink uses an unsafe scheme.", context);

      if (element.tagName === "IMG") {
        const source = element.getAttribute("src")?.trim() ?? "";
        if (!source || REMOTE_OR_BLOB_MEDIA.test(source) || (source.startsWith("data:") && !SUPPORTED_DATA_IMAGE.test(source))) { regionalFallbacks += 1; issue(issues, "warning", "image-source-fallback", "regional-fallback", "Image source is not a supported deck-local/file/data image and will require a regional screenshot.", context); }
        else nativeCandidates += 1;
        return;
      }

      if (element.hasAttribute("data-diagram-type")) {
        const script = element.querySelector('script[type="application/json"][data-diagram-spec]');
        try { if (!script?.textContent?.trim()) throw new Error("missing data-diagram-spec script"); parseDiagramSpec(JSON.parse(script.textContent)); nativeCandidates += 1; }
        catch (error) { issue(issues, "blocker", "diagram-metadata", "blocked", `DiagramSpec is invalid: ${error instanceof Error ? error.message : String(error)}`, context); }
        return;
      }

      if (element.tagName === "TABLE") { if (validateTable(element, issues, context)) nativeCandidates += 1; return; }

      if (element.hasAttribute("data-pptx-chart")) {
        const chart = parseJsonAttribute(element, "data-pptx-chart", issues, context);
        if (chart !== undefined) { if (validChart(chart)) nativeCandidates += 1; else issue(issues, "blocker", "pptx-chart-schema", "blocked", "data-pptx-chart does not match a supported categorical chart contract.", context); }
        return;
      }

      if (element.hasAttribute("data-pptx-shape")) {
        const preset = element.getAttribute("data-pptx-shape")?.trim() ?? "";
        if (!resolveNativeShapePreset(preset)) issue(issues, "blocker", "pptx-shape-preset", "blocked", `${preset || "(empty)"} is not a schema-valid native shape preset.`, context);
        else {
          const gradient = parseJsonAttribute(element, "data-pptx-gradient", issues, context);
          if (gradient !== undefined && !validGradient(gradient)) issue(issues, "blocker", "pptx-gradient-schema", "blocked", "data-pptx-gradient requires a finite angle and at least two normalized six-digit color stops.", context);
          else nativeCandidates += 1;
          if (gradient !== undefined && element.hasAttribute("data-pptx-fill")) issue(issues, "warning", "pptx-fill-ignored", "runtime-dependent", "data-pptx-fill is ignored when data-pptx-gradient is present.", context);
        }
        return;
      }

      if (REGIONAL_FALLBACK_TAGS.has(element.tagName)) { regionalFallbacks += 1; issue(issues, "warning", "unsupported-stable-element", "regional-fallback", `${element.tagName.toLowerCase()} is not reconstructed as a native PowerPoint object.`, context); return; }
      if (unsupportedInlineStyle) { regionalFallbacks += 1; issue(issues, "warning", "computed-style-fallback", "regional-fallback", "Inline transform, filter, shadow, clipping, opacity, or background-image requires regional browser fallback for a generic object.", context); return; }

      runtimeDependent += 1;
      if (element.children.length > 0) issue(issues, "warning", "rich-text-flattened", "runtime-dependent", "Nested inline markup is flattened to one native text run unless it is intentionally rasterized.", context);
      issue(issues, "info", "computed-style-dependent", "runtime-dependent", "Generic text/fill classification depends on computed style and positive rendered bounds during browser capture.", context);
    });
  });

  const ready = !issues.some((entry) => entry.severity === "blocker");
  const strictReady = ready && !issues.some((entry) => entry.severity === "warning");
  const hybrid = regionalFallbacks > 0 || fullSlideFallbacks > 0 || issues.some((entry) => entry.code === "untracked-text" || entry.code === "untracked-foreground" || entry.code === "nested-stable-object");
  return { schemaVersion: 1, status: ready ? hybrid ? "hybrid" : "native-oriented" : "blocked", ready, strictReady, slideCount: slides.length, stableObjects, nativeCandidates, regionalFallbacks, runtimeDependent, cleanPlateFallbacks: slides.length, fullSlideFallbacks, issues };
}
